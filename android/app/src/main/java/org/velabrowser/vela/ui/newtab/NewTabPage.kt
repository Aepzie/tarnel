package org.velabrowser.vela.ui.newtab

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.Panel
import org.velabrowser.vela.core.NewtabHero
import org.velabrowser.vela.core.TopSite
import org.velabrowser.vela.core.UrlInput
import org.velabrowser.vela.ui.components.SiteIcon
import org.velabrowser.vela.ui.components.SpaceDot
import org.velabrowser.vela.ui.components.VelaMark
import org.velabrowser.vela.ui.components.glass
import org.velabrowser.vela.ui.components.pressable
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private val DefaultSites = listOf(
    TopSite("wikipedia.org", "https://www.wikipedia.org/", "Wikipedia"),
    TopSite("youtube.com", "https://m.youtube.com/", "YouTube"),
    TopSite("github.com", "https://github.com/", "GitHub"),
    TopSite("reddit.com", "https://www.reddit.com/", "Reddit"),
    TopSite("duckduckgo.com", "https://duckduckgo.com/", "DuckDuckGo"),
    TopSite("news.ycombinator.com", "https://news.ycombinator.com/", "Hacker News"),
    TopSite("maps.google.com", "https://www.google.com/maps", "Maps"),
    TopSite("openstreetmap.org", "https://www.openstreetmap.org/", "OSM"),
)

/** Native new tab page in the desktop style: aurora, tappable hero that cycles styles, search, top sites. */
@Composable
fun NewTabPage(browser: Browser, modifier: Modifier = Modifier) {
    val c = LocalVela.current
    val hero = browser.settings.settings.newtabHero
    var sites by remember { mutableStateOf<List<TopSite>?>(null) }
    LaunchedEffect(Unit) {
        val visited = runCatching { browser.history.topSites(8) }.getOrDefault(emptyList())
        sites = (visited + DefaultSites)
            .distinctBy { UrlInput.siteOf(it.host) }
            .take(8)
    }

    BoxWithConstraints(
        modifier
            .fillMaxSize()
            .background(c.background)
            .aurora(c.accent, c.dark),
    ) {
        val compact = maxHeight < 520.dp
        val heroGap = maxHeight * 0.15f
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 96.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            SpaceBadge(browser)
            Spacer(Modifier.height(if (compact) 8.dp else heroGap))
            Box(
                Modifier
                    .clickable(null, null, role = Role.Button) {
                        browser.settings.update { it.copy(newtabHero = it.newtabHero.next()) }
                    }
                    .semantics { contentDescription = "Clock style: ${hero.label}. Tap to change." }
                    .padding(8.dp),
                contentAlignment = Alignment.Center,
            ) {
                AnimatedContent(
                    targetState = hero,
                    transitionSpec = {
                        (fadeIn(tween(260, delayMillis = 60)) + scaleIn(spring(dampingRatio = 0.8f, stiffness = 380f), initialScale = 0.94f))
                            .togetherWith(fadeOut(tween(140)) + scaleOut(tween(160), targetScale = 1.03f))
                    },
                    label = "hero",
                ) { style -> Hero(style, compact) }
            }
            Spacer(Modifier.height(if (compact) 16.dp else 36.dp))
            SearchField(browser.settings.settings.searchEngine.label) { browser.editing = true }
            Spacer(Modifier.height(if (compact) 20.dp else 40.dp))
            sites?.let { TopSitesGrid(browser, it, if (compact) 8 else 4) }
        }
    }
}

private fun Modifier.aurora(accent: Color, dark: Boolean): Modifier = drawBehind {
    val strength = if (dark) 1f else 1.4f
    val w = size.width
    val h = size.height
    val vmax = maxOf(w, h)
    drawRect(Brush.radialGradient(listOf(accent.copy(alpha = 0.10f * strength), Color.Transparent), Offset(w * 0.18f, h * 0.06f), vmax * 0.42f))
    drawRect(Brush.radialGradient(listOf(accent.copy(alpha = 0.075f * strength), Color.Transparent), Offset(w * 1.02f, h * 0.02f), vmax * 0.36f))
    drawRect(Brush.radialGradient(listOf(accent.copy(alpha = 0.07f * strength), Color.Transparent), Offset(w * 0.6f, h * 1.08f), vmax * 0.45f))
}

