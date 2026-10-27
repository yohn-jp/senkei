# Canonical coverage — clause register and implementation evidence

Latest scoped status: [2026-10-27 fixed A/B/C implementation and verification](IMPLEMENTATION-WAVE-2026-10-27.md), implementation `1468724`. Native/real-WASM/Web checks passed; local browser checks were 5 PASS / 3 FAIL. Non-graphics Architecture/Product completion is **NO**. This fixed wave stops after saving its results; historical continuation statements below do not authorize another wave.

## Historical registers

The following dated inventories and gaps are preservation evidence, not current missing-work claims. In particular, BH03 static completeness has since been implemented and was reused, not rebuilt, in the current wave. Earlier integration evidence: [INTEGRATION-CHECKPOINT.md](INTEGRATION-CHECKPOINT.md), main `54011ea`.

Current source-clause inventory: [CLAUSE-INDEX.md](CLAUSE-INDEX.md), pinned to main `9f52dbfa44d8f08ff854116fef7850fbc91e13af`. It covers all 47 root documents with exact line citations, including the runtime integration authority omitted from the root README index. [GAPS-AND-BOUNDARIES.md](GAPS-AND-BOUNDARIES.md) separates concrete source gaps, acceptance still awaiting proof, and undefined producer decisions. The machine-readable [source inventory](source-inventory.json) records source fingerprints; it is not a final requirement count.

The focused [BH-03 proof and decision boundary](BEHAVIOR-CONFLICT-DECISION.md) supersedes the initial Catalog-validator leaf proposal: a real Catalog/Compiler/VM/resolver scratch proof establishes late rejection under caller-supplied test legality, not production Enbu behavior. The common typed authored-order validation/consumption mechanism remains defined and incomplete, with ordinary schema implementation authorized. Only unauthored production groups/rankings/game-specific mappings are DECISION_REQUIRED; no Rust/default changes or partial satisfiability checker are selected in this audit.

The four classifications are `DEFINED/MISSING`, `INCOMPLETE`, `VERIFIED`, and `UNDEFINED/DEFERRED`. **INCOMPLETE may mean acceptance verification is incomplete while implementation exists.** The implementation column states whether source was found, absent, or only identified as an inspection lead. `Verification: NOT_CHECKED` remains separate. Code/test presence alone never receives VERIFIED. References, illustrative code and historical reports are explicitly outside four-way normative counts.

Current authorization continues beyond the first Wave. The fixed-Wave tables and evidence below are historical checkpoints, not a continuing stop rule. PR22's defined UX-C and UX-X operations remain in this task even when canonical text retains proposal/future wording. Their genuinely undecided rules remain deferred. No authoritative final implemented/missing/undefined totals or goal-completion claim is made: exact source coverage is complete, while semantic deduplication, mixed-paragraph splitting and clause-specific implementation/acceptance evidence remain open.

## Historical first-Wave checkpoint

Baseline main: `1a86f41c47a974dff5e4a4d4edb8b37fbe481207`.

This is an initial contract-family inventory, not exhaustive clause-level completion or acceptance. Source-present, not checked, partial, and undefined labels in the domain tables retain their original evidence meaning; source presence never means DEFINED / VERIFIED. Final four-way classification and exact implemented/missing/undefined contract totals remain incomplete. No Goal completion is claimed. PR22 interaction requirements are in scope under the task instruction even where documents retain proposal wording. Defined progression behavior is missing independently of the genuinely undefined numeric/economic producers; absent implementation alone is not an undefined specification.

## Fixed Wave 1

| Owner | Fixed target | Exclusive source files | Dependency |
| --- | --- | --- | --- |
| Journey | UX-C01 opponent preservation; UX-C09 saved Scenario comparison only | NextWorkspace.tsx, JourneyScreens.tsx, new focused tests | existing Draft/setup |
| Hero | UX-C03 read-only candidate inspection and explicit adoption | HeroAtelier.tsx, HeroAtelier.test.ts, hero-atelier.css, new browser test | existing Catalog/Draft |
| Baseline | 320px Follow sheet sticky heading target occlusion | next-workspace.css, focused browser regression | existing renderer/Replay |
| Coordinator | coverage inventory and integration review | this directory | domain audits |

This table records the bounded first Wave. Full UX-C09 restore confirmation is a separate remaining gap. Native/TS tests, browser automation, physical devices, visual review, PR CI and integrated main each require independent evidence.

## Baseline observations

Latest main CI #221/run 40252881042 failed. Native, conformance, web and build passed remotely; mobile-320 timed out clicking the second visible cluster toggle beneath a sticky Follow sheet heading. Production browser smoke cascaded from the failed shard. Run logs were retrieved; artifact blob downloads returned Forbidden. Local baseline: `npm test` 40 files / 174 tests passed; `npm run typecheck` exited 0. These are baseline checks, not changed-branch or final main verification.

## Root document inventory

All top-level Markdown documents are listed below, including runtime integration omitted from README's index. implementation/ and evidence/ are evidence and boundary references, not independent gameplay authority. G1/UX session reports are historical evidence. Contract extraction is grouped; the listing does not claim every normative clause has an individual row yet.

