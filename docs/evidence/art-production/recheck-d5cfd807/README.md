# F01/R01 lab capture — source d5cfd807

This evidence records the latest saved #44 model source at `d5cfd807a5a00e492fd0cbb733b9300e0dc0ed5a`. The source worktree was clean when captured. No model edits were made in this leaf.

## Capture

`npx vite build --config tools/art/vite.config.ts` passed, and the built isolated lab was served on `127.0.0.1:4187`. The capture used the production `createHeroModelPreview`, which calls the same `buildBattlefieldHero` generator as the Battlefield. Chromium 156.0.8078.47 rendered with SwiftShader software GPU at a 1440×1000 viewport. The lab captured idle front, quarter, right side, rear, and 390×844 views; an additional direct orbit captured the left side. Each candidate also has idle, move, attack, hit, death, and closest supported camera samples. The script selects one deterministic pose sample per action, so this does not verify an animation cycle or death terminal timing.

`lab-manifest.json` records the build SHA, browser, viewport metadata, model attributes, and SHA-256 of every full-resolution PNG. `opposite-side-manifest.json` records the two added side-view PNG hashes. Full-resolution PNGs remain in the ignored worktree output at `test-results/art-production/lab/`. The tracked contact sheets are reduced views for navigation and do not replace inspection of the original PNGs.

`npx vitest run packages/renderer/src/battlefield-units.test.ts` passed 12 tests. These exercise identity, deterministic geometry, rig anchors, weapon grips, and all three generated LOD levels. They do not establish the visual quality of the LODs in the production Battlefield.

## Review state

- Capture/build: `PASS` for the isolated lab at the source SHA above.
- JavaScript page errors: none. The browser reported one missing `/favicon.ico` request (HTTP 404); the lab page itself returned HTTP 200.
- Visual score: `NOT_CHECKED`; independent review of the full-resolution images is pending.
- Model integration: `NOT_CHECKED`; this isolated lab is not the actual Hero Atelier or Battlefield.
- LOD appearance: `NOT_CHECKED`; the lab has no production LOD override.
- Live animation cycles and death terminal pose: `NOT_CHECKED`; captured action controls expose static deterministic samples.
- Physical GPU performance and mobile touch: `NOT_CHECKED`.

The images show the current F01 helm, face, breastplate, shield, sword, banner, and cape, and the R01 hood, staff, cloth sleeves, tunic, and long robe. This inventory is not an artistic approval. Keep both candidates unpromoted until an independent reviewer scores the agreed criteria and the missing integration, LOD, and live-motion evidence is gathered.
