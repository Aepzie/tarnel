package org.velabrowser.vela.ui.downloads

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.DownloadItem
import org.velabrowser.vela.browser.DownloadStatus
import org.velabrowser.vela.browser.UiMessage
import org.velabrowser.vela.ui.components.IconAction
import org.velabrowser.vela.ui.components.glass
import org.velabrowser.vela.ui.components.pressable
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType

/** The newest download as a glass chip with a live progress ring; when done: Open / Share. */
@Composable
fun DownloadChip(browser: Browser) {
    val item = browser.downloads.items.firstOrNull()
    LaunchedEffect(item?.id, item?.status) {
        if (item != null && item.status != DownloadStatus.RUNNING) {
            delay(7000)
            browser.downloads.dismiss(item)
        }
    }
    AnimatedVisibility(
        visible = item != null,
        enter = fadeIn(tween(160)) + slideInVertically(spring(dampingRatio = 0.8f, stiffness = 500f)) { it } + scaleIn(initialScale = 0.9f),
        exit = fadeOut(tween(160)),
    ) {
        if (item != null) Chip(browser, item)
    }
}

@Composable
private fun Chip(browser: Browser, item: DownloadItem) {
    val c = LocalVela.current
    Row(
        Modifier
            .padding(bottom = 10.dp, start = 12.dp, end = 12.dp)
            .widthIn(max = 420.dp)
            .fillMaxWidth()
            .height(52.dp)
            .glass(RoundedCornerShape(20.dp), elevation = 12.dp, solid = true)
            .pressable({
                if (item.status == DownloadStatus.DONE && !browser.downloads.open(item)) {
                    browser.message = UiMessage("No app can open ${item.fileName}")
                }
            })
            .padding(start = 12.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProgressRing(item)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.fileName, style = VelaType.bodyStrong, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                when (item.status) {
                    DownloadStatus.RUNNING -> item.fraction?.let { "${(it * 100).toInt()}% · ${formatBytes(item.downloaded)} of ${formatBytes(item.total)}" } ?: "Downloading… ${formatBytes(item.downloaded)}"
                    DownloadStatus.DONE -> "Done · tap to open"
                    DownloadStatus.FAILED -> "Download failed"
                },
                style = VelaType.label,
                color = c.textFaint,
                maxLines = 1,
            )
        }
        when (item.status) {
            DownloadStatus.DONE -> IconAction(Icons.Rounded.Share, "Share", { browser.downloads.share(item) }, size = 40.dp, iconSize = 18.dp, tint = c.textMuted)
            DownloadStatus.RUNNING -> IconAction(Icons.Rounded.Close, "Cancel download", { browser.downloads.cancel(item) }, size = 40.dp, iconSize = 18.dp, tint = c.textMuted)
            DownloadStatus.FAILED -> IconAction(Icons.Rounded.Close, "Dismiss", { browser.downloads.dismiss(item) }, size = 40.dp, iconSize = 18.dp, tint = c.textMuted)
        }
    }
}

@Composable
private fun ProgressRing(item: DownloadItem) {
    val c = LocalVela.current
    val progress by animateFloatAsState(item.fraction ?: 0f, spring(stiffness = 120f), label = "download")
    val spin = rememberInfiniteTransition(label = "spin")
    val rotation by spin.animateFloat(0f, 360f, infiniteRepeatable(tween(1100, easing = LinearEasing), RepeatMode.Restart), label = "rotation")
    Box(Modifier.size(30.dp).clip(CircleShape), contentAlignment = Alignment.Center) {
        val track = c.surfaceStrong
        val accent = if (item.status == DownloadStatus.FAILED) c.danger else c.accent
        Canvas(Modifier.size(28.dp)) {
            val stroke = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round)
            drawArc(track, 0f, 360f, false, style = stroke)
            when {
                item.status != DownloadStatus.RUNNING -> drawArc(accent, -90f, 360f, false, style = stroke)
                item.fraction == null -> drawArc(accent, rotation - 90f, 90f, false, style = stroke)
                else -> drawArc(accent, -90f, 360f * progress, false, style = stroke)
            }
        }
        when (item.status) {
            DownloadStatus.DONE -> Icon(Icons.Rounded.Check, null, Modifier.size(15.dp), tint = c.accent)
            DownloadStatus.FAILED -> Icon(Icons.Rounded.ErrorOutline, null, Modifier.size(15.dp), tint = c.danger)
            DownloadStatus.RUNNING -> Unit
        }
    }
}

private fun formatBytes(bytes: Long): String = when {
    bytes < 0 -> "?"
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    bytes < 1024L * 1024 * 1024 -> String.format(java.util.Locale.ROOT, "%.1f MB", bytes / 1048576.0)
    else -> String.format(java.util.Locale.ROOT, "%.2f GB", bytes / 1073741824.0)
}
