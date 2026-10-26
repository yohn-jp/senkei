# Production art inspection

F01 Bannerhold and R01 Tempest are the initial golden **candidates**. Captures do not approve artistic quality or promote a model automatically.

Run from the repository root after the coordinator supplies the real WASM and builds the app:

```sh
SENKEI_CHROMIUM_EXECUTABLE=/usr/bin/chromium npx playwright test --config tools/art/playwright.config.ts
node tools/art/gallery.mjs
```

Results are in `test-results/art-production/captures/`: PNGs, metadata with source revision, dirty state, browser/version, camera and rig samples, SHA-256 image hashes, runtime errors, and an HTML gallery. Failure writes partial evidence and its exact reason. Actual Hero Detail is captured through UI, including front/quarter/side/rear, reduced-motion move/attack samples, closest supported zoom and mobile. Battlefield requires a real local compile, WASM simulation and authorized replay. This is not a canonical scenario or all action-state proof. Reduced motion gives repeatable poses; live phase-by-phase animation quality remains unverified. The app has no public neutral-clay or LOD override, so these are explicitly unverified. Camera zoom is not asserted to activate a LOD. Pixel values can differ between GPU/browser versions; hashes identify artifacts, not a cross-platform golden comparison.

When WASM is unavailable, build and inspect the isolated lab:

```sh
npx vite build --config tools/art/vite.config.ts
npx vite preview --config tools/art/vite.config.ts --host 127.0.0.1 --port 4187
```

This imports the actual production `createHeroModelPreview`, which uses the same `buildBattlefieldHero` as the battlefield. It does not prove app startup, battlefield integration, LODs or live combat animation. Inspect the actual browser PNGs before recording PASS/FAIL for silhouette, anatomy, hair, garments, materials, side/rear, startup, interactivity and responsiveness. Record untested categories as UNVERIFIED. Software SwiftShader timings are not hardware performance measurements.

Both harnesses capture **idle, move, attack, hit and death**; action labels use `default` because reset view is the production camera, not an exact 45° angle. Front/quarter/side/rear idle captures use an explicit orbit. Closest zoom is a supported-camera limit sample, not a face-only view or LOD claim.

To preserve compact evidence rather than every full-resolution capture:

```sh
SENKEI_CHROMIUM_EXECUTABLE=/usr/bin/chromium SENKEI_ART_EVIDENCE=docs/evidence/art-production/app node tools/art/contact-sheet.mjs
# For the isolated lab, also set SENKEI_ART_OUTPUT=test-results/art-production/lab.
```

The contact sheet copies the original manifest, including full PNG hashes. Original PNGs stay in ignored `test-results/`; contact sheets are labeled reductions and cannot establish face-detail acceptance. Keep the written review next to the sheets, with exact observed defects and unverified areas. Re-run after model or motion changes.
