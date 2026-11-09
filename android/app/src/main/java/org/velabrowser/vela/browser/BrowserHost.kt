package org.velabrowser.vela.browser

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.View

/** What the browser needs from the hosting Activity (activity results, window, system UI). */
interface BrowserHost {
    fun enterFullscreen(view: View, onExit: () -> Unit)
    fun exitFullscreen()
    fun pickFiles(intent: Intent, onResult: (Array<Uri>?) -> Unit)
    fun requestAndroidPermissions(permissions: Array<String>, onResult: (Boolean) -> Unit)

    /** Copies what [view] currently shows on screen (PixelCopy), scaled by [scale]. */
    fun capture(view: View, scale: Float, onBitmap: (Bitmap?) -> Unit)
    fun startExternal(intent: Intent): Boolean
}
