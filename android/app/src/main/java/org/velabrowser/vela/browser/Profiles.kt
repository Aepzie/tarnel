package org.velabrowser.vela.browser

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.velabrowser.vela.core.Space

/**
 * Maps Spaces onto androidx.webkit Profiles: every Space gets its own cookie jar, storage, cache, service
 * workers and permissions. On WebView builds without MULTI_PROFILE all Spaces share the default profile;
 * the UI shows a notice and Burner spaces are disabled.
 */
@SuppressLint("RequiresFeature") // Every profile call is guarded by [supported].
object Profiles {
    val supported: Boolean by lazy { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) }

    private val main = Handler(Looper.getMainLooper())

    /** Must run before the WebView loads anything. */
    fun attach(webView: WebView, space: Space) {
        if (!supported) return
        ProfileStore.getInstance().getOrCreateProfile(space.profileName)
        WebViewCompat.setProfile(webView, space.profileName)
    }

    fun cookieManager(space: Space): CookieManager =
        if (supported) ProfileStore.getInstance().getOrCreateProfile(space.profileName).cookieManager else CookieManager.getInstance()

    private fun webStorage(space: Space): WebStorage =
        if (supported) ProfileStore.getInstance().getOrCreateProfile(space.profileName).webStorage else WebStorage.getInstance()

    /**
     * Wipes everything a Space stored. With profiles the whole profile directory is deleted (cookies,
     * storage, cache, service workers, permissions). The Space's WebViews must already be destroyed;
     * deletion is retried briefly because WebView releases a profile asynchronously.
     */
    fun wipe(space: Space, onDone: () -> Unit = {}) {
        if (!supported) {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            WebStorage.getInstance().deleteAllData()
            onDone()
            return
        }
        delete(space.profileName, attempt = 0, onDone)
    }

    private fun delete(name: String, attempt: Int, onDone: () -> Unit) {
        val store = ProfileStore.getInstance()
        if (name !in store.allProfileNames) {
            onDone()
            return
        }
        val deleted = runCatching { store.deleteProfile(name) }.getOrDefault(false)
        if (deleted || attempt >= 25) {
            if (!deleted) clearInPlace(name)
            onDone()
            return
        }
        main.postDelayed({ delete(name, attempt + 1, onDone) }, 120)
    }

    /** Fallback when a profile cannot be deleted (still referenced): clear its data instead. */
    private fun clearInPlace(name: String) {
        runCatching {
            val profile = ProfileStore.getInstance().getProfile(name) ?: return
            profile.cookieManager.removeAllCookies(null)
            profile.webStorage.deleteAllData()
        }
    }

    fun clearStorage(space: Space) {
        cookieManager(space).removeAllCookies(null)
        webStorage(space).deleteAllData()
    }

    /** Burner profiles that survived a crash or a swipe-away from recents are removed at startup. */
    fun sweepBurners() {
        if (!supported) return
        val store = ProfileStore.getInstance()
        store.allProfileNames.filter { it.startsWith(Space.BURNER_PREFIX) }.forEach { delete(it, 0) {} }
    }

    /** Removes profiles of Spaces that no longer exist (e.g. deleted while a WebView still held them). */
    fun sweepOrphans(known: Set<String>) {
        if (!supported) return
        val store = ProfileStore.getInstance()
        store.allProfileNames
            .filter { it.startsWith(Space.SPACE_PREFIX) && it !in known }
            .forEach { delete(it, 0) {} }
    }
}
