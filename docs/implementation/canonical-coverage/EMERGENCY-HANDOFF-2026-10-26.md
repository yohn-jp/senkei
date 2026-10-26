# Emergency preservation checkpoint — 2026-10-26

The user requested stopping implementation and committing/pushing all work after reporting an execution limit. This checkpoint supersedes older descriptions of workers as active. All workers stopped. No automatic continuation is scheduled or claimed. **The Goal remains incomplete.**

Original main: `1a86f41c47a974dff5e4a4d4edb8b37fbe481207`.
Checkpoint main: `fdd6c9c3b4f1fcbc07d6bbe37dad05a11a49eee3`.
Main CI [40294507952](https://github.com/yohn-jp/senkei/actions/runs/40294507952) was queued, not PASS. Prior `5c84c85` CI failed known browser assumptions; PR42 is merged but new-main success is unverified.

## Pushed work

| Work | Remote ref | Head | Actual state |
| --- | --- | --- | --- |
| Canonical coverage and handoff | [PR23](https://github.com/yohn-jp/senkei/pull/23), chore/wave1-coverage | This branch | 47 documents / 2,682 source units. These are not unique implemented-contract counts; global remaining count undetermined |
| Campaign live completion | [PR40](https://github.com/yohn-jp/senkei/pull/40) | `9df16f0aedae917067ec06c427cb9333a4d645e5` | **Do not merge:** actual quota-denied win followed by same-package Core retry loses unsaved completion. RED evidence, unrun regression and repair proposal committed. New CI cwd repairs: two focused passes |
| Hero/Jinrei repair focus producer | [PR45](https://github.com/yohn-jp/senkei/pull/45) | `7c7801ec8a3990437ba616784b0707b8cf1eeeeb` | Unmerged. Real U+FEFF opaque-slot review defect fixed; five focused tests, two actual-Core component browser checks and build pass. Ready caller unwired |
| Import guards / failed-Core raw export | [PR46](https://github.com/yohn-jp/senkei/pull/46) | `811c36482fb334f7148bc073858d51da889a61ae` | Unmerged, independent review needed. 256 units/build, actual boundary and Library regressions pass. Public helper: loadNextExperimentPayload; semantic/Core preflight validation before storage write |
| Skill Tree runtime context consumer | [PR47](https://github.com/yohn-jp/senkei/pull/47) | `4f0cd8c2c7642b46f97824a07514701a4ea15c14` | Unmerged, depends PR45. 17 focused checks/build and two actual-Core component browsers pass. Parent HeroAtelierRunContext prop unwired |
| Three rematch operations | [Draft PR48](https://github.com/yohn-jp/senkei/pull/48) | `a57f4ee5cc0023f23c7e50cd507b4e6531eed2cc` | **WIP**, includes PR46 merge and partial parent wiring. 284 units/build pass; browser interrupted, not PASS. Diagnostics checkbox still clears frozen mode. Read docs/implementation/C08-UI-WIP-HANDOFF.md |
| Mobile replay controls | fix/mobile-battle-controls | `c780293` | **WIP**, unmerged. CSS, five-width before/working-after captures and probe scripts pushed. Genuine export restored, no fresh Enbu or final art/device claim |
| Recovery quota/Core retry probe | fix/wave8-recovery-retry | `715aca51fce1342b438ce15c291fe71d513189b0` | WIP probe/report pushed. Specific Draft path passed at54011; no current-main/Run preservation claim. Local evidence paths require cleanup before merge |

PR39, PR41, PR42 and PR43 are merged. PR42's 18 affected checks passed against hash-verified main54011 CI artifact, not checkpoint-main. PR43's development-only component spec was separated from ordinary production journeys and its cwd paths fixed before merge. Art PR44 is separate work, observed but not reviewed or modified here.

## Resume order and ownership

All workers released files. Fetch main/open PR heads and establish one owner per canonical file before resuming.

1. Independently review PR46 import/storage guards and PR45 exact focus; integrate verified changes normally.
2. Fix PR40's reproduced unsaved Campaign/Core retry loss before merging. Its committed CAMPAIGN-PR40-REVIEW.md and docs/evidence/campaign-review contain the precise actual RED evidence and minimal repair proposal. Preserve malformed-raw protections.
3. Allocate one NextWorkspace/JourneyScreens writer. Complete C04 using merged PR38 structured targets and PR45 focus requests. Capture exact input key/stage/side/slot/source; reject stale repair requests. Never guess identities from messages. Provide explicit revalidation.
4. Review/integrate PR47 and pass immutable authorized Run/Match/Tick/slot context into HeroAtelier. Public/unmatched records remain unavailable.
5. Complete Draft PR48 frozen exact/improved/current-conditions lifecycle and noted invalidation seam; preserve all original nonTargets, current Draft and opponent selection. Run actual desktop/mobile Enbu and return-path acceptance.
6. Finish mobile WIP exact-head checks. Verify actual combined main, native/WASM regressions and CI. Pending/cancelled runs remain not PASS.

PR47 includes an older PR45 ancestor; PR48 includes PR46. Avoid duplicate cherry-picks. Pushed integration backups: autonomous-wave2 `47cebda`, autonomous-wave3 `95a65d1`, wave1 `89d3799`. recovery/skill-consumer-workdir-merge is an accidental local-merge backup, not authority.

## Evidence and remaining work

Full immutable Enbu exports/native proofs and actual 8ec4 WASM are gzip-preserved in [artifact manifest](session-checkpoint-20261026/artifact-manifest.json), with original byte counts and SHA-256. Gunzip reconstructs exact originals. Small audit/probe records are beside them. Dependency trees, Cargo caches and replaceable builds are excluded.

Still outstanding: DEFINED universal static Behavior conflict completeness; separate unauthored production Behavior policies; parent wiring above; exact-main acceptance; broader Back/IME/mobile/visual checks and physical-device/GPU proof. Equipment/economy/relationship formulas/content and online authority remain separately undefined. Do not invent values or infer Goal completion from source-unit registration.

No PR was merged just to preserve it. No full checkpoint-main PASS or unattended continuation is claimed.
