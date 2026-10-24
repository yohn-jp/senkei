# Real Next Senritsu evidence

These captures come from `next-workbench.spec.ts` using the real production
WASM worker, current bundled ruleset, and `presentationToGraphics` adapter.
The diagnostics option is enabled. They are distinct from the synthetic
12-model fixture in [W7](../w7/README.md).

- [Desktop 1440×900](desktop-battle.png): actual base-destruction result and
  final-tick battlefield. Historical unit debris no longer accumulates.
- [Mobile 390×844](mobile-battle.png): independent narrow composition,
  current owner view, seek/camera controls and no horizontal overflow.
- [Workbench video](next-workbench.webm): selection/edit/compile, real match,
  visible playback and pause, seek, revised rematch, offline restoration, and
  an offline compile/simulate pass.
- [56-case balance report](balance.json): exact package digest, outcomes,
  termination classes, and scenario data. Eight strategic cases run to the
  600-tick cap or base destruction; six time out and two mirrored assaults
  destroy bases for opposite sides.

Chromium 155 ran with SwiftShader. Images were inspected; the tests check
actual canvas creation, visible entities, replay advancement/pause, and state
restoration. This is browser-emulation evidence, not a hardware GPU or physical
mobile performance result. Overview frames prioritize lanes and objectives;
zoom and tracking expose the individual procedural Hero silhouettes.
