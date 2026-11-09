package org.velabrowser.vela.adblock

import android.content.Context

/**
 * The blocker used from the first page load on: the small built-in host list. [FilterLists] swaps in the
 * filter-list engine (`:adblock`) as soon as its snapshot is loaded or the lists are downloaded.
 */
object ContentBlockers {
    fun builtIn(@Suppress("UNUSED_PARAMETER") context: Context): ContentBlocker = HostListBlocker()
}
