package org.velabrowser.vela.ui.tabs

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Bedtime
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.zIndex
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.Panel
import org.velabrowser.vela.browser.Tab
import org.velabrowser.vela.core.Space
import org.velabrowser.vela.core.UrlInput
import org.velabrowser.vela.ui.components.IconAction
import org.velabrowser.vela.ui.components.Pill
import org.velabrowser.vela.ui.components.SiteIcon
import org.velabrowser.vela.ui.components.SpaceDot
import org.velabrowser.vela.ui.components.VelaMark
import org.velabrowser.vela.ui.components.glass
import org.velabrowser.vela.ui.components.pressable
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType
import kotlin.math.abs

/** Grid of the active Space's tabs. Swipe a card sideways to close it; predictive back shrinks the sheet. */
@Composable
fun TabSwitcher(browser: Browser) {
    val c = LocalVela.current
    val spaceTabs = browser.tabsIn(browser.activeSpaceId)
    val active = browser.activeTab
    var backProgress by remember { mutableFloatStateOf(0f) }
    val close = {
        browser.panel = Panel.NONE
        browser.ensureActiveTab()
    }

    PredictiveBackHandler { events ->
        try {
            events.collect { backProgress = it.progress }
            close()
        } catch (_: CancellationException) {
            backProgress = 0f
        }
    }

    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .graphicsLayer {
                val s = 1f - backProgress * 0.08f
                scaleX = s
                scaleY = s
                alpha = 1f - backProgress * 0.3f
            }
            .clip(RoundedCornerShape((backProgress * 32).dp))
            .background(c.background),
    ) {
        val columns = if (maxWidth > 600.dp) 4 else if (maxWidth > maxHeight) 3 else 2
        val portrait = maxHeight > maxWidth
        val grid = rememberLazyGridState()
        val reorder = remember { ReorderState() }
        val haptics = LocalHapticFeedback.current
        LaunchedEffect(Unit) {
            val index = spaceTabs.indexOf(active)
            if (index > 3) grid.scrollToItem(index)
        }
        Column(Modifier.fillMaxSize()) {
            SpaceStrip(browser, Modifier.statusBarsPadding())
            if (spaceTabs.isEmpty()) {
                EmptySpace(browser.activeSpace, Modifier.weight(1f)) { browser.newTab(); browser.panel = Panel.NONE }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(columns),
                    state = grid,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 6.dp, bottom = 110.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(spaceTabs, key = { it.id }) { tab ->
                        val dragging = reorder.draggingId == tab.id
                        TabCard(
                            browser = browser,
                            tab = tab,
                            selected = tab === active,
                            portrait = portrait,
                            onOpen = {
                                browser.select(tab)
                                browser.panel = Panel.NONE
                            },
                            onClose = { browser.closeTab(tab) },
                            modifier = Modifier
                                .animateItem(placementSpec = if (dragging) null else spring(dampingRatio = 0.86f, stiffness = 520f))
                                .zIndex(if (dragging) 1f else 0f)
                                .graphicsLayer {
                                    if (dragging) {
                                        translationX = reorder.offset.x
                                        translationY = reorder.offset.y
                                        scaleX = 1.04f
                                        scaleY = 1.04f
                                    }
                                },
                            reorderModifier = Modifier.pointerInput(tab.id) {
                                detectDragGesturesAfterLongPress(
                                    onDragStart = {
                                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                        reorder.start(tab.id)
                                    },
                                    onDrag = { change, amount ->
                                        change.consume()
                                        reorder.drag(amount, grid) { from, to ->
                                            val moving = browser.tabs.firstOrNull { it.id == from }
                                            val target = browser.tabs.firstOrNull { it.id == to }
                                            if (moving != null && target != null) browser.moveTab(moving, target)
                                        }
                                    },
                                    onDragEnd = { reorder.stop() },
                                    onDragCancel = { reorder.stop() },
                                )
                            },
                            reordering = dragging,
                        )
                    }
                }
            }
        }
        BottomBar(browser, Modifier.align(Alignment.BottomCenter), onDone = close)
    }
}

