package org.velabrowser.vela.ui.omnibox

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.NorthWest
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.core.HistoryEntry
import org.velabrowser.vela.core.UrlInput
import org.velabrowser.vela.ui.components.IconAction
import org.velabrowser.vela.ui.components.SiteIcon
import org.velabrowser.vela.ui.components.SpaceDot
import org.velabrowser.vela.ui.components.glass
import org.velabrowser.vela.ui.components.pressable
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType

/** Address editing: scrim + floating input pinned above the keyboard, suggestions stacked above it. */
@Composable
fun OmniboxOverlay(browser: Browser) {
    val c = LocalVela.current
    val tab = browser.activeTab
    val engine = browser.settings.settings.searchEngine
    val initial = remember(tab?.id) { tab?.takeUnless { it.isNewTab }?.url?.let { UrlInput.editText(it, engine) }.orEmpty() }
    var field by remember(tab?.id) { mutableStateOf(TextFieldValue(initial, TextRange(0, initial.length))) }
    var suggestions by remember { mutableStateOf(emptyList<HistoryEntry>()) }
    val focus = remember { FocusRequester() }
    val text = field.text
    val edited = text != initial

    BackHandler { browser.editing = false }
    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(text, edited) {
        if (!edited || text.isBlank()) {
            suggestions = emptyList()
            return@LaunchedEffect
        }
        delay(50)
        suggestions = browser.history.suggest(text)
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(c.scrim)
            .clickable(null, null) { browser.editing = false },
    ) {
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AnimatedVisibility(
                visible = true,
                enter = fadeIn(tween(180)) + slideInVertically(spring(dampingRatio = 0.85f, stiffness = 500f)) { it / 6 },
                exit = fadeOut(),
            ) {
                Suggestions(browser, text, edited, suggestions)
            }
            InputIsland(
                value = field,
                onValueChange = { field = it },
                focus = focus,
                onGo = { browser.navigate(field.text) },
                onClear = { field = TextFieldValue("") },
                accent = c.accent,
            )
        }
    }
}

@Composable
private fun InputIsland(value: TextFieldValue, onValueChange: (TextFieldValue) -> Unit, focus: FocusRequester, onGo: () -> Unit, onClear: () -> Unit, accent: androidx.compose.ui.graphics.Color) {
    val c = LocalVela.current
    Row(
        Modifier
            .fillMaxWidth()
            .height(58.dp)
            .glass(RoundedCornerShape(24.dp), solid = true)
            .clickable(null, null) {}
            .padding(start = 18.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SpaceDot(accent, size = 8.dp)
        Spacer(Modifier.width(12.dp))
        Box(Modifier.weight(1f)) {
            if (value.text.isEmpty()) Text("Search or type URL", style = VelaType.body, color = c.textFaint)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = VelaType.body.copy(color = c.text),
                cursorBrush = SolidColor(accent),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                keyboardActions = KeyboardActions(onGo = { onGo() }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
        }
        if (value.text.isNotEmpty()) IconAction(Icons.Rounded.Cancel, "Clear", onClear, tint = c.textFaint, iconSize = 18.dp)
    }
}

@Composable
private fun Suggestions(browser: Browser, text: String, edited: Boolean, history: List<HistoryEntry>) {
    val c = LocalVela.current
    val tab = browser.activeTab
    val settings = browser.settings.settings
    val shape = RoundedCornerShape(24.dp)
    val resolved = if (edited) UrlInput.resolve(text, settings.searchEngine, settings.httpsOnly) else null

    if (!edited) {
        if (tab == null || tab.isNewTab) return
        Column(
            Modifier
                .fillMaxWidth()
                .glass(shape, solid = true)
                .clickable(null, null) {}
                .padding(vertical = 8.dp),
        ) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                SiteIcon(UrlInput.hostOf(tab.url), browser.favicons, size = 28.dp, corner = 8.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(tab.displayTitle, style = VelaType.bodyStrong, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(tab.url, style = VelaType.label, color = c.textFaint, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconAction(Icons.Rounded.ContentCopy, "Copy link", { browser.copyToClipboard("Link", tab.url); browser.editing = false }, tint = c.textMuted, iconSize = 18.dp)
                IconAction(Icons.Rounded.Share, "Share", { browser.editing = false; browser.share(tab.url, tab.title) }, tint = c.textMuted, iconSize = 18.dp)
            }
        }
        return
    }
    if (text.isBlank()) return

    Column(
        Modifier
            .fillMaxWidth()
            .glass(shape, solid = true)
            .clickable(null, null) {}
            .verticalScroll(rememberScrollState())
            .padding(vertical = 6.dp),
    ) {
        history.asReversed().forEach { entry ->
            SuggestionRow(
                leading = { SiteIcon(entry.host, browser.favicons, size = 22.dp) },
                title = entry.title.ifBlank { UrlInput.displayHost(entry.url) },
                subtitle = entry.url.removePrefix("https://").removePrefix("www."),
                trailing = Icons.Rounded.History,
                onClick = { browser.navigate(entry.url) },
            )
        }
        if (resolved is UrlInput.Resolved.Url) {
            SuggestionRow(
                leading = { Icon(Icons.Rounded.Public, null, Modifier.size(20.dp), tint = c.accent) },
                title = resolved.url.removePrefix("https://"),
                subtitle = "Open address",
                trailing = Icons.AutoMirrored.Rounded.ArrowForward,
                onClick = { browser.navigate(text) },
            )
        }
        val query = (resolved as? UrlInput.Resolved.Search)?.query ?: text.trim()
        SuggestionRow(
            leading = { Icon(Icons.Rounded.Search, null, Modifier.size(20.dp), tint = if (resolved is UrlInput.Resolved.Search) c.accent else c.textMuted) },
            title = query,
            subtitle = "Search ${settings.searchEngine.label}",
            trailing = Icons.Rounded.NorthWest,
            onClick = { browser.search(query) },
        )
    }
}

@Composable
private fun SuggestionRow(
    leading: @Composable () -> Unit,
    title: String,
    subtitle: String,
    trailing: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    val c = LocalVela.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 6.dp)
            .pressable(onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) { leading() }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = VelaType.bodyStrong, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = VelaType.label, color = c.textFaint, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(trailing, null, Modifier.size(16.dp), tint = c.textFaint)
    }
}