@Composable
private fun SpaceBadge(browser: Browser) {
    val c = LocalVela.current
    val space = browser.activeSpace
    Row(Modifier.fillMaxWidth().padding(top = 10.dp)) {
        Row(
            Modifier
                .glass(CircleShape, elevation = 0.dp)
                .pressable({ browser.panel = Panel.SPACES })
                .padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SpaceDot(Color(space.color), size = 7.dp)
            Spacer(Modifier.width(8.dp))
            Text(space.name, style = VelaType.label, color = c.textMuted)
        }
    }
}

@Composable
private fun rememberNow(tickMs: Long): Date {
    val now by produceState(Date()) {
        while (true) {
            val ms = System.currentTimeMillis()
            delay(tickMs - ms % tickMs + 5)
            value = Date()
        }
    }
    return now
}

@Composable
private fun Hero(style: NewtabHero, compact: Boolean) {
    val c = LocalVela.current
    val locale = LocalConfiguration.current.locales[0]
    val scale = if (compact) 0.66f else 1f
    when (style) {
        NewtabHero.CLOCK, NewtabHero.CLOCK_SECONDS -> {
            val seconds = style == NewtabHero.CLOCK_SECONDS
            val now = rememberNow(if (seconds) 1000 else 60_000)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Row(verticalAlignment = Alignment.Bottom) {
                    RollingText(timeFormat().format(now), (84 * scale).sp, c.text)
                    if (seconds) {
                        Text(":", fontSize = (40 * scale).sp, color = c.textFaint.copy(alpha = 0.5f), fontWeight = FontWeight.ExtraLight, modifier = Modifier.padding(start = 2.dp, bottom = (12 * scale).dp))
                        RollingText(SimpleDateFormat("ss", locale).format(now), (40 * scale).sp, c.text.copy(alpha = 0.55f), Modifier.padding(bottom = (12 * scale).dp))
                    }
                }
                Text(SimpleDateFormat("EEEE, MMMM d", locale).format(now), style = VelaType.bodyStrong, color = c.textMuted)
            }
        }
        NewtabHero.LOGO -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(contentAlignment = Alignment.Center) {
                Box(
                    Modifier
                        .size((150 * scale).dp)
                        .background(Brush.radialGradient(listOf(c.accent.copy(alpha = 0.22f), Color.Transparent)), CircleShape),
                )
                VelaMark(Modifier.size((132 * scale).dp), tint = c.text)
            }
            Text("Vela", style = VelaType.title.copy(fontSize = (28 * scale).sp, fontWeight = FontWeight.Medium), color = c.text)
        }
        NewtabHero.DATE -> {
            val now = rememberNow(60_000)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(SimpleDateFormat("EEEE", locale).format(now), style = VelaType.hero.copy(fontSize = (60 * scale).sp, lineHeight = (70 * scale).sp), color = c.text)
                Text(SimpleDateFormat("d MMMM yyyy", locale).format(now), style = VelaType.bodyStrong, color = c.textMuted)
            }
        }
        NewtabHero.GREETING -> {
            val now = rememberNow(60_000)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(greeting(now, locale), style = VelaType.hero.copy(fontSize = (46 * scale).sp, lineHeight = (54 * scale).sp), color = c.text, textAlign = TextAlign.Center)
                Spacer(Modifier.height(4.dp))
                Text(timeFormat().format(now), style = VelaType.bodyStrong, color = c.textMuted)
            }
        }
        NewtabHero.MINIMAL -> Box(Modifier.size(width = 120.dp, height = (40 * scale).dp), contentAlignment = Alignment.Center) {
            SpaceDot(c.accent, size = 8.dp)
        }
    }
}

