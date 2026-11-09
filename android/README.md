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
    BlobDownloads.kt      data:/blob: downloads → MediaStore
  adblock/
    ContentBlocker.kt     the blocking seam (interface + RequestKind inference)
    HostListBlocker.kt    small built-in host list, active until the filter-list engine is loaded
    ContentBlockers.kt    the built-in blocker
    EngineContentBlocker.kt  adapter to the :adblock engine (RequestKind → ResourceType)
    FilterLists.kt        list download, snapshot (de)serialization, 4-day refresh, status for Settings
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
a blocked request gets an empty 204 and is counted once per URL for the menu badge. `cosmeticCss(documentUrl)` is
injected as a `<style>` at page start.

The engine is the pure-Kotlin `android/adblock` module (`implementation(project(":adblock"))`, its JUnit 5 tests run
with `:app:testDebugUnitTest`). `adblock/EngineContentBlocker.kt` maps `RequestKind` to the engine's `ResourceType`.

**Lists are not bundled** (the APK stays small). `adblock/FilterLists.kt`:

* first run: the built-in `HostListBlocker` (≈70 ad/tracker hosts) is active immediately; `DefaultLists.urls`
  (EasyList, EasyPrivacy, Peter Lowe's) are downloaded on any network, validated (captive portals and error pages are
  rejected), parsed on a background thread and swapped in. The texts go to `filesDir/adblock/lists/`, the compiled
  engine to `filesDir/adblock/engine.bin` (`serialize()`, ~4.2 MiB).
* later starts: `deserialize()` the snapshot; on `IllegalArgumentException` (corrupt / other format version) the
  cached texts are re-parsed and a new snapshot written.
* refresh: every 4 days, checked at start and whenever the app returns to the foreground (no WorkManager; failed
  attempts are retried after 30 min). Settings → Ad blocking shows the filter count, last update and "Update now".

Measured (131.8k filters, 4.19 MiB snapshot):

| | JVM (HotSpot 21, `FilterListsTest`) | Emulator, release build (x86_64, API 37) |
|---|---|---|
| parse | 755 ms | 824 ms |
| deserialize | 75 ms cold, 53 ms warm | 290–500 ms |

`FilterListsTest.snapshotDeserializeTiming` prints the JVM numbers with real lists:
`./gradlew :app:testDebugUnitTest --tests '*FilterListsTest*' -Pvela.adblockLists=<dir with easylist.txt,
easyprivacy.txt, peterlowe.txt>`. Debug builds are much slower (≈4–5 s), measure release builds.

## Logo and typography

The logo comes from the desktop's single source, `src/shared/brand-mark.ts` (cap + body paths, accent `#60a5fa`).
`scripts/brand-mark.mjs` (node, no dependencies) generates:

* `res/drawable/ic_vela_mark.xml` — launcher foreground and splash icon (blue cap, white body; the desktop tile maps
  onto the visible 72 dp of the adaptive icon),
* `res/drawable/ic_vela_mono.xml` — themed-icon (monochrome) layer,
* `res/drawable/ic_launcher_background.xml` — dark tile with the accent glow,
* `ui/brand/BrandMark.kt` — path data for the Compose `VelaMark` (body in the text color, cap in the Space accent)
  and `VelaAppIcon`.

After changing `brand-mark.ts` run `./gradlew :app:syncBrandMark` (or `node android/scripts/brand-mark.mjs`);
`BrandMarkSyncTest` fails while the generated files are out of date.

The UI font is **Geist Variable** (SIL OFL 1.1, `third_party/geist/OFL.txt`), subset to Latin (115 KB) in
`res/font/geist.ttf`. Like desktop, the accent is the active Space's color; the default Space is blue.

## Browsing features

Find in page (menu → compact island with n/m and previous/next), "Desktop site" per tab (desktop Chrome UA,
remembered in the session), long-press drag to reorder tabs in the switcher, popups / `window.open` / "Open in new
tab" children return to their opener when closed, and downloads: `http(s)` through DownloadManager, `data:` and
`blob:` (read by a page script, posted back over a token-checked `WebMessageListener`) saved to Downloads via
MediaStore under the link's `download` name.
