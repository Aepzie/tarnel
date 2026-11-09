package org.velabrowser.vela.adblock

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentBlockerTest {
    private val blocker = HostListBlocker()

    @Test
    fun blocksThirdPartyTrackers() {
        assertTrue(blocker.shouldBlock("https://www.googletagmanager.com/gtm.js?id=1", "https://example.com/", RequestKind.SCRIPT))
        assertTrue(blocker.shouldBlock("https://securepubads.g.doubleclick.net/tag/js/gpt.js", "https://news.example/", RequestKind.SCRIPT))
    }

    @Test
    fun neverBlocksDocumentsOrFirstParty() {
        assertFalse(blocker.shouldBlock("https://doubleclick.net/", null, RequestKind.DOCUMENT))
        assertFalse(blocker.shouldBlock("https://static.criteo.net/x.js", "https://www.criteo.net/", RequestKind.SCRIPT))
        assertFalse(blocker.shouldBlock("https://upload.wikimedia.org/a.png", "https://en.wikipedia.org/", RequestKind.IMAGE))
    }

    @Test
    fun doesNotMatchLookalikeHosts() {
        assertFalse(blocker.shouldBlock("https://notdoubleclick.net/a.js", "https://example.com/", RequestKind.SCRIPT))
    }

    @Test
    fun cosmeticCssHidesAdSlots() {
        assertTrue(blocker.cosmeticCss("https://example.com/").contains("adsbygoogle"))
    }

    @Test
    fun infersResourceKinds() {
        assertEquals(RequestKind.DOCUMENT, RequestKind.infer("https://a.com/", true, null))
        assertEquals(RequestKind.SCRIPT, RequestKind.infer("https://a.com/app.js?v=2", false, "*/*"))
        assertEquals(RequestKind.STYLESHEET, RequestKind.infer("https://a.com/x", false, "text/css,*/*;q=0.1"))
        assertEquals(RequestKind.IMAGE, RequestKind.infer("https://a.com/x", false, "image/avif,image/webp,*/*"))
        assertEquals(RequestKind.SUBDOCUMENT, RequestKind.infer("https://a.com/frame", false, "text/html,application/xhtml+xml"))
        assertEquals(RequestKind.FONT, RequestKind.infer("https://a.com/f.woff2", false, "*/*"))
        assertEquals(RequestKind.MEDIA, RequestKind.infer("https://a.com/v.m3u8", false, "*/*"))
        assertEquals(RequestKind.SCRIPT, RequestKind.infer("https://a.com/x", false, "*/*", "script"))
        assertEquals(RequestKind.OTHER, RequestKind.infer("https://a.com/beacon", false, "*/*"))
    }
}
