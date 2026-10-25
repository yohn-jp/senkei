# UX Completion Session 2

Base: `b37a52675e5e9aa4d6ee2cf32e206fe1127d2c3a` (latest main at session start).

Four independent workers used branches/worktrees for Hero Atelier, Jinrei/Coverage,
Analysis, and Library/Recovery. The coordinator alone connected App, NextWorkspace,
shared Draft/navigation and execution state. No Rust rules, Jinrei grammar, Enbu
semantics, battlefield topology, renderer geometry, Legacy IndexedDB format or
existing Next storage key/format was changed.

## Screen acceptance

“Verified” below refers to the available production UX and the concrete operations
listed, not an assertion that missing domain producers now exist.

| Screen | Delivered and verified operation |
| --- | --- |
| S00 | Actual Core/WASM/package load; failed WASM request → Recovery → fresh Worker retry. A browser that blocks Service Worker registration reaches local play instead of waiting indefinitely for optional caching. |
| S01 | Quick/Custom/Continue share the existing current Draft. Mobile secondary entry is an explicit disclosure. |
| S02 | Actual bundled package/map and fixed existing opponent; no new NPC or scenario. |
| S03 | Existing five-Hero preset review and current-Draft entry to Ready. |
| S04 | Catalog selection/filtering, shared five slots, Hero replacement impact. |
| S05 | Separate Catalog identity/stat/growth/skill detail and existing live Hero model preview. |
| S06 | Shared Hero selection, real branch acquisition plans, prerequisite and capability rejection, keyboard screen navigation. Planned skills are not reported as acquired. |
| S07 | All seven partitions; membership and shared-node editing/repair. Mobile uses Split → Assign → Start nodes. Real Enbu rejects inconsistent nodes. |
| S08 | First active visit uses the existing Core parser to open No-code. Text/No-code use the existing formatter/parser and one Draft. Catalog scope/search/completion uses the current Catalog. Source changes expire compilation. Compiler `source@` UTF-8 locations select the matching UTF-16 textarea location. |
| S09 | Dedicated Hero/Squad/Army Coverage, defaults, Explicit/Effective/Observed differences and return to editing. **Proof/observed behavior remains blocked at the producer boundary below.** |
| S10 | Existing actual Compiler/Enbu preflight; repair routes and stale/invalid/current distinction. Restore requires fresh compile/preflight. |
| S11 | Existing real Enbu path consumes the validated immutable Snapshot and retains inputs on failure. |
| S12 | Existing authorized owner/public Replay, playback/seek/camera and renderer retry at the retained Tick. |
| S13 | Actual result, immutable run roster, Hero/Squad/event filters, paged event timeline, event → exact Replay Tick, attacker-only diagnostics, previous/current Snapshot comparison and edit routes. A real exact rematch preserves both the Snapshot/result digest and a separate pending, uncompiled Draft. |
| S14 | Unified entry to pinned Next setup, Recovery copy and Legacy. Save/select/restore, JSON export/import, current-package compatibility gating and separate pinned/recovery copies survive reload. |
| S15 | Corrupt original bytes export unchanged; incompatible data refuses restore; replacement/clear require explicit confirmation. Quota failure keeps Draft exportable; storage and Core retries preserve editing state. |
| S16 | Actual existing Legacy Library and G1 sample navigation; return to Next retains the recovered Draft. No implicit conversion between storage formats. |

## Integration guarantees

- The shared parent owns slots, selected Hero, Draft, current compilation and screen
  state. Editing components stay mounted through normal screen/Library transitions.
  Desktop and Mobile use the same data, with task-specific mobile controls.
- Catalog-bound compile results are accepted only for their original current Draft,
  slots and Catalog stamp. Restoring/importing expires the old compile/readiness.
- Exact rematch re-preflights the completed Run's actual Snapshot and submits it via
  the existing launch path. Revised rematch validates the current Draft. Neither
  replaces a pending Draft with the old Run.
