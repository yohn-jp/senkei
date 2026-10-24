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
`RulesetRef` is `{ "id", "version", "digest" }`. `digest` is the lowercase
64-character SHA-256 hex digest of the canonical package content. Canonical
hashing excludes the digest field itself. Ruleset, language, IR, bytecode,
cost schedule, model, engine, and replay versions are checked independently.

`LogicalCu` is a serde-transparent `u64` and therefore a JSON number. A
Senritsu package must constrain all accepted CU values and totals to
`9_007_199_254_740_991` or below so JavaScript can represent them exactly.
`senkei_model::LogicalCu::MAX_SAFE_JSON_INTEGER` exposes that bound.

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
  IR, and bytecode versions;
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

pub struct Vm { /* interpreter state only */ }

impl TacticalExecutionPort for Vm { /* ... */ }
```

`CompileResult` contains a `TacticalProgram`, its estimated logical CU, and
structured compile warnings. The compiler binds the program to the RulePlan's
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
`compile_ast`, and `simulate`. Every response is:

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

```json
{"ruleset_ref":{"id":"...","version":{"major":1,"minor":0,"patch":0},"digest":"..."},"ast":{"schema_version":{"major":1,"minor":0,"patch":0},"program_name":"hold_line","declarations":[]}}
```

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
