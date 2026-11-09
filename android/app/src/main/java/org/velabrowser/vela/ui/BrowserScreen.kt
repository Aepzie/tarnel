package org.velabrowser.vela.ui

import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.Panel
import org.velabrowser.vela.browser.Tab
import org.velabrowser.vela.ui.downloads.DownloadChip
import org.velabrowser.vela.ui.history.HistoryScreen
import org.velabrowser.vela.ui.island.BottomIsland
import org.velabrowser.vela.ui.newtab.NewTabPage
import org.velabrowser.vela.ui.omnibox.OmniboxOverlay
import org.velabrowser.vela.ui.page.MessageBar
import org.velabrowser.vela.ui.page.PageErrorView
import org.velabrowser.vela.ui.settings.SettingsScreen
import org.velabrowser.vela.ui.sheets.ContextMenuSheet
import org.velabrowser.vela.ui.sheets.ExternalAppSheet
import org.velabrowser.vela.ui.sheets.MenuSheet
import org.velabrowser.vela.ui.sheets.PermissionSheet
import org.velabrowser.vela.ui.spaces.SpacesSheet
import org.velabrowser.vela.ui.tabs.TabSwitcher
import org.velabrowser.vela.ui.theme.LocalVela

@Composable
@OptIn(ExperimentalLayoutApi::class)
fun BrowserScreen(browser: Browser, fullscreenView: View?, onExitFullscreen: () -> Unit) {
    val c = LocalVela.current
    val tab = browser.activeTab
    val panel = browser.panel

    BackHandler(enabled = panel == Panel.NONE && !browser.editing && (tab?.canGoBack == true)) { browser.goBack() }

    Box(Modifier.fillMaxSize().background(c.background)) {
        when {
            tab == null -> Unit
            tab.isNewTab -> NewTabPage(browser)
            else -> Box(
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .imePadding()
                    .windowInsetsPadding(WindowInsets.displayCutout.only(WindowInsetsSides.Horizontal)),
            ) {
                WebHost(tab)
                tab.error?.let { error -> PageErrorView(browser, tab, error) }
            }
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .imePadding()
                .windowInsetsPadding(WindowInsets.displayCutout.only(WindowInsetsSides.Horizontal))
                .padding(bottom = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            MessageBar(browser)
            DownloadChip(browser)
            if (!WindowInsets.isImeVisible || browser.findOpen) BottomIsland(browser)
        }

        if (browser.editing) OmniboxOverlay(browser)

        AnimatedVisibility(
            visible = panel == Panel.TABS,
            enter = fadeIn(tween(180)) + scaleIn(spring(dampingRatio = 0.86f, stiffness = 520f), initialScale = 1.06f),
            exit = fadeOut(tween(160)) + scaleOut(tween(200), targetScale = 1.04f),
        ) { TabSwitcher(browser) }

        AnimatedVisibility(
            visible = panel == Panel.HISTORY,
            enter = slideInHorizontally(spring(dampingRatio = 0.9f, stiffness = 500f)) { it / 3 } + fadeIn(tween(160)),
            exit = slideOutHorizontally(tween(200)) { it / 4 } + fadeOut(tween(160)),
        ) { HistoryScreen(browser) }

        AnimatedVisibility(
            visible = panel == Panel.SETTINGS,
            enter = slideInHorizontally(spring(dampingRatio = 0.9f, stiffness = 500f)) { it / 3 } + fadeIn(tween(160)),
            exit = slideOutHorizontally(tween(200)) { it / 4 } + fadeOut(tween(160)),
        ) { SettingsScreen(browser) }

        if (panel == Panel.MENU) MenuSheet(browser)
        if (panel == Panel.SPACES) SpacesSheet(browser)
        browser.contextTarget?.let { ContextMenuSheet(browser, it) }
        browser.permissionPrompt?.let { PermissionSheet(browser, it) }
        browser.externalPrompt?.let { ExternalAppSheet(browser, it) }

        AnimatedVisibility(visible = fullscreenView != null, enter = fadeIn(), exit = fadeOut(tween(120))) {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                if (fullscreenView != null) {
                    AndroidView(
                        factory = { context ->
                            FrameLayout(context).apply {
                                (fullscreenView.parent as? ViewGroup)?.removeView(fullscreenView)
                                addView(fullscreenView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                            }
                        },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
            BackHandler(onBack = onExitFullscreen)
        }
    }
}

/** Hosts the active tab's WebView. Only the active tab is attached; others stay detached (or asleep). */
@Composable
private fun WebHost(tab: Tab) {
    val webView = tab.webView
    AndroidView(
        factory = { context -> FrameLayout(context) },
        update = { frame ->
            val current = if (frame.childCount > 0) frame.getChildAt(0) else null
            if (current === webView) return@AndroidView
            frame.removeAllViews()
            if (webView != null) {
                (webView.parent as? ViewGroup)?.removeView(webView)
                frame.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            }
        },
        onRelease = { frame -> frame.removeAllViews() },
        modifier = Modifier.fillMaxSize(),
    )
}
