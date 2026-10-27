# Architecture Completion Wave 2

Baseline fetched from main: `216360f91a63a9031bef4ce9332de2ca2a8797a9`. This is a partial delivery checkpoint, not Architecture/Product completion.

## Phase 0: actual integration seams

- `BehaviorResolver::resolve_fields` consumes typed Catalog-bound fields with current composition/Tick checks. Independent winners previously allowed partial multi-field selection; Wave 2 rejects inconsistent or missing winners for a selected action. This is fail-closed validation, not a complete production action-selection algorithm.
- `Enbu::simulate_with_behavior` and `simulate_behavior` Native/WASM/Worker exist, but explicitly reject Next and unsupported target/precondition shapes. Next RulePackage has no authored production Behavior extension, legal-observation candidate producer or six-domain capability mappings. Connecting a new UI consumer cannot supply these.
- CatalogCompatibilityKey, RulePackage and RulePlan bind versions/digests; immutable Snapshot/Reproduction and owner diagnostics retain private inputs separately from public Replay. Wave 2 does not weaken those checks or introduce a new Snapshot schema for equipment/effects.
- NextWorkspace owns Draft/preflight/run UI, while Experiment IndexedDB persistence commits complete validated records. The new equipment database is independent; UI awaits transaction completion before reporting recovery committed.
- `progression/state.ts` is presentation-only. It does not authenticate official ownership. New official evidence cache likewise stores untrusted records; responses require an independently supplied verifier before adoption, and the production verifier/producer remains not configured.
- Actual Next formation references are `{slot_id, catalog_id}`. Neither is a durable Player-owned Hero instance. Equipment assignment accepts an explicit immutable ownership producer; the production app supplies none. Relationship writes similarly default to ownership-unverified. No slot is silently promoted to a Hero asset.

## Delivered code

- `crates/senkei-behavior/src/lib.rs`: reject partial multi-field action selection; regression in `tests/runtime.rs`.
- `apps/web/src/features/equipment/repository.ts`: individual local equipment IDs, approved versioned definition/effect references, atomic assignment/unequip and request history, cross-Player/official rejection, import/export, preservation on failed writes/unsupported stored schemas, immutable asynchronous inputs.
- `apps/web/src/features/progression/official-transactions.ts`: stable identity, submitted/pending/committed/rejected/outcome_unknown, inquiry, evidence verification contract, terminal response conflict rejection and durable compare-and-set evidence cache. It does not issue assets, draw, purchase, or authenticate a cached record.
- `apps/web/src/features/relationships/repository.ts`: Player-scoped directed versioned history, duplicate event rejection, guarded restore, explicit null and decision-required projection. No arbitrary executable formula is accepted. This localStorage adapter is not a complete concurrent progression transaction system and has no live event producer.
- `apps/web/src/features/progression/LocalAssets.tsx` and `next/NextWorkspace.tsx`: actual local inventory read/search/detail and archive export/recovery, separate storage failure/commit status, explicit official not-configured state. No approved definitions are configured in the app, so nonempty unapproved imports are rejected; there is no issuance or functional combat equip UI.

## Canonical decisions

Updated ARCHITECTURE, BEHAVIOR, DOMAIN-CATALOG, RUNTIME-INTEGRATION-CONTRACTS, EQUIPMENT, HERO-RELATIONSHIPS, REWARDS-AND-LIBRA and PROGRESSION-UX. Local/official authority separation, permanent individually owned equipment, six typed declarative Behavior domains, WAIT fallback, atomic Intent commitment and future official transaction boundaries are normative. Runtime support remains separately assessed below.

## Remaining boundaries

- **DECISION_REQUIRED / Phase 1:** author Next domain vocabularies, legal observation/candidate mappings, scoring expressions/weights/thresholds and capability compatibility in versioned Senritsu data. Minimal next input is an approved complete production policy artifact; generic fixture values are not suitable substitutes. WAIT execution and full Army/Squad/Hero/Jinrei conflict/event lineage remain unimplemented.
- **DECISION_REQUIRED / Phases 2–3:** durable Player-owned Hero identity and its producer must be specified. Choose explicitly whether durable relations refer to an owned Hero instance or a Player-scoped Hero kind; neither a formation slot nor a transient battle entity establishes that contract.
- **DEFINED / INCOMPLETE:** frozen equipment/effect and relationship combat projections, Enbu effect application, compile/preflight invalidation and real Hero Detail/graph/formation integration. Approved effect and relationship formula definitions are absent; no combat value is manufactured.
- **Phase 4:** future authority service/verifier remains unavailable, as required. No economic parameters or service infrastructure were introduced. Local evidence persistence is not official settlement.
- **Phase 5:** equipment read/recovery is connected; populated production inventory, explicit Draft equipment adoption, relationship graph and combat previews remain unavailable.
- Graphics G1 and Issue #51 remain outside this Wave. Historical G1 failures do not establish failure of the current integration HEAD.

## Verification ledger

Implementation tree: `b2ec271` (subsequent checkpoint documentation does not change code). Leaf source branches retain focused commits separately on origin.

| Check | Evidence / outcome |
| --- | --- |
| Web baseline before new leaves | PASS: 405 tests / 66 files |
| Integrated Web after owned assignment | PASS on final implementation tree: 425 tests / 69 files; includes 10 equipment tests and real Chromium evidence-store test |
| Typecheck + production build with real rebuilt WASM | PASS; WASM crate rebuilt from integration source, then copied into app public artifact |
| Desktop / Mobile equipment recovery | PASS: 2 Playwright tests at 1440 and 390 px, actual production app / Chromium / IndexedDB, malformed schema rejection followed by recovery |
| Actual Worker / WASM Behavior | PASS: owner isolation and versioned event path, 1 Playwright test. Generic one-field fixture only; six-domain Next acceptance is NOT_CHECKED / unavailable |
| Production data connection | Inventory read/search/export/recovery connected. App approved equipment definitions empty, Hero ownership producer absent. Official producer/verifier not configured. Relationships repository has no live producer or graph consumer |

The first equipment browser attempt used a build before WASM was installed and failed at initial app navigation. It was rerun after actual WASM rebuild and production build; the successful run did not change test deadlines or skip assertions.

Compressed completed command logs and checksum manifest: [evidence](../../evidence/wave2-2026-10-27/). Pending commands are not recorded as PASS.
