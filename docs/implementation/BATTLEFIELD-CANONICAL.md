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

## Rules and phase decisions

The shipped identity is `senkei.next` **2.0.0**, map `senkei-battlefield-v2`, minimum Enbu **1.2.0**, graphics Replay **0.3**. The package digest covers topology, typed capabilities and every required parameter; missing parameters are rejected even after recomputing the digest.

A tick prepares current observations, evaluates both Jinrei programs, validates and arbitrates intents, applies legal Squad changes and goal selections, reserves bridge/Skill actions, freezes attack positions, advances movement, commits simultaneous combat, commits bridge/capture effects, updates Squad lifecycle, and projects replay. Bridge and ford legality use the frozen snapshot. A movement marker uses `tick + 1`. Nodes have no active track, and endpoint arrival discards surplus movement until another tick. Logical progress is integer WU; multiplier products use integer fixed precision and floor the per-tick step. Static edge orientation defines progress normalization and LEFT/RIGHT for both travel directions. Active lateral transit occupies CENTER for range and presentation.

Solo/Duo/Trio/Quartet/Quintet and minion vision retain the agreed factors. Generic adaptation is shared across the cohort; specialist adaptation is individual; the slowest corrected member sets movement; SoloMobility never enters a multi-Hero cohort. Lane/Jungle have neutral received-damage and no separate terrain vision/status modifier in mechanics v2; graph-radius visibility has no terrain occlusion. Forest/wetland/rock/highland/shallow speed values are provisional content for future terrain use. Ford is the active timed overlay with its own damage factor.

Bridge work spends energy once, reserves the living cohort, starts progress after the command tick and completes after its versioned duration; the completion tick remains locked. Builder death/invalid departure cancels without refund. Site changes apply to next-tick navigation. Ongoing ford transit survives rebuild and never relocates a traveler. MID's two connectors reserve independently. Capture requires uninterrupted single-side presence; contested presence pauses progress and never changes static N allegiance.

An explicit retreat/track move excludes attacks. Normal automatic movement may hold for a legal attack; movement and attacks cannot execute together. Generated UI tactics issue a persistent destination only when an owned Hero has no goal, allowing autonomous stopping, attacks, skills and post-respawn redeployment. Reassembly requires one domain, direction and track, and cannot consume or shorten another cohort's action lock or interrupt committed transit. Direct damage/Slow skills obey Combat Domains; Reveal and support skills use independently authorized graph range.

The v2 restricted diagnostic projection aggregates exact CU cost charges by side/tick/operation after raw VM validation. This bounds diagnostics for real default battles without changing CU, Intent or Unknown semantics. Legacy diagnostic projection remains unchanged.

## Conformance correspondence

| §13 | Implementation | Verification |
| --- | --- | --- |
| 1 | `senritsu/next_world.rs`, `next_validate.rs`, model map metadata | Exact 35 node IDs, 42 edge IDs/endpoint pairs, static attributes, lengths, sites and no Jungle bridges |
| 2 | Canonical lane/jungle/camp edge data | 3 × 1000 WU lanes, symmetry, four terminal camps, both fords, exact-edge validation rejects shortcuts |
| 3 | Versioned movement factors and weighted routes | Lane 800 vs Jungle 650/0.8 = 812.5; actual ordinary/specialist route-choice tests |
| 4 | `enbu/next_navigation.rs` | Local/reverse-direction Minion occupancy, shared Squad reservations, three-tick crossing; actual Jinrei LEFT→RIGHT crossing |
| 5 | `next_navigation.rs`, `next_battlefield.rs`, `next_support.rs` | CENTER/expanded-side passage, persistent ford time, rebuild continuity, snapshot damage; actual bridge work and ford battle |
| 6 | `next_support.rs`, `next_combat.rs` | Node range bypass, no cross-domain damage, bridge progress-only range, ordinary lateral range |
| 7 | Snapshot exit legality | A/B symmetric tests, neutral Monster exemption; actual contested MID exit/retreat/legal detour |
| 8 | Endpoint-limited navigation and directed reassembly | No skipped nodes, no arbitrary edge entry, no surplus step carry; exact graph validation |
| 9 | Pre-movement attack snapshot, cohort action locks | Move/attack exclusion, reciprocal lethal hits, moving targets, prepared Skills, actual pursuit/retreat/node attacks |
| 10 | Stable reservations and post-combat facility commit | Minion priority/incumbents, bridge work/death cancellation, contested capture, prior-commit bridge destruction |
| 11 | Typed movement Skill effects and Squad composition | Mixed-member specialist, shared generic adaptation, Solo-only mobility, preserved formation/ability buffs |
| 12 | `next_domain.rs`, `next_vision.rs`, existing Jinrei VM | Hidden-bridge real Enbu probe, invalid enum compilation, Unknown argument notice, no energy spend, deterministic CU; owner/public secrecy tests |
| 13 | Native/WASM dispatcher and `compare-next-adapters.mjs` | Full native-repeat/WASM response equality for public and authorized owner replay, result, trajectory, facility state and CU |
| 14 | Replay adapter/player, renderer, Battlefield console | Real WASM desktop/mobile browser suite, static topology markers, confirmed track/ford/bridge state, replay seek/Follow/Details screenshots |

## Evidence and execution status

The actual default UI-created battle was compiled and executed by browser WASM. It reached **attacker victory by base destruction at T420**, with **809 Hero attacks and 30 Hero skill activations**. First Hero attack: T16; first active Skill: T144. See [default metadata](../evidence/battlefield/canonical-default/metadata.json) and the desktop/mobile screenshots in that directory. This is separate from the controlled real Enbu scenario.

The controlled scenario uses actual compiled Jinrei and the canonical RulePackage, then executes again in browser WASM. It covers lane movement/lateral crossing, pursuit, retreat, MID combat/exit blocking, TOP expansion/destruction/rebuild, MID destruction, Jungle ford and rebuilt bridge traversal. The renderer receives its authorized PresentationReplay, never a mocked result or hidden world.

Final suite counts, adapter evidence, browser evidence and final-HEAD CI links are recorded below after execution. Earlier fixture-only or pre-v2 rendering evidence is historical and is not conformance evidence.

Hardware GPU rendering, physical touch/IME and final art approval are separate **NOT_CHECKED** judgments. Chromium desktop/mobile viewport tests use SwiftShader; no hardware or user approval is inferred from them.
