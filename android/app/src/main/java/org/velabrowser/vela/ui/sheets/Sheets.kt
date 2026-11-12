package org.velabrowser.vela.ui.sheets

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Tab
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.ViewAgenda
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.ContextTarget
import org.velabrowser.vela.browser.ExternalPrompt
import org.velabrowser.vela.browser.Panel
import org.velabrowser.vela.browser.PermissionKind
import org.velabrowser.vela.browser.PermissionPrompt
import org.velabrowser.vela.core.SpaceColors
import org.velabrowser.vela.core.UrlInput
import org.velabrowser.vela.ui.components.Hairline
import org.velabrowser.vela.ui.components.ListRow
import org.velabrowser.vela.ui.components.SectionLabel
import org.velabrowser.vela.ui.components.SiteIcon
import org.velabrowser.vela.ui.components.SpaceDot
import org.velabrowser.vela.ui.components.VelaSheet
import org.velabrowser.vela.ui.components.VelaSwitch
import org.velabrowser.vela.ui.components.pressable
import org.velabrowser.vela.ui.spaces.SheetButton
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType

@Composable
fun MenuSheet(browser: Browser) {
    val c = LocalVela.current
    val tab = browser.activeTab
    val dismiss = { browser.panel = Panel.NONE }
    VelaSheet(onDismiss = dismiss) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            QuickTile("New tab", Icons.Rounded.Add, Modifier.weight(1f)) { dismiss(); browser.newTab() }
            QuickTile("Burner", Icons.Rounded.LocalFireDepartment, Modifier.weight(1f), tint = Color(SpaceColors.BURNER)) { dismiss(); browser.openBurner() }
            QuickTile("Share", Icons.Rounded.Share, Modifier.weight(1f), enabled = tab != null && !tab.isNewTab) {
                dismiss()
                tab?.let { browser.share(it.url, it.title) }
            }
        }
        if (tab != null && !tab.isNewTab) {
            Row(
                Modifier
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .fillMaxWidth()
                    .background(c.surface, RoundedCornerShape(16.dp))
                    .border(1.dp, c.ring, RoundedCornerShape(16.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.Shield, null, Modifier.size(20.dp), tint = c.accent)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        when (val n = tab.blocked) {
                            0 -> "No trackers blocked on this page"
                            1 -> "1 ad or tracker blocked"
                            else -> "$n ads and trackers blocked"
                        },
                        style = VelaType.bodyStrong,
                        color = c.text,
                    )
                    Text(
                        if (browser.settings.settings.adblock) UrlInput.displayHost(tab.url) else "Ad blocking is off",
                        style = VelaType.label,
                        color = c.textFaint,
                    )
                }
            }
        }
        Spacer(Modifier.height(4.dp))
        if (tab != null && !tab.isNewTab) {
            ListRow("Find in page", icon = Icons.Rounded.Search, onClick = { browser.openFind() })
            ListRow(
                "Desktop site",
                icon = Icons.Rounded.Computer,
                onClick = { dismiss(); browser.toggleDesktopSite(tab) },
                trailing = { VelaSwitch(tab.desktopMode) { dismiss(); browser.toggleDesktopSite(tab) } },
            )
            Hairline(Modifier.padding(vertical = 4.dp))
        }
        ListRow("Spaces", icon = Icons.Rounded.ViewAgenda, subtitle = browser.activeSpace.name, onClick = { browser.panel = Panel.SPACES }, trailing = {
            SpaceDot(Color(browser.activeSpace.color))
        })
        ListRow("History", icon = Icons.Rounded.History, onClick = { browser.panel = Panel.HISTORY })
        ListRow("Downloads", icon = Icons.Rounded.Download, onClick = { dismiss(); browser.downloads.showAll() })
        ListRow("Settings", icon = Icons.Rounded.Settings, onClick = { browser.panel = Panel.SETTINGS })
    }
}

@Composable
private fun QuickTile(label: String, icon: ImageVector, modifier: Modifier, tint: Color = LocalVela.current.text, enabled: Boolean = true, onClick: () -> Unit) {
    val c = LocalVela.current
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .height(76.dp)
            .clip(shape)
            .background(c.surface, shape)
            .border(1.dp, c.ring, shape)
            .pressable(onClick, enabled = enabled)
            .padding(12.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = if (enabled) tint else c.textFaint)
        Text(label, style = VelaType.label, color = if (enabled) c.text else c.textFaint)
    }
}

