# Actual app integration checkpoint — 39742e6

This run records the saved #44 product shell and renderer before the F01/R01 shape correction `0654af6`. It proves that the candidates reached the real app and that the local WASM-backed compile and battlefield presentation rendered; it does not approve the model or the full battlefield journey.

## Build and browser result

- Source HEAD in the capture manifest: `39742e62374a0a4fecddba26b488233387e8f271`, clean at capture time.
- `npm ci --no-audit --no-fund` and `npm run build` passed. The build ran TypeScript checks and the production Vite build.
- The prebuilt real WASM used by this Art checkout had SHA-256 `ae2f786e671bc99b34dea4e97120179380c7bac6aadc1e9068b071f1e1454c2a`. Its Core/build inputs matched this Art checkpoint.
- `SENKEI_CHROMIUM_EXECUTABLE=/nix/store/r0f9i35n3r7rng8162xih4c1dag0s1vw-chromium-156.0.8078.47/bin/chromium SENKEI_ART_OUTPUT=test-results/art-production/captures/head-39742e6 npx playwright test --config tools/art/playwright.config.ts` passed: one test, about 1.1 minutes.
- Chromium `156.0.8078.47` used SwiftShader at 1440×1000. The run visited F01/R01 Hero Detail at desktop and 390×844, exercised the available static pose controls and camera, compiled Jinrei, completed Ready preflight, started the actual local battle, and captured T000 in Tactical and Cinematic presentation.
- The manifest records no JavaScript page errors and one generic console HTTP 404. This first runner did not record the response URL. The app shell now declares an empty data favicon and the runner records failed HTTP response URLs/statuses; a clean rerun is still required to establish zero errors.

## Evidence and limits

[`manifest.json`](manifest.json) stores the source SHA, WASM SHA, viewport, model attributes, per-image SHA-256, console errors, and explicit unavailable evidence. The reduced contact sheets help navigate the captures; original PNGs remain under the ignored `test-results/art-production/captures/head-39742e6/` directory in the Art worktree.

The battlefield images show only the local match at T000 and its presentation-mode switch. They do not establish battle progression, combat, bridge states, traversal, destruction, terminal state, fog authorization, or replay verification. The run does not expose a LOD override, neutral-clay mode, or Pixel/Smooth comparison. SwiftShader is not physical-GPU or device-performance evidence. All remaining coverage is `NOT_CHECKED`.

This checkpoint predates `0654af6` and is a baseline for the later clean model recapture and app rerun. Do not use these images to score the corrected chest or sword geometry.
