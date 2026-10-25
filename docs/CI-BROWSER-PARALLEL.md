# Browser CI parallelization

Baseline: main `5b1bf5`. [Completed CI run 40168951726](https://github.com/yohn-jp/senkei/actions/runs/40168951726) spent 80m53s in the production browser test step: the visual capture test exhausted its 30-minute timeout twice, and fixed-tick verification exhausted five minutes twice. Setup took about 1m40s. These were failing runs, so there is no measured successful baseline speedup claim.

CI and Graphics G1 now run automatically for PRs and main pushes. Feature pushes no longer duplicate the PR run; CI retains manual workflow dispatch. New revisions cancel older runs of the same PR. The duplicate push run for PR #20 was canceled while its PR run was retained.

The browser build runs once, then six isolated runners consume the identical artifact:

| Group | Coverage |
| --- | --- |
| journeys | All specs except the two heavy capture files; new ordinary specs join automatically |
| verification-desktop | 1920×1080, 1440×900 |
| verification-mobile | 430×932, 390×844, 320×844 |
| visual-desktop | 1440×900, 1920×1080 |
| visual-mobile-375-390 | 375×812, 390×844 |
| visual-mobile-430-320 | 430×932, 320×740 |

Each runner keeps one Playwright worker. Existing assertions, per-test timeouts, and retry policy are retained. The visual harness closes the completed canonical scene before opening subsequent scenarios, releasing its unused background WebGL renderer.

Build SHA and WASM/HTML checksums are verified before consuming the shared artifact. Evidence and JSON timing reports have separate artifact names. Uploads target newly generated capture directories rather than all historical battlefield evidence. The original `Production browser smoke` check remains as an aggregate gate: the build and every group must pass. It additionally verifies combined coverage of all six visual viewports, the original 70-capture minimum, identical scenario/replay identities, and the MID follow Hero identity across groups.

Validation:

- actionlint: PASS for both modified workflows.
- Actual Playwright discovery: 12 total tests = 10 journey tests + 1 verification + 1 visual; no omitted/overlapping suite entries before viewport expansion.
- Matrix viewport coverage: all six visual and five verification viewports occur exactly once.
- Unknown suite selection rejects explicitly.
- Typecheck and production Web/WASM build: PASS.
- Shared-build revision/checksums: PASS locally; the dispatched run also completed its shared build and started all six groups.
- Real Chromium app-shell smoke with CI reporter/suite configuration: PASS.
- Aggregate coverage/provenance guard: four Node tests PASS, including missing groups, duplicate viewports, stale build, divergent replay/Hero identity and insufficient captures.

The dispatched measurement run was stopped before PR submission to avoid running another full suite beside the PR run. Full distributed browser results and actual critical-path reduction remain pending on the PR. No test timeout or assertion was relaxed to claim a speedup. Native/WASM conformance is unchanged and may become the next critical path.
