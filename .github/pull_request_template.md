## Summary

<!-- What does this change and why? Link the issue it addresses: "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Performance
- [ ] Refactor / cleanup
- [ ] Docs / tooling

## How was this tested?

<!-- Steps you ran, platforms you tried (Windows / macOS / Linux). -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes and `npm run dev` launches
- [ ] No new runtime dependencies (or the reason is explained above)
- [ ] IPC changes validate the sender and keep `contextIsolation` / `sandbox` intact
- [ ] Space isolation is preserved (no state shared across session partitions)
- [ ] `CHANGELOG.md` updated under **Unreleased** for user-facing changes
- [ ] Screenshots / recordings attached for UI changes
- [ ] No AI attribution lines (`Co-Authored-By: Claude`, "Generated with …") in commits or this description
