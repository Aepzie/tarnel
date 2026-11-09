package org.velabrowser.vela.browser

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class BlobDownloadsTest {
    @Test
    fun decodesBase64DataUrls() {
        val (mime, bytes) = BlobDownloads.decodeDataUrl("data:text/plain;base64,VmVsYQ==")
        assertEquals("text/plain", mime)
        assertEquals("Vela", String(bytes))
    }

    @Test
    fun decodesPercentEncodedDataUrls() {
        val (mime, bytes) = BlobDownloads.decodeDataUrl("data:text/csv;charset=utf-8,a%2Cb%0A1+2")
        assertEquals("text/csv", mime)
        assertEquals("a,b\n1+2", String(bytes))
    }

    @Test
    fun plainDataUrlHasNoMime() {
        assertEquals(null, BlobDownloads.decodeDataUrl("data:,hi").first)
    }
}
