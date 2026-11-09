package org.velabrowser.vela.adblock

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class RealListsTest {
    private val engine: AdblockEngine by lazy { AdblockEngine.parse(RealLists.requireAll()) }

    private val blocked = listOf(
        Triple("https://securepubads.g.doubleclick.net/tag/js/gpt.js", "https://www.cnn.com/", ResourceType.SCRIPT),
        Triple("https://ad.doubleclick.net/ddm/adj/N123/B456;sz=300x250", "https://www.cnn.com/", ResourceType.SCRIPT),
        Triple("https://stats.g.doubleclick.net/g/collect?v=2", "https://www.example.com/", ResourceType.PING),
        Triple("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", "https://blog.example.com/", ResourceType.SCRIPT),
        Triple("https://tpc.googlesyndication.com/simgad/123456", "https://blog.example.com/", ResourceType.IMAGE),
        Triple("https://www.google-analytics.com/analytics.js", "https://www.example.com/", ResourceType.SCRIPT),
        Triple("https://www.google-analytics.com/collect?v=1&tid=UA-1", "https://www.example.com/", ResourceType.PING),
        Triple("https://www.googletagmanager.com/gtag/js?id=G-XXXX", "https://www.example.com/", ResourceType.SCRIPT),
        Triple("https://connect.facebook.net/en_US/fbevents.js", "https://shop.example.com/", ResourceType.SCRIPT),
        Triple("https://static.criteo.net/js/ld/publishertag.js", "https://news.example.com/", ResourceType.SCRIPT),
        Triple("https://c.amazon-adsystem.com/aax2/apstag.js", "https://news.example.com/", ResourceType.SCRIPT),
        Triple("https://sb.scorecardresearch.com/beacon.js", "https://news.example.com/", ResourceType.SCRIPT),
    )

    private val allowed = listOf(
        Triple("https://en.wikipedia.org/wiki/Main_Page", null, ResourceType.DOCUMENT),
        Triple("https://www.youtube.com/", null, ResourceType.DOCUMENT),
        Triple("https://www.youtube.com/watch?v=dQw4w9WgXcQ", null, ResourceType.DOCUMENT),
        Triple("https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg", "https://en.wikipedia.org/wiki/Example", ResourceType.IMAGE),
        Triple("https://en.wikipedia.org/w/load.php?lang=en&modules=startup&only=scripts", "https://en.wikipedia.org/wiki/Example", ResourceType.SCRIPT),
        Triple("https://www.google.com/search?q=kotlin", null, ResourceType.DOCUMENT),
        Triple("https://github.com/Aepzie/vela", null, ResourceType.DOCUMENT),
        Triple("https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js", "https://www.example.com/", ResourceType.SCRIPT),
        Triple("https://fonts.gstatic.com/s/inter/v13/abc.woff2", "https://www.example.com/", ResourceType.FONT),
        Triple("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", "https://www.youtube.com/", ResourceType.IMAGE),
    )

    @Test
    fun wellKnownAdsAndTrackersAreBlocked() {
        for ((url, doc, type) in blocked) assertTrue(engine.shouldBlock(url, doc, type), "should block $url")
    }

    @Test
    fun normalPagesAreNotBlocked() {
        for ((url, doc, type) in allowed) assertFalse(engine.shouldBlock(url, doc, type), "should allow $url")
    }

    @Test
    fun cosmeticCssIsProduced() {
        val css = engine.cosmeticCss("https://www.example.com/")
        assertNotNull(css)
        assertTrue(css.length > 10_000)
        assertTrue(css.contains("{display:none!important}"))
    }

    @Test
    fun snapshotRoundTripMatchesOnRealLists() {
        val restored = AdblockEngine.deserialize(engine.serialize())
        assertEquals(engine.stats, restored.stats)
        for ((url, doc, type) in blocked + allowed) {
            assertEquals(engine.shouldBlock(url, doc, type), restored.shouldBlock(url, doc, type), url)
        }
        for (doc in listOf("https://www.example.com/", "https://www.youtube.com/", "https://www.cnn.com/")) {
            assertEquals(engine.cosmeticCss(doc), restored.cosmeticCss(doc), doc)
        }
    }
}
