package org.velabrowser.vela.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CleaningServices
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.Cookie
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.Https
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material.icons.rounded.PanTool
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.webkit.WebViewCompat
import org.velabrowser.vela.BuildConfig
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.Panel
import org.velabrowser.vela.core.NewtabHero
import org.velabrowser.vela.core.SearchEngine
import org.velabrowser.vela.core.Settings
import org.velabrowser.vela.core.ThemeMode
import org.velabrowser.vela.ui.components.IconAction
import org.velabrowser.vela.ui.components.ListRow
import org.velabrowser.vela.ui.components.Pill
import org.velabrowser.vela.ui.components.SectionLabel
import org.velabrowser.vela.ui.components.SpaceDot
import org.velabrowser.vela.ui.components.VelaAppIcon
import org.velabrowser.vela.ui.components.VelaSwitch
import org.velabrowser.vela.ui.components.pressable
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType

@Composable
fun SettingsScreen(browser: Browser) {
    val c = LocalVela.current
    val s = browser.settings.settings
    val close = { browser.panel = Panel.NONE }
    val update: ((Settings) -> Settings) -> Unit = { transform ->
        browser.settings.update(transform)
        browser.applySettingsToLiveTabs()
    }
    BackHandler(onBack = close)

    Column(Modifier.fillMaxSize().background(c.background).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconAction(Icons.AutoMirrored.Rounded.ArrowBack, "Back", close)
            Text("Settings", style = VelaType.title, color = c.text, modifier = Modifier.padding(start = 6.dp))
        }
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(bottom = 24.dp),
        ) {
            SectionLabel("Search engine")
            Group {
                SearchEngine.entries.forEach { engine ->
                    ListRow(
                        engine.label,
                        subtitle = engine.host,
                        onClick = { update { it.copy(searchEngine = engine) } },
                        trailing = { if (engine == s.searchEngine) Icon(Icons.Rounded.Check, "Selected", Modifier.size(20.dp), tint = c.accent) },
                    )
                }
            }

            SectionLabel("Appearance")
            Group {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ThemeMode.entries.forEach { mode ->
                        Pill(mode.label, Modifier.weight(1f), selected = s.theme == mode) { update { it.copy(theme = mode) } }
                    }
                }
                Text("New tab style", style = VelaType.label, color = c.textFaint, modifier = Modifier.padding(start = 20.dp, top = 4.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScrollCompat()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    NewtabHero.entries.forEach { hero ->
                        Pill(hero.label, selected = s.newtabHero == hero) { update { it.copy(newtabHero = hero) } }
                    }
                }
            }

            SectionLabel("Privacy & security")
            Group {
                Toggle("Block ads and trackers", "Blocked before they load. Fewer bytes, faster pages.", Icons.Rounded.Shield, s.adblock) { v -> update { it.copy(adblock = v) } }
                Toggle("HTTPS-only", "Upgrade every connection; warn before plain http.", Icons.Rounded.Https, s.httpsOnly) { v -> update { it.copy(httpsOnly = v) } }
                Toggle("Block third-party cookies", "Stops cross-site tracking cookies.", Icons.Rounded.Cookie, s.blockThirdPartyCookies) { v -> update { it.copy(blockThirdPartyCookies = v) } }
                Toggle("Do Not Track & GPC", "Ask sites not to track or sell your data.", Icons.Rounded.PanTool, s.doNotTrack) { v -> update { it.copy(doNotTrack = v) } }
                ListRow("Safe Browsing", icon = Icons.Rounded.VerifiedUser, subtitle = "Always on — warns about phishing and malware.")
            }

            SectionLabel("Your data")
            Group {
                browser.spaces.forEach { space ->
                    ListRow(
                        "Clear data in ${space.name}",
                        subtitle = if (browser.profilesSupported) "Cookies, logins, storage and cache of this Space only" else "Cookies and storage (Spaces share one profile on this WebView)",
                        leading = {
                            Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
                                if (space.burner) Icon(Icons.Rounded.LocalFireDepartment, null, Modifier.size(18.dp), tint = Color(space.color))
                                else SpaceDot(Color(space.color), size = 9.dp)
                            }
                        },
                        onClick = { browser.clearSpaceData(space) },
                        trailing = { Icon(Icons.Rounded.CleaningServices, null, Modifier.size(18.dp), tint = c.textFaint) },
                    )
                }
                ListRow("Clear browsing history", icon = Icons.Rounded.DeleteSweep, subtitle = "History and saved site icons", onClick = {
                    browser.clearHistory()
                    browser.message = org.velabrowser.vela.browser.UiMessage("History cleared")
                })
            }

            SectionLabel("About")
            About(browser)
        }
    }
}

@Composable
private fun Modifier.horizontalScrollCompat(): Modifier = this.then(Modifier.horizontalScroll(rememberScrollState()))

@Composable
private fun Group(content: @Composable ColumnScope.() -> Unit) {
    val c = LocalVela.current
    Column(
        Modifier
            .padding(horizontal = 12.dp)
            .fillMaxWidth()
            .background(c.surface, RoundedCornerShape(20.dp))
            .border(1.dp, c.ring, RoundedCornerShape(20.dp))
            .padding(vertical = 4.dp),
        content = content,
    )
}

@Composable
private fun Toggle(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, checked: Boolean, onChange: (Boolean) -> Unit) {
    ListRow(title, icon = icon, subtitle = subtitle, onClick = { onChange(!checked) }, trailing = { VelaSwitch(checked, onChange) })
}

@Composable
private fun About(browser: Browser) {
    val c = LocalVela.current
    val context = LocalContext.current
    val webView = remember { runCatching { WebViewCompat.getCurrentWebViewPackage(context) }.getOrNull() }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(c.surface, RoundedCornerShape(20.dp))
                .border(1.dp, c.ring, RoundedCornerShape(20.dp))
                .padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            VelaAppIcon(size = 52.dp)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text("Vela for Android", style = VelaType.heading, color = c.text)
                Text("Version ${BuildConfig.VERSION_NAME}", style = VelaType.label, color = c.textFaint)
                Text(
                    "WebView ${webView?.versionName ?: "unknown"} · Spaces ${if (browser.profilesSupported) "isolated" else "shared"}",
                    style = VelaType.label,
                    color = c.textFaint,
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill("Source code", leading = { Icon(Icons.Rounded.Code, null, Modifier.size(14.dp), tint = c.textMuted) }) {
                browser.panel = Panel.NONE
                browser.openInNewTab("https://github.com/Aepzie/vela")
            }
            Pill("MIT License", leading = { Icon(Icons.Rounded.Info, null, Modifier.size(14.dp), tint = c.textMuted) }) {
                browser.panel = Panel.NONE
                browser.openInNewTab("https://github.com/Aepzie/vela/blob/main/LICENSE")
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "No account, no telemetry, no sync servers.",
            style = VelaType.label,
            color = c.textFaint,
            modifier = Modifier.widthIn(max = 420.dp).padding(horizontal = 8.dp),
        )
    }
}
