package org.velabrowser.vela.adblock

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

class FilterListsTest {
    @Test
    fun everyRequestKindMapsToAResourceType() {
        RequestKind.entries.forEach { kind -> assertEquals(kind.name, kind.toResourceType().name) }
    }

    @Test
    fun rejectsPortalPagesAndTinyBodies() {
        val list = "[Adblock Plus 2.0]\n! Title: test\n" + (1..200).joinToString("\n") { "||ads$it.example^" }
        assertTrue(FilterLists.looksLikeFilterList(list))
        assertFalse(FilterLists.looksLikeFilterList("<!doctype html><html>" + "x".repeat(5000)))
        assertFalse(FilterLists.looksLikeFilterList("||ads.example^"))
    }

    @Test
    fun engineBlocksThroughTheAdapter() {
        val engine = AdblockEngine.parse(listOf("||doubleclick.net^\n##.ad-banner\n@@||example.com/allowed.js"))
        val blocker = EngineContentBlocker(engine)
        assertTrue(blocker.shouldBlock("https://ad.doubleclick.net/x.js", "https://news.example.org/", RequestKind.SCRIPT))
        assertFalse(blocker.shouldBlock("https://example.com/allowed.js", "https://news.example.org/", RequestKind.SCRIPT))
        assertTrue(blocker.cosmeticCss("https://news.example.org/").orEmpty().contains(".ad-banner"))
    }

    /**
     * Snapshot load time with the real lists: `-Pvela.adblockLists=<dir with easylist.txt, easyprivacy.txt,
     * peterlowe.txt>`. Prints parse, serialize and deserialize timings (cold = first call in this JVM).
     */
    @Test
    fun snapshotDeserializeTiming() {
        val dir = System.getProperty("vela.adblockLists").orEmpty()
        assumeTrue("real lists not provided", dir.isNotEmpty())
        val texts = listOf("easylist.txt", "easyprivacy.txt", "peterlowe.txt").map { File(dir, it) }.filter { it.isFile }.map { it.readText() }
        var started = System.nanoTime()
        val parsed = AdblockEngine.parse(texts)
        val parseMs = (System.nanoTime() - started) / 1e6
        started = System.nanoTime()
        val bytes = parsed.serialize()
        val serializeMs = (System.nanoTime() - started) / 1e6
        val runs = (0 until 8).map {
            val t = System.nanoTime()
            val engine = AdblockEngine.deserialize(bytes)
            val ms = (System.nanoTime() - t) / 1e6
            assertEquals(parsed.filterCount(), engine.filterCount())
            ms
        }
        println(
            "adblock snapshot: ${parsed.filterCount()} filters, ${"%.2f".format(java.util.Locale.ROOT, bytes.size / 1048576.0)} MiB; " +
                "parse ${"%.0f".format(java.util.Locale.ROOT, parseMs)} ms, serialize ${"%.0f".format(java.util.Locale.ROOT, serializeMs)} ms, " +
                "deserialize cold ${"%.1f".format(java.util.Locale.ROOT, runs.first())} ms, warm median ${"%.1f".format(java.util.Locale.ROOT, runs.drop(1).sorted()[3])} ms",
        )
    }
}
