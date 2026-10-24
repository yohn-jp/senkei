# Next Senritsu implementation and verification

## Authority and integration

Starting main: `15d39a693d7842e2cf845b5d2f2f3433dd825400`.
Latest main incorporated: `b258a47394224b058f317241bc945cb32d62cde2`.
Integration branch: `feat/next-senritsu-full-implementation`.

W1–W9 were frozen before dispatch. Each implementation owner used a dedicated
branch/worktree, starting from committed contract `7c1485a`. Nine Luna owners
and eleven Luna review/support agents were dispatched within the environment's
20 subagent slots. Sol retained ownership of shared wire types, package
assembly, simulation orchestration, dispatcher, replay projection and final
integration. Consumer dependencies were published as commits.

The additional main commit defines **G2 Hero Atelier** as a separate track and
explicitly distinguishes it from the parallel Senritsu implementation. Its
four dedicated presentation screens and exhibition LOD work are **not completed
by this PR**. The frozen gameplay workbench is implemented; this report does
not claim completion of that newer presentation track.

## Implemented and committed scope

| Stream | Integrated components |
| --- | --- |
| W1 | Versioned diagonal three-lane graph, six towers, two bases, jungle connections, blocked edges, stable shortest paths, terrain transitions, shared squad movement and preserved formation offsets. |
| W2 | Melee/ranged waves, lane waypoints, living team vision, current Known/Unknown observations, nonstacking friendly-minion movement bonus, visibility-aware projections, bounded corpse cleanup. |
| W3 | Exactly five Hero instances, all seven partitions, Solo–Quintet, initial formation positions, split/merge/regroup, cohesion/maturation, death departure, base Solo respawn, explicit rejoin. |
| W4 | Simultaneous automatic attacks, defense/range/cadence/ties, skills and area damage, costs/cooldowns, exact XP sharing, growth, selected-path unlocks, passives across respawn, camp lifecycle and base victory. |
| W5 | Twelve canonical role/trait profiles, stats/growth, 48 skill definitions across two paths per Hero, attribute-driven mature-squad shields/support, two minion and three monster archetypes, three camps, versioned parameters. |
| W6 | Existing Jinrei grammar/VM, typed Hero/Minion/monster/objective collections, move/pursue/retreat/activate/split/merge/regroup, deterministic goal conflicts and registered logical CU costs. |
| W7 | Procedural silhouettes, towers/bases/monsters/minions, map/camps, formations, movement/combat cues, overview/zoom/tracking, Smooth/Pixel rendering, instanced scenery and disposal. |
| W8 | Catalog filters, five slots, Squad grouping/formation preview, skill-path selection, existing editor, real local launch, synchronized 3D replay, player diagnostics/progression, revise/rematch, versioned save/restore/import/export, mobile layout. |
| W9 | Reproducible 56-case headless report, package/roster rejection, movement factorial, lifecycle/XP/maturation cases, diverse lineups, public confidentiality and native/WASM parity. |

The production path is selection → configuration → skill path → Jinrei →
Next validation → existing Enbu simulation loop → PresentationReplay → graphics
adapter/ReplayPlayer/Three.js → analysis → revision → rematch. There is no
second simulator or browser mock runtime. Jinrei production parser/VM grammar
was not redesigned. Existing initial-strategy persistence remains separate.

### Hero catalog

| Frontline | Role / trait | Backline | Role / trait |
| --- | --- | --- | --- |
| F01 Bannerhold | defense / command | R01 Tempest | damage / control, area attack |
| F02 Stoneheart | defense / sustain | R02 Farshot | damage / assault |
| F03 Breach | damage / assault | R03 Farwatch | damage / recon |
| F04 Rook | damage / skirmish | R04 Lifeline | support / sustain |
| F05 Lockstep | support / control | R05 Conductor | support / command |
| F06 Pathfinder | support / recon | R06 Aegis | defense / skirmish |

Names, detailed stats, powers and timing are provisional content. The agreed
five-Hero count and movement coefficients are preserved. XP uses 2520 integer
quanta per XP, allowing exactly equal division among up to ten eligible Heroes
for contested neutrals. See [parameter policies](NEXT-PARAMETERS.md).

### Versions and confidentiality

- `senkei.next` 1.0.0, mechanics 1.0.0, minimum Enbu 1.1.0.
- Canonical package digest: `19c7b44ec5649f739bb9727bc220f70e030045651190c1d774b5392f319e4a75`.
- Shared model/Jinrei/core replay remain 1.0.0; the graphics decoder supports
  existing 0.1 and extended 0.2.
