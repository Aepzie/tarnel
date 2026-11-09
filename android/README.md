# Vela for Android

Native Android version of Vela: Kotlin + Jetpack Compose UI on top of Android System WebView
(`androidx.webkit`). Same ideas as the desktop app — Floating Islands design, isolated Spaces, Burner spaces,
sleeping tabs, privacy defaults — built for phones.

- **applicationId / package:** `org.velabrowser.vela` (debug builds: `org.velabrowser.vela.debug`)
- **minSdk 29** (Android 10) · **targetSdk / compileSdk 37**
- AGP 9.5 (built-in Kotlin), Kotlin 2.4, Compose BOM 2026.09, Gradle 9.9 (wrapper committed)

## Build

Requirements: JDK 17 or 21, Android SDK with `platforms;android-37.0` and `build-tools;36.0.0`
(`local.properties` with `sdk.dir=…`, or `ANDROID_HOME`).

```bash
cd android
./gradlew :app:assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest      # JVM unit tests
./gradlew :app:lintDebug              # Android lint (errors fail the build)
./gradlew :app:installDebug           # install on a connected device / emulator
```

### Release APK

R8 minification and resource shrinking are on. Signing is picked up from, in this order:

1. environment: `VELA_KEYSTORE_FILE`, `VELA_KEYSTORE_PASSWORD`, `VELA_KEY_ALIAS`, `VELA_KEY_PASSWORD` (CI), or
2. a properties file outside the repo: `-Pvela.signing=/path/keystore.properties` (or `VELA_SIGNING_PROPERTIES`)
   with `storeFile`, `storePassword`, `keyAlias`, `keyPassword` (`storeFile` may be relative to the file).

Without either, `assembleRelease` produces `app-release-unsigned.apk`. Keystores and `keystore.properties`
are git-ignored; never commit them.

```bash
./gradlew :app:assembleRelease -Pvela.signing=$HOME/.vela-android/keystore.properties
```

CI (`.github/workflows/android.yml`) builds, unit-tests and lints on every PR/push touching `android/**`, and on
`v*` tags builds the release APK signed from the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` secrets (unsigned if they are absent).

### Screenshot tests

The main surfaces can be rendered on the JVM (Robolectric native graphics + Roborazzi) without a device:

```bash
./gradlew :app:testDebugUnitTest --tests '*ScreenshotTest*' -Pvela.screenshots=/tmp/vela-shots
```

They are skipped unless `-Pvela.screenshots` is set.

## Architecture

```
app/src/main/java/org/velabrowser/vela/
  MainActivity.kt         single Activity (handles config changes itself, so WebViews survive rotation);
                          implements BrowserHost: file chooser, runtime permissions, fullscreen video, PixelCopy
  VelaApp.kt              app singletons (settings, history)
  core/                   pure-ish data layer
    Models.kt             Space, Settings, SearchEngine (same list as desktop), NewtabHero, ThemeMode
    UrlInput.kt           omnibox resolution, HTTPS upgrade, display helpers (unit-tested)
    SettingsStore.kt      SharedPreferences → Compose state (+ a volatile copy for WebView IO threads)
    HistoryStore.kt       SQLite history (one row per URL), suggestions, top sites
    SessionStore.kt       spaces + open tabs (JSON, atomic write) and tab thumbnails
    FaviconCache.kt       favicons per host (memory LRU + small PNGs)
    UserAgent.kt          Chrome-style reduced UA without WebView markers
  browser/
    Browser.kt            the model: Spaces, tabs, WebView lifecycle, sleeping, prompts, downloads, intents
    Tab.kt                observable tab state; a tab with no WebView is "sleeping"
    Profiles.kt           Space ⇄ androidx.webkit Profile mapping, wipe/sweep, fallback without MULTI_PROFILE
    TabWebViewClient.kt   navigation policy, HTTPS-only, content blocking, cosmetic CSS, error pages
    TabChromeClient.kt    progress/title/icon, popups, fullscreen, permissions, file chooser
    VelaWebView.kt        WebView reporting drag direction (hides the island while reading)
    Downloads.kt          DownloadManager + live progress state
  adblock/
    ContentBlocker.kt     the blocking seam (interface + RequestKind inference)
    HostListBlocker.kt    tiny built-in host list used until the real engine is wired in
    ContentBlockers.kt    factory — the one place to swap engines
  ui/                     Compose: theme/, components/, island/, omnibox/, tabs/, newtab/, spaces/,
                          sheets/, history/, settings/, downloads/, page/ and BrowserScreen.kt
