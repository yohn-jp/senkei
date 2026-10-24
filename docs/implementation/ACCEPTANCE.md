# Phase A–D acceptance evidence

This file records executable evidence for the local PvE delivery criteria. It
does not replace the API or product contracts. `tests/conformance/matrix.json`
has the same twelve checks in machine-readable form. `verified` means the
current source has a real test for the property; `partial` identifies coverage
that still needs a dedicated oracle; `pending-final-run` is waiting for the
current integrated browser test to run.

## Twelve conformance conditions

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
| `observation.unknown-null-and-visibility` | Partial | Model tests distinguish unknown from known null; Senritsu rejects hidden-field and derived hidden reads. A dedicated Enbu runtime probe for opponent hidden-field reads remains unchecked. |
| `output.public-replay-no-private-data` | Partial | Enbu tests the explicit public response projection and excludes bytecode/private markers; the browser passes restricted diagnostics separately. An exhaustive secret-field denylist over every response shape remains unchecked. |
| `rules.data-extension-vs-new-primitive` | Verified | The runner integration test accepts a compatible unit-class extension and rejects an unavailable transition primitive. |
| `browser.local-loop-offline-real-wasm` | Pending final run | The production Chromium journey exercises no-code, semantic edit/compile, real WASM battle/diagnostics, IndexedDB revisions, offline reload, rematch, and resave. Its latest accepted-row assertion awaits the integrated final run. |

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

**Awaiting final integrated run.** The application branch includes Worker to
WASM compilation and simulation, replay and restricted diagnostics views,
IndexedDB revisions, and service-worker asset caching. Playwright runs against
the production build with the generated WASM file. The current strict test
scopes the Tick 4 `deploy_ready_reserve` diagnostic to an accepted row and
checks its side and tick; record the final integrated result here after it
passes.

### D — Playable local product

**Scenario data verified; final browser evidence pending.** The catalog contains
seven beginner/standard/expert NPC recipes with objectives and criteria; the
starter draft comes from the active ruleset's defaults and needs no handwritten
code. Native gameplay checks cover all seven, including tower destruction,
withdrawal, healing, reserve deployment, and different tactical outcomes. The
production browser journey checks semantic edits, exact saved source/config,
offline reload, rematch, and another saved revision; its final integrated run
is pending.

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
