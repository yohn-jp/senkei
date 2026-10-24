# Browser application and Worker contract

This document fixes the browser-side public contract for Phase C and Phase D. The browser owns editing, presentation, local persistence, and scheduling. The Rust core owns Jinrei compilation, Enbu transitions, results, and replay events. The browser does not calculate battle outcomes.

## Local execution boundary

```text
React feature components
        │ typed props from apps/web/src/contracts
        ▼
CoreClient (request/reply, request IDs, protocol v1)
        │ Web Worker messages
        ▼
Web Worker adapter
        │ versioned JSON envelope
        ▼
Rust/WASM Jinrei + Enbu core
```

All PvE work stays in the browser. The feature components call `CoreClient`; they do not import the WASM module or mutate core objects. The Worker serializes each operation, transfers only JSON-compatible values, and returns a response correlated by `request_id`. UI rendering consumes immutable output values. No browser clock, random source, network request, or UI timing enters the battle input or logical CU.

The web protocol version (`WEB_WORKER_PROTOCOL_VERSION`, currently `1`) is independent of the Rust API version (`api_version: { major, minor, patch }`). Unsupported versions and malformed messages become explicit errors. A request ID is unique for each in-flight request in one Worker client. Worker requests are completed or rejected; the client rejects pending requests if the Worker terminates.

## Operations

The shared client signature is `CoreClient` in `apps/web/src/contracts/core.ts`:

```ts
initialRuleset(): Promise<RulePackage>
compile(input: TacticalInput): Promise<CompileOutcome>
simulate(
  snapshot: SimulationSnapshot,
  options?: { include_diagnostics?: boolean },
): Promise<SimulationResponse>
benchmark(cases: readonly BenchmarkCase[]): Promise<BenchmarkOutcome>
dispose(): void
```

- `initialRuleset` invokes the core `initial_ruleset` operation with `{}` and supplies the validated `RulePackage`. The editor builds configuration controls from `result.domain.senkei_configuration` and `result.world.entity_types`.
- `compile` accepts `{ kind: "text", ruleset_ref, source }` or `{ kind: "structured_ast", ruleset_ref, ast }`. Both editing surfaces compile to a Jinrei `TacticalProgram` using the same core compiler and Senritsu schema. `ast` is the versioned `StructuredTacticsAst`; its own `schema_version` is authoritative. The outcome has `program`, `estimated_cu`, and `diagnostics`. `estimated_cu` is a non-negative safe integer in the supported Senritsu package.
- `simulate` accepts one complete typed Enbu input snapshot. It contains attacker and defender `SenkeiSnapshot`s and immutable `MatchContext` in the Rust DTO form. It does not accept live UI state or a mutable world object. The worker maps core output into `SimulationResponse`: public `result` and `presentation_replay` are grouped in `outcome`; optional `restricted_diagnostics` remains a separate, local-only field and is requested only by explicit local debugging UI.
- `benchmark` accepts an ordered list of `{ case_id, snapshot }` cases. The Worker runs them sequentially through the same `simulate` path and preserves input order. Cases are distinct evaluation inputs; repeating the identical deterministic input does not estimate a win rate. Wall-clock duration is not returned as game data.

Stable core DTOs needed by the browser are mirrored as types in `core-model.ts`: domain values, Senkei snapshots, ruleset configuration schema, result/replay, and restricted diagnostics. Compiler-specific structures not owned by the shared Rust model remain `CoreJsonValue`. Senkei configuration stays ruleset-defined; the browser must not hardcode lane, unit, or combat fields.

## Message envelopes

`WebWorkerRequest` is a discriminated union. Each request has `web_protocol_version: 1` and `request_id`; `operation` is `initial_ruleset`, `compile`, `simulate`, or `benchmark`. The payloads correspond to the signatures above. A successful response has the same protocol version and request ID, `ok: true`, and the typed `result`. A failure has the same protocol version and request ID, `ok: false`, and `error: { code, message, details? }`. Worker failure codes are `invalid_request`, `unsupported_protocol`, `core_error`, and `worker_error`.

The Worker adapter maps `TacticalInput.kind` to one of two Rust/WASM compile operations. It forwards a versioned core envelope (using `CORE_API_VERSION`, pinned to `1.0.0`):

