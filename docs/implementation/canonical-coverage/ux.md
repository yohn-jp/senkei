# UX contract matrix — main 1a86f41

Authority order: docs/README → PLAYER-JOURNEY → PRE-BATTLE-FLOWS/SCREENS → merged PR22 UX-INTERACTION-CONTRACTS. TACTICAL-LOOP, HERO-ATELIER, JINREI-EDITOR, UI-DESIGN own their named areas. implementation/UX-FLOW-GAP-REVIEW is historical evidence only. Status is code inspection, never browser acceptance. All visual/touch/IME acceptance remains unverified.

| Contract ID | Authority | Owner | Existing | Status | Dependency | Verification |
|---|---|---|---|---|---|---|
| S00 | Journey §4; Screens §3 | App/Core bootstrap | Core/catalog load and error paths | Partial; actual failure UI unverified | WASM/catalog | Core failure/retry retaining data |
| S01 | Journey §3; Screens §3 | JourneyScreens | Quick/custom/campaign/resume; Quick retains draft | Code present | Core/catalog | UX-ENTRY-01/02 browser |
| S02 | C01/C02 | JourneyScreens/NextWorkspace | Scenario list, package info | I01 confirmed: review overwrites campaign mode | navigation vs match mode | UX-C01 desktop/mobile |
| S03 | Journey §3 | JourneyScreens | Preset summary/edit links | Code present; actual operation unverified | same draft | Quick current/preset explicit replacement |
| S04 | C03; Hero Atelier §3 | HeroAtelier | Collection/filter/immediate adoption | Candidate read-only path missing at baseline | independent candidate identity | UX-C03 |
| S05 | C03; Hero Atelier §3 | HeroAtelier/preview | Detail of selected slot | Candidate browsing gap; GPU fallback unverified | S04 | UX-C03/GPU |
| S06 | Screens §3; Hero Atelier §3 | HeroAtelier | Branch validation/planned skills | Code present; browser unverified | catalog | UX-SKILL-01 |
| S07 | Screens §3; Hero Atelier §3 | HeroAtelier/NextWorkspace | Seven partitions/shared nodes | Code present; browser unverified | core validation | UX-SQUAD-01 |
| S08 | C04/C07; Jinrei Editor | JinreiWorkbench/NextWorkspace | Source/no-code/compiler/catalog | Trace origin and real source link absent | producer source mapping | UX-JINREI-01/C07 |
| S09 | Jinrei Editor §4–6 | JinreiWorkbench | Coverage/status surfaces | Not Proven must stay distinct; browser unverified | supported domain/behavior | Not Checked/Unknown cases |
| S10 | C04; Journey §4 | NextWorkspace/JourneyScreens | Real preflight + general edit links | Target-specific repair missing | typed producer diagnostics | UX-C04 |
| S11 | C05 | NextWorkspace/JourneyScreens | Frozen snapshot/running/rejection | Code present; stale response/browser unverified | Worker/Core | UX-C05 |
| S12 | C06/C15 | renderer/replay/NextWorkspace | Actual replay + cursor | Analysis selection context absent | S13 context handoff | UX-C06/C15 |
| S13 | C06–08; Tactical Loop U01 | BattleAnalysis | Results/timeline/diagnostics/rerun | I04/05/06 confirmed by current interfaces, 60-row slice, generic editor | context + source metadata | UX-C06/07/08 |
| S14 | C09/C10 | NextLibrary/NextWorkspace | Saved/recovery/2 experiments/export/import | I03 confirmed: scenario omitted dirty; retention ordinary text incomplete | canonical saved identity | UX-C09/10/13 |
| S15 | C14 | NextLibrary/App | Raw preservation/export/mismatch/retry | Available vs unavailable recovery must be explicit; browser unverified | Core/storage | UX-C14 |
| UX-C01 | C01/C02 | JourneyScreens/NextWorkspace | Ready→conditions uses review | Confirmed gap I01 | Independent return destination | Campaign Ready inspect/back unchanged snapshot |
| UX-C02 | C02 | campaign/core | Same-squad nodes inconsistent final NPC | Confirmed historical I02, separate baseline worker ownership | Real core validation | Every bundled NPC preflight |
| UX-C03 | C03 | HeroAtelier | Candidate click adopts | Confirmed missing read-only candidate path | Candidate vs slot identity | Detail/back preserves draft then explicit adopt |
| UX-C04 | C04 | JourneyScreens/NextWorkspace | Failure message/general edit links | Gap: no target-specific route | Typed failures, actual source positions | Both armies/hero/skill/node/source cases |
| UX-C05 | C05 | NextWorkspace/Worker | Inflight guards/run snapshot | Partial code evidence; operation unverified | Worker lifecycle | Double start/late response/retry |
| UX-C06 | C06 | BattleAnalysis/replay | Analysis filter independent; slice(0,60) | Confirmed I04/I05 | Selection context/pagination | Late tick + >60 diagnostics |
| UX-C07 | C07 | BattleAnalysis/JinreiWorkbench | Generic editor callback | Confirmed I06 | Actual compiler mapping, program digest | Trace/source/return or unavailable reason |
| UX-C08 | C08 | BattleAnalysis/NextWorkspace | Exact snapshot and modified comparisons | Three-way semantic classification incomplete | Result-affecting identities | Exact/self-only/opponent-changed |
| UX-C09 | C09 | NextWorkspace/NextLibrary | Saved full scenario; comparison omits it | Confirmed I03 | Canonical save target + overwrite confirmation | Save A/change B/cancel restore |
| UX-C10 | C10 | NextLibrary | Latest/previous/import/export | Ordinary retention explanation incomplete | Existing 2-record store | Three runs + bad import preserves |
| UX-C11 | C11 | NextWorkspace/JourneyScreens | Unlocked IDs/latest feedback | Completed history/final completion distinct state absent | Persisted completion model | Victory/final/draw |
| UX-C12 | C12 | navigation/HeroAtelier/library | Some internal back/focus handling | Partial; unconditional Home returns do not model all origins | Origin state and focus | Each detour/keyboard/rotation |
| UX-C13 | C09/C10 | storage/NextWorkspace | Error state and raw export | Browser failure injection unverified | Storage errors | Quota/refusal/retry/export |
| UX-C14 | C02/C14 | App/NextLibrary | Core mismatch/recovery surfaces | Browser unverified, distinguish causes | Core boot and raw data | Failure/reload/export retaining draft |
| UX-C15 | C15 | renderer/replay | Renderer failure/retry boundary | Browser unverified | GPU failure injection | Result/replay/tick unchanged |
| UX-C16 | C12/UI Design | all screens | Separate responsive surfaces | Unverified; no screenshots collected in audit | Running app/browser | 1440/1920 and 320/390/430 actual actions |

