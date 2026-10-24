# PR #3 Battlefield redesign Wave

Authority: [Issue #5](https://github.com/yohn-jp/senkei/issues/5) and [blocking request](https://github.com/yohn-jp/senkei/pull/3#issuecomment-6385227700). Baseline: `c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb`. This report covers Battlefield only; it does not accept the entire Goal or reopen Atelier, balance, or frozen PR #4.

## Cause and change

The real-map renderer reused the sample-scene terrain and whole-fixture camera assumptions. A bounded rectangular ground mesh, road ribbons, isolated props, a solid base enclosing spawned units, and an undersized page region made the authored World read as a display model. Enlarging the ground and adding camp labels retained that composition. The replay topology was not the reason to keep the display surface.

Real matches now enter a dedicated `world-presentation.ts` / `battlefield-terrain.ts` path when authored routes are present. Continuous low-poly ground, off-route relief and groves surround exact authored lane and jungle edge polylines; irregular camp glades replace circular display rings. These meshes do not define movement, collision, vision, or tactical effects. Legacy G1 fixtures retain their original rendering path.

The existing actual Senritsu → Enbu WASM Worker → authorized PresentationReplay → contract adapter → Replay Player → Renderer path remains the source of state. Bases have open courtyards, entity feet use their actual terrain height, and labels distinguish sides and selected identity without moving co-located units. Cues use confirmed replay ticks. Hidden enemy facilities or units are not reconstructed from later events.

Desktop gives the battlefield the main workspace. Mobile has explicit Battle / Overview / Follow / Timeline / Details console states and reserved playback controls, including 320px support. Camera intent, Tick, target selection and draft survive console transitions. Own-Squad tracking requires an authorized owner replay and unambiguous current visible members; public replay does not infer private Squad membership.

## Fixed ownership and integration

| Owner | Delivered scope | Integrated source commits |
| --- | --- | --- |
| Luna A | Continuous authored-world terrain, road bands, off-route relief, groves and camp glades | `7d7f03a`, `9d11a5c` |
| Luna B | Strategic/local cameras, tracking coordinates, open facilities, unit identity and replay cues | `f8f3d11`, `0ccc3e0`, `8a63fb2`, `3f794a5`, `7437088`, `bec42d4`, `71b5d6f`, `8ce90f6` |
| Luna C | Scene-first desktop and independent mobile observation console | `1a846ad`, `eb453fc`, `0e4f2fe` |
| Luna D | Real-WASM fixed-Tick capture, canonical replay comparison, controlled event verification and independent visual assessment | `15615d8`, `6ce0723`; final evidence commits recorded in Git |
| Sol | Module boundaries, public interfaces, page geometry, camera persistence, mobile selected labels, provenance checks, integration and CI | PR branch history |

Each Luna used its assigned worktree/branch. The writable boundaries are in [BATTLEFIELD-WAVE-OWNERSHIP.md](BATTLEFIELD-WAVE-OWNERSHIP.md). No PR #4 assets or gameplay/balance changes are included.

## Verification and acceptance

[Evidence index](../evidence/battlefield/README.md) records the source build revision, actual WASM hash, exact input/replay/result digests, Tick, viewport, screenshots and browser recordings. The c9 baseline and redesign use the same real default match. Controlled cue/farm cases are explicitly separate test inputs executed by the canonical Enbu core, not ordinary UI-created matches or fabricated replays. Hero respawn is proven by authorized owner-state transition, not a neutral-respawn event or public private-slot correlation.

Local checks completed during integration: Rust workspace build/test (103 tests), real WASM build and initial native/WASM goldens, Next adapter parity, Replay Contract/Player unit tests (34), TypeScript typecheck and production build. The full Graphics Playwright suite passed 10/10, including legacy Follow coordinates, replay replacement, WebGL failure/retry, and 320px controls. The actual-WASM workbench browser journey passed after adapting locators to the independent mobile console; it checks editing, replay, Follow, Overview, rematch, context recovery, draft preservation and offline restore.

The final production runtime was built from `993ef563325727c2c54b7f602acbb200e9240d26`. The final production browser suite passed 10/10 (2.1 minutes), including all five required Battlefield viewports. The final default before/after comparator confirms identical input, match, owner/public replay digests, final state digest, ticks and viewport set. Final CI and independent acceptance are recorded in the evidence index and completion report. Successful tests do not establish Visual/Art acceptance. Physical mobile hardware, hardware GPU, touch/IME and final user acceptance remain NOT_CHECKED. Hero Atelier and balance acceptance are outside this Wave. PR #3 remains OPEN; Issue #5 remains OPEN; PR #4 stays frozen.