| Document | Audit |
| --- | --- |
| [ARCHITECTURE.md](../../ARCHITECTURE.md) | [presentation](presentation.md) |
| [ART-DIRECTION.md](../../ART-DIRECTION.md) | [presentation](presentation.md) |
| [BALANCE.md](../../BALANCE.md) | [core](core.md) |
| [BATTLEFIELD-VISUAL.md](../../BATTLEFIELD-VISUAL.md) | [presentation](presentation.md) |
| [BATTLEFIELD.md](../../BATTLEFIELD.md) | [core](core.md) |
| [BEHAVIOR.md](../../BEHAVIOR.md) | [core](core.md) |
| [CI-BROWSER-PARALLEL.md](../../CI-BROWSER-PARALLEL.md) | Historical acceptance/session evidence; no independent game rules |
| [COMBAT.md](../../COMBAT.md) | [core](core.md) |
| [COMPONENTS.md](../../COMPONENTS.md) | [core](core.md), [presentation](presentation.md) |
| [DELIVERY.md](../../DELIVERY.md) | [progression](progression.md) |
| [DESIGN-DECISIONS.md](../../DESIGN-DECISIONS.md) | [progression](progression.md) |
| [DOMAIN-CATALOG.md](../../DOMAIN-CATALOG.md) | [core](core.md) |
| [ENBU.md](../../ENBU.md) | [core](core.md) |
| [EQUIPMENT.md](../../EQUIPMENT.md) | [progression](progression.md) |
| [EXECUTION.md](../../EXECUTION.md) | [core](core.md) |
| [FOG-OF-WAR.md](../../FOG-OF-WAR.md) | [presentation](presentation.md) |
| [G1-VERIFICATION.md](../../G1-VERIFICATION.md) | Historical acceptance/session evidence; no independent game rules |
| [GAMEPLAY.md](../../GAMEPLAY.md) | [presentation](presentation.md) |
| [GRAPHICS-DELIVERY.md](../../GRAPHICS-DELIVERY.md) | [presentation](presentation.md) |
| [GRAPHICS.md](../../GRAPHICS.md) | [presentation](presentation.md) |
| [HERO-ATELIER.md](../../HERO-ATELIER.md) | [ux](ux.md) |
| [HERO-RELATIONSHIPS.md](../../HERO-RELATIONSHIPS.md) | [progression](progression.md) |
| [JINREI-EDITOR.md](../../JINREI-EDITOR.md) | [ux](ux.md) |
| [JINREI-GRAMMAR.md](../../JINREI-GRAMMAR.md) | [core](core.md) |
| [JINREI.md](../../JINREI.md) | [core](core.md) |
| [ONLINE.md](../../ONLINE.md) | [progression](progression.md) |
| [PLAYER-JOURNEY.md](../../PLAYER-JOURNEY.md) | [ux](ux.md) |
| [PRE-BATTLE-FLOWS.md](../../PRE-BATTLE-FLOWS.md) | [ux](ux.md) |
| [PRE-BATTLE-SCREENS.md](../../PRE-BATTLE-SCREENS.md) | [ux](ux.md) |
| [PRODUCT.md](../../PRODUCT.md) | [progression](progression.md) |
| [PROGRESSION-UX.md](../../PROGRESSION-UX.md) | [progression](progression.md) |
| [QUALITY-AND-RETIREMENT.md](../../QUALITY-AND-RETIREMENT.md) | [presentation](presentation.md) |
| [README.md](../../README.md) | [core](core.md) |
| [REPLAY.md](../../REPLAY.md) | [presentation](presentation.md) |
| [REWARDS-AND-LIBRA.md](../../REWARDS-AND-LIBRA.md) | [progression](progression.md) |
| [RUNTIME-INTEGRATION-CONTRACTS.md](../../RUNTIME-INTEGRATION-CONTRACTS.md) | [core](core.md) |
| [SENRITSU.md](../../SENRITSU.md) | [core](core.md) |
| [SIMULATION.md](../../SIMULATION.md) | [core](core.md) |
| [TACTICAL-LOOP.md](../../TACTICAL-LOOP.md) | [ux](ux.md) |
| [TACTICS.md](../../TACTICS.md) | [core](core.md) |
| [UI-DESIGN.md](../../UI-DESIGN.md) | [ux](ux.md) |
| [UNITS.md](../../UNITS.md) | [core](core.md) |
| [UX-INTERACTION-CONTRACTS.md](../../UX-INTERACTION-CONTRACTS.md) | [ux](ux.md) |
| [UX-SESSION-1.md](../../UX-SESSION-1.md) | Historical acceptance/session evidence; no independent game rules |
| [UX-SESSION-2.md](../../UX-SESSION-2.md) | Historical acceptance/session evidence; no independent game rules |
| [WORLD-DEFINITION.md](../../WORLD-DEFINITION.md) | [core](core.md) |
| [WORLD.md](../../WORLD.md) | [core](core.md) |

## Remaining checkpoints

Complete clause-level extraction and four-way counts; inspect fixed-Wave diffs; run changed-branch tests and real desktop/mobile browser actions; publish implementation PRs; review actual CI; integrate only verified dependency order; rerun acceptance on resulting main. Missing evidence remains NOT_CHECKED. Physical touch/IME/GPU, final art acceptance and balance cannot be inferred from headless browser tests.

## Wave 1 implementation checkpoint

Journey PR [#24](https://github.com/yohn-jp/senkei/pull/24), commit `d0b040c`: Campaign inspection preserves match mode and returns to Ready; saved equality includes Scenario. New Chromium regressions 4/4 at 390/1440 and existing Campaign picker checks 4/4 at 320/390/430/1440 pass; Vitest 174/174 and build/typecheck pass. Independent source review found no concrete defect. Full C09 restore-confirmation acceptance remains incomplete. CI is pending; PR is not merged.

Coverage PR [#23](https://github.com/yohn-jp/senkei/pull/23) is an audit deliverable, not implementation completion. All main integration and post-main acceptance remain pending at this checkpoint.
