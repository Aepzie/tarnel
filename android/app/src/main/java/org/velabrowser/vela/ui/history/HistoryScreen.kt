package org.velabrowser.vela.ui.history

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.Panel
import org.velabrowser.vela.core.HistoryEntry
import org.velabrowser.vela.core.UrlInput
import org.velabrowser.vela.ui.components.IconAction
import org.velabrowser.vela.ui.components.SectionLabel
import org.velabrowser.vela.ui.components.SiteIcon
import org.velabrowser.vela.ui.components.pressable
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** Searchable history grouped by day; tap opens, × deletes, "Clear" wipes everything. */
@Composable
fun HistoryScreen(browser: Browser) {
    val c = LocalVela.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<HistoryEntry>?>(null) }
    var revision by remember { mutableIntStateOf(0) }
    val close = { browser.panel = Panel.NONE }
    BackHandler(onBack = close)
    LaunchedEffect(query, revision) {
        if (query.isNotEmpty()) delay(120)
        entries = browser.history.list(query)
    }

    Column(Modifier.fillMaxSize().background(c.background).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconAction(Icons.AutoMirrored.Rounded.ArrowBack, "Back", close)
            Text("History", style = VelaType.title, color = c.text, modifier = Modifier.weight(1f).padding(start = 6.dp))
            if (!entries.isNullOrEmpty() && query.isEmpty()) {
                Text(
                    "Clear all",
                    style = VelaType.bodyStrong,
                    color = c.danger,
                    modifier = Modifier
                        .clip(CircleShape)
                        .pressable({
                            browser.clearHistory()
                            entries = emptyList()
                        })
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
        }
        SearchBox(query, { query = it }, Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
        val list = entries
        when {
            list == null -> Unit
            list.isEmpty() -> EmptyHistory(query.isNotEmpty())
            else -> {
                val groups = list.groupBy { dayLabel(it.lastVisit) }
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                    groups.forEach { (day, rows) ->
                        item(key = "h-$day") { SectionLabel(day) }
                        items(rows, key = { it.url }) { entry ->
                            HistoryRow(browser, entry, Modifier.animateItem()) {
                                scope.launch {
                                    browser.history.delete(entry.url)
                                    revision++
                                }
                            }
                        }
                    }
                    item { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
        }
    }
}

@Composable
private fun SearchBox(value: String, onChange: (String) -> Unit, modifier: Modifier) {
    val c = LocalVela.current
    Row(
        modifier
            .fillMaxWidth()
            .height(46.dp)
            .background(c.surface, RoundedCornerShape(16.dp))
            .border(1.dp, c.ring, RoundedCornerShape(16.dp))
            .padding(start = 14.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Search, null, Modifier.size(18.dp), tint = c.textFaint)
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text("Search history", style = VelaType.body, color = c.textFaint)
            BasicTextField(value, onChange, singleLine = true, textStyle = VelaType.body.copy(color = c.text), cursorBrush = SolidColor(c.accent), modifier = Modifier.fillMaxWidth())
        }
        if (value.isNotEmpty()) IconAction(Icons.Rounded.Close, "Clear search", { onChange("") }, size = 36.dp, iconSize = 16.dp, tint = c.textFaint)
    }
}

@Composable
private fun HistoryRow(browser: Browser, entry: HistoryEntry, modifier: Modifier, onDelete: () -> Unit) {
    val c = LocalVela.current
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .pressable({
                browser.panel = Panel.NONE
                browser.navigate(entry.url)
            })
            .padding(start = 12.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SiteIcon(entry.host, browser.favicons, size = 24.dp, corner = 7.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(entry.title.ifBlank { UrlInput.displayHost(entry.url) }, style = VelaType.bodyStrong, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${timeOf(entry.lastVisit)} · ${entry.url.removePrefix("https://").removePrefix("www.")}",
                style = VelaType.label,
                color = c.textFaint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconAction(Icons.Rounded.Close, "Delete from history", onDelete, size = 40.dp, iconSize = 17.dp, tint = c.textFaint)
    }
}

@Composable
private fun EmptyHistory(searching: Boolean) {
    val c = LocalVela.current
    Column(Modifier.fillMaxSize().padding(bottom = 120.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center) {
        Icon(Icons.Rounded.History, null, Modifier.size(36.dp), tint = c.textFaint)
        Spacer(Modifier.height(12.dp))
        Text(if (searching) "No matches" else "Nothing here yet", style = VelaType.heading, color = c.text)
        Spacer(Modifier.height(4.dp))
        Text(if (searching) "Try a different word or site." else "Pages you visit show up here. Burner spaces never do.", style = VelaType.label, color = c.textFaint)
    }
}

private fun dayLabel(time: Long): String {
    val day = Calendar.getInstance().apply { timeInMillis = time }
    val today = Calendar.getInstance()
    val yesterday = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }
    fun same(a: Calendar, b: Calendar) = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
    return when {
        same(day, today) -> "Today"
        same(day, yesterday) -> "Yesterday"
        else -> SimpleDateFormat("EEEE, d MMMM", Locale.getDefault()).format(day.time)
    }
}

private fun timeOf(time: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(time)
