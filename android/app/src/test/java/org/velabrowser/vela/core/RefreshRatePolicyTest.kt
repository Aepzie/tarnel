package org.velabrowser.vela.core

import org.junit.Assert.assertEquals
import org.junit.Test

class RefreshRatePolicyTest {
    private val fhd60 = DisplayModeSpec(1, 1080, 2400, 60f)
    private val fhd90 = DisplayModeSpec(2, 1080, 2400, 90f)
    private val fhd120 = DisplayModeSpec(3, 1080, 2400, 120f)
    private val qhd120 = DisplayModeSpec(4, 1440, 3200, 120f)
    private val qhd144 = DisplayModeSpec(5, 1440, 3200, 144f)
    private val phone = listOf(fhd60, fhd90, fhd120, qhd120, qhd144)

    @Test
    fun highPicksTheFastestModeAtTheCurrentResolution() {
        assertEquals(fhd120.id, RefreshRatePolicy.preferredModeId(RefreshRateMode.HIGH, phone, fhd60))
        assertEquals(qhd144.id, RefreshRatePolicy.preferredModeId(RefreshRateMode.HIGH, phone, qhd120))
    }

    @Test
    fun standardPicksSixtyHertz() {
        assertEquals(fhd60.id, RefreshRatePolicy.preferredModeId(RefreshRateMode.STANDARD, phone, fhd120))
    }

    @Test
    fun standardPrefersTheSlowestModeAtOrAboveSixty() {
        val noSixty = listOf(DisplayModeSpec(1, 1080, 2400, 48f), DisplayModeSpec(2, 1080, 2400, 90f), DisplayModeSpec(3, 1080, 2400, 120f))
        assertEquals(2, RefreshRatePolicy.preferredModeId(RefreshRateMode.STANDARD, noSixty, noSixty[2]))
    }

    @Test
    fun standardFallsBackToTheClosestRate() {
        val slow = listOf(DisplayModeSpec(1, 1080, 2400, 30f), DisplayModeSpec(2, 1080, 2400, 50f))
        assertEquals(2, RefreshRatePolicy.preferredModeId(RefreshRateMode.STANDARD, slow, slow[0]))
    }

    @Test
    fun autoLeavesTheChoiceToTheSystem() {
        assertEquals(0, RefreshRatePolicy.preferredModeId(RefreshRateMode.AUTO, phone, fhd60))
    }

    @Test
    fun singleRateScreensAreNeverPinned() {
        val emulator = listOf(DisplayModeSpec(1, 1080, 2400, 60.000004f))
        RefreshRateMode.entries.forEach { mode -> assertEquals(0, RefreshRatePolicy.preferredModeId(mode, emulator, emulator[0])) }
    }

    @Test
    fun supportedRatesAreWholeHertzOfTheCurrentResolution() {
        assertEquals(listOf(60, 90, 120), RefreshRatePolicy.supportedRates(phone, fhd90))
        assertEquals(listOf(120, 144), RefreshRatePolicy.supportedRates(phone, qhd144))
        assertEquals(listOf(60), RefreshRatePolicy.supportedRates(listOf(DisplayModeSpec(1, 1080, 2400, 59.94f)), DisplayModeSpec(1, 1080, 2400, 59.94f)))
    }

    @Test
    fun unknownCurrentResolutionFallsBackToTheCurrentMode() {
        val odd = DisplayModeSpec(9, 720, 1600, 60f)
        assertEquals(listOf(60), RefreshRatePolicy.supportedRates(phone, odd))
        assertEquals(0, RefreshRatePolicy.preferredModeId(RefreshRateMode.HIGH, phone, odd))
    }
}
