package org.velabrowser.vela.adblock

import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException
import org.velabrowser.vela.adblock.NetworkFilter.Companion as F

/** Parses filter list text into network + cosmetic rules. Single use, not thread-safe. */
internal class ListCompiler {
    private class Pending(val filter: NetworkFilter, val candidates: IntArray, val raw: String)

    private val pending = ArrayList<Pending>(65536)
    private val seenNetwork = HashSet<String>(131072)
    private val badFilters = HashSet<String>()
    private val strings = HashMap<String, String>()

    private val generic = HashSet<String>()
    private val genericExcluded = ArrayList<CosmeticRule>()
    private val specific = ArrayList<CosmeticRule>()
    private val exceptions = ArrayList<CosmeticRule>()
    private val globalExceptions = HashSet<String>()
    private val seenCosmetic = HashSet<String>()

    private var duplicates = 0
    private var scriptlets = 0
    private var procedural = 0
    private var redirects = 0
    private var other = 0

    fun addList(text: String) {
        var start = 0
        val len = text.length
        while (start < len) {
            var end = text.indexOf('\n', start)
            if (end < 0) end = len
            addLine(text.substring(start, end).trim())
            start = end + 1
        }
    }

    fun addLine(line: String) {
        if (line.isEmpty()) return
        val c = line[0]
        if (c == '!' || c == '[') return
        if ((c in '0'..'9' || c == ':') && addHostsLine(line)) return
        val sep = line.indexOf('#')
        if (sep >= 0 && addCosmetic(line, sep)) return
        if (c == '#') return
        addNetwork(line)
    }

    // ---------------------------------------------------------------- hosts

    private fun addHostsLine(line: String): Boolean {
        var ws = 0
        while (ws < line.length && line[ws] != ' ' && line[ws] != '\t') ws++
        if (ws == line.length || line.substring(0, ws) !in HOSTS_IPS) return false
        val rest = line.substring(ws).substringBefore('#').trim()
        for (name in rest.split(' ', '\t')) {
            val host = name.trim().lowercase().trimEnd('.')
            if (host.isEmpty() || host in HOSTS_IGNORED || !host.all(Hashing::isHostChar) || host.indexOf('.') < 0) continue
            addHostFilter(host)
        }
        return true
    }

    private fun addHostFilter(host: String) {
        val raw = "||$host^"
        if (!seenNetwork.add(raw)) {
            duplicates++
            return
        }
        val filter = NetworkFilter(F.DEFAULT_TYPES or F.PARTY_MASK or F.HOSTNAME, "^", host, null, null)
        pending.add(Pending(filter, intArrayOf(Hashing.hash(host, Hashing.HOST_SEED)), raw))
    }

    // ---------------------------------------------------------------- cosmetic

    private fun addCosmetic(line: String, firstHash: Int): Boolean {
        var idx = firstHash
        while (idx >= 0) {
            for ((marker, kind) in COSMETIC_MARKERS) {
                if (line.startsWith(marker, idx)) {
                    handleCosmetic(line.substring(0, idx), line.substring(idx + marker.length).trim(), kind)
                    return true
                }
            }
            idx = line.indexOf('#', idx + 1)
        }
        return false
    }

