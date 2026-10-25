# Jinrei Editor Foundation

This package provides a standalone Catalog client, source-editor session model, compiler bridge, and small accessible view. It is a consumer of the merged Senritsu Domain Catalog and Jinrei v0.1 compiler contracts. It does not change Jinrei syntax or connect to the Enbu Tick loop.

## Public TypeScript API

`@senkei/jinrei-editor` exports the typed Catalog contract from `src/catalog.ts`, model operations from `src/editor.ts`, and the optional DOM view from `src/view.ts`.

`loadDomainCatalog(canonicalJson, expectedPackage)` consumes the exact output of `DomainCatalog::canonical_json()`. It checks the schema-major version, RulePackage ID/version/content digest, typed Catalog shapes, Behavior Profile metadata and values, and the Catalog content digest. Its digest projection follows Senritsu's private `CatalogDigestMaterial` field order and snake-case names. The public Catalog fields are camel-case. The client scans raw root JSON value spans and copies their bytes into the Rust digest projection, so it does not change nested BTreeMap order, integer-like keys, or Serde's UTF-8 representation by parsing and reserializing them.

`CatalogStamp` carries the complete `CatalogIdentity`, `catalogDigest`, and optional `metadataExtensionDigest`. Comparison canonicalizes identity object keys before checking every identity field; it does not rely on struct/map serialization order. Compile requests and responses carry this stamp and a source revision. The client discards replies for a different catalog or draft revision.

The TS interfaces mirror the public Serialize-only Rust contract and validate it at the boundary. They do not replace the Producer schema. Additive capability metadata such as `behaviorOverrideArguments` is retained and checked when present; it can be absent on current `main` Catalogs. Unknown nested capability keys are preserved, while unknown top-level Catalog keys fail closed because the digest projection requires a known schema.

The editor model provides:

- Catalog-backed constants, observations, collections and visible fields, capability signatures, and Behavior Profile fields and named presets.
- Scope-filtered search, completion candidates and hover details. Completion proposes Catalog names only; the Jinrei compiler remains the authority for syntax and type diagnostics.
- Capability argument types, actor/target scope, precondition count, lifetime, active phases, profile argument mappings, and the numeric CU schedule amount.
- Army, Squad, Hero and lane-limited Minion selection. Package-entity entries are offered only when a caller supplies the exact matching package entity type. A runtime Hero ID and a Hero Catalog ID remain separate values.
- Senritsu default and exact Hero Catalog default values when available. Effective remains `not_proven` without resolved runtime preference layers. Observed remains `NOT_CHECKED` until an authorized, identity-matched upstream observation envelope is supplied.
- A coverage table whose static status remains `not_proven`; it does not turn schema presence into behavior proof or invent an Enbu decision trace.

For Observed data, a missing envelope yields `NOT_CHECKED`, a supplied Unknown sample remains `UNKNOWN`, and internal or unauthorized owner-sensitive fields return `PERMISSION_DENIED`. The caller must only create an envelope from an authorized Enbu adapter. The foundation does not authenticate that adapter or provide trace transport.

## Rust producer and compiler bridge

`crates/senkei-editor-adapter` is a narrow JSON bridge. `next_catalog_json()` validates the bundled `senkei.next` RulePackage and calls `DomainCatalog::from_verified_plan()`. `compile_next_json()` verifies the supplied full Catalog stamp and calls the existing `jinrei::compile` v0.1 implementation. The bridge returns the existing compiler's AST/program, CU estimate and diagnostics, or its typed error. No second parser is present.

The checked-in `next-domain-catalog.json`, `next-compile-reply.json` and `next-compile-rejected.json` fixtures are generated with the Producer and compiler bridge examples. Rust tests compare the emitted bytes against those fixtures and independently reconstruct the Producer's digest material from its public accessors. `next-domain-catalog-with-profile.json` is also emitted by the real Producer using `from_verified_plan_with_extension()` and a test-only authored extension; it exercises typed fields, values and preset metadata without adding a default profile to the bundled RulePackage.

## DOM view

`mountJinreiEditor()` mounts a small independent source, Catalog, coverage and Observed view. It accepts an already loaded Catalog and a compiler gateway, so a later application can connect it without modifying the current web workspace or Renderer. Draft edits clear old diagnostics immediately. Call `refresh()` after changing the exposed `EditorSession` directly; browser-owned input events update the view themselves. `dispose()` removes listeners and the mounted markup.

This is a foundation view, not the completed desktop/mobile Editor or an Enbu trace viewer.

## Verification

From the repository root:

```sh
npm run typecheck
npm test -- packages/jinrei-editor/editor.test.ts
npm run test:browser --workspace @senkei/jinrei-editor
cargo test --locked -p senkei-editor-adapter
cargo check --workspace --locked
```

The browser harness serves only the isolated package and exercises source editing/diagnostic reset, Catalog search and selection, actor scope changes, Coverage, and Observed. The Rust and TypeScript tests also cover malformed typed data, RulePackage/digest mismatch, additive capability metadata, raw digest reproducibility, compiler diagnostics, Unknown versus Permission Denied, and stale compile results.
