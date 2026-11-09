package org.velabrowser.vela.adblock

/** Hashing + character classes shared by the filter compiler and the matcher. */
internal object Hashing {
    /** Seed for URL tokens (alphanumeric runs). */
    const val TOKEN_SEED: Int = -2128831035

    /** Seed for hostnames (request host suffixes, cosmetic domains). */
    const val HOST_SEED: Int = 0x1b873593

    /** Seed for document (initiator) hostnames, used to index `$domain=`-only filters. */
    const val DOC_SEED: Int = 0x5bd1e995

    /** FNV-1a over `s[start, end)`, never returns 0 (0 marks empty slots / the "always" bucket). */
    fun hash(s: CharSequence, start: Int, end: Int, seed: Int): Int {
        var h = seed
        for (i in start until end) h = (h xor s[i].code) * 16777619
        h = h xor (h ushr 16)
        return if (h == 0) 1 else h
    }

    fun hash(s: String, seed: Int): Int = hash(s, 0, s.length, seed)

    fun isTokenChar(c: Char): Boolean = (c in 'a'..'z') || (c in '0'..'9') || c == '%'

    /** ABP `^`: anything but a letter, digit, or one of `_ - . %`. */
    fun isSeparator(c: Char): Boolean =
        !((c in 'a'..'z') || (c in '0'..'9') || (c in 'A'..'Z') || c == '_' || c == '-' || c == '.' || c == '%')

    fun isHostChar(c: Char): Boolean = (c in 'a'..'z') || (c in '0'..'9') || c == '.' || c == '-' || c == '_'
}

/** A lowercased URL with the host located. */
internal class ParsedUrl(val url: String, val hostStart: Int, val hostEnd: Int) {
    val host: String = url.substring(hostStart, hostEnd)
}

internal object Urls {
    fun lowerAscii(s: String): String {
        var i = 0
        while (i < s.length) {
            if (s[i] in 'A'..'Z') break
            i++
        }
        if (i == s.length) return s
        val chars = s.toCharArray()
        while (i < chars.size) {
            val c = chars[i]
            if (c in 'A'..'Z') chars[i] = c + 32
            i++
        }
        return String(chars)
    }

    /** Returns null for URLs without an authority (data:, blob:, about:, javascript:, ...). */
    fun parse(raw: String): ParsedUrl? {
        val url = lowerAscii(raw)
        val schemeEnd = url.indexOf("://")
        if (schemeEnd <= 0) return null
        var authStart = schemeEnd + 3
        var authEnd = url.length
        for (i in authStart until url.length) {
            val c = url[i]
            if (c == '/' || c == '?' || c == '#') {
                authEnd = i
                break
            }
        }
        val at = url.lastIndexOf('@', authEnd - 1)
        if (at >= authStart) authStart = at + 1
        var hostEnd = authEnd
        if (authStart < authEnd && url[authStart] == '[') {
            val close = url.indexOf(']', authStart)
            if (close in authStart until authEnd) hostEnd = close + 1
        } else {
            val colon = url.indexOf(':', authStart)
            if (colon in authStart until authEnd) hostEnd = colon
        }
        if (hostEnd > authStart && url[hostEnd - 1] == '.') hostEnd--
        if (hostEnd <= authStart) return null
        return ParsedUrl(url, authStart, hostEnd)
    }
}

/**
 * Public Suffix List lookup backed by an embedded snapshot (ICANN + PRIVATE sections, ~10k rules,
 * ~150 KB resource, ~1 MB heap once loaded lazily on first third-party / entity check).
 */
internal object PublicSuffixList {
    /** Rules are stored as 64-bit hashes so lookups need no substring allocation. */
    private class Rules(val exact: LongHashSet, val wildcard: LongHashSet, val exception: LongHashSet)

    private val rules: Rules by lazy(LazyThreadSafetyMode.PUBLICATION) { load() }

