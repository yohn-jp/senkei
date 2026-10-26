# Production checkpoint

User requested an immediate commit/push checkpoint because the execution limit may discard the workspace. This branch and Draft PR #44 are unfinished; do not merge or report completed art.

## Saved implementation

- Baseline main: 54011ea0d04cbfbb4400daa065af0681affad3d5.
- Golden candidates: F01 and R01 only. No unrelated character references.
- bfb0428: face-conforming facial patches, folded cape volumes, R01 cloth sleeves and flared robe. 273 tests and typecheck passed at that revision; browser reevaluation remains pending.
- 66ab880: visible reduced LODs retain major limb and weapon motion. Targeted 51 tests and typecheck passed; browser acceptance pending. Reduced material response and fine articulation are simplified, with up to 8 Hero/minion or 9 monster mesh draws.
- Existing app/lab evidence in docs/evidence/art-production records its own older source version. Those earlier facial/garment FAIL results are not replaced by an inferred PASS after code changes.

## Resume

1. Clone branch art/3d-production and read the production contract, status, verification and evidence records.
2. Run npm ci; build real WASM with bash scripts/wasm/build.sh using Rust wasm32-unknown-unknown and LLVM wasm-ld, then npm run build.
3. Use tools/art/README.md to recapture the latest F01/R01 models. Inspect full-resolution actual browser renders, all five clips over time, three LODs, actual Hero Detail and Battlefield. Record remaining defects and correct them incrementally.
4. Do not expand the remaining ten Heroes until golden Hard Gates pass. Then produce and evaluate their individual shapes on this same branch.
5. Preserve read-only Replay/renderer boundaries; complete native/WASM/fog, visual, desktop/mobile and performance evidence. Physical GPU remains NOT_CHECKED in this cloud environment.
6. Push all subsequent work to this branch/PR; do not create per-worker PRs or merge main.

Generated WASM, node_modules, target, full-resolution test-results and dist are reproducible ignored build/capture output. Curated contact sheets, provenance, source generators and capture tools are tracked. Full temporary capture output is not final acceptance evidence.
