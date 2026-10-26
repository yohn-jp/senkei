# Senkei Core API Contract

This document fixes the shared Rust and JSON contracts used by the local PvE
implementation. The product and responsibility boundaries in `docs/*.md`
remain authoritative. This API does not add game-specific unit classes,
lanes, combat values, or a CU schedule; the initial Senritsu package supplies
those.

All Rust data maps are `BTreeMap` or `BTreeSet`. Vectors preserve only order
that is explicit in the contract, such as transition phases, an ordered
predicate, or replay frames. The compiler and engine must not infer priority
from declaration order or hash iteration.

## Workspace and crate ownership

- `senkei-model` owns the versioned shared DTOs, generic world/schema/plan
  structures, result/replay/diagnostic types, and `TacticalExecutionPort`.
- `senritsu` owns the initial ruleset package and validates untrusted packages
  into `VerifiedRulePlan`.
- `jinrei` owns text parsing, type checking, lowering, bytecode, and the VM. It
  implements the shared `TacticalExecutionPort`; the model crate never parses
  or interprets Jinrei bytecode.
- `enbu` owns simulation and depends on `senkei-model` plus a
  `TacticalExecutionPort`. It does not depend on Jinrei.
- `wasm` adapts the Rust APIs to the versioned JSON envelope below.

The root workspace uses `members = ["crates/*"]`; each component adds its own
crate when it is ready.

## Versions and identities

`Version` serializes as `{ "major": 1, "minor": 0, "patch": 0 }`.
The shared model contract is `SHARED_MODEL_VERSION` (`1.0.0`), and Enbu's
deterministic engine contract is `ENBU_ENGINE_VERSION` (`1.4.0`). These
semantic contract versions are independent of Cargo crate package versions.
`RulesetRef` is `{ "id", "version", "digest" }`. `digest` is the lowercase
64-character SHA-256 hex digest of the canonical package content. Canonical
hashing excludes the digest field itself. Ruleset, language, IR, bytecode,
cost schedule, model, engine, and replay versions are checked independently.

`LogicalCu` is a serde-transparent `u64` and therefore a JSON number. A
Senritsu package must constrain all accepted CU values and totals to
`9_007_199_254_740_991` or below so JavaScript can represent them exactly.
`senkei_model::LogicalCu::MAX_SAFE_JSON_INTEGER` exposes that bound.

`StructuredTacticsAst.schema_version` uses the separate
`senkei_model::AST_SCHEMA_VERSION` (`1.0.0`); it is independent of the Jinrei
language version and must match `RulePackage.structured_ast_version`.

## JSON value tags

`DomainValue` uses adjacent tags:

```json
{"kind":"integer","value":4}
{"kind":"fixed","value":{"coefficient":125,"scale":2}}
{"kind":"enum","value":"frontline"}
{"kind":"record","value":{"health":{"kind":"integer","value":8}}}
```

The complete `DomainValue` variants are `null`, `bool`, `integer`, `fixed`,
`string`, `enum`, `entity`, `list`, and `record`. Floating-point values are not
part of the shared deterministic model.

`Observed<T>` distinguishes unknown from a known null:

```json
{"status":"known","value":{"kind":"bool","value":true}}
{"status":"unknown"}
```

`Truth` is the three-valued enum `true`, `false`, or `unknown`. Unknown
observations must never be converted to false by deserialization or adapters.

All enum tags use snake_case. `DomainValue`, `Observed<T>`, `RuleExpression`,
and other enum payloads use the `kind`/`value` adjacent-tag format when their
Rust declaration has a payload. Struct variants keep their fields under
`value`; for example `Fixed` is nested as shown above.

## Senkei, observation, and execution contracts

`SenkeiSnapshot` is an immutable input by convention and is passed to Enbu by
shared reference. Its configuration is a schema-checked `BTreeMap<FieldId,
DomainValue>`; no game-specific loadout fields are defined in the model. The
configuration field schema is published at
`RulePackage.domain.senkei_configuration`. The `program` holds Jinrei's
opaque, verified bytecode blob and its exact ruleset/language/IR/bytecode/CU
versions and content digest. Enbu treats that bytecode as opaque.

`ObservationSnapshot` has a `tick`, a `side`, path-keyed observed values, and
schema-keyed collections of observed entity views. It contains only values
permitted by that side's verified ruleset projection. A `DomainValue::Null` is
a known value and differs from an `Observed::Unknown` field.

`Intent` contains a stable `action_id`, typed capability ID, optional actor and
target, positional typed arguments, and optional priority. Priority matters
only when a Senritsu arbitration rule explicitly selects it. The VM returns
Intents and proposed next tactical memory; it never mutates `WorldState`.

The shared execution port is:

```rust,ignore
pub trait TacticalExecutionPort {
    fn execute(
        &mut self,
        request: TacticalExecutionRequest<'_>,
    ) -> Result<TacticalExecutionOutput, TacticalExecutionError>;
}
```

The request contains the side, tick, opaque `TacticalProgram`, immutable
observation, prior `TacticalMemory`, allowed capability IDs, and available
logical CU/intent budget. The output contains candidate intents, proposed
next memory, charged logical CU, and restricted tactical diagnostics. Enbu
calls the port for both sides against observations from the same confirmed
world snapshot. It decides which intents are accepted and when proposed
memory is committed under the RulePlan.

## RulePackage and verified plan

`senritsu::initial_package` returns the serializable generic
`senkei_model::RulePackage`. It includes:

- a ruleset identity/digest and required model, engine, primitive set, Jinrei,
  structured-AST, IR, and bytecode versions;
- `domain`, with Senkei configuration, observations, finite collections,
  typed capabilities, tactical memory, symbols, and schema limits;
- `world`, with typed entity/global/collection fields and entity limits;
- a finite versioned primitive requirement set;
- explicitly ordered execution phases, transition rules, arbitration, and
  termination conditions;
- a separately versioned `CostSchedule`, presentation allowlist, and host
  protection limits.

These structures describe data and a finite interpreter contract. They do
not contain Rust callbacks, host handles, or arbitrary code. Primitive kinds
are the model enum `TransitionPrimitiveKind`; each call has typed operands and
its execution order is represented in the plan.

Senritsu's validator is the only supported way to obtain a verified plan:

```rust,ignore
pub fn initial_package() -> RulePackage;

pub fn validate(
    package: RulePackage,
    engine: &EngineCompatibility,
) -> Result<VerifiedRulePlan, Vec<ValidationIssue>>;
```

`VerifiedRulePlan` has no serde implementation, so a JSON input cannot claim
to be verified. It is created by `VerifiedRulePlan::from_validation` only
after package structure, content digest, versions, types, ordering,
capabilities, costs, limits, and primitive support have been checked. Enbu
still validates snapshot/program references against the verified plan.

The `initial_ruleset` WASM operation takes an empty object `{}` and returns
this same `RulePackage` shape. Editor configuration controls are generated
from `result.domain.senkei_configuration`; world entity fields are described
by `result.world.entity_types`.

## Jinrei API

The visual editor and text compiler converge on
`senkei_model::StructuredTacticsAst`, the versioned structured transport AST.
The text parser may use a different internal AST. The shared AST represents
state/action declarations, three-valued predicates, ordered and unordered
logic, finite quantification/aggregates, paths, and capability calls. Its
`schema_version` is part of the document. The compiler rejects unsupported
versions and malformed ASTs before producing a program.

```rust,ignore
pub fn compile(
    source: &str,
    rules: &VerifiedRulePlan,
) -> Result<CompileResult, ApiError>;

pub fn compile_ast(
    ast: &StructuredTacticsAst,
    rules: &VerifiedRulePlan,
) -> Result<CompileResult, ApiError>;

pub fn parse(source: &str) -> Result<StructuredTacticsAst, ApiError>;
pub fn format(ast: &StructuredTacticsAst) -> Result<String, ApiError>;

pub struct Vm { /* interpreter state only */ }

impl TacticalExecutionPort for Vm { /* ... */ }
```

`CompileResult` contains normalized `ast`, a `TacticalProgram`, estimated
logical CU, and structured compile warnings. The compiler binds the program to the RulePlan's
ruleset and CU schedule. It emits the versioned dedicated bytecode; it does
not emit or execute arbitrary JavaScript, native code, or player-authored
WASM.

Example structured AST (field names and tags are normative):

```json
{
  "schema_version": {"major": 1, "minor": 0, "patch": 0},
  "program_name": "hold_line",
  "declarations": [
    {
      "kind": "action",
      "name": "hold",
      "when": {"kind": "literal_truth", "value": true},
      "do_call": {"capability": ["guard"], "arguments": []}
    }
  ]
}
```

## Enbu API

```rust,ignore
pub fn simulate<P: TacticalExecutionPort>(
    attacker: &SenkeiSnapshot,
    defender: &SenkeiSnapshot,
    rules: &VerifiedRulePlan,
    context: &MatchContext,
    executor: &mut P,
) -> Result<SimulationArtifact, ApiError>;
```

Enbu checks all ruleset and component-version references, initial
configuration, tactical program metadata, resource limits, and data schema
before executing. It calls `executor.execute` for each side against the same
observation tick. It applies the validated arbitration and transition order,
and returns a complete result. The function has no compiler, parser, browser,
network, clock, or random-number dependency.

