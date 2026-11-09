# Security Policy

A browser is security-critical software. We take every report seriously and appreciate responsible disclosure.

## Supported versions

Vela is pre-1.0. Only the **latest release** receives security fixes.

| Version         | Supported |
|-----------------|-----------|
| latest `0.x`    | yes       |
| older releases  | no        |

Vela inherits Chromium's web platform through Electron. Engine-level vulnerabilities are fixed by
upgrading Electron; we aim to ship a Vela release promptly after an Electron security release.

## Reporting a vulnerability

**Please do not open a public issue.** Instead, use GitHub's private reporting:

1. Go to <https://github.com/Aepzie/vela/security/advisories/new>.
2. Describe the issue, affected version and platform, and steps to reproduce (a minimal proof of concept helps).
3. Tell us whether and how you would like to be credited.

What to expect:

- Acknowledgement within **3 business days**.
- An initial assessment within **7 days**.
- A fix or mitigation plan for confirmed issues, with coordinated disclosure once a release is available
  (target: within 90 days, sooner for actively exploited issues).

## In scope

Issues in Vela's own code, for example:

- Escaping the renderer sandbox or bypassing `contextIsolation` via Vela's preloads.
- IPC handlers reachable from web content, or missing sender validation.
- Web pages gaining access to privileged `vela://` pages or their APIs.
- **Data leaking between Spaces** (cookies, storage, cache, permissions, proxy settings).
- Burner (ephemeral) Space data persisting to disk or surviving the Space being closed.
- Path traversal in the `vela://` protocol handler.
- Ad-blocker or privacy features that can be abused to inject content.

## Out of scope

- Vulnerabilities in Chromium or Electron themselves — please report those upstream
  ([Chromium](https://www.chromium.org/Home/chromium-security/reporting-security-bugs/),
  [Electron](https://github.com/electron/electron/security/policy)). Tell us too, so we can track the upgrade.
- Issues that require a compromised operating system or physical access to an unlocked machine.
- Fingerprinting resistance (not yet a goal of v0.1; see the roadmap).
- Self-XSS and social-engineering scenarios that require the user to paste code into DevTools.
