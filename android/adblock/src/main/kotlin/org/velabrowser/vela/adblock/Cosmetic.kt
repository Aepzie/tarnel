package org.velabrowser.vela.adblock

/** A domain-scoped cosmetic rule (or a generic one with only `~domain` exclusions). */
internal class CosmeticRule(
    val selector: String,
    val include: Array<String>?,
    val exclude: Array<String>?,
)

/** Compiled element-hiding rules. */
internal class CosmeticFilters(
    /** Sorted, global `#@#` exceptions already removed. */
    val generic: Array<String>,
    val genericExcluded: Array<CosmeticRule>,
    val specific: Array<CosmeticRule>,
    val exceptions: Array<CosmeticRule>,
) {
    private val specificIndex: FilterIndex = indexByDomain(specific)
    private val exceptionIndex: FilterIndex = indexByDomain(exceptions)

    private val genericChunks: Array<String> by lazy(LazyThreadSafetyMode.PUBLICATION) {
        Array((generic.size + GROUP_SIZE - 1) / GROUP_SIZE) { chunk ->
            val from = chunk * GROUP_SIZE
            toCss(generic.asList().subList(from, minOf(from + GROUP_SIZE, generic.size)))
        }
    }

    private val genericCss: String by lazy(LazyThreadSafetyMode.PUBLICATION) { genericChunks.joinToString("") }

    private fun genericCssWithout(excepted: Set<String>): String {
        val affected = HashSet<Int>()
        for (sel in excepted) {
            val i = generic.binarySearch(sel)
            if (i >= 0) affected.add(i / GROUP_SIZE)
        }
        if (affected.isEmpty()) return genericCss
        val chunks = genericChunks
        val sb = StringBuilder(genericCss.length)
        for ((n, chunk) in chunks.withIndex()) {
            if (n !in affected) {
                sb.append(chunk)
                continue
            }
            val from = n * GROUP_SIZE
            sb.append(toCss(generic.asList().subList(from, minOf(from + GROUP_SIZE, generic.size)).filter { it !in excepted }))
        }
        return sb.toString()
    }

    fun css(host: String, allowGeneric: Boolean): String? {
        val keys = Domains.hostKeys(host)
        var excepted: HashSet<String>? = null
        forEachRule(exceptionIndex, exceptions, keys) { rule ->
            if (rule.include != null && Domains.matchesAny(host, rule.include)) {
                (excepted ?: HashSet<String>().also { excepted = it }).add(rule.selector)
            }
        }
        val exc = excepted
        val selected = LinkedHashSet<String>()
        forEachRule(specificIndex, specific, keys) { rule ->
            if (rule.include != null && Domains.matchesAny(host, rule.include) &&
                (rule.exclude == null || !Domains.matchesAny(host, rule.exclude)) &&
                (exc == null || rule.selector !in exc)
            ) selected.add(rule.selector)
        }
        var genericPart = ""
        if (allowGeneric) {
            for (rule in genericExcluded) {
                if ((rule.exclude == null || !Domains.matchesAny(host, rule.exclude)) &&
                    (exc == null || rule.selector !in exc)
                ) selected.add(rule.selector)
            }
            genericPart = if (exc == null) genericCss else genericCssWithout(exc)
        }
        if (selected.isEmpty() && genericPart.isEmpty()) return null
        if (selected.isEmpty()) return genericPart
        return toCss(selected) + genericPart
    }

    private inline fun forEachRule(index: FilterIndex, rules: Array<CosmeticRule>, keys: IntArray, fn: (CosmeticRule) -> Unit) {
        for (key in keys) {
            val s = index.slot(key)
            if (s < 0) continue
            for (p in index.start(s) until index.end(s)) fn(rules[index.ids[p]])
        }
    }

    companion object {
        /** Selectors per CSS rule: an invalid selector only takes its own group down with it. */
        const val GROUP_SIZE = 20
        private const val DECLARATION = "{display:none!important}\n"

        fun toCss(selectors: Collection<String>): String {
            if (selectors.isEmpty()) return ""
            val sb = StringBuilder(selectors.size * 32)
            var n = 0
            for (sel in selectors) {
                if (n > 0) sb.append(',')
                sb.append(sel)
                n++
                if (n == GROUP_SIZE) {
                    sb.append(DECLARATION)
                    n = 0
                }
            }
            if (n > 0) sb.append(DECLARATION)
            return sb.toString()
        }

        private fun indexByDomain(rules: Array<CosmeticRule>): FilterIndex {
            val entries = ArrayList<Long>()
            for ((id, rule) in rules.withIndex()) {
                val include = rule.include ?: continue
                val seen = HashSet<Int>()
                for (d in include) {
                    val key = Hashing.hash(d, Hashing.HOST_SEED)
                    if (seen.add(key)) entries.add(FilterIndex.entry(key, id))
                }
            }
            return FilterIndex.build(entries.toLongArray())
        }
    }
}
