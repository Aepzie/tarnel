package org.velabrowser.vela.browser

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ComponentCallbacks2
import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.SystemClock
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.content.getSystemService
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.velabrowser.vela.BuildConfig
import org.velabrowser.vela.adblock.ContentBlocker
import org.velabrowser.vela.adblock.ContentBlockers
import org.velabrowser.vela.adblock.FilterLists
import org.velabrowser.vela.adblock.NoopContentBlocker
import org.velabrowser.vela.core.FaviconCache
import org.velabrowser.vela.core.HistoryStore
import org.velabrowser.vela.core.SavedSession
import org.velabrowser.vela.core.SavedTab
import org.velabrowser.vela.core.SessionStore
import org.velabrowser.vela.core.SettingsStore
import org.velabrowser.vela.core.Space
import org.velabrowser.vela.core.SpaceColors
import org.velabrowser.vela.core.UrlInput
import org.velabrowser.vela.core.UserAgent
import java.util.Locale
import java.util.UUID

/**
 * The browser model: Spaces, tabs and their WebViews, plus transient UI state (open panel, prompts).
 * Everything here runs on the main thread except the few members documented as thread-safe.
 */
class Browser(
    val activity: ComponentActivity,
    val host: BrowserHost,
    val settings: SettingsStore,
    val history: HistoryStore,
    private val session: SessionStore,
    val favicons: FaviconCache,
    val downloads: Downloads,
    private val scope: CoroutineScope,
) {
    /** Thread-safe: read from WebView IO threads. Swapped once the engine has loaded. */
    @Volatile
    var blocker: ContentBlocker = NoopContentBlocker
        private set

    /** Filter lists: download, snapshot and the engine swap (see [FilterLists]). */
    val filterLists = FilterLists(activity.applicationContext, scope) { engine -> blocker = engine }

    val spaces = mutableStateListOf<Space>()
    var activeSpaceId by mutableStateOf(Space.DEFAULT_ID)
        private set
    val tabs = mutableStateListOf<Tab>()
    private val activeTabIds = mutableStateMapOf<String, String>()

    var panel by mutableStateOf(Panel.NONE)
    var editing by mutableStateOf(false)
    var islandExpanded by mutableStateOf(true)
    var contextTarget by mutableStateOf<ContextTarget?>(null)
    var permissionPrompt by mutableStateOf<PermissionPrompt?>(null)
        private set
    var externalPrompt by mutableStateOf<ExternalPrompt?>(null)
    var message by mutableStateOf<UiMessage?>(null)

    /** Find in page (active tab only). */
    var findOpen by mutableStateOf(false)
        private set
    var findQuery by mutableStateOf("")
        private set
    var findMatches by mutableIntStateOf(0)
        private set
    var findIndex by mutableIntStateOf(0)
        private set

    val activeSpace: Space get() = spaces.firstOrNull { it.id == activeSpaceId } ?: spaces.firstOrNull() ?: Space.Default
    val activeTab: Tab? get() = activeTabIds[activeSpaceId]?.let { id -> tabs.firstOrNull { it.id == id } }
    fun tabsIn(spaceId: String): List<Tab> = tabs.filter { it.spaceId == spaceId }
    fun spaceOf(tab: Tab): Space = spaces.firstOrNull { it.id == tab.spaceId } ?: Space.Default
    val profilesSupported: Boolean get() = Profiles.supported

    private val main = Handler(Looper.getMainLooper())
    private val decisions = HashMap<String, Boolean>()
    private var persistJob: Job? = null
    private var lastClosed: SavedTab? = null
    private var lastClosedIndex = 0

    /** Web content theme (drives prefers-color-scheme via the WebView context's isLightTheme). */
    private var webDark: Boolean? = null

    private val userAgent: String by lazy { UserAgent.clean(WebSettings.getDefaultUserAgent(activity)) }

    // ---------------------------------------------------------------- lifecycle

    fun restore(launchUrl: String?) {
        Profiles.sweepBurners()
        val saved = session.load()
        spaces.clear()
        spaces += saved?.spaces?.takeIf { it.isNotEmpty() } ?: listOf(Space.Default)
        if (saved != null) {
            saved.tabs.filter { t -> spaces.any { it.id == t.spaceId } }.forEach { st -> tabs += Tab(st.id, st.spaceId, st.url, st.title).also { it.desktopMode = st.desktop } }
            saved.activeTabBySpace.forEach { (space, tab) -> if (tabs.any { it.id == tab && it.spaceId == space }) activeTabIds[space] = tab }
            activeSpaceId = saved.activeSpaceId.takeIf { id -> spaces.any { it.id == id } } ?: spaces.first().id
        } else {
            activeSpaceId = spaces.first().id
        }
        Profiles.sweepOrphans(spaces.map { it.profileName }.toSet())
        loadThumbnails()

        if (launchUrl != null) {
            openUrlFromIntent(launchUrl)
        } else {
            activeTab?.let(::select) ?: tabsIn(activeSpaceId).lastOrNull()?.let(::select) ?: newTab()
        }
        startSleeper()
        blocker = ContentBlockers.builtIn(activity.applicationContext)
        filterLists.start(online = isOnline())
    }

    private fun loadThumbnails() {
        val ids = tabs.map { it.id }
        scope.launch(Dispatchers.IO) {
            session.pruneThumbnails(ids.toSet())
            ids.forEach { id ->
                val bitmap = session.loadThumbnail(id) ?: return@forEach
                withContext(Dispatchers.Main) { tabs.firstOrNull { it.id == id }?.let { if (it.thumbnail == null) it.thumbnail = bitmap.asImageBitmap() } }
            }
        }
    }

    fun persistSoon() {
        persistJob?.cancel()
        persistJob = scope.launch {
            delay(800)
            persistNow()
        }
    }

    fun persistNow() {
        persistJob?.cancel()
        val regular = spaces.filterNot { it.burner }
        val ids = regular.map { it.id }.toSet()
        val snapshot = SavedSession(
            spaces = regular,
            activeSpaceId = if (activeSpaceId in ids) activeSpaceId else regular.firstOrNull()?.id ?: Space.DEFAULT_ID,
            tabs = tabs.filter { it.spaceId in ids && !it.url.startsWith("about:") }.map { SavedTab(it.id, it.spaceId, it.url, it.title, it.desktopMode) },
            activeTabBySpace = activeTabIds.filterKeys { it in ids },
        )
        scope.launch(Dispatchers.IO) { runCatching { session.save(snapshot) } }
    }

    /** App is finishing (or was swiped away): Burner spaces must not outlive it. */
    fun onFinishing() {
        persistNow()
        spaces.filter { it.burner }.forEach { burner ->
            tabsIn(burner.id).forEach(::destroyWebView)
            Profiles.wipe(burner)
        }
    }

    fun onTrimMemory(level: Int) {
        @Suppress("DEPRECATION")
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) sleepBackgroundTabs(olderThanMs = 0)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) persistNow()
    }

    private fun startSleeper() {
        scope.launch {
            while (isActive) {
                delay(30_000)
                sleepBackgroundTabs(olderThanMs = SLEEP_AFTER_MS)
                enforceLiveLimit()
            }
        }
    }

    private fun sleepBackgroundTabs(olderThanMs: Long) {
        val now = SystemClock.elapsedRealtime()
        val active = activeTab
        tabs.filter { it !== active && it.webView != null && now - it.lastActive >= olderThanMs }.forEach(::sleep)
    }

    private fun enforceLiveLimit() {
        val live = tabs.filter { it.webView != null && it !== activeTab }.sortedBy { it.lastActive }
        val excess = live.size - (MAX_LIVE_WEBVIEWS - 1)
        if (excess > 0) live.take(excess).forEach(::sleep)
    }

    fun sleep(tab: Tab) {
        val webView = tab.webView ?: return
        if (tab === activeTab) return
        val state = Bundle()
        if (webView.saveState(state) != null) tab.savedState = state
        destroyWebView(tab)
    }

    // ---------------------------------------------------------------- tabs

    fun newTab(spaceId: String = activeSpaceId, url: String? = null, select: Boolean = true): Tab {
        val tab = Tab(UUID.randomUUID().toString(), spaceId)
        val anchor = activeTabIds[spaceId]?.let { id -> tabs.indexOfFirst { it.id == id } } ?: -1
        if (anchor >= 0 && url != null) tabs.add(anchor + 1, tab) else tabs.add(tab)
        if (select) {
            captureActive()
            select(tab)
        }
        if (url != null) load(tab, url)
        persistSoon()
        return tab
    }

    /** Makes [tab] the active one without touching WebViews (screenshot tests and previews). */
    @androidx.annotation.VisibleForTesting
    internal fun showWithoutLoading(tab: Tab) {
        activeSpaceId = tab.spaceId
        activeTabIds[tab.spaceId] = tab.id
    }

    /** Shows the find island with a given result (screenshot tests). */
    @androidx.annotation.VisibleForTesting
    internal fun showFindResult(query: String, index: Int, matches: Int) {
        findOpen = true
        findQuery = query
        findIndex = index
        findMatches = matches
    }

    fun select(tab: Tab) {
        val previous = activeTab
        if (previous != null && previous !== tab) {
            previous.webView?.onPause()
            previous.lastActive = SystemClock.elapsedRealtime()
            closeFind()
        }
        activeSpaceId = tab.spaceId
        activeTabIds[tab.spaceId] = tab.id
        tab.lastActive = SystemClock.elapsedRealtime()
        if (tab.isSleeping && tab.error?.kind != PageErrorKind.CRASHED) wake(tab)
        tab.webView?.onResume()
        islandExpanded = true
        persistSoon()
    }

    private fun wake(tab: Tab) {
        val webView = createWebView(tab)
        val state = tab.savedState
        tab.savedState = null
        if (state == null || webView.restoreState(state) == null) loadInto(tab, webView, tab.url)
    }

    fun load(tab: Tab, url: String) {
        val webView = tab.webView ?: createWebView(tab)
        loadInto(tab, webView, url)
    }

    private fun loadInto(tab: Tab, webView: WebView, url: String) {
        tab.error = null
        tab.url = url
        tab.documentUrl = url
        tab.secure = url.startsWith("https://")
        tab.loading = true
        tab.progress = 6
        webView.loadUrl(url, requestHeaders())
    }

    fun navigate(text: String, tab: Tab? = activeTab) {
        val s = settings.current
        val resolved = UrlInput.resolve(text, s.searchEngine, s.httpsOnly) ?: return
        val target = tab ?: newTab()
        val typedScheme = text.trim().startsWith("https://", ignoreCase = true)
        target.pendingUpgrade = if (s.httpsOnly && resolved is UrlInput.Resolved.Url && resolved.url.startsWith("https://") && !typedScheme) resolved.url else null
        editing = false
        islandExpanded = true
        load(target, resolved.url)
    }

    /** Always a search, even when the text looks like an address. */
    fun search(query: String) {
        if (query.isBlank()) return
        val target = activeTab ?: newTab()
        target.pendingUpgrade = null
        editing = false
        islandExpanded = true
        load(target, settings.current.searchEngine.searchUrl(query))
    }

    fun openUrlFromIntent(url: String) {
        val space = activeSpace.takeUnless { it.burner } ?: spaces.first { !it.burner }
        val reuse = activeTab?.takeIf { it.isNewTab && it.spaceId == space.id }
        if (reuse != null) {
            select(reuse)
            navigate(url, reuse)
        } else {
            val tab = newTab(space.id)
            navigate(url, tab)
        }
        panel = Panel.NONE
    }

    fun closeTab(tab: Tab, undoable: Boolean = true) {
        val index = tabs.indexOf(tab)
        if (index < 0) return
        val space = spaceOf(tab)
        val siblings = tabsIn(tab.spaceId)
        val position = siblings.indexOf(tab)
        val wasActive = activeTabIds[tab.spaceId] == tab.id
        destroyWebView(tab)
        tabs.remove(tab)
        if (undoable && !tab.isNewTab && !space.burner) {
            lastClosed = SavedTab(tab.id, tab.spaceId, tab.url, tab.title)
            lastClosedIndex = index
            message = UiMessage("Tab closed", "Undo", action = { reopenClosedTab() })
        }
        if (wasActive) {
            val remaining = tabsIn(tab.spaceId)
            val opener = tab.openerId?.let { id -> remaining.firstOrNull { it.id == id } }
            if (opener != null) {
                if (activeSpaceId == tab.spaceId) select(opener) else activeTabIds[tab.spaceId] = opener.id
                persistSoon()
                return
            }
            if (remaining.isEmpty()) {
                activeTabIds.remove(tab.spaceId)
                if (space.burner) {
                    closeBurner(space)
                    return
                }
                if (panel != Panel.TABS) newTab(tab.spaceId)
            } else {
                val next = remaining[(position).coerceAtMost(remaining.size - 1).coerceAtLeast(0)]
                if (activeSpaceId == tab.spaceId) select(next) else activeTabIds[tab.spaceId] = next.id
            }
        }
        persistSoon()
    }

    private fun reopenClosedTab() {
        val closed = lastClosed ?: return
        lastClosed = null
        if (spaces.none { it.id == closed.spaceId }) return
        val tab = Tab(UUID.randomUUID().toString(), closed.spaceId, closed.url, closed.title)
        tabs.add(lastClosedIndex.coerceIn(0, tabs.size), tab)
        select(tab)
    }

    fun closeAllTabs(spaceId: String) {
        tabsIn(spaceId).forEach { destroyWebView(it); tabs.remove(it) }
        activeTabIds.remove(spaceId)
        val space = spaces.firstOrNull { it.id == spaceId }
        if (space?.burner == true) closeBurner(space) else newTab(spaceId)
        persistSoon()
    }

    /** Called when the tab switcher closes: make sure the active Space shows something. */
    fun ensureActiveTab() {
        if (activeTab == null) tabsIn(activeSpaceId).lastOrNull()?.let(::select) ?: newTab()
    }

    fun openPopupTab(opener: Tab): WebView? {
        val tab = Tab(UUID.randomUUID().toString(), opener.spaceId, "about:blank")
        tab.openerId = opener.id
        tab.desktopMode = opener.desktopMode
        val index = tabs.indexOf(opener)
        tabs.add(if (index >= 0) index + 1 else tabs.size, tab)
        val webView = createWebView(tab)
        captureActive()
        select(tab)
        return webView
    }

    fun openInNewTab(url: String, spaceId: String = activeSpaceId, background: Boolean = false) {
        val opener = activeTab?.takeIf { it.spaceId == spaceId }
        val tab = newTab(spaceId, url = null, select = !background)
        tab.openerId = opener?.id
        load(tab, url)
        if (background) {
            tab.webView?.onPause()
            message = UiMessage("Opened in background", "Show", action = { select(tab) })
        }
    }

    fun goBack(): Boolean {
        val tab = activeTab ?: return false
        val webView = tab.webView
        if (tab.error != null && tab.error?.kind != PageErrorKind.CRASHED && webView?.canGoBack() == true) {
            tab.error = null
            webView.goBack()
            return true
        }
        if (webView?.canGoBack() == true) {
            webView.goBack()
            return true
        }
        return false
    }

    fun goForward() {
        activeTab?.webView?.takeIf { it.canGoForward() }?.goForward()
    }

    fun reload() {
        val tab = activeTab ?: return
        if (tab.isNewTab) return
        val webView = tab.webView
        if (webView == null) {
            tab.error = null
            wake(tab)
            return
        }
        if (tab.error != null) loadInto(tab, webView, tab.error!!.url) else webView.reload()
    }

    fun stop() {
        activeTab?.webView?.stopLoading()
        activeTab?.loading = false
    }

    fun continueInsecure(tab: Tab) {
        val url = tab.error?.url ?: return
        UrlInput.hostOf(url)?.let { tab.httpAllowed += it }
        tab.pendingUpgrade = null
        load(tab, url)
    }

    /** Snapshot of the active tab for the switcher; [then] runs once the copy is taken (or failed). */
    fun captureActive(then: (() -> Unit)? = null) {
        val tab = activeTab
        val webView = tab?.webView
        if (tab == null || webView == null || !webView.isAttachedToWindow || webView.width == 0 || tab.error != null) {
            then?.invoke()
            return
        }
        host.capture(webView, THUMB_SCALE) { bitmap ->
            if (bitmap != null) {
                tab.thumbnail = bitmap.asImageBitmap()
                if (!spaceOf(tab).burner) scope.launch(Dispatchers.IO) { session.saveThumbnail(tab.id, bitmap) }
            }
            then?.invoke()
        }
    }

    fun openTabSwitcher() {
        editing = false
        closeFind()
        captureActive { panel = Panel.TABS }
    }

    /** Moves [tab] to the position of [target] (both in the same Space), e.g. while dragging in the switcher. */
    fun moveTab(tab: Tab, target: Tab) {
        if (tab === target || tab.spaceId != target.spaceId) return
        val from = tabs.indexOf(tab)
        val to = tabs.indexOf(target)
        if (from < 0 || to < 0) return
        tabs.removeAt(from)
        tabs.add(to, tab)
        persistSoon()
    }

    // ---------------------------------------------------------------- find in page

    fun openFind() {
        val tab = activeTab ?: return
        if (tab.isNewTab || tab.webView == null) return
        panel = Panel.NONE
        editing = false
        findOpen = true
        islandExpanded = true
        if (findQuery.isNotEmpty()) tab.webView?.findAllAsync(findQuery)
    }

    fun find(query: String) {
        findQuery = query
        val webView = activeTab?.webView ?: return
        if (query.isEmpty()) {
            webView.clearMatches()
            findMatches = 0
            findIndex = 0
        } else {
            webView.findAllAsync(query)
        }
    }

    fun findNext(forward: Boolean) {
        if (findQuery.isEmpty()) return
        activeTab?.webView?.findNext(forward)
    }

    fun closeFind() {
        if (!findOpen) return
        findOpen = false
        activeTab?.webView?.clearMatches()
        findMatches = 0
        findIndex = 0
    }

    // ---------------------------------------------------------------- desktop site

    fun toggleDesktopSite(tab: Tab) {
        tab.desktopMode = !tab.desktopMode
        val webView = tab.webView
        if (webView != null) {
            webView.settings.userAgentString = if (tab.desktopMode) UserAgent.desktop(userAgent) else userAgent
            webView.reload()
        }
        persistSoon()
    }

    // ---------------------------------------------------------------- WebView

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(tab: Tab): VelaWebView {
        val space = spaceOf(tab)
        val s = settings.current
        val themed = android.view.ContextThemeWrapper(activity, if (webDark == false) org.velabrowser.vela.R.style.Theme_Vela_WebLight else org.velabrowser.vela.R.style.Theme_Vela_WebDark)
        val webView = VelaWebView(themed, tab.id)
        Profiles.attach(webView, space)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            setSupportZoom(true)
            allowFileAccess = false
            allowContentAccess = false
            safeBrowsingEnabled = true
            mixedContentMode = if (s.httpsOnly) WebSettings.MIXED_CONTENT_NEVER_ALLOW else WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            userAgentString = if (tab.desktopMode) UserAgent.desktop(userAgent) else userAgent
        }
        webView.setFindListener { ordinal, count, _ ->
            if (tab === activeTab && findOpen) {
                findIndex = ordinal
                findMatches = count
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, BlobDownloads.BRIDGE, setOf("*")) { _, message, _, _, _ ->
                message.data?.let { blobDownloads.onMessage(it) }
            }
        }
        // X-Requested-With (the app package name) is not sent: current WebViews omit it unless an app opts in
        // through the (now restricted) origin allow-list, which Vela never populates.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ATTRIBUTION_REGISTRATION_BEHAVIOR)) {
            WebSettingsCompat.setAttributionRegistrationBehavior(webView.settings, WebSettingsCompat.ATTRIBUTION_BEHAVIOR_DISABLED)
        }
        Profiles.cookieManager(space).apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, !s.blockThirdPartyCookies)
        }
        if (s.doNotTrack && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, PRIVACY_SIGNALS_JS, setOf("*"))
        }
        webView.webViewClient = TabWebViewClient(this, tab)
        webView.webChromeClient = TabChromeClient(this, tab)
        webView.setDownloadListener { url, ua, contentDisposition, mimeType, _ -> download(tab, url, ua, contentDisposition, mimeType) }
        webView.setOnLongClickListener { onLongPress(tab, webView) }
        webView.onDragDirection = { down -> if (tab === activeTab && !editing) islandExpanded = !down }
        webView.onReachedTop = { if (tab === activeTab) islandExpanded = true }
        tab.webView = webView
        return webView
    }

    private fun destroyWebView(tab: Tab) {
        val webView = tab.webView ?: return
        tab.webView = null
        tab.loading = false
        webView.stopLoading()
        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        webView.webChromeClient = null
        webView.setDownloadListener(null)
        webView.destroy()
    }

    /** Switches web content between light and dark; live tabs are re-created (state kept) so pages follow. */
    fun setWebDarkMode(dark: Boolean) {
        val previous = webDark
        webDark = dark
        if (previous == null || previous == dark) return
        val active = activeTab
        tabs.filter { it.webView != null }.forEach { tab ->
            val state = Bundle()
            if (tab.webView?.saveState(state) != null) tab.savedState = state
            destroyWebView(tab)
        }
        if (active != null && !active.isNewTab && active.error == null) wake(active)
    }

    fun requestHeaders(): Map<String, String> = if (settings.current.doNotTrack) mapOf("DNT" to "1", "Sec-GPC" to "1") else emptyMap()

    /** Re-applies settings that live on WebSettings to every live WebView. */
    fun applySettingsToLiveTabs() {
        val s = settings.current
        tabs.forEach { tab ->
            val webView = tab.webView ?: return@forEach
            webView.settings.mixedContentMode = if (s.httpsOnly) WebSettings.MIXED_CONTENT_NEVER_ALLOW else WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            Profiles.cookieManager(spaceOf(tab)).setAcceptThirdPartyCookies(webView, !s.blockThirdPartyCookies)
        }
    }

    // ---------------------------------------------------------------- callbacks from clients

    /** Counts each blocked URL once per page (scripts often retry a blocked request in a loop). */
    fun onRequestBlocked(tab: Tab, url: String) {
        main.post { if (tab.blockedUrls.size < 10_000 && tab.blockedUrls.add(url)) tab.blocked++ }
    }

    fun onNavigationStarted(tab: Tab) {
        if (tab !== activeTab) return
        islandExpanded = true
        closeFind()
    }

    fun updateNavState(tab: Tab) {
        val webView = tab.webView ?: return
        tab.canGoBack = webView.canGoBack()
        tab.canGoForward = webView.canGoForward()
    }

    fun onPageFinished(tab: Tab, url: String, title: String) {
        if (title.isNotBlank() && !title.startsWith("http")) tab.title = title
        persistSoon()
    }

    fun recordVisit(tab: Tab, url: String, title: String) {
        if (spaceOf(tab).burner || !url.startsWith("http")) return
        scope.launch { history.record(url, title) }
    }

    fun onTitle(tab: Tab, title: String) {
        if (spaceOf(tab).burner) return
        val url = tab.url
        scope.launch { history.updateTitle(url, title) }
    }

    fun onFavicon(tab: Tab, icon: Bitmap) {
        val host = UrlInput.hostOf(tab.url) ?: return
        favicons.put(host, icon, persist = !spaceOf(tab).burner)
    }

    fun showPageError(tab: Tab, error: PageError) {
        tab.error = error
        tab.loading = false
        if (tab === activeTab) islandExpanded = true
    }

    fun onRendererGone(tab: Tab) {
        val url = tab.url
        destroyWebView(tab)
        tab.savedState = null
        tab.error = PageError(PageErrorKind.CRASHED, url)
    }

    fun isOnline(): Boolean {
        val cm = activity.getSystemService<ConnectivityManager>() ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    // ---------------------------------------------------------------- downloads & context menu

    private val blobDownloads = BlobDownloads(activity.applicationContext, scope) { fileName, uri ->
        message = if (uri == null) {
            UiMessage("Couldn't save “$fileName”")
        } else {
            UiMessage("Saved “$fileName” to Downloads", "Open", action = {
                val view = Intent(Intent.ACTION_VIEW).setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                if (!host.startExternal(view)) message = UiMessage("No app can open this file")
            })
        }
    }

    fun download(tab: Tab, url: String, ua: String?, contentDisposition: String?, mimeType: String?) {
        val bridge = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        if (url.startsWith("data:", ignoreCase = true)) {
            // Through the page when possible, to pick up the link's download="name".
            val webView = tab.webView
            if (webView != null && bridge) blobDownloads.fetchBlob(webView, url, contentDisposition, mimeType)
            else blobDownloads.saveDataUrl(url, blobDownloads.fileName(url, contentDisposition, mimeType), mimeType)
            return
        }
        if (url.startsWith("blob:", ignoreCase = true)) {
            val webView = tab.webView
            if (webView == null || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                message = UiMessage("This download isn't supported on this WebView")
                return
            }
            blobDownloads.fetchBlob(webView, url, contentDisposition, mimeType)
            return
        }
        if (!url.startsWith("http")) {
            message = UiMessage("This kind of download isn't supported")
            return
        }
        val cookies = runCatching { Profiles.cookieManager(spaceOf(tab)).getCookie(url) }.getOrNull()
        val item = downloads.enqueue(url, ua ?: userAgent, contentDisposition, mimeType, cookies, tab.url)
        if (item == null) message = UiMessage("Couldn't start the download")
    }

    private fun onLongPress(tab: Tab, webView: WebView): Boolean {
        val hit = webView.hitTestResult
        return when (hit.type) {
            WebView.HitTestResult.SRC_ANCHOR_TYPE -> {
                contextTarget = ContextTarget(tab.id, hit.extra, null)
                true
            }
            WebView.HitTestResult.IMAGE_TYPE -> {
                contextTarget = ContextTarget(tab.id, null, hit.extra)
                true
            }
            WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                val image = hit.extra
                val msg = Message.obtain(Handler(Looper.getMainLooper()) { m ->
                    val link = m.data.getString("url")
                    contextTarget = ContextTarget(tab.id, link?.takeIf { it.isNotBlank() }, image, m.data.getString("title"))
                    true
                })
                webView.requestFocusNodeHref(msg)
                true
            }
            else -> false
        }
    }

    fun copyToClipboard(label: String, text: String) {
        val clipboard = activity.getSystemService<android.content.ClipboardManager>() ?: return
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText(label, text))
        if (android.os.Build.VERSION.SDK_INT < 33) message = UiMessage("Copied")
    }

    fun share(url: String, title: String?) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url)
        if (!title.isNullOrBlank()) send.putExtra(Intent.EXTRA_SUBJECT, title)
        host.startExternal(Intent.createChooser(send, null))
    }

    // ---------------------------------------------------------------- external apps

    fun openExternal(tab: Tab, url: String, hasGesture: Boolean) {
        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return
        var fallback: String? = null
        val intent = if (scheme == "intent") {
            val parsed = runCatching { Intent.parseUri(url, Intent.URI_INTENT_SCHEME) }.getOrNull() ?: return
            fallback = parsed.getStringExtra("browser_fallback_url")?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
            if (parsed.`package` == activity.packageName) return
            sanitize(parsed)
        } else {
            sanitize(Intent(Intent.ACTION_VIEW, uri))
        }
        if (hasGesture && scheme in DIRECT_SCHEMES) {
            launchExternal(tab, intent, fallback)
            return
        }
        if (tab !== activeTab) return
        val target = when (scheme) {
            "mailto" -> "your email app"
            "tel" -> "your phone app"
            "sms", "smsto" -> "your messages app"
            "market" -> "Google Play"
            else -> intent.`package` ?: "another app"
        }
        externalPrompt = ExternalPrompt(tab.id, intent, target, fallback)
    }

    fun launchExternal(tab: Tab?, intent: Intent, fallback: String?) {
        externalPrompt = null
        if (host.startExternal(intent)) return
        if (fallback != null && tab != null) load(tab, fallback) else message = UiMessage("No app can open this link")
    }

    fun launchExternal(prompt: ExternalPrompt) = launchExternal(tabs.firstOrNull { it.id == prompt.tabId }, prompt.intent, prompt.fallbackUrl)

    private fun sanitize(intent: Intent): Intent {
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        intent.component = null
        intent.selector = null
        intent.flags = intent.flags and (
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            ).inv()
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return intent
    }

    // ---------------------------------------------------------------- permissions

    fun onPermissionRequest(tab: Tab, request: PermissionRequest) {
        val kinds = request.resources.mapNotNull {
            when (it) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> PermissionKind.CAMERA
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> PermissionKind.MICROPHONE
                else -> null
            }
        }.toSet()
        val resources = request.resources.filter {
            it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
        }.toTypedArray()
        if (kinds.isEmpty() || tab !== activeTab) {
            request.deny()
            return
        }
        val origin = request.origin.toString()
        val grant: (Boolean) -> Unit = { allow ->
            if (!allow) {
                request.deny()
            } else {
                host.requestAndroidPermissions(androidPermissions(kinds)) { granted ->
                    if (granted) request.grant(resources) else {
                        request.deny()
                        message = UiMessage("Vela doesn't have ${kinds.joinToString(" and ") { it.label }} access in Android settings")
                    }
                }
            }
        }
        ask(tab, origin, kinds, grant, request)
    }

    fun onPermissionRequestCanceled(request: PermissionRequest) {
        if (permissionPrompt?.token === request) permissionPrompt = null
    }

    fun onGeolocationRequest(tab: Tab, origin: String, callback: GeolocationPermissions.Callback) {
        if (tab !== activeTab) {
            callback.invoke(origin, false, false)
            return
        }
        val kinds = setOf(PermissionKind.LOCATION)
        val grant: (Boolean) -> Unit = { allow ->
            if (!allow) callback.invoke(origin, false, false) else {
                host.requestAndroidPermissions(androidPermissions(kinds)) { granted -> callback.invoke(origin, granted, false) }
            }
        }
        ask(tab, origin, kinds, grant, callback)
    }

    private fun ask(tab: Tab, origin: String, kinds: Set<PermissionKind>, grant: (Boolean) -> Unit, token: Any) {
        val keys = kinds.map { "${tab.spaceId}|$origin|$it" }
        val known = keys.map { decisions[it] }
        if (known.all { it == true }) return grant(true)
        if (known.any { it == false }) return grant(false)
        permissionPrompt = PermissionPrompt(tab.id, origin, kinds, decide = { allow ->
            permissionPrompt = null
            keys.forEach { decisions[it] = allow }
            grant(allow)
        }, token = token)
    }

    fun dismissPermissionPrompt() {
        permissionPrompt?.decide?.invoke(false)
        permissionPrompt = null
    }

    private fun androidPermissions(kinds: Set<PermissionKind>): Array<String> = kinds.flatMap {
        when (it) {
            PermissionKind.CAMERA -> listOf(Manifest.permission.CAMERA)
            PermissionKind.MICROPHONE -> listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.MODIFY_AUDIO_SETTINGS)
            PermissionKind.LOCATION -> listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        }
    }.toTypedArray()

    // ---------------------------------------------------------------- spaces

    fun switchSpace(space: Space) {
        if (space.id == activeSpaceId && activeTab != null) return
        captureActive()
        activeTab?.webView?.onPause()
        activeSpaceId = space.id
        val target = activeTab ?: tabsIn(space.id).lastOrNull()
        if (target != null) select(target) else newTab(space.id)
    }

    fun createSpace(name: String, color: Long): Space {
        val space = Space(UUID.randomUUID().toString().take(8), name.trim().ifEmpty { "Space ${spaces.size + 1}" }, color)
        val firstBurner = spaces.indexOfFirst { it.burner }
        if (firstBurner >= 0) spaces.add(firstBurner, space) else spaces.add(space)
        switchSpace(space)
        persistSoon()
        return space
    }

    fun updateSpace(space: Space, name: String, color: Long) {
        val index = spaces.indexOfFirst { it.id == space.id }
        if (index < 0) return
        spaces[index] = space.copy(name = name.trim().ifEmpty { space.name }, color = color)
        persistSoon()
    }

    fun deleteSpace(space: Space) {
        if (space.burner) return closeBurner(space)
        if (spaces.count { !it.burner } <= 1) {
            message = UiMessage("Vela needs at least one Space")
            return
        }
        tabsIn(space.id).forEach { destroyWebView(it); tabs.remove(it) }
        activeTabIds.remove(space.id)
        spaces.removeAll { it.id == space.id }
        if (activeSpaceId == space.id) switchSpace(spaces.first { !it.burner })
        Profiles.wipe(space)
        persistNow()
        message = UiMessage("“${space.name}” deleted and its data wiped")
    }

    fun openBurner() {
        if (!Profiles.supported) {
            message = UiMessage("Burner spaces need a newer Android System WebView")
            return
        }
        val existing = spaces.firstOrNull { it.burner }
        if (existing != null) {
            switchSpace(existing)
            return
        }
        val burner = Space(UUID.randomUUID().toString().take(8), "Burner", SpaceColors.BURNER, burner = true)
        spaces.add(burner)
        switchSpace(burner)
    }

    fun closeBurner(space: Space) {
        tabsIn(space.id).forEach { destroyWebView(it); tabs.remove(it) }
        activeTabIds.remove(space.id)
        spaces.removeAll { it.id == space.id }
        if (activeSpaceId == space.id) switchSpace(spaces.first { !it.burner })
        Profiles.wipe(space)
        message = UiMessage("Burner closed — everything it stored is gone")
    }

    /** Clears cookies, storage, cache and permissions of one Space (other Spaces are untouched). */
    fun clearSpaceData(space: Space) {
        val spaceTabs = tabsIn(space.id)
        val activeHere = activeTab?.takeIf { it.spaceId == space.id }
        spaceTabs.forEach { it.savedState = null; destroyWebView(it) }
        decisions.keys.removeAll { it.startsWith(space.id + "|") }
        Profiles.wipe(space) {
            if (activeHere != null && activeTab === activeHere && !activeHere.isNewTab) wake(activeHere)
        }
        message = UiMessage(if (Profiles.supported) "Cleared data for “${space.name}”" else "Cleared browsing data")
    }

    fun clearHistory() {
        scope.launch {
            history.clear()
            favicons.clearDisk()
        }
    }

    companion object {
        const val THUMB_SCALE = 0.42f
        private const val SLEEP_AFTER_MS = 5 * 60_000L
        private const val MAX_LIVE_WEBVIEWS = 6
        private val DIRECT_SCHEMES = setOf("mailto", "tel", "sms", "smsto", "geo")

        /** GPC + DNT for scripts; the matching headers are sent on top-level navigations. */
        private const val PRIVACY_SIGNALS_JS =
            "(function(){try{var d={configurable:true,enumerable:true};" +
                "Object.defineProperty(Navigator.prototype,'globalPrivacyControl',Object.assign({get:function(){return true}},d));" +
                "Object.defineProperty(Navigator.prototype,'doNotTrack',Object.assign({get:function(){return '1'}},d));}catch(e){}})();"
    }
}
