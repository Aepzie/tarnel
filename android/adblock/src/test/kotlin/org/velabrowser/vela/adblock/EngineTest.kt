package org.velabrowser.vela.adblock

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class EngineTest {
    private fun engine(vararg lines: String) = AdblockEngine.parse(listOf(lines.joinToString("\n")))

    private val page = "https://news.example.org/article"

    private fun AdblockEngine.blocks(url: String, doc: String? = page, type: ResourceType = ResourceType.SCRIPT) =
        shouldBlock(url, doc, type)

    // ------------------------------------------------------------ pattern syntax

    @Test
    fun hostAnchorMatchesDomainAndSubdomains() {
        val e = engine("||ads.com^")
        assertTrue(e.blocks("https://ads.com/x.js"))
        assertTrue(e.blocks("https://cdn.ads.com/x.js"))
        assertTrue(e.blocks("http://ads.com"))
        assertTrue(e.blocks("https://ads.com:8443/x"))
        assertFalse(e.blocks("https://notads.com/x.js"))
        assertFalse(e.blocks("https://ads.com.evil.net/x.js"))
        assertFalse(e.blocks("https://example.com/?u=ads.com"))
    }

    @Test
    fun hostAnchorWithPath() {
        val e = engine("||example.com/ads/*.js")
        assertTrue(e.blocks("https://example.com/ads/banner.js"))
        assertTrue(e.blocks("https://www.example.com/ads/x/y.js"))
        assertFalse(e.blocks("https://example.com/content/banner.js"))
        assertFalse(e.blocks("https://other.com/example.com/ads/a.js"))
    }

    @Test
    fun hostAnchorPartialLabel() {
        val e = engine("||adserv")
        assertTrue(e.blocks("https://adserver.net/a"))
        assertTrue(e.blocks("https://x.adservice.org/a"))
        assertFalse(e.blocks("https://myadserver.net/a"))
    }

    @Test
    fun separatorAndWildcard() {
        val e = engine("/banner/*/img^")
        assertTrue(e.blocks("https://site.com/banner/foo/img?x=1"))
        assertTrue(e.blocks("https://site.com/banner/foo/bar/img"))
        assertFalse(e.blocks("https://site.com/banner/foo/imgx"))
        assertFalse(e.blocks("https://site.com/banner/img_x"))
    }

    @Test
    fun separatorDoesNotMatchTokenChars() {
        val e = engine("||track.net^foo")
        assertTrue(e.blocks("https://track.net/foo"))
        assertFalse(e.blocks("https://track.net.foo"))
    }

    @Test
    fun leftAndRightAnchors() {
        val e = engine("|https://start.com/", "swf|")
        assertTrue(e.blocks("https://start.com/a"))
        assertFalse(e.blocks("https://x.com/?r=https://start.com/"))
        assertTrue(e.blocks("https://x.com/movie.swf"))
        assertFalse(e.blocks("https://x.com/movie.swf?x"))
    }

    @Test
    fun plainSubstring() {
        val e = engine("-ad-banner-")
        assertTrue(e.blocks("https://x.com/img/top-ad-banner-1.png", type = ResourceType.IMAGE))
        assertFalse(e.blocks("https://x.com/img/top-adbanner.png", type = ResourceType.IMAGE))
    }

    @Test
    fun matchingIsCaseInsensitive() {
        val e = engine("/AdFrame.")
        assertTrue(e.blocks("https://X.com/ADFRAME.html"))
    }

    @Test
    fun regexFilters() {
        val e = engine("/^https?:\\/\\/[a-z]{8,}\\.com\\/[0-9]{5}\\//", "/\\/pixel\\/[0-9]+\\.gif/\$image")
        assertTrue(e.blocks("https://abcdefghij.com/12345/x"))
        assertFalse(e.blocks("https://abc.com/12345/x"))
        assertTrue(e.blocks("https://t.com/pixel/42.gif", type = ResourceType.IMAGE))
        assertFalse(e.blocks("https://t.com/pixel/42.gif", type = ResourceType.SCRIPT))
        assertEquals(2, e.stats.regexFilters)
    }

    @Test
    fun invalidRegexIsCountedUnsupported() {
        val e = engine("/ab(c/")
        assertEquals(0, e.stats.blockFilters)
        assertEquals(1, e.stats.unsupportedOther)
    }

    @Test
    fun regexTokenExtraction() {
        assertTrue(ListCompiler.regexTokens("\\/pixel\\/[0-9]+").isNotEmpty())
        assertTrue(ListCompiler.regexTokens("^https?:\\/\\/a|b").isEmpty())
        assertTrue(ListCompiler.regexTokens("(\\/ads\\/)?x").isEmpty())
        assertTrue(ListCompiler.regexTokens("\\/ads?\\/").isEmpty())
    }

    @Test
    fun globAgreesWithReferenceRegex() {
        val rnd = kotlin.random.Random(7)
        fun reference(p: String, anchoredStart: Boolean, anchoredEnd: Boolean): java.util.regex.Pattern {
            val sb = StringBuilder()
            for (c in p) when (c) {
                '*' -> sb.append(".*")
                '^' -> sb.append("(?:[^a-zA-Z0-9_\\-.%]|$)")
                else -> sb.append(java.util.regex.Pattern.quote(c.toString()))
            }
            if (anchoredEnd) sb.append("$")
            return java.util.regex.Pattern.compile((if (anchoredStart) "^" else "") + sb)
        }
        repeat(20_000) {
            val p = buildString { repeat(1 + rnd.nextInt(5)) { append("ab/*^"[rnd.nextInt(5)]) } }.trim('*')
            if (p.isEmpty()) return@repeat
            val s = buildString { repeat(rnd.nextInt(9)) { append("ab/."[rnd.nextInt(4)]) } }
            for (leadingStar in listOf(true, false)) for (anchoredEnd in listOf(true, false)) {
                val expected = reference(p, !leadingStar, anchoredEnd).matcher(s).find()
                assertEquals(expected, Glob.matches(p, s, 0, leadingStar, anchoredEnd), "p=$p s=$s lead=$leadingStar end=$anchoredEnd")
            }
        }
    }

    @Test
    fun nonNetworkUrlsAreNeverBlocked() {
        val e = engine("*\$image", "data:")
        assertFalse(e.blocks("data:image/png;base64,AAAA", type = ResourceType.IMAGE))
        assertFalse(e.blocks("blob:https://x.com/uuid", type = ResourceType.IMAGE))
    }

    // ------------------------------------------------------------ options

    @Test
    fun resourceTypeOptions() {
        val e = engine("||cdn.com/a\$script", "||cdn.com/b\$image,stylesheet", "||cdn.com/c\$~image", "||cdn.com/d\$xmlhttprequest,websocket,ping,font,media,subdocument,other")
        assertTrue(e.blocks("https://cdn.com/a.js", type = ResourceType.SCRIPT))
        assertFalse(e.blocks("https://cdn.com/a.js", type = ResourceType.IMAGE))
        assertTrue(e.blocks("https://cdn.com/b.png", type = ResourceType.IMAGE))
        assertTrue(e.blocks("https://cdn.com/b.css", type = ResourceType.STYLESHEET))
        assertFalse(e.blocks("https://cdn.com/b.js", type = ResourceType.SCRIPT))
        assertTrue(e.blocks("https://cdn.com/c.js", type = ResourceType.SCRIPT))
        assertFalse(e.blocks("https://cdn.com/c.png", type = ResourceType.IMAGE))
        for (t in listOf(ResourceType.XHR, ResourceType.WEBSOCKET, ResourceType.PING, ResourceType.FONT,
            ResourceType.MEDIA, ResourceType.SUBDOCUMENT, ResourceType.OTHER)) {
            assertTrue(e.blocks("https://cdn.com/d", type = t), t.name)
        }
        assertFalse(e.blocks("https://cdn.com/d", type = ResourceType.SCRIPT))
    }

    @Test
    fun documentOnlyBlockedWhenExplicit() {
        val e = engine("||tracker.com^", "||evil.com^\$document")
        assertFalse(e.shouldBlock("https://tracker.com/", null, ResourceType.DOCUMENT))
        assertTrue(e.shouldBlock("https://tracker.com/", page, ResourceType.SUBDOCUMENT))
        assertTrue(e.shouldBlock("https://evil.com/", null, ResourceType.DOCUMENT))
    }

    @Test
    fun thirdPartyOption() {
        val e = engine("||widgets.com^\$third-party", "||selfhost.com/track\$~third-party")
        assertTrue(e.blocks("https://widgets.com/w.js", "https://blog.org/"))
        assertFalse(e.blocks("https://widgets.com/w.js", "https://widgets.com/home"))
        assertFalse(e.blocks("https://api.widgets.com/w.js", "https://www.widgets.com/"))
        assertTrue(e.blocks("https://selfhost.com/track", "https://selfhost.com/"))
        assertTrue(e.blocks("https://selfhost.com/track", "https://www.selfhost.com/"))
        assertFalse(e.blocks("https://selfhost.com/track", "https://other.com/"))
    }

    @Test
    fun thirdPartyUsesPublicSuffixList() {
        val e = engine("||tracker.co.uk^\$third-party", "||github.io^\$third-party")
        assertFalse(e.blocks("https://cdn.tracker.co.uk/t.js", "https://www.tracker.co.uk/"))
        assertTrue(e.blocks("https://cdn.tracker.co.uk/t.js", "https://shop.co.uk/"))
        assertTrue(e.blocks("https://alice.github.io/x.js", "https://bob.github.io/"))
        assertFalse(e.blocks("https://alice.github.io/x.js", "https://alice.github.io/page"))
    }

    @Test
    fun publicSuffixList() {
        assertEquals("example.co.uk", PublicSuffixList.registrableDomain("a.b.example.co.uk"))
        assertEquals("example.com", PublicSuffixList.registrableDomain("www.example.com"))
        assertEquals("alice.github.io", PublicSuffixList.registrableDomain("x.alice.github.io"))
        assertEquals("co.uk", PublicSuffixList.registrableDomain("co.uk"))
        assertEquals("192.168.1.1", PublicSuffixList.registrableDomain("192.168.1.1"))
        assertEquals("foo.unknowntld", PublicSuffixList.registrableDomain("a.foo.unknowntld"))
        assertEquals("www.ck", PublicSuffixList.registrableDomain("a.www.ck"))
        assertEquals("b.something.ck", PublicSuffixList.registrableDomain("a.b.something.ck"))
    }

    @Test
    fun domainOption() {
        val e = engine("/sponsor.js\$domain=a.com|b.org|~sub.b.org", "/promo.js\$domain=~safe.com")
        assertTrue(e.blocks("https://cdn.net/sponsor.js", "https://a.com/"))
        assertTrue(e.blocks("https://cdn.net/sponsor.js", "https://www.b.org/"))
        assertFalse(e.blocks("https://cdn.net/sponsor.js", "https://sub.b.org/"))
        assertFalse(e.blocks("https://cdn.net/sponsor.js", "https://c.com/"))
        assertTrue(e.blocks("https://cdn.net/promo.js", "https://c.com/"))
        assertFalse(e.blocks("https://cdn.net/promo.js", "https://safe.com/"))
    }

    @Test
    fun entityDomains() {
        val e = engine("/ad.js\$domain=google.*")
        assertTrue(e.blocks("https://x.net/ad.js", "https://www.google.co.uk/"))
        assertTrue(e.blocks("https://x.net/ad.js", "https://google.de/"))
        assertFalse(e.blocks("https://x.net/ad.js", "https://notgoogle.de/"))
    }

    @Test
    fun exceptionsOverrideBlocks() {
        val e = engine("||ads.com^", "@@||ads.com/allowed/")
        assertTrue(e.blocks("https://ads.com/blocked.js"))
        assertFalse(e.blocks("https://ads.com/allowed/ok.js"))
    }

    @Test
    fun importantBeatsExceptions() {
        val e = engine("||ads.com^\$important", "@@||ads.com^", "||other.com^", "@@||other.com^")
        assertTrue(e.blocks("https://ads.com/x.js"))
        assertFalse(e.blocks("https://other.com/x.js"))
        assertEquals(1, e.stats.importantFilters)
    }

    @Test
    fun documentExceptionAllowlistsWholePage() {
        val e = engine("||ads.com^", "@@||trusted.org^\$document", "##.ad")
        assertTrue(e.blocks("https://ads.com/x.js", "https://news.org/"))
        assertFalse(e.blocks("https://ads.com/x.js", "https://trusted.org/page"))
        assertNull(e.cosmeticCss("https://trusted.org/page"))
        assertNotNull(e.cosmeticCss("https://news.org/"))
    }

    @Test
    fun badfilterDisablesFilter() {
        val e = engine("||ads.com^\$script", "||ads.com^\$script,badfilter", "||keep.com^")
        assertFalse(e.blocks("https://ads.com/x.js"))
        assertTrue(e.blocks("https://keep.com/x.js"))
        assertEquals(2, e.stats.badFiltered)
    }

    @Test
    fun unsupportedNetworkOptionsAreCountedAndDropped() {
        val e = engine(
            "||ads.com^\$script,redirect=noopjs",
            "||ads.com^\$removeparam=utm_source",
            "||ads.com^\$csp=script-src 'none'",
            "||ads.com^\$popup",
            "||ads.com^\$unknownoption",
        )
        assertFalse(e.blocks("https://ads.com/x.js"))
        assertEquals(2, e.stats.unsupportedRedirects)
        assertEquals(3, e.stats.unsupportedOther)
        assertEquals(0, e.stats.blockFilters)
    }

    @Test
    fun hostsFileFormat() {
        val e = AdblockEngine.parse(listOf("# comment\n127.0.0.1 localhost\n0.0.0.0 tracker.io\n0.0.0.0 a.net b.net # trailing\n::1 ip6-localhost"))
        assertTrue(e.blocks("https://tracker.io/p"))
        assertTrue(e.blocks("https://sub.tracker.io/p"))
        assertTrue(e.blocks("https://a.net/x"))
        assertTrue(e.blocks("https://b.net/x"))
        assertFalse(e.blocks("http://localhost/x"))
        assertEquals(3, e.stats.blockFilters)
        assertEquals(0, e.stats.genericCosmeticFilters)
    }

    @Test
    fun duplicatesAcrossListsAreDropped() {
        val e = AdblockEngine.parse(listOf("||dup.com^", "0.0.0.0 dup.com"))
        assertEquals(1, e.stats.blockFilters)
        assertEquals(1, e.stats.duplicates)
    }

    @Test
    fun commentsAndHeadersIgnored() {
        val e = engine("[Adblock Plus 2.0]", "! Title: test", "", "   ")
        assertEquals(0, e.stats.networkFilters + e.stats.cosmeticFilters + e.stats.unsupported)
    }

    // ------------------------------------------------------------ cosmetic

    @Test
    fun genericAndSpecificCosmetics() {
        val e = engine("##.ad-banner", "###sponsored", "example.com##.promo", "other.com##.x")
        val css = e.cosmeticCss("https://www.example.com/page")!!
        assertTrue(css.contains(".ad-banner"))
        assertTrue(css.contains("#sponsored"))
        assertTrue(css.contains(".promo"))
        assertFalse(css.contains(".x{") || css.contains(",.x"))
        assertTrue(css.endsWith("{display:none!important}\n"))
        val other = e.cosmeticCss("https://other.com/")!!
        assertTrue(other.contains(".x"))
        assertFalse(other.contains(".promo"))
    }

    @Test
    fun cosmeticExceptions() {
        val e = engine("##.ad", "##.banner", "example.com##.promo", "example.com#@#.ad", "sub.example.com#@#.promo", "#@#.banner")
        val css = e.cosmeticCss("https://example.com/")!!
        assertFalse(css.contains(".ad"))
        assertTrue(css.contains(".promo"))
        assertFalse(css.contains(".banner"))
        assertNull(e.cosmeticCss("https://sub.example.com/"))
        assertTrue(e.cosmeticCss("https://elsewhere.net/")!!.contains(".ad"))
    }

    @Test
    fun cosmeticNegatedDomains() {
        val e = engine("example.com,~shop.example.com##.ad", "~nope.com##.gen")
        assertTrue(e.cosmeticCss("https://example.com/")!!.contains(".ad"))
        assertNull(e.cosmeticCss("https://shop.example.com/")?.takeIf { it.contains(".ad") })
        assertTrue(e.cosmeticCss("https://x.org/")!!.contains(".gen"))
        assertNull(e.cosmeticCss("https://nope.com/"))
    }

    @Test
    fun cosmeticEntityDomains() {
        val e = engine("google.*##.ads")
        assertTrue(e.cosmeticCss("https://www.google.co.uk/search")!!.contains(".ads"))
        assertTrue(e.cosmeticCss("https://google.de/")!!.contains(".ads"))
        assertNull(e.cosmeticCss("https://example.com/"))
    }

    @Test
    fun elemhideAndGenerichide() {
        val e = engine("##.gen", "site.com##.spec", "@@||quiet.com^\$elemhide", "@@||site.com^\$generichide")
        assertNull(e.cosmeticCss("https://quiet.com/"))
        val css = e.cosmeticCss("https://site.com/")!!
        assertTrue(css.contains(".spec"))
        assertFalse(css.contains(".gen"))
        assertFalse(e.shouldBlock("https://site.com/", null, ResourceType.DOCUMENT))
    }

    @Test
    fun unsupportedCosmeticsAreCounted() {
        val e = engine(
            "example.com##+js(set-constant, foo, true)",
            "example.com##div:has-text(Sponsored)",
            "example.com#?#div:-abp-has(.ad)",
            "example.com#\$#abort-on-property-read foo",
            "example.com##^script:has-text(ad)",
            "example.com##.ad:style(opacity: 0 !important)",
            "example.com##div:has(> .ad)",
            "example.com##a{color:red}",
        )
        assertEquals(2, e.stats.unsupportedScriptlets)
        assertEquals(4, e.stats.unsupportedProcedural)
        assertEquals(1, e.stats.unsupportedOther)
        assertEquals(1, e.stats.specificCosmeticFilters)
        assertTrue(e.cosmeticCss("https://example.com/")!!.contains("div:has(> .ad)"))
    }

    @Test
    fun cssIsGroupedSoInvalidSelectorsOnlyBreakTheirGroup() {
        val lines = (1..45).map { "##.sel$it" }.toTypedArray()
        val css = engine(*lines).cosmeticCss("https://x.com/")!!
        assertEquals(3, css.split("{display:none!important}").size - 1)
    }

    // ------------------------------------------------------------ snapshot

    @Test
    fun serializeRoundTripIsEquivalent() {
        val e = engine(
            "||ads.com^", "@@||ads.com/ok^", "||imp.com^\$important", "@@||imp.com^", "/\\/px\\/[0-9]+/\$image",
            "/sponsor.js\$domain=a.com|~b.a.com", "||w.com^\$third-party,script", "##.ad", "x.com##.y",
            "~z.com##.gen", "x.com#@#.ad", "@@||t.org^\$document", "0.0.0.0 hosts.net",
        )
        val bytes = e.serialize()
        val d = AdblockEngine.deserialize(bytes)
        assertEquals(e.stats, d.stats)
        val cases = listOf(
            Triple("https://ads.com/a.js", page, ResourceType.SCRIPT),
            Triple("https://ads.com/ok/a.js", page, ResourceType.SCRIPT),
            Triple("https://imp.com/a.js", page, ResourceType.SCRIPT),
            Triple("https://h.net/px/12", page, ResourceType.IMAGE),
            Triple("https://h.net/px/12", page, ResourceType.SCRIPT),
            Triple("https://c.net/sponsor.js", "https://a.com/", ResourceType.SCRIPT),
            Triple("https://c.net/sponsor.js", "https://b.a.com/", ResourceType.SCRIPT),
            Triple("https://w.com/w.js", "https://q.com/", ResourceType.SCRIPT),
            Triple("https://w.com/w.js", "https://w.com/", ResourceType.SCRIPT),
            Triple("https://ads.com/a.js", "https://t.org/", ResourceType.SCRIPT),
            Triple("https://hosts.net/a.js", page, ResourceType.SCRIPT),
        )
        for ((url, doc, type) in cases) assertEquals(e.shouldBlock(url, doc, type), d.shouldBlock(url, doc, type), url)
        for (doc in listOf("https://x.com/", "https://z.com/", "https://t.org/", "https://q.com/")) {
            assertEquals(e.cosmeticCss(doc), d.cosmeticCss(doc), doc)
        }
        assertTrue(bytes.contentEquals(d.serialize()))
    }

    @Test
    fun deserializeRejectsGarbage() {
        val ex = runCatching { AdblockEngine.deserialize(byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8)) }.exceptionOrNull()
        assertTrue(ex is IllegalArgumentException)
    }

    @Test
    fun defaultListsExposeUrls() {
        assertTrue(DefaultLists.urls.size >= 2)
        assertTrue(DefaultLists.urls.all { it.startsWith("https://") })
    }
}
