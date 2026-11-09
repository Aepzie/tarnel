package org.velabrowser.vela.core

import java.net.URI
import java.util.Locale

/** Pure helpers for turning omnibox text into URLs and URLs into display text. No Android dependencies. */
object UrlInput {
    private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:")
    private val HOST_LIKE = Regex("^(localhost|\\[[0-9a-fA-F:]+]|[0-9]{1,3}(\\.[0-9]{1,3}){3}|([a-zA-Z0-9-]+\\.)+[a-zA-Z][a-zA-Z0-9-]*)(:[0-9]{1,5})?([/?#].*)?$")
    private val SAFE_SCHEMES = setOf("http", "https", "about")

    sealed interface Resolved {
        val url: String
        data class Url(override val url: String) : Resolved
        data class Search(override val url: String, val query: String) : Resolved
    }

    /**
     * Resolve raw omnibox text. Returns null for empty input or schemes that must never be typed
     * (javascript:, file:, data:, content:).
     */
    fun resolve(input: String, engine: SearchEngine, httpsOnly: Boolean): Resolved? {
        val text = input.trim()
        if (text.isEmpty()) return null
        if (text.contains(' ') && !SCHEME.containsMatchIn(text)) return Resolved.Search(engine.searchUrl(text), text)

        val schemeMatch = SCHEME.find(text)
        if (schemeMatch != null && !HOST_LIKE.matches(text)) {
            val scheme = schemeMatch.value.dropLast(1).lowercase(Locale.ROOT)
            if (scheme in setOf("javascript", "file", "data", "content", "blob")) return null
            if (scheme in SAFE_SCHEMES) {
                val parsed = runCatching { URI(text) }.getOrNull() ?: return Resolved.Search(engine.searchUrl(text), text)
                if (scheme != "about" && parsed.host.isNullOrEmpty()) return Resolved.Search(engine.searchUrl(text), text)
                return Resolved.Url(if (httpsOnly) upgrade(text) else text)
            }
            return Resolved.Search(engine.searchUrl(text), text)
        }

        if (HOST_LIKE.matches(text)) {
            val host = text.substringBefore('/').substringBefore('?').substringBefore('#').substringBeforeLast(':')
            val local = isLocalHost(host)
            val scheme = if (local) "http" else "https"
            return Resolved.Url("$scheme://$text")
        }
        return Resolved.Search(engine.searchUrl(text), text)
    }

    /** http → https for public hosts; local and private hosts are left alone. */
    fun upgrade(url: String): String {
        if (!url.startsWith("http://", ignoreCase = true)) return url
        val host = hostOf(url) ?: return url
        if (isLocalHost(host)) return url
        return "https://" + url.substring("http://".length)
    }

    fun isLocalHost(host: String): Boolean {
        val h = host.lowercase(Locale.ROOT).trim('[', ']')
        if (h == "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".test")) return true
        if (h == "::1") return true
        val parts = h.split('.')
        if (parts.size != 4 || parts.any { it.toIntOrNull() == null }) return false
        val (a, b) = parts[0].toInt() to parts[1].toInt()
        return a == 10 || a == 127 || (a == 192 && b == 168) || (a == 172 && b in 16..31) || (a == 169 && b == 254)
    }

    fun hostOf(url: String): String? = runCatching { URI(url).host }.getOrNull()?.lowercase(Locale.ROOT)?.trim('[', ']')

    /** "www.example.com" → "example.com", for compact display. */
    fun displayHost(url: String): String {
        val host = hostOf(url) ?: return url
        return host.removePrefix("www.").removePrefix("m.")
    }

    /** Text shown in the omnibox while editing: the full URL, or the query when it is a search results page. */
    fun editText(url: String, engine: SearchEngine): String = searchQueryOf(url, engine) ?: url

    fun searchQueryOf(url: String, engine: SearchEngine): String? {
        val host = hostOf(url) ?: return null
        if (!host.endsWith(engine.host)) return null
        val query = runCatching { URI(url).rawQuery }.getOrNull() ?: return null
        val key = if (engine == SearchEngine.STARTPAGE) "query" else "q"
        return query.split('&').firstNotNullOfOrNull { pair ->
            val (k, v) = pair.split('=', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
            if (k == key) java.net.URLDecoder.decode(v, "UTF-8") else null
        }?.takeIf { it.isNotBlank() }
    }

    /** Registrable-ish domain used to decide whether a request is third-party for the content blocker. */
    fun siteOf(host: String): String {
        val parts = host.split('.')
        if (parts.size <= 2) return host
        val twoLevelTlds = setOf("co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "co.jp", "co.nz", "com.br", "co.in", "co.za", "com.tr", "com.mx")
        val lastTwo = parts.takeLast(2).joinToString(".")
        return if (lastTwo in twoLevelTlds) parts.takeLast(3).joinToString(".") else lastTwo
    }
}