```json
{
  "api_version": { "major": 1, "minor": 0, "patch": 0 },
  "request_id": "worker-generated-id",
  "operation": "compile_text",
  "payload": {
    "ruleset_ref": { "id": "...", "version": { "major": 1, "minor": 0, "patch": 0 }, "digest": "..." },
    "source": "..."
  }
}
```

`initial_ruleset` uses payload `{}`. For a structured AST, the operation is `compile_ast` and payload is `{ ruleset_ref, ast }`; the AST has its own `schema_version`. For simulation, the operation is `simulate` and payload is `{ attacker, defender, context, include_diagnostics }`. `attacker` and `defender` are immutable `SenkeiSnapshot` JSON; `context` is immutable `MatchContext` JSON. The simulation context includes the execution versions, initial world, and host limits.

The core response always contains the matching version and request ID, `ok`, `result`, and `error`. A successful response has `error: null`; a failure has `result: null` and `error: { code, message, path, details }` (`path` is nullable and `details` is a string-valued object). Compile `result` contains the program, estimated CU, and compile diagnostics. Simulation `result` contains public `result` and `replay`; `diagnostics` is null unless the local request explicitly includes it. Rust Serde types use `snake_case`; tagged domain values use adjacent tags such as `{"kind":"integer","value":4}`. `Observed<T>` uses `{"status":"known","value":...}` or `{"status":"unknown"}`. The adapter preserves those tags and rejects unsupported core API versions; it does not silently coerce a schema mismatch.

`benchmark` is a browser Worker operation and is not a Rust core operation. It dispatches one core `simulate` request per case. Case IDs are echoed in order. A failed case returns a request error and does not fabricate an outcome for that case.

## Result and information boundaries

`MatchResult` and `PresentationReplay` are public-facing core products. `RestrictedDiagnostics` is a separate local-only channel and is absent unless diagnostics are requested. Renderers receive `SimulationOutcome` (`result`, `presentation_replay`); diagnostic viewers receive `restricted_diagnostics` through a separate prop. A replay renderer must not require tactic source, bytecode, IR, private state, or internal CU trace.

No exported worker API performs authentication, cloud persistence, account access, online matching, or ranked settlement. Local persistence is a separate feature boundary and stores a versioned browser document wrapper around core-owned JSON.

## Feature module contracts

Later feature work owns only its feature directory and implements these named exports. `App.tsx`, the shared contract files, and this document remain owned by the browser-shell task.

| Directory | Named export | Props |
| --- | --- | --- |
| `apps/web/src/features/editor/` | `EditorFeature` | `EditorFeatureProps`: `ruleset: RulePackage \| null`, `draft: SenkeiDraft \| null`, `compilation: CompileOutcome \| null`, `onDraftChange(draft)`, `onCompile(input: TacticalInput)` |
| `apps/web/src/features/battle/` | `BattleFeature` | `BattleFeatureProps`: `scenarios`, `selected_scenario_id`, `snapshot: SimulationSnapshot \| null`, `outcome`, `benchmark`, `restricted_diagnostics: RestrictedDiagnostics \| null`, `onSelectScenario(scenario_id)`, `onSnapshotChange(snapshot)`, `onSimulate(snapshot, options?)`, `onBenchmark(cases)` |
| `apps/web/src/features/persistence/` | `PersistenceFeature` | `PersistenceFeatureProps`: `documents`, `history`, `diff`, `selected_document_id`, `selected_revision`, `onCreate(name)`, `onSelect(document_id)`, `onSave(document)`, `onDelete(document_id)`, `onCompareRevisions(document_id, before_revision, after_revision)`, `onRestoreRevision(document_id, revision)`, `onImport(file)`, `onExport(document_id)` |

The shared state and payload types are exported from `apps/web/src/contracts/index.ts`. `WorkspaceState` is the app-owned state boundary; persistence records use `LocalSenkeiDocument`, whose `payload` is `SenkeiDraft`. The feature directories are owned by the corresponding feature implementations; this task defines contracts and the app shell but does not implement editor, battle, or persistence behavior. Feature props expose operations as callbacks rather than giving a feature direct access to React application state, IndexedDB, or the Worker instance.

## Local development

The Vite application is rooted at `apps/web` and uses no server API:

```sh
npm install
npm run dev
npm run build
```

The production build is written to `dist/web`. Static hosting may deliver those files; after assets are available locally, the browser workflow remains local. Offline cache installation is a separate delivery task and must not introduce an online dependency into PvE.
