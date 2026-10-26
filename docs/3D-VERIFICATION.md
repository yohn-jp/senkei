# 3D production verification snapshot

Captured 2026-10-26 08:55 UTC against PR #44 head `bfb0428fd6534ba874142e370ebe586dec5505a7`, with concurrent art-only workspace edits. Verification stopped at the user-requested preservation checkpoint. This is not final acceptance.

## Completed checks

- `npm test -- packages/replay-contract/src packages/replay-player/src packages/renderer/src/battlefield-fog.test.ts packages/renderer/src/battlefield-replay-effects.test.ts` — PASS: 11 files, 60 tests. Includes side-authorized fog projection, hidden-entity rejection, seek behavior, fog renderer and replay effects.
- `node tests/conformance/generate-scenario-inputs.mjs --check` — PASS: generated campaign inputs, symmetry and seven saved-run budgets.
- `SENKEI_NATIVE_DISPATCHER=target/debug/senkei-wasm-dispatch node tests/conformance/compare-adapters.mjs` — PASS: all seven committed campaign scenarios. Complete response envelopes match across repeated native execution and real compiled WASM, including checked-in golden hashes. Native executable was built by the input-generation check.
- `sha256sum apps/web/public/wasm/senkei_wasm.wasm target/wasm32-unknown-unknown/release/senkei_wasm.wasm` — identical hash `8ec4c1b4dcb9b5acb6fa59322aa6e8398db72fdd4ed1632af6dcb122326f59ea`. No renderer or WASM rebuild was performed by this verification task.

## Partial checks and limits

- `PATH="$HOME/.cargo/bin:/workspace/scratch/bin:$PATH" cargo test --workspace --release --locked` compiled and began execution. Native canonical battlefield, owner/public reveal expiry, presentation-only logic invariance, bad roster/context rejection, hidden bridge authorization and real squad bridge checks passed. The full suite did not finish: both-orientation base assault, full Next scenario matrix and 600-tick owner replay boundary were still running when stopped. Do not report a full native pass.
- `PATH="$HOME/.cargo/bin:/workspace/scratch/bin:$PATH" cargo build --locked --release -p senkei-wasm --bin senkei-wasm-dispatch` was stopped before completion. An initial campaign comparator attempt using the absent release dispatcher failed with `ENOENT`; the successful debug-native comparison above supersedes that setup failure.
- A repeated Next test binary execution with `NEXT_BALANCE_REPORT=/workspace/scratch/3d-next-balance.json NEXT_ADAPTER_FIXTURE_DIR=/workspace/scratch/3d-next-adapter target/release/deps/next_scenarios-ec3050fcac7d51a6` generated canonical public/owner fixtures, but was stopped before finishing all cases.
- `SENKEI_NATIVE_DISPATCHER=target/debug/senkei-wasm-dispatch NEXT_ADAPTER_REPORT=/workspace/scratch/3d-canonical-adapter-evidence.json node tests/conformance/compare-next-adapters.mjs /workspace/scratch/3d-canonical-adapter` was stopped during its first native comparison. Real Next public/owner WASM parity remains unverified in this checkpoint.
- Local runtime logs and ephemeral fixtures are under `/workspace/scratch/3d-*`; these paths are not portable repository evidence. No visual acceptance is claimed by this report.

## Actual PR CI status

`gh pr view 44 --json headRefOid,state,statusCheckRollup` reported OPEN at the head above with an empty check rollup. At 08:55 UTC, `gh run view 40295097726 --json status,conclusion,jobs,url` reported `completed`, `cancelled`, `jobs: []`. The current-head CI run did not prove any checks passed: https://github.com/yohn-jp/senkei/actions/runs/40295097726 . The PR remains unmerged.
