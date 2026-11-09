package org.velabrowser.vela.adblock

import java.util.regex.Pattern

/** A request being evaluated. Third-party status is computed lazily (PSL lookup) only if a filter needs it. */
internal class Request(
    val url: String,
    val hostStart: Int,
    val hostEnd: Int,
    val host: String,
    val docHost: String,
    val typeMask: Int,
) {
    private var party = -1

    fun isThirdParty(): Boolean {
        if (party < 0) {
            party = if (PublicSuffixList.sameSite(host, docHost)) 0 else 1
        }
        return party == 1
    }
}

/**
 * A compiled network filter. [pattern] is the glob body (lowercased, anchors stripped), the remainder
 * after [hostname] for host-anchored filters, or the regex source for regex filters.
 */
internal class NetworkFilter(
    val flags: Int,
    val pattern: String,
    val hostname: String?,
    val includeDomains: Array<String>?,
    val excludeDomains: Array<String>?,
) {
    @Volatile
    private var compiled: Pattern? = null

    val isException: Boolean get() = flags and EXCEPTION != 0
    val isImportant: Boolean get() = flags and IMPORTANT != 0

    fun regex(): Pattern {
        val existing = compiled
        if (existing != null) return existing
        val fresh = Pattern.compile(pattern, Pattern.CASE_INSENSITIVE)
        compiled = fresh
        return fresh
    }

    fun matches(req: Request): Boolean {
        if (flags and req.typeMask == 0) return false
        if (flags and REGEX != 0) {
            return matchesDomains(req) && matchesParty(req) && regex().matcher(req.url).find()
        }
        return matchesPattern(req) && matchesParty(req) && matchesDomains(req)
    }

    private fun matchesParty(req: Request): Boolean {
        val party = flags and PARTY_MASK
        if (party == PARTY_MASK) return true
        return if (req.isThirdParty()) party and THIRD_PARTY != 0 else party and FIRST_PARTY != 0
    }

    private fun matchesDomains(req: Request): Boolean {
        val include = includeDomains
        if (include != null && !Domains.matchesAny(req.docHost, include)) return false
        val exclude = excludeDomains
        if (exclude != null && Domains.matchesAny(req.docHost, exclude)) return false
        return true
    }

    private fun matchesPattern(req: Request): Boolean {
        val f = flags
        val url = req.url
        val anchoredEnd = f and RIGHT_ANCHOR != 0
        if (f and HOSTNAME != 0) {
            if (!Domains.isSameOrSubdomain(req.host, hostname!!)) return false
            return pattern.isEmpty() || Glob.matches(pattern, url, req.hostEnd, false, anchoredEnd)
        }
        if (f and HOST_ANCHOR != 0) {
            var i = req.hostStart
            while (i < req.hostEnd) {
                if (Glob.matches(pattern, url, i, false, anchoredEnd)) return true
                val dot = url.indexOf('.', i)
                if (dot < 0 || dot >= req.hostEnd) break
                i = dot + 1
            }
            return false
        }
        if (f and LEFT_ANCHOR != 0) return Glob.matches(pattern, url, 0, false, anchoredEnd)
        if (pattern.isEmpty()) return true
        return Glob.matches(pattern, url, 0, true, anchoredEnd)
    }

    companion object {
        const val ELEMHIDE = 1 shl 11
        const val GENERICHIDE = 1 shl 12
        const val ALL_TYPES = (1 shl 11) - 1
        val DEFAULT_TYPES = ALL_TYPES and (1 shl ResourceType.DOCUMENT.ordinal).inv()
        const val TYPE_MASK = (1 shl 13) - 1

        const val FIRST_PARTY = 1 shl 13
        const val THIRD_PARTY = 1 shl 14
        const val PARTY_MASK = FIRST_PARTY or THIRD_PARTY

        const val LEFT_ANCHOR = 1 shl 15
        const val HOST_ANCHOR = 1 shl 16
        const val RIGHT_ANCHOR = 1 shl 17
        const val HOSTNAME = 1 shl 18
        const val REGEX = 1 shl 19
        const val EXCEPTION = 1 shl 20
        const val IMPORTANT = 1 shl 21

        fun typeBit(type: ResourceType): Int = 1 shl type.ordinal
    }
}

/**
 * Hash index from key (token hash / host hash) to filter ids, laid out as one open-addressing
 * table plus a CSR id array. Key 0 is the "always" bucket (filters without a usable token).
 */
internal class FilterIndex private constructor(
    private val table: IntArray,
    private val starts: IntArray,
    private val ends: IntArray,
    val ids: IntArray,
    val alwaysStart: Int,
    val alwaysEnd: Int,
) {
    private val mask = table.size - 1

    fun slot(key: Int): Int {
        if (table.isEmpty()) return -1
        var s = mix(key) and mask
        while (true) {
            val k = table[s]
            if (k == key) return s
            if (k == 0) return -1
            s = (s + 1) and mask
        }
    }

    fun start(slot: Int): Int = starts[slot]
    fun end(slot: Int): Int = ends[slot]

    val size: Int get() = ids.size
    val alwaysSize: Int get() = alwaysEnd - alwaysStart

    companion object {
        private fun mix(key: Int): Int {
            var h = key * -0x61c88647
            h = h xor (h ushr 15)
            return h
        }

        /** [entries] = `(key shl 32) or id` pairs. */
        fun build(entries: LongArray): FilterIndex {
            entries.sort()
            val ids = IntArray(entries.size)
            var groups = 0
            var prevKey = 0L
            for ((n, e) in entries.withIndex()) {
                ids[n] = e.toInt()
                val key = e ushr 32
                if (n == 0 || key != prevKey) {
                    if (key != 0L) groups++
                    prevKey = key
                }
            }
            var cap = 1
            while (cap < groups * 2) cap = cap shl 1
            val table = IntArray(if (groups == 0) 0 else cap)
            val starts = IntArray(table.size)
            val ends = IntArray(table.size)
            val mask = table.size - 1
            var alwaysStart = 0
            var alwaysEnd = 0
            var i = 0
            while (i < entries.size) {
                val key = (entries[i] ushr 32).toInt()
                var j = i + 1
                while (j < entries.size && (entries[j] ushr 32).toInt() == key) j++
                if (key == 0) {
                    alwaysStart = i
                    alwaysEnd = j
                } else {
                    var s = mix(key) and mask
                    while (table[s] != 0) s = (s + 1) and mask
                    table[s] = key
                    starts[s] = i
                    ends[s] = j
                }
                i = j
            }
            return FilterIndex(table, starts, ends, ids, alwaysStart, alwaysEnd)
        }

        fun entry(key: Int, id: Int): Long = (key.toLong() shl 32) or (id.toLong() and 0xffffffffL)
    }
}
