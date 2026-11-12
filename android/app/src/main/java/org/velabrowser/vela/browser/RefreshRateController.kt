package org.velabrowser.vela.browser

import android.app.Activity
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import android.view.View
import androidx.annotation.RequiresApi
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.content.getSystemService
import org.velabrowser.vela.core.DisplayModeSpec
import org.velabrowser.vela.core.RefreshRateMode
import org.velabrowser.vela.core.RefreshRatePolicy
import kotlin.math.roundToInt

/** The activity's [RefreshRateController]; null in previews and screenshot tests. */
val LocalRefreshRate = staticCompositionLocalOf<RefreshRateController?> { null }

/**
 * Applies Settings → Display → Refresh rate to the activity window.
 *
 * Without a request, many 90/120/144 Hz phones keep an app at 60 Hz: the WebView scrolls inside its own
 * compositor, so Android's frame-rate heuristics (touch boost, view velocity votes) often never see a fast
 * scroll, and a fling continues long after the finger lifted.
 *
 * - High: pins the fastest display mode (`preferredDisplayModeId`) and, on Android 15+, opts out of the
 *   system's power-saving frame-rate reduction.
 * - Standard: pins the mode closest to 60 Hz and turns off the touch boost.
 * - Auto: no pin; while the user touches the screen or a page is still scrolling (fling), Tarnel asks for
 *   the fastest rate, and drops the request [IDLE_MS] after the last activity. On Android 15+ this is a
 *   `View.setRequestedFrameRate(CATEGORY_HIGH)` vote on the views that draw (no window update);
 *   below that it is a temporary `preferredDisplayModeId`.
 *
 * Main thread only.
 */
class RefreshRateController(private val activity: Activity, private val activeWebView: () -> View?) : DisplayManager.DisplayListener {
    /** Whole-Hz rates the screen offers at its current resolution, ascending. */
    var supportedRates by mutableStateOf<List<Int>>(emptyList())
        private set

    /** The rate the display runs at right now. */
    var currentRate by mutableIntStateOf(0)
        private set

    private val handler = Handler(Looper.getMainLooper())
    private val displays = activity.getSystemService<DisplayManager>()
    private var mode = RefreshRateMode.AUTO
    private var modes: List<DisplayModeSpec> = emptyList()
    private var current: DisplayModeSpec? = null
    private var boostUntil = 0L
    private var boosted = false
    private val votedViews = ArrayList<View>(2)
    private val idleCheck = Runnable { checkIdle() }

    fun start(initial: RefreshRateMode) {
        displays?.registerDisplayListener(this, handler)
        mode = initial
        readDisplay()
        applyWindow()
    }

    fun stop() {
        displays?.unregisterDisplayListener(this)
        endBoost()
    }

    fun setMode(next: RefreshRateMode) {
        if (next == mode) return
        endBoost()
        mode = next
        readDisplay()
        applyWindow()
    }

    /**
     * Touch on any part of the UI, or a page scroll step. Called for every touch event and WebView scroll
     * callback, so it only stores a timestamp unless a boost has to start.
     */
    fun onActivity() {
        if (mode != RefreshRateMode.AUTO || supportedRates.size < 2) return
        boostUntil = SystemClock.uptimeMillis() + IDLE_MS
        if (boosted) return
        boosted = true
        startBoost()
        handler.postDelayed(idleCheck, IDLE_MS)
    }

    private fun checkIdle() {
        val remaining = boostUntil - SystemClock.uptimeMillis()
        if (remaining > 0) {
            handler.postDelayed(idleCheck, remaining)
            return
        }
        endBoost()
    }

    private fun startBoost() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            voteHigh()
            return
        }
        val target = current?.let { RefreshRatePolicy.highest(modes, it) } ?: return
        setWindowMode(target.id, target.refreshRate)
    }

    private fun endBoost() {
        handler.removeCallbacks(idleCheck)
        if (!boosted) return
        boosted = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            clearVotes()
            return
        }
        applyWindow()
    }

    @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
    private fun voteHigh() {
        val content = activity.findViewById<View>(android.R.id.content)
        listOfNotNull(content, activeWebView()).forEach { view ->
            view.requestedFrameRate = View.REQUESTED_FRAME_RATE_CATEGORY_HIGH
            votedViews += view
        }
    }

    @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
    private fun clearVotes() {
        votedViews.forEach { it.requestedFrameRate = View.REQUESTED_FRAME_RATE_CATEGORY_DEFAULT }
        votedViews.clear()
    }

    private fun display(): Display? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) activity.display else displays?.getDisplay(Display.DEFAULT_DISPLAY)

    /** Refreshes [modes], [supportedRates] and [currentRate]; returns whether the set of modes changed. */
    private fun readDisplay(): Boolean {
        val display = display() ?: return false
        val next = display.supportedModes.map { it.toSpec() }
        val active = display.mode.toSpec()
        currentRate = display.refreshRate.roundToInt()
        val changed = next != modes || active.width != current?.width || active.height != current?.height
        modes = next
        current = active
        supportedRates = RefreshRatePolicy.supportedRates(next, active)
        return changed
    }

    private fun applyWindow() {
        val active = current ?: return
        val id = RefreshRatePolicy.preferredModeId(mode, modes, active)
        setWindowMode(id, modes.firstOrNull { it.id == id }?.refreshRate ?: 0f)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            activity.window.setFrameRateBoostOnTouchEnabled(mode != RefreshRateMode.STANDARD)
            activity.window.setFrameRatePowerSavingsBalanced(mode != RefreshRateMode.HIGH)
        }
    }

    private fun setWindowMode(id: Int, rate: Float) {
        val window = activity.window
        val attrs = window.attributes
        if (attrs.preferredDisplayModeId == id) return
        attrs.preferredDisplayModeId = id
        attrs.preferredRefreshRate = if (id == 0) 0f else rate
        window.attributes = attrs
    }

    override fun onDisplayChanged(displayId: Int) {
        if (displayId != display()?.displayId) return
        if (readDisplay() && !boosted) applyWindow()
    }

    override fun onDisplayAdded(displayId: Int) = Unit

    override fun onDisplayRemoved(displayId: Int) = Unit

    private fun Display.Mode.toSpec() = DisplayModeSpec(modeId, physicalWidth, physicalHeight, refreshRate)

    companion object {
        /** How long the fast rate is kept after the last touch or scroll step (covers the end of a fling). */
        const val IDLE_MS = 1200L
    }
}
