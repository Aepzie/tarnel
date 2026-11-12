package org.velabrowser.vela.ui.theme

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import org.velabrowser.vela.R
import org.velabrowser.vela.core.SpaceColors
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/** Tarnel "Floating Islands" tokens (docs/DESIGN.md), mapped to Compose. */
@Immutable
data class VelaColors(
    val dark: Boolean,
    val background: Color,
    val island: Color,
    val islandSolid: Color,
    val ring: Color,
    val highlight: Color,
    val surface: Color,
    val surfaceStrong: Color,
    val text: Color,
    val textMuted: Color,
    val textFaint: Color,
    val scrim: Color,
    val accent: Color,
    val onAccent: Color,
    val danger: Color,
)

private val Zinc950 = Color(0xFF09090B)
private val Zinc900 = Color(0xFF18181B)
private val Zinc800 = Color(0xFF27272A)
private val Zinc500 = Color(0xFF71717A)
private val Zinc400 = Color(0xFFA1A1AA)
private val Zinc100 = Color(0xFFF4F4F5)
private val Zinc50 = Color(0xFFFAFAFA)

fun velaColors(dark: Boolean, accent: Color): VelaColors = if (dark) {
    VelaColors(
        dark = true,
        background = Zinc950,
        island = Zinc900.copy(alpha = 0.96f),
        islandSolid = Color(0xFF141417),
        ring = Color.White.copy(alpha = 0.08f),
        highlight = Color.White.copy(alpha = 0.06f),
        surface = Color.White.copy(alpha = 0.05f),
        surfaceStrong = Color.White.copy(alpha = 0.09f),
        text = Zinc100,
        textMuted = Zinc400,
        textFaint = Zinc500,
        scrim = Color.Black.copy(alpha = 0.55f),
        accent = accent,
        onAccent = Zinc950,
        danger = Color(0xFFF87171),
    )
} else {
    VelaColors(
        dark = false,
        background = Zinc50,
        island = Color.White.copy(alpha = 0.97f),
        islandSolid = Color.White,
        ring = Color.Black.copy(alpha = 0.08f),
        highlight = Color.White.copy(alpha = 0.7f),
        surface = Color.Black.copy(alpha = 0.04f),
        surfaceStrong = Color.Black.copy(alpha = 0.07f),
        text = Color(0xFF18181B),
        textMuted = Color(0xFF52525B),
        textFaint = Color(0xFF8B8B93),
        scrim = Color.Black.copy(alpha = 0.32f),
        accent = accent.darkenForLight(),
        onAccent = Color.White,
        danger = Color(0xFFDC2626),
    )
}

/** Space colors are tuned for dark UI; deepen them a little so they keep contrast on white. */
private fun Color.darkenForLight(): Color = Color(red * 0.82f, green * 0.82f, blue * 0.82f, alpha)

val LocalVela = compositionLocalOf { velaColors(true, Color(SpaceColors.DEFAULT)) }

/** Geist Variable (OFL, Latin subset in res/font) — the desktop UI font — at the weights the UI uses. */
@OptIn(ExperimentalTextApi::class)
private fun geist(weight: FontWeight) = Font(
    R.font.geist,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

val Geist = FontFamily(
    geist(FontWeight.ExtraLight),
    geist(FontWeight.Light),
    geist(FontWeight.Normal),
    geist(FontWeight.Medium),
    geist(FontWeight.SemiBold),
    geist(FontWeight.Bold),
)

object VelaType {
    val family = Geist
    val hero = TextStyle(fontFamily = family, fontWeight = FontWeight.Light, fontSize = 84.sp, letterSpacing = (-0.045).em, lineHeight = 92.sp)
    val title = TextStyle(fontFamily = family, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, letterSpacing = (-0.02).em)
    val heading = TextStyle(fontFamily = family, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, letterSpacing = (-0.01).em)
    val body = TextStyle(fontFamily = family, fontWeight = FontWeight.Normal, fontSize = 14.sp, letterSpacing = (-0.005).em, lineHeight = 20.sp)
    val bodyStrong = body.copy(fontWeight = FontWeight.Medium)
    val label = TextStyle(fontFamily = family, fontWeight = FontWeight.Medium, fontSize = 12.sp, letterSpacing = 0.em)
    val caption = TextStyle(fontFamily = family, fontWeight = FontWeight.Medium, fontSize = 11.sp, letterSpacing = 0.04.em)
    val omnibox = TextStyle(fontFamily = family, fontWeight = FontWeight.Medium, fontSize = 14.sp, letterSpacing = (-0.01).em)
}

private val MaterialTypography = androidx.compose.material3.Typography().let { t ->
    androidx.compose.material3.Typography(
        displayLarge = t.displayLarge.copy(fontFamily = Geist), displayMedium = t.displayMedium.copy(fontFamily = Geist),
        displaySmall = t.displaySmall.copy(fontFamily = Geist), headlineLarge = t.headlineLarge.copy(fontFamily = Geist),
        headlineMedium = t.headlineMedium.copy(fontFamily = Geist), headlineSmall = t.headlineSmall.copy(fontFamily = Geist),
        titleLarge = t.titleLarge.copy(fontFamily = Geist), titleMedium = t.titleMedium.copy(fontFamily = Geist),
        titleSmall = t.titleSmall.copy(fontFamily = Geist), bodyLarge = t.bodyLarge.copy(fontFamily = Geist),
        bodyMedium = t.bodyMedium.copy(fontFamily = Geist), bodySmall = t.bodySmall.copy(fontFamily = Geist),
        labelLarge = t.labelLarge.copy(fontFamily = Geist), labelMedium = t.labelMedium.copy(fontFamily = Geist),
        labelSmall = t.labelSmall.copy(fontFamily = Geist),
    )
}

@Composable
fun VelaTheme(dark: Boolean, accent: Color, content: @Composable () -> Unit) {
    val animatedAccent by animateColorAsState(accent, tween(420), label = "accent")
    val colors = velaColors(dark, animatedAccent)
    val scheme = if (dark) {
        darkColorScheme(
            primary = colors.accent, onPrimary = Zinc950, background = colors.background, onBackground = colors.text,
            surface = colors.islandSolid, onSurface = colors.text, surfaceVariant = Zinc800, onSurfaceVariant = colors.textMuted,
            surfaceContainerHigh = Color(0xFF1C1C20), surfaceContainer = colors.islandSolid, outline = colors.ring, error = colors.danger,
        )
    } else {
        lightColorScheme(
            primary = colors.accent, onPrimary = Color.White, background = colors.background, onBackground = colors.text,
            surface = Color.White, onSurface = colors.text, surfaceVariant = Color(0xFFF1F1F3), onSurfaceVariant = colors.textMuted,
            surfaceContainerHigh = Color.White, surfaceContainer = Color.White, outline = colors.ring, error = colors.danger,
        )
    }
    CompositionLocalProvider(LocalVela provides colors) {
        MaterialTheme(colorScheme = scheme, typography = MaterialTypography, content = content)
    }
}
