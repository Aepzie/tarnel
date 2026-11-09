package org.velabrowser.vela.core

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit

/** Settings backed by SharedPreferences, exposed as Compose state. Mutate on the main thread only. */
class SettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var settings: Settings by mutableStateOf(load())
        private set

    /** Snapshot readable from WebView background threads (shouldInterceptRequest). */
    @Volatile
    var current: Settings = settings
        private set

    fun update(transform: (Settings) -> Settings) {
        val next = transform(settings)
        if (next == settings) return
        settings = next
        current = next
        prefs.edit {
            putString("searchEngine", next.searchEngine.name)
            putString("theme", next.theme.name)
            putBoolean("adblock", next.adblock)
            putBoolean("httpsOnly", next.httpsOnly)
            putBoolean("blockThirdPartyCookies", next.blockThirdPartyCookies)
            putBoolean("doNotTrack", next.doNotTrack)
            putString("newtabHero", next.newtabHero.name)
            putString("refreshRate", next.refreshRate.name)
        }
    }

    private fun load(): Settings {
        val defaults = Settings()
        return Settings(
            searchEngine = SearchEngine.fromKey(prefs.getString("searchEngine", null)),
            theme = runCatching { ThemeMode.valueOf(prefs.getString("theme", null)!!) }.getOrDefault(defaults.theme),
            adblock = prefs.getBoolean("adblock", defaults.adblock),
            httpsOnly = prefs.getBoolean("httpsOnly", defaults.httpsOnly),
            blockThirdPartyCookies = prefs.getBoolean("blockThirdPartyCookies", defaults.blockThirdPartyCookies),
            doNotTrack = prefs.getBoolean("doNotTrack", defaults.doNotTrack),
            newtabHero = runCatching { NewtabHero.valueOf(prefs.getString("newtabHero", null)!!) }.getOrDefault(defaults.newtabHero),
            refreshRate = runCatching { RefreshRateMode.valueOf(prefs.getString("refreshRate", null)!!) }.getOrDefault(defaults.refreshRate),
        )
    }
}