- Four finite battle primitives are required explicitly in engine compatibility.
- Public replay is a team-visibility intersection with allowlisted fields and
  opaque visibility/respawn incarnations. Restricted attacker replay and
  attacker-only browser diagnostics are requested separately.
- The initial ruleset's seven complete-response hashes remain unchanged. Their
  request goldens changed only to advertise Enbu 1.1.0 in the context.

## Final local verification

| Check | Result |
| --- | --- |
| `cargo build --workspace --locked` | PASS |
| `cargo test --workspace --locked` | PASS, 102 Rust tests |
| Real compiled WASM build | PASS |
| Initial scenario generation `--check` | PASS |
| Seven initial native/WASM golden comparisons | PASS, complete responses and repeated-input equality |
| `bash scripts/balance/run-next.sh` | PASS, 56 cases plus public Next native/WASM comparison and three matching invalid-request rejections |
| `npm run typecheck`, production build | PASS |
| `npm test` | PASS, 26 Replay Contract/Player tests |
| `npm run contract:types` generated-file check | PASS |
| Production browser suite | PASS, 4 tests, including initial offline persistence/regression and Next diagnostics-enabled real match/rematch/offline restore |
| Next playback recording | PASS, real replay advances to tick 25, pauses without consuming paused time, then seeks to final tick |
| Graphics browser suite | PASS, 9 tests, four viewports, 320px/landscape, recovery and animated playback |
| Native Next CLI example | PASS, attacker base-destruction victory at tick 211 |
| Real Next browser example | PASS, attacker base-destruction victory at tick 227; a different input from the CLI example |

Browser checks used Nix Chromium 155 with SwiftShader. They prove actual WebGL
rendering and interaction in that environment, not hardware GPU performance.
Fresh production and source WASM artifacts had the same SHA-256. The worker
uses a content-fingerprinted WASM URL so an obsolete offline-cache entry cannot
pin the new UI to an old engine. The Next browser regression seeds an obsolete
fixed-name binary, then verifies current-engine loading and offline compilation
and simulation after saved-setup restoration.

The rendering review caught and corrected a mount race, camera reset damping,
accumulating unit debris, a HUD count that included historical corpses, and
a negative first-frame playback delta.
Current entity counts exclude destroyed entities; structure ruins remain.
Desktop and mobile images were inspected after those corrections.

## Evidence and balance observations

- [Real Next desktop](../evidence/next/desktop-battle.png),
  [real Next mobile](../evidence/next/mobile-battle.png),
  [recorded workbench/playback](../evidence/next/next-workbench.webm).
- [Full balance JSON](../evidence/next/balance.json) and
  [scenario definitions and limits](NEXT-BALANCE.md).
- [Twelve-model graphics showcase and four viewport captures](../evidence/w7/README.md).
  That fixture is explicitly synthetic and does not represent a legal match.

The eight strategic cases now run to the 600-tick ruleset cap or base
destruction. Six cases end as explicit timeouts; two swapped `2+2+1` vs `3+2`
base assaults end in victories for opposite sides at ticks 146 and 143. The
Solo-versus-Quintet and jungle-versus-lane cases remain timeouts. These fixed
opening policies provide mechanical and scenario observations, not win-rate
estimates or evidence of achieved balance. The separate CLI and browser
victories add integration evidence, not a broader balance sample.

## Unimplemented or unverified boundaries

- The newer G2 Hero Atelier dedicated Collection/Detail/Tree/Assembly screens,
  exhibition models/LOD and its visual-quality acceptance remain unimplemented
  by this bounded W1–W9 program. Existing selection/path/grouping controls are
  not represented as those dedicated screens.
- Hardware GPU FPS/thermal/memory measurements, physical mobile devices,
  physical touch/IME/safe-area behavior and cross-browser coverage are NOT_CHECKED.
- Exhaustive composition balance, adaptive tactics, and long-term behavior
  beyond the six time-limited 600-tick strategic cases are NOT_CHECKED. No
  dominance-free balance claim.
- W9 does not contain a separate observation-boundary/reveal-expiry scenario;
  current visibility, Unknown propagation and reveal expiry have W2 unit tests.
- Circular vision without terrain occlusion, integer movement rounding and the
  documented combat/lifecycle/tuning policies are explicit provisional rules.
- Initial deployment zones remain a narrow design decision; current local
  setup accepts existing nodes, defaults to the own base, and validates
  same-node Squad partitions. Balance cases state their initial nodes.
- Official online PvP, authentication, tickets, ratings, cloud infrastructure
  and hosted deployment are outside the requested scope and were not added.

CI status is reported by the consolidated PR checks. This document records
local verification; it does not substitute local results for hosted CI.
