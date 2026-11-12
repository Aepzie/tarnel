package org.velabrowser.vela.ui.page

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.GppMaybe
import androidx.compose.material.icons.rounded.LinkOff
import androidx.compose.material.icons.rounded.NoEncryption
import androidx.compose.material.icons.rounded.SentimentDissatisfied
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.PageError
import org.velabrowser.vela.browser.PageErrorKind
import org.velabrowser.vela.browser.Tab
import org.velabrowser.vela.core.UrlInput
import org.velabrowser.vela.ui.components.glass
import org.velabrowser.vela.ui.components.pressable
import org.velabrowser.vela.ui.spaces.SheetButton
import org.velabrowser.vela.ui.theme.LocalVela
import org.velabrowser.vela.ui.theme.VelaType

/** Native error page drawn over the WebView (offline, unknown host, no HTTPS, certificate, crash). */
@Composable
fun PageErrorView(browser: Browser, tab: Tab, error: PageError) {
    val c = LocalVela.current
    val host = UrlInput.hostOf(error.url) ?: error.url
    val warning = Color(0xFFFBBF24)
    val (icon, title, body) = when (error.kind) {
        PageErrorKind.OFFLINE -> Triple(Icons.Rounded.CloudOff, "You're offline", "Check your connection — Tarnel will load $host when you try again.")
        PageErrorKind.NOT_FOUND -> Triple(Icons.Rounded.LinkOff, "Can't find $host", "The address may be mistyped, or the site no longer exists.")
        PageErrorKind.HTTPS_UNAVAILABLE -> Triple(
            Icons.Rounded.NoEncryption,
            "$host doesn't support a secure connection",
            "HTTPS-only is on. If you continue over http, anything you see or send on this site can be read or changed by others on the network.",
        )
        PageErrorKind.CERTIFICATE -> Triple(Icons.Rounded.GppMaybe, "This connection isn't private", "$host presented a certificate Tarnel can't trust. Someone may be trying to intercept your connection.")
        PageErrorKind.CRASHED -> Triple(Icons.Rounded.SentimentDissatisfied, "This page crashed", "It used too much memory or hit a bug. Reload to try again.")
        PageErrorKind.GENERIC -> Triple(Icons.Rounded.ErrorOutline, "This page couldn't load", error.detail?.removePrefix("net::")?.lowercase() ?: "Something went wrong while connecting to $host.")
    }
    val tint = if (error.kind == PageErrorKind.HTTPS_UNAVAILABLE || error.kind == PageErrorKind.CERTIFICATE) warning else c.accent
    Box(Modifier.fillMaxSize().background(c.background).clickable(null, null) {}, contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 440.dp).padding(horizontal = 28.dp).padding(bottom = 80.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier.size(64.dp).background(tint.copy(alpha = 0.12f), CircleShape).border(1.dp, tint.copy(alpha = 0.3f), CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, Modifier.size(30.dp), tint = tint) }
            Spacer(Modifier.height(20.dp))
            Text(title, style = VelaType.title, color = c.text, textAlign = TextAlign.Center)
            Spacer(Modifier.height(8.dp))
            Text(body, style = VelaType.body, color = c.textMuted, textAlign = TextAlign.Center)
            Spacer(Modifier.height(26.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                when (error.kind) {
                    PageErrorKind.HTTPS_UNAVAILABLE -> {
                        SheetButton("Go back", c.accent, c.onAccent, Modifier.weight(1f)) { if (!browser.goBack()) browser.closeTab(tab, undoable = false) }
                        SheetButton("Continue", c.surface, c.text, Modifier.weight(1f)) { browser.continueInsecure(tab) }
                    }
                    PageErrorKind.CERTIFICATE -> SheetButton("Go back", c.accent, c.onAccent, Modifier.weight(1f)) {
                        if (!browser.goBack()) browser.closeTab(tab, undoable = false)
                    }
                    else -> SheetButton(if (error.kind == PageErrorKind.CRASHED) "Reload" else "Try again", c.accent, c.onAccent, Modifier.weight(1f)) { browser.reload() }
                }
            }
        }
    }
}

/** Transient message ("Tab closed · Undo") floating above the island. */
@Composable
fun MessageBar(browser: Browser) {
    val c = LocalVela.current
    val message = browser.message
    LaunchedEffect(message?.id) {
        if (message == null) return@LaunchedEffect
        delay(if (message.action != null) 4200 else 2600)
        if (browser.message?.id == message.id) browser.message = null
    }
    AnimatedContent(
        targetState = message,
        transitionSpec = {
            (fadeIn(tween(180)) + slideInVertically(spring(dampingRatio = 0.8f, stiffness = 500f)) { it / 2 } + scaleIn(initialScale = 0.96f))
                .togetherWith(fadeOut(tween(140)))
        },
        contentKey = { it?.id },
        label = "message",
    ) { current ->
        if (current == null) return@AnimatedContent
        Row(
            Modifier
                .padding(horizontal = 12.dp)
                .padding(bottom = 10.dp)
                .widthIn(max = 520.dp)
                .fillMaxWidth()
                .glass(RoundedCornerShape(18.dp), elevation = 12.dp, solid = true)
                .padding(start = 18.dp, end = 6.dp)
                .height(48.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(current.text, style = VelaType.bodyStrong, color = c.text, modifier = Modifier.weight(1f), maxLines = 2)
            if (current.actionLabel != null) {
                Spacer(Modifier.width(8.dp))
                Text(
                    current.actionLabel,
                    style = VelaType.bodyStrong,
                    color = c.accent,
                    modifier = Modifier
                        .clip(CircleShape)
                        .pressable({
                            browser.message = null
                            current.action?.invoke()
                        })
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
        }
    }
}