/** Long-press drag to reorder: the dragged card follows the finger and swaps with the card under its centre. */
private class ReorderState {
    var draggingId by mutableStateOf<String?>(null)
        private set
    var offset by mutableStateOf(Offset.Zero)
        private set

    fun start(id: String) {
        draggingId = id
        offset = Offset.Zero
    }

    fun drag(amount: Offset, grid: LazyGridState, move: (from: String, to: String) -> Unit) {
        val id = draggingId ?: return
        offset += amount
        val items = grid.layoutInfo.visibleItemsInfo
        val current = items.firstOrNull { it.key == id } ?: return
        val center = Offset(current.offset.x + current.size.width / 2f, current.offset.y + current.size.height / 2f) + offset
        val target = items.firstOrNull { item ->
            item.key != id &&
                center.x in item.offset.x.toFloat()..(item.offset.x + item.size.width).toFloat() &&
                center.y in item.offset.y.toFloat()..(item.offset.y + item.size.height).toFloat()
        } ?: return
        move(id, target.key as String)
        offset += Offset((current.offset.x - target.offset.x).toFloat(), (current.offset.y - target.offset.y).toFloat())
    }

    fun stop() {
        draggingId = null
        offset = Offset.Zero
    }
}

@Composable
private fun SpaceStrip(browser: Browser, modifier: Modifier) {
    val c = LocalVela.current
    Row(
        modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        browser.spaces.forEach { space ->
            val count = browser.tabsIn(space.id).size
            Pill(
                text = if (count > 0) "${space.name}  $count" else space.name,
                selected = space.id == browser.activeSpaceId,
                leading = {
                    if (space.burner) Icon(Icons.Rounded.LocalFireDepartment, null, Modifier.size(14.dp), tint = Color(space.color))
                    else SpaceDot(Color(space.color), size = 8.dp, glow = space.id == browser.activeSpaceId)
                },
                onClick = { browser.switchSpace(space) },
            )
        }
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(c.surface, CircleShape)
                .border(1.dp, c.ring, CircleShape)
                .pressable({ browser.panel = Panel.SPACES }),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Tune, "Manage Spaces", Modifier.size(17.dp), tint = c.textMuted)
        }
    }
}

@Composable
private fun TabCard(
    browser: Browser,
    tab: Tab,
    selected: Boolean,
    portrait: Boolean,
    onOpen: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    reorderModifier: Modifier = Modifier,
    reordering: Boolean = false,
) {
    val c = LocalVela.current
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    var width by remember { mutableFloatStateOf(1f) }
    val shape = RoundedCornerShape(20.dp)
    val drag = rememberDraggableState { delta -> scope.launch { offset.snapTo(offset.value + delta) } }
    val entrance = remember { Animatable(0.92f) }
    LaunchedEffect(Unit) { entrance.animateTo(1f, spring(dampingRatio = 0.75f, stiffness = 420f)) }

    Column(
        modifier
            .onSizeChanged { width = it.width.toFloat().coerceAtLeast(1f) }
            .graphicsLayer {
                translationX = offset.value
                val fraction = (abs(offset.value) / width).coerceIn(0f, 1f)
                alpha = 1f - fraction * 0.85f
                rotationZ = offset.value / width * 6f
                scaleX = entrance.value
                scaleY = entrance.value
            }
            .draggable(
                state = drag,
                enabled = !reordering,
                orientation = Orientation.Horizontal,
                onDragStopped = { velocity ->
                    val dismiss = abs(offset.value) > width * 0.38f || abs(velocity) > 2200f
                    if (dismiss) {
                        val target = if ((offset.value + velocity * 0.05f) > 0) width * 1.4f else -width * 1.4f
                        offset.animateTo(target, tween(160))
                        onClose()
                    } else {
                        offset.animateTo(0f, spring(dampingRatio = 0.7f, stiffness = 500f))
                    }
                },
            )
            .then(reorderModifier)
            .then(
                if (selected) Modifier.border(2.dp, c.accent, shape).padding(3.dp) else Modifier.padding(0.dp),
            )
            .glass(if (selected) RoundedCornerShape(17.dp) else shape, elevation = if (selected) 14.dp else 6.dp, solid = true)
            .pressable(onOpen),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = 10.dp, end = 2.dp, top = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (tab.isNewTab) {
                VelaMark(Modifier.size(16.dp), ink = c.textMuted)
            } else {
                SiteIcon(UrlInput.hostOf(tab.url), browser.favicons, size = 16.dp, corner = 4.dp)
            }
            Spacer(Modifier.width(8.dp))
            Text(
                tab.displayTitle,
                style = VelaType.label,
                color = c.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            IconAction(Icons.Rounded.Close, "Close tab", onClose, size = 34.dp, iconSize = 16.dp, tint = c.textMuted)
        }
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(if (portrait) 0.78f else 1.45f)
                .padding(start = 4.dp, end = 4.dp, bottom = 4.dp)
                .clip(RoundedCornerShape(15.dp))
                .background(c.background),
        ) {
            val thumbnail = tab.thumbnail
            when {
                tab.isNewTab -> NewTabPreview()
                thumbnail != null -> Image(
                    thumbnail,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    alignment = Alignment.TopCenter,
                    modifier = Modifier.fillMaxSize(),
                )
                else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    SiteIcon(UrlInput.hostOf(tab.url), browser.favicons, size = 40.dp, corner = 12.dp)
                }
            }
            if (tab.isSleeping) {
                Icon(
                    Icons.Rounded.Bedtime,
                    "Sleeping",
                    tint = c.textMuted,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(8.dp)
                        .size(22.dp)
                        .background(c.islandSolid.copy(alpha = 0.88f), CircleShape)
                        .padding(4.dp),
                )
            }
        }
    }
}