    private fun load(): Rules {
        val exact = LongHashSet(16384)
        val wildcard = LongHashSet(128)
        val exception = LongHashSet(32)
        val stream = PublicSuffixList::class.java.getResourceAsStream("public_suffix_list.txt")
            ?: return Rules(exact, wildcard, exception)
        stream.bufferedReader(Charsets.UTF_8).useLines { lines ->
            for (line in lines) {
                if (line.isEmpty() || line.startsWith("//")) continue
                when {
                    line.startsWith("!") -> exception.add(hash64(line, 1, line.length))
                    line.startsWith("*.") -> wildcard.add(hash64(line, 2, line.length))
                    else -> exact.add(hash64(line, 0, line.length))
                }
            }
        }
        return Rules(exact, wildcard, exception)
    }

    private fun hash64(s: String, start: Int, end: Int): Long {
        var h = -0x340d631b7bdddcdbL
        for (i in start until end) h = (h xor s[i].code.toLong()) * 0x100000001b3L
        return if (h == 0L) 1L else h
    }

    /** Index where the registrable domain (eTLD+1) of [host] starts; 0 for IPs and bare suffixes. */
    fun registrableStart(host: String): Int {
        val ps = publicSuffixStart(host)
        if (ps <= 1) return 0
        return host.lastIndexOf('.', ps - 2) + 1
    }

    /** Whether two hosts share a registrable domain ("same site"). */
    fun sameSite(a: String, b: String): Boolean {
        if (a == b) return true
        val sa = registrableStart(a)
        val sb = registrableStart(b)
        val len = a.length - sa
        return len == b.length - sb && a.regionMatches(sa, b, sb, len)
    }

    fun isIpAddress(host: String): Boolean {
        if (host.isEmpty()) return false
        if (host[0] == '[' || host.indexOf(':') >= 0) return true
        for (c in host) if (c != '.' && c !in '0'..'9') return false
        return true
    }

    /** Index where the public suffix of [host] starts (0 if the host itself is a suffix), -1 for IPs. */
    fun publicSuffixStart(host: String): Int {
        if (host.isEmpty() || isIpAddress(host)) return -1
        val r = rules
        val end = host.length
        var start = 0
        while (true) {
            val suffix = hash64(host, start, end)
            if (r.exception.contains(suffix)) return host.indexOf('.', start) + 1
            if (r.exact.contains(suffix)) return start
            val dot = host.indexOf('.', start)
            if (dot < 0) return start
            if (r.wildcard.contains(hash64(host, dot + 1, end))) return start
            start = dot + 1
        }
    }

    /** eTLD+1 ("registrable domain"); the host itself for IPs and bare public suffixes. */
    fun registrableDomain(host: String): String {
        val start = registrableStart(host)
        return if (start == 0) host else host.substring(start)
    }
}

/** Minimal open-addressing set of non-zero longs. */
internal class LongHashSet(expected: Int) {
    private var table = LongArray(capacityFor(expected))
    private var size = 0

    fun add(value: Long) {
        if ((size + 1) * 2 > table.size) grow()
        if (insert(table, value)) size++
    }

    fun contains(value: Long): Boolean {
        val t = table
        val mask = t.size - 1
        var i = mix(value) and mask
        while (true) {
            val v = t[i]
            if (v == value) return true
            if (v == 0L) return false
            i = (i + 1) and mask
        }
    }

    private fun grow() {
        val old = table
        table = LongArray(old.size * 2)
        for (v in old) if (v != 0L) insert(table, v)
    }

    companion object {
        private fun capacityFor(n: Int): Int {
            var cap = 16
            while (cap < n * 2) cap = cap shl 1
            return cap
        }

        private fun mix(v: Long): Int {
            val h = v * -0x61c8864680b583ebL
            return (h xor (h ushr 32)).toInt()
        }

        private fun insert(t: LongArray, value: Long): Boolean {
            val mask = t.size - 1
            var i = mix(value) and mask
            while (true) {
                val v = t[i]
                if (v == value) return false
                if (v == 0L) {
                    t[i] = value
                    return true
                }
                i = (i + 1) and mask
            }
        }
    }
}

internal object Domains {
    /** `host` equals `domain` or is a subdomain of it; `domain` may be an entity (`google.*`). */
    fun matches(host: String, domain: String): Boolean {
        val dl = domain.length
        if (dl > 2 && domain[dl - 1] == '*' && domain[dl - 2] == '.') return entityMatches(host, domain, dl - 2)
        return isSameOrSubdomain(host, host.length, domain, dl)
    }

