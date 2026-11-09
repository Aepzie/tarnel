package org.velabrowser.vela.ui.spaces

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CleaningServices
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.Panel
import org.velabrowser.vela.core.Space
import org.velabrowser.vela.core.SpaceColors
import org.velabrowser.vela.ui.components.IconAction
import org.velabrowser.vela.ui.components.ListRow
import org.velabrowser.vela.ui.components.SectionLabel
import org.velabrowser.vela.ui.components.SpaceDot
import org.velabrowser.vela.ui.components.VelaSheet
import org.velabrowser.vela.ui.components.pressable
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType

private sealed interface SpaceMode {
    data object List : SpaceMode
    data class Edit(val space: Space?) : SpaceMode
    data class ConfirmDelete(val space: Space) : SpaceMode
}

/** Space switcher + editor: switch, create, rename/recolor, clear data, delete, open/close a Burner. */
@Composable
fun SpacesSheet(browser: Browser) {
    var mode by remember { mutableStateOf<SpaceMode>(SpaceMode.List) }
    val dismiss = { browser.panel = Panel.NONE }
    VelaSheet(onDismiss = dismiss) {
        AnimatedContent(mode, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "spaces") { current ->
            when (current) {
                SpaceMode.List -> SpaceList(browser, onEdit = { mode = SpaceMode.Edit(it) }, onDelete = { mode = SpaceMode.ConfirmDelete(it) }, dismiss = dismiss)
                is SpaceMode.Edit -> SpaceEditor(current.space, used = browser.spaces.map { it.color }.toSet(), onCancel = { mode = SpaceMode.List }) { name, color ->
                    if (current.space == null) {
                        browser.createSpace(name, color)
                        dismiss()
                    } else {
                        browser.updateSpace(current.space, name, color)
                        mode = SpaceMode.List
                    }
                }
                is SpaceMode.ConfirmDelete -> ConfirmDelete(current.space, onCancel = { mode = SpaceMode.List }) {
                    browser.deleteSpace(current.space)
                    mode = SpaceMode.List
                }
            }
        }
    }
}

