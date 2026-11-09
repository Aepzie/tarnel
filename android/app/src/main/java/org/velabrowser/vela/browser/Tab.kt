package org.velabrowser.vela.browser

import android.os.Bundle
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap

enum class PageErrorKind { OFFLINE, NOT_FOUND, HTTPS_UNAVAILABLE, CERTIFICATE, CRASHED, GENERIC }

data class PageError(val kind: PageErrorKind, val url: String, val detail: String? = null)

/**
 * One tab. Observable fields are Compose state (mutated on the main thread). A tab is *sleeping* when it has
 * no WebView: URL, title and thumbnail stay, the back/forward list is kept in [savedState] until restart.
 */
class Tab(val id: String, spaceId: String, url: String = "", title: String = "") {
    var spaceId by mutableStateOf(spaceId)
    var url by mutableStateOf(url)
    var title by mutableStateOf(title)
    var progress by mutableIntStateOf(0)
    var loading by mutableStateOf(false)
    var canGoBack by mutableStateOf(false)
    var canGoForward by mutableStateOf(false)
    var thumbnail by mutableStateOf<ImageBitmap?>(null)
    var webView by mutableStateOf<VelaWebView?>(null)
    var blocked by mutableIntStateOf(0)
    var error by mutableStateOf<PageError?>(null)
    var secure by mutableStateOf(url.startsWith("https://"))

    /** "Desktop site": desktop user agent for this tab. */
    var desktopMode by mutableStateOf(false)

    /** The tab that opened this one (popup / window.open / "Open in new tab"); closing returns there. */
    var openerId: String? = null

    /** Back/forward list of a sleeping tab (in memory only). */
    var savedState: Bundle? = null
    var lastActive: Long = SystemClock.elapsedRealtime()

    /** Top-level document URL, read by the content blocker on WebView's IO threads. */
    @Volatile
    var documentUrl: String? = url.ifEmpty { null }

    /** Set while an http:// navigation was upgraded to https://, to detect sites without HTTPS. */
    var pendingUpgrade: String? = null

    /** Hosts the user allowed over plain http in this tab after the HTTPS-only interstitial. */
    val httpAllowed = HashSet<String>()

    val isNewTab: Boolean get() = url.isEmpty()
    val isSleeping: Boolean get() = webView == null && !isNewTab

    val displayTitle: String
        get() = when {
            isNewTab -> "New tab"
            title.isNotBlank() -> title
            else -> url
        }
}
