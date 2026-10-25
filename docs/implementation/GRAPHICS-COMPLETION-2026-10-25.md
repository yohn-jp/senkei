# Graphics completion — integration and acceptance record

Coordinator: Sol. Started from `4f9a17155872da9f11bfbf198a3bf502ec957641`.
Seven workers used independent worktrees; only Sol integrated shared APIs, Replay schema/player, Enbu emission, Renderer lifecycle and UI changes into main. No PR or frozen PR #4 asset was introduced. Concurrent main design documentation (`0064aad`, `eacf10b`) was merged and applied, especially the prohibition on hidden enemy ghosts.

This is an implementation and verification record, **not a declaration that every graphics acceptance criterion has passed**. Functional, visual, interaction, performance and CI judgments are independent.

## Implemented units

| Worker | Result | Remaining limit |
| --- | --- | --- |
| A — Geography | Explicit ordered Presentation definition binds the river to exact runtime edge/node IDs and expected crossing roles. No coordinate sorting; scene.river remains the A→B/C contract. Tests cover alignment, rotation, lane separation and projection cardinality. | Current Next map is not a paired Canonical World artifact; see World identity blocker below. |
| B — Terrain | Faceted ground, mesh-applied tiled materials, UVs/mipmaps on grass/soil/stone/roads/riverbanks/rocks, woodland near/far LOD. | Art/readability requires actual viewport review; build success is insufficient. |
| C — Architecture | Replay-driven base/tower/bridge damage stages, intact/expanded/destroyed decks, construction presentation and MID observatory. Hidden facility state remains unknown. | Fresh partial-damage/construction evidence must be distinguished from unit tests and older screenshots. |
| D — Units | 12 shared Hero body/chest/weapon/stance identities, Detail and battlefield from the same generator, corrected far weapon silhouettes; distinct Minion and Monster geometry. Actual Hero contact sheet committed. | Model contact sheet alone does not establish battlefield-scale readability or final art acceptance. |
| E — Motion/effects | Confirmed basic attack, separate Skill/hit/death channels and named rig pivots; death tick retains the Hero rig; crossing, bridge-work/change and capture effects validated against exact Replay events. | A distinct retreat state is absent from authorized public presentation facts and is not guessed from movement. |
| F — Fog | Side-authorized graph node/edge samples, explored memory, hidden-only timestamped facility observations, no hidden enemy unit ghosts. Producer sanitation precedes adapter/Renderer; legacy Replays omit Fog. | No invented off-graph terrain occlusion, tower/base vision, defender private channel or full World identity. |
| G — Camera/verification | Reusable safe framing, Tactical/Overview/visible Hero/Squad Follow, screen-size LOD, render counters, durable capture metadata and real-WASM capture scenarios. | Physical GPU/touch remain NOT_CHECKED; interrupted/failed evidence is explicitly partial. |

## Verification ledger

- Baseline Vitest: 19 files, 101 tests passed.
- Integrated Vitest: 29 files, 136 tests passed before final verification-harness updates.
- TypeScript and production build passed after the model and Replay integrations.
- Full Rust workspace release tests passed after initial Fog integration. Final facility-only Fog tests passed; batched visibility equivalence and the Enbu library suite passed (80 tests).
- Native/WebAssembly campaign conformance: seven cases passed.
- Native/WebAssembly Next conformance: seven cases passed, including owner replay, canonical battlefield, repeated native determinism and matching invalid-input rejection. The long owner case took 130.3 seconds in the isolated WASM harness before visibility batching.
- Graphics G1: 12 browser tests passed locally. Remote G1 also passed at `05aad33`; later HEAD statuses are recorded below when available.
- First immutable `ea6dced` visual run failed after 63 captured images: at 390px a synthetic range-input event changed the DOM value to 1 while Replay/canvas remained at Tick 3. This is not a visual/interaction PASS. The capture helper is being changed to actual keyboard input rather than weakening the Tick assertion.
- Initial and immutable journey attempts reached the first real result and analysis screenshots at all five widths, but a later rematch exceeded 180 seconds. Renderer code inspection confirmed retained hidden scenes were still rendering; the final correction suspends GPU work while hidden, preserving the Replay cursor and camera. Rerun status is recorded below.

