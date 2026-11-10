# Vela — Performance

Vela runs on Chromium (via Electron). That sets the ceiling for raw engine speed: **Vela's JavaScript,
layout and rendering speed is Chromium's.** We don't claim otherwise. Where a browser *can* win on
top of the same engine is in what it chooses not to do: fewer bytes downloaded, fewer processes kept
alive, less work at startup, and no background services. That is where Vela is built to win.

## What Vela does

### 1. A UI that costs almost nothing
The browser chrome (top island, tabs, palette) is a single small React renderer. State from main
arrives through ONE subscription (`useSyncExternalStore`), components select slices and tab pills are
memoized, so a title change re-renders one pill, not the tree. Animations run on transform/opacity
only. Web pages never pay for any of it: they live in separate sandboxed processes.

### 2. Tab sleeping that actually frees memory
Most "tab discarding" freezes JS but keeps the process. Vela **destroys the tab's renderer
process** (`src/main/perf/sleeper.ts`) and keeps only URL, title and favicon. Memory goes back to
the OS; the tab reloads when you click it.

- Background tabs sleep after *N* minutes idle (Settings, default 10; 0 = never).
- Never slept: the active tab, pinned tabs, tabs playing audio.
- **On battery the timeout is halved** — every awake renderer means timers, GC and wakeups.
- **Memory pressure:** when free system RAM drops below 10%, the 2 least-recently-used eligible tabs
  (idle ≥ 60 s) are slept on each 30 s tick until pressure clears, regardless of the timeout.
- The 30 s timer is `unref()`'d and does O(tabs) work — it costs nothing measurable.
- Verified: after `sleepTab` the tab's renderer process *and* its out-of-process-iframe renderers
  exit (PIDs gone within a second); the main process keeps no `WebContents` for it
  (`webContents.getAllWebContents()` lists only the UI and awake tabs).

