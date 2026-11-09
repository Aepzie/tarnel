package org.velabrowser.vela.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlInputTest {
    private val ddg = SearchEngine.DUCKDUCKGO

    private fun resolve(text: String, httpsOnly: Boolean = true) = UrlInput.resolve(text, ddg, httpsOnly)

    @Test
    fun bareHostBecomesHttps() {
        assertEquals(UrlInput.Resolved.Url("https://wikipedia.org"), resolve("wikipedia.org"))
        assertEquals(UrlInput.Resolved.Url("https://en.wikipedia.org/wiki/Sail"), resolve("en.wikipedia.org/wiki/Sail"))
    }

    @Test
    fun localHostsStayHttp() {
        assertEquals(UrlInput.Resolved.Url("http://localhost:3000"), resolve("localhost:3000"))
        assertEquals(UrlInput.Resolved.Url("http://192.168.1.1/admin"), resolve("192.168.1.1/admin"))
    }

    @Test
    fun explicitHttpIsUpgradedWhenHttpsOnly() {
        assertEquals(UrlInput.Resolved.Url("https://example.com/a?b=1"), resolve("http://example.com/a?b=1"))
        assertEquals(UrlInput.Resolved.Url("http://example.com/"), resolve("http://example.com/", httpsOnly = false))
        assertEquals(UrlInput.Resolved.Url("http://10.0.0.2/"), resolve("http://10.0.0.2/"))
    }

    @Test
    fun wordsAreSearches() {
        val result = resolve("vela browser android")
        assertTrue(result is UrlInput.Resolved.Search)
        assertEquals("https://duckduckgo.com/?q=vela%20browser%20android", result!!.url)
        assertTrue(resolve("hello") is UrlInput.Resolved.Search)
    }

    @Test
    fun dangerousSchemesAreRejected() {
        assertNull(resolve("javascript:alert(1)"))
        assertNull(resolve("file:///sdcard/secret"))
        assertNull(resolve("data:text/html,hi"))
        assertNull(resolve("   "))
    }

    @Test
    fun searchQueryRoundTrip() {
        val url = SearchEngine.GOOGLE.searchUrl("a&b c")
        assertEquals("a&b c", UrlInput.searchQueryOf(url, SearchEngine.GOOGLE))
        assertEquals("q x", UrlInput.searchQueryOf(SearchEngine.STARTPAGE.searchUrl("q x"), SearchEngine.STARTPAGE))
        assertNull(UrlInput.searchQueryOf("https://example.com/?q=1", SearchEngine.GOOGLE))
    }

    @Test
    fun displayHostStripsWww() {
        assertEquals("github.com", UrlInput.displayHost("https://www.github.com/Aepzie/vela"))
        assertEquals("wikipedia.org", UrlInput.displayHost("https://m.wikipedia.org/"))
    }

    @Test
    fun siteOfHandlesTwoLevelTlds() {
        assertEquals("bbc.co.uk", UrlInput.siteOf("news.bbc.co.uk"))
        assertEquals("google.com", UrlInput.siteOf("www.google.com"))
    }

    @Test
    fun userAgentIsReduced() {
        val raw = "Mozilla/5.0 (Linux; Android 16; sdk_gphone64_x86_64 Build/BP22.250124.010; wv) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Version/4.0 Chrome/133.0.6943.137 Mobile Safari/537.36"
        assertEquals(
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36",
            UserAgent.clean(raw),
        )
    }

    @Test
    fun monogramUsesTheSiteNameNotSubdomains() {
        assertEquals("W", UrlInput.monogram("en.wikipedia.org"))
        assertEquals("W", UrlInput.monogram("en.m.wikipedia.org"))
        assertEquals("Y", UrlInput.monogram("m.youtube.com"))
        assertEquals("G", UrlInput.monogram("www.github.com"))
        assertEquals("B", UrlInput.monogram("news.bbc.co.uk"))
        assertEquals("H", UrlInput.monogram("news.ycombinator.com", "Hacker News"))
        assertEquals("•", UrlInput.monogram(null))
        assertEquals("wikipedia", UrlInput.siteName("en.wikipedia.org"))
    }

    @Test
    fun desktopUserAgentDropsMobileMarkers() {
        val mobile = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36"
        assertEquals(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            UserAgent.desktop(mobile),
        )
    }
}
