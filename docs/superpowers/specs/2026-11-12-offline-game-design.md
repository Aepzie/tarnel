# Offline minigame

Add a small local jumping game to the desktop browser's existing offline error page. The game is an optional way to wait for connectivity; retry and back navigation remain available. The implementation assumption is a simple obstacle runner named **Trail hop**, using the existing React, TypeScript and SVG stack.

## Approaches

- An inline runner reuses the error page and needs no new protocol, dependencies or permissions. Selected for this implementation.
- A separate page adds navigation and packaging work without improving recovery.
- A puzzle removes timing demands but offers a different interaction; the first version keeps one simple game.

## Behavior and constraints

- Offer the game for `ERR_INTERNET_DISCONNECTED`, or recognized network failures when the browser reports offline. Never on certificate, blocked-site or dangerous-site warnings.
- Load only after **Play offline**. Start explicitly; jump with Space, Arrow Up or a button. Escape/button pauses; restarting after collision is explicit.
- Pause on document hiding or window blur; require explicit resume. No animation loop while ready, paused, finished or unmounted.
- Bundle all art, fonts and code. No requests, telemetry, sound, accounts, IPC additions or persistent scores. Best score lasts only while mounted, including in Burner Spaces.
- English copy, existing theme/Space tokens and quiet controls. Responsive scene, visible focus, readable instructions and state-only announcements. Reduced motion removes decorative movement; essential gameplay remains user-initiated.
- Reconnection must not discard a game or navigate automatically. **Try again** retries the original URL.

## Boundaries and validation

Pure logic owns motion, obstacle spacing, collision, score and transitions. A lazy renderer component owns input, animation and lifecycle. A pure eligibility function excludes security warnings. No main-process or Android changes.

Threat model: error URL parameters remain untrusted text under existing parsing; the game never evaluates them, changes navigation targets or accesses privileged APIs. In-memory state prevents cross-Space or Burner persistence.

Unit-test simulation, eligibility, long frames and invalid timing. Use the real built Electron app with an isolated hidden profile for offline navigation, controls, pausing, retry, themes, narrow layouts and no remote game resources. Run typecheck, full tests and build; capture actual screenshots.
