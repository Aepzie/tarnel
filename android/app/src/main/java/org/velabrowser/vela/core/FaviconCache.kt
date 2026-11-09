package org.velabrowser.vela.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.mutableIntStateOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

/**
 * Favicons by host: memory LRU + small PNGs on disk. Burner tabs only populate the memory cache.
 * Each icon is also filed under its site ("en.wikipedia.org" → "wikipedia.org"), so a top site or a sibling
 * subdomain finds it too.
 */
class FaviconCache(context: Context, private val scope: CoroutineScope) {
    private val dir = File(context.filesDir, "favicons").apply { mkdirs() }
    private val memory = LruCache<String, Bitmap>(96)
    private val missing = HashSet<String>()

    /** Bumped whenever a new icon lands so composables reading [get] refresh. */
    val revision = mutableIntStateOf(0)

    fun get(host: String): Bitmap? {
        revision.intValue
        return lookup(host) ?: UrlInput.siteOf(host).takeIf { it != host }?.let(::lookup)
    }

    private fun lookup(host: String): Bitmap? {
        memory.get(host)?.let { return it }
        if (host in missing) return null
        val file = File(dir, "$host.png")
        if (!file.exists()) {
            missing += host
            return null
        }
        return BitmapFactory.decodeFile(file.path)?.also { memory.put(host, it) }
    }

    fun put(host: String, icon: Bitmap, persist: Boolean) {
        val keys = listOf(host, UrlInput.siteOf(host)).distinct()
        keys.forEach {
            memory.put(it, icon)
            missing -= it
        }
        revision.intValue++
        if (!persist) return
        scope.launch(Dispatchers.IO) {
            runCatching {
                val scaled = if (icon.width > 64) Bitmap.createScaledBitmap(icon, 64, 64 * icon.height / icon.width, true) else icon
                keys.forEach { key -> File(dir, "$key.png").outputStream().use { scaled.compress(Bitmap.CompressFormat.PNG, 100, it) } }
            }
        }
    }

    fun clearDisk() {
        dir.listFiles()?.forEach { it.delete() }
        memory.evictAll()
        missing.clear()
        revision.intValue++
    }
}
