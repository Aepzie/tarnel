# Releasing Tarnel

Releases are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml) when a `v*`
tag is pushed (or the workflow is run by hand, which builds but does not publish). Each desktop target
packages on its own runner; the publish job merges the macOS update feeds, writes `SHA256SUMS.txt` and
creates the GitHub release.

## Code signing

Signing is **off until the secrets below exist** and switches itself on per platform once they do. No
workflow or config change is needed. Before every package step, `scripts/signing-config.mjs` checks which
secrets are present and prints the result in the log:

```
Code signing: off (unsigned build)      # nothing configured
Code signing: azure                     # Windows, Azure Trusted Signing
Code signing: pfx                       # Windows, PFX certificate
Code signing: developer-id              # macOS, followed by "Notarization: on|off"
```

A partial set (for example only some Azure values) never breaks the build. The script logs which names
are missing and that platform stays unsigned (or, on macOS, signed but not notarized).

Add secrets under **Settings → Secrets and variables → Actions**. Values that are not secret (endpoint,
account, profile, publisher name) can be added as **Variables** instead. The workflow reads both.

### Windows: Azure Trusted Signing (recommended)

Microsoft's managed signing service (also called Artifact Signing). The certificate lives in Azure and
renews itself every few days, so nothing expires on you. SmartScreen reputation attaches to the verified
identity, so warnings disappear after a short ramp-up instead of starting from zero with each new
certificate.

1. Create a Trusted Signing account and finish identity validation (organisation, or individual where
   Microsoft offers that). Then create a **Public Trust** certificate profile.
2. Create an app registration (service principal), create a client secret for it, and give it the
   **Trusted Signing Certificate Profile Signer** role on the account.
3. Add:

| Name | Kind | Value |
|------|------|-------|
| `AZURE_TENANT_ID` | secret | Directory (tenant) ID of the app registration |
| `AZURE_CLIENT_ID` | secret | Application (client) ID |
| `AZURE_CLIENT_SECRET` | secret | Client secret value |
| `AZURE_SIGNING_ENDPOINT` | variable | Account endpoint, e.g. `https://eus.codesigning.azure.net` (matches the account's region) |
| `AZURE_SIGNING_ACCOUNT` | variable | Trusted Signing account name |
| `AZURE_SIGNING_PROFILE` | variable | Certificate profile name |
| `WIN_PUBLISHER_NAME` | variable | The certificate's subject CN, **exactly** (e.g. `Jane Doe` or `Example Ltd`) |

electron-builder installs the `TrustedSigning` PowerShell module on the runner and signs the app, the
installer and the portable exe.

### Windows: PFX certificate (alternative)

For an existing OV/EV certificate that can be exported as `.pfx`. Note that certificates issued since
mid-2023 must live on a hardware token or cloud HSM, so new ones usually can't be exported. Use Azure
Trusted Signing or a CA's cloud signing service for those.

| Name | Kind | Value |
|------|------|-------|
| `WIN_CSC_LINK` | secret | The `.pfx` as base64 (`base64 -w0 cert.pfx`, or `[Convert]::ToBase64String([IO.File]::ReadAllBytes('cert.pfx'))`) |
| `WIN_CSC_KEY_PASSWORD` | secret | The `.pfx` password |
| `WIN_PUBLISHER_NAME` | variable | Optional. Defaults to the certificate's CN |

If both Azure and PFX secrets are configured, Azure wins.

### Windows: publisher check and the updater

When a build is signed, electron-builder writes the publisher name into the app's `app-update.yml`. The
installed app's electron-updater then **refuses any update whose installer isn't signed by that
publisher**. Unsigned builds carry no publisher name, so they skip the check. That is why
`win.publisherName` is only set while signing (see `src/main/updater.ts`). As a result:

- **Unsigned → signed** works: the old unsigned app installs the first signed release.
- **Signed → unsigned** does not. Once a signed release is out, every later release must be signed, or
  installed copies stop auto-updating (they show "failed signature verification").
- **Keep `WIN_PUBLISHER_NAME` stable.** If the CN ever changes (new legal name, different CA), ship
  one release whose config lists both names first. `publisherName` accepts an array.

### macOS: Developer ID + notarization

Requires a paid Apple Developer Program membership. The app is signed with the hardened runtime and
`build/entitlements.mac.plist`:

| Entitlement | Why |
|-------------|-----|
| `cs.allow-jit`, `cs.allow-unsigned-executable-memory` | V8/Chromium JIT |
| `cs.disable-library-validation` | Electron's separately signed helpers and frameworks |
| `device.camera`, `device.audio-input` | getUserMedia / WebRTC calls |
| `device.usb` | WebAuthn hardware security keys, WebUSB/WebHID |
| `personal-information.location` | `navigator.geolocation` |

The matching `NS…UsageDescription` strings are in `electron-builder.yml` (`mac.extendInfo`).
Platform passkeys via Touch ID would additionally need a provisioning profile with keychain access
groups. That is not set up.

1. In the Apple Developer portal, create a **Developer ID Application** certificate and export it
   from Keychain Access as `.p12` with a password.
2. At [appleid.apple.com](https://appleid.apple.com), create an **app-specific password** for the Apple
   ID that belongs to the team.
3. Add:

| Name | Kind | Value |
|------|------|-------|
| `MAC_CSC_LINK` | secret | The `.p12` as base64 (passed to electron-builder as `CSC_LINK`) |
| `MAC_CSC_KEY_PASSWORD` | secret | The `.p12` password (passed as `CSC_KEY_PASSWORD`) |
| `APPLE_ID` | secret | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | secret | The app-specific password |
| `APPLE_TEAM_ID` | secret | 10-character Team ID |

The certificate secrets have a `MAC_` prefix so the Windows signer can never pick up the Apple
certificate. With only the two certificate secrets, builds are signed but not notarized, and
Gatekeeper still warns. Once a release is Developer-ID signed, the macOS updater switches from
"notify" to background install by itself (`isDeveloperIdSigned` in `src/main/updater.ts`).

### Linux and Android

AppImage and deb are not signed. Integrity is covered by `SHA256SUMS.txt`. Android signing already
uses its own `ANDROID_KEYSTORE_*` secrets (see the `android` job).

### Costs (approximate, check current pricing)

| Option | Cost | Notes |
|--------|------|-------|
| Azure Trusted Signing, Basic | about $10/month | Includes a monthly signature quota that is far more than releases need. Identity validation is required |
| OV code-signing certificate | about $200–500/year | Hardware token or cloud HSM. SmartScreen reputation builds up over time |
| EV code-signing certificate | about $300–700/year | Same SmartScreen behaviour as OV today. Not worth the premium for Tarnel |
| Apple Developer Program | $99/year | Needed for Developer ID and notarization |
| [SignPath Foundation](https://signpath.org) | free for qualifying OSS | Alternative for Windows. Signs releases built by CI via their GitHub integration. Needs a different workflow step (SignPath's action) instead of the electron-builder signer, so it is not wired up here |

## Default apps registration

The Windows installer's default-browser registration is `build/installer.nsh` (see docs/ARCHITECTURE.md,
"Default browser and file types"). Before a release that changes it, install the build on a test machine or VM
and check: Tarnel listed under Settings → Default apps and in "Open with" for `.pdf` / `.html`, "Make default"
opens Tarnel's page there, and uninstall leaves no `StartMenuInternet\Tarnel`, `RegisteredApplications\Tarnel` or
`Software\Classes\Tarnel*` keys. When upgrading over a Vela (≤ 0.9.x) install, also check that the old
`StartMenuInternet\Vela`, `RegisteredApplications\Vela`, `Software\Classes\Vela*` keys and `Vela*` OpenWithProgids
values are gone, so Windows lists only one browser. The portable exe registers nothing.

## Optional Widevine development runtime

The standard npm dependency and release pipeline still use stock Electron **45.2.3**, which does not
provide this Widevine integration. Enabling the setting there correctly reports a missing runtime.
The optional path uses official [Castlabs Electron for Content Security](https://github.com/castlabs/electron-releases)
**45.2.1+wvcus** (Chromium **156.0.8078.75**), the available stable ECS release selected for this work.
It does not silently replace/downgrade the normal dependency or add a package dependency.

```sh
npm run drm:install
npm run dev:drm
```

In Tarnel, enable Settings → Privacy → **Protected content (DRM)** and use **Restart Tarnel**.
The first enabled launch may download Widevine; only an installed CDM plus a successful native
`MediaKeys` probe produces "DRM component available". A service can still reject the browser.
Changing back to off also requires restart for the global native Widevine gate.

`scripts/drm-runtime.mjs` downloads a pinned release asset, verifies SHA-256, checks version and cached
executable integrity, and launches it from `.cache/drm-runtime`. Supported asset targets: Windows,
macOS and Linux, each x64/arm64. Only Windows x64 has been runtime-tested. On Windows the installer
gives AppContainer (`S-1-15-2-1`) read/execute permission on that exact verified runtime directory, so
the renderer sandbox can read its files. It rejects symlinks, junctions and redirected paths. It
does not change permissions elsewhere. The launcher honors `TARNEL_USER_DATA` (or `VELA_USER_DATA`)
for isolated testing.

Installing the runtime is a developer action and downloads that runtime independently of the browser
toggle. The **CDM** is handled exclusively by Castlabs' official component mechanism after browser
consent. No Chrome/Edge CDM extraction, manual CDM redistribution or DRM/key bypass is implemented.
Google component requests and service license exchanges have privacy implications. The UI documents
these and the lack of complete DRM isolation between Spaces; see [architecture](ARCHITECTURE.md#protected-content--drm-srcmaindrm).

### Production release blockers

This is a working development integration, **not a DRM-ready signed release configuration**.
`npm run dist` and the release workflow still produce the stock build. The optional cached runtime is
not packaged automatically. Before releasing an ECS build, maintainers must establish their applicable
Widevine/ECS usage and distribution terms, configure Castlabs Verified Media Path (VMP) signing and
the platform identities, and test the final artifact against the intended services. Credentials and
publisher identities were not provided or fabricated for this task.

Follow the upstream [EVS signing instructions](https://github.com/castlabs/electron-releases/wiki/EVS)
and [FAQ](https://github.com/castlabs/electron-releases/wiki/FAQ). The order matters: finish fuse/binary
mutations first; on Windows, Authenticode-sign before VMP-signing; on macOS, VMP-sign before Apple
code-signing/notarization. Archive only the final verified result. A generic electron-builder
`afterPack` hook is not enough because later fuse/signing changes can invalidate VMP. Linux/service
requirements differ and need separate validation. Do not disable Tarnel's fuses to get a player working.
The current ordinary OS-signing pipeline above does not establish VMP support.

The ECS pin is independent of the standard Electron pin; review security updates for both. Upgrading
the optional runtime requires updating official asset hashes and repeating the native gate/component
tests, including installed-CDM OFF behavior. Newer ECS component APIs may have different lifecycles.

### Validation and reproducible checks

```sh
npm run typecheck
npm test
npm run build
npm run test:drm-runtime
npm run test:drm-native
# Explicitly permits official CDM download into a temporary test profile:
npm run test:drm-native -- --download-cdm
```

The native runner installs/verifies the optional **runtime** when needed; without `--download-cdm`
it only checks OFF behavior. With the flag it checks OFF → install → ON → OFF with the installed CDM,
using hidden sandboxed windows and deleting its temporary profile afterward. Results are written to
`.cache/drm-native-smoke-results.json`; it never opens a streaming account or uses the normal profile.

Verified on Windows x64: real Widevine **4.10.3112.0** installation, warm-start registration, native
`requestMediaKeySystemAccess`/`createMediaKeys`, rejection after OFF restart with CDM retained, and the
document policy. The original integration's isolated-profile smoke covered validated IPC, settings push updates,
persistence, real relaunch in both directions, and ordinary MP4 playback. Light/dark settings rendering,
mobile width, toggle and error/restart states were exercised in a separate hidden UI harness.

A separate sandboxed ECS harness played the official Shaka **Sintel Widevine** sample from an encrypted
position: public license responses were HTTP 200, `com.widevine.alpha` was selected, playback advanced
from 15.00 to 21.96 seconds with 167 additional decoded frames. The public example comes from
[Shaka's license-server tutorial](https://github.com/shaka-project/shaka-player/blob/main/docs/tutorials/license-server-auth.md).
A second test in the complete app used a regular Space with standard fingerprint protection,
adblock, HTTPS upgrades, third-party cookie blocking and cookie-banner rejection still enabled. The
same public Widevine sample advanced from 15.02 to 21.96 seconds with 163 additional decoded frames,
two successful license responses and no player errors. Sandbox, context isolation and web security
remained enabled. This proves that public protected playback works in the integrated development app,
not Netflix approval or a production Tarnel build.
No authorized Netflix account was supplied or used; **Netflix playback and resolution limits are
unverified**. Its previous `M7701-1003` symptom cannot be declared fixed without that test. macOS,
Linux, ARM64, final installer signing/VMP and streaming-service policies still need validation.

## Cutting a release

1. Update `version` in `package.json` and move the `[Unreleased]` notes in `CHANGELOG.md` under the new
   version.
2. Merge to `main`, then tag: `git tag v0.7.0 && git push origin v0.7.0`.
3. Watch the **Release** workflow. In the "Configure code signing" step, check that each platform
   reports the signing mode you expect.
4. Tags containing `-` (e.g. `v0.7.0-beta.1`) are published as pre-releases.