@Composable
fun ContextMenuSheet(browser: Browser, target: ContextTarget) {
    val c = LocalVela.current
    val tab = browser.tabs.firstOrNull { it.id == target.tabId }
    val dismiss = { browser.contextTarget = null }
    val link = target.link
    val image = target.image
    VelaSheet(onDismiss = dismiss) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            SiteIcon(UrlInput.hostOf(link ?: image.orEmpty()), browser.favicons, size = 32.dp, corner = 9.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    target.linkText?.takeIf { it.isNotBlank() } ?: UrlInput.displayHost(link ?: image.orEmpty()),
                    style = VelaType.bodyStrong,
                    color = c.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text((link ?: image).orEmpty(), style = VelaType.label, color = c.textFaint, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        Hairline(Modifier.padding(vertical = 6.dp))
        if (link != null) {
            ListRow("Open in new tab", icon = Icons.Rounded.Tab, onClick = { dismiss(); browser.openInNewTab(link) })
            ListRow("Open in background", icon = Icons.AutoMirrored.Rounded.OpenInNew, onClick = { dismiss(); browser.openInNewTab(link, background = true) })
            val others = browser.spaces.filter { it.id != tab?.spaceId }
            if (others.isNotEmpty()) {
                SectionLabel("Open in another Space")
                others.forEach { space ->
                    ListRow(
                        space.name,
                        leading = {
                            Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
                                if (space.burner) Icon(Icons.Rounded.LocalFireDepartment, null, Modifier.size(18.dp), tint = Color(space.color))
                                else SpaceDot(Color(space.color), size = 9.dp)
                            }
                        },
                        onClick = { dismiss(); browser.openInNewTab(link, spaceId = space.id) },
                    )
                }
                Spacer(Modifier.height(6.dp))
            }
            ListRow("Copy link", icon = Icons.Rounded.ContentCopy, onClick = { dismiss(); browser.copyToClipboard("Link", link) })
            ListRow("Share link", icon = Icons.Rounded.Share, onClick = { dismiss(); browser.share(link, target.linkText) })
        }
        if (image != null) {
            if (link != null) Hairline(Modifier.padding(vertical = 6.dp))
            ListRow("Open image in new tab", icon = Icons.Rounded.Image, onClick = { dismiss(); browser.openInNewTab(image) })
            if (image.startsWith("http")) {
                ListRow("Download image", icon = Icons.Rounded.Download, onClick = {
                    dismiss()
                    tab?.let { browser.download(it, image, null, null, null) }
                })
            }
            ListRow("Copy image link", icon = Icons.Rounded.ContentCopy, onClick = { dismiss(); browser.copyToClipboard("Image link", image) })
        }
    }
}

@Composable
fun PermissionSheet(browser: Browser, prompt: PermissionPrompt) {
    val c = LocalVela.current
    val host = UrlInput.hostOf(prompt.origin) ?: prompt.origin
    val what = prompt.kinds.joinToString(" and ") { it.label }
    VelaSheet(onDismiss = { prompt.decide(false) }) {
        Column(Modifier.padding(horizontal = 20.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                prompt.kinds.forEach { kind ->
                    Box(
                        Modifier
                            .size(44.dp)
                            .background(c.accent.copy(alpha = 0.14f), CircleShape)
                            .border(1.dp, c.accent.copy(alpha = 0.3f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            when (kind) {
                                PermissionKind.CAMERA -> Icons.Rounded.Videocam
                                PermissionKind.MICROPHONE -> Icons.Rounded.Mic
                                PermissionKind.LOCATION -> Icons.Rounded.LocationOn
                            },
                            null,
                            Modifier.size(22.dp),
                            tint = c.accent,
                        )
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            Text("$host wants to use your $what", style = VelaType.title.copy(fontSize = VelaType.heading.fontSize * 1.2f), color = c.text)
            Spacer(Modifier.height(6.dp))
            Text(
                "Only for this Space, until you close Tarnel. Tarnel never grants access without asking.",
                style = VelaType.body,
                color = c.textMuted,
            )
            Spacer(Modifier.height(22.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SheetButton("Block", c.surface, c.text, Modifier.weight(1f)) { prompt.decide(false) }
                SheetButton("Allow", c.accent, c.onAccent, Modifier.weight(1f)) { prompt.decide(true) }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
fun ExternalAppSheet(browser: Browser, prompt: ExternalPrompt) {
    val c = LocalVela.current
    VelaSheet(onDismiss = { browser.externalPrompt = null }) {
        Column(Modifier.padding(horizontal = 20.dp)) {
            Icon(Icons.AutoMirrored.Rounded.OpenInNew, null, Modifier.size(28.dp), tint = c.accent)
            Spacer(Modifier.height(14.dp))
            Text("Open in ${prompt.target}?", style = VelaType.title, color = c.text)
            Spacer(Modifier.height(6.dp))
            Text("This page wants to leave Tarnel and open another app.", style = VelaType.body, color = c.textMuted)
            Spacer(Modifier.height(22.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SheetButton("Stay", c.surface, c.text, Modifier.weight(1f)) { browser.externalPrompt = null }
                SheetButton("Open", c.accent, c.onAccent, Modifier.weight(1f)) { browser.launchExternal(prompt) }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}
