package org.velabrowser.vela.adblock

import java.util.Locale

/**
 * Seam between the browser and an ad/tracker blocking engine.
 *
 * Called from `WebViewClient.shouldInterceptRequest` on WebView's IO threads, so implementations must be
 * thread-safe and fast (no I/O per call). A blocked request is answered with an empty 204.
 */
interface ContentBlocker {
    /** @param documentUrl URL of the top-level document that issued the request, if known. */
    fun shouldBlock(url: String, documentUrl: String?, kind: RequestKind): Boolean

    /** Element-hiding CSS for a document, injected at page start. Null when there is nothing to hide. */
    fun cosmeticCss(documentUrl: String): String?
}

/** Resource type of a request. WebView does not expose it, so [RequestKind.infer] guesses from headers/URL. */
enum class RequestKind {
    DOCUMENT, SUBDOCUMENT, SCRIPT, STYLESHEET, IMAGE, FONT, MEDIA, XHR, OTHER;

    companion object {
        private val SCRIPT_EXT = setOf("js", "mjs")
        private val IMAGE_EXT = setOf("png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp")
        private val FONT_EXT = setOf("woff", "woff2", "ttf", "otf", "eot")
        private val MEDIA_EXT = setOf("mp4", "webm", "m3u8", "mpd", "mp3", "ogg", "m4a", "m4s", "ts", "aac")

        fun infer(url: String, isMainFrame: Boolean, accept: String?, secFetchDest: String? = null): RequestKind {
            if (isMainFrame) return DOCUMENT
            when (secFetchDest?.lowercase(Locale.ROOT)) {
                "iframe", "frame" -> return SUBDOCUMENT
                "script", "worker", "sharedworker", "serviceworker" -> return SCRIPT
                "style" -> return STYLESHEET
                "image" -> return IMAGE
                "font" -> return FONT
                "audio", "video", "track" -> return MEDIA
                "empty" -> return XHR
            }
            val a = accept?.lowercase(Locale.ROOT).orEmpty()
            if (a.startsWith("text/html")) return SUBDOCUMENT
            if (a.startsWith("text/css")) return STYLESHEET
            if (a.startsWith("image/")) return IMAGE
            val path = url.substringBefore('?').substringBefore('#')
            val ext = path.substringAfterLast('/').substringAfterLast('.', "").lowercase(Locale.ROOT)
            return when {
                ext in SCRIPT_EXT -> SCRIPT
                ext == "css" -> STYLESHEET
                ext in IMAGE_EXT -> IMAGE
                ext in FONT_EXT -> FONT
                ext in MEDIA_EXT -> MEDIA
                a.contains("application/json") -> XHR
                else -> OTHER
            }
        }
    }
}

/** Blocks nothing. Used when ad blocking is turned off. */
object NoopContentBlocker : ContentBlocker {
    override fun shouldBlock(url: String, documentUrl: String?, kind: RequestKind) = false
    override fun cosmeticCss(documentUrl: String): String? = null
}