`SimulationArtifact` intentionally does not implement `Serialize`. Its
`public_response()` contains only `MatchResult` and allowlisted
`PresentationReplay`. `diagnostic_response()` explicitly contains
`RestrictedDiagnostics` for an authorized local caller. `ReproductionContext`
contains private immutable inputs and has no general serializer.

```rust,ignore
pub fn new_match_context(
    rules: &VerifiedRulePlan,
    match_id: MatchId,
) -> MatchContext;
```

The helper starts with an empty `WorldState`, takes `max_ticks` from the
verified termination policy, copies validated host limits from `RulePlan.limits`,
and fills ruleset/component versions from the plan and Enbu's version
constants. The browser does not choose world, tick, or host-limit semantics.

## WASM JSON envelope

Request envelope:

```json
{
  "api_version": {"major":1,"minor":0,"patch":0},
  "request_id": "req-1",
  "operation": "compile_text",
  "payload": {"ruleset_ref": {}, "source": "..."}
}
```

`api_version` is `1.0.0`. Operations are `initial_ruleset`, `compile_text`,
`compile_ast`, `parse_text`, `format_ast`, `new_match_context`, and `simulate`.
Every response is:

```json
{
  "api_version": {"major":1,"minor":0,"patch":0},
  "request_id": "req-1",
  "ok": true,
  "result": {},
  "error": null
}
```

`result` and `error` are nullable fields. On failure `ok` is false, `result`
is null, and `error` is `{ "code", "message", "path", "details" }`.
`path` is nullable and `details` is always an object (empty when there are no
details). Error codes are snake_case `ApiErrorCode` values. A version mismatch
or unknown operation returns an error and never runs a fallback version.

Payloads:

```json
{"ruleset_ref":{"id":"...","version":{"major":1,"minor":0,"patch":0},"digest":"..."},"source":"senkei ..."}
```

`parse_text` uses this payload and returns `StructuredTacticsAst`.

```json
{"ruleset_ref":{"id":"...","version":{"major":1,"minor":0,"patch":0},"digest":"..."},"ast":{"schema_version":{"major":1,"minor":0,"patch":0},"program_name":"hold_line","declarations":[]}}
```

`format_ast` uses the same `{ruleset_ref,ast}` payload and returns canonical
source text. `new_match_context` payload is
`{"ruleset_ref":{"id":"...","version":{"major":1,"minor":0,"patch":0},"digest":"..."},"match_id":"..."}`;
the adapter validates the bundled package and calls `enbu::new_match_context`.

```json
{"attacker":{},"defender":{},"context":{},"include_diagnostics":false}
```

For `simulate`, `context.ruleset` selects the locally bundled package. The
adapter validates that package and all snapshot references before calling
Enbu. The successful `result` shape is
`{ "result": MatchResult, "replay": PresentationReplay,
"diagnostics": RestrictedDiagnostics | null }`. `diagnostics` is null unless
the explicit local-only `include_diagnostics` flag is true. This opt-in local
WASM response is not the public simulation serializer; online/public adapters
must call `public_response()` and must not include diagnostics or reproduction
inputs.

## Model errors and validation

`ApiError` is the common boundary error: `code: ApiErrorCode`, `message`,
nullable `path`, and string-valued `details`. `ValidationIssue` has a stable
string code, JSON-style path, message, and details map. A validation error
reports all deterministic issues in stable path/code order. Component
internals may use richer Rust errors, but adapters map them into this contract
without including private source or bytecode in public responses.

## Deterministic projection, execution, and diagnostics semantics

- `WorldInitialization.global_fields` and `.collections` are static seed
  values applied once to `MatchContext.initial_world`. Entity projections
  apply after the base world for attacker then defender, in package order and
  only for `ProjectionSides` selected. `Singleton` emits one entity per
  selected side; `EachConfigurationItem` emits one entity per bounded record.
  Variable-length item lists are processed by derived EntityId ascending.
  Projections only add; duplicate IDs/destinations and schema, missing-value,
  unknown-value, or type errors reject the match. Side-dependent setup belongs
  on side-owned entity fields; global seed fields are constants. Observable
  `DomainSchema.collections` query world entities; mutable `WorldSchema`
  collections are separate backing data.
- Projected IDs use `derive_projected_entity_id`: SHA-256 over length-prefixed
  fields (u64 big-endian byte lengths): namespace `senkei.projected-entity.v1`,
  ruleset digest, projection ID, entity type, owner (`attacker`, `defender`, or
  `unowned`), key type (`string` or `entity`), and key bytes. Output is
  `prj:<lowercase hex>`. Runtime-created IDs use
  `derive_invocation_entity_id`: namespace `senkei.runtime-entity.v1`, match
  ID, big-endian tick, side, rule ID, accepted-intent ordinal (u32 big-endian),
  and operation index (u32 big-endian); output is `run:<hex>`.
