# Historical Next Senritsu integration baseline

This document preserves the original W1–W9 implementation handoff. Its old
map shape and leaf interfaces are historical and do not define the current
Battlefield contract. The current authority is [`BATTLEFIELD.md`](../BATTLEFIELD.md);
the canonical integration and verification record is
[`BATTLEFIELD-CANONICAL.md`](BATTLEFIELD-CANONICAL.md). The current
`senkei.next` package is version 2.0.0 and requires Enbu 1.2.0.

Single integration authority: Sol. Frozen streams W1–W9 from the implementation request; no additional streams. Producers and consumers start from this committed baseline and consume later changes only after publication by commit.

## Versions and boundaries

`RulePackage.next: Option<NextRules>` and normalized `RulePlan.next` carry versioned finite battle-system data. Omission preserves canonical initial package JSON/digest. Current `senkei.next` 2.0.0 requires Enbu 1.2.0; shared wire model and Jinrei remain 1.0.0. The original W1–W9 ownership and hook details below record the earlier integration plan. Existing simulate loop, VM, diagnostics, budgets and artifact remain the only match execution path; finite Battlefield primitives use that loop, not a separate simulator.

Authoritative data flow: preparation configuration → validated NextRules → WorldState → same-tick team observations → Jinrei VM intents → finite world transitions → PresentationReplay → graphics adapter → existing Replay Player/Renderer. Appearance keys select renderer assets; geometry never controls logic.

## Preparation and runtime scalar contract

Configuration `heroes` is a list of exactly five records: `slot_id` String, `catalog_id` String, `squad` String, `node` String, `skill_path` String. Unique slots; same squad/node implies initial partition; all five must participate. Duplicate catalog types remain an explicitly unresolved design decision; implementation may permit repeated catalog IDs rather than impose distinctness. Skill path names reference catalog preconfigured paths.

World entity types: `hero`, `minion`, `monster`, `tower`, `base`. Common integer fields: `hp`, `max_hp`, `attack`, `defense`, `speed`, `range`, `attack_interval`, `vision`, `attack_ready`, `x`, `y`, `edge_progress`. String fields: `node`, `edge_to`, `goal`, `lane`, `catalog_id`. Hero fields additionally: `slot_id`, `squad`, `skill_path` strings; `xp`, `level`, `maturity`, `formation`, `respawn_at`, `energy` integers; `skills` list of strings, `cooldowns` record of integer ready ticks. Effects may add integer `shield`, `haste_until`, `slow_until`, `reveal_until`, `empower_until`, `defense_until`. Neutral lifecycle: `camp` string, `respawn_at` integer. BTree iteration/IDs define stable ties. Coordinates and movement are integer world units. Edges are bidirectional, positive length; `blocked` forbids traversal. Node position and edge progress determine x/y. Public replay uses intersection of team visibility for enemy-sensitive state; local owner diagnostics stay separate.

Shared scalar helpers live in `enbu::next_support` (Sol). Leaf functions return `Result` where input failure is possible. No leaf edits `lib.rs`, shared model, dispatcher or another leaf's files. Leaf tests may use `#[cfg(test)]` in owned modules. Sol declares modules and calls hooks at integration.

## Owned files and hook interfaces

