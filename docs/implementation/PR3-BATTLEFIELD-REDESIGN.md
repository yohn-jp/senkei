# PR #3 Battlefield redesign Wave

Authority: [Issue #5](https://github.com/yohn-jp/senkei/issues/5) and [blocking request](https://github.com/yohn-jp/senkei/pull/3#issuecomment-6385227700). Baseline: `c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb`. Production runtime: `43d2c35b908d0a6d08eaf049f28cde43f5190b01`. Later evidence/report commits do not change the runtime. This Wave covers Battlefield; Hero Atelier, balance and frozen PR #4 retain their existing status.

## Cause and resulting architecture

The actual-match renderer reused G1 sample-scene assumptions: rectangular stacked ground boxes, oversized lane ribbons, a whole-fixture camera and a small page region. Its terrain coloring also painted approximately ten-render-unit-wide tan bands around routes and camps. Even after narrowing the road meshes, that coloring consumed the inter-lane jungle. Scattered perimeter props could not establish tactical regions inside the authored lane network. Solid base geometry concealed units, nearby Hero models visually overlapped, and indiscriminate cue text overwhelmed mobile combat.

Actual maps now use `world-presentation.ts` / `battlefield-terrain.ts`. Continuous terrain extends beyond the play graph without a display slab or cut face. Polygons bounded by the actual TOP–MID and MID–BOT polylines define coherent forest-floor and grove regions. Narrower presentation road bands, genuine route clearances and irregular camp glades make the authored jungle connections readable. Terrain is presentation only; it never supplies collision, navigation, vision or combat effects. Legacy G1 fixtures keep their original scenery and camera behavior.

The source of game state remains Senritsu → actual Enbu WASM Worker → authorized PresentationReplay → contract adapter → Replay Player → Renderer. Domain results, rules and Jinrei are unchanged. Optional `scene.baseSites` projects immutable public World locations only (id, side, coordinates), with schema rejection of live/private fields. Its map annotation says **State unknown** until an observed base is available; confirmed destruction comes from Replay. It does not draw an intact unseen enemy facility. The current-frame state and confidentiality checks cover this distinction.

Standard observation frames the authored lane/camp network; Overview includes full World bounds; Follow uses current visible positions. Open base courtyards preserve actual anchors without hiding units. Known map locations and transient observed entities remain separate. Own-Squad Follow requires authorized owner data and unambiguous matches to current visible graphics entities; public replay does not infer private membership.

Desktop gives the scene the main workspace. Mobile has Battle / Overview / Follow / Timeline / Details states with replay transport outside the scene and 44px actions. Returning to Battle/Overview closes the roster while preserving Tick, selection and draft. Nearby visible-unit inspection exposes actual identities, roles, HP and native Senritsu coordinates without displacing models or calling a visual group a Squad. The five overlapping Heroes at T50 occupy distinct nearby coordinates; the UI does not falsely describe them as co-located.

Current-Tick cue labels identify actual attack source/target, HP, skill key and defeat/destruction type. Hero deaths and facility destruction outrank routine attacks; selected/tracked events have priority. Mobile shows up to three text cues, desktop up to eight, with a truthful count of remaining in-view events; actual 3D cue geometry remains. An adapter visibility-entry event is **APPEARED**, not an invented public respawn. Event summaries explicitly reset opposing CSS insets so they remain content-sized; exact-event tests also check summary height and rectangle overlap, rather than relying on DOM visibility alone. Paused exact-Tick visibility and adjacent-Tick stale-label checks use real controlled Enbu cases.

## Ownership and integration

Every Luna used a dedicated worktree and branch. [Fixed ownership](BATTLEFIELD-WAVE-OWNERSHIP.md) prevented terrain/UI/test edits from colliding; Sol integrated the shared interfaces and necessary conflict resolution.

| Owner | Delivered scope | Main source commits on Luna branches |
| --- | --- | --- |
| Luna A | Continuous World terrain; exact authored routes; forest-floor regions; camp/glade hierarchy | `7d7f03a`, `9d11a5c`, `55c4b13`, `5ce720f` |
| Luna B | Strategic/Overview/Follow cameras; open bases; role/cue labels; mobile cue hierarchy | `bec42d4`, `71b5d6f`, `8ce90f6`, `056d101`, `ebb6efc` and earlier camera fixes |
| Luna C | Desktop/Mobile console and truthful nearby visible-unit inspector | `1a846ad`, `eb453fc`, `0e4f2fe`, `88f6aba`, `351e18d` |
| Luna D | Independent actual-WASM browser harness, same-input comparisons, base privacy, exact cue/role/cluster checks and visual report | Baseline/capture and focused-verification commits in PR history |
| Sol | Module/API boundaries; public base-site contract; native coordinate labels; Hero-death priority; page integration; current-frame privacy; final verification/push | Target PR branch history |

No frozen PR #4 assets or new Blender production were used. No gameplay/balance tuning, invented routes or new game architecture is included.

## Verification and scoped acceptance

The [evidence index](../evidence/battlefield/README.md) links the exact baseline/current images and browser recordings. Metadata pins the HTML build revision, actual WASM hash, simulation input, owner/public replay and result digests, Tick and viewport. The same actual default match is compared at 1920×1080, 1440×900, 430×932, 390×844 and 320×844. Separate cue/farm inputs run through the canonical core and are explicitly controlled verification setups, not ordinary UI-created matches or balance evidence. Owner-only Hero respawn proof is never presented as a public event.

Local checks include Rust workspace build/tests (103), real WASM build and initial native/WASM goldens, Next native/WASM adapter parity, Replay Contract/Player unit tests (35), TypeScript typecheck and production build, Graphics Playwright (10/10), and final actual-WASM production browser journeys (10/10, 2.2 minutes). Focused current-runtime cue, skill, Monster/Minion and nearby-cluster runs also passed; default/cue/farm c9 comparisons each match all seven canonical identity fields. Final runtime test/capture results and the independent seven criteria are in [BATTLEFIELD-REDESIGN-VERIFICATION.md](BATTLEFIELD-REDESIGN-VERIFICATION.md); final-head hosted CI results are reported after push. Green tests do not establish user Visual/Art acceptance.

| Issue #5 scope | Status / limit |
| --- | --- |
| G1 World topology, confirmed state and privacy | Verified by source projection, canonical identity comparisons and current-frame checks; see independent report. |
| G1 Battlefield visual readability and Pixel 3D | Original seven criteria assessed independently from actual final-runtime images; see independent report. |
| G3 Battlefield Desktop/Mobile observation and replay flow | Browser-verified at five required viewports; selection/Tick/draft/context recovery retained. |
| G4 native/WASM, contract/player, existing graphics and production browser regressions | Checked locally and by current CI; exact final-head result is reported separately. |
| G4 balance; G2 Hero Atelier; other Goal-wide conditions | NOT_CHECKED in this Wave; existing unfinished conditions are not accepted by these changes. |
| Physical mobile/touch/IME, hardware GPU, final user Visual/Art acceptance | NOT_CHECKED. Automated Chromium/SwiftShader runs are not physical-device measurements. |

Implementation, integration, evidence and push are separate from Goal acceptance. PR #3 remains OPEN; Issue #5 remains OPEN; PR #4 stays frozen. No merge or additional Wave follows this report.