## Evidence and provenance

- [Twelve actual Hero meshes](../evidence/next/atelier/hero-model-contact-sheet/contact-sheet.png), with per-Hero images and metadata. Worker model source: `a54e73b`; these are actual Three.js Hero Atelier renders, not image-generation mockups.
- [Partial exact-base manifest](../evidence/battlefield/visual-acceptance/g-baseline-4f9a171/2026-10-25T11-46-04-906Z-pid3447984/manifest.json): 88 real canonical battle images. The browser was terminated before final metadata/replay bundle emission; status is PARTIAL_SIGTERM. App production code and isolated WASM source were `4f9a171`; build HEAD `8b28ac8` added only unused camera math/tests. WASM SHA256: `e04a8bac2dbedefd8e9591e4d741d3b918b87dbb17ddba52d9ec47591822cb27`.
- First-pass After source `ea6dced` used an immutable production build on an isolated preview port. Its failure is retained in the ledger; subsequent changes rotate Overview and remove the overlapping Fog legend from the field.
- Renderer counters include scene, shadow and output-pass draw calls/triangles. FPS is requestAnimationFrame cadence. CPU time measures JavaScript rendering callback work; it is not GPU completion/presentation time. Chromium SwiftShader measurements are not physical-device performance certification.

## Blockers at the graphics snapshot and uncompleted requirements

The separate G2 session is implementing World binding and dual owner channels after this graphics snapshot. The entries below describe the verified graphics source; use [G2 completion ledger](G2-COMPLETION-LEDGER.md) for subsequent integration status.

1. **World pairing implementation**: `crates/senkei-world/fixtures/initial-battlefield.json` and current `NextRules.map` have different edge IDs and river geometry. Content-addressed World binding and lossless versioned runtime projection are adopted directions, but resolver/schema/migration/identity propagation remain unimplemented. The adapter-local river definition does not claim a Canonical World digest.
2. **Logical terrain occlusion**: `DEC-TERRAIN-OCCLUSION-001` still lacks a selected shape/query/boundary contract. Fog samples only the existing authoritative graph predicate. Renderer geography never becomes a sight blocker.
3. **Facility vision sources**: existing `next_vision::visible` includes Hero, Minion and observation sources, but excludes tower/base despite configured vision stats. This graphics change preserves that authoritative behavior and does not alter match results/CU to create facility vision.
4. **Retreat presentation**: the current public observation projection has no confirmed retreat cue. A renderer-only interpretation of reverse movement would invent a tactical fact.
5. **Private perspectives**: local SimulationArtifact currently exports the authorized attacker owner replay. The pure projection supports separate sides, but no defender-private replay is added to the public channel.
6. **Final art/hardware acceptance**: physical GPU, physical Mobile touch and final user art acceptance are not established by SwiftShader screenshots, geometry uniqueness or build/test success.

## Final verification update

