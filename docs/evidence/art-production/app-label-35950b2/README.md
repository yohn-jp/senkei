# Fortress label placement integration checkpoint — 35950b2

This actual-app capture checks the fix for the opening-frame fortress label covering the building. It is one T000 view and does not approve the Battlefield as a whole.

## Build and browser run

- Source HEAD / capture source: `35950b2ff1b59e822f76c4d5dee0cfa8daac95e6`, clean at capture time.
- The facility-label change under test moves base-site labels outside projected architecture bounds and includes those bounds in the later unit-label collision pass.
- `npm test -- packages/renderer/src/base-sites.test.ts`: 2 tests passed. `npm run build` (all TypeScript checks plus production Vite build): passed.
- `SENKEI_ART_PORT=4188 SENKEI_ART_OUTPUT=test-results/art-production/captures/head-35950b2-label SENKEI_CHROMIUM_EXECUTABLE=/nix/store/r0f9i35n3r7rng8162xih4c1dag0s1vw-chromium-156.0.8078.47/bin/chromium npx playwright test --config tools/art/playwright.config.ts`: 1 browser test passed in about 1.1 minutes.
- Chromium `156.0.8078.47` used SwiftShader at 1440×1000. The run opened F01/R01 Hero Detail, compiled Jinrei, completed Ready preflight, launched the local battle, and captured owner-view Battlefield T000 in Tactical and Cinematic presentation.
- WASM SHA-256: `ae2f786e671bc99b34dea4e97120179380c7bac6aadc1e9068b071f1e1454c2a`.
- Manifest SHA-256: `3666c1b01a9cb3046edbd20251032000b5c51dacf3de30a14a894c0d74e86a3f`. It records empty page, console, HTTP, and failed-request error arrays and hashes all 22 PNG captures.

## Full-resolution T000 evidence

- [Tactical image](images/battlefield-default-t000.png), SHA-256 `0e66b5a47f244b3b116bc0d4fa5c785ac4c781ab45e2c71cacf88901a3458210`.
- [Cinematic image](images/battlefield-cinematic-t000.png), SHA-256 `a455956df85af65128d14f2e26fa5cdab0486aef2eec07a3840d401d17a5252c`.

In this view, the `AZURE FORTRESS / Visible fortress` label is below the fortress footprint. The courtyard and keep are no longer covered, and the label text remains readable. This confirms the specific T000 obstruction is corrected in the actual application. It does not verify other camera angles, mobile framing, other labels, or any Battlefield topology, crossing, combat, damage, performance, or physical-GPU acceptance.