- `ObservationFieldSchema.source` is explicit (`Tick`, world global field,
  selected world entity field, current collection entity field, or typed
  `RuleExpression`). Rule expressions also have a typed `CurrentTick` source;
  no global field is reserved for or implicitly mutated as a clock.
  `CollectionSchema.source` filters typed world entities;
  no dotted path string is parsed as world navigation. Visible fields define
  each entity projection. Collection `order_by` fields compare ascending
  using schema-typed values; EntityId ascending breaks iteration ties.
  `argmin` / `argmax` accept only declared `CollectionUniqueKey`s. The
  synthetic `binding.id` path uses `CollectionUniqueKey::EntityId`; other
  paths must match an explicit `Fields` key.
- Arbitration sort terms carry `Ascending` or `Descending`. After declared
  terms, Enbu appends the canonical tie-break tuple `(side, action_id, actor,
  target, capability, arguments)` in ascending order. No source order
  participates. This order assigns accepted-intent ordinals.
- `CapabilitySchema.actor_argument` and `target_argument` select Entity-typed
  positional arguments that remain in `Intent.arguments`. `target_type`
  constrains the target argument, actors must be owned by the issuing side,
  and `target_owner` constrains the target to any, own side, other side, or
  unowned.
- Each transition phase evaluates all conditions and operands from the
  immutable phase-start world. Transition rules order by ascending `order`
  then RuleId; accepted intent ordinal and operation index order effect
  emission. AddInteger/AddFixed writes to one field sum with checked i128
  arithmetic, clamp once to declared field bounds, and commit together.
  Overflow is `arithmetic_overflow`. Set plus additive writes, multiple Set
  writes, and conflicting structural writes to one address are
  `transition_conflict`. RemoveEntity is applied in an explicitly later
  phase. Concurrent collection appends coexist in canonical emission order;
  duplicates remain. RemoveCollectionValue removes all equal values, so
  concurrent removals coalesce.
- Required CU keys are `jinrei.path_read`, `jinrei.comparison`,
  `jinrei.arithmetic`, `jinrei.logic`, `jinrei.state_reference`,
  `jinrei.collection_iteration`, `jinrei.aggregate`, `jinrei.memory_read`,
  `jinrei.memory_write`, and `jinrei.capability_issue`. Missing entries are
  validation/compile errors, never free operations. `CapabilitySchema.issue_cost`
  selects the billed key for issuing that capability.
- VM output is `Completed` exactly when `required_cu <= available_cu`; then
  `charged_cu == required_cu`. It is `BudgetExceeded` exactly when required CU
  is larger; then `charged_cu == available_cu`, intents are empty, and next
  memory equals prior memory. `RejectTickAndKeepMemory` drops that side's
  outputs and continues; `AbortMatch` waits for both sides, discards both
  tick outputs/memory, and returns Aborted with
  `CostSchedule.budget_overrun_reason`. Completed memory commits according to
  `OnCompletedEvaluation` or `OnAnyIntentAccepted`; overrun never commits.
- Every `DiagnosticEvent` has nullable `action_id` and `entity_id`. UI groups
  CU only by explicit IDs. It may resolve lane only by joining an attributed
  entity to same-tick public `visible_state` and a schema-declared visible
  lane field; otherwise lane is unknown/unattributed. Missing attribution is
  never inferred.
- For `senkei.next` mechanics 2.0.0 plans requiring Enbu 1.3.0 or later, the
  restricted Enbu diagnostic projection coalesces `CostCharged` records by
  tick, side, and operation. It emits one exact-sum record per operation in
  stable operation-ID order. This projection does not change Jinrei's raw
  execution output, required or charged CU, intents, memory, or Unknown
  semantics. Plans outside that versioned contract retain per-charge records.
- `new_match_context` copies validated host caps from `RulePlan.limits`,
  including input bytes, entities, events, diagnostic events, and output bytes.
  A host-cap failure is `resource_limit`, separate from logical CU or a game
  loss.

## Acceptance checks for this contract

- Serialize/deserialize the documented tagged values and distinguish
  `Known(Null)` from `Unknown`.
- Reject mismatched versions, digests, schemas, unsupported capabilities or
  primitives, missing tie-break rules, and out-of-limit input before battle.
- Run native and WASM with the same snapshots and compare result, replay,
  logical CU, and ordered diagnostics.
- Confirm Enbu compiles with only the shared port and has no dependency on the
  Jinrei crate.
- Confirm the public response cannot serialize `RestrictedDiagnostics` or
  `ReproductionContext` through a blanket `SimulationArtifact` serializer.
