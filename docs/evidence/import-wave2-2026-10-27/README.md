# Import and recovery measurement, 2026-10-27

Baseline source: `216360f91a63a9031bef4ce9332de2ca2a8797a9`. Chromium `/usr/bin/chromium`, Linux container, cgroup quota four CPUs. One native scenario test used roughly one CPU during the successful measured run. Instrumentation was diagnostic only; production code and test deadlines are unchanged. The real release WASM SHA-256 was `d34491379de1bbfb4ab986fefb51e427846020a9b4511a7d1ea31ae1f97f6252` (Rust 1.99.1). The actual generated single-Run export was 45,439,592 bytes, SHA-256 `9d6eecdd1d72d3bdfc572da8eb54fd0f491280c0d255b880603e58a34d469b7e`, with final tick 577. Its file was kept locally at `/tmp/senkei-wave2-real.json`; it is not included in Git.

Actual Worker → WASM reproduction → response parsing → full equality → validated repository save was exercised. Baseline semantic incompatible-world import test **PASS**, including preserving the existing immutable records and Draft, with its original 120-second baseline-import deadline; reported test duration 1.8 minutes, including the subsequent incompatible import and checks. Run generation and the test took 3.8 minutes in total. The first attempt failed in Run generation at its unchanged 180-second deadline during concurrent release compilation, before import; it establishes no import result. A second baseline run of other tests was deliberately interrupted before its assertions in order to exercise final integration instead.

| Measured operation | Time |
| --- | ---: |
| Initial Run generation Worker WASM dispatch (`reproduce`) | 91,972.5 ms |
| Generation response Worker JSON parse | 293.6 ms |
| Generation save clone / structural validation / IndexedDB transaction | 1,846.5 / 1,385.6 / 3,827.6 ms |
| Baseline import first clone / structural validation | 977.4 / 711.3 ms |
| Import Worker WASM dispatch (`reproduce`) | 79,121 ms |
| Import response Worker JSON parse | 484.9 ms |
| Complete reproduction response equality | 383.6 ms |
| Import save clone / structural validation / IndexedDB transaction | 1,735.9 / 1,233.1 / 950.5 ms |

Worker dispatch time includes the WASM interface and its response transfer into a JavaScript string; it does not isolate Core computation from serialization. Cross-thread structured cloning and the total import wall time were not independently timed. A single mid-computation process RSS sample showed the largest Chromium renderer at 469,976 KiB; this is neither peak memory nor a breakdown of WASM/JS memory. No performance root cause or fix is claimed from these measurements. The 2026-10-27 canonical report's previous 116,033 ms reproduction and three 120-second deadline failures remain valid observations under its conditions; this successful run does not erase them.

To reproduce the diagnostic instrumentation on baseline `216360f`, apply `git apply docs/evidence/import-wave2-2026-10-27/instrumentation.patch`, build the real WASM with `scripts/wasm/build.sh`, and run `npx vite build`. With Chromium installed, run:

```sh
SENKEI_CHROMIUM_EXECUTABLE=/usr/bin/chromium SENKEI_BROWSER_PORT=4188 npx playwright test --config tests/browser/playwright.config.ts experiment-import-safety.spec.ts --workers=1 --grep 'semantic incompatible'
```

The browser test creates the genuine Run itself unless `SENKEI_REAL_EXPERIMENT_ARTIFACT` points at an existing genuine export. Console lines prefixed `SENKEI_TIMING` give the measured phases. Revert the instrumentation with `git apply -R docs/evidence/import-wave2-2026-10-27/instrumentation.patch`. The instrumentation does not change deadlines or substitute a mock Core. The Rust toolchain bundled linker in this environment required a local wrapper stripping the duplicated `-flavor wasm` argument; this environment workaround is not a repository change.

Final integration preview at `3d15490628f58e2c74665bc1bc568460bf95f51e` was tested separately with its production Web build and real WASM, reusing the same genuine baseline export. The original uninstrumented browser tests and deadlines were used. Both **PASS**: failed replacement write preserves the existing Run, Draft and durable experiments (3.3 minutes); unrecognized stored schema remains exportable with Core unavailable (1.5 minutes). Command from the baseline test checkout, with integration preview serving port 4189:

```sh
SENKEI_BROWSER_EXTERNAL_PREVIEW=1 SENKEI_REAL_EXPERIMENT_ARTIFACT=/tmp/senkei-wave2-real.json SENKEI_CHROMIUM_EXECUTABLE=/usr/bin/chromium SENKEI_BROWSER_PORT=4189 npx playwright test --config tests/browser/playwright.config.ts experiment-import-safety.spec.ts --workers=1 --grep 'failed replacement write|unrecognized saved schema'
```

The incompatible-world test was verified against the baseline, not against the final integration build. No timeout, assertions, required checks, authorizations or response equality were weakened. No code fix is included.
