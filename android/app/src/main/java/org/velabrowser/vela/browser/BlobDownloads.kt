package org.velabrowser.vela.browser

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLDecoder
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Downloads that DownloadManager can't fetch: `data:` URLs are decoded directly; `blob:` URLs only exist inside
 * the page, so a script reads the blob as a data URL and posts it back over a WebMessageListener ([BRIDGE]).
 * Only replies carrying a token Vela just handed out are accepted. Files go to Downloads via MediaStore.
 */
class BlobDownloads(
    private val context: Context,
    private val scope: CoroutineScope,
    private val onDone: (fileName: String, uri: Uri?) -> Unit,
) {
    private class Pending(val fileName: String, val mimeType: String?)

    private val pending = ConcurrentHashMap<String, Pending>()

    fun fetchBlob(webView: WebView, url: String, contentDisposition: String?, mimeType: String?) {
        val token = UUID.randomUUID().toString()
        pending[token] = Pending(fileName(url, contentDisposition, mimeType), mimeType)
        val t = JSONObject.quote(token)
        val u = JSONObject.quote(url)
        val post = "function(o){o.t=$t;$BRIDGE.postMessage(JSON.stringify(o))}"
        webView.evaluateJavascript(
            "(function(){var post=$post;fetch($u).then(function(r){return r.blob()}).then(function(b){" +
                "if(b.size>$MAX_BYTES){post({e:'too large'});return}" +
                "var f=new FileReader();f.onload=function(){post({d:f.result,m:b.type})};" +
                "f.onerror=function(){post({e:'read failed'})};f.readAsDataURL(b)})" +
                ".catch(function(e){post({e:String(e)})})})()",
            null,
        )
    }

    /** A reply from the page script (any thread). */
    fun onMessage(json: String) {
        val reply = runCatching { JSONObject(json) }.getOrNull() ?: return
        val request = pending.remove(reply.optString("t")) ?: return
        val dataUrl = reply.optString("d").takeIf { it.startsWith("data:") }
        if (dataUrl == null) {
            scope.launch(Dispatchers.Main) { onDone(request.fileName, null) }
            return
        }
        val mime = reply.optString("m").takeIf { it.isNotBlank() } ?: request.mimeType
        saveDataUrl(dataUrl, request.fileName.withExtensionFor(mime), mime)
    }

    fun saveDataUrl(url: String, fileName: String, mimeType: String?) {
        scope.launch(Dispatchers.IO) {
            val decoded = runCatching { decodeDataUrl(url) }.getOrNull()
            val mime = mimeType?.takeIf { it.isNotBlank() } ?: decoded?.first
            val uri = decoded?.let { (_, bytes) -> runCatching { save(bytes, fileName, mime) }.getOrNull() }
            withContext(Dispatchers.Main) { onDone(fileName, uri) }
        }
    }

    fun fileName(url: String, contentDisposition: String?, mimeType: String?): String {
        val guessed = URLUtil.guessFileName(if (url.startsWith("data:")) "data:" else url, contentDisposition, mimeType)
        return if (guessed.startsWith("downloadfile")) "download".withExtensionFor(mimeType) else guessed
    }

    private fun String.withExtensionFor(mime: String?): String {
        val ext = mime?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it.substringBefore(';').trim().lowercase(Locale.ROOT)) }
            ?: return this
        val base = substringBeforeLast('.', this)
        val current = substringAfterLast('.', "")
        return if (current.isEmpty() || current == "bin") "$base.$ext" else this
    }

    private fun save(bytes: ByteArray, fileName: String, mimeType: String?): Uri? {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            if (mimeType != null) put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
        try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("no output stream")
            resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            return uri
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    companion object {
        /** Name of the JS object WebView injects for the WebMessageListener. */
        const val BRIDGE = "__velaDownloads"
        private const val MAX_BYTES = 64L * 1024 * 1024

        /** `data:[<mime>][;base64],<payload>` → (mime, bytes). */
        fun decodeDataUrl(url: String): Pair<String?, ByteArray> {
            require(url.startsWith("data:", ignoreCase = true)) { "not a data URL" }
            val comma = url.indexOf(',')
            require(comma > 0) { "malformed data URL" }
            val meta = url.substring(5, comma)
            val payload = url.substring(comma + 1)
            val base64 = meta.endsWith(";base64", ignoreCase = true)
            val mime = meta.removeSuffix(";base64").substringBefore(';').takeIf { it.isNotBlank() }
            val bytes = if (base64) Base64.decode(payload, Base64.DEFAULT) else URLDecoder.decode(payload.replace("+", "%2B"), "UTF-8").toByteArray()
            return mime to bytes
        }
    }
}