```

### Spaces

Every Space is backed by its own **WebView Profile** (`ProfileStore.getOrCreateProfile("space-<id>")`,
`WebViewCompat.setProfile` before first load): separate cookies, localStorage/IndexedDB, cache, service workers
and geolocation permissions. Deleting a Space or "Clear data" destroys its WebViews and deletes the profile.
**Burner** spaces use `burner-<id>` profiles; they are never persisted or written to history, are deleted when
closed (or when their last tab closes), and any leftover burner profile is swept at the next start (covers the
app being swiped away or killed). On WebViews without `MULTI_PROFILE` all Spaces share the default profile, the
Spaces sheet shows a notice and Burners are disabled.

### Tabs and memory

Only the active tab's WebView is attached. Background WebViews are paused; after 5 minutes idle, when more than
six are alive, or on `onTrimMemory(RUNNING_LOW)` they are destroyed and the tab sleeps (URL, title, thumbnail and —
until restart — the back/forward list are kept). Restored tabs start asleep; only the active one loads at launch.
New tab pages are native Compose and cost no WebView at all.

### Privacy defaults

HTTPS-only (typed and link navigations upgraded, interstitial when a site has no HTTPS, mixed content blocked),
third-party cookies blocked, Do Not Track + Global Privacy Control (header on top-level loads, JS signals via a
document-start script), Safe Browsing on, WebView metrics opted out, reduced user agent, no `X-Requested-With`
header, attribution reporting disabled, camera/microphone/location only after an in-app prompt (remembered per
Space and origin for the session), external apps only after confirmation (sanitized `intent://`), no cloud backup.

## Ad blocking

`ContentBlocker` is called from `shouldInterceptRequest` (WebView IO threads — must be thread-safe and fast);
a blocked request gets an empty 204. `cosmeticCss(documentUrl)` is injected as a `<style>` at page start.

The pure-Kotlin filter-list engine lives in `android/adblock` (`:adblock`, included automatically by
`settings.gradle.kts` when the folder exists). To wire it in:

1. `app/build.gradle.kts`: `implementation(project(":adblock"))`
2. add an adapter, e.g. `app/src/main/java/org/velabrowser/vela/adblock/EngineContentBlocker.kt`:
   ```kotlin
   class EngineContentBlocker(private val engine: AdblockEngine) : ContentBlocker {
       override fun shouldBlock(url: String, documentUrl: String?, kind: RequestKind) =
           engine.shouldBlock(url, documentUrl, kind.toEngineType())
       override fun cosmeticCss(documentUrl: String) = engine.cosmeticCss(documentUrl)
   }
   ```
   mapping `RequestKind` (DOCUMENT, SUBDOCUMENT, SCRIPT, STYLESHEET, IMAGE, FONT, MEDIA, XHR, OTHER) to the
   engine's `ResourceType`;
3. ship the filter lists as assets (e.g. `app/src/main/assets/adblock/*.txt`) and return the engine from
   `ContentBlockers.create(context)` — it runs once on a background thread at startup:
   ```kotlin
   fun create(context: Context): ContentBlocker {
       val lists = context.assets.list("adblock").orEmpty().map { context.assets.open("adblock/$it") }
       return EngineContentBlocker(AdblockEngine.load(lists))
   }
   ```

## App icon

The launcher icon (adaptive + themed/monochrome) and the in-app logo all come from one vector,
`app/src/main/res/drawable/ic_vela_mark.xml` (derived from `build/icon.svg`). Replace its paths to change the
logo; the background is `drawable/ic_launcher_background.xml`.
