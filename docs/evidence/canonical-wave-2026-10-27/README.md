# Canonical wave verification evidence

Implementation source: `146872469e6c93a1e6da4ff31a72e3b795b9073a`.
Full status, scope and decisions: [wave report](../../implementation/canonical-coverage/IMPLEMENTATION-WAVE-2026-10-27.md).

The manifest gives the uncompressed byte count and SHA-256 for each gzip log. It also identifies the real 577-tick exported Run used by the browser and timing checks; the 45 MB export itself is retained in the workspace rather than Git. These are synthetic local-player data, not official reward or settlement records.

- `web-tests.log.gz`: actual `npm test`, 405 PASS.
- `web-build.log.gz`: actual typecheck and production build.
- `native-wasm-seven.log.gz`: existing Native/real-WASM scenario equality and repeated Native/golden checks.
- `behavior-native-wasm-eleven.log.gz`: actual dedicated Behavior request parity, including authorization and invalid identities.
- `browser-eight-cases.log.gz`: complete scoped browser run, **5 PASS / 3 FAIL**. No failed case is treated as passing.
- `ci-1468724.json.gz`: source CI job/step snapshot. Native full-workspace, conformance and Web jobs succeeded; the snapshot is not a combined green CI claim.
- `reproduction-timing.json`: isolated real Worker/WASM reproduction; actual same result in 116,033 ms. This measurement does not change test deadlines.
- `comparison-benchmark.json`: same-data old/new full-response comparison timing, cloning excluded. Identity hash bytes and correctness checks were retained.

No test deadline, game victory condition, required check or graphics implementation was changed to conceal failure. Graphics quality and Issue #51 are outside the wave.