@Composable
private fun SpaceList(browser: Browser, onEdit: (Space?) -> Unit, onDelete: (Space) -> Unit, dismiss: () -> Unit) {
    val c = LocalVela.current
    Column {
        Text("Spaces", style = VelaType.title, color = c.text, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
        Text(
            "Each Space has its own cookies, logins, storage and cache.",
            style = VelaType.label,
            color = c.textFaint,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        if (!browser.profilesSupported) {
            Row(
                Modifier
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .fillMaxWidth()
                    .background(Color(0x1FFBBF24), RoundedCornerShape(14.dp))
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.Info, null, Modifier.size(18.dp), tint = Color(0xFFFBBF24))
                Spacer(Modifier.width(10.dp))
                Text(
                    "This Android System WebView can't isolate Spaces yet — they share one profile. Update WebView from Google Play for full isolation and Burner spaces.",
                    style = VelaType.label,
                    color = c.textMuted,
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        browser.spaces.forEach { space ->
            val active = space.id == browser.activeSpaceId
            val count = browser.tabsIn(space.id).size
            ListRow(
                title = space.name,
                subtitle = when {
                    space.burner -> "Burner · wiped when closed · $count ${if (count == 1) "tab" else "tabs"}"
                    else -> "$count ${if (count == 1) "tab" else "tabs"}"
                },
                leading = {
                    Box(
                        Modifier
                            .size(34.dp)
                            .background(Color(space.color).copy(alpha = 0.14f), CircleShape)
                            .border(1.dp, Color(space.color).copy(alpha = if (active) 0.7f else 0.2f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (space.burner) Icon(Icons.Rounded.LocalFireDepartment, null, Modifier.size(17.dp), tint = Color(space.color))
                        else SpaceDot(Color(space.color), size = 10.dp)
                    }
                },
                onClick = {
                    browser.switchSpace(space)
                    dismiss()
                },
                trailing = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (space.burner) {
                            Text(
                                "Close",
                                style = VelaType.label,
                                color = c.danger,
                                modifier = Modifier.clip(CircleShape).pressable({ browser.closeBurner(space) }).padding(horizontal = 12.dp, vertical = 8.dp),
                            )
                        } else {
                            IconAction(Icons.Rounded.CleaningServices, "Clear data of ${space.name}", { browser.clearSpaceData(space) }, tint = c.textFaint, size = 36.dp, iconSize = 18.dp)
                            IconAction(Icons.Rounded.Edit, "Edit ${space.name}", { onEdit(space) }, tint = c.textFaint, size = 36.dp, iconSize = 18.dp)
                            if (browser.spaces.count { !it.burner } > 1) {
                                IconAction(Icons.Rounded.DeleteOutline, "Delete ${space.name}", { onDelete(space) }, tint = c.textFaint, size = 36.dp, iconSize = 18.dp)
                            }
                        }
                        if (active) Icon(Icons.Rounded.Check, "Active", Modifier.padding(start = 4.dp).size(18.dp), tint = c.accent)
                    }
                },
            )
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionTile("New Space", Icons.Rounded.Add, c.accent, Modifier.weight(1f)) { onEdit(null) }
            if (browser.profilesSupported && browser.spaces.none { it.burner }) {
                ActionTile("Burner", Icons.Rounded.LocalFireDepartment, Color(SpaceColors.BURNER), Modifier.weight(1f)) {
                    browser.openBurner()
                    dismiss()
                }
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun ActionTile(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, modifier: Modifier, onClick: () -> Unit) {
    val c = LocalVela.current
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier
            .height(52.dp)
            .clip(shape)
            .background(tint.copy(alpha = 0.1f), shape)
            .border(1.dp, tint.copy(alpha = 0.28f), shape)
            .pressable(onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(icon, null, Modifier.size(18.dp), tint = tint)
        Spacer(Modifier.width(8.dp))
        Text(label, style = VelaType.bodyStrong, color = c.text)
    }
}

@Composable
private fun SpaceEditor(space: Space?, used: Set<Long> = emptySet(), onCancel: () -> Unit, onSave: (String, Long) -> Unit) {
    val c = LocalVela.current
    var name by remember { mutableStateOf(space?.name.orEmpty()) }
    var color by remember { mutableLongStateOf(space?.color ?: SpaceColors.all.drop(1).firstOrNull { it !in used } ?: SpaceColors.all[1]) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Column(Modifier.imePadding().padding(horizontal = 20.dp)) {
        Text(if (space == null) "New Space" else "Edit Space", style = VelaType.title, color = c.text, modifier = Modifier.padding(vertical = 6.dp))
        Spacer(Modifier.height(12.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .background(c.surface, RoundedCornerShape(16.dp))
                .border(1.dp, Color(color).copy(alpha = 0.5f), RoundedCornerShape(16.dp))
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SpaceDot(Color(color), size = 10.dp)
            Spacer(Modifier.width(12.dp))
            Box(Modifier.weight(1f)) {
                if (name.isEmpty()) Text("Name (e.g. Work)", style = VelaType.body, color = c.textFaint)
                BasicTextField(
                    value = name,
                    onValueChange = { name = it.take(32) },
                    singleLine = true,
                    textStyle = VelaType.body.copy(color = c.text),
                    cursorBrush = SolidColor(Color(color)),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { onSave(name, color) }),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
            }
        }
        Spacer(Modifier.height(18.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            SpaceColors.all.forEach { option ->
                val selected = option == color
                Box(
                    Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .border(2.dp, if (selected) Color(option) else Color.Transparent, CircleShape)
                        .pressable({ color = option })
                        .padding(6.dp)
                        .background(Color(option), CircleShape),
                )
            }
        }
        Spacer(Modifier.height(22.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SheetButton("Cancel", c.surface, c.text, Modifier.weight(1f), onCancel)
            SheetButton(if (space == null) "Create" else "Save", Color(color), Color(0xFF09090B), Modifier.weight(1f)) { onSave(name, color) }
        }
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun ConfirmDelete(space: Space, onCancel: () -> Unit, onConfirm: () -> Unit) {
    val c = LocalVela.current
    Column(Modifier.padding(horizontal = 20.dp)) {
        Text("Delete “${space.name}”?", style = VelaType.title, color = c.text, modifier = Modifier.padding(vertical = 6.dp))
        Text(
            "Its tabs close and every cookie, login, site storage and cached file in this Space is wiped. This can't be undone.",
            style = VelaType.body,
            color = c.textMuted,
        )
        Spacer(Modifier.height(22.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SheetButton("Cancel", c.surface, c.text, Modifier.weight(1f), onCancel)
            SheetButton("Delete", c.danger, Color.White, Modifier.weight(1f), onConfirm)
        }
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
fun SheetButton(label: String, background: Color, content: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = LocalVela.current
    val shape = RoundedCornerShape(16.dp)
    Box(
        modifier
            .height(50.dp)
            .clip(shape)
            .background(background, shape)
            .border(1.dp, c.ring, shape)
            .pressable(onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = VelaType.bodyStrong, color = content)
    }
}
