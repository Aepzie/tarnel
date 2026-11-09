package org.velabrowser.vela.ui.island

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.Panel
import org.velabrowser.vela.browser.Tab
import org.velabrowser.vela.core.UrlInput
import org.velabrowser.vela.ui.components.IconAction
import org.velabrowser.vela.ui.components.SpaceDot
import org.velabrowser.vela.ui.components.glass
import org.velabrowser.vela.ui.components.pressable
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType

private val IslandShape = RoundedCornerShape(24.dp)

/**
 * The floating bottom island — the mobile take on desktop's top island. Collapses to a small address pill
 * while reading (drag down) and springs back on drag up, at the top of the page, or on tap.
 */
@Composable
fun BottomIsland(browser: Browser, modifier: Modifier = Modifier) {
    val tab = browser.activeTab
    val expanded = browser.islandExpanded || tab == null || tab.isNewTab || tab.error != null
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(
            visible = expanded,
            enter = slideInVertically(spring(dampingRatio = 0.82f, stiffness = 420f)) { it / 2 } + fadeIn(tween(160)) +
                scaleIn(spring(dampingRatio = 0.8f, stiffness = 420f), initialScale = 0.94f),
            exit = slideOutVertically(spring(stiffness = Spring.StiffnessMedium)) { it / 2 } + fadeOut(tween(140)) +
                scaleOut(tween(180), targetScale = 0.94f),
        ) {
            FullIsland(browser, tab)
        }
        AnimatedVisibility(
            visible = !expanded,
            enter = fadeIn(tween(200, delayMillis = 80)) + scaleIn(spring(dampingRatio = 0.75f, stiffness = 500f), initialScale = 0.8f),
            exit = fadeOut(tween(120)) + scaleOut(tween(140), targetScale = 0.85f),
        ) {
            MiniIsland(tab) { browser.islandExpanded = true }
        }
    }
}

@Composable
private fun FullIsland(browser: Browser, tab: Tab?) {
    val c = LocalVela.current
    Box(
        Modifier
            .padding(horizontal = 12.dp)
            .fillMaxWidth()
            .height(58.dp)
            .glass(IslandShape),
    ) {
        Row(
            Modifier.fillMaxHeight().padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(Icons.AutoMirrored.Rounded.ArrowBack, "Back", { browser.goBack() }, enabled = tab?.canGoBack == true || tab?.error != null)
            AnimatedVisibility(
                visible = tab?.canGoForward == true,
                enter = expandHorizontally(spring(stiffness = 500f)) + fadeIn(),
                exit = shrinkHorizontally(spring(stiffness = 500f)) + fadeOut(),
            ) {
                IconAction(Icons.AutoMirrored.Rounded.ArrowForward, "Forward", { browser.goForward() })
            }
            Spacer(Modifier.width(4.dp))
            Omnibox(browser, tab, Modifier.weight(1f))
            Spacer(Modifier.width(4.dp))
            TabsButton(count = browser.tabsIn(browser.activeSpaceId).size, onClick = { browser.openTabSwitcher() }, onLongClick = { browser.newTab() })
            IconAction(Icons.Rounded.MoreHoriz, "Menu", { browser.panel = Panel.MENU })
        }
        LoadingBar(tab, Modifier.align(Alignment.BottomCenter))
        if (c.dark) Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(1.dp).background(c.highlight))
    }
}

@Composable
private fun Omnibox(browser: Browser, tab: Tab?, modifier: Modifier) {
    val c = LocalVela.current
    val engine = browser.settings.settings.searchEngine
    val url = tab?.url.orEmpty()
    val query = UrlInput.searchQueryOf(url, engine)
    val showUrl = tab != null && !tab.isNewTab
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier
            .height(40.dp)
            .clip(shape)
            .background(c.surface, shape)
            .border(1.dp, c.ring.copy(alpha = 0.5f), shape)
            .pressable({ browser.editing = true })
            .semantics { contentDescription = "Address bar" }
            .padding(start = 12.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when {
            !showUrl -> Icon(Icons.Rounded.Search, null, Modifier.size(16.dp), tint = c.textFaint)
            query != null -> Icon(Icons.Rounded.Search, null, Modifier.size(15.dp), tint = c.accent)
            tab?.secure == true -> Icon(Icons.Rounded.Lock, "Secure connection", Modifier.size(14.dp), tint = c.textMuted)
            url.startsWith("http://") -> Icon(Icons.Rounded.Warning, "Not secure", Modifier.size(15.dp), tint = Color(0xFFFBBF24))
            else -> SpaceDot(c.accent, size = 7.dp)
        }
        Spacer(Modifier.width(8.dp))
        Text(
            text = when {
                !showUrl -> "Search or type URL"
                query != null -> query
                else -> UrlInput.displayHost(url)
            },
            style = VelaType.omnibox,
            color = if (showUrl) c.text else c.textFaint,
            fontWeight = if (showUrl) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (showUrl) {
            val loading = tab?.loading == true
            IconAction(
                if (loading) Icons.Rounded.Close else Icons.Rounded.Refresh,
                if (loading) "Stop" else "Reload",
                { if (loading) browser.stop() else browser.reload() },
                size = 34.dp,
                iconSize = 17.dp,
                tint = c.textMuted,
            )
        }
    }
}

@Composable
private fun TabsButton(count: Int, onClick: () -> Unit, onLongClick: () -> Unit) {
    val c = LocalVela.current
    Box(
        Modifier
            .size(40.dp)
            .clip(CircleShape)
            .pressable(onClick, bounded = false, onLongClick = onLongClick)
            .semantics { contentDescription = "$count tabs" },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(21.dp)
                .border(1.6.dp, c.text, RoundedCornerShape(6.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (count > 99) "∞" else count.toString(),
                color = c.text,
                fontSize = if (count > 9) 9.sp else 11.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun LoadingBar(tab: Tab?, modifier: Modifier) {
    val c = LocalVela.current
    val loading = tab?.loading == true
    val progress by animateFloatAsState(if (loading) ((tab?.progress ?: 0).coerceAtLeast(8) / 100f) else 1f, spring(stiffness = 120f), label = "progress")
    val alpha by animateFloatAsState(if (loading) 1f else 0f, tween(if (loading) 120 else 420), label = "progressAlpha")
    Box(
        modifier
            .padding(horizontal = 22.dp)
            .fillMaxWidth()
            .height(2.dp)
            .graphicsLayer { this.alpha = alpha },
    ) {
        Box(
            Modifier
                .fillMaxWidth(progress)
                .fillMaxHeight()
                .background(c.accent, CircleShape),
        )
    }
}

@Composable
private fun MiniIsland(tab: Tab?, onClick: () -> Unit) {
    val c = LocalVela.current
    val shape = CircleShape
    Row(
        Modifier
            .padding(bottom = 4.dp)
            .widthIn(min = 120.dp, max = 260.dp)
            .height(32.dp)
            .glass(shape, elevation = 10.dp)
            .pressable(onClick)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (tab?.secure == true) {
            Icon(Icons.Rounded.Lock, null, Modifier.size(11.dp), tint = c.textMuted)
            Spacer(Modifier.width(6.dp))
        }
        Text(
            tab?.url?.let(UrlInput::displayHost).orEmpty(),
            style = VelaType.label,
            color = c.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (tab?.loading == true) {
            Spacer(Modifier.width(8.dp))
            SpaceDot(c.accent, size = 5.dp)
        }
    }
}