- Graphics production changes are complete through `6fa2f1877e5f947cf4bf434de65f43e828e3fbc1` within this session's ownership. The main checkout is also being updated by the separate G2 integration session; its evolving World/owner-replay contracts are not certified by the earlier graphics runs.
- Final visual verification is isolated at `8728a8e47fd3c6669458445c2bb250701dd41166`: production code equals `6fa2f18`; the only additional commits replace synthetic seek input with real keyboard interaction and support long native ranges. Local workspace dependencies prevent bundling another worktree's Renderer. The WASM binary was built from `6fa2f18` (SHA256 `f1889c3686ef3d62de53e206709c7f36177cdf1a27bbb13ea3a0c5bef07b7a18`).
- A prior attempt at `21aeb5c` failed before browser launch because concurrent model changes had not yet been wired through Enbu initializers. This is separate from a graphics visual failure; G2 integration subsequently repaired those initializers.
- The corrected Analysis/S13 test **passed in 4.4 minutes** against immutable `21aeb5c` app content and the above graphics WASM. It exercised Replay→Analysis→draft revision→real rematches→comparison, and asserted GPU suspension while hidden plus resumption on returning to Replay. The old 180-second rematch failure is not counted as PASS merely because the initial run succeeded.
- The immutable `ea6dced` journey group completed with 24 passed, 1 failed (the old S13 rematch) and 1 interrupted (`next-workbench`, after the scoped check was stopped during ongoing source integration). This group is not reported as an all-green suite. S13 subsequently passed separately against the corrected graphics app.
- The final five-width canonical browser scenario **passed in 17.8 minutes**, with 101 images and complete metadata. It covers 1440×900, 1920×1080, 390×844, 430×932 and 320×740; Tactical/Overview/Follow; exact Tick seeks; visible Hero selection; LEFT/CENTER/RIGHT crossing; normal/expanded/destroyed/rebuilt bridges; bridge-free ford transit; Mobile Details/Timeline return; Pixel/Smooth switching; and the real 70-Tick terminal Draw. The canonical scenario does not issue a Skill, so it is not Skill evidence.
- The retired-F01-free Graphics G1 suite passed **10/10** against the final isolated graphics app in 1.6 minutes.
- Additional real-v2 combat proof passed against the same frozen app/WASM: 3 images, no page errors, Skill with net HP loss at T468, Hero defeat at T37, and visibility loss without a confirmed death at T94. On 919 continuously visible Hero attack-source ticks, the audit found zero actual x/y/track/progress displacement. A positive edge progress is not treated as movement.
- Main-HEAD CI conclusions are owned by the ongoing G2 integration and remain separate from this frozen-source record; do not treat pending items as PASS.


## Main integration commits

| Unit | Commits |
| --- | --- |
| Geography and explicit river contract | `a62b455`, `be5d641` |
| Terrain materials and forest LOD | `b563ccf` |
| Architecture damage/state | `8278b1f`, `3eb5041` |
| Hero shape, body/chest/weapon/stance and far LOD | `99adc17`, `29a3561`, `a1b6b14`, `f924de0`, `580a8f9` |
| Confirmed motion and transition effects | `2d086e3`, `487049b`, `c2e90d2`, `c870e0f` |
| Fog producer, Replay/Player/Renderer integration and privacy | `60e1c66`, `02c4663`, `bae08a6`, `05aad33`, `cd24a31` |
| Camera, counters, screen-size LOD and hidden-scene suspension | `335bb95`, `194759c`, `6a4ecb6`, `6fa2f18` |
| Capture harness, real keyboard seek and evidence | `ea6dced`, `b1cd566`, `ce47129`, `21aeb5c`, `0822ee4`, `edbe032` |

The verification branch retains the same production content as `6fa2f18` and has only the two keyboard-test follow-ups; its source SHA intentionally differs from evolving main.


## Final canonical visual record

[Comparison and representative links](../evidence/battlefield/graphics-completion/final-8728a8e/2026-10-25T12-14-19-404Z-pid3494921/comparison.md) · [Full metadata](../evidence/battlefield/graphics-completion/final-8728a8e/2026-10-25T12-14-19-404Z-pid3494921/metadata.json).

Visual observations: the final Desktop Overview shows diagonal base placement and river, three separate lane corridors, two forest volumes and four camp clearings. Follow shows low-poly armor, ford stepping stones, cut riverbanks and normal/destroyed bridge forms. The Fog explanation no longer overlaps the roster. At 320px the main playback/view controls remain accessible, Details and Timeline return at the exact Tick, and bridge destruction is distinguishable in a close Follow view.

Visual limits: the Overview boundary remains a visibly rectangular ground edge against the background; it does not yet have a convincing continuous natural perimeter. Heroes are small in Overview, and some dense Tactical labels/clusters still obstruct immediate silhouette identification. These observations prevent an unqualified Visual/Art PASS. In addition, the partial Before run has per-image hashes and requested Tick/view but lost its complete camera metadata; strict identical-pose Before/After comparison is not fully proven. The final After poses are fully recorded. The baseline and final Tactical comparisons use the same requested view/Tick/viewport; Overview intentionally changes orientation, so those images demonstrate the camera correction rather than a controlled identical-pose material comparison.