What sleeping cannot give back is memory held by shared Chromium services the pages used — see
[Memory: measured](#memory-measured).

### 3. Content blocking at the network layer
`src/main/perf/adblock.ts` runs the Ghostery engine (EasyList, EasyPrivacy and related lists) on
`webRequest.onBeforeRequest`, so ad and tracker requests are **cancelled before a socket is
opened** — no download, no parse, no script execution, no third-party iframes spinning up their own
processes. On ad-heavy news and recipe sites this typically cuts page weight and request count by
30–60% and removes most long main-thread tasks. On clean sites it does nothing, and costs
microseconds per request (the engine is a compact pre-compiled matcher).

- **Instant startup:** the compiled engine is cached as a binary in `userData/adblock-engine.bin`
  and deserialized in milliseconds. Launch never waits on the network. The file starts with a key
  header (`perf/adblock-cache.ts`: Ghostery `ENGINE_VERSION` + library version + list set), so a
  library upgrade or list change is a cache miss, not a deserialize error.
- **Measured** (Ghostery 2.20.3, prebuilt ads + tracking, ~6.9 MB cache; Node, same code path):
  cold start without cache = network build **0.75–1.3 s** (median ~1.0 s); warm start from cache =
  read + header check + deserialize **20–38 ms** (median ~30 ms). The main process logs which path
  it took: `[adblock] engine ready from cache|network in N ms`.
- **Ready before the first request:** each new session gates `whenSessionReady()` (via
  `gateSessionReady`, which now combines gates from several hooks) on the first engine, so a
  restored tab's first page load is already filtered. Warm, that wait is the ~30 ms above. Cold
  (first run / unusable cache) the gate is capped at 3 s; past that, pages load unblocked until the
  engine arrives and is applied to every session. Adblock off never gates.
- **Background refresh:** whenever the engine is older than 24 h (checked at launch and hourly
  while running), a fresh engine is fetched (through Chromium's network stack, so proxies apply),
  written atomically (tmp + rename), and hot-swapped into every Space in one synchronous step.
  Only one refresh runs at a time.
- **Corrupt cache:** an unreadable or foreign cache file is deleted and rebuilt from the network.
- **Cosmetic filtering** (hiding leftover ad slots) runs through the library's preload, registered
  with `session.registerPreloadScript`. It only needs `ipcRenderer`, so it works in sandboxed tabs.
- **Fail-open:** offline first run, corrupt cache, CDN outage → browsing continues unblocked.

### 4. Chromium's own power management, left intact
Hidden tabs keep Chromium's background timer throttling and intensive wake-up throttling; occluded
windows are backgrounded (`CalculateNativeWinOcclusion` on Windows). Many Electron apps disable these
(`disable-renderer-backgrounding`, `disable-background-timer-throttling`) to make *their* single
page snappier. A browser with dozens of tabs must not, and Vela never does.

### 5. Lazy session restore
Restored tabs come back **asleep**: only the active tab gets a renderer at launch. Restoring a
40-tab session costs about as much as opening one tab.

### 6. Preconnect on intent
Hovering or arrowing onto an address-bar suggestion preconnects (DNS + TCP + TLS) to that origin, so
by the time you press Enter the handshake — often 100–300 ms on mobile networks — is already done.

### 7. Chromium switches (`src/main/perf/flags.ts`)
Only switches that are stable and safe on every GPU. Launch with `VELA_NO_FLAGS=1` to skip all of
them (useful for bisecting a site bug).

| Switch | Why |
|---|---|
| `enable-features=ParallelDownloading` | Large downloads use parallel range requests when the server supports it. |
| `disable-features=MediaRouter,DialMediaRouteProvider` | No Cast discovery: avoids periodic mDNS/SSDP LAN scanning. |
| `disable-features=OptimizationHints,Translate,AutofillServerCommunication,InterestFeedContentSuggestions` | Chrome services that phone home or do background work. Mostly not compiled into Electron — listed so they stay off if that ever changes. |
| `no-pings` | Ignores `<a ping>` hyperlink auditing: one fewer tracking request per click. |
| `disable-domain-reliability` | No network-error beacons to Google. |
| `disable-component-update` | No Chrome component downloads we don't consume. |

| `enable-features=UseCompositorClockVSyncInterval` (Windows, conditional) | Frame pacing on mixed-refresh setups, see [Frame rate](#8-frame-rate-windows). |

`enable-features` / `disable-features` are *merged* with any existing value, because Chromium only
honours the last occurrence of each.

**Deliberately not used:**

| Switch | Why not |
|---|---|
| `enable-gpu-rasterization`, `enable-zero-copy`, `ignore-gpu-blocklist` | GPU raster and zero-copy are already on by default where the driver is known-good. Forcing them bypasses the blocklist and causes corruption or crashes on bad drivers. |
| `disable-renderer-backgrounding`, `disable-background-timer-throttling`, `disable-backgrounding-occluded-windows` | Background tabs would burn CPU and battery. |
| Forcing `BackForwardCache` | Instant back/forward is valuable, but forcing it under Electron's navigation model is not well-trodden; we'd rather miss a speedup than break history. Revisit when upstream Electron enables it. |
| `process-per-site`, disabling site isolation | Saves memory by weakening Spectre isolation. Not a trade we make. |
| Disabling the spare renderer | Saves ~20 MB but slows every new navigation. (No spare renderer shows up in Vela's process list today; measured, nothing to win.) |
| `disable-features=MediaDevicesSystemMonitorCaching` | Tried to let the video-capture service exit after YouTube's device enumeration. Measured: the process stays anyway. |
| `force-gpu-mem-discardable-limit-mb` | Tried to shrink GPU memory kept after tabs sleep. Measured: no meaningful change. |
| `js-flags` (V8 tuning) | V8 defaults are tuned on far more workloads than we can test. No clear win. |
| `disable-frame-rate-limit`, `disable-gpu-vsync` ("unlimited fps") | Measured: rAF *dropped* from 144/75 to ~59 fps on Windows 11 (DirectComposition throttles the uncapped frames). Not offered. |
| `limit-fps=N`, `max-gum-fps` (frame caps) | Chromium has no switch that caps on-screen frame production: `limit-fps` is ignored, `max-gum-fps` only limits getUserMedia capture. No 60/120/144 Hz caps are offered for that reason. |
| `force_high_performance_gpu` / `force_low_power_gpu` | No effect on the frame rate (measured, hybrid Intel + NVIDIA laptop); left to Windows' per-app GPU setting. |

### 8. Frame rate (Windows)
Stock Chromium on Windows paces every window to the **primary** display's vblank. On a laptop with a
144 Hz panel next to a 75 Hz primary monitor, Vela therefore drew at 75 fps on the 144 Hz panel — that is
the "doesn't feel smooth" report. `UseCompositorClockVSyncInterval` paces to the DWM compositor clock
instead, which ticks at the *fastest* connected display's rate: right for a window on that display, wasted
(and unevenly paced) frames on a slower one. `src/main/perf/frame-rate.ts` therefore decides at launch:

| Settings → Performance → Frame rate | Switch set when |
|---|---|
| **Match display** (default) | the window opens on a display faster than the primary one |
| **Highest** | any connected display is faster than the primary one |
| **Primary display** | never (stock Chromium; saves GPU work on a fast laptop panel) |

Feature switches are fixed for the process lifetime and `screen` is unavailable before `ready`, so the
decision uses the display layout saved during the previous run (`userData/displays.json`) and the saved
window bounds. When the setting, the layout or the window's display no longer match the running process,
Settings shows "Restart to apply" with a Restart button (`app.relaunch()`). Single-refresh-rate setups and
macOS/Linux are unaffected: Chromium already follows the display there. Settings also lists the detected
displays (`displayFrequency`) and the fps the settings page itself measures with `requestAnimationFrame`.

Measured (rAF over 4 s in the new-tab page and the chrome UI, isolated profile, Windows 11, Electron 45;
built-in 144 Hz panel on the Intel iGPU + 75 Hz primary monitor on the NVIDIA dGPU):

| Window on | Before (stock / `VELA_NO_FLAGS=1`) | After, Match display |
|---|---|---|
| 144 Hz panel | 75 fps (13.3 ms) | **144 fps (6.9 ms)**, 0 frames > 1.5× median |
| 75 Hz primary | 75 fps | 75 fps (switch not set) |
| 75 Hz primary, *Highest* | — | 144 fps (oversampling, as documented) |

## Measuring it in-app

`collectPerfStats()` (`src/main/perf/metrics.ts`) sums **private memory** (`privateBytes` from
`app.getAppMetrics()`; working set on macOS, where it is not reported) and CPU over *all* processes:
browser, GPU, utility and renderers.

It used to sum `workingSetSize`. That counts every page shared between processes (Chromium and
system DLLs, shared memory) once *per process*, so with ~10 processes it over-reported by hundreds
of MB: a fresh window showed ~790 MB while the processes really owned ~330 MB, and five slept tabs
showed ~1.25 GB for ~600 MB. That inflated number is what users saw in the perf chip.

"Saved by sleeping" is now measured, not guessed: right before a tab sleeps, Vela records the private
memory of the renderer processes only that tab used (its page process plus out-of-process iframes;
processes shared with another awake tab count as 0). Tabs restored asleep at launch were never
measured; they are estimated from the average awake web-page renderer (the UI renderer excluded,
80 MB fallback).

## Memory: measured

Windows 11, Electron 45 (Chromium 156), isolated profile with the ad-block engine cached, window
1280×820. Sites: github.com, youtube.com, en.wikipedia.org (article), reddit.com, MDN JavaScript.
Each opened as the active tab 2.5 s apart; then the new-tab page activated and all five slept with
`vela.tabs.sleep`. Columns are sums over every Vela process: **Private** = private commit (what Vela
now displays), **Private WS** = private working set (Task Manager "Memory" column), **WS** = working
set (what Vela used to display). MB.

| Scenario | Before: Private | Before: WS (shown in app) | After: Private (shown in app) | After: Private WS | After: WS |
|---|---|---|---|---|---|
| (a) fresh start, new tab only | 334 | 787 | **312** | 161 | 482 |
| (b) + 5 sites awake | 1419 | 2551 | 1360 | 920 | 2191 |
| (c) 5 sites asleep, +10 s | 640 | 1252 | 593 | 329 | 950 |
| (d) 5 sites asleep, +60 s | 601 | 1250 | **593** | 328 | 947 |

Processes: 6 → **5** at start (no idle renderer for the window itself, see below).

What changed:
- **The window is a `BaseWindow`, not a `BrowserWindow`.** All UI lives in WebContentsViews; the
  BrowserWindow's own never-loaded webContents still kept a renderer process alive (14 MB private,
  ~100 MB working set). Removing it also trimmed ~40 MB of working set from the browser process.
- **The displayed number is private memory**, and "saved" is measured per tab (see above).

What sleeping five heavy tabs still leaves behind (state (d) vs (a), private):
| Process | (a) | (d) | Why |
|---|---|---|---|
| GPU | 130 | 306 | Allocations made while rasterizing / decoding for the heavy pages (driver heaps, Skia and shader caches) are kept by the GPU process after the renderers exit. A control run with five trivial pages (example.com etc.) returns to +20 MB, so this scales with page content. Chrome behaves the same; there is no supported API to make the GPU process trim. |
| Video capture service | – | 75 (14 resident) | Started by YouTube's `enumerateDevices()`; Chromium keeps it for the session. |
| Audio service | – | 6 | Started by the first page that plays/prepares audio. |
| Browser + network | 100 | 111 | Caches, history, small growth. |
| Renderers (UI + new tab) | 83 | 95 | Unchanged apart from normal UI activity. |

Every web-page renderer is gone after sleeping. The browser's main-process JS heap is small
(~8 MB used, ~11 MB external incl. the ad-block engine), so there is nothing large to trim there.

## Benchmarking honestly

Compare against Chrome, Edge, Brave and Firefox on the same machine: plugged in, freshly rebooted, no
extensions, each run 3×, report the median.

**Engine benchmarks — expect parity with Chrome.**
- [Speedometer 3](https://browserbench.org/Speedometer3.0/) — responsiveness of real web-app patterns
- [JetStream 2](https://browserbench.org/JetStream/) — JS/Wasm throughput
- [MotionMark](https://browserbench.org/MotionMark1.3/) — graphics

Vela should land within noise of the Chrome release matching its Electron's Chromium version. If it
is notably worse, that's a bug — file it with `VELA_NO_FLAGS=1` results attached.

**Where Vela should win — measure these:**
1. **Memory with N tabs.** Open the same 20 real sites (news, docs, webmail, video), wait 15 min
   idle, record total memory from the OS (Windows: sum of Private Working Set across the app's
   processes; macOS: Activity Monitor "Memory" summed). The sleeper should hold this to roughly
   *active tab + chrome*.
2. **Bytes and requests per page.** DevTools Network panel, cache disabled, on 10 ad-heavy sites.
   Compare with Chrome (no extensions) and with Brave, for fairness.
3. **Cold start** to first paint of the new-tab page, and **session restore** time with 40 tabs.
4. **Idle CPU / wakeups** with 20 background tabs (Windows: `powercfg /energy`; macOS: Activity
   Monitor "Energy Impact").

Publish the methodology with the numbers. A benchmark that can't be reproduced isn't one.
