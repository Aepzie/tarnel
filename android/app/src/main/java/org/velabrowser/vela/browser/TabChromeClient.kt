package org.velabrowser.vela.browser

import android.graphics.Bitmap
import android.net.Uri
import android.os.Message
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView

/** Progress, titles, icons, popups, fullscreen video, permission prompts and file chooser for one tab. */
class TabChromeClient(private val browser: Browser, private val tab: Tab) : WebChromeClient() {

    override fun onProgressChanged(view: WebView, newProgress: Int) {
        tab.progress = newProgress
        if (newProgress >= 100) tab.loading = false
    }

    override fun onReceivedTitle(view: WebView, title: String?) {
        if (!title.isNullOrBlank()) {
            tab.title = title
            browser.onTitle(tab, title)
        }
    }

    override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
        if (icon != null) browser.onFavicon(tab, icon)
    }

    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
        if (!isUserGesture) return false
        val child = browser.openPopupTab(tab) ?: return false
        val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
        transport.webView = child
        resultMsg.sendToTarget()
        return true
    }

    override fun onCloseWindow(window: WebView) {
        browser.closeTab(tab, undoable = false)
    }

    override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        browser.host.enterFullscreen(view) { callback.onCustomViewHidden() }
    }

    override fun onHideCustomView() {
        browser.host.exitFullscreen()
    }

    override fun onPermissionRequest(request: PermissionRequest) {
        browser.onPermissionRequest(tab, request)
    }

    override fun onPermissionRequestCanceled(request: PermissionRequest) {
        browser.onPermissionRequestCanceled(request)
    }

    override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
        browser.onGeolocationRequest(tab, origin, callback)
    }

    override fun onGeolocationPermissionsHidePrompt() {
        browser.dismissPermissionPrompt()
    }

    override fun onShowFileChooser(view: WebView, filePathCallback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
        val intent = runCatching { params.createIntent() }.getOrNull() ?: return false
        if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(android.content.Intent.EXTRA_ALLOW_MULTIPLE, true)
        browser.host.pickFiles(intent) { uris -> filePathCallback.onReceiveValue(uris) }
        return true
    }

    override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
}