- Saved Ruleset identity uses ID/version/digest values, independent of JSON property
  order. Schema/mechanics, real Hero/Skill/Node references and draft identity are
  checked. The existing v1 file does not record a separate historical Catalog/World
  stamp; restoring therefore requires the **current** verified Catalog compile and
  package-bound Enbu/world preflight. No historical Catalog equivalence is invented.
- Legacy IndexedDB and the two existing Next LocalStorage keys remain separate.
  Unreadable/incompatible pinned data is never silently overwritten. Raw bytes can
  be exported before explicit replacement or deletion.

## Producer blocker: S09 behavior proof and Observed comparison

The current Catalog provides authored default metadata. The current compiler result
provides a Program, CU estimate and diagnostics; it does not provide a binding from
Jinrei actions to Behavior Profile fields/scopes, a resolved inheritance/composition
result, or proof across behavior state classes. The editor's coverage producer
(`packages/jinrei-editor/src/editor.ts`) still reports Not Proven.

Enbu supplies real attacker `RestrictedDiagnostics` to S13 (including available
state/intent/CU records). Those records are **not** a Behavior Profile value
Observation keyed by field/scope/Catalog identity. No such authorized adapter is
connected to S09. Consequently S09 displays Explicit/Effective as Not Proven and
Observed as NOT_CHECKED. Unknown values are never changed to zero/false, and
undeclared defaults are never reported as applied. This boundary remains an
external producer blocker, rather than a passing proof/Observed acceptance claim.

## Verification and evidence

- TypeScript/build, Vitest: **19 files / 101 tests passed**.
- Full `cargo test --workspace --release --locked`: passed.
- Production WASM rebuilt; generated Replay types unchanged.
- Conformance fixture check and native/WASM adapter comparisons: passed.
- `scripts/balance/run-next.sh`: all seven native/WASM Next comparisons passed.
- Graphics G1: **12/12 passed**, including WebGL loss/retry and narrow layouts.
- Real Chromium Quick → preflight → Enbu → Replay: all five requested widths passed.
- Hero Atelier: all five widths passed with live WebGL preview, membership/node
  changes, keyboard and mobile staged controls.
- Custom/Coverage/Library/restore/reload/Legacy/G1: all five widths passed.
- Corrupt/incompatible import, quota/export/retry, Worker failure/retry and blocked
  Service Worker + actual failed WASM loading/retry: passed.
- Real analysis/revised match/exact match: passed; exact Snapshot identity, result
  digest equality and the separate pending Draft are asserted.
- Legacy app navigation, real offline IndexedDB/PvE loop and seven-case Worker
  benchmark: **3/3 passed**.

Screenshots and successful per-viewport operation reports are in
[the evidence index](evidence/ux-session-2/README.md). Local captures are production
builds made during this session; CI rebuilds the pushed HEAD and records its exact
revision and artifact checksums. Final HEAD check results belong to the delivery
report and GitHub Actions, not to an assumed passing state in this document.

Baseline `b37a526` CI finished with actual failures in its workbench wait and the
five-minute mobile verification capture budget. The latter budget is now proportional
to selected viewport count, preserving all assertions. The workbench test waits for
actual Enbu completion/result before checking the next-launch control. No screenshot
assertion, visibility boundary or required viewport was removed.

Reproduce with a free dedicated preview port:

```sh
bash scripts/wasm/build.sh
npm run build
SENKEI_BROWSER_PORT=4327 SENKEI_UX_EVIDENCE_DIR=/tmp/senkei-ux2 bash tests/browser/run-nix.sh specs/hero-atelier.spec.ts specs/ux-completion.spec.ts --workers=1
SENKEI_BROWSER_PORT=4329 SENKEI_UX_EVIDENCE_DIR=/tmp/senkei-ux2-battle bash tests/browser/run-nix.sh specs/first-run-journey.spec.ts specs/battle-analysis.spec.ts specs/next-workbench.spec.ts --workers=1
```

Browser verification uses Chromium touch/viewport emulation and SwiftShader. It does
not measure a physical mobile keyboard, hardware GPU performance or certify the
separate art/balance acceptance gates.