    private fun handleCosmetic(domainsPart: String, selector: String, kind: Int) {
        when (kind) {
            KIND_EXTENDED -> { procedural++; return }
            KIND_SNIPPET -> { scriptlets++; return }
        }
        if (domainsPart.isEmpty() && (selector.isEmpty() || selector[0] == ' ' || selector.startsWith("# ") || selector.startsWith("##"))) return
        if (selector.startsWith("+js(")) { scriptlets++; return }
        if (selector.startsWith("^")) { procedural++; return }
        if (selector.isEmpty() || selector.indexOf('{') >= 0 || selector.indexOf('}') >= 0) { other++; return }
        if (PROCEDURAL_MARKERS.any { selector.contains(it) }) { procedural++; return }

        val include = ArrayList<String>()
        val exclude = ArrayList<String>()
        if (domainsPart.isNotEmpty() && domainsPart != "*") {
            for (part in domainsPart.split(',')) {
                val entry = part.trim().lowercase()
                if (entry.isEmpty()) continue
                val negated = entry.startsWith("~")
                val domain = if (negated) entry.substring(1) else entry
                if (domain.isEmpty() || domain.indexOf('/') >= 0 || domain.indexOf('[') >= 0) { other++; return }
                (if (negated) exclude else include).add(intern(domain))
            }
        }
        val selectorInterned = intern(selector)
        if (!seenCosmetic.add("$kind|$domainsPart|$selector")) { duplicates++; return }
        if (kind == KIND_EXCEPTION) {
            if (include.isEmpty()) {
                if (exclude.isNotEmpty()) { other++; return }
                globalExceptions.add(selectorInterned)
            } else {
                exceptions.add(CosmeticRule(selectorInterned, include.toTypedArray(), null))
            }
            return
        }
        when {
            include.isEmpty() && exclude.isEmpty() -> generic.add(selectorInterned)
            include.isEmpty() -> genericExcluded.add(CosmeticRule(selectorInterned, null, exclude.toTypedArray()))
            else -> specific.add(
                CosmeticRule(selectorInterned, include.toTypedArray(), exclude.takeIf { it.isNotEmpty() }?.toTypedArray()),
            )
        }
    }

    // ---------------------------------------------------------------- network