- W1: `senritsu/src/next_world.rs`: `pub fn battle_map() -> BattleMap`; `enbu/src/next_navigation.rs`: `pub fn advance(world: &mut WorldState, rules: &NextRules, tick: u32)`; `pub fn path(map: &BattleMap, from: &str, to: &str) -> Option<Vec<String>>`. Hero movement factor reads current friendly minion vision via W2 `minion_vision` (stable published API; initially geometry-compatible helper can be local).
- W2: `enbu/src/next_vision.rs`: `pub fn lifecycle(world: &mut WorldState, rules: &NextRules, tick: u32)`; `pub fn visible(world: &WorldState, rules: &NextRules, side: CombatantSide, entity: &EntityState) -> bool`; `pub fn minion_vision(world: &WorldState, side: CombatantSide, entity: &EntityState) -> bool`; `pub fn observation(world: &WorldState, plan: &RulePlan, side: CombatantSide, tick: u32) -> ObservationSnapshot`; `pub fn public_view(world: &WorldState, rules: &NextRules) -> WorldStateView`.
- W3: `enbu/src/next_squads.rs`: `pub fn initialize(world: &mut WorldState, snapshot: &SenkeiSnapshot, side: CombatantSide, rules: &NextRules) -> Result<(), ApiError>`; `pub fn intents(world: &mut WorldState, rules: &NextRules, accepted: &[(CombatantSide, Intent)], tick: u32)`; `pub fn lifecycle(world: &mut WorldState, rules: &NextRules, tick: u32)`. Owns Hero initialization/death departure/respawn and squad maturation. W4 marks hp/death tick; W3 runs lifecycle after combat and before next snapshot. No automatic rejoin.
- W4: `enbu/src/next_combat.rs`: `pub fn resolve(world: &mut WorldState, rules: &NextRules, accepted: &[(CombatantSide, Intent)], tick: u32) -> Vec<PresentationEvent>`; `pub fn initialize_objectives(world: &mut WorldState, rules: &NextRules)`; `pub fn outcome(world: &WorldState) -> Option<MatchOutcome>`. Owns skill/XP/effects/combat/neutral lifecycle. All hits collected before applying damage.
- W5: `senritsu/src/next_content.rs`: `pub fn content(map: BattleMap) -> NextRules`; all numbers in package parameters/catalog, provisional rationale `docs/implementation/NEXT-PARAMETERS.md`. No engine edits.
- W6: `senritsu/src/next_domain.rs`: `pub fn configure(package: &mut RulePackage)` sets schemas/capabilities/presentation/limits for next; `enbu/src/next_tactics.rs`: `pub fn apply(world: &mut WorldState, rules: &NextRules, accepted: &[(CombatantSide, Intent)], tick: u32)` for move/pursue/retreat/target intents. Capability signatures: `move(hero, node_string)`, `pursue(hero, target_entity)`, `retreat(hero)`, `activate(hero, skill_string, target_entity)`, `split(hero)`, `merge(hero, other_hero)`, `regroup(hero, other_hero)`. First arg actor, target explicit where applicable. W3 owns split/merge/regroup resolution. W4 owns activate. Typed finite collections expose permitted current observations only; unknown never carries current enemy data. Grammar untouched.
- W7: renderer internals and graphics entrypoint/fixtures only; consume graphics Replay v0.1 from Sol adapter. May add optional appearance metadata only through Sol published contract. Runtime PresentationReplay entities contain generic scalars; renderer receives public data only.
- W8: app/UI except shared contracts and renderer internals. New next workspace component can be integrated by Sol. Core dispatch adds `next_ruleset` empty payload, existing compile/new_match_context/simulate support either exact bundled ref. Sol adds `CoreClient.nextRuleset()`. Keep initial saved workspaces working.
- W9: `crates/enbu/tests/next_*.rs`, `tests/conformance/next-*`, `scripts/balance/*`, `docs/implementation/NEXT-BALANCE.md`; consume `senritsu::next_package()`, `next_engine_compatibility()` after publication. Add tests/scenarios only, report coverage and imbalance honestly.

Sol integrates tick order: minion spawn/neutral respawn → frozen observations → existing VM and CU/validation/arbitration → squad intents → tactical goals → navigation → simultaneous combat/skills/XP → squad death departure/respawn/maturation → public replay/termination. Spawn hook must occur before frozen observation, initial spawns at tick 0. Visibility derived from living units at snapshot; minion modifier sampled at movement start. Last-known history has no implicit current-Known conversion.

## Published replay extension

Graphics Replay 0.2 adds confirmed `vitals` (HP/maxHP growth or healing), `skill` cues, local execution origin, optional catalogId and camp presentation points. Decoder retains 0.1 compatibility and rejects 0.2 events in 0.1. `presentationToGraphics(coreReplay, rulePackage, matchResult)` receives only public snapshots and confirmed result; allocates per-replay opaque incarnation IDs (visibility re-entry/respawn gets a fresh ID), emits disappearance for loss of visibility, and never infers death from absence. Source core schema remains 1.0.0. World positions are scaled by 25 for graphics only. Hidden source identities never become render IDs.

Local simulation requests with diagnostics enabled may additionally receive
`owner_replay`, an attacker-perspective PresentationReplay marked with
`perspective: attacker`. This restricted local projection keeps friendly
progression/cooldown information and only currently observed enemies. It is
absent from PublicSimulationResponse. Graphics headers preserve that view;
the public intersection replay remains independently available. Empty initial
public views are valid under fog. The owner projection is never reconstructed
from unrestricted world state in the browser.
