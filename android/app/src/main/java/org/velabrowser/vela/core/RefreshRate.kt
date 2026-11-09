package org.velabrowser.vela.core

import kotlin.math.abs
import kotlin.math.roundToInt

/** Settings → Display → Refresh rate. */
enum class RefreshRateMode(val label: String, val summary: String) {
    AUTO("Auto", "Android decides. Vela asks for the fastest rate while you scroll or something animates."),
    HIGH("High", "Always the fastest rate this screen supports. Smoothest, uses more battery."),
    STANDARD("Standard", "60 Hz. Saves battery."),
}

/** A display mode as reported by `Display.getSupportedModes()` (physical size, refresh rate). */
data class DisplayModeSpec(val id: Int, val width: Int, val height: Int, val refreshRate: Float)

/** Pure mode selection, kept free of Android types so it can be unit-tested on the JVM. */
object RefreshRatePolicy {
    const val STANDARD_HZ = 60f

    /** Only modes with the current resolution: switching between them is seamless, unlike a resolution change. */
    fun candidates(modes: List<DisplayModeSpec>, current: DisplayModeSpec): List<DisplayModeSpec> =
        modes.filter { it.width == current.width && it.height == current.height }.ifEmpty { listOf(current) }

    fun highest(modes: List<DisplayModeSpec>, current: DisplayModeSpec): DisplayModeSpec =
        candidates(modes, current).maxBy { it.refreshRate }

    /** The mode closest to 60 Hz, preferring one at or above it (a 48 Hz mode would judder). */
    fun standard(modes: List<DisplayModeSpec>, current: DisplayModeSpec): DisplayModeSpec {
        val options = candidates(modes, current)
        return options.filter { it.refreshRate >= STANDARD_HZ - 1f }.minByOrNull { it.refreshRate }
            ?: options.minBy { abs(it.refreshRate - STANDARD_HZ) }
    }

    /**
     * The `preferredDisplayModeId` to request for [mode] (0 = no preference, the system decides).
     * Nothing is pinned on single-rate screens, where there is nothing to choose.
     */
    fun preferredModeId(mode: RefreshRateMode, modes: List<DisplayModeSpec>, current: DisplayModeSpec): Int {
        if (supportedRates(modes, current).size < 2) return 0
        return when (mode) {
            RefreshRateMode.AUTO -> 0
            RefreshRateMode.HIGH -> highest(modes, current).id
            RefreshRateMode.STANDARD -> standard(modes, current).id
        }
    }

    /** Distinct whole-Hz rates of the current resolution, ascending (e.g. 60, 90, 120). */
    fun supportedRates(modes: List<DisplayModeSpec>, current: DisplayModeSpec): List<Int> =
        candidates(modes, current).map { it.refreshRate.roundToInt() }.distinct().sorted()
}
