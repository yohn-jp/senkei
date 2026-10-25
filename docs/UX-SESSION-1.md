# UX Implementation Session 1 — local PvE entry

Base: `5b1bf5177f682388120930769bc3c3ad635f9c58` (main, PR #19).
Branch: `feat/ux-first-pve`.

## Implemented screens

| Screen | Implementation and boundary |
| --- | --- |
| S00 | Actual Worker/WASM and bundled RulePackage loading; Catalog loading/failure gates Quick/Custom. Retry reload preserves local Draft storage. No progress percentage is fabricated. |
| S01 | Default Home offers Quick / Custom / Continue. Desktop compares three choices; Mobile presents Quick as the main task and expands secondary choices. Mobile legacy/sample navigation is a separate disclosure. |
| S02 | Local PvE confirms the actual bundled Next package and existing fixed opponent Starter. Its initial roster is read from the current opponent slots. No invented NPC, difficulty or new scenario catalog. |
| S03 | Shows the same current five slots, real skill branch names and planned skills, Squads/start nodes and current source. Desktop reviews all five slots together; Mobile uses a button-driven Hero pager with an optional full-list disclosure. The first launch uses the existing legal Starter. Restored/edited Drafts are retained; replacement with the initial preset requires explicit confirmation. |
| S10 | Distinguishes missing inputs, unverified configuration, stale compilation, invalid Compiler/Enbu input, processing failure, and a launchable Snapshot. Desktop shows the full review grid; Mobile shows a mutually exclusive compact checklist with direct repair actions and optional details. Repair links open existing Hero/Skill/Squad/Jinrei screens. Save and diagnostic collection remain optional. |
| S11 | Submits the exact validated Snapshot to real WASM Enbu; a synchronous in-flight guard prevents duplicate launch. Errors retain the Draft and return to Ready. |
| S12 | Only a completed real SimulationResponse is adapted to the existing ReplayPlayer/Battlefield. Existing playback, seek, analysis, renderer retry and owner/public visibility remain in their existing implementation. |

## Existing screens connected without replacement

S04–S09 continue to use the existing Hero Collection, Detail, Skill Tree, Squad Assembly, Jinrei editor and Catalog/Coverage panel. They share the same NextWorkspace slots and Draft; no second player model or alternate compiler was introduced.

S13 uses existing analysis and diagnostics. Rematch returns to Ready, retaining the previous Run for comparison. S14 is the existing Next save/restore/import/export control set, exposed directly from Continue and Ready. Recovery Copy and pinned Restore Point keep their existing distinct LocalStorage keys and format version. S15 connects Core/Catalog reload, Draft repair, saved-data compatibility messages and existing renderer retry. The old G1/initial-app navigation has since been retired; IndexedDB records remain exportable from the separate data-recovery route.

S13–S15 had **not** received a full redesign at this session's baseline. S09 remains the existing Catalog/Coverage panel rather than a newly implemented standalone Coverage screen. There is no migration between initial/Next. These are scope boundaries, not completed broader Issue #5 acceptance.

## Start-validation and invalidation

The additive `CoreClient.preflight(snapshot)` operation reaches the Rust dispatcher and `enbu::preflight`. Both preflight and simulation call the same `initialize_match`: input identity/version/limits, world construction, Next Hero/Squad/Node/Skill initialization, configuration and memory validation. Preflight executes no battle ticks and produces no result or replay.

The frontend uses the existing Catalog-bound compiler for both armies. Its compiler key includes current Draft, formation slots and the complete existing Catalog stamp. Its launch key additionally includes opponent slots, diagnostic choice and package identity. Any relevant edit makes the previous readiness unusable. Async preparation rejects results if that key changed before completion. Start consumes the stored immutable SimulationSnapshot; it does not regenerate a different opponent/context after review.

Coverage remains Not Proven; an undeclared Behavior Default is never reported as applied. Actual legality and identity validation comes from the existing package/compiler/Enbu. No Jinrei grammar, Senritsu rule, battle tick semantics, Renderer or battlefield geometry was changed.

## Verification

Application implementation commits: `3ea91d7`, `a2662bc` (mutually exclusive Mobile Ready layout), `14f077f` (rejection text contrast), and `4b1e4b2` (actual compiler CU estimate on Ready).

| Check | Result |
| --- | --- |
| `npm run typecheck`, `npm run build` | PASS |
| `npm test` | PASS — 15 files / 89 tests |
| `npm run contract:types` followed by generated-file diff | PASS — no Replay schema/type drift |
| `cargo test --workspace --release --locked` | PASS — full workspace, including real long-running Next scenarios |
| Final focused release Enbu + WASM dispatcher preflight tests | PASS after the final tick-0 preflight check; production WASM rebuilt |
| `node tests/conformance/generate-scenario-inputs.mjs --check` | PASS |
| Native/WASM `compare-adapters.mjs` | PASS |
| `bash scripts/balance/run-next.sh` | PASS — all 7 native/WASM Next comparisons, including owner/public/rejection cases |

### Actual Chromium journeys

The focused spec is [first-run-journey.spec.ts](../tests/browser/specs/first-run-journey.spec.ts). Screenshots and the real per-viewport run report are in [the evidence index](evidence/ux-session-1/README.md).

| Required journey | Result |
| --- | --- |
| First launch → Quick → Ready → Enbu → actual Replay | PASS at all five widths; real bundled Starter, real WASM/compiler/preflight, confirmed Draw at the actual 600-tick limit |
| Custom → Hero edit → Jinrei → Ready → battle | PASS |
| Invalid source → real Compiler rejection → repair | PASS, Start remains disabled |
| Valid Jinrei + invalid Squad nodes → real Enbu rejection → direct Squad repair → battle | PASS (`spans multiple map nodes`) |
| Tactical edit → Compile invalidation → recompile | PASS |
| Saved Restore Point and unsaved Recovery resume | PASS; distinct pinned and recovery copies preserved |
| Mobile 320 / 390 / 430 | PASS; no horizontal overflow, Hero pager and optional full list, exclusive mobile Ready checklist, actual Replay |
| Desktop 1440 / 1920 | PASS; full preset/Ready review and actual Replay |

The final Custom rejection/repair/run case was repeated against the final `4b1e4b2` production build. The existing Next workbench regression also passes replay play/pause/seek, analysis-event return, changed tactics, revised battle, narrow layouts and offline recovery. Existing Hero Atelier five-viewport cases, initial local-PvE offline journey, Worker NPC benchmark and app-shell navigation all pass (9 regression cases in total).

Reproduction on this Nix host (use a free dedicated preview port):

```sh
bash scripts/wasm/build.sh
npm run build
SENKEI_BROWSER_PORT=4317 SENKEI_UX_EVIDENCE_DIR=/tmp/senkei-ux-evidence bash tests/browser/run-nix.sh specs/first-run-journey.spec.ts --workers=1
SENKEI_BROWSER_PORT=4317 bash tests/browser/run-nix.sh specs/hero-atelier.spec.ts specs/local-pve-offline.spec.ts specs/worker-benchmark.spec.ts specs/next-workbench.spec.ts specs/app-shell.spec.ts --workers=1
```

Chromium host-library availability was handled using the repository Nix wrapper; dedicated ports avoided unrelated workspace preview servers. Evidence was copied outside both runners' cleaned output directories before committing.

### Graphics and CI baseline

The existing Graphics G1 browser suite passed **12/12** on the final application build. This includes four replay viewports, playback/seek/camera, WebGL loss/retry, unavailable WebGL, 320px/landscape, sample navigation and repeated 390px replay replacement. Existing renderer/F01 study tests also passed; generated study assets/screenshots were not included in this change.

```sh
nix shell nixpkgs#chromium -c bash -c 'export SENKEI_CHROMIUM_EXECUTABLE="$(command -v chromium)"; SENKEI_BROWSER_PORT=4318 SENKEI_GRAPHICS_EVIDENCE_DIR=test-results/graphics-g1 npm run test:browser'
```

At delivery, baseline main `5b1bf5` has [Native Rust, native/WASM conformance and Web build passing](https://github.com/yohn-jp/senkei/actions/runs/40176709387); its Production browser smoke job is still in progress. [Graphics G1 on the same baseline passed](https://github.com/yohn-jp/senkei/actions/runs/40176709412). This incomplete baseline browser run is distinct from the passing local focused/regression/Graphics results above. The full long-running battlefield capture suites remain covered by the pending CI smoke run; local regression focused on the changed journeys.

The browser CI artifact upload now includes the new journey evidence directory; fresh CI captures are kept alongside the existing browser outputs.

## Limits

Browser verification uses Chromium with SwiftShader on this development host; physical devices, mobile operating-system keyboards and hardware GPU performance are not measured. This session does not certify the visual/art or balance acceptance gates of Issue #5.
