package org.velabrowser.vela.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class SavedTab(val id: String, val spaceId: String, val url: String, val title: String, val desktop: Boolean = false)

data class SavedSession(
    val spaces: List<Space>,
    val activeSpaceId: String,
    val tabs: List<SavedTab>,
    val activeTabBySpace: Map<String, String>,
)

/**
 * Persists Spaces and open tabs (never Burner ones) to a small JSON file, written atomically, plus tab
 * thumbnails as JPEGs in the cache directory.
 */
class SessionStore(context: Context) {
    private val file = File(context.filesDir, "session.json")
    private val thumbs = File(context.cacheDir, "thumbs").apply { mkdirs() }

    fun load(): SavedSession? = runCatching {
        if (!file.exists()) return null
        val root = JSONObject(file.readText())
        val spaces = root.getJSONArray("spaces").let { arr ->
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Space(o.getString("id"), o.getString("name"), o.getLong("color"))
            }
        }
        val tabs = root.getJSONArray("tabs").let { arr ->
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                SavedTab(o.getString("id"), o.getString("space"), o.optString("url"), o.optString("title"), o.optBoolean("desktop"))
            }
        }
        val active = root.optJSONObject("active") ?: JSONObject()
        SavedSession(
            spaces = spaces,
            activeSpaceId = root.optString("activeSpace", Space.DEFAULT_ID),
            tabs = tabs,
            activeTabBySpace = active.keys().asSequence().associateWith { active.getString(it) },
        )
    }.getOrNull()

    fun save(session: SavedSession) {
        val root = JSONObject()
        root.put("version", 1)
        root.put("activeSpace", session.activeSpaceId)
        root.put("spaces", JSONArray().apply {
            session.spaces.filterNot { it.burner }.forEach { put(JSONObject().put("id", it.id).put("name", it.name).put("color", it.color)) }
        })
        root.put("tabs", JSONArray().apply {
            session.tabs.forEach { t -> put(JSONObject().put("id", t.id).put("space", t.spaceId).put("url", t.url).put("title", t.title).apply { if (t.desktop) put("desktop", true) }) }
        })
        root.put("active", JSONObject().apply { session.activeTabBySpace.forEach { (k, v) -> put(k, v) } })
        val tmp = File(file.parentFile, "session.json.tmp")
        tmp.writeText(root.toString())
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    fun saveThumbnail(tabId: String, bitmap: Bitmap) {
        runCatching { File(thumbs, "$tabId.jpg").outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 78, it) } }
    }

    /** Decoded straight into GPU memory, so the tab switcher never uploads thumbnails on its first frames. */
    fun loadThumbnail(tabId: String): Bitmap? = File(thumbs, "$tabId.jpg").takeIf { it.exists() }?.let {
        BitmapFactory.decodeFile(it.path, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.HARDWARE })
    }

    fun deleteThumbnail(tabId: String) {
        File(thumbs, "$tabId.jpg").delete()
    }

    fun pruneThumbnails(keep: Set<String>) {
        thumbs.listFiles()?.forEach { if (it.nameWithoutExtension !in keep) it.delete() }
    }
}
