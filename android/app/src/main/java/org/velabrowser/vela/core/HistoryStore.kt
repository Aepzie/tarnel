package org.velabrowser.vela.core

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class HistoryEntry(val url: String, val title: String, val host: String, val visits: Int, val lastVisit: Long)

data class TopSite(val host: String, val url: String, val title: String)

/**
 * Global browsing history (one row per URL, like Chromium's `urls` table). Burner spaces never write here.
 * All calls are suspend and run on [io].
 */
class HistoryStore(context: Context, private val io: CoroutineDispatcher = Dispatchers.IO) {
    private val helper = object : SQLiteOpenHelper(context, "history.db", null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE urls (url TEXT PRIMARY KEY, title TEXT NOT NULL, host TEXT NOT NULL, " +
                    "visits INTEGER NOT NULL, last INTEGER NOT NULL)",
            )
            db.execSQL("CREATE INDEX urls_last ON urls(last DESC)")
            db.execSQL("CREATE INDEX urls_host ON urls(host)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    }

    suspend fun record(url: String, title: String) = withContext(io) {
        if (!url.startsWith("http")) return@withContext
        val host = UrlInput.hostOf(url) ?: return@withContext
        val db = helper.writableDatabase
        val now = System.currentTimeMillis()
        db.beginTransaction()
        try {
            val updated = db.compileStatement("UPDATE urls SET visits = visits + 1, last = ?, title = CASE WHEN ? = '' THEN title ELSE ? END WHERE url = ?").use {
                it.bindLong(1, now); it.bindString(2, title); it.bindString(3, title); it.bindString(4, url)
                it.executeUpdateDelete()
            }
            if (updated == 0) {
                db.insert("urls", null, ContentValues().apply {
                    put("url", url); put("title", title); put("host", host); put("visits", 1); put("last", now)
                })
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** Update the title of an already recorded URL without counting a visit. */
    suspend fun updateTitle(url: String, title: String) = withContext(io) {
        if (title.isBlank()) return@withContext
        helper.writableDatabase.update("urls", ContentValues().apply { put("title", title) }, "url = ?", arrayOf(url))
    }

    suspend fun list(query: String, limit: Int = 300): List<HistoryEntry> = withContext(io) {
        val q = query.trim()
        val (where, args) = if (q.isEmpty()) null to null else "url LIKE ? OR title LIKE ?" to arrayOf("%$q%", "%$q%")
        helper.readableDatabase.query("urls", COLUMNS, where, args, null, null, "last DESC", limit.toString()).use { c ->
            buildList { while (c.moveToNext()) add(HistoryEntry(c.getString(0), c.getString(1), c.getString(2), c.getInt(3), c.getLong(4))) }
        }
    }

    /** Omnibox suggestions: prefix matches on the host first, then frequency and recency. */
    suspend fun suggest(text: String, limit: Int = 6): List<HistoryEntry> = withContext(io) {
        val q = text.trim().removePrefix("https://").removePrefix("http://").removePrefix("www.")
        if (q.isEmpty()) return@withContext emptyList()
        val sql = "SELECT url, title, host, visits, last FROM urls WHERE url LIKE ? OR title LIKE ? " +
            "ORDER BY (host LIKE ? OR host LIKE ?) DESC, visits DESC, last DESC LIMIT ?"
        helper.readableDatabase.rawQuery(sql, arrayOf("%$q%", "%$q%", "$q%", "www.$q%", limit.toString())).use { c ->
            buildList { while (c.moveToNext()) add(HistoryEntry(c.getString(0), c.getString(1), c.getString(2), c.getInt(3), c.getLong(4))) }
        }
    }

    suspend fun topSites(limit: Int = 8): List<TopSite> = withContext(io) {
        val sql = "SELECT host, url, title, SUM(visits) AS score FROM urls GROUP BY host ORDER BY score DESC, MAX(last) DESC LIMIT ?"
        helper.readableDatabase.rawQuery(sql, arrayOf(limit.toString())).use { c ->
            buildList { while (c.moveToNext()) add(TopSite(c.getString(0), "https://" + c.getString(0) + "/", c.getString(2))) }
        }
    }

    suspend fun delete(url: String) = withContext(io) { helper.writableDatabase.delete("urls", "url = ?", arrayOf(url)) }

    suspend fun clear() = withContext(io) { helper.writableDatabase.delete("urls", null, null) }

    private companion object {
        val COLUMNS = arrayOf("url", "title", "host", "visits", "last")
    }
}
