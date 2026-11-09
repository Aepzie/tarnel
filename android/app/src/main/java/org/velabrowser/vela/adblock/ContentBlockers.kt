package org.velabrowser.vela.adblock

import android.content.Context

/**
 * Creates the app's [ContentBlocker]. This is the single place to swap in the filter-list engine from the
 * `:adblock` module (see android/README.md, "Ad blocking"). Called once, off the main thread.
 */
object ContentBlockers {
    fun create(@Suppress("UNUSED_PARAMETER") context: Context): ContentBlocker = HostListBlocker()
}
