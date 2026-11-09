package org.velabrowser.vela.browser

import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import org.velabrowser.vela.adblock.RequestKind
import org.velabrowser.vela.core.UrlInput
import java.io.ByteArrayInputStream
import java.util.Locale

/** Navigation policy, HTTPS-only upgrades, content blocking and error pages for one tab. */
class TabWebViewClient(private val browser: Browser, private val tab: Tab) : WebViewClientCompat() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) return false
        val url = request.url.toString()
        val scheme = request.url.scheme?.lowercase(Locale.ROOT) ?: return true
        return when (scheme) {
            "http" -> upgradeIfNeeded(view, url, request.isRedirect)
            "https", "about", "data", "blob", "javascript" -> false
            "file", "content" -> true
            else -> {
                browser.openExternal(tab, url, request.hasGesture())
                true
            }
        }
    }

    private fun upgradeIfNeeded(view: WebView, url: String, isRedirect: Boolean): Boolean {
        if (!browser.settings.current.httpsOnly) return false
        val host = UrlInput.hostOf(url) ?: return false
        if (UrlInput.isLocalHost(host) || host in tab.httpAllowed) return false
        val pending = tab.pendingUpgrade
        if (isRedirect && pending != null && UrlInput.hostOf(pending) == host) {
            // The https:// version redirected back to http:// — the site does not support HTTPS.
            tab.pendingUpgrade = null
            view.stopLoading()
            browser.showPageError(tab, PageError(PageErrorKind.HTTPS_UNAVAILABLE, url))
            return true
        }
        val upgraded = UrlInput.upgrade(url)
        tab.pendingUpgrade = upgraded
        view.loadUrl(upgraded, browser.requestHeaders())
        return true
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val settings = browser.settings.current
        if (!settings.adblock || request.isForMainFrame) return null
        val url = request.url.toString()
        if (!url.startsWith("http")) return null
        val headers = request.requestHeaders
        val kind = RequestKind.infer(url, false, headers["Accept"] ?: headers["accept"], headers["Sec-Fetch-Dest"] ?: headers["sec-fetch-dest"])
        if (!browser.blocker.shouldBlock(url, tab.documentUrl, kind)) return null
        if (org.velabrowser.vela.BuildConfig.DEBUG) android.util.Log.d("VelaBlock", "$kind $url")
        browser.onRequestBlocked(tab, url)
        return WebResourceResponse("text/plain", "utf-8", 204, "No Content", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        tab.documentUrl = url
        tab.url = url
        tab.secure = url.startsWith("https://")
        tab.loading = true
        tab.blocked = 0
        tab.blockedUrls.clear()
        if (tab.error?.kind != PageErrorKind.HTTPS_UNAVAILABLE) tab.error = null
        browser.onNavigationStarted(tab)
        injectCosmetics(view, url)
    }

    override fun onPageCommitVisible(view: WebView, url: String) {
        injectCosmetics(view, url)
    }

    override fun onPageFinished(view: WebView, url: String) {
        tab.loading = false
        tab.progress = 100
        if (tab.pendingUpgrade != null && UrlInput.hostOf(tab.pendingUpgrade!!) == UrlInput.hostOf(url)) tab.pendingUpgrade = null
        browser.updateNavState(tab)
        browser.onPageFinished(tab, url, view.title.orEmpty())
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
        tab.url = url
        tab.documentUrl = url
        tab.secure = url.startsWith("https://")
        browser.updateNavState(tab)
        if (!isReload) browser.recordVisit(tab, url, view.title.orEmpty())
    }

    private fun injectCosmetics(view: WebView, url: String) {
        if (!browser.settings.current.adblock || !url.startsWith("http")) return
        val css = browser.blocker.cosmeticCss(url) ?: return
        val quoted = org.json.JSONObject.quote(css)
        view.evaluateJavascript(
            "(function(){var d=document;if(!d||d.getElementById('__vela_cosmetic'))return;" +
                "var s=d.createElement('style');s.id='__vela_cosmetic';s.textContent=$quoted;" +
                "(d.head||d.documentElement).appendChild(s);})()",
            null,
        )
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceErrorCompat) {
        if (!request.isForMainFrame) return
        val url = request.url.toString()
        val code = if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_RESOURCE_ERROR_GET_CODE)) error.errorCode else ERROR_UNKNOWN
        val description = if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_RESOURCE_ERROR_GET_DESCRIPTION)) error.description.toString() else null
        if (code == ERROR_UNSUPPORTED_SCHEME) return
        val pending = tab.pendingUpgrade
        if (pending != null && UrlInput.hostOf(pending) == UrlInput.hostOf(url) && url.startsWith("https://")) {
            tab.pendingUpgrade = null
            browser.showPageError(tab, PageError(PageErrorKind.HTTPS_UNAVAILABLE, "http://" + url.removePrefix("https://"), description))
            return
        }
        val kind = when (code) {
            ERROR_HOST_LOOKUP -> if (browser.isOnline()) PageErrorKind.NOT_FOUND else PageErrorKind.OFFLINE
            ERROR_CONNECT, ERROR_TIMEOUT -> if (browser.isOnline()) PageErrorKind.GENERIC else PageErrorKind.OFFLINE
            ERROR_FAILED_SSL_HANDSHAKE -> PageErrorKind.CERTIFICATE
            else -> PageErrorKind.GENERIC
        }
        browser.showPageError(tab, PageError(kind, url, description))
    }

    @Suppress("WebViewClientOnReceivedSslError")
    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        if (error.url == tab.url || error.url == tab.documentUrl || tab.loading) {
            browser.showPageError(tab, PageError(PageErrorKind.CERTIFICATE, error.url, "Certificate error ${error.primaryError}"))
        }
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        browser.onRendererGone(tab)
        return true
    }
}