@Composable
private fun NewTabPreview() {
    val c = LocalVela.current
    Column(
        Modifier.fillMaxSize().background(c.accent.copy(alpha = 0.06f)),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        VelaMark(Modifier.size(44.dp), ink = c.textMuted)
        Spacer(Modifier.height(10.dp))
        Box(Modifier.width(96.dp).height(14.dp).background(c.surfaceStrong, CircleShape))
    }
}

@Composable
private fun EmptySpace(space: Space, modifier: Modifier, onNewTab: () -> Unit) {
    val c = LocalVela.current
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        SpaceDot(Color(space.color), size = 10.dp)
        Spacer(Modifier.height(14.dp))
        Text("No tabs in ${space.name}", style = VelaType.heading, color = c.text)
        Spacer(Modifier.height(6.dp))
        Text("Tabs you open here stay separate from your other Spaces.", style = VelaType.label, color = c.textFaint)
        Spacer(Modifier.height(18.dp))
        Pill("New tab", selected = true, onClick = onNewTab)
    }
}

@Composable
private fun BottomBar(browser: Browser, modifier: Modifier, onDone: () -> Unit) {
    val c = LocalVela.current
    Row(
        modifier
            .navigationBarsPadding()
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .fillMaxWidth()
            .height(58.dp)
            .glass(RoundedCornerShape(24.dp))
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val count = browser.tabsIn(browser.activeSpaceId).size
        Text(
            if (count == 1) "1 tab" else "$count tabs",
            style = VelaType.label,
            color = c.textMuted,
            modifier = Modifier.padding(start = 10.dp).weight(1f),
        )
        Box(
            Modifier
                .height(40.dp)
                .clip(CircleShape)
                .background(c.accent.copy(alpha = 0.16f), CircleShape)
                .border(1.dp, c.accent.copy(alpha = 0.4f), CircleShape)
                .pressable({
                    browser.newTab()
                    browser.panel = Panel.NONE
                })
                .padding(horizontal = 18.dp),
            contentAlignment = Alignment.Center,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Add, null, Modifier.size(18.dp), tint = c.text)
                Spacer(Modifier.width(6.dp))
                Text("New tab", style = VelaType.bodyStrong, color = c.text)
            }
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            Text(
                "Done",
                style = VelaType.bodyStrong,
                color = c.text,
                modifier = Modifier
                    .clip(CircleShape)
                    .pressable(onDone)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            )
        }
    }
}
