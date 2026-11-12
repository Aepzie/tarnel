# Tarnel for Android

Native Android version of Tarnel: Kotlin + Jetpack Compose UI on top of Android System WebView
(`androidx.webkit`). Same ideas as the desktop app — Floating Islands design, isolated Spaces, Burner spaces,
sleeping tabs, privacy defaults — built for phones.

- **applicationId / package:** `org.velabrowser.vela` (debug builds: `org.velabrowser.vela.debug`) — kept from the
  app's former name Vela so existing installs update in place; Kotlin packages, `VELA_*` signing variables and
  `-Pvela.*` Gradle properties keep the old name too
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

### Refresh rate and smoothness

90/120/144 Hz phones often keep an app at 60 Hz unless it asks for more: the WebView scrolls in its own compositor,
so Android's frame-rate heuristics (touch boost, view velocity votes on Android 15+) frequently miss a page scroll,
and a fling outlives the touch. `browser/RefreshRateController.kt` applies Settings → Display → Refresh rate to the
window (WebView included); the mode choice is pure (`core/RefreshRate.kt`, unit-tested):

* **Auto** (default): no pinned mode. While the user touches the screen or a page is still scrolling (WebView
  `onScrollChanged`, which also fires during a fling) Tarnel asks for the fastest rate and drops the request 1.2 s
  after the last activity. Android 15+: `View.setRequestedFrameRate(CATEGORY_HIGH)` on the content view and the
  active WebView (no window update); Android 10–14: a temporary `preferredDisplayModeId`.
* **High**: pins the fastest mode at the current resolution (`preferredDisplayModeId`) and, on Android 15+, turns
  off the system's power-saving frame-rate reduction (`Window.setFrameRatePowerSavingsBalanced(false)`).
* **Standard**: pins the mode closest to 60 Hz and disables the touch boost.

Only modes with the current resolution are considered (switching between them is seamless); single-rate screens are
never pinned. Settings shows the screen's rates and the current one (e.g. "60 · 90 · 120 Hz · now 120 Hz").

Other smoothness work: a full-screen panel (tab switcher, settings, history) that finished animating in hides the
page's WebView (kept attached), so it stops drawing underneath every frame of the panel; tab thumbnails are decoded as
hardware bitmaps and captured ones are uploaded ahead of the first draw (`prepareToDraw`); the island's loading bar
animates in the draw phase only (no recomposition per frame). Already off the main thread before: filter-list
parsing and snapshot loading, thumbnail and session IO; the island reacts to drag *direction* changes only, not to
every scroll pixel.

Measured on the emulator (`Medium_Phone_API_37.0`, single 60 Hz mode, release build, Wikipedia
"History of the United States", 20 swipes, then 6× open/close the tab switcher; `dumpsys gfxinfo` janky frames,
fresh app data per run): scrolling 10.8 / 8.2% before, 16.6 / 9.2 / 8.2% after; tab switcher 22.0 / 6.3% before,
14.9 / 19.0 / 10.9% after — within the emulator's run-to-run noise. Frame time is dominated by the emulator's GPU path (avg ~18 ms in `SwapBuffers`, vs ~3.5 ms
of app UI-thread work per frame), so the refresh-rate modes and their switching could only be verified by unit tests
and on the emulator's single 60 Hz mode — not on real 90/120 Hz hardware.

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

The logo comes from the desktop's single source, `src/shared/brand-mark.ts`: a mountain (body path) over a still
lake whose reflection is three accent bands (cap path), brand accent `#a78bfa`.
`scripts/brand-mark.mjs` (node, no dependencies) generates:

* `res/drawable/ic_vela_mark.xml` — launcher foreground and splash icon (white mountain, accent reflection; the
  desktop tile maps onto the visible 72 dp of the adaptive icon),
* `res/drawable/ic_vela_mono.xml` — themed-icon (monochrome) layer,
* `res/drawable/ic_launcher_background.xml` — dark tile with the accent glow,
* `ui/brand/BrandMark.kt` — path data for the Compose `BrandMark` (mountain in the text color, reflection in the Space accent)
  and `BrandAppIcon`.

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
