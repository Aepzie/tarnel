package org.velabrowser.vela

import android.Manifest
import android.app.UiModeManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import org.velabrowser.vela.browser.Browser
import org.velabrowser.vela.browser.BrowserHost
import org.velabrowser.vela.browser.Downloads
import org.velabrowser.vela.core.FaviconCache
import org.velabrowser.vela.core.SessionStore
import org.velabrowser.vela.core.ThemeMode
import org.velabrowser.vela.ui.BrowserScreen
import org.velabrowser.vela.ui.theme.VelaTheme
import androidx.compose.ui.graphics.Color as ComposeColor

class MainActivity : ComponentActivity(), BrowserHost {
    private lateinit var browser: Browser

    private var fullscreenView by mutableStateOf<View?>(null)
    private var fullscreenExit: (() -> Unit)? = null
    private var fileCallback: ((Array<Uri>?) -> Unit)? = null
    private var permissionCallback: ((Boolean) -> Unit)? = null
    private var requestedPermissions: Array<String> = emptyArray()

    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.invoke(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        permissionCallback?.invoke(permissionsSatisfied(requestedPermissions) { results[it] == true })
        permissionCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as VelaApp
        browser = Browser(
            activity = this,
            host = this,
            settings = app.settings,
            history = app.history,
            session = SessionStore(this),
            favicons = FaviconCache(this, lifecycleScope),
            downloads = Downloads(applicationContext, lifecycleScope),
            scope = lifecycleScope,
        )
        val systemDark = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
        browser.setWebDarkMode(
            when (app.settings.settings.theme) {
                ThemeMode.SYSTEM -> systemDark
                ThemeMode.DARK -> true
                ThemeMode.LIGHT -> false
            },
        )
        browser.restore(launchUrl(intent))

        setContent {
            val settings = browser.settings.settings
            val dark = when (settings.theme) {
                ThemeMode.SYSTEM -> isSystemInDarkTheme()
                ThemeMode.DARK -> true
                ThemeMode.LIGHT -> false
            }
            LaunchedEffect(dark) {
                val transparent = Color.TRANSPARENT
                enableEdgeToEdge(
                    statusBarStyle = if (dark) SystemBarStyle.dark(transparent) else SystemBarStyle.light(transparent, transparent),
                    navigationBarStyle = if (dark) SystemBarStyle.dark(transparent) else SystemBarStyle.light(transparent, transparent),
                )
                browser.setWebDarkMode(dark)
            }
            LaunchedEffect(settings.theme) { applyNightMode(settings.theme) }
            VelaTheme(dark = dark, accent = ComposeColor(browser.activeSpace.color)) {
                BrowserScreen(browser, fullscreenView, onExitFullscreen = ::exitFullscreenFromUser)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        launchUrl(intent)?.let(browser::openUrlFromIntent)
    }

    override fun onResume() {
        super.onResume()
        browser.activeTab?.webView?.onResume()
    }

    override fun onPause() {
        browser.activeTab?.webView?.onPause()
        browser.persistNow()
        super.onPause()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        browser.onTrimMemory(level)
    }

    override fun onDestroy() {
        if (isFinishing) browser.onFinishing()
        super.onDestroy()
    }

    /** Keep the web content's prefers-color-scheme in step with the in-app theme (Android 12+). */
    private fun applyNightMode(mode: ThemeMode) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val manager = getSystemService<UiModeManager>() ?: return
        manager.setApplicationNightMode(
            when (mode) {
                ThemeMode.SYSTEM -> UiModeManager.MODE_NIGHT_AUTO
                ThemeMode.DARK -> UiModeManager.MODE_NIGHT_YES
                ThemeMode.LIGHT -> UiModeManager.MODE_NIGHT_NO
            },
        )
    }

    private fun launchUrl(intent: Intent?): String? {
        intent ?: return null
        return when (intent.action) {
            Intent.ACTION_VIEW -> intent.dataString?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
            Intent.ACTION_WEB_SEARCH, Intent.ACTION_SEARCH -> intent.getStringExtra("query")?.takeIf { it.isNotBlank() }
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()?.let { text ->
                Regex("https?://\\S+").find(text)?.value ?: text.takeIf { it.isNotBlank() }
            }
            else -> null
        }
    }

    // ------------------------------------------------------------- BrowserHost

    override fun enterFullscreen(view: View, onExit: () -> Unit) {
        if (fullscreenView != null) {
            onExit()
            return
        }
        fullscreenView = view
        fullscreenExit = onExit
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun exitFullscreen() {
        if (fullscreenView == null) return
        fullscreenView = null
        fullscreenExit = null
        WindowCompat.getInsetsController(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
    }

    private fun exitFullscreenFromUser() {
        val exit = fullscreenExit
        exitFullscreen()
        exit?.invoke()
    }

    override fun pickFiles(intent: Intent, onResult: (Array<Uri>?) -> Unit) {
        fileCallback?.invoke(null)
        fileCallback = onResult
        try {
            fileLauncher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            fileCallback = null
            onResult(null)
        }
    }

    override fun requestAndroidPermissions(permissions: Array<String>, onResult: (Boolean) -> Unit) {
        val granted = { p: String -> ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED }
        if (permissionsSatisfied(permissions, granted)) {
            onResult(true)
            return
        }
        permissionCallback?.invoke(false)
        permissionCallback = onResult
        requestedPermissions = permissions
        permissionLauncher.launch(permissions)
    }

    /** Location counts as granted with either precision; everything else must be granted. */
    private fun permissionsSatisfied(permissions: Array<String>, granted: (String) -> Boolean): Boolean {
        val location = setOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        val others = permissions.filter { it !in location && it != Manifest.permission.MODIFY_AUDIO_SETTINGS }
        val wantsLocation = permissions.any { it in location }
        return others.all { granted(it) || ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED } &&
            (!wantsLocation || location.any { granted(it) || ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED })
    }

    override fun capture(view: View, scale: Float, onBitmap: (Bitmap?) -> Unit) {
        val width = (view.width * scale).toInt()
        val height = (view.height * scale).toInt()
        if (width <= 0 || height <= 0) return onBitmap(null)
        val location = IntArray(2)
        view.getLocationInWindow(location)
        val source = Rect(location[0], location[1], location[0] + view.width, location[1] + view.height)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        try {
            PixelCopy.request(window, source, bitmap, { result ->
                onBitmap(if (result == PixelCopy.SUCCESS) bitmap else null)
            }, Handler(Looper.getMainLooper()))
        } catch (_: IllegalArgumentException) {
            onBitmap(null)
        }
    }

    override fun startExternal(intent: Intent): Boolean = try {
        startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (_: SecurityException) {
        false
    }
}
