package org.velabrowser.vela.adblock

import java.util.concurrent.atomic.AtomicReferenceArray
import org.velabrowser.vela.adblock.NetworkFilter.Companion as F

/**
 * Ad & tracker blocking engine for Adblock Plus / uBlock Origin style filter lists.
 *
 * Immutable after construction and safe to call from any number of threads (WebView's
 * `shouldInterceptRequest` runs on a thread pool).
 *
 * Build once from list text with [parse], persist [serialize] output, and on later starts load it
 * with [deserialize] (much faster than re-parsing).
 */
class AdblockEngine internal constructor(
    private val filters: Array<NetworkFilter>,
    private val filterKeys: IntArray,
    private val cosmetic: CosmeticFilters,
    val stats: EngineStats,
) {
    private val importantIndex: FilterIndex
    private val blockIndex: FilterIndex
    private val exceptionIndex: FilterIndex
    private val hasDocumentKeyed: Boolean

    private val documentCache = AtomicReferenceArray<DocumentInfo?>(DOCUMENT_CACHE_SIZE)

    private class DocumentInfo(val url: String, val host: String, val keys: IntArray, val allowlisted: Boolean)

    init {
        val important = ArrayList<Long>()
        val block = ArrayList<Long>(filters.size + 1024)
        val exception = ArrayList<Long>()
        var documentKeyed = false
        for ((id, f) in filters.withIndex()) {
            val target = when {
                f.isException -> exception
                f.isImportant -> important
                else -> block
            }
            val key = filterKeys[id]
            val include = f.includeDomains
            if (key == 0 && include != null) {
                // No usable URL token but restricted to some sites: index by those sites instead of
                // checking the filter on every request.
                documentKeyed = true
                val seen = HashSet<Int>()
                for (d in include) {
                    val k = Hashing.hash(d, Hashing.DOC_SEED)
                    if (seen.add(k)) target.add(FilterIndex.entry(k, id))
                }
            } else {
                target.add(FilterIndex.entry(key, id))
            }
        }
        importantIndex = FilterIndex.build(important.toLongArray())
        blockIndex = FilterIndex.build(block.toLongArray())
        exceptionIndex = FilterIndex.build(exception.toLongArray())
        hasDocumentKeyed = documentKeyed
    }

    /**
     * Whether a request to [url], made by the page at [documentUrl] (null for top-level navigations),
     * should be blocked. Only http(s)/ws(s) URLs are ever blocked (data:, blob:, about:, ... are not).
     *
     * Following Adblock Plus semantics, top-level [ResourceType.DOCUMENT] loads are only blocked by
     * filters that explicitly carry `$document` (or `$all`).
     */
    fun shouldBlock(url: String, documentUrl: String?, type: ResourceType): Boolean {
        val parsed = Urls.parse(url) ?: return false
        if (!isNetworkScheme(parsed.url)) return false
        val doc = if (documentUrl == null) null else documentInfo(documentUrl)
        val docHost = doc?.host ?: parsed.host
        val req = Request(parsed.url, parsed.hostStart, parsed.hostEnd, parsed.host, docHost, F.typeBit(type))
        val keys = requestKeys(parsed, doc?.keys ?: documentKeys(parsed.host))
        if (importantIndex.size > 0 && firstMatch(importantIndex, req, keys) != null) return true
        if (firstMatch(blockIndex, req, keys) == null) return false
        if (firstMatch(exceptionIndex, req, keys) != null) return false
        if (doc != null && doc.allowlisted) return false
        return true
    }

    /**
     * Element-hiding CSS for the page at [documentUrl]: domain-specific + generic selectors as
     * `sel1,sel2,...{display:none!important}` rules (20 selectors per rule so one selector the
     * WebView does not understand only disables its own group). Null if nothing applies or the page
     * is allowlisted with `$document` / `$elemhide`. `$generichide` drops the generic part.
     */
    fun cosmeticCss(documentUrl: String): String? {
        val parsed = Urls.parse(documentUrl) ?: return null
        if (pageException(parsed, F.ELEMHIDE or F.typeBit(ResourceType.DOCUMENT))) return null
        val allowGeneric = !pageException(parsed, F.GENERICHIDE)
        return cosmetic.css(parsed.host, allowGeneric)
    }

    /** Compact binary snapshot for [deserialize]. */
    fun serialize(): ByteArray = Snapshot.write(filters, filterKeys, cosmetic, stats)

    private fun isNetworkScheme(url: String): Boolean =
        url.startsWith("https://") || url.startsWith("http://") || url.startsWith("wss://") || url.startsWith("ws://")

    private fun documentKeys(host: String): IntArray =
        if (hasDocumentKeyed) Domains.hostKeys(host, Hashing.DOC_SEED) else EMPTY_KEYS

    /** Per-document work (parse, `$document` allowlisting, site keys) is cached in a small hash-slot cache. */
    private fun documentInfo(documentUrl: String): DocumentInfo? {
        val slot = documentUrl.hashCode() and (DOCUMENT_CACHE_SIZE - 1)
        val cached = documentCache.get(slot)
        if (cached != null && cached.url == documentUrl) return cached
        val parsed = Urls.parse(documentUrl) ?: return null
        val info = DocumentInfo(
            documentUrl,
            parsed.host,
            documentKeys(parsed.host),
            pageException(parsed, F.typeBit(ResourceType.DOCUMENT)),
        )
        documentCache.set(slot, info)
        return info
    }

    private fun pageException(parsed: ParsedUrl, typeMask: Int): Boolean {
        if (exceptionIndex.size == 0) return false
        val req = Request(parsed.url, parsed.hostStart, parsed.hostEnd, parsed.host, parsed.host, typeMask)
        return firstMatch(exceptionIndex, req, requestKeys(parsed, documentKeys(parsed.host))) != null
    }

    private fun firstMatch(index: FilterIndex, req: Request, keys: KeyBuffer): NetworkFilter? {
        val ids = index.ids
        val keyArray = keys.keys
        for (k in 0 until keys.size) {
            val s = index.slot(keyArray[k])
            if (s < 0) continue
            for (p in index.start(s) until index.end(s)) {
                val f = filters[ids[p]]
                if (f.matches(req)) return f
            }
        }
        for (p in index.alwaysStart until index.alwaysEnd) {
            val f = filters[ids[p]]
            if (f.matches(req)) return f
        }
        return null
    }

    private class KeyBuffer {
        var keys = IntArray(48)
        var size = 0

        fun add(key: Int) {
            if (size == keys.size) keys = keys.copyOf(size * 2)
            keys[size++] = key
        }
    }

    /** Host suffix hashes + URL token hashes + document-site hashes. */
    private fun requestKeys(parsed: ParsedUrl, docKeys: IntArray): KeyBuffer {
        val buf = KeyBuffer()
        val url = parsed.url
        val hostEnd = parsed.hostEnd
        var i = parsed.hostStart
        while (true) {
            buf.add(Hashing.hash(url, i, hostEnd, Hashing.HOST_SEED))
            val dot = url.indexOf('.', i)
            if (dot < 0 || dot >= hostEnd) break
            i = dot + 1
        }
        val len = url.length
        var j = 0
        while (j < len) {
            if (!Hashing.isTokenChar(url[j])) {
                j++
                continue
            }
            val start = j
            while (j < len && Hashing.isTokenChar(url[j])) j++
            if (j - start >= 2) buf.add(Hashing.hash(url, start, j, Hashing.TOKEN_SEED))
        }
        for (k in docKeys) buf.add(k)
        return buf
    }

    companion object {
        private const val DOCUMENT_CACHE_SIZE = 64
        private val EMPTY_KEYS = IntArray(0)

        /** Compiles raw filter list texts (ABP/uBO syntax and hosts-file format, mixed freely). */
        @JvmStatic
        fun parse(lists: List<String>): AdblockEngine {
            val compiler = ListCompiler()
            for (text in lists) compiler.addList(text)
            return compiler.build()
        }

        /** Loads an engine from [serialize] output. Throws [IllegalArgumentException] on a foreign/old snapshot. */
        @JvmStatic
        fun deserialize(bytes: ByteArray): AdblockEngine =
            try {
                Snapshot.read(bytes)
            } catch (e: IndexOutOfBoundsException) {
                throw IllegalArgumentException("Truncated adblock snapshot", e)
            } catch (e: NegativeArraySizeException) {
                throw IllegalArgumentException("Corrupt adblock snapshot", e)
            }
    }
}
