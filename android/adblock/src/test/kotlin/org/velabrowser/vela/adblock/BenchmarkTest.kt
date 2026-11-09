package org.velabrowser.vela.adblock

import kotlin.random.Random
import kotlin.test.Test
import org.junit.jupiter.api.Tag

/**
 * Simple JMH-free benchmark against the real lists. Run with:
 * `./gradlew test -Pbenchmark -PadblockLists=<dir> --tests '*BenchmarkTest*'`
 */
@Tag("benchmark")
class BenchmarkTest {
    @Test
    fun benchmark() {
        val lists = RealLists.requireAll()
        val totalChars = lists.sumOf { it.length }

        val coldParse = timeMs { AdblockEngine.parse(lists) }
        val warmParse = (1..5).map { timeMs { AdblockEngine.parse(lists) } }.sorted()[2]

        val engine = AdblockEngine.parse(lists)
        val snapshot = engine.serialize()
        val serializeMs = (1..5).map { timeMs { engine.serialize() } }.sorted()[2]
        val coldDeser = timeMs { AdblockEngine.deserialize(snapshot) }
        val warmDeser = (1..9).map { timeMs { AdblockEngine.deserialize(snapshot) } }.sorted()[4]

        val requests = syntheticRequests(200_000)
        repeat(3) { for (r in requests) engine.shouldBlock(r.url, r.doc, r.type) }
        val samples = LongArray(requests.size)
        var blockedCount = 0
        val start = System.nanoTime()
        for ((i, r) in requests.withIndex()) {
            val t0 = System.nanoTime()
            if (engine.shouldBlock(r.url, r.doc, r.type)) blockedCount++
            samples[i] = System.nanoTime() - t0
        }
        val totalNs = System.nanoTime() - start
        samples.sort()

        val docs = listOf("https://www.example.com/", "https://www.cnn.com/", "https://www.youtube.com/watch?v=x", "https://www.google.co.uk/search?q=a")
        repeat(20) { for (d in docs) engine.cosmeticCss(d) }
        val cssUs = docs.map { d -> val t0 = System.nanoTime(); repeat(50) { engine.cosmeticCss(d) }; (System.nanoTime() - t0) / 50 / 1000.0 }
        val cssSize = engine.cosmeticCss("https://www.example.com/")!!.length

        val memParsed = retainedBytes { AdblockEngine.parse(lists) }
        val memLoaded = retainedBytes { AdblockEngine.deserialize(snapshot) }

        val s = engine.stats
        println(
            """
            |==== adblock benchmark (${System.getProperty("java.vm.name")} ${System.getProperty("java.version")}) ====
            |input: ${lists.size} lists, ${totalChars / 1024} KiB
            |stats: $s
            |parse:        cold ${fmt(coldParse)} ms, warm median ${fmt(warmParse)} ms
            |serialize:    ${fmt(serializeMs)} ms, snapshot ${snapshot.size / 1024} KiB
            |deserialize:  cold ${fmt(coldDeser)} ms, warm median ${fmt(warmDeser)} ms
            |shouldBlock:  n=${requests.size}, blocked=$blockedCount, median ${fmtNs(samples[samples.size / 2])} us, p90 ${fmtNs(samples[samples.size * 9 / 10])} us, p99 ${fmtNs(samples[samples.size * 99 / 100])} us, mean ${fmtNs(totalNs / requests.size)} us
            |cosmeticCss:  ${cssUs.joinToString { fmt(it) }} us per call, generic css ${cssSize / 1024} KiB
            |memory:       parsed engine ${memParsed / (1024 * 1024)} MiB, deserialized engine ${memLoaded / (1024 * 1024)} MiB (retained heap; shared PSL tables not included)
            """.trimMargin(),
        )
    }

    private class Req(val url: String, val doc: String?, val type: ResourceType)

    private fun syntheticRequests(n: Int): List<Req> {
        val rnd = Random(42)
        val pages = listOf(
            "https://www.cnn.com/2024/world/story", "https://en.wikipedia.org/wiki/Kotlin", "https://www.youtube.com/watch?v=abc",
            "https://news.ycombinator.com/item?id=1", "https://www.reddit.com/r/android/", "https://www.nytimes.com/section/tech",
            "https://shop.example.co.uk/cart", "https://blog.example.com/post/1",
        )
        val hosts = listOf(
            "securepubads.g.doubleclick.net", "pagead2.googlesyndication.com", "www.google-analytics.com", "www.googletagmanager.com",
            "connect.facebook.net", "static.criteo.net", "c.amazon-adsystem.com", "cdn.jsdelivr.net", "ajax.googleapis.com",
            "fonts.gstatic.com", "upload.wikimedia.org", "i.ytimg.com", "www.cnn.com", "cdn.cnn.com", "static01.nyt.com",
            "www.redditstatic.com", "i.redd.it", "images.example.com", "api.example.com", "cdn.shopify.com",
            "unpkg.com", "s.yimg.com", "sb.scorecardresearch.com", "player.vimeo.com", "js.stripe.com",
        )
        val paths = listOf(
            "/js/app.min.js", "/static/css/main.css", "/images/hero.jpg", "/api/v1/items", "/gtag/js", "/pagead/js/adsbygoogle.js",
            "/collect", "/tag/js/gpt.js", "/ads/banner_300x250.png", "/wp-content/uploads/2024/05/photo.webp",
            "/fonts/inter.woff2", "/beacon.js", "/v3/track", "/media/video.mp4", "/libs/jquery/3.7.1/jquery.min.js",
        )
        val types = ResourceType.entries.filter { it != ResourceType.DOCUMENT }
        return List(n) {
            val host = hosts[rnd.nextInt(hosts.size)]
            val path = paths[rnd.nextInt(paths.size)]
            val query = if (rnd.nextBoolean()) "?v=${rnd.nextInt(100000)}&cb=${rnd.nextLong().toString(36)}" else ""
            Req("https://$host$path$query", pages[rnd.nextInt(pages.size)], types[rnd.nextInt(types.size)])
        }
    }

    private inline fun timeMs(block: () -> Unit): Double {
        val t0 = System.nanoTime()
        block()
        return (System.nanoTime() - t0) / 1e6
    }

    private fun usedHeap(): Long {
        val rt = Runtime.getRuntime()
        repeat(4) {
            System.gc()
            Thread.sleep(60)
        }
        return rt.totalMemory() - rt.freeMemory()
    }

    private fun retainedBytes(create: () -> AdblockEngine): Long {
        val before = usedHeap()
        val engine = create()
        engine.shouldBlock("https://a.b.co.uk/x", "https://c.com/", ResourceType.SCRIPT)
        val after = usedHeap()
        check(engine.stats.networkFilters > 0)
        return after - before
    }

    private fun fmt(v: Double) = String.format("%.1f", v)
    private fun fmtNs(ns: Long) = String.format("%.2f", ns / 1000.0)
}
