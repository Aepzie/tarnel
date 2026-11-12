package org.velabrowser.vela.adblock

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** What the Ad blocking settings show. */
data class FilterListStatus(
    /** True once the filter-list engine replaced the small built-in host list. */
    val engineReady: Boolean = false,
    val filters: Int = 0,
    /** Wall-clock time of the last successful download, 0 if never. */
    val updatedAt: Long = 0,
    val updating: Boolean = false,
    val error: String? = null,
)

/**
 * Downloads the default filter lists ([DefaultLists]) — they are not bundled, to keep the APK small — and keeps
 * a compiled snapshot of the engine in app storage:
 *
 * * start: deserialize `adblock/engine.bin` (tens of ms); if it is corrupt or from another engine version,
 *   re-parse the cached list texts; if there is nothing yet, the built-in [HostListBlocker] stays active and
 *   the lists are downloaded right away.
 * * every [MAX_AGE_MS] (checked at start and whenever the app comes back to the foreground, on any network):
 *   download, parse off the main thread, write a new snapshot, swap the engine in.
 *
 * [onEngine] is called on a background thread with each new engine.
 */
class FilterLists(
    context: Context,
    private val scope: CoroutineScope,
    private val onEngine: (ContentBlocker) -> Unit,
) {
    private val dir = File(context.filesDir, "adblock").apply { mkdirs() }
    private val snapshot = File(dir, "engine.bin")
    private val listsDir = File(dir, "lists").apply { mkdirs() }
    private val prefs = context.getSharedPreferences("adblock", Context.MODE_PRIVATE)
    private val lock = Mutex()
    private var updateJob: Job? = null

    var status by mutableStateOf(
        FilterListStatus(filters = prefs.getInt(KEY_FILTERS, 0), updatedAt = prefs.getLong(KEY_UPDATED, 0)),
    )
        private set

    /** Loads the stored engine, then refreshes the lists if they are missing or stale and [online]. */
    fun start(online: Boolean) {
        scope.launch(Dispatchers.IO) {
            val loaded = lock.withLock { loadStored() }
            if (loaded != null) publish(loaded, status.updatedAt)
            withContext(Dispatchers.Main) { updateIfStale(online) }
        }
    }

    fun updateIfStale(online: Boolean) {
        if (!online || status.updating) return
        val now = System.currentTimeMillis()
        val stale = !status.engineReady && !snapshot.exists() || now - status.updatedAt > MAX_AGE_MS
        val lastAttempt = prefs.getLong(KEY_ATTEMPT, 0)
        if (stale && now - lastAttempt > RETRY_AFTER_MS) update()
    }

    /** Downloads every list now ("Update now"). */
    fun update() {
        if (updateJob?.isActive == true) return
        status = status.copy(updating = true, error = null)
        prefs.edit { putLong(KEY_ATTEMPT, System.currentTimeMillis()) }
        updateJob = scope.launch(Dispatchers.IO) {
            val result = runCatching { lock.withLock { downloadAndCompile() } }
            withContext(Dispatchers.Main) {
                result.onSuccess { (engine, time) ->
                    prefs.edit {
                        putLong(KEY_UPDATED, time)
                        putInt(KEY_FILTERS, engine.filterCount())
                    }
                }
                status = status.copy(
                    updating = false,
                    error = result.exceptionOrNull()?.let { "Couldn't update the filter lists" },
                )
            }
            result.onSuccess { (engine, time) -> publish(engine, time) }
            result.onFailure { Log.w(TAG, "filter list update failed", it) }
        }
    }

    private fun loadStored(): AdblockEngine? {
        if (snapshot.exists()) {
            val started = SystemClock.elapsedRealtime()
            try {
                val engine = AdblockEngine.deserialize(snapshot.readBytes())
                Log.i(TAG, "engine snapshot loaded in ${SystemClock.elapsedRealtime() - started} ms")
                return engine
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "snapshot unusable, re-parsing lists", e)
            } catch (e: IOException) {
                Log.w(TAG, "snapshot unreadable, re-parsing lists", e)
            }
        }
        val texts = cachedLists() ?: return null
        val engine = AdblockEngine.parse(texts)
        writeSnapshot(engine)
        return engine
    }

    private fun cachedLists(): List<String>? = DefaultLists.urls.indices
        .mapNotNull { File(listsDir, "$it.txt").takeIf(File::isFile)?.readText() }
        .takeIf { it.isNotEmpty() }

    private fun downloadAndCompile(): Pair<AdblockEngine, Long> {
        var fresh = 0
        DefaultLists.urls.forEachIndexed { index, url ->
            val target = File(listsDir, "$index.txt")
            val text = runCatching { download(url) }.onFailure { Log.w(TAG, "download failed: $url", it) }.getOrNull()
            if (text != null) {
                val tmp = File(listsDir, "$index.txt.tmp")
                tmp.writeText(text)
                if (!tmp.renameTo(target)) {
                    target.delete()
                    tmp.renameTo(target)
                }
                fresh++
            }
        }
        if (fresh == 0) throw IOException("no filter list could be downloaded")
        val texts = cachedLists() ?: throw IOException("no filter lists")
        val started = SystemClock.elapsedRealtime()
        val engine = AdblockEngine.parse(texts)
        Log.i(TAG, "parsed ${engine.filterCount()} filters in ${SystemClock.elapsedRealtime() - started} ms")
        writeSnapshot(engine)
        return engine to System.currentTimeMillis()
    }

    private fun download(url: String): String {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("User-Agent", "Tarnel (Android) filter list updater")
            if (connection.responseCode != HttpURLConnection.HTTP_OK) throw IOException("HTTP ${connection.responseCode} for $url")
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            if (!looksLikeFilterList(text)) throw IOException("not a filter list: $url")
            return text
        } finally {
            connection.disconnect()
        }
    }

    private fun writeSnapshot(engine: AdblockEngine) {
        val tmp = File(dir, "engine.bin.tmp")
        tmp.writeBytes(engine.serialize())
        if (!tmp.renameTo(snapshot)) {
            snapshot.delete()
            tmp.renameTo(snapshot)
        }
    }

    private fun publish(engine: AdblockEngine, updatedAt: Long) {
        onEngine(EngineContentBlocker(engine))
        scope.launch(Dispatchers.Main) {
            status = status.copy(engineReady = true, filters = engine.filterCount(), updatedAt = updatedAt)
        }
    }

    companion object {
        private const val TAG = "TarnelAdblock"
        const val MAX_AGE_MS = 4L * 24 * 60 * 60 * 1000
        private const val RETRY_AFTER_MS = 30L * 60 * 1000
        private const val KEY_UPDATED = "updatedAt"
        private const val KEY_FILTERS = "filters"
        private const val KEY_ATTEMPT = "lastAttempt"

        /** Rejects captive-portal pages and error bodies served with 200. */
        fun looksLikeFilterList(text: String): Boolean {
            if (text.length < 1_000) return false
            val head = text.take(2_000).trimStart()
            if (head.startsWith("<")) return false
            return head.startsWith("[Adblock") || head.startsWith("!") || text.contains("||")
        }
    }
}

fun AdblockEngine.filterCount(): Int = stats.networkFilters + stats.cosmeticFilters
