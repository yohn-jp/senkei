# Controlled battlefield observation scenarios

These captures use two locally compiled tactic snapshots to make representative events occur without changing the ruleset. The browser harness replaces only the snapshot in the workbench's real `simulate` worker request. The Core Worker invokes the real WASM module, and the local owner view receives the resulting owner PresentationReplay. These are labeled controlled verification runs, not ordinary UI-created matches.

The c9 baseline and da1 captures use the same snapshot, compiled Jinrei source, WASM SHA `c113ae5d410ee796e375e218a30561dd91af8650c312abbe872ab1c23ea5bb9c`, and ruleset digest `19c7b44ec5649f739bb9727bc220f70e030045651190c1d774b5392f319e4a75`. The harness compares canonical input and replay JSON before it saves a second copy. The native/WASM parity record is in [native-wasm-parity.json](native-wasm-parity.json); it checks structural equality for `result`, public `replay`, and `owner_replay`.

The comparative c9/da1 screenshot pairs below use da1 build `da1c53ed66266c65954a58a4265c049e668fedd2`. They precede the final tactical-framing and mobile-tooltip changes. Final-build controlled captures are recorded separately below.

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

The actual owner replay identifies the death/respawn transition: slot-03's `visible-9` is dead at T74 and the same authorized slot returns alive as `visible-93` at T94. This local-only proof is recorded in each capture's metadata. The local owner view uses the owner presentation replay supplied by the worker; the public replay is separately captured and privacy-labeled.

## Farm and active-skill scenario

The c9 capture is in [controlled-farm-c9fe67c0](controlled-farm-c9fe67c0/); the da1 capture is in [controlled-farm-da1c53ed](controlled-farm-da1c53ed/). Both use the canonical source/input/replay bundle in [controlled-farm-bundle](controlled-farm-bundle/). Their [comparison](comparison-controlled-farm-c9-to-da1.json) confirms exact input, match, owner/public replay digests, final state digest, event ticks, and viewport set. The scenario reaches an active Hero skill event at T211 and a time-limit draw at T240. `next.skill_acquired` events earlier in the match are not counted as active-skill use. The cue at T211 is a localized ring around the casting Hero.

## Final 2475 captures

The final-build cue screenshots are in [controlled-cue-2475d6e](controlled-cue-2475d6e/). They cover T6 Clash, T74 Hero death, T94 owner-only same-slot return proof, T96 Tower destruction, T103 neutral Monster respawn, and T228 Base destruction/end at 1440×900 and 390×844. T6, T74, and T96 semantic assertions derive the expected actor/target from the real replay, wait 500 ms while paused at the exact tick, require the matching cue to be visible, then check that no prior-tick cue remains after seeking away. The [c9-to-2475 comparison](comparison-controlled-cue-c9-to-2475d6e.json) confirms identical input, match ID, owner/public replay digests, final-state digest, exact event ticks, and viewports.

The final-build farm screenshots are in [controlled-farm-2475d6e-d](controlled-farm-2475d6e-d/) at 1440×900 and 390×844. They show the active Hero skill at T211 and the time-limit draw at T240. The skill cue states `SKILL f03_a_active · HERO · F03 Breach → MONSTER` and passes the same paused exact-tick and stale-label checks at both sizes. The separate [focused Follow capture](controlled-farm-2475d6e-d-skill-follow/1440x900/skill-follow-t211.png) follows visible Hero F03 at T211; replay position and camera target XZ `(16.8, 6.2)` match. [Monster](controlled-farm-2475d6e-d-role-follow/1440x900/monster-follow-t211.png) and [Minion](controlled-farm-2475d6e-d-role-follow/1440x900/minion-follow-t211.png) Follow captures verify each role against its exact current owner-replay target.

The [visible-cluster capture](cluster-2475d6e/) checks T50 at 1440×900 and 390×844. It asserts five distinct current Heroes against the owner replay, including current HP and integer World X/Y, plus a nearby Base facility; it does not call nearby entities co-located. Following F03 preserves T50 and the camera target equals F03's replay position.

The skill and role-follow farm captures share match ID `battlefield-skill-observation-v1`, input SHA `83262bce59a6d7556011c749b5027428a801d3a55fb3cfdc37c7e53c32a7e962`, and final-state digest `3d592d8e653345426870d073a639b0df62d0e0ef171381794ed3c01f62196730`. The T94 Hero return is verified from owner replay state only; it is not turned into a public event or renderer cue. All controlled artifacts are real Worker/WASM outputs, with owner and public replays separately identified.

## Privacy and reproducibility

Each bundle stores the actual worker input, owner-only replay, public presentation replay, and compiled Jinrei source. The JSON replay/input artifacts are deterministic gzip files; metadata hashes refer to their canonical uncompressed JSON. Owner replay and owner-state respawn evidence are explicitly labeled `local-owner-only`; public presentation replay is labeled `public-presentation`.

The final farm [c9 → 993 comparison](comparison-controlled-farm-c9-to-993ef56.json) also matches canonical input, match, owner/public replay digests, final state, ticks and viewports. The [final cue comparison](comparison-controlled-cue-c9-to-993ef56.json) verifies the same identity fields.
