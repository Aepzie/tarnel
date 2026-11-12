package org.velabrowser.vela.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.BrowserHost
import org.velabrowser.vela.browser.ContextTarget
import org.velabrowser.vela.browser.DownloadItem
import org.velabrowser.vela.browser.DownloadStatus
import org.velabrowser.vela.browser.Downloads
import org.velabrowser.vela.browser.PageError
import org.velabrowser.vela.browser.PageErrorKind
import org.velabrowser.vela.browser.Panel
import org.velabrowser.vela.browser.PermissionKind
import org.velabrowser.vela.browser.Tab
import org.velabrowser.vela.core.FaviconCache
import org.velabrowser.vela.core.HistoryStore
import org.velabrowser.vela.core.NewtabHero
import org.velabrowser.vela.core.SessionStore
import org.velabrowser.vela.core.SettingsStore
import org.velabrowser.vela.core.Space
import org.velabrowser.vela.core.SpaceColors
import org.velabrowser.vela.ui.island.BottomIsland
import org.velabrowser.vela.ui.page.PageErrorView
import org.velabrowser.vela.ui.theme.VelaTheme

/**
 * Renders the main surfaces to PNGs for visual review (Robolectric native graphics + Roborazzi).
 * Opt-in: `./gradlew :app:testDebugUnitTest --tests '*ScreenshotTest*' -Pvela.screenshots=<dir>`.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w412dp-h915dp-xxhdpi")
class ScreenshotTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val dir: String = System.getProperty("vela.screenshots").orEmpty()
    private lateinit var browser: Browser

    private val host = object : BrowserHost {
        override fun enterFullscreen(view: View, onExit: () -> Unit) = Unit
        override fun exitFullscreen() = Unit
        override fun pickFiles(intent: Intent, onResult: (Array<Uri>?) -> Unit) = Unit
        override fun requestAndroidPermissions(permissions: Array<String>, onResult: (Boolean) -> Unit) = Unit
        override fun capture(view: View, scale: Float, onBitmap: (Bitmap?) -> Unit) = onBitmap(null)
        override fun startExternal(intent: Intent) = false
    }

    @Before
    fun setUp() {
        assumeTrue("screenshots are opt-in", dir.isNotEmpty())
        val activity = compose.activity
        val scope = MainScope()
        browser = Browser(
            activity = activity,
            host = host,
            settings = SettingsStore(activity),
            history = HistoryStore(activity, Dispatchers.Unconfined),
            session = SessionStore(activity),
            favicons = FaviconCache(activity, scope),
            downloads = Downloads(activity, scope),
            scope = scope,
        )
        val work = Space("work", "Work", SpaceColors.all[6])
        browser.spaces += listOf(Space.Default, work)
        runBlocking {
            listOf(
                "https://en.wikipedia.org/wiki/Sailing" to "Sailing - Wikipedia",
                "https://en.wikipedia.org/wiki/Vela_(constellation)" to "Vela (constellation) - Wikipedia",
                "https://github.com/Aepzie/tarnel" to "Aepzie/tarnel: Fast. Quiet. Isolated.",
                "https://m.youtube.com/" to "YouTube",
                "https://news.ycombinator.com/" to "Hacker News",
            ).forEach { (url, title) -> repeat(3) { browser.history.record(url, title) } }
        }
        browser.favicons.put("en.wikipedia.org", fakeIcon(0xFFFFFFFF.toInt(), "W", 0xFF111111.toInt()), persist = false)
        browser.favicons.put("m.youtube.com", fakeIcon(0xFFFF0033.toInt(), "▶"), persist = false)
    }

    /** A stand-in favicon: rounded tile with a glyph, like a site's real icon. */
    private fun fakeIcon(background: Int, glyph: String, foreground: Int = 0xFFFFFFFF.toInt()): Bitmap {
        val bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = background
        canvas.drawRoundRect(RectF(0f, 0f, 64f, 64f), 14f, 14f, paint)
        paint.color = foreground
        paint.textSize = 40f
        paint.isFakeBoldText = true
        paint.textAlign = Paint.Align.CENTER
        canvas.drawText(glyph, 32f, 46f, paint)
        return bitmap
    }

    private fun fakePage(seed: Int, dark: Boolean = false): Bitmap {
        val bitmap = Bitmap.createBitmap(432, 760, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawColor(if (dark) 0xFF101114.toInt() else 0xFFFFFFFF.toInt())
        val accents = intArrayOf(0xFF2563EB.toInt(), 0xFFDC2626.toInt(), 0xFF16A34A.toInt(), 0xFF7C3AED.toInt(), 0xFFEA580C.toInt())
        paint.color = accents[seed % accents.size]
        canvas.drawRect(0f, 0f, 432f, 64f, paint)
        paint.color = if (dark) 0xFF2A2C31.toInt() else 0xFFE5E7EB.toInt()
        canvas.drawRoundRect(RectF(24f, 96f, 408f, 300f), 18f, 18f, paint)
        paint.color = if (dark) 0xFF3A3D44.toInt() else 0xFFD1D5DB.toInt()
        for (i in 0 until 14) {
            val y = 330f + i * 28f
            canvas.drawRoundRect(RectF(24f, y, if (i % 4 == 3) 260f else 408f, y + 12f), 6f, 6f, paint)
        }
        return bitmap
    }

    private fun tab(url: String, title: String, space: String = Space.DEFAULT_ID, seed: Int = 0, thumb: Boolean = true) =
        Tab("t-$seed-$space", space, url, title).also {
            if (thumb) it.thumbnail = fakePage(seed).asImageBitmap()
            browser.tabs += it
        }

    private var scene by mutableStateOf<(@Composable () -> Unit)?>(null)
    private var darkScene by mutableStateOf(true)
    private var contentSet = false

    private fun render(dark: Boolean = true, content: @Composable () -> Unit) {
        darkScene = dark
        scene = content
        if (!contentSet) {
            contentSet = true
            compose.setContent {
                VelaTheme(dark = darkScene, accent = Color(browser.activeSpace.color)) { scene?.invoke() }
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
    }

    private fun shoot(name: String) = compose.onRoot().captureRoboImage("$dir/$name.png")
    private fun shootScreen(name: String) = captureScreenRoboImage("$dir/$name.png")

    @Test
    fun newTabDark() {
        val ntp = tab("", "", seed = 1, thumb = false)
        browser.showWithoutLoading(ntp)
        render { BrowserScreen(browser, null) {} }
        shoot("01-newtab-dark-clock")
    }

    @Test
    fun newTabLight() {
        val ntp = tab("", "", seed = 1, thumb = false)
        browser.showWithoutLoading(ntp)
        render(dark = false) { BrowserScreen(browser, null) {} }
        shoot("02-newtab-light-clock")
    }

    @Test
    fun newTabHeroes() {
        val ntp = tab("", "", seed = 1, thumb = false)
        browser.showWithoutLoading(ntp)
        listOf(NewtabHero.LOGO, NewtabHero.GREETING, NewtabHero.DATE, NewtabHero.CLOCK_SECONDS).forEach { hero ->
            browser.settings.update { it.copy(newtabHero = hero) }
            render { BrowserScreen(browser, null) {} }
            shoot("03-newtab-${hero.name.lowercase()}")
        }
        browser.settings.update { it.copy(newtabHero = NewtabHero.CLOCK) }
    }

    @Test
    fun islandOverPage() {
        val page = tab("https://en.wikipedia.org/wiki/Sailing", "Sailing - Wikipedia", seed = 3)
        page.canGoBack = true
        page.loading = true
        page.progress = 62
        browser.showWithoutLoading(page)
        render(dark = true) {
            Box(Modifier.fillMaxSize()) {
                Image(page.thumbnail!!, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter)
                BottomIsland(browser, Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp))
            }
        }
        shoot("04-island-over-page-dark")
        render(dark = false) {
            Box(Modifier.fillMaxSize()) {
                Image(page.thumbnail!!, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter)
                BottomIsland(browser, Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp))
            }
        }
        shoot("05-island-over-page-light")
        page.loading = false
        browser.islandExpanded = false
        render(dark = true) {
            Box(Modifier.fillMaxSize()) {
                Image(page.thumbnail!!, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter)
                BottomIsland(browser, Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp))
            }
        }
        shoot("06-island-collapsed")
    }

    @Test
    fun tabSwitcher() {
        tab("https://en.wikipedia.org/wiki/Sailing", "Sailing - Wikipedia", seed = 0)
        val gh = tab("https://github.com/Aepzie/tarnel", "Aepzie/tarnel", seed = 1)
        tab("https://news.ycombinator.com/", "Hacker News", seed = 4, thumb = false)
        tab("", "", seed = 5, thumb = false)
        tab("https://m.youtube.com/", "YouTube", seed = 2)
        tab("https://example.com/", "Work dashboard", space = "work", seed = 7)
        browser.showWithoutLoading(gh)
        browser.panel = Panel.TABS
        render { BrowserScreen(browser, null) {} }
        shoot("07-tab-switcher-dark")
        render(dark = false) { BrowserScreen(browser, null) {} }
        shoot("08-tab-switcher-light")
    }

    @Test
    fun omnibox() {
        val page = tab("https://en.wikipedia.org/wiki/Sailing", "Sailing - Wikipedia", seed = 3)
        browser.showWithoutLoading(page)
        browser.editing = true
        render { BrowserScreen(browser, null) {} }
        shoot("09-omnibox-current-page")
    }

    @Test
    fun spacesAndMenuSheets() {
        val ntp = tab("", "", seed = 1, thumb = false)
        tab("https://example.com/", "Work", space = "work", seed = 7)
        browser.showWithoutLoading(ntp)
        browser.panel = Panel.SPACES
        render { BrowserScreen(browser, null) {} }
        shootScreen("10-spaces-sheet")
        browser.panel = Panel.MENU
        render { BrowserScreen(browser, null) {} }
        shootScreen("11-menu-sheet")
    }

    @Test
    fun historyAndSettings() {
        val ntp = tab("", "", seed = 1, thumb = false)
        browser.showWithoutLoading(ntp)
        browser.panel = Panel.HISTORY
        render { BrowserScreen(browser, null) {} }
        shoot("12-history")
        browser.panel = Panel.SETTINGS
        render { BrowserScreen(browser, null) {} }
        shoot("13-settings")
        compose.onRoot().performTouchInput { swipeUp(durationMillis = 300) }
        compose.mainClock.advanceTimeBy(1_000)
        shoot("13b-settings-adblock")
        render(dark = false) { BrowserScreen(browser, null) {} }
        shoot("14-settings-light")
    }

    @Test
    fun promptsAndErrors() {
        val page = tab("http://neverssl.com/", "NeverSSL", seed = 2)
        browser.showWithoutLoading(page)
        page.error = PageError(PageErrorKind.HTTPS_UNAVAILABLE, "http://neverssl.com/")
        render { Box(Modifier.fillMaxSize()) { PageErrorView(browser, page, page.error!!) } }
        shoot("15-error-https-only")

        page.error = null
        browser.contextTarget = ContextTarget(page.id, "https://en.wikipedia.org/wiki/Vela_(constellation)", null, "Vela (constellation)")
        render { BrowserScreen(browser, null) {} }
        shootScreen("16-context-menu")
        browser.contextTarget = null

        browser.downloads.items.add(DownloadItem(1, "tarnel-0.2.1.apk", "application/vnd.android.package-archive", DownloadStatus.RUNNING, 3_400_000, 9_100_000))
        render { BrowserScreen(browser, null) {} }
        shoot("17-download-chip")
    }

    @Test
    fun findInPage() {
        val page = tab("https://en.wikipedia.org/wiki/Vela_(constellation)", "Vela (constellation) - Wikipedia", seed = 3)
        browser.showWithoutLoading(page)
        browser.showFindResult("star", 2, 85)
        val scene: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize()) {
                Image(page.thumbnail!!, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter)
                BottomIsland(browser, Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp))
            }
        }
        render(content = scene)
        shoot("20-find-in-page")
        render(dark = false, content = scene)
        shoot("21-find-in-page-light")
    }

    @Test
    fun menuOnPage() {
        val page = tab("https://en.wikipedia.org/wiki/Vela_(constellation)", "Vela (constellation) - Wikipedia", seed = 3)
        page.blocked = 14
        browser.showWithoutLoading(page)
        browser.panel = Panel.MENU
        render { BrowserScreen(browser, null) {} }
        shootScreen("22-menu-on-page")
    }

    @Test
    fun permissionPrompt() {
        val page = tab("https://meet.example.org/room", "Meeting", seed = 3)
        browser.showWithoutLoading(page)
        val prompt = org.velabrowser.vela.browser.PermissionPrompt(page.id, "https://meet.example.org", setOf(PermissionKind.CAMERA, PermissionKind.MICROPHONE), {})
        render { org.velabrowser.vela.ui.sheets.PermissionSheet(browser, prompt) }
        shootScreen("18-permission-prompt")
    }

    @Test
    @Config(qualifiers = "w915dp-h412dp-xxhdpi")
    fun landscape() {
        val ntp = tab("", "", seed = 1, thumb = false)
        browser.showWithoutLoading(ntp)
        render { BrowserScreen(browser, null) {} }
        shoot("19-newtab-landscape")
    }
}
