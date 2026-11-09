package org.velabrowser.vela.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.velabrowser.vela.R
import org.velabrowser.vela.core.FaviconCache
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType

/** Glass island surface: translucent fill, hairline ring with a brighter top edge, soft lift shadow. */
@Composable
fun Modifier.glass(shape: Shape, elevation: Dp = 18.dp, solid: Boolean = false): Modifier {
    val c = LocalVela.current
    val edge = Brush.verticalGradient(
        0f to (if (c.dark) Color.White.copy(alpha = 0.14f) else Color.White),
        0.35f to c.ring,
        1f to c.ring,
    )
    return this
        .shadow(elevation, shape, ambientColor = Color.Black.copy(alpha = 0.35f), spotColor = Color.Black.copy(alpha = if (c.dark) 0.6f else 0.22f))
        .background(if (solid) c.islandSolid else c.island, shape)
        .border(BorderStroke(1.dp, edge), shape)
        .clip(shape)
}

/** Press feedback used across the UI: scale to 0.96 with a snappy spring. */
@Composable
fun Modifier.pressable(
    onClick: () -> Unit,
    enabled: Boolean = true,
    bounded: Boolean = true,
    onLongClick: (() -> Unit)? = null,
    role: Role = Role.Button,
): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.95f else 1f, spring(stiffness = 900f, dampingRatio = 0.7f), label = "press")
    val base = this.graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
    return if (onLongClick != null) {
        base.combinedClickableCompat(interaction, enabled, bounded, onClick, onLongClick)
    } else {
        base.clickable(interaction, ripple(bounded = bounded, color = LocalVela.current.text), enabled = enabled, role = role, onClick = onClick)
    }
}

@Composable
private fun Modifier.combinedClickableCompat(
    interaction: MutableInteractionSource,
    enabled: Boolean,
    bounded: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
): Modifier = this.then(
    Modifier.combinedClickable(
        interactionSource = interaction,
        indication = ripple(bounded = bounded, color = LocalVela.current.text),
        enabled = enabled,
        onClick = onClick,
        onLongClick = onLongClick,
    ),
)

@Composable
fun IconAction(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = LocalVela.current.text,
    size: Dp = 40.dp,
    iconSize: Dp = 20.dp,
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .pressable(onClick, enabled = enabled),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription, Modifier.size(iconSize), tint = if (enabled) tint else tint.copy(alpha = 0.28f))
    }
}

@Composable
fun SpaceDot(color: Color, modifier: Modifier = Modifier, size: Dp = 8.dp, glow: Boolean = true) {
    Box(
        modifier
            .size(size)
            .then(if (glow) Modifier.shadow(6.dp, CircleShape, ambientColor = color, spotColor = color) else Modifier)
            .background(color, CircleShape),
    )
}

@Composable
fun VelaMark(modifier: Modifier = Modifier, tint: Color = LocalVela.current.text) {
    Icon(painterResource(R.drawable.ic_vela_mark), contentDescription = "Vela", modifier = modifier, tint = tint)
}

/** Site icon from the favicon cache, or a monogram tile tinted with the accent. */
@Composable
fun SiteIcon(host: String?, favicons: FaviconCache, modifier: Modifier = Modifier, size: Dp = 20.dp, corner: Dp = 6.dp) {
    val c = LocalVela.current
    val icon = host?.let { favicons.get(it) }
    val shape = RoundedCornerShape(corner)
    if (icon != null) {
        val image = remember(icon) { icon.asImageBitmap() }
        Image(image, null, modifier.size(size).clip(shape))
    } else {
        val letter = host?.let { org.velabrowser.vela.core.UrlInput.siteOf(it) }?.firstOrNull()?.uppercaseChar()?.toString() ?: "•"
        Box(
            modifier
                .size(size)
                .background(c.accent.copy(alpha = 0.16f), shape)
                .border(1.dp, c.accent.copy(alpha = 0.22f), shape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                letter,
                color = c.accent,
                style = androidx.compose.ui.text.TextStyle(
                    fontSize = (size.value * 0.5f).sp,
                    lineHeight = (size.value * 0.5f).sp,
                    fontWeight = FontWeight.SemiBold,
                    platformStyle = androidx.compose.ui.text.PlatformTextStyle(includeFontPadding = false),
                    lineHeightStyle = androidx.compose.ui.text.style.LineHeightStyle(
                        androidx.compose.ui.text.style.LineHeightStyle.Alignment.Center,
                        androidx.compose.ui.text.style.LineHeightStyle.Trim.Both,
                    ),
                ),
            )
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = VelaType.caption,
        color = LocalVela.current.textFaint,
        modifier = modifier.padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 8.dp),
    )
}

/** A row inside a sheet or settings list: icon, title, optional subtitle, optional trailing content. */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    subtitle: String? = null,
    tint: Color = LocalVela.current.text,
    leading: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = LocalVela.current
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .then(if (onClick != null) Modifier.pressable(onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = if (subtitle != null) 10.dp else 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(14.dp))
        } else if (icon != null) {
            Icon(icon, null, Modifier.size(20.dp), tint = if (tint == c.text) c.textMuted else tint)
            Spacer(Modifier.width(14.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = VelaType.bodyStrong, color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) {
                Text(subtitle, style = VelaType.label, color = c.textFaint, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        if (trailing != null) {
            Spacer(Modifier.width(12.dp))
            trailing()
        }
    }
}

@Composable
fun VelaSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val c = LocalVela.current
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        colors = SwitchDefaults.colors(
            checkedTrackColor = c.accent,
            checkedThumbColor = if (c.dark) Color(0xFF09090B) else Color.White,
            checkedBorderColor = c.accent,
            uncheckedTrackColor = c.surfaceStrong,
            uncheckedThumbColor = c.textMuted,
            uncheckedBorderColor = c.ring,
        ),
    )
}

/** Bottom sheet styled as an island: inset from the screen edges, glass, small handle. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VelaSheet(onDismiss: () -> Unit, skipPartiallyExpanded: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    val c = LocalVela.current
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = skipPartiallyExpanded)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        containerColor = c.islandSolid,
        contentColor = c.text,
        scrimColor = c.scrim,
        tonalElevation = 0.dp,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = {
            Box(Modifier.padding(top = 10.dp, bottom = 6.dp).size(width = 36.dp, height = 4.dp).background(c.textFaint.copy(alpha = 0.5f), CircleShape))
        },
    ) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 8.dp), content = content)
    }
}

@Composable
fun Pill(text: String, modifier: Modifier = Modifier, selected: Boolean = false, leading: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val c = LocalVela.current
    val shape = CircleShape
    Row(
        modifier
            .clip(shape)
            .background(if (selected) c.accent.copy(alpha = 0.16f) else c.surface, shape)
            .border(1.dp, if (selected) c.accent.copy(alpha = 0.45f) else c.ring, shape)
            .pressable(onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = VelaType.label, color = if (selected) c.text else c.textMuted, maxLines = 1)
    }
}

@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(horizontal = 20.dp).height(1.dp).background(LocalVela.current.ring))
}

@Composable
fun CenterBox(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) = Box(modifier, contentAlignment = Alignment.Center, content = content)
