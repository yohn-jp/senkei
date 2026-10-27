# Canonical implementation wave — 2026-10-27

Baseline: main `8ac2fd84d41bbd148198e6f0bc253028bb922324`. Authority is the current user instruction, Issue #5, then `docs/README.md` and its domain documents. This fixed A/B/C wave excludes graphics and Issue #51. Historical coverage entries are not current missing-work claims.

## Ownership and delivered boundaries

The parent Coordinator owns main integration, shared Web wiring, repository and acceptance. Terra A owns Behavior/Enbu and its isolated `behavior-integration` worktree. Terra B owns progression state helpers and its isolated `progression-domain` worktree. No concurrent writer changed `NextWorkspace.tsx`, persistence repository or shared schemas. A was allocated `diagnostics.rs` if required; no new diagnostic schema is claimed merely from that allocation.

The new Behavior `resolve_fields` API retains independent, Catalog-bound typed `BehaviorFieldId` decisions and uses authored field-writer ordering. It validates composition even for an empty field map, bounds candidates, rejects inconsistent copies of the same action, and reuses existing Unknown/default/fallback handling. It does not establish that every field winner can be committed together: an Intent may write multiple fields, so action-level commit compatibility remains a separate Enbu obligation. BH03 static completeness was reused, not rewritten. Production weights, rankings, domain scoring, Capability mapping and HOLD/WAIT policy remain unauthored.

The progression helper distinguishes unavailable, decision-required, not-fetched, denied, failed, empty, filtered-empty and ready reads. Its pure operation state machine preserves a cancelled preview, rejects resubmission after result-unknown, carries the existing request reference into inquiry and rejects mismatched responses. These helpers perform no I/O, grant no rights and establish neither ownership nor authorization. They are not wired to a progression producer or repository. See [read/recovery boundaries](progression-read-recovery.md) for exact authority and separate dependencies.

## Current C01–C16 source correspondence

Existing screens and operations are retained. This table maps acceptance to present tests; a test's existence is not a claim that it was executed in this wave.

| Contract | Current implementation / regression evidence |
| --- | --- |
| C01 | JourneyScreens / NextWorkspace; `journey-context-regression.spec.ts` |
| C02 | campaign/preflight; `next-npc-preflight.spec.ts`, `first-run-journey.spec.ts` |
| C03 | HeroAtelier; `hero-candidate-inspection.spec.ts` |
| C04 | typed repair routing; `next-npc-preflight.spec.ts`, repair-focus component harness |
| C05 | Worker request lifecycle / inflight guards; Worker unit tests, `worker-benchmark.spec.ts`, `ux-completion.spec.ts` |
| C06 | BattleAnalysis / tactical context; `diagnostic-pagination.spec.ts`, `tactical-context.spec.ts` |
| C07 | compiler source mapping / authorized lineage; `tactical-context.spec.ts`, `tactical-source-newlines.spec.ts` |
| C08 | frozen run context / comparison classification; `improved-rematch-journey.spec.ts`, `run-comparison-classification.spec.ts` |
| C09 | NextLibrary restore review / persisted draft; `restore-review.spec.ts`, `journey-context-regression.spec.ts` |
| C10 | experiment import/export and two-record retention; `experiment-import-safety.spec.ts`, `library-retention.spec.ts` |
| C11 | validated campaign completion; `campaign-progress-live.spec.ts`, `campaign-quota-retry.spec.ts` |
| C12 | explicit navigation and focus; `workspace-tab-focus.spec.ts`, `mobile-c12-draft-return.spec.ts`, `library-focus-regression.spec.ts` |
| C13 | storage failure retention; `recovery-core-quota-retry.spec.ts`, `ux-completion.spec.ts` |
| C14 | Core failure / incompatible bytes; `experiment-import-safety.spec.ts`, `legacy-recovery.spec.ts`, `ux-completion.spec.ts` |
| C15 | renderer boundary preserving result and Tick; `ux-completion.spec.ts`, `mobile-battle-view-controls.spec.ts` |
| C16 | existing viewport journeys and captures; software browser evidence is distinct from physical touch, IME and GPU acceptance |

UX-X01–X08 remain unconnected to actual progression data. The shared state helpers do not make reward, inventory, market or relationship screens available. Defined recovery distinctions are separate from the undecided producer/authority/identity and numeric policy described in the B report. No inactive entry buttons or fabricated grants were added.

## Verification ledger

Baseline Web: `npm test` passed 380/380; `npm run build` succeeded. Integrated B run: 384 passed, one existing terrain renderer test timed out at its unchanged 5-second limit while release builds were active. This is not a passing full suite and requires an unchanged rerun. Baseline Native attempt overlapped source integration and compiled new tests against an older library artifact; its missing-method compilation errors are not final-HEAD verification. Final stable-source Native/WASM/Web/browser results must be recorded below before completion.

Baseline CI [40422716205](https://github.com/yohn-jp/senkei/actions/runs/40422716205): Native, real WASM conformance, Web and browser build succeeded. The `journeys-ui` ordinary browser step succeeded; its subsequent **Graphics G1 replay suite** failed, and the aggregate browser smoke failed as a consequence. No required check was relaxed. Graphics remains outside this wave.