    private fun addNetwork(line: String) {
        if (line.length > MAX_FILTER_LENGTH) { other++; return }
        val exception = line.startsWith("@@")
        val body = if (exception) line.substring(2) else line

        var patternPart = body
        var optionsPart: String? = null
        if (body.length > 1 && body[0] == '/') {
            val idx = body.lastIndexOf("/$")
            if (idx > 0) {
                patternPart = body.substring(0, idx + 1)
                optionsPart = body.substring(idx + 2)
            } else if (!body.endsWith("/")) {
                val d = body.lastIndexOf('$')
                if (d >= 0) {
                    patternPart = body.substring(0, d)
                    optionsPart = body.substring(d + 1)
                }
            }
        } else {
            val d = body.lastIndexOf('$')
            if (d >= 0) {
                patternPart = body.substring(0, d)
                optionsPart = body.substring(d + 1)
            }
        }

        var flags = if (exception) F.EXCEPTION else 0
        var typesPos = 0
        var typesNeg = 0
        var party = F.PARTY_MASK
        var include: ArrayList<String>? = null
        var exclude: ArrayList<String>? = null
        var badfilter = false
        var normalizedOptions: String? = optionsPart

        if (optionsPart != null) {
            val kept = ArrayList<String>()
            for (rawOpt in optionsPart.split(',')) {
                val opt = rawOpt.trim()
                if (opt.isEmpty()) continue
                val negated = opt.startsWith("~")
                val eq = opt.indexOf('=')
                val name = (if (eq >= 0) opt.substring(0, eq) else opt).removePrefix("~").lowercase()
                val value = if (eq >= 0) opt.substring(eq + 1) else null
                if (name == "badfilter") {
                    badfilter = true
                    continue
                }
                kept.add(opt)
                val typeBits = TYPE_OPTIONS[name]
                if (typeBits != null) {
                    if (negated) typesNeg = typesNeg or typeBits else typesPos = typesPos or typeBits
                    continue
                }
                when (name) {
                    "third-party", "3p", "strict3p" -> party = if (negated) F.FIRST_PARTY else F.THIRD_PARTY
                    "first-party", "1p", "strict1p" -> party = if (negated) F.THIRD_PARTY else F.FIRST_PARTY
                    "important" -> if (!exception) flags = flags or F.IMPORTANT
                    "match-case", "collapse" -> Unit
                    "elemhide", "ehide" -> typesPos = typesPos or F.ELEMHIDE
                    "generichide", "ghide" -> typesPos = typesPos or F.GENERICHIDE
                    "domain", "from" -> {
                        if (value.isNullOrEmpty()) { other++; return }
                        for (part in value.split('|')) {
                            val entry = part.trim().lowercase()
                            val neg = entry.startsWith("~")
                            val domain = if (neg) entry.substring(1) else entry
                            if (domain.isEmpty()) continue
                            if (domain.indexOf('/') >= 0) { other++; return }
                            if (neg) (exclude ?: ArrayList<String>().also { exclude = it }).add(intern(domain))
                            else (include ?: ArrayList<String>().also { include = it }).add(intern(domain))
                        }
                    }
                    in REDIRECT_OPTIONS -> { redirects++; return }
                    else -> { other++; return }
                }
            }
            normalizedOptions = kept.joinToString(",")
        }

        val raw = buildString {
            if (exception) append("@@")
            append(patternPart)
            if (!normalizedOptions.isNullOrEmpty()) append('$').append(normalizedOptions)
        }
        if (badfilter) {
            badFilters.add(raw)
            return
        }

        flags = flags or party or when {
            typesPos != 0 -> typesPos and typesNeg.inv()
            else -> F.DEFAULT_TYPES and typesNeg.inv()
        }
        if (flags and F.TYPE_MASK == 0) { other++; return }

        val candidates: IntArray
        var pattern: String
        var hostname: String? = null

        if (patternPart.length > 2 && patternPart.startsWith("/") && patternPart.endsWith("/")) {
            pattern = patternPart.substring(1, patternPart.length - 1)
            if (pattern.length > MAX_REGEX_LENGTH) { other++; return }
            try {
                Pattern.compile(pattern, Pattern.CASE_INSENSITIVE)
            } catch (e: PatternSyntaxException) {
                other++
                return
            }
            flags = flags or F.REGEX
            candidates = regexTokens(pattern)
        } else {
            var p = patternPart
            if (p.startsWith("||")) {
                flags = flags or F.HOST_ANCHOR
                p = p.substring(2)
            } else if (p.startsWith("|")) {
                flags = flags or F.LEFT_ANCHOR
                p = p.substring(1)
            }
            if (p.endsWith("|")) {
                flags = flags or F.RIGHT_ANCHOR
                p = p.substring(0, p.length - 1)
            }
            p = p.lowercase()
            if (p.indexOf(' ') >= 0 || p.indexOf('\t') >= 0) { other++; return }
            if (p.startsWith("*")) {
                flags = flags and (F.HOST_ANCHOR or F.LEFT_ANCHOR).inv()
                p = p.trimStart('*')
            }
            if (p.endsWith("*")) {
                flags = flags and F.RIGHT_ANCHOR.inv()
                p = p.trimEnd('*')
            }
            while (p.contains("**")) p = p.replace("**", "*")

            if (flags and F.HOST_ANCHOR != 0) {
                var k = 0
                while (k < p.length && Hashing.isHostChar(p[k])) k++
                if (k > 0 && k < p.length && (p[k] == '^' || p[k] == '/' || p[k] == ':') &&
                    p[0] != '.' && p[k - 1] != '.'
                ) {
                    hostname = intern(p.substring(0, k))
                    p = p.substring(k)
                    flags = (flags and F.HOST_ANCHOR.inv()) or F.HOSTNAME
                }
            }
            pattern = p
            val tokens = globTokens(
                p,
                leftBounded = flags and (F.HOST_ANCHOR or F.LEFT_ANCHOR or F.HOSTNAME) != 0,
                rightBounded = flags and F.RIGHT_ANCHOR != 0,
            )
            candidates = if (hostname != null) intArrayOf(Hashing.hash(hostname, Hashing.HOST_SEED)) + tokens else tokens
        }

        if (!seenNetwork.add(raw)) {
            duplicates++
            return
        }
        val filter = NetworkFilter(
            flags,
            intern(pattern),
            hostname,
            include?.toTypedArray(),
            exclude?.toTypedArray(),
        )
        pending.add(Pending(filter, candidates, raw))
    }

    private fun intern(s: String): String = strings.getOrPut(s) { s }

    // ---------------------------------------------------------------- build

