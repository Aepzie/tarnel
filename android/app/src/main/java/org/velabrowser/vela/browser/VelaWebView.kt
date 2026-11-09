package org.velabrowser.vela.browser

import android.annotation.SuppressLint
import android.content.Context
import android.view.MotionEvent
import android.webkit.WebView
import kotlin.math.abs

/**
 * WebView that reports vertical drag direction, used to hide the bottom island while reading.
 * Drag-based (not scroll-based) so it also works on pages that scroll an inner element.
 */
@SuppressLint("ViewConstructor")
class VelaWebView(context: Context, val tabId: String) : WebView(context) {
    var onDragDirection: ((down: Boolean) -> Unit)? = null
    var onReachedTop: (() -> Unit)? = null

    /** Every scroll step of the page, including a fling after the finger lifted. Must stay cheap. */
    var onScrollActivity: (() -> Unit)? = null

    private val threshold = 28f * resources.displayMetrics.density
    private var lastX = 0f
    private var lastY = 0f
    private var accumulated = 0f

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastX = event.x
                lastY = event.y
                accumulated = 0f
            }
            MotionEvent.ACTION_MOVE -> if (event.pointerCount == 1) {
                val dy = event.y - lastY
                val dx = event.x - lastX
                lastX = event.x
                lastY = event.y
                if (abs(dy) > abs(dx)) {
                    if ((accumulated > 0) != (dy > 0)) accumulated = 0f
                    accumulated += dy
                    if (accumulated <= -threshold) {
                        onDragDirection?.invoke(true)
                        accumulated = 0f
                    } else if (accumulated >= threshold) {
                        onDragDirection?.invoke(false)
                        accumulated = 0f
                    }
                }
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onScrollChanged(l: Int, t: Int, oldl: Int, oldt: Int) {
        super.onScrollChanged(l, t, oldl, oldt)
        onScrollActivity?.invoke()
        if (t == 0 && oldt > 0) onReachedTop?.invoke()
    }
}