Measured medians below are observational SwiftShader results across each viewport's captured states, including all rendered passes; they are not a physical-device benchmark or a target-FPS acceptance:

| Viewport | Images | Draw calls | Triangles | rAF FPS | Callback elapsed ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1440x900 | 25 | 1579 | 241755 | 7.3 | 20.2 |
| 1920x1080 | 20 | 1617 | 241767 | 7.6 | 18.8 |
| 390x844 | 19 | 1232 | 229684 | 15.5 | 16.9 |
| 430x932 | 18 | 1232 | 230832 | 9.9 | 23.5 |
| 320x740 | 19 | 1104 | 231543 | 13.8 | 17.7 |


## Additional real combat proof

[Metadata and event audit](../evidence/battlefield/graphics-completion/combat-event-proof-8728a8e/2026-10-25T12-41-35-921Z-pid3552341/metadata.json) · [Hero defeat](../evidence/battlefield/graphics-completion/combat-event-proof-8728a8e/2026-10-25T12-41-35-921Z-pid3552341/confirmed-hero-hit-death-t037.png) · [Skill and hit](../evidence/battlefield/graphics-completion/combat-event-proof-8728a8e/2026-10-25T12-41-35-921Z-pid3552341/confirmed-skill-and-hit-t468.png) · [Visibility loss](../evidence/battlefield/graphics-completion/combat-event-proof-8728a8e/2026-10-25T12-41-35-921Z-pid3552341/visibility-loss-is-not-death-t094.png).

The existing authored v2 input was simulated again by the current frozen browser Worker/WASM; a stored Replay was not injected as a simulation substitute. The source input, actual owner/public output and hashes are retained. At T468 an R01 Skill caused F03 HP 173→131 and the selected caster exposed `data-unit-pose=skill`; T422 was deliberately not used as hit evidence because same-Tick healing offset its damage. T37 has a target-specific R05 Hero defeat cue. At T94 the inspected F04 identity was last seen with HP 85 at T93, is absent from the authorized T94 view and has no confirmed death cue; its hidden survival is not inferred. An unrelated F06 defeat at that Tick is not attributed to F04.

The historical controller in `057247c` / `9bee4a0` pins the external preview, app revision, WASM SHA, input SHA and ruleset digest. It was opt-in and is being retired from current main under Q03; it remains available from history to reproduce this frozen-source proof. It does not claim an incompatible old input proves the new World contract. The successful behavioral run preceded only a tightening of literal identity pins; saved provenance matches those pins, and TypeScript/static checks passed afterward. A redundant rerun was stopped in preflight and is not counted as another PASS.

## Independent acceptance judgment

| Gate | Judgment for the recorded graphics snapshot | Evidence / limitation |
| --- | --- | --- |
| Functional | PASS within the graphics source | Focused/full unit suites, backward Replay fixtures, native/WASM conformance and real browser playback; later G2 main contracts require their own final run. |
| Visual / Art | PARTIAL | Five widths, 101 canonical images plus actual Hero/contact/combat proof; rectangular perimeter, dense silhouette/label readability and incomplete strict same-pose Before metadata remain. |
| Interaction | PASS for the recorded canonical paths and corrected S13; full UX not certified | Real keyboard seek, all three camera modes, selection, Pixel/Smooth, Mobile Details/Timeline and S13 repeat loop; the earlier full journey group had one interrupted workbench case. |
| Performance | MEASURED on SwiftShader; physical NOT_CHECKED | Per-state draw/triangle/cadence/callback values above. No physical GPU, touch or claimed target-FPS certification. |
| CI | Latest main NOT_CHECKED here | Remote G1 passed at `05aad33`; latest main is concurrently integrating G2 World/owner/UX changes. Its final CI result belongs to that integration, not the frozen graphics capture. |

All graphics work is therefore not declared accepted or complete. Remaining concrete items are documented rather than turned into a build-only Visual PASS.
