package org.velabrowser.vela.core

/** Search engines offered by Vela — the same list (and URLs) as the desktop app. */
enum class SearchEngine(val label: String, private val base: String, val host: String) {
    DUCKDUCKGO("DuckDuckGo", "https://duckduckgo.com/?q=", "duckduckgo.com"),
    GOOGLE("Google", "https://www.google.com/search?q=", "google.com"),
    BRAVE("Brave Search", "https://search.brave.com/search?q=", "search.brave.com"),
    STARTPAGE("Startpage", "https://www.startpage.com/sp/search?query=", "startpage.com"),
    ECOSIA("Ecosia", "https://www.ecosia.org/search?q=", "ecosia.org");

    fun searchUrl(query: String): String = base + java.net.URLEncoder.encode(query.trim(), "UTF-8").replace("+", "%20")

    companion object {
        fun fromKey(key: String?): SearchEngine = entries.firstOrNull { it.name.equals(key, ignoreCase = true) } ?: DUCKDUCKGO
    }
}

enum class ThemeMode(val label: String) { SYSTEM("System"), DARK("Dark"), LIGHT("Light") }

/** New tab hero styles, mirroring desktop's NEWTAB_HEROES order. Tapping the hero cycles to the next. */
enum class NewtabHero(val label: String) {
    CLOCK("Clock"),
    CLOCK_SECONDS("Clock with seconds"),
    LOGO("Vela logo"),
    DATE("Date"),
    GREETING("Greeting"),
    MINIMAL("Minimal");

    fun next(): NewtabHero = entries[(ordinal + 1) % entries.size]
}

data class Settings(
    val searchEngine: SearchEngine = SearchEngine.DUCKDUCKGO,
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val adblock: Boolean = true,
    val httpsOnly: Boolean = true,
    val blockThirdPartyCookies: Boolean = true,
    val doNotTrack: Boolean = true,
    val newtabHero: NewtabHero = NewtabHero.CLOCK,
)

/** Desktop Space palette (docs/DESIGN.md). ARGB. */
object SpaceColors {
    val all: List<Long> = listOf(
        0xFF94A3B8, // slate
        0xFF60A5FA, // blue
        0xFFA78BFA, // violet
        0xFFF472B6, // pink
        0xFFF87171, // red
        0xFFFB923C, // orange
        0xFF4ADE80, // green
        0xFF2DD4BF, // teal
    )
    const val BURNER: Long = 0xFFFB923C
}

data class Space(
    val id: String,
    val name: String,
    val color: Long,
    val burner: Boolean = false,
) {
    /** Name of the androidx.webkit Profile that stores this Space's cookies, storage, cache and permissions. */
    val profileName: String get() = (if (burner) BURNER_PREFIX else SPACE_PREFIX) + id

    companion object {
        const val SPACE_PREFIX = "space-"
        const val BURNER_PREFIX = "burner-"
        const val DEFAULT_ID = "personal"
        val Default = Space(DEFAULT_ID, "Personal", SpaceColors.all[2])
    }
}
