# Controlled battlefield observation scenarios

These captures use two locally compiled tactic snapshots to make representative events occur without changing the ruleset. The browser harness replaces only the snapshot in the workbench's real `simulate` worker request. The Core Worker invokes the real WASM module, and the renderer receives the resulting PresentationReplay. These are labeled controlled verification runs, not ordinary UI-created matches.

The c9 baseline and da1 captures use the same snapshot, compiled Jinrei source, WASM SHA `c113ae5d410ee796e375e218a30561dd91af8650c312abbe872ab1c23ea5bb9c`, and ruleset digest `19c7b44ec5649f739bb9727bc220f70e030045651190c1d774b5392f319e4a75`. The harness compares canonical input and replay JSON before it saves a second copy. The native/WASM parity record is in [native-wasm-parity.json](native-wasm-parity.json); it checks structural equality for `result`, public `replay`, and `owner_replay`.

## Cue scenario

The c9 capture is in [controlled-cue-c9fe67c0](controlled-cue-c9fe67c0/), the da1 desktop and mobile capture is in [controlled-cue-da1c53ed-desktop-mobile](controlled-cue-da1c53ed-desktop-mobile/), and both use the canonical replay/input bundle in [controlled-cue-bundle](controlled-cue-bundle/). Their [comparison](comparison-controlled-cue-c9-to-da1.json) confirms exact match ID, input hash, owner/public presentation digests, final state digest, semantic ticks, and viewport set. Pixels differ because da1 changes the renderer and UI.

Observed ticks in both runs:

- Clash: T6.
- Owner-visible Hero death: T74.
- Owner-only same-slot dead-to-alive respawn proof: T94. Slot IDs and private owner fields are not presented as public timeline events.
- Tower destruction: T96.
- Neutral monster respawn: T103; this is not a Hero respawn.
- Base destruction and match end: T228.
- Active Hero skill: not present in this scenario.

The actual owner replay identifies the death/respawn transition: slot-03's `visible-9` is dead at T74 and the same authorized slot returns alive as `visible-93` at T94. This local-only proof is recorded in each capture's metadata. The public replay remains the renderer input.

## Farm and active-skill scenario

The da1 capture is in [controlled-farm-da1c53ed](controlled-farm-da1c53ed/), with its canonical source/input/replay bundle in [controlled-farm-bundle](controlled-farm-bundle/). It reaches an active Hero skill event at T211 and a time-limit draw at T240. `next.skill_acquired` events earlier in the match are not counted as active-skill use. The cue at T211 is a localized ring around the casting Hero. The c9 counterpart is pending in the current verification run.

## Privacy and reproducibility

Each bundle stores the actual worker input, owner-only replay, public presentation replay, and compiled Jinrei source. The JSON replay/input artifacts are deterministic gzip files; metadata hashes refer to their canonical uncompressed JSON. Owner replay and owner-state respawn evidence are explicitly labeled `local-owner-only`; public presentation replay is labeled `public-presentation`.
