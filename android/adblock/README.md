# Tarnel adblock engine (`android/adblock`)

A pure Kotlin/JVM ad & tracker blocking engine for the Android version of Tarnel. No Android
dependencies, so it builds and tests on a desktop JVM and drops into the app as a plain
library module.

```bash
cd android/adblock
./gradlew test                                   # unit tests (real-list tests are skipped)
./gradlew test -PadblockLists=/path/to/lists     # + real EasyList/EasyPrivacy tests
./gradlew test -Pbenchmark -PadblockLists=/path/to/lists --tests '*BenchmarkTest*'
```

`/path/to/lists` must contain `easylist.txt` and `easyprivacy.txt` (optionally `peterlowe.txt`).
The lists are not committed; download them from the URLs in `DefaultLists`.

## API

Package `org.velabrowser.vela.adblock`.

```kotlin
enum class ResourceType { DOCUMENT, SUBDOCUMENT, SCRIPT, STYLESHEET, IMAGE, MEDIA, FONT, XHR, WEBSOCKET, PING, OTHER }

class AdblockEngine {
  companion object {
    fun parse(lists: List<String>): AdblockEngine          // raw list texts
    fun deserialize(bytes: ByteArray): AdblockEngine        // fast startup from a snapshot
  }
  fun serialize(): ByteArray
  fun shouldBlock(url: String, documentUrl: String?, type: ResourceType): Boolean
  fun cosmeticCss(documentUrl: String): String?
  val stats: EngineStats
}

data class EngineStats(...)            // filter counts + unsupported-rule counts
object DefaultLists { val urls: List<String> }   // EasyList, EasyPrivacy, Peter Lowe's
```

* The engine is immutable and thread-safe; call `shouldBlock` straight from
  `WebViewClient.shouldInterceptRequest`.