## Fixed Wave 1

1. Journey owner: NextWorkspace.tsx, JourneyScreens.tsx, new focused test files only. Fix I01 by keeping match mode independent of conditions return navigation, so Ready inspection preserves launch key. Fix I03 by including campaign scenario in saved-target equality; retain same-content no-prompt and changed-content confirmation. No snapshot/gameplay changes.
2. Hero owner: HeroAtelier.tsx and focused new/existing HeroAtelier unit tests only. Candidate browsing identity independent of target slot and explicit adoption. Does not require changing NextWorkspace or JourneyScreens.
3. Fixed baseline owner: next-workspace.css only (mobile sheet sticky controls). NPC legality is a next-wave candidate, outside fixed Wave 1.

Remaining target-specific repair, replay/analysis context, trace pagination/source correspondence, three-way comparison, campaign completion history and broad return-context modeling require separate bounded waves; no speculative wire-field semantics or gameplay definitions are authorized by this audit.

## Wave 1 journey evidence (separate worktree)

`/workspace/wt-journey` fixes only I01/I03. New browser tests reproduce both failures before edits, then pass 4/4 in Chromium at 390/1440. C01 now preserves prepared Ready through primary return and Back. I03 marks a saved Campaign→Starter condition change dirty while retaining saved bytes. Existing Campaign picker tests pass 4/4 at 320/390/430/1440. Build/typecheck and Vitest 174/174 pass. Screenshots: `/workspace/scratch/journey-evidence`. This does not complete UX-C09 restore overwrite review/cancel, all C12 origins, physical-device UX-C16, or any other gap in the baseline matrix.
