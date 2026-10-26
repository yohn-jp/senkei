# Main 5c84c85 terminal CI diagnosis

Observed run: https://github.com/yohn-jp/senkei/actions/runs/40279716616

Source main `5c84c85e4a935dae4881af87eb2b8f607987c786`; terminal FAILURE. Read through configured GitHub connector; CLI credential returned401 in this child environment. No credential copied or printed.

Native Rust build/tests, native/real-WASM conformance, web unit/build, production browser build all PASS. Quick desktop1440/1920 and mobile320/390/430 PASS. Visual desktop1440/1920 and mobile320/375/390/430 PASS. Verification desktop/mobile PASS. Journeys-analysis PASS. These automated results do not certify final art, physical touch/IME/GPU or broad untested contracts.

Only independently failed browser groups:

- journeys-workbench job121432338101: one600s timeout, followed by cleanup setOffline(false) on a closed context masking the primary wait. Same previously proven obsolete immediate Restore saved assumption.
- journeys-ui job121432338182:16failed/50passed. Exactly diagnostic Replay-vs-new-Source button1, Continue restore route1, NPC module-relative WASM/SSR paths8, successful pinned-save message6. Tactical context passed this run; its older demonstrated read/click race is separately repaired by PR42. No newly unexplained failure found.
- Production browser smoke job121443081204 cascaded from these failed groups; its coverage verification steps were skipped, not PASS.

Full logs saved `/workspace/scratch/ci-121432338101.log` and `/workspace/scratch/ci-121432338182.log`. PR42b82cbf7 repairs all six affected specs without product edits/skips/timeouts/removed behavioral checks. Its18 focused old-main artifact passes are recorded separately in `ci-contract-repairs.md`. This diagnosis is not an integrated-new-main verification claim.

Next verification checkpoint: wait for PR40 review terminal, then use exact merged main in clean `/workspace/wt-main-verify`, local workspace dependencies, independently stamped production build and actual current compatible WASM. Run focused affected flows with one Playwright worker and isolated outputs; record CI at that exact main separately. Do not rerun the unchanged54011 artifact tests as new-main proof.
