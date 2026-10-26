# Battlefield T000 visual review — 98ee865

## Scope and provenance

Independent visual review by the terrain/facility leaf. I inspected the reduced contact sheet and both full-resolution production screenshots. The review covers only what is visible in the owner-view opening frame at T000.

- Source revision: `98ee8653110da447270c79ae524503eed91ba1fa` (manifest reports a clean source worktree)
- Manifest: `test-results/art-production/captures/head-98ee865/manifest.json`
- Manifest SHA-256: `2fcdae8d2b015f28c9696faea9efa2c70109778f34c18243f739b4fb653756ac`
- Contact sheet: `docs/evidence/art-production/app-recheck-98ee865/battlefield-contact.jpg` (SHA-256 `f887d940120cf39f9c3eafc516eda490ccfc20cc63f41b6977074df1db566ad8`)
- Tactical image: `battlefield-default-t000.png` (SHA-256 `1520585380f8adc1d27a477b3bbbd7dc8f37d5cf2876433785f147f501be5912`)
- Cinematic image: `battlefield-cinematic-t000.png` (SHA-256 `5cd45c75f2276765bc7423a9878bfcf60e70a5e450a7f8c7f6985bf92ec329b2`)
- Capture route: actual app production capture at `http://127.0.0.1:4186/`, compiled Jinrei/Enbu/WASM and authorized Replay; Chromium `156.0.8078.47`, SwiftShader software GPU; viewport `1440x1000`, device scale `1`, reduced motion; Three.js r180; Tick 0; Tactical camera mode; fog `authorized-graph-samples`; Pixel 3D was enabled in the visible control bar.
- WASM SHA-256: `ae2f786e671bc99b34dea4e97120179380c7bac6aadc1e9068b071f1e1454c2a`.

The manifest reports no browser console errors, HTTP errors, or capture failure. These images establish successful rendering only. They do not establish general visual acceptance or performance on a physical GPU.

## Visible findings

- **Local terrain: PARTIAL.** The view shows a broad, subdued green surface with mottled faceting and a steep, visibly layered map-edge cliff. The terrain color and pixel treatment fit the tactical low-poly scene, but the central height changes are too subtle in this camera to read as continuous sculpted terrain. This is a local base view, not the required geographic overview.
- **Water and riverbank: NOT_CHECKED.** Blue water is visible at the map edges, but the opening camera does not show enough of the central river, river bed, banks, or ford mouths to judge the required crossing geography. The edge water cannot serve as evidence for river acceptance.
- **Fortress: PARTIAL.** The crenelated perimeter, corner towers, gate, and raised rear keep are recognizable as a base facility and separate from the lane towers. The centered `AZURE FORTRESS / Visible fortress` label covers the courtyard and much of the keep, so the image does not show the full silhouette unobstructed. The label also occupies the scene's focal point.
- **Lane and nearby towers: PARTIAL.** One broad brown route and two distinct stone towers are visible. A lighter center track and darker flanking bands can be made out near the fortress, but this single local segment cannot establish three-lane separation or reliable LEFT/CENTER/RIGHT reading in motion. The rest of the lane network is visible only in the minimap.
- **Other geography and states: NOT_CHECKED.** The second jungle, four camp clearings, full three-lane topology, MID observatory, combat, traversals, bridge normal/expanded/destroyed states, damage stages, and Hero LOD behavior are outside these T000 frames and remain unverified.

## Acceptance result

This T000 view is useful as a local fortress/nearby-lane checkpoint. It does not pass the Battlefield Visual acceptance scenario. The most concrete visible defect is the focal fortress label obscuring the architecture; the terrain, river, and three-lane hard gates require an overview and the prescribed state captures before they can be judged.
