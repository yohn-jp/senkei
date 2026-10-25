# PresentationReplay v0.1–0.3

`replay.schema.json` (JSON Schema 2020-12) is the language independent wire authority. `npm run contract:types` generates `src/generated.ts`; CI checks regeneration. Every object rejects extra properties, including diagnostics/source/IR. IDs are opaque public presentation IDs; arbitrary text still requires a trusted allowlist producer, and validation does not confer official provenance.

Coordinates: bounded logical x-right/y-down plane; renderer maps y to world z and derives visual height from scene paths. Lane count is scene data. All fields are required. Unknown/unobserved entities are omitted or removed by `disappear`; unknown is never encoded as zero HP. Appearance keys are data identifiers with a generic renderer fallback, never URLs or code.

InitialView precedes tick 0 events. At tick T all events through T apply in the given strictly increasing lexicographic `(tick, order)` order; order may have gaps. No implicit sorting or repair. A move fixes the position at that tick. Attack is a visual cue; damage carries absolute confirmed HP. Destroy follows confirmed HP 0 and leaves a visual wreck; disappear removes visible data. IDs cannot be reused, even after disappearance. No references to inactive entities. Spawn adds a new entity. Exactly one final match-end must equal Result, with no subsequent events. Winner and reason are projected, never inferred from damage.

Decoder validates bounds, IDs, lifetime, ordering, HP transitions, and result consistency in addition to Schema. Samples have null enbuVersion and do not claim simulation. Fixtures are authored synthetic data, not Senritsu balance. Checkpoints are omitted in G1; reconstruction always starts with InitialView. DisplayState is recursively frozen. All tick states, including effects cues, are derived from replay, independent of seek history.


## Replay 0.2 and the Next adapter

Version 0.1 fixtures remain accepted. Version 0.2 adds `vitals` for confirmed
healing/max-HP growth, `skill` cues, local execution origin, attacker/defender
view labels, optional catalog identifiers and camp presentation points.
Unknown versions and 0.2 events declared as 0.1 are rejected.

`presentationToGraphics(coreReplay, rulePackage, matchResult)` projects real
Next Enbu frames without simulating gameplay. Public and restricted owner
replays remain separate. It maps only approved scalar fields, allocates opaque
incarnation identifiers, treats visibility loss as disappearance, and allocates
a new identifier after respawn. World coordinates use the exported
`NEXT_WORLD_UNITS_PER_RENDER_UNIT`; map geometry never controls combat.
Empty initial views are valid under fog. Unit debris lasts for the death cue;
destroyed structure ruins can remain for the match.

Replay 0.3 carries `header.ruleset` (ID, version, digest) and the complete
paired `header.world` reference (World/schema/compiler/profile and logic plus
presentation digests). The adapter requires exact identity equality between
the Enbu replay, RulePackage and runtime BattleMap before projecting scene or
entities. Executed local/official 0.3 replays without both references are
rejected; sample fixtures remain identity-free.

Replay 0.3 adds the versioned battlefield topology (`scene.nodes`, edge IDs,
bridge-site and ford metadata, the river line, and the lane-track offset),
logical node/edge/track positions on move events, and authorized bridge and MID
observation state. `facility-state` applies confirmed structure/capture updates
at their recorded tick. A missing or disappeared facility remains unknown; the
renderer does not fill it with a default intact bridge or neutral capture state.
The Next adapter receives the actual Enbu engine version from MatchContext.