* `documentUrl` is the URL of the page making the request (the frame's top document is fine).
  Pass `null` for top-level navigations. That treats the request as first-party.
* `shouldBlock` only ever blocks `http(s)://` and `ws(s)://` URLs.
* `DOCUMENT` requests follow Adblock Plus rules: a top-level page is only blocked by a filter
  that explicitly has `$document` or `$all`. Plain `||host^` rules do not block navigations.
* `cosmeticCss` returns `sel,sel,...{display:none!important}` rules, 20 selectors per rule. If
  WebView can't parse one selector, the browser drops only that group of 20, not the whole
  stylesheet. Inject it at `onPageStarted`/`onPageCommitVisible`, for example as a `<style>`
  element. It returns `null` when nothing applies or the page has an `$elemhide`/`$document`
  exception.
* Snapshot workflow: `parse` once after downloading lists. Then `serialize` to a file. On
  every later app start, `deserialize` that file. `deserialize` throws
  `IllegalArgumentException` for a corrupt snapshot or one from another format version. On
  that error, re-parse the lists.

## Supported syntax

| Feature | Notes |
|---|---|
| `||host^`, `||host/path`, `|`, `^`, `*`, right anchor `...|` | Glob matching. `^` = separator or end of URL. Case-insensitive. |
| Plain substring filters | `-ad-banner-`, `/ads/*.gif` |
| Regex filters `/.../` | Max 1024 chars, `java.util.regex`, case-insensitive. Regexes that fail to compile are counted as unsupported. |
| `@@` exceptions | Override blocks |
| `$important` | Beats every exception, including `$document` allowlisting |
| `$third-party` / `$3p`, `$~third-party` / `$first-party` / `$1p` | Uses an embedded Public Suffix List (eTLD+1) |
| `$domain=a.com|~b.com` (`$from=`) | Matches subdomains. Entity form `google.*` is supported. |
| Type options | `script image stylesheet/css xmlhttprequest/xhr subdocument/frame media font websocket ping/beacon document/doc other object all`, plus `~type` negation |
| `@@...$document`, `$elemhide`/`$ehide`, `$generichide`/`$ghide` | Page-level allowlisting. `$document` disables both network blocking and cosmetics on that page. |
| `$badfilter` | Exact-match disable (options compared as written, minus `badfilter`) |
| `$match-case`, `$collapse` | Accepted. Matching is always case-insensitive. |
| Hosts-file lines | `0.0.0.0 a.com b.com`, `127.0.0.1 …`, `::1 …` → `||a.com^` (localhost names are skipped) |
| Cosmetic `##sel`, `example.com##sel`, `~example.com##sel`, `a.com,~b.a.com##sel`, `google.*##sel` | Domain rules also apply to subdomains |
| Cosmetic exceptions `#@#sel`, `example.com#@#sel` | A generic `#@#sel` removes the selector everywhere |
| Native `:has()` in selectors | Passed through; Chromium WebView 105+ supports it |

**Unsupported (dropped and counted in `EngineStats`):**

* `unsupportedScriptlets`: `##+js(...)`, `#$#` snippets, `#%#`
* `unsupportedProcedural`: `:has-text`, `:-abp-*`, `:xpath`, `:upward`, `:style`, `:remove`,
  `:matches-*`, other procedural operators, `#?#`, and `##^` HTML filters
* `unsupportedRedirects`: `$redirect`, `$redirect-rule`, `$removeparam`, `$queryprune`,
  `$rewrite`, `$empty`, `$mp4`
* `unsupportedOther`: `$popup` (about 3k EasyList rules; a WebView engine has no popup
  context), `$csp`, `$header`, `$denyallow`, `$method`, `$genericblock`, `$specifichide`,
  unknown options, invalid or oversized regexes, and selectors containing `{` or `}`, which are
  rejected so a list can't inject arbitrary CSS

Unknown options make the whole filter drop. Ignoring an option would make the rule broader.

## How it works

* **Token index (uBlock/Brave style).** For each network filter, the compiler picks one key:
  * The hostname hash, for `||host^…` filters. A request looks this up by hashing each label
    suffix of its host.
  * Otherwise the rarest "safe" token of the pattern. A safe token is an alphanumeric run that
    is guaranteed to appear as a whole token in any matching URL. It must not be next to `*` or
    to an unanchored pattern edge.

  The compiler first builds a histogram of all candidate keys, then picks the least-used one.
  URL-ubiquitous tokens (`http`, `www`, `com`, `js`, …) are penalized. For regexes, the
  compiler only uses tokens it can safely extract: top-level literals with no alternation.
  Matching a URL means tokenizing it once and probing one open-addressing hash table per
  category (important / block / exception). Filters are only fully checked when they share a key
  with the URL.
* **Filters with no token** but a `$domain=` restriction are indexed by those domains and probed
  with the document's host suffixes. With EasyList + EasyPrivacy, only ~20 filters remain in the
  "check always" bucket.
* **Compact layout.** The index is a sorted `(key, id)` `LongArray` turned into CSR `IntArray`s.
  Domain strings and repeated patterns are interned. Regexes compile lazily. Per-document work
  (parsing, `$document` allowlisting, site keys) is cached in a 64-slot cache.
* **Third-party detection** uses an embedded Public Suffix List snapshot (ICANN + private
  sections, 10.4k rules, 150 KB resource, stored as 64-bit hashes, < 0.5 MB heap).
  * Tradeoff: it is exact, including `github.io`, `co.uk`, `*.ck` and exceptions, and costs no
    allocations. It is a snapshot, though. Suffixes added later fall back to the default `*`
    rule (last label), which is the usual "eTLD+1 approximation".
  * To refresh it, regenerate `src/main/resources/.../public_suffix_list.txt` from
    https://publicsuffix.org/list/public_suffix_list.dat: strip comments and convert IDN labels
    to punycode.
* **Snapshot** is a small custom binary format: string pool, varints, filters plus their chosen
  keys, and cosmetic rules. Indices are rebuilt in O(n) on load without re-tokenizing.

## Benchmarks

Test setup:

* Windows 11 desktop, OpenJDK 17.0.18 (HotSpot), `-Xmx1g`.
* Lists: EasyList, EasyPrivacy and Peter Lowe's, downloaded 2026-11-09.
  * 3.5 MB of text.
  * 105.8k block and 1.6k exception network filters.
  * 24.4k cosmetic rules.
* `shouldBlock` was measured over 200k synthetic requests: a mix of ad/tracker and ordinary CDN
  URLs with random query strings across 8 pages. About 48% of them were blocked.

The numbers are from several runs on a machine that was busy with other builds, so they vary
between runs.

| Metric | Result | Target |
|---|---|---|
| `parse` (cold JVM, first call) | 0.55 – 0.86 s | < 1.5 s |
| `parse` (warm) | ~0.2 – 0.3 s | |
| `deserialize` (cold, first call) | 26 – 78 ms | < 150 ms |
| `deserialize` (warm) | ~21 – 48 ms | |
| `shouldBlock` median | 2.1 – 3.0 µs | < 5 µs |
| `shouldBlock` p99 | 6 – 10 µs | |
| Engine retained heap | ~20 MiB (parsed or deserialized) | < 40 MB |
| Snapshot size | 4.2 MiB (mostly ASCII, so it compresses well if the app wants to gzip it) | |
| `cosmeticCss` | 3 – 25 µs; ~150 µs on pages whose exceptions touch generic selectors | |
| Generic cosmetic CSS | 218 KiB | |

ART on a phone will be slower than desktop HotSpot. Expect roughly 3–5×, which still keeps
`shouldBlock` well under the cost of the network request it guards.
