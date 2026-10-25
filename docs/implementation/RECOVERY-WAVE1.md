# Architecture recovery — Wave 1 delivery

Shared producer base: `edc70466f4bcfdf76199d07bcd485b314f576f4b`.

Six independent Luna workers created isolated deliverables. The user subsequently authorized merge commits without waiting for CI and requested future commits directly on main. CI completion is therefore not a merge gate and is not claimed as PASS. No downstream gameplay integration was started.

## Deliverables

| Worker | PR / submitted head | Owned files and delivered contract | Local proof |
| --- | --- | --- | --- |
| A | [#16](https://github.com/yohn-jp/senkei/pull/16) · `13e44a2b555bfce4084c2f7f93231dace546c2df` | Editor adapter fixtures, Editor tests/harness, fixture generation/check script and package commands; real next 2.0.0 identity and compiler replies | PASS: adapter 4 tests; Editor Vitest 14; TS; fixture check; workspace release tests, exit 0 |
| B | [#15](https://github.com/yohn-jp/senkei/pull/15) · `8b6d2193cf48cebaeb8cabb1d53577cddc18170b` | `next_world.rs`, Senritsu dependency and lock; guarded typed World projection with explicit supplemental metadata and compatibility diagnostics | PASS: Senritsu 26 unit + 12 integration; library check |
| C | [#13](https://github.com/yohn-jp/senkei/pull/13) · `fe8da82cbe9accda4066ec2eef857efda4bf881e` | Senritsu Catalog/lib and Behavior producer tests; six typed domain views, namespaced field IDs, typed presets, validation and reproducible digests; Catalog schema 1.1.0 | PASS: focused Senritsu and Behavior tests; production profiles remain Not Declared |
| D | [#17](https://github.com/yohn-jp/senkei/pull/17) · `87fe307df631937147d29e08fb788903ea0100a9` | Web contracts/Worker/client/NextWorkspace and domain panel; WASM dispatcher and tests; real stamped Catalog/Compiler route | PASS: dispatcher 2 tests, wasm32 release build, Web build; browser UI acceptance NOT_CHECKED |
| E | [#18](https://github.com/yohn-jp/senkei/pull/18) · `f9c500da7e1cea4e08f93bb95083c5dd0bfe581b` | Battlefield browser spec and [bounded visual evidence](../evidence/battlefield/visual-certification/pr7-edc704/README.md), 14 selected screenshots with hashes and exact producer identity | Visual FAIL; Functional/Interaction PARTIAL_PASS; browser test FAIL; 375px, browser base destruction and physical device NOT_CHECKED |
| F | [#14](https://github.com/yohn-jp/senkei/pull/14) · `b61733a58d0f3d97152e6fc719dba5c323b88ee2` | Seven canonical specifications and [runtime integration contracts](../RUNTIME-INTEGRATION-CONTRACTS.md); identity, ordering, coverage, authorization and decision register | PASS: diff check; runtime tests NOT_CHECKED (documentation only) |

E used the unmodified shared producer base, not the subsequently integrated Editor build. At 320px labels/controls overlap the battlefield; Overview geography and structure presentation fail the visual criteria. The initial run stopped on a dead-Hero selection assumption. Its focused follow-up failed on an obsolete block referencing variables outside their loop. That block and the stale RUNNING report were corrected directly on main; browser verification after cleanup remains NOT_CHECKED. Physical-device acceptance is NOT_CHECKED. Screenshot existence does not establish Visual PASS.

All submitted branches retained the shared base and did not consume sibling uncommitted changes. B and D each added one necessary dependency entry to Cargo.lock; both entries were retained during integration. Formatting was NOT_CHECKED where workers lacked the Rust formatting component.

Exact submitted-head CI links (not awaited or used as acceptance): [A](https://github.com/yohn-jp/senkei/actions/runs/40165443368), [B](https://github.com/yohn-jp/senkei/actions/runs/40165325501), [C](https://github.com/yohn-jp/senkei/actions/runs/40165074190), [D](https://github.com/yohn-jp/senkei/actions/runs/40165655837), [E](https://github.com/yohn-jp/senkei/actions/runs/40166307236), [F](https://github.com/yohn-jp/senkei/actions/runs/40165147690). CI acceptance is NOT_CHECKED in this integration report at the user's instruction; it does not imply those jobs passed.

## Integration verification

The first four deliverables were merged using merge commits. Commit `298de49e24a51a564b51bed899486cfef296c578` then regenerated all four Editor fixtures directly on main for Catalog schema 1.1.0, resolving the known A/C generated-data dependency. D was merged as `ad0d732d083f2acdff4fb9fdd363b141cb299cd1`.

Commands verified on integrated main through D (independent target directory, jobs 2, local Rust debug information disabled to limit storage):

- `bash scripts/jinrei-editor-fixtures.sh --write`: PASS, four real producer fixtures generated.
- `cargo test -p senkei-editor-adapter --release --locked`: PASS, 4 tests.
- `npx vitest run packages/jinrei-editor/editor.test.ts`: PASS, 14 tests.
- `npm run typecheck`: PASS after refreshing the local Editor workspace dependency link.
- `cargo test --locked --release -p senkei-wasm --test editor_dispatch`: PASS, 2 tests using integrated Catalog identity.
- `npm test`: PASS, 15 files / 89 tests.

A's full `cargo test --workspace --release --locked` PASS is evidence for A's submitted head. The full workspace suite, real browser Editor interaction, and full native/WASM/browser acceptance have NOT_CHECKED status on the final integrated head. CI was not awaited at user instruction. No integrated full-suite PASS is implied by focused checks.

E was merged as `e664486a624f9bfd64410651cc68871569d7bc89`. All six PRs were merged with merge commits; remaining integration corrections and this report are direct main commits. The fixed wave stops here.

After removing E's stale out-of-scope reference, `npx tsc --noEmit --skipLibCheck --target es2022 --module nodenext --types node tests/browser/specs/visual-battlefield.spec.ts` passed. The amended verification JSON parses successfully and `git diff --check` passed. This static check is not browser execution evidence.

## Next-wave dependency table

| Consumer / intended connection | Required producer or decision | Current limit |
| --- | --- | --- |
| Production RulePackage / Replay ← World Compiler | B adapter plus `DEC-WORLD-BINDING-001` and `DEC-WORLD-MAP-CONVERSION-001` | 35 nodes, 42 endpoint pairs and 7,020 WU match; world ID, all 42 edge IDs and bridge-site IDs differ. Four partial crossing intervals and 14 concealing Jungle edges cannot be represented faithfully by current runtime fields. Routes/towers require explicit supplemental metadata. Production replacement deferred. |
| Match / ReproductionContext ← Behavior Catalog | C producer plus `DEC-BEHAVIOR-BINDING-001`; authored production defaults, preset values and aggregation decisions | Production next has no authored Behavior extension. Exact Catalog keys alone do not bind match execution/reproduction. Balance values remain undecided. |
| Enbu Tick ← Behavior Runtime | Match-bound Behavior, declared cross-Capability total order and legality/subject rules from F | Existing retreat → pursue → move and generic resolver arbitration were not substituted. Runtime connection deferred. |
| NextWorkspace Editor ← real Catalog / Compiler | D route with exact Catalog stamp and source revision | Connected; real browser editing/save/rematch acceptance still NOT_CHECKED. Catalog changes require regenerated fixtures and cache invalidation. |
| Decision Trace / Coverage UI ← Enbu | Authorized Observation/RestrictedDiagnostics route, finite analysis domain and class proofs | Not Declared / Not Proven / Unknown / Not Checked remain distinct. No Analyzer, measured coverage, or unrestricted trace route implemented. |
| Terrain / attack / MID observation semantics | `DEC-TERRAIN-OCCLUSION-001`, `DEC-ATTACK-TIMING-001`, `DEC-MID-DIRECTION-001` | Existing disabled terrain occlusion, start-tick hit behavior and missing typed direction observation are not declared complete. |
| Battlefield final acceptance | E evidence and concrete visual/test defects | Renderer screenshots and interaction evidence must be assessed separately from Functional and CI results; physical device checks remain NOT_CHECKED. |

No production World swap, Behavior Tick execution, Coverage Analyzer, attack-time/occlusion/MID-direction implementation, or next-wave work was included.
