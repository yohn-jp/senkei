# C10/C14 experiment import and recovery assessment

Assessment baseline: web source `4b8ca49` in isolated `/workspace/wt-import-validation`, branch `fix/wave7-experiment-import`. The assessment below retains the original reproduced failures; the implementation checkpoint at the end records the subsequent repair.

## Canonical boundaries read

`UX-INTERACTION-CONTRACTS.md` C10 requires import validation before replacing existing saved data, distinguishes compatibility from format/size, and preserves completed records and Draft on bad import. C14 and the entry/readiness contract preserve available export/recovery when Core fails. `parseNextExperimentStore` in `features/persistence/repository.ts` checks bounded JSON/store shape and basic immutable match IDs. It does not validate current RulePackage/World, authorization, Replay result digest or runtime versions. Those additional checks already exist in the NextWorkspace experiment restoration effect and `experiment-restoration.ts`.

## Actual input and environment

- Genuine saved Enbu export: `/workspace/wt-tactical-context/test-results/tactical-real-experiments.json`.
- SHA-256: `19c1ebe2e7b8373a255a43310e0166ba1ff3ef250ce5c5425c7288bbe358063d`; 46,594,491 bytes; **one** actual completed Run. No synthetic second Run or newly executed Enbu was used.
- Actual Run ID: `next-650a44b8fd7ea340c94a175c35b11ff0-374dd770-15d8-444c-9543-ec9820b4e885`.
- Actual result digest: `d467faff366c1ed016679a0b4a52e04a3dc589669c7f51c26dc0aa6d9c3e6afa`.
- Fault injection: change only paired World `presentation_digest` to 64 zeroes in all three identity copies: snapshot context, public Replay, attacker Owner Replay. All copies agree with each other, retain the real battle inputs/results/events, and are incompatible with the loaded current World. This is a deliberate invalid import, not combat evidence.
- Fault file: `/workspace/scratch/tactical-wrong-world-paired.json`; observed variant hash is recorded in `/workspace/scratch/experiment-import-observed.json`.
- Real local `npm ci` (131 packages) and production build/typecheck passed. No shared node_modules symlink. Chromium `/usr/bin/chromium`, SwiftShader, service workers blocked, own preview port 4202.
- Runtime WASM copied from `/workspace/wt-preflight-producer/apps/web/public/wasm/senkei_wasm.wasm`, built for producer `5e8ef64`; SHA-256 `8ec4c1b4dcb9b5acb6fa59322aa6e8398db72fdd4ed1632af6dcb122326f59ea`. Its RulePackage digest matches the real export (`c045f65b…`). This assessment does not claim exact-4b8 WASM provenance; no battle is executed. Operations are startup catalog/identity calls and actual stored-data import/restore/export UI.

## Confirmed C10 defect

Actual Library flow: import genuine export → wait until Open latest comparison is enabled → open actual Analysis/result → return Library → choose incompatible file → confirm Validate and import.

Observed:

- IndexedDB store SHA before import: `1735c88c6b9d50434935e7c741d86af5c10c674311f88ce104e473fee264a7e9`.
- IndexedDB store SHA after incompatible import: `6efe31673e53db308531233ede18a3393a78360ce0a957bf4d964d0253e0d8a7`.
- Stored snapshot World presentation digest is now the injected 64 zeroes.
- Library then reports `World identity or paired World projection does not match the current package`; Open latest comparison is disabled.
- The old in-memory Run remains reachable through Next → Analysis with the same result digest, and current Draft/recovery JSON is unchanged. **The reproduced loss is replacement of the valid persisted experiment, not destruction of the current in-memory Run or Draft.** Reload cannot restore that valid original from the now-replaced store.
- The reproduction uses one real record. The same persistence operation replaces the whole bounded store, but no actual two-record preservation claim is made here.

Cause: `onImportExperiments` calls format-only `parseNextExperimentStore`, then queues `saveNextExperimentStore(imported)`, then causes the separate restore effect to perform semantic checks. A semantic rejection happens after the existing database payload is already replaced.

Meaningful RED assertion: saved payload identity before/after must match on rejected compatibility import. It fails with the two SHA values above. Enhanced paired-identity reproduction also verifies unchanged current Draft and in-memory result digest.

## Confirmed C14 defect

Actual Library flow: import genuine export and verify successful restore → abort `/wasm/` requests → reload → enter Library.

Observed:

- IndexedDB before/after remains byte-identical: `1735c88c…`, 46,594,491 bytes; actual Run ID intact.
- Core error is visible. Library shows Checking local experiment storage and disables Export experiments despite readable stored bytes.
- The storage restoration effect returns at `if (!core || !packageValue?.next) return` before `loadNextExperimentStore`; `experimentStore` stays null after reload, so no export is exposed.

Meaningful RED assertion: export existing experiments remains enabled with Core unavailable when IndexedDB is readable. It fails on the disabled actual button. This is an export accessibility defect, not storage corruption.

## Evidence and reproduction

New repro only: `tests/browser/specs/experiment-import-safety.spec.ts`. Default artifact paths refer to the actual files above and can be overridden by `SENKEI_REAL_EXPERIMENT_ARTIFACT` / `SENKEI_INCOMPATIBLE_EXPERIMENT_ARTIFACT`. Tests intentionally assert the required preservation/recovery behavior and are RED at the assessment baseline; they are not claimed passing.

