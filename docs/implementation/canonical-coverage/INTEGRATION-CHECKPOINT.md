# Integration checkpoint at main 5c84c85

Observed 2026-10-26 against committed main `5c84c85e4a935dae4881af87eb2b8f607987c786`. This overlay supersedes the historical PR-state statements in this directory. It does not regenerate the [47-document source register](CLAUSE-INDEX.md), whose source baseline remains `9f52dbfa44d8f08ff854116fef7850fbc91e13af`. Its 2,682 source units are not distinct contracts or verified requirements. No exhaustive four-category contract totals, global completion, or release readiness is asserted.

## Integration state

GitHub was queried directly. PR24–PR39 and PR41 are merged. Campaign PR40 remains open under independent review; browser-contract alignment PR42 is open. Merge state records integration, not acceptance of every associated contract. Documentation PR23 is separate. The [current contract matrix](CURRENT-CONTRACT-MATRIX.md) maps selected historical gap rows to their actual implementation, owner, dependency and proof limits.

| PR | Bounded change | GitHub state | Merge commit (or open head) |
| --- | --- | --- | --- |
| [#24](https://github.com/yohn-jp/senkei/pull/24) | fix: preserve Campaign conditions when inspecting Ready | MERGED | `28fc46e7cc62ae3c6ec4ba18281edfea8b1f5fa3` |
| [#25](https://github.com/yohn-jp/senkei/pull/25) | fix: inspect Hero candidates before adopting into Draft | MERGED | `12be77a4a5e2afa9aeee7684b52172a3d660a71f` |
| [#26](https://github.com/yohn-jp/senkei/pull/26) | fix: keep mobile Follow targets below sticky header | MERGED | `9f52dbfa44d8f08ff854116fef7850fbc91e13af` |
| [#27](https://github.com/yohn-jp/senkei/pull/27) | fix: make the final campaign NPC pass formation preflight | MERGED | `81684c0bfa0b4eed96938328eafac96ec90b258d` |
| [#28](https://github.com/yohn-jp/senkei/pull/28) | fix(renderer): make idle unit orientation independent of replay seeks | MERGED | `e79d503d296357b9ab6961ff1a4c623cca683707` |
| [#29](https://github.com/yohn-jp/senkei/pull/29) | fix: review setup differences before restoring a Draft | MERGED | `4695057ba4b50ce867615980e75d29d111b01a94` |
| [#30](https://github.com/yohn-jp/senkei/pull/30) | fix: make all supplied attacker diagnostics reachable | MERGED | `fcf129055aa86a76860573187922d2e7e05933b0` |
| [#31](https://github.com/yohn-jp/senkei/pull/31) | feat(jinrei): emit parser-produced Action source locations | MERGED | `f8a91d49a43b7a1f6402c386b1b000462ce0390e` |
| [#32](https://github.com/yohn-jp/senkei/pull/32) | fix: classify completed run comparisons by full input conditions | MERGED | `5d06d634265cea062ee69d7a6912db355f00d6fe` |
| [#33](https://github.com/yohn-jp/senkei/pull/33) | fix: explain Library retention and truthful export status | MERGED | `3960a8f773b2783bc322fe8f29a5b016cd944482` |
| [#34](https://github.com/yohn-jp/senkei/pull/34) | fix: preserve Library tab keyboard focus after navigation | MERGED | `5de1072bccf84f66e1036af59f2194c0d0092d78` |
| [#35](https://github.com/yohn-jp/senkei/pull/35) | feat: add completion-aware campaign progress producer | MERGED | `97abc6f1a99a410e51937c275f6a176aa134e430` |
| [#36](https://github.com/yohn-jp/senkei/pull/36) | feat(behavior): validate and consume authored cross-capability orders | MERGED | `4b8ca49755abf3c5124973d62d75135395afcf47` |
| [#37](https://github.com/yohn-jp/senkei/pull/37) | feat: preserve Replay analysis context and inspect verified Action source | MERGED | `12a029a6f570079125c9ee6ad0acc14337006eaa` |
| [#38](https://github.com/yohn-jp/senkei/pull/38) | feat: preserve structured preflight repair targets | MERGED | `54011ea0d04cbfbb4400daa065af0681affad3d5` |
| [#39](https://github.com/yohn-jp/senkei/pull/39) | feat(next): derive improved rematches from original run conditions | MERGED; producer only | `5c84c85e4a935dae4881af87eb2b8f607987c786` |
| [#40](https://github.com/yohn-jp/senkei/pull/40) | Live Campaign completion, next/final actions and exact Core slot interoperability | OPEN; independent review | `4d4ada7e13bd26e2aee6c293b43718d39e8daf20` |
| [#41](https://github.com/yohn-jp/senkei/pull/41) | Selected visible workspace tabs retain keyboard focus | MERGED | `f14b003b1902e0496a145b3f36dd32f856c5f668` |
| [#42](https://github.com/yohn-jp/senkei/pull/42) | Align six browser specs with existing restore/analysis flows | OPEN; test-only patch | `b82cbf76d403d4ce9c0dde275baa2f9dca09dd77` |

## CI state

Main [run 40279716616](https://github.com/yohn-jp/senkei/actions/runs/40279716616), at `5c84c85`, was **queued** when queried. The preceding `f14b003` run was cancelled. Neither proves current-main acceptance.

The [54011ea run](https://github.com/yohn-jp/senkei/actions/runs/40275861697) completed with failure. PR39's exact-head [run 40273788585](https://github.com/yohn-jp/senkei/actions/runs/40273788585) passed Rust, real WebAssembly conformance and web/build checks, but journeys-workbench and journeys-ui failed and the aggregate browser smoke failed. Those results are not an all-green claim; the producer has no UI caller in that PR.

The baseline owner has committed PR42's six test-contract alignments and reports 18 affected cases passing against verified main `54011ea` production artifact `12630087483`. This is test alignment evidence, not acceptance of active C04/C10/C14 work or proof that the new combined main CI is green. PR42 and PR40 remain subject to their current-head checks and review. Successful visual automation is not final art or physical-device acceptance.

## Remaining consumer and proof boundaries

| Clause / seam | Actual integrated or active scope | Remaining dependency / owner / proof |
| --- | --- | --- |
| C01/C02/C03/C09 and Library retention | PR24/25/27/29/33 integrate bounded conditions, candidate, NPC, restore-review and retention changes | These are no longer unallocated missing leaves. Broader return-state/device/current-main combined acceptance remains separate |
| C04 repair destination | PR38 structured target producer is merged; optional Hero/Jinrei focus producers are active with `ux_audit` | Ready parent caller remains unwired. Producer fixtures use real Core `8ec4…`; no full product repair/return PASS. Coordinator allocates caller work after producer symbols and file handoff |
| C06/C07 diagnostics and exact source | PR30 supplied-record access, PR31 parser locations and PR37 Replay/analysis/source context are merged | Broader production profile-to-result tracing remains a separate Behavior seam. Existing finite record/source access must not be reclassified as wholly missing |
| C08 three replay/comparison operations | PR32 comparison classifier and PR39 original-context improvement helper are merged | Actual improved-rematch UI is still missing. `source_locations` is available after C10/C14 releases NextWorkspace; exact original context/opponent, Core preflight and real browser return paths must be exercised by that consumer |
| C10 Import / C14 failed-Core export | `presentation_audit` owns active import validation and Core-independent storage/read/export work | Actual red probes found incompatible imported conditions replacing valid storage, and export disabled on Core failure. Branch build passes; actual green browser verification and a committed PR are pending. No acceptance yet |
| C11 Campaign completion and exits | PR35 producer is merged; PR40 UI/persistence/interoperability head `4d4ada7` is open | `progression_audit` authored; `core_audit` independent review active. Author reports 242 unit tests, build, 18 browser cases and separate actual first/final WASM victories with entire native/WASM Snapshot/result equality. Branch evidence does not merge PR40 or certify broad progression |
| C12 tab focus | PR34 Library focus and PR41 generic selected-visible-tab guard are merged | PR41 reproduced eight real browser failures, then passed eight new cases plus four unchanged Library controls at 320/390/430/1440. Ordinary entry/reentry headings remain verified. Broad Back/Sheet/rotation/IME and physical-device proof remain separate |
| BH03 authored ordering | PR36 typed authored domains, strict local/global ordering and fail-closed consumption are merged | Universal static completeness remains **DEFINED and outstanding**. Production profiles, rankings/groups and game-specific mappings remain separately DECISION_REQUIRED; fixture native/WASM resolver proof is not production Enbu execution |
| Progression / presentation | No new broad completion evidence from this documentation update | Defined operations remain in scope. Unaudited acceptance and unauthored game/economic values stay distinct; see the selected current matrix and historical boundary register |

## C13/C14 Recovery quota and same-package Core retry probe

**Specific Draft path: VERIFIED by one real browser regression; suspected Draft-loss bug was not reproduced.** This does not classify all of C13/C14 as verified. In-memory Run preservation is **NOT_CHECKED**. No new production fix is justified by this passing Draft probe.

The isolated source checkout was exactly `54011ea0d04cbfbb4400daa065af0681affad3d5` on `fix/wave8-recovery-retry`. Root and browser `npm ci`, production build and one Chromium regression passed. The test used port 4203, actual worker/Core/WASM responses and no mocked Core success. The compatible source-map WASM was copied from the existing artifact, not rebuilt at this source revision: SHA256 `e15cc7add78827aff1af977fe0be2a5f32ff766142ae4a97dfc67204b9a9bd1a`, 6,677,105 bytes; actual package digest `c045f65b261939c866f7a08c18fe4d0dca24c81a0fdb07a4728f50eeb74e688f`.

The regression established an old valid Recovery, denied only `senkei.next-workspace-recovery.v1` writes with QuotaExceededError, added a unique current-Draft Source marker, observed the Library Recovery error, and clicked the actual Retry Core/Catalog action. It awaited a replacement core worker and loaded Catalog, returned to Text, then compiled successfully using the real Core. The edited Source survived byte-for-byte, the original stored Recovery bytes remained byte-for-byte unchanged, and no page errors occurred. No Enbu match was executed.

The suspected null→same-digest package transition does not occur on this UI path: [App.tsx at 54011ea](https://github.com/yohn-jp/senkei/blob/54011ea0d04cbfbb4400daa065af0681affad3d5/apps/web/src/App.tsx#L18) replaces the Core client without clearing the existing ruleset. [NextWorkspace initialization](https://github.com/yohn-jp/senkei/blob/54011ea0d04cbfbb4400daa065af0681affad3d5/apps/web/src/features/next/NextWorkspace.tsx#L1010) depends on package digest and Recovery-loaded state, which stay unchanged during a successful same-package retry. Although failed autosave leaves its Recovery ref stale, that fact alone does not cause the alleged Draft restore.

Session-local reproducibility artifacts (not portable repository attachments): `/workspace/wt-recovery-retry/tests/browser/specs/recovery-core-quota-retry.spec.ts`; `/workspace/scratch/recovery-retry-evidence/report.json`; before/after screenshots in the same evidence directory; `/workspace/scratch/recovery-retry-browser.log`. Command: `SENKEI_CHROMIUM_EXECUTABLE=/usr/bin/chromium SENKEI_BROWSER_PORT=4203 npm run test:e2e --prefix tests/browser -- specs/recovery-core-quota-retry.spec.ts --workers=1`. Result: 1/1 passed. The untracked regression remains in its isolated checkout for handoff; this PR changes documentation only.
