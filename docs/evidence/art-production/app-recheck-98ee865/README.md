# Corrected Hero integration checkpoint — 98ee865

This run verifies that the `0654af6` F01/R01 generator changes reach the real Senkei application and can render through a WASM-backed local battle. It is a partial integration checkpoint; it does not approve all required art or battlefield states.

## Build and browser result

- Source HEAD / capture source: `98ee8653110da447270c79ae524503eed91ba1fa`, clean at capture time.
- `npm ci --no-audit --no-fund` and `npm run build` passed. The build ran all project TypeScript checks and the production Vite build.
- The copied real WASM SHA-256 was `ae2f786e671bc99b34dea4e97120179380c7bac6aadc1e9068b071f1e1454c2a`. `crates/`, `Cargo.toml`, `Cargo.lock`, and `scripts/wasm/build.sh` matched the Art checkpoint used to capture it.
- `SENKEI_CHROMIUM_EXECUTABLE=/nix/store/r0f9i35n3r7rng8162xih4c1dag0s1vw-chromium-156.0.8078.47/bin/chromium SENKEI_ART_OUTPUT=test-results/art-production/captures/head-98ee865 npx playwright test --config tools/art/playwright.config.ts` passed: one test, about 1.1 minutes.
- Chromium `156.0.8078.47` used SwiftShader at 1440×1000. The run opened F01/R01 Hero Detail, captured front/quarter/side/rear, available pose controls, closest zoom and 390×844 layouts, then compiled Jinrei, completed Ready preflight, started the real local battle, and captured the T000 battlefield in Tactical and Cinematic presentation.
- The manifest records zero JavaScript errors, console errors, and failed HTTP responses. The prior implicit favicon 404 is resolved.

## Evidence and remaining limits

[`manifest.json`](manifest.json) stores the exact source SHA, WASM SHA, browser, viewport, model attributes, per-image SHA-256, and error counts. Reduced contact sheets aid navigation; full-size images and their hashes are in the manifest. Original PNGs remain in the ignored Art worktree under `test-results/art-production/captures/head-98ee865/`.

The actual application now loads the corrected F01 chest/sword and R01 cloth model. The app's closest-zoom views crop the top of the F01 crest and R01 hood/staff; the `0654af6` isolated-lab medium-close captures provide the complementary full-head views. The battle capture shows T000 only. Combat, traversal, bridge changes, destruction, the terminal state, fog and Replay authorization remain unverified.

This run has no LOD override, neutral-clay control, Pixel/Smooth comparison, physical GPU or device-touch evidence. Chromium uses SwiftShader. Treat these as `NOT_CHECKED` and keep the separate [independent lab review](../recheck-0654af6/independent-visual-review.md) in its stated scope.
