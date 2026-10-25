# Canonical Battlefield integration

Authority: `docs/BATTLEFIELD.md` and, by the user's explicit scope extension, `docs/BATTLEFIELD-VISUAL.md`. Baseline: `710a3be`; the visual authority was integrated from main `6a8f1b3`.

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

A tick prepares current observations, evaluates both Jinrei programs, validates and arbitrates intents, applies legal Squad changes and goal selections, reserves bridge/Skill actions, freezes attack positions, advances movement, commits simultaneous combat, commits bridge/capture effects, updates Squad lifecycle, and projects replay. Bridge and ford legality use the frozen snapshot. A movement marker uses `tick + 1`. Nodes have no active track, and endpoint arrival discards surplus movement until another tick. Logical progress is integer WU; multiplier products use integer fixed precision and floor the per-tick step. Static edge orientation defines progress normalization and LEFT/RIGHT for both travel directions. During lateral transit the stored `track` retains the origin until completion; positive `cross_remaining` means effective CENTER occupancy for range and presentation. The renderer and minimap apply that crossing state and use static edge orientation for LEFT/RIGHT in both travel directions.

Solo/Duo/Trio/Quartet/Quintet and minion vision retain the agreed factors. Generic adaptation is shared across the cohort; specialist adaptation is individual; the slowest corrected member sets movement; SoloMobility never enters a multi-Hero cohort. Lane/Jungle have neutral received-damage and no separate terrain vision/status modifier in mechanics v2; graph-radius visibility has no terrain occlusion. Forest/wetland/rock/highland/shallow speed values are provisional content for future terrain use. Ford is the active timed overlay with its own damage factor.

Bridge work spends energy once, reserves the living cohort, starts progress after the command tick and completes after its versioned duration; the completion tick remains locked. Builder death/invalid departure cancels without refund. Site changes apply to next-tick navigation. Ongoing ford transit survives rebuild and never relocates a traveler. MID's two connectors reserve independently. Capture requires uninterrupted single-side presence; contested presence pauses progress and never changes static N allegiance.

An explicit retreat/track move excludes attacks. Normal automatic movement may hold for a legal attack; movement and attacks cannot execute together. Generated UI tactics issue a persistent destination only when an owned Hero has no goal, allowing autonomous stopping, attacks, skills and post-respawn redeployment. Reassembly requires one domain, direction and track, and cannot consume or shorten another cohort's action lock or interrupt committed transit. Direct damage/Slow skills obey Combat Domains; Reveal and support skills use independently authorized graph range.

The v2 restricted diagnostic projection aggregates exact CU cost charges by side/tick/operation after raw VM validation. This bounds diagnostics for real default battles without changing CU, Intent or Unknown semantics. Legacy diagnostic projection remains unchanged.

The versioned v2 output limit is **64,000,000 bytes**, enforced consistently by the package, Rust dispatcher, WASM decoder and Worker. The final 600-tick owner-local wire response measures **33,668,389 bytes** in [adapter evidence](../evidence/battlefield/canonical-adapters.json), including public replay, owner replay and attacker diagnostics. The former 32 MB cap rejected this legal combined response even though its public-only projection fit. A real-Enbu regression and full native/WASM comparison cover this boundary; no authorized replay fields are discarded.

## Production visual extension

The user extended this delivery to `docs/BATTLEFIELD-VISUAL.md` from main `6a8f1b3`, merged in `29c6dc0`. The original functional screenshots are explicitly historical comparison images, not final visual approval.

The revised RulePackage embeds the unchanged 35-node/42-edge graph in a 1600×1600 coordinate space with exact 180° A/B symmetry and physically separated lane corridors. Logical lengths, movement time, vision and Combat Domains continue to use graph WU; the coordinate change does not alter these decisions. Six banks remain outside the river width. Both jungle regions now contain sculpted relief, layered canopies and rock/undergrowth masses; authored paths, terminal camp clearings and the continuous riverbed follow the actual Replay geography.