@Composable
private fun timeFormat(): SimpleDateFormat {
    val context = androidx.compose.ui.platform.LocalContext.current
    val locale = LocalConfiguration.current.locales[0]
    val is24 = android.text.format.DateFormat.is24HourFormat(context)
    return remember(is24, locale) { SimpleDateFormat(if (is24) "HH:mm" else "h:mm", locale) }
}

private fun greeting(now: Date, locale: Locale): String {
    val hour = Calendar.getInstance().apply { time = now }.get(Calendar.HOUR_OF_DAY)
    val german = locale.language == "de"
    return when (hour) {
        in 5..11 -> if (german) "Guten Morgen" else "Good morning"
        in 12..17 -> if (german) "Guten Tag" else "Good afternoon"
        in 18..21 -> if (german) "Guten Abend" else "Good evening"
        else -> if (german) "Gute Nacht" else "Good night"
    }
}

/** Per-digit roll like the desktop clock: each changed digit slides up and fades. */
@Composable
private fun RollingText(text: String, size: androidx.compose.ui.unit.TextUnit, color: Color, modifier: Modifier = Modifier) {
    val style = VelaType.hero.copy(fontSize = size, lineHeight = size * 1.12f, color = color)
    Row(modifier) {
        text.forEachIndexed { index, char ->
            if (!char.isDigit()) {
                Text(char.toString(), style = style.copy(color = color.copy(alpha = 0.4f)))
            } else {
                AnimatedContent(
                    targetState = char,
                    transitionSpec = {
                        (slideInVertically(spring(dampingRatio = 0.8f, stiffness = 300f)) { it * 7 / 10 } + fadeIn(tween(220)))
                            .togetherWith(slideOutVertically(spring(dampingRatio = 0.8f, stiffness = 300f)) { -it * 7 / 10 } + fadeOut(tween(160)))
                    },
                    label = "digit$index",
                ) { digit -> Text(digit.toString(), style = style) }
            }
        }
    }
}

@Composable
private fun SearchField(engine: String, onClick: () -> Unit) {
    val c = LocalVela.current
    Row(
        Modifier
            .widthIn(max = 560.dp)
            .fillMaxWidth()
            .height(52.dp)
            .glass(RoundedCornerShape(20.dp), elevation = 10.dp)
            .pressable(onClick)
            .semantics { contentDescription = "Search or type URL" }
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Search, null, Modifier.size(19.dp), tint = c.textFaint)
        Spacer(Modifier.width(12.dp))
        Text("Search $engine or type URL", style = VelaType.body, color = c.textFaint, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        SpaceDot(c.accent, size = 6.dp)
    }
}

@Composable
private fun TopSitesGrid(browser: Browser, sites: List<TopSite>, columns: Int) {
    Column(Modifier.widthIn(max = 560.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        sites.chunked(columns).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                row.forEach { site -> SiteTile(browser, site, Modifier.weight(1f)) }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun SiteTile(browser: Browser, site: TopSite, modifier: Modifier, tile: Dp = 56.dp) {
    val c = LocalVela.current
    Column(
        modifier
            .padding(horizontal = 2.dp)
            .pressable({ browser.navigate(site.url) })
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(tile)
                .background(c.surface, RoundedCornerShape(18.dp))
                .border(1.dp, c.ring, RoundedCornerShape(18.dp)),
            contentAlignment = Alignment.Center,
        ) {
            SiteIcon(site.host, browser.favicons, size = 26.dp, corner = 7.dp)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            siteLabel(site),
            style = VelaType.label,
            color = c.textMuted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
    }
}

/** "Sailing - Wikipedia" → "Wikipedia"; otherwise a short title, otherwise the site name from the host. */
private fun siteLabel(site: TopSite): String {
    val suffix = site.title.split(" - ", " | ", " — ", " · ").last().trim()
    if (suffix.isNotEmpty() && suffix.length <= 16 && suffix != site.title.trim()) return suffix
    if (site.title.isNotBlank() && site.title.length <= 16) return site.title.trim()
    return prettyHost(UrlInput.siteOf(site.host))
}

private fun prettyHost(host: String): String = host.removePrefix("www.").removePrefix("m.").substringBefore('.').replaceFirstChar { it.titlecase(Locale.getDefault()) }
