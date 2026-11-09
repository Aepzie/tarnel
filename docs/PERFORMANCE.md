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

### 3. Content blocking at the network layer
`src/main/perf/adblock.ts` runs the Ghostery engine (EasyList, EasyPrivacy and related lists) on
`webRequest.onBeforeRequest`, so ad and tracker requests are **cancelled before a socket is
opened** — no download, no parse, no script execution, no third-party iframes spinning up their own
processes. On ad-heavy news and recipe sites this typically cuts page weight and request count by
30–60% and removes most long main-thread tasks. On clean sites it does nothing, and costs
microseconds per request (the engine is a compact pre-compiled matcher).

- **Instant startup:** the compiled engine is cached as a binary in `userData/adblock-engine.bin`
  and deserialized in milliseconds. Launch never waits on the network.
- **Background refresh:** if the cache is older than 24 h, a fresh engine is fetched (through
  Chromium's network stack, so proxies apply), written atomically (tmp + rename), and hot-swapped
  into every Space.
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

`enable-features` / `disable-features` are *merged* with any existing value, because Chromium only
honours the last occurrence of each.

**Deliberately not used:**

| Switch | Why not |
|---|---|
| `enable-gpu-rasterization`, `enable-zero-copy`, `ignore-gpu-blocklist` | GPU raster and zero-copy are already on by default where the driver is known-good. Forcing them bypasses the blocklist and causes corruption or crashes on bad drivers. |
| `disable-renderer-backgrounding`, `disable-background-timer-throttling`, `disable-backgrounding-occluded-windows` | Background tabs would burn CPU and battery. |
| Forcing `BackForwardCache` | Instant back/forward is valuable, but forcing it under Electron's navigation model is not well-trodden; we'd rather miss a speedup than break history. Revisit when upstream Electron enables it. |
| `process-per-site`, disabling site isolation | Saves memory by weakening Spectre isolation. Not a trade we make. |
| Disabling the spare renderer | Saves ~20 MB but slows every new navigation. |
| `js-flags` (V8 tuning) | V8 defaults are tuned on far more workloads than we can test. No clear win. |

## Measuring it in-app

`collectPerfStats()` (`src/main/perf/metrics.ts`) sums `workingSetSize` and CPU over *all* processes
(browser, GPU, utility, renderers) — the same scope as the OS task manager — and estimates memory
saved by sleeping tabs as `tabsAsleep × average renderer working set` (80 MB fallback). The chrome
UI's renderer is included in that average, which slightly under-states savings; we prefer to
under-claim.

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