`battlefield-architecture.ts` provides differentiated fortress, defense tower, bridge and river-island observatory models. Known but currently unobserved bridge sites retain neutral supports without guessing deck state. Visible construction scaffolds use only current `buildRemaining`; capture/contested flags use only the authorized facility projection and visible occupants. Deck width, ruined spans and remaining piers distinguish normal, expanded and destroyed states. Water shelves, subdued glints and actual ford stones make the crossing geography readable without adding paths.

Twelve Hero identities, Minions and Monsters use articulated, material-consistent procedural models with full/medium/far LODs. Hero Detail mounts the same `buildBattlefieldHero` generator and catalog appearance used by the battlefield, with real WebGL idle/move/attack poses, orbit, zoom and reset. Its catalog-only preview does not manufacture a battle or Replay. A followed Hero uses the detailed model; nearby authorized bodies remain visible with reduced opacity to preserve the selected silhouette. Inner-model placement can separate occupants inside a Node or along the *same* corridor/track. This is a nonsemantic display layout explicitly permitted by BATTLEFIELD §§4–5: it never changes Replay coordinates/progress, tracks, occupancy, hit/range/order, Squad effects, graph paths or the Follow camera's authorized track anchor (without cosmetic member offsets). Visibility changes do not reshuffle retained slots, and seeking backward clears obsolete layout history. Visual combat endpoints and healthbars follow the drawn bodies; only committed Replay events create attacks, damage or Skill effects.

Tactical frames the current authorized battle, Overview shows geography, and Follow shows equipment plus public terrain ahead. Dense prose cards are replaced by small accessible event glyphs; the full event text remains in Timeline/Details. Selected identity is peripheral. Mobile has independent touch-sized transport/navigation, render-mode controls and dismissible panels; selecting a target returns to the battlefield. Base/camp labels remain inside the viewport.

Visual / Interaction / final-head CI judgments are recorded separately after the complete real-browser matrix below.

## Conformance correspondence

| §13 | Implementation | Verification |
| --- | --- | --- |
| 1 | `senritsu/next_world.rs`, `next_validate.rs`, model map metadata | Exact 35 node IDs, 42 edge IDs/endpoint pairs, static attributes, lengths, sites and no Jungle bridges |
| 2 | Canonical lane/jungle/camp edge data | 3 × 1000 WU lanes, symmetry, four terminal camps, both fords, exact-edge validation rejects shortcuts |
| 3 | Versioned movement factors and weighted routes | Lane 800 vs Jungle 650/0.8 = 812.5; actual ordinary/specialist route-choice tests |
| 4 | `enbu/next_navigation.rs` | Local/reverse-direction Minion occupancy, shared Squad reservations, three-tick crossing; actual Jinrei LEFT→RIGHT crossing |
| 5 | `next_navigation.rs`, `next_battlefield.rs`, `next_support.rs` | CENTER/expanded-side passage, real node-to-normal-bridge cohort entry and uninterrupted transit, persistent ford time, rebuild continuity, snapshot damage; actual bridge work and ford battle |
| 6 | `next_support.rs`, `next_combat.rs` | Node range bypass, no cross-domain damage, bridge progress-only range, ordinary lateral range |
| 7 | Snapshot exit legality | A/B symmetric tests, neutral Monster exemption; actual contested MID exit/retreat/legal detour |
| 8 | Endpoint-limited navigation and directed reassembly | No skipped nodes, no arbitrary edge entry, no surplus step carry; exact graph validation |
| 9 | Pre-movement attack snapshot, cohort action locks | Move/attack exclusion, reciprocal lethal hits, moving targets, prepared Skills, actual pursuit/retreat/node attacks |
| 10 | Stable reservations and post-combat facility commit | Minion priority/incumbents, bridge work/death cancellation, contested capture, prior-commit bridge destruction |
| 11 | Typed movement Skill effects and Squad composition | Mixed-member specialist, shared generic adaptation, Solo-only mobility, preserved formation/ability buffs |
| 12 | `next_domain.rs`, `next_vision.rs`, existing Jinrei VM | Hidden-bridge real Enbu probe, invalid enum compilation, Unknown argument notice, no energy spend, deterministic CU; owner/public secrecy tests |
| 13 | Native/WASM dispatcher and `compare-next-adapters.mjs` | Full native-repeat/WASM response equality for public and authorized owner replay, result, trajectory, facility state and CU |
| 14 | Replay adapter/player, renderer, Battlefield console | Real WASM desktop/mobile browser suite, static topology markers, confirmed track/ford/bridge state, replay seek/Follow/Details screenshots |

