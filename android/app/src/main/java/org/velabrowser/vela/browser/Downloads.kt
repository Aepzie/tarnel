package org.velabrowser.vela.browser

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.webkit.URLUtil
import androidx.compose.runtime.mutableStateListOf
import androidx.core.content.getSystemService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class DownloadStatus { RUNNING, DONE, FAILED }

data class DownloadItem(
    val id: Long,
    val fileName: String,
    val mimeType: String?,
    val status: DownloadStatus = DownloadStatus.RUNNING,
    val downloaded: Long = 0,
    val total: Long = -1,
) {
    val fraction: Float? get() = if (total > 0) (downloaded.toFloat() / total).coerceIn(0f, 1f) else null
}

/** Hands downloads to the system DownloadManager and mirrors their progress as Compose state. */
class Downloads(private val context: Context, private val scope: CoroutineScope) {
    private val manager = context.getSystemService<DownloadManager>()!!
    val items = mutableStateListOf<DownloadItem>()
    private var poller: Job? = null

    fun enqueue(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?, cookies: String?, referer: String?): DownloadItem? {
        val uri = Uri.parse(url)
        if (uri.scheme != "http" && uri.scheme != "https") return null
        val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
        val request = DownloadManager.Request(uri)
            .setTitle(fileName)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
        if (!mimeType.isNullOrBlank()) request.setMimeType(mimeType)
        if (!userAgent.isNullOrBlank()) request.addRequestHeader("User-Agent", userAgent)
        if (!cookies.isNullOrBlank()) request.addRequestHeader("Cookie", cookies)
        if (!referer.isNullOrBlank() && referer.startsWith("http")) request.addRequestHeader("Referer", referer)
        val id = runCatching { manager.enqueue(request) }.getOrNull() ?: return null
        val item = DownloadItem(id, fileName, mimeType)
        items.add(0, item)
        startPolling()
        return item
    }

    private fun startPolling() {
        if (poller?.isActive == true) return
        poller = scope.launch {
            while (isActive && items.any { it.status == DownloadStatus.RUNNING }) {
                refresh()
                delay(400)
            }
        }
    }

    private fun refresh() {
        val running = items.filter { it.status == DownloadStatus.RUNNING }
        if (running.isEmpty()) return
        val query = DownloadManager.Query().setFilterById(*running.map { it.id }.toLongArray())
        manager.query(query)?.use { c ->
            val idCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)
            val statusCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
            val soFarCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
            val totalCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
            while (c.moveToNext()) {
                val id = c.getLong(idCol)
                val index = items.indexOfFirst { it.id == id }
                if (index < 0) continue
                val status = when (c.getInt(statusCol)) {
                    DownloadManager.STATUS_SUCCESSFUL -> DownloadStatus.DONE
                    DownloadManager.STATUS_FAILED -> DownloadStatus.FAILED
                    else -> DownloadStatus.RUNNING
                }
                items[index] = items[index].copy(status = status, downloaded = c.getLong(soFarCol), total = c.getLong(totalCol))
            }
        }
    }

    fun dismiss(item: DownloadItem) {
        items.removeAll { it.id == item.id }
    }

    fun cancel(item: DownloadItem) {
        manager.remove(item.id)
        dismiss(item)
    }

    private fun contentUri(item: DownloadItem): Uri? = runCatching { manager.getUriForDownloadedFile(item.id) }.getOrNull()

    fun open(item: DownloadItem): Boolean {
        val uri = contentUri(item) ?: return false
        val mime = item.mimeType ?: manager.getMimeTypeForDownloadedFile(item.id)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    fun share(item: DownloadItem): Boolean {
        val uri = contentUri(item) ?: return false
        val mime = item.mimeType ?: manager.getMimeTypeForDownloadedFile(item.id) ?: "*/*"
        val send = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, item.fileName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }

    fun showAll() {
        runCatching { context.startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}
