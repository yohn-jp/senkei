# PR40 review checkpoint — open data-loss defect

PR40 must not merge yet. Product source assessed: `4d4ada7e13bd26e2aee6c293b43718d39e8daf20`. Test-path repair: `d9db8a83d54861da845ee115376cc7361ef5a8e4`.

## Confirmed failure

A real first-march frozen WASM rematch won at Tick 447. Blocking only v2 Campaign `localStorage.setItem` produced the intended save error while preserving the session's clear and immediate successor unlock. After storage capacity recovered, Library → Recovery → Retry Core / Catalog loaded the same package. The displayed records changed from `攻略記録 1 / 6 · 解放 2` to `攻略記録 0 / 6 · 解放 1`. Durable original bytes stayed unchanged and no page error occurred.

This loses the session's confirmed, unsaved progress during ordinary recovery. UX C11 completion records and C13/C14 state-preserving recovery remain incomplete. The read effect in `NextWorkspace.tsx` depends on `campaignScenarioIds`, recreated with the newly returned same-digest package, and unconditionally replaces the current progress with older durable progress. Its existing generation guard prevents stale writes but does not preserve newer in-memory progress.

[Executed RED evidence](../evidence/campaign-review/quota-retry-red.json) records the actual displayed counts, unchanged stored bytes, build SHA and WASM URLs. [Before retry](../evidence/campaign-review/before-retry.png) and [after retry](../evidence/campaign-review/after-retry.png) were captured from that run. The exact product build used its existing WASM `e15cc7add78827aff1af977fe0be2a5f32ff766142ae4a97dfc67204b9a9bd1a`. This is software-rendered Chromium evidence, not physical-device verification.

`tests/browser/specs/campaign-quota-retry.spec.ts` is a newly prepared regression for the same real native-fixture → actual WASM win → quota failure → same-package Core retry → explicit progress-save recovery path. **That new spec has not been run.** The separate scratch browser probe above supplies the executed RED proof. No product repair or GREEN acceptance is claimed.

## Bounded repair proposal, not implemented

1. Track the last acknowledged Campaign progress representation after a successful read/baseline initialization and successful save. A newer validated session state that differs from that representation remains unsaved even when a previous error already blocks writes.
2. Continue reading and validating original raw bytes on same-package Core retry. Preserve unsaved same-ruleset progress instead of replacing it with an older stored state. Keep the existing generation guard and read-error write block.
3. If valid stored history also contains different known records, preserve both validated histories: union their already-known completed/unlocked IDs in canonical scenario order and conservatively retain `history_incomplete`. This invents no completion, unlock, reward, or game value. Add focused tests for same-digest preservation, valid-history preservation, malformed-read blocking and successful save acknowledgement.
4. Run the prepared real browser regression, existing malformed/same-digest read guards and migration/quota checks. Merge only after review and combined-main verification. `NextWorkspace.tsx` ownership must first transfer from the active Import repair owner; no conflicting production edit was started here.

## Completed test-path repair

PR40's new helpers/specs used `process.cwd()` for SSR roots and a relative WASM path. Under the actual CI command, `npm run test:e2e --prefix tests/browser`, the Starter test failed with `ENOENT` for `tests/browser/apps/web/public/wasm/senkei_wasm.wasm`. The five-file repair derives one repository root from `import.meta.url` and reuses it for those WASM/SSR reads. No skips, exclusions, timeouts or product behavior changed.

Executed after repair in the actual npm-prefix cwd:

- Starter opaque-ID source parsing/compilation: **1 PASS**, 2.8 seconds.
- Actual Core authored-Campaign association and custom-opponent/context rejection using the existing genuine native proof: **1 PASS**, 4.6 seconds.

The prior Campaign/native/WASM proofs remain separately scoped. Full current-head CI, the prepared quota regression, the production repair and integrated-main acceptance remain unfinished.