## Checkpoint status — user requested commits before final acceptance

On 2026-10-25 the user requested that all current work be committed so they can consider merging. The code and work-in-progress evidence are saved as a checkpoint. **The full Battlefield acceptance goal is not complete.** This PR remains Draft; no main merge is performed.

The latest changes address visible road/track occlusion, paused movement/attack poses, MID capture/contest signals and offscreen cue hiding. Their unit/type/build checks pass, but the post-fix real-browser gallery and independent visual judgment have not run. The last gallery failed on a test assumption about stable projection IDs and was also visually NOT PASS before these fixes. Final-HEAD hosted CI is pending after the checkpoint push.

## Evidence and execution status

The latest completed browser attempt used production source `df4e50df212d8866f57bdef26b12b161193f64ac`, before the checkpoint visual fixes. It is a historical/incomplete attempt, not final acceptance. The browser compiles real Jinrei and executes Enbu through the production Worker/WASM, then renders only the authorized PresentationReplay. It exercises four distinct inputs:

1. A controlled canonical 70-tick battle verifies completed ford transit and covers lateral crossing, pursuit, retreat, MID node combat and exit blocking, TOP expansion/destruction/rebuild, MID destruction, Jungle ford and rebuilt bridge transit. TOP rebuild completes at T49; actual CENTER entry follows the minion queue at T61. The test observes entry rather than assuming an immediate T50 crossing.
2. A separate real 16-tick match captures MID at T8. The authorized owner projection shows capture progress/ownership; the public projection omits the unobserved facility and event.
3. The unmodified UI-created default match reaches **Draw at T600**, with first Hero attack at T18. The earlier T420 victory, T16 attack and 809/30 event counts in `canonical-default` belong to the historical pre-fix implementation and are not final acceptance evidence. Normal-bridge entry now preserves CENTER and forces transit, preventing a Hero from camping/attacking on the ordinary bridge. Active ford transit also keeps its completed entry timer: it cannot rearm the delay at progress zero. Unit regressions and the real Jinrei scenario verify positive progress and endpoint arrival, including a bridge rebuilt during ford transit. Same-Hero moving/attacking Follow pairs come from actual confirmed positions and attacks.
4. A controlled base-node assault starts the five canonical Heroes at the opposing base with unchanged HP/damage/rules and real persistent Jinrei. Browser WASM produced the actual base HP decrease and T327 attacker victory. The gallery stopped before its base screenshots because the test compared the destruction event to the initial projection ID; a visibility gap had assigned a new ID. The [native audit](../evidence/battlefield/base-assault-audit.json) confirms the terminal base ID/event/HP0. Post-fix browser base screenshots remain pending. This explicitly controlled initial-node setup is not represented as a natural default march or default victory. Native tests separately verify both attacking orientations, and the eight natural strategic cases observe six Draw600 results and base victories at T417/T456.

The final default replay measurements are recorded in the current gallery metadata. Observations of one fixed input are not balance or win-rate targets. The native/WASM evidence compares complete authorized outputs rather than screenshots alone.

### Visual correspondence