    fun build(): AdblockEngine {
        var badFiltered = 0
        val kept = ArrayList<Pending>(pending.size)
        for (p in pending) {
            if (p.raw in badFilters) badFiltered++ else kept.add(p)
        }
        badFiltered += badFilters.size

        val histogram = HashMap<Int, IntArray>(kept.size * 2)
        for (p in kept) for (key in p.candidates) histogram.getOrPut(key) { IntArray(1) }[0]++

        val filters = arrayOfNulls<NetworkFilter>(kept.size)
        val keys = IntArray(kept.size)
        for ((id, p) in kept.withIndex()) {
            filters[id] = p.filter
            var best = 0
            var bestScore = Long.MAX_VALUE
            for ((n, key) in p.candidates.withIndex()) {
                val penalty = if (key in BAD_TOKENS) 1_000_000L else 0L
                val hostBonus = if (n == 0 && p.filter.hostname != null) 0L else 1L
                val score = histogram[key]!![0] + penalty + hostBonus
                if (score < bestScore) {
                    bestScore = score
                    best = key
                }
            }
            keys[id] = best
        }

        val genericSorted = generic.filter { it !in globalExceptions }.toTypedArray().also { it.sort() }
        val cosmetic = CosmeticFilters(
            genericSorted,
            genericExcluded.filter { it.selector !in globalExceptions }.toTypedArray(),
            specific.filter { it.selector !in globalExceptions }.toTypedArray(),
            exceptions.toTypedArray(),
        )

        @Suppress("UNCHECKED_CAST")
        val all = filters as Array<NetworkFilter>
        val stats = EngineStats(
            blockFilters = all.count { !it.isException },
            exceptionFilters = all.count { it.isException },
            importantFilters = all.count { it.isImportant },
            regexFilters = all.count { it.flags and F.REGEX != 0 },
            genericCosmeticFilters = cosmetic.generic.size + cosmetic.genericExcluded.size,
            specificCosmeticFilters = cosmetic.specific.size,
            cosmeticExceptions = cosmetic.exceptions.size + globalExceptions.size,
            badFiltered = badFiltered,
            duplicates = duplicates,
            unsupportedScriptlets = scriptlets,
            unsupportedProcedural = procedural,
            unsupportedRedirects = redirects,
            unsupportedOther = other,
        )
        return AdblockEngine(all, keys, cosmetic, stats)
    }

