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

## Cutting a release

1. Update `version` in `package.json` and move the `[Unreleased]` notes in `CHANGELOG.md` under the new
   version.
2. Merge to `main`, then tag: `git tag v0.7.0 && git push origin v0.7.0`.
3. Watch the **Release** workflow. In the "Configure code signing" step, check that each platform
   reports the signing mode you expect.
4. Tags containing `-` (e.g. `v0.7.0-beta.1`) are published as pre-releases.