    fun isSameOrSubdomain(host: String, domain: String): Boolean =
        isSameOrSubdomain(host, host.length, domain, domain.length)

    private fun isSameOrSubdomain(host: String, hostEnd: Int, domain: String, dl: Int): Boolean {
        if (hostEnd == dl) return host.regionMatches(0, domain, 0, dl)
        if (hostEnd > dl && host[hostEnd - dl - 1] == '.') return host.regionMatches(hostEnd - dl, domain, 0, dl)
        return false
    }

    private fun entityMatches(host: String, domain: String, baseLen: Int): Boolean {
        val ps = PublicSuffixList.publicSuffixStart(host)
        if (ps <= 1) return false
        return isSameOrSubdomain(host, ps - 1, domain, baseLen)
    }

    fun matchesAny(host: String, domains: Array<String>): Boolean {
        for (d in domains) if (matches(host, d)) return true
        return false
    }

    /**
     * Index keys under which rules for [host] may be stored: every label suffix of the host
     * (`a.b.example.com`, `b.example.com`, `example.com`, `com`) and its entity forms (`example.*`).
     */
    fun hostKeys(host: String, seed: Int = Hashing.HOST_SEED): IntArray {
        val keys = ArrayList<Int>(8)
        var i = 0
        while (true) {
            keys.add(Hashing.hash(host, i, host.length, seed))
            val dot = host.indexOf('.', i)
            if (dot < 0) break
            i = dot + 1
        }
        val ps = PublicSuffixList.publicSuffixStart(host)
        if (ps > 1) {
            val base = host.substring(0, ps - 1)
            var j = 0
            while (true) {
                keys.add(Hashing.hash(base.substring(j) + ".*", seed))
                val dot = base.indexOf('.', j)
                if (dot < 0) break
                j = dot + 1
            }
        }
        return keys.toIntArray()
    }
}

/** ABP glob matching: `*` = any run, `^` = separator or end of URL. */
internal object Glob {
    fun matches(p: String, s: String, from: Int, leadingStar: Boolean, anchoredEnd: Boolean): Boolean {
        if (leadingStar && p.isNotEmpty()) {
            val first = p[0]
            if (first != '*' && first != '^') {
                // Unanchored: jump between occurrences of the first literal (String.indexOf is intrinsified).
                var i = s.indexOf(first, from)
                while (i >= 0) {
                    if (matchAt(p, s, i, anchoredEnd)) return true
                    i = s.indexOf(first, i + 1)
                }
                return false
            }
        }
        return glob(p, 0, s, from, leadingStar, anchoredEnd)
    }

    private fun matchAt(p: String, s: String, from: Int, anchoredEnd: Boolean): Boolean {
        val pl = p.length
        val sl = s.length
        var j = 0
        var i = from
        while (j < pl) {
            val pc = p[j]
            if (pc == '*') return glob(p, j, s, i, false, anchoredEnd)
            if (i == sl) break
            val sc = s[i]
            if (pc != sc && !(pc == '^' && Hashing.isSeparator(sc))) return false
            i++
            j++
        }
        if (j == pl) return !anchoredEnd || i == sl
        while (j < pl && (p[j] == '^' || p[j] == '*')) j++
        return j == pl
    }

    private fun glob(p: String, pStart: Int, s: String, from: Int, leadingStar: Boolean, anchoredEnd: Boolean): Boolean {
        val pl = p.length
        val sl = s.length
        var i = from
        var j = pStart
        var starJ = if (leadingStar) pStart else -1
        var starI = from
        while (true) {
            if (j == pl && (!anchoredEnd || i == sl)) return true
            if (i == sl) break
            if (j < pl) {
                val pc = p[j]
                if (pc == '*') {
                    starJ = j + 1
                    starI = i
                    j++
                    continue
                }
                val sc = s[i]
                if (pc == sc || (pc == '^' && Hashing.isSeparator(sc))) {
                    i++
                    j++
                    continue
                }
            }
            if (starJ < 0) return false
            starI++
            i = starI
            j = starJ
        }
        while (j < pl && (p[j] == '*' || p[j] == '^')) j++
        return j == pl
    }
}
