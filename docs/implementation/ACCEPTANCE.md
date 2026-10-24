# Phase A–D acceptance evidence

This file records executable evidence for the local PvE delivery criteria. It
does not replace the API or product contracts. `tests/conformance/matrix.json`
contains both the twelve user ordered release checks and the supplemental
engineering matrix. `VERIFIED` means the current source has a real test for the
property; `PARTIAL` identifies coverage that still needs a dedicated oracle;
`NOT_CHECKED` means the final required execution has not run yet.

## User ordered 12 release checks

| Order | Check | Status | Evidence and remaining coverage |
| --- | --- | --- | --- |
| 1 | Jinrei grammar and text parsing | VERIFIED | Jinrei parser/formatter tests and compilation of all seven evaluated NPC sources through the real native dispatcher. |
| 2 | Unknown values | VERIFIED | Model wire and Jinrei semantics tests distinguish unknown values from known null; observation schema rejects hidden reads. |
| 3 | Simultaneous resolution and ordered logic | VERIFIED | Enbu tests verify reciprocal/simultaneous attacks and damage; Jinrei tests verify ordered short-circuit cost and declaration-order behavior. |
| 4 | Sets, vectors, matrices, and CU | VERIFIED | Jinrei semantics tests exercise finite collections, vector/matrix/record bounds, collection order invariance, comparison tariffs, and CU overrun. |
| 5 | Non-public observation rejection | VERIFIED | The conformance generator sends a legal `self.resources` control and `enemy.resources`, `enemy.strategy`, and `enemy.program` probes through the real native dispatcher. The control compiles; all three non-public paths fail Jinrei compilation with `validation_failed`. |
| 6 | Determinism | VERIFIED | Workspace tests plus seven real campaign requests run twice natively and compare the full ordered response. |
| 7 | Native/WASM parity | VERIFIED | Seven current campaign simulations compare complete envelopes between the native dispatcher and the compiled WASM ABI; compact goldens pin canonical response hashes. |
| 8 | GUI/text equivalence | VERIFIED | A structured starter AST and equivalent text compile to equal program/CU and full simulation responses; production UI journey exercises both no-code and text editing. |
| 9 | Browser local loop | VERIFIED | On root source `96504e444dbc83a3ffb24e9131dcf54f623be846`, `bash tests/browser/run-nix.sh` passed 3/3: local navigation, seven real Worker/WASM NPC benchmarks, and the full compile/battle/replay/save/reload/rematch journey. |
| 10 | No online API/auth dependency | VERIFIED | The production browser journey and seven-scenario Worker benchmark passed while asserting there were no cross-origin requests. No API or auth setup is used. |
| 11 | Offline after caching | VERIFIED | Production Chromium journey on `96504e444dbc83a3ffb24e9131dcf54f623be846` passed offline IndexedDB reload, semantic edit/compile, rematch, resave, and another reload. |
| 12 | GitHub Actions CI | VERIFIED | GitHub Actions run [40078738258](https://github.com/yohn-jp/senkei/actions/runs/40078738258) on root source `96504e444dbc83a3ffb24e9131dcf54f623be846` completed successfully: native build/tests, native/real-WASM conformance, web build, and production Chromium smoke. |

## Supplemental engineering conformance matrix

| ID | Status | Evidence and remaining coverage |
| --- | --- | --- |
| `core.determinism.repeated-input` | Verified | `cargo test --workspace --locked`; the adapter comparator runs each campaign request twice through native Enbu and compares the complete response. |
| `core.parity.native-wasm-goldens` | Verified | `scripts/wasm/build.sh` creates the real ABI module; the comparator matches seven native campaign simulations against WASM and compact canonical response hashes. |
| `jinrei.equivalence.text-and-ast` | Verified | The generator compiles the starter AST and equivalent text through the Rust dispatcher, compares AST/program/CU, then compares full simulation responses. |
| `enbu.symmetry.no-implicit-first-mover` | Verified | One-unit and three-unit swapped-tactic battles and identical-tactic controls map accepted actors to pre-tick replay states. Controls draw with equal core damage; swapped actor histories match across sides. |
| `rules.arbitration.stable-contested-actions` | Partial | Senritsu validates declared slot keys; Jinrei verifies collection-order-independent results/CU; three-unit cases verify equal-position unit selection. A same-lane multi-target battle with permuted enemy roster order remains unchecked. |
| `runtime.boundaries-and-exhaustion` | Partial | Enbu covers timeout, shared current tick, simultaneous damage, and CU reject/abort. Jinrei covers CU overrun and bounded containers. Dedicated runtime intent-count and integer-overflow boundary cases remain unchecked. |
| `validation.reject-invalid-inputs` | Partial | Senritsu covers digest, numeric schema, roster-key, and hidden-read failures; Jinrei covers malformed source, type/bounds failures, and CU overrun. A complete oversized-envelope and incompatible-snapshot matrix remains unchecked. |
| `validation.reject-unknown-capabilities-and-primitives` | Verified | Senritsu tests arbitration signature and primitive compatibility; Jinrei tests actor/target types and ownership constraints. |
| `observation.unknown-null-and-visibility` | Partial | Model tests distinguish unknown from known null; Senritsu rejects hidden-field and derived hidden reads; native dispatcher probes reject `enemy.resources`, `enemy.strategy`, and `enemy.program` while accepting `self.resources`. A dedicated Enbu runtime probe for opponent hidden-field reads remains unchecked. |
| `output.public-replay-no-private-data` | Not checked | Enbu has a public DTO test excluding bytecode/private markers and the browser requests diagnostics separately, but an exhaustive secret-field denylist over every response shape has not been run. This supplemental output audit is separate from the verified required observation rejection check. |
| `rules.data-extension-vs-new-primitive` | Verified | The runner integration test accepts a compatible unit-class extension and rejects an unavailable transition primitive. |
| `browser.local-loop-offline-real-wasm` | Verified | `bash tests/browser/run-nix.sh` on root source `96504e444dbc83a3ffb24e9131dcf54f623be846`: 3/3 tests passed, including seven real Worker NPC benchmark cases and the full offline persistence journey. |

## Delivery A–D

### A — Core battle

**Verified.** The initial Senritsu package validates into a real `VerifiedRulePlan`.
The Rust workspace tests cover deterministic repeated simulation, current-tick
semantics, concurrent damage, and CU exhaustion. The campaign generator runs
seven actual compiled NPC programs through native Jinrei and Enbu and checks
that accepted actions cause movement, unit combat, tower damage, reserve
deployment, and core damage. Every checked damage event matches its resulting
HP delta.

### B — Tactics language and CU

**Verified for current grammar and package.** Native tests cover parsing and
formatting, text/AST/optimizer equivalence, argument ownership, set/vector and
matrix operations, ordered logic, finite collection ordering, cost tariffs,
and budget overrun. The scenario generator checks the beginner AST against
equivalent text through compile and complete simulation output. A new DSL or
transition primitive still requires its own validator and execution tests.

### C — Browser developer experience

**Verified.** On root source `96504e444dbc83a3ffb24e9131dcf54f623be846`,
the production Playwright suite passed all three tests. The application includes
Worker to WASM compilation and simulation, replay and restricted diagnostics
views, IndexedDB revisions, and service-worker asset caching. Playwright runs
against the production build with the generated WASM file. The strict assertion
scopes the Tick 4 `deploy_ready_reserve` diagnostic to an accepted row and checks
its side and tick. The Worker benchmark runs all seven NPC cases in the browser.

### D — Playable local product

**Verified.** The catalog contains
seven beginner/standard/expert NPC recipes with objectives and criteria; the
starter draft comes from the active ruleset's defaults and needs no handwritten
code. Native gameplay checks cover all seven, including tower destruction,
withdrawal, healing, reserve deployment, and different tactical outcomes. The
production browser journey checks semantic edits, exact saved source/config,
offline reload, rematch, and another saved revision; all three production
Chromium tests passed on source `96504e444dbc83a3ffb24e9131dcf54f623be846`.

## Current local verification commands

```sh
cargo build --workspace --locked
cargo test --workspace --locked
bash scripts/wasm/build.sh
node tests/conformance/generate-scenario-inputs.mjs --check
node tests/conformance/compare-adapters.mjs
npm ci
npm run build
npm ci --prefix tests/browser
npx --prefix tests/browser playwright install --with-deps chromium
npm run test:e2e --prefix tests/browser
```

The native/WASM comparison requires the generated module at
`apps/web/public/wasm/senkei_wasm.wasm`. Generated binaries are ignored and are
not committed. Compact goldens include hashes of the complete canonical
request and response plus a result, event, and CU summary; the comparator still
compares every recomputed response field directly across two native executions
and one actual WASM execution.
