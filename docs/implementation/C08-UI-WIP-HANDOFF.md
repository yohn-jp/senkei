# C08 rematch UI — incomplete checkpoint

Stopped at the coordinator's explicit session-limit instruction. This branch is **WIP**, not an accepted or integrated C08 implementation.

## Dependencies and ownership

- Started from main `e440066`, then integrated main `fdd6c9c3b4f1fcbc07d6bbe37dad05a11a49eee3`.
- Contains PR46 dependency `811c36482fb334f7148bc073858d51da889a61ae` through a merge. PR46 must be independently reviewed/integrated before this consumer; its presence here is not main integration.
- Worktree: `/workspace/wt-improved-rematch-ui`; branch: `feat/improved-rematch-ui`.
- Changes are BattleAnalysis, NextWorkspace and three browser specs. NextWorkspace ownership is released with this checkpoint; the C04 consumer and S06 parent wiring remain separate pending work.

## Current code

- Three Analysis operations distinguish immutable exact replay, own improvement with original non-target inputs, and current conditions.
- Existing exactRun backing state is generalized to an atomic frozen rematch `{kind,run}`. Existing exact callers remain supported.
- Improvement compiles the current own Draft, calls the merged `buildImprovedRematch`, rejects unsupported/no-target changes, and reuses existing frozen Snapshot preflight/launch. Full original context/opponent and original rival setup are retained.
- Current opponent selection is preserved while frozen Ready displays the original opponent selection. The existing current-Campaign guard now runs only for current-condition preparation.
- Existing browser selectors were aligned with the improvement operation. A new full browser scenario exports actual Runs to compare complete context/opponent, own identity/memory, program changes and Draft preservation.

## Evidence and limits

- Focused existing BattleAnalysis/helper tests: 29 passed before parent wiring.
- After parent wiring: production build/typecheck passed; full unit suite 50 files / 284 tests passed. Logs: `/workspace/scratch/improved-rematch-ui-{build,units,typecheck}.log`.
- A real browser run using genuine existing Enbu export `19c1ebe2e7b8373a255a43310e0166ba1ff3ef250ce5c5425c7288bbe358063d` was started, then deliberately terminated at the session stop instruction. **No browser PASS or new battle completion is claimed.** Log: `/workspace/scratch/improved-rematch-ui-browser.log`; output: `/workspace/scratch/improved-rematch-ui-browser-output`.
- Runtime WASM copied from the PR38 producer artifact, SHA `8ec4c1b4dcb9b5acb6fa59322aa6e8398db72fdd4ed1632af6dcb122326f59ea`. The ignored binary is not committed.
- No review, CI success, main integration, physical-device test or complete C08 acceptance is claimed.

## Required next checks

1. Independently review state/async capture, error destinations and frozen/current condition boundaries, including compatibility with PR40 Campaign actions and the pending C04 capture/repair integration.
2. Review the existing diagnostics checkbox handler: it currently clears frozen mode when changed. Decide an ordinary implementation correction that preserves fixed Snapshot conditions rather than silently selecting current conditions; do not report this path accepted.
3. Finish the new browser regression, then the two existing changed browser specs. Capture actual desktop/mobile improvement, exact/current paths and failure/retry behavior; fix any failure with a bounded cause.
4. Rebase/merge actual accepted dependencies, run the relevant tests on the real combined source, then request review. This Draft PR is a recovery checkpoint only.