Run:

```sh
SENKEI_BROWSER_PORT=4202 SENKEI_CHROMIUM_EXECUTABLE=/usr/bin/chromium SENKEI_BROWSER_EXTERNAL_PREVIEW=1 ./node_modules/.bin/playwright test --config tests/browser/playwright.config.ts tests/browser/specs/experiment-import-safety.spec.ts --workers=1 --retries=0
```

Evidence: `/workspace/scratch/experiment-import-observed.json`, `/workspace/scratch/experiment-core-unavailable-observed.json`; screenshots in this worktree's `test-results/experiment-wrong-world-import.png` and `test-results/experiment-core-unavailable-export.png`. The latest paired-import failure trace/error is under `tests/browser/test-results/`; the Core-unavailable numeric result and screenshot are retained separately above (a later focused run replaced its Playwright output directory). The initial harness attempted a wrong file-input label and timed out; it was corrected before the real RED assertions above. That harness error is not defect evidence.

## Bounded implementation plan (ownership handoff required)

1. Extract the **existing** restoration validation/construction into one reusable asynchronous helper used by cold restore and import. Reuse current setup parsing, RulePackage and paired World checks, match identity, `validateNextExperimentAuthorization`, `validateNextExperimentReplay`, runtime version probe, and `presentationToGraphics`; do not add a storage/provider/history scheme or resimulate Enbu.
2. Import must complete those checks before any persistence or state replacement. Keep the old store, loaded status, current Run, comparison baseline and Draft intact on validation failure/Core unavailability. Use the existing queued write/generation protections and recheck captured runtime/input identity before committing an async result.
3. Read existing bounded experiment storage independently of Core/package availability so it can be exported. Separate storage-read completion from semantic compatibility/openability; do not claim a runtime-compatible result before validation. Guard list metadata extraction so malformed or incompatible payloads cannot crash Library while export/recovery is offered.
4. After validation and successful queued persistence, publish the prepared new store/Run/baseline atomically; avoid the current write-then-discover-rejection flow. Keep current editable Draft unchanged.
5. Turn the two real-browser RED cases green; cover malformed JSON, wrong ruleset/World/runtime versions, unauthorized owner data and result-digest mismatch using targeted existing helper tests. Verify stale async import cannot replace newer user state and storage failure preserves old state. Reuse the genuine artifact; no fresh battle needed for these boundary checks.

Expected scope: roughly 250–500 production/test lines, bounded below 1,000 changed lines, primarily NextWorkspace validation/lifecycle plus a small shared helper and tests. NextLibrary may need explicit storage-read vs openability status. No production files are edited until the coordinator transfers ownership from Campaign work.


## Implemented repair checkpoint

Branch base: `26c5409` (includes actual main `f14b003`). The bounded change adds no game rules, storage provider or history format.

- `prepareNextExperimentStore` reuses the existing restoration checks before any import write. It validates all available public/attacker replay identity bindings, authorization, current package/paired World, result SHA binding, runtime versions and actual Core preflight of the immutable Snapshot/programs. It constructs the replay only after validation, without executing a battle.
- The import captures the runtime and completed-record generation, validates first, rechecks before the queued atomic IndexedDB write, and publishes the new store/Run only after successful persistence. Rejection and quota failure preserve the original stored records, current Run, comparison and editable Draft.
- Storage reads and Export are independent of Core. Bounded JSON with an unsupported storage schema remains available as preserved raw JSON; it is not represented as compatible or openable. Existing raw fields and bytes are retained through compact JSON export.
- Library distinguishes storage-read completion from runtime compatibility. Summary metadata is guarded while failed/unverified records are displayed; the import confirmation states the actual validation/persistence boundary.

Verification on the modified branch:

- Full JavaScript unit suite: 48 files / 256 tests PASS, including 9 semantic-preparation cases (World/package/replay/version/authorization/setup/Core-program rejection and owner/public pairing).
- TypeScript and production build PASS; only the pre-existing large-chunk advisory remains.
- Four real-browser boundary cases PASS: incompatible paired-World import preservation; exact-byte Export after Core failure; quota-denied replacement preserving stored/current data at390px; unsupported-schema raw Export after Core failure. The first two replace the actual RED cases above.
- The final owner/public pairing addition has a separate final-build focused rerun. Existing restore-review and Library keyboard regressions are recorded separately in the PR validation.
- Browser checks use the genuine exported Enbu artifact above with actual local Core calls, Chromium/SwiftShader and production preview4202. They do not execute a new battle or prove physical touch/IME/GPU quality.
- The committed browser suite has no skipped cases or absolute workspace artifact dependency. Without an explicit artifact override it produces a genuine Quick Enbu export through the actual UI once, then injects compatibility/storage faults. This fresh-generation branch awaits CI; local focused checks reused the stated genuine artifact.

Evidence logs: `/workspace/scratch/import-validation-final-all-unit.log`, `import-validation-final-build.log`, `import-safety-final.log`, `import-safety-paired-final.log`, `import-library-regression.log`. Original RED evidence remains identified above. PR CI and integrated-main acceptance must be assessed independently.
