# Canonical Battlefield integration

Authority: `docs/BATTLEFIELD.md`. Baseline: `710a3be`.

## Gap analysis

Existing: undirected integer graph navigation, lane minion lifecycle, current-vision projection, typed data-driven Jinrei capabilities, Squad lifecycle, simultaneous combat damage, real native/WASM dispatch, authorized replay adapter and browser UI.

Missing: canonical 35-node / 42-edge topology, stable edge IDs and static allegiance, tracks and local reservations, fixed bridge sites and persistent ford state, MID capture, domain-scoped range, movement/attack exclusion, typed adaptation skills, facility observation and replay/renderer state.

Conflicts: old map has 17 nodes / 24 edges / 3 camps; navigation spends surplus movement across nodes; range uses drawing coordinates; combat samples after movement. Existing rendering evidence covers the preceding map only.

## Shared implementation contract

- `MapNode.allegiance`: static `A`, `B`, `N`. `MapEdge.id`, `bridge_site` (`TOP`, `MID`, `BOT`, empty), `ford` are digest-covered data. Edge direction is `from` to `to`.
- Entity logical position remains `node` + `edge_to` + integer `edge_progress` measured from `node`; empty `edge_to` means Node. Never cross more than one endpoint per tick. `track` is `LEFT`/`CENTER`/`RIGHT` (empty on nodes/jungle); `track_goal`, `cross_remaining`, `ford_remaining`, `moved_tick`, `action_lock_until` describe finite movement state. Tick markers use tick+1, so missing zero never marks movement at tick 0.
- Facilities are entities: `bridge` at a bank, with `site`, `bridge_state` (`normal`, `expanded`, `destroyed`), `hp`, `build_remaining`, `build_kind`; `observation` at N.MID.OBS with `capture_progress` and owner. The MID bridge entity controls both connector edges; occupancy remains per edge.
- One frozen pre-movement snapshot drives legality, basic attacks, visibility and ford damage. Navigation marks selected movement with `moved_tick=tick+1`, including waiting/crossing. Combat reads positions from that snapshot and writes effects to the post-movement state. Ordinary attacks are excluded for selected movers; retreat takes precedence over pursuit/auto attack.
- Navigation owns local reservations and movement skill composition. Combat provides `can_basic_attack(source_id, source, target_id, target, snapshot, rules, tick)` for shared stop/attack arbitration and `resolve_from_snapshot(world, snapshot, rules, accepted, tick)` for integration.
- Typed new SkillEffect variants: `TerrainAdaptation`, `JungleSpecialist`, `SoloMobility`. Parameter keys: `generic_squad_terrain_adapt_milli`, `specialist_jungle_adapt_milli`, `solo_high_mobility_milli`. Lowest individually corrected Squad member speed; generic adaptation applies to all members; specialist only to owner; SoloMobility only to one-member cohorts.
- New capabilities: `select_track(actor, track enum LEFT/RIGHT)`, `bridge_work(actor, bridge entity, operation enum expand/rebuild/destroy)`. Bridge work consumes energy and time, only adjacent fixed sites. Fields and entities are exposed through the existing current-visibility projection; absent information remains Unknown.
- Replay renderer receives only authorized PresentationReplay. Static topology comes from package; dynamic bridge/facility/movement states must be projected, never inferred.

## Verification ledger

Pending implementation and execution. No previous fixture/browser evidence proves canonical conformance. Final report must enumerate all 14 conformance clauses, native/WASM identity, desktop/mobile screenshots, CI and outstanding hardware/art approval separately.