| Visual authority | Implementation | Acceptance evidence |
| --- | --- | --- |
| §2.1, §2.7 | `senritsu/next_world.rs`, `battlefield-terrain.ts`, `node-display-layout.ts` | 35/42 topology unchanged; five-width Overview, close lateral-crossing Follow and CENTER transit images |
| §2.2–3, §3 terrain/materials | Continuous heightfield, riverbed/banks, layered jungle/rock/undergrowth, `battlefield-water-details.ts` | Smooth/Pixel Overview and Tactical; four terminal clearings, two bridge-free fords; actual progressed F02 ford Follow after the entry timer |
| §2.4–6, §3 architecture | `battlefield-architecture.ts`, `battlefield-landmarks.ts`, `base-sites.ts` | Close Follow of normal/expanded/destroyed/rebuilt TOP and destroyed MID at all five widths; capture beacon/flag and base destruction |
| §3 Hero/Minion/Monster | `battlefield-units.ts`, `battlefield-unit-geometry.ts`, shared `renderer-hero-model-preview.ts` | Same-Hero movement/attack Follow; actual catalog preview idle/move/attack/orbit/reset checks at five widths |
| §3 committed effects | Renderer event/pose integration and authorized Replay positions | Pursuit, retreat, attack, hit, Skill, ford, capture and construction are derived from confirmed state/events |
| §4 cameras/Mobile/info | Tactical/Overview/Follow, short cues, peripheral identity, collision-aware labels and dismissible Mobile sheets | Five-width playback/seek/selection/Details/Timeline; explicit same-Tick Before/After links in gallery |
| §5 evidence contract | `visual-battlefield.spec.ts`, canonical/Atelier/Workbench browser tests | Four actual Worker/WASM inputs; SHA/Tick/viewport/camera/hash metadata; independent visual judgment below |

### Verification judgments

Post-ford core checks passed: 150 workspace tests with only the long headless case excluded, plus that normal-assertion headless test and its 56 cases in an isolated checkout of the identical core. Total: **151 Rust tests**. No diagnostic bypass is present. The unified workspace command is also required in final hosted CI.

- Native-repeat / real WASM: **7 complete response comparisons passed**, including public/owner trajectories, confirmed bridge/ford state, exact CU, invalid requests and the full 600-tick owner response. [Hashes and encoded size](../evidence/battlefield/canonical-adapters.json).
- Separate **7 legacy adapter scenarios passed**, including generated-input checks; their result hashes/CU remain unchanged.
- TypeScript: **75 tests / 14 files passed**, including Replay contracts/player, layout, terrain, architecture and unit models; typecheck and production build passed. Generated contract types match the Schema.
- The 56-case [scenario report](../evidence/battlefield/canonical-scenarios.json) uses the corrected core; its eight natural strategic outcomes remain six Draw600 results and base victories at T417/T456.

Browser status: earlier tests cover real canonical desktop/mobile replay equality, the five Hero Atelier widths, default 600-tick Workbench editing/rematch, offline restoration, Worker benchmarks and production Follow. The final `df4e50d` attempt passed the camera/field regression and canonical scenario, while the visual gallery failed at its stale base projection-ID assertion. It is not counted as an all-green suite.

| Judgment | Checkpoint result |
| --- | --- |
| Functional core | PASS: 151 Rust tests and 7 v2 + 7 legacy native/WASM comparisons |
| Visual | NOT PASS on the last captured source; latest fixes NOT_CHECKED in browser |
| Interaction | Prior desktop/mobile checks passed; latest renderer changes need regression capture |
| Final-HEAD CI | Pending after checkpoint push |

[Retained visual attempts and their exact limitations](../evidence/battlefield/visual-acceptance/README.md). No screenshot or green unit/build result is treated as final visual acceptance.

Hardware GPU rendering, physical touch/IME and final art approval are **NOT_CHECKED**. Chromium desktop/mobile viewport tests use SwiftShader; no hardware or user approval is inferred from them. Vite's existing large-chunk advisory and four Rust dead-code warnings remain.
