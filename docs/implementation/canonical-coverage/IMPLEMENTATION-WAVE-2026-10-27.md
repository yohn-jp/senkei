# Canonical implementation wave — 2026-10-27

Baseline: main `8ac2fd84d41bbd148198e6f0bc253028bb922324`. Authority is the current user instruction, Issue #5, then `docs/README.md` and its domain documents. This fixed A/B/C wave excludes graphics and Issue #51. Historical coverage entries are not current missing-work claims.

## Ownership and delivered boundaries

The parent Coordinator owns main integration, shared Web wiring, repository and acceptance. Terra A owns Behavior/Enbu and its isolated `behavior-integration` worktree. Terra B owns progression state helpers and its isolated `progression-domain` worktree. No concurrent writer changed `NextWorkspace.tsx`, persistence repository or shared schemas. A was allocated `diagnostics.rs` if required; no new diagnostic schema is claimed merely from that allocation.

The new Behavior `resolve_fields` API retains independent, Catalog-bound typed `BehaviorFieldId` decisions and uses authored field-writer ordering. It validates composition even for an empty field map, bounds candidates, rejects inconsistent copies of the same action, and reuses existing Unknown/default/fallback handling. BH03 static completeness was reused, not rewritten. Production weights, rankings, domain scoring, Capability mapping and HOLD/WAIT policy remain unauthored.

`simulate_with_behavior` now executes a bounded real Enbu tick from serializable, versioned candidate templates and profile argument substitution. Catalog compatibility, current ownership and Enbu legality are checked before ordinary arbitration and transition. Each proposal has one final accepted/rejected diagnostic status; pre-validation rejections are not duplicated. The private artifact retains immutable inputs and Catalog, supports reproduction and binds the complete input to a Behavior run digest. Its schema-2 owner diagnostics cannot be treated as an ordinary schema-1 Next experiment. Saving/restoring this separate execution also requires retaining the exact Catalog artifact.

The same operation is exposed as `simulate_behavior` through the Native dispatcher, real WASM, typed Worker messages and `WorkerCoreClient`. The Web consumer independently recomputes the complete input digest and checks owner, Match, Program, result and diagnostic schema. Public replies omit the owner channel. This is **generic RulePlan / owned Army / one field / targetless / precondition-free only**. Next and unsupported shapes fail closed. The test profile is not a production policy. It does not establish that every field winner can be committed together: an Intent may write multiple fields, so general action-level commit compatibility remains a separate obligation.

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

## Main integration and verification

Verified implementation HEAD: `146872469e6c93a1e6da4ff31a72e3b795b9073a`. Subsequent evidence/documentation changes do not alter the implementation tree.

| Delivered contract | Main commits |
| --- | --- |
| Typed field decisions, context and duplicate-action validation, fallback tests | `45bd010`, `d9b05b9`, `9dea0d9`, `a3f6fb2`, `5bd8054` |
| Real bounded Enbu binding, immutable complete identity and final candidate diagnostics | `f14ecd2`, `1fa6b96`, `f289e62`, `d70965d` |
| Native/WASM operation and authorized typed Web Worker integration | `6e0e1c5`, `7076ad0` |
| Pure progression read/inquiry states and decision boundaries | `84d0fae`, `a87863b` |
| Mandatory owner diagnostic identity and complete-response comparison optimization | `a8936d3`, `3e5bdd2`, `1468724` |

| Verification | Actual result |
| --- | --- |
| `cargo test --workspace --release --locked --no-fail-fast` | PASS on implementation HEAD in [CI 40444920859](https://github.com/yohn-jp/senkei/actions/runs/40444920859), Native job and exact command step successful |
| Native / real WASM | PASS: existing 7 scenario responses, repeated Native responses and goldens agree; new 11 Behavior requests agree in full, including results, CU, diagnostics, owner/public/denial, identity errors and repeated input. Final CI conformance job also successful |
| `npm test` | PASS: 405 tests in 66 files |
| `npm run build` / typecheck | PASS; real freshly built WASM included |
| Real production Worker/WASM browser | **5 PASS / 3 FAIL**, unchanged deadlines, one worker. PASS: Behavior owner isolation and real event, Core-down export, quota-failed completed Run export/retry, real improved rematch retaining frozen non-target inputs, Recovery storage/Core retry. FAIL: incompatible-import safety, failed replacement write and unrecognized stored schema cases; each failed at the shared valid-baseline import's 120-second comparison-ready deadline, before its specific assertion |
| Remaining CI browser groups | IN_PROGRESS at evidence snapshot; no combined CI green claim. Required checks unchanged |

The failing browser cases used an actual 45,439,592-byte exported Run, maximum 600 ticks, confirmed terminal tick 577. Isolated actual Worker/WASM reproduction completed in 116,033 ms and returned the identical MatchResult. This measurement is not a replacement PASS for the timed-out tests. Complete response equality was optimized from canonical string construction to full JSON-tree comparison, preserving every response channel and all separate authorization, digest and reproduction checks. The same large response measured 3,809 ms before and 391 ms after for comparison alone, excluding cloning; the canonical bytes used for identity hashing are unchanged. Differential/literal tests cover key order, array order/length, undefined handling, Unicode keys, unsupported data and late changes in every retained response channel. The three browser deadline failures remain after this improvement; no timeout, victory condition, test skip or required check was changed to conceal them.

Raw compressed command logs, source CI snapshot, timing measurements and SHA-256 manifest are retained in [the evidence directory](../../evidence/canonical-wave-2026-10-27/). Large synthetic exports and browser traces remain in `/workspace/scratch/final-7076-artifacts/` and `tests/browser/test-results/`; their absence from Git is not a verification claim.

Baseline CI [40422716205](https://github.com/yohn-jp/senkei/actions/runs/40422716205) had a successful ordinary `journeys-ui` browser step followed by a failing Graphics G1 suite, causing the aggregate smoke failure. This is separate from the final implementation's local non-graphics Import deadline failures. Final Graphics quality is not assessed, and Issue #51 and graphics implementation were not changed.

## Remaining defined implementation and decisions

- **DEFINED / INCOMPLETE:** actual Next six-domain integration across Army/Squad/Hero, simultaneous independent-field action commit compatibility, and stable action-to-committed-event references. The bounded generic test is not a substitute. Production Profile vocabulary, scoring, weights, ranks, Capability mapping and HOLD/WAIT defaults remain separate `DECISION_REQUIRED` inputs.
- **DEFINED / UNCONNECTED:** persistent equipment, reward entitlement/settlement, Libra ledger and relationships; their actual repository, authorized producer, frozen match-definition references and UX-X01–X08 flows are absent. Pure state helpers establish neither durable idempotency nor actual ownership/authorization.
- **DECISION_REQUIRED:** equipment ownership unit and acquisition/storage authority, ranks/multipliers/slot counts/evolution conditions and versioned effect definitions; draw rights/distribution, pools/probabilities and finalization authority; Libra transaction/issuance/settlement scope, prices/fees; relationship storage unit, update conditions/scales/formulas, pair effects and authorized episode content. See the B report for exact authority and separately scoped dependencies. No arbitrary numeric values or fake successful operations were supplied.
- **VERIFICATION BLOCKED:** the three local browser import-preparation deadlines above. Their later incompatible/write-failure/schema recovery assertions were not reached and are not PASS. Physical-device/touch/IME acceptance is also not established by software Chromium.

**Non-graphics Architecture / Product completion: NO.** Implemented, integrated and bounded verification results are saved; missing defined work, decisions and failed checks remain distinct. This fixed A/B/C wave stops here, without automatically starting a downstream wave.
