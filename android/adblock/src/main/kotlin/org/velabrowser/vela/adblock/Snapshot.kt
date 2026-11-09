package org.velabrowser.vela.adblock

/**
 * Binary snapshot format (little overhead, no reflection):
 * magic "VLAB", version, string pool (domains/hostnames), stats, network filters (+ chosen index key),
 * cosmetic rules. Indices are rebuilt on load from the stored keys (O(n), no tokenization).
 */
internal object Snapshot {
    private const val MAGIC = 0x564c4142
    private const val VERSION = 2

    fun write(filters: Array<NetworkFilter>, keys: IntArray, cosmetic: CosmeticFilters, stats: EngineStats): ByteArray {
        val pool = LinkedHashMap<String, Int>()
        fun ref(s: String) = pool.getOrPut(s) { pool.size }
        for (f in filters) {
            f.hostname?.let(::ref)
            f.includeDomains?.forEach { ref(it) }
            f.excludeDomains?.forEach { ref(it) }
        }
        for (r in cosmetic.genericExcluded) r.exclude?.forEach { ref(it) }
        for (r in cosmetic.specific) {
            r.include?.forEach { ref(it) }
            r.exclude?.forEach { ref(it) }
        }
        for (r in cosmetic.exceptions) r.include?.forEach { ref(it) }
        val repeated = HashMap<String, Int>()
        for (f in filters) repeated[f.pattern] = (repeated[f.pattern] ?: 0) + 1
        for (rules in arrayOf(cosmetic.genericExcluded, cosmetic.specific, cosmetic.exceptions)) {
            for (r in rules) repeated[r.selector] = (repeated[r.selector] ?: 0) + 1
        }
        for ((str, n) in repeated) if (n > 1) ref(str)

        val w = ByteWriter(4 * 1024 * 1024)
        w.int(MAGIC)
        w.int(VERSION)
        w.varint(pool.size)
        for (s in pool.keys) w.string(s)

        with(stats) {
            for (v in intArrayOf(
                blockFilters, exceptionFilters, importantFilters, regexFilters, genericCosmeticFilters,
                specificCosmeticFilters, cosmeticExceptions, badFiltered, duplicates, unsupportedScriptlets,
                unsupportedProcedural, unsupportedRedirects, unsupportedOther,
            )) w.varint(v)
        }

        fun pooled(str: String) {
            val id = pool[str]
            if (id != null) {
                w.varint(id + 1)
            } else {
                w.varint(0)
                w.string(str)
            }
        }

        fun refs(arr: Array<String>?) {
            if (arr == null) {
                w.varint(0)
                return
            }
            w.varint(arr.size + 1)
            for (s in arr) w.varint(pool.getValue(s))
        }

        w.varint(filters.size)
        for ((i, f) in filters.withIndex()) {
            w.varint(f.flags)
            w.int(keys[i])
            pooled(f.pattern)
            w.varint(if (f.hostname == null) 0 else pool.getValue(f.hostname) + 1)
            refs(f.includeDomains)
            refs(f.excludeDomains)
        }

        w.varint(cosmetic.generic.size)
        for (s in cosmetic.generic) w.string(s)
        for (rules in arrayOf(cosmetic.genericExcluded, cosmetic.specific, cosmetic.exceptions)) {
            w.varint(rules.size)
            for (r in rules) {
                pooled(r.selector)
                refs(r.include)
                refs(r.exclude)
            }
        }
        return w.toByteArray()
    }

    fun read(bytes: ByteArray): AdblockEngine {
        val r = ByteReader(bytes)
        require(r.int() == MAGIC) { "Not an adblock snapshot" }
        val version = r.int()
        require(version == VERSION) { "Unsupported adblock snapshot version $version" }
        val pool = Array(r.varint()) { r.string() }

        val stats = EngineStats(
            r.varint(), r.varint(), r.varint(), r.varint(), r.varint(), r.varint(), r.varint(),
            r.varint(), r.varint(), r.varint(), r.varint(), r.varint(), r.varint(),
        )

        fun pooled(): String {
            val id = r.varint()
            return if (id == 0) r.string() else pool[id - 1]
        }

        fun refs(): Array<String>? {
            val n = r.varint()
            if (n == 0) return null
            return Array(n - 1) { pool[r.varint()] }
        }

        val count = r.varint()
        val keys = IntArray(count)
        val filters = Array(count) { i ->
            val flags = r.varint()
            keys[i] = r.int()
            val pattern = pooled()
            val host = r.varint()
            NetworkFilter(flags, pattern, if (host == 0) null else pool[host - 1], refs(), refs())
        }

        val generic = Array(r.varint()) { r.string() }
        val ruleSets = Array(3) {
            Array(r.varint()) { CosmeticRule(pooled(), refs(), refs()) }
        }
        val cosmetic = CosmeticFilters(generic, ruleSets[0], ruleSets[1], ruleSets[2])
        return AdblockEngine(filters, keys, cosmetic, stats)
    }
}

internal class ByteWriter(initial: Int) {
    private var buf = ByteArray(initial)
    private var pos = 0

    private fun ensure(n: Int) {
        if (pos + n <= buf.size) return
        var cap = buf.size * 2
        while (cap < pos + n) cap *= 2
        buf = buf.copyOf(cap)
    }

    fun int(v: Int) {
        ensure(4)
        buf[pos++] = (v ushr 24).toByte()
        buf[pos++] = (v ushr 16).toByte()
        buf[pos++] = (v ushr 8).toByte()
        buf[pos++] = v.toByte()
    }

    fun varint(value: Int) {
        ensure(5)
        var v = value
        while (v and 0x7f.inv() != 0) {
            buf[pos++] = ((v and 0x7f) or 0x80).toByte()
            v = v ushr 7
        }
        buf[pos++] = v.toByte()
    }

    fun string(s: String) {
        val bytes = s.toByteArray(Charsets.UTF_8)
        varint(bytes.size)
        ensure(bytes.size)
        System.arraycopy(bytes, 0, buf, pos, bytes.size)
        pos += bytes.size
    }

    fun toByteArray(): ByteArray = buf.copyOf(pos)
}

internal class ByteReader(private val buf: ByteArray) {
    private var pos = 0

    fun int(): Int {
        val v = ((buf[pos].toInt() and 0xff) shl 24) or ((buf[pos + 1].toInt() and 0xff) shl 16) or
            ((buf[pos + 2].toInt() and 0xff) shl 8) or (buf[pos + 3].toInt() and 0xff)
        pos += 4
        return v
    }

    fun varint(): Int {
        var result = 0
        var shift = 0
        while (true) {
            val b = buf[pos++].toInt()
            result = result or ((b and 0x7f) shl shift)
            if (b and 0x80 == 0) return result
            shift += 7
        }
    }

    fun string(): String {
        val len = varint()
        val s = String(buf, pos, len, Charsets.UTF_8)
        pos += len
        return s
    }
}