    companion object {
        private const val MAX_FILTER_LENGTH = 4096
        private const val MAX_REGEX_LENGTH = 1024

        private const val KIND_HIDE = 0
        private const val KIND_EXCEPTION = 1
        private const val KIND_EXTENDED = 2
        private const val KIND_SNIPPET = 3

        private val COSMETIC_MARKERS = listOf(
            "##" to KIND_HIDE,
            "#@#" to KIND_EXCEPTION,
            "#?#" to KIND_EXTENDED,
            "#@?#" to KIND_EXTENDED,
            "#$#" to KIND_SNIPPET,
            "#@$#" to KIND_SNIPPET,
            "#%#" to KIND_SNIPPET,
            "#@%#" to KIND_SNIPPET,
        )

        private val PROCEDURAL_MARKERS = listOf(
            ":has-text(", ":-abp-", ":xpath(", ":matches-css", ":upward(", ":remove(", ":style(",
            ":min-text-length(", ":watch-attr(", ":watch-attrs(", ":matches-path(", ":matches-attr(",
            ":matches-prop(", ":matches-media(", ":others(", ":if(", ":if-not(", ":nth-ancestor(",
            ":shadow(", ":contains(", ":remove-attr(", ":remove-class(", ":spath(",
        )

        private val HOSTS_IPS = setOf("0.0.0.0", "127.0.0.1", "::", "::1", "0", "255.255.255.255")
        private val HOSTS_IGNORED = setOf(
            "localhost", "localhost.localdomain", "local", "broadcasthost", "ip6-localhost", "ip6-loopback",
            "0.0.0.0",
        )

        private val TYPE_OPTIONS: Map<String, Int> = run {
            fun bit(t: ResourceType) = F.typeBit(t)
            mapOf(
                "script" to bit(ResourceType.SCRIPT),
                "image" to bit(ResourceType.IMAGE),
                "stylesheet" to bit(ResourceType.STYLESHEET),
                "css" to bit(ResourceType.STYLESHEET),
                "xmlhttprequest" to bit(ResourceType.XHR),
                "xhr" to bit(ResourceType.XHR),
                "subdocument" to bit(ResourceType.SUBDOCUMENT),
                "frame" to bit(ResourceType.SUBDOCUMENT),
                "media" to bit(ResourceType.MEDIA),
                "font" to bit(ResourceType.FONT),
                "websocket" to bit(ResourceType.WEBSOCKET),
                "ping" to bit(ResourceType.PING),
                "beacon" to bit(ResourceType.PING),
                "document" to bit(ResourceType.DOCUMENT),
                "doc" to bit(ResourceType.DOCUMENT),
                "other" to bit(ResourceType.OTHER),
                "object" to bit(ResourceType.OTHER),
                "object-subrequest" to bit(ResourceType.OTHER),
                "all" to F.ALL_TYPES,
            )
        }

        private val REDIRECT_OPTIONS = setOf(
            "redirect", "redirect-rule", "rewrite", "removeparam", "queryprune", "empty", "mp4",
        )

        private val BAD_TOKENS: Set<Int> = listOf(
            "http", "https", "www", "com", "net", "org", "html", "htm", "php", "js", "css", "jpg", "jpeg",
            "png", "gif", "svg", "webp", "static", "cdn", "img", "images", "assets", "api", "min", "json",
            "wp", "content", "uploads", "v1", "v2", "id", "src", "utm",
        ).map { Hashing.hash(it, Hashing.TOKEN_SEED) }.toSet()

        /**
         * Tokens (alphanumeric runs) of a glob pattern that are guaranteed to appear as a whole token
         * in any matching URL: bounded on both sides by a literal non-token char, `^`, or an anchor.
         */
        fun globTokens(p: String, leftBounded: Boolean, rightBounded: Boolean): IntArray {
            val out = ArrayList<Int>(4)
            var i = 0
            while (i < p.length) {
                if (!Hashing.isTokenChar(p[i])) {
                    i++
                    continue
                }
                val start = i
                while (i < p.length && Hashing.isTokenChar(p[i])) i++
                val leftOk = if (start == 0) leftBounded else p[start - 1] != '*'
                val rightOk = if (i == p.length) rightBounded else p[i] != '*'
                if (leftOk && rightOk && i - start >= 2) out.add(Hashing.hash(p, start, i, Hashing.TOKEN_SEED))
            }
            return out.toIntArray()
        }

        private const val REGEX_DELIMS = "/=&-_:;,"
        private const val REGEX_ESCAPED_DELIMS = "./?=&-_:;,"
        private const val QUANTIFIERS = "?*{"

        /**
         * Conservative token extraction for regex filters: literal alphanumeric runs at the top level
         * (no alternation anywhere, not inside groups/classes), directly delimited by literal
         * separators that are not optional. Regexes without such a token land in the "always" bucket.
         */
        fun regexTokens(src: String): IntArray {
            if (src.indexOf('|') >= 0) return IntArray(0)
            val s = src.lowercase()
            val out = ArrayList<Int>(2)
            var depth = 0
            var i = 0
            while (i < s.length) {
                val c = s[i]
                when {
                    c == '\\' -> { i += 2; continue }
                    c == '(' || c == '[' -> { depth++; i++; continue }
                    c == ')' || c == ']' -> { depth--; i++; continue }
                }
                if (depth != 0 || !Hashing.isTokenChar(c)) {
                    i++
                    continue
                }
                val start = i
                while (i < s.length && Hashing.isTokenChar(s[i])) i++
                val end = i
                if (end - start < 2) continue
                val leftOk = (start >= 2 && s[start - 2] == '\\' && s[start - 1] in REGEX_ESCAPED_DELIMS &&
                    (start < 3 || s[start - 3] != '\\')) ||
                    (start >= 1 && s[start - 1] in REGEX_DELIMS && (start < 2 || s[start - 2] != '\\'))
                val rightOk = when {
                    end >= s.length -> false
                    s[end] == '\\' -> end + 1 < s.length && s[end + 1] in REGEX_ESCAPED_DELIMS &&
                        (end + 2 >= s.length || s[end + 2] !in QUANTIFIERS)
                    else -> s[end] in REGEX_DELIMS && (end + 1 >= s.length || s[end + 1] !in QUANTIFIERS)
                }
                if (leftOk && rightOk) out.add(Hashing.hash(s, start, end, Hashing.TOKEN_SEED))
            }
            return out.toIntArray()
        }
    }
}
