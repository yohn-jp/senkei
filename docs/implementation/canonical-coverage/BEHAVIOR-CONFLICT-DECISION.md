# BH-03 — late conflict proof and decision boundary

Assessment source: `9f52dbfa44d8f08ff854116fef7850fbc91e13af`. Classification: **INCOMPLETE** for the defined mechanism to validate and consume a complete authored cross-capability order. Ordinary typed representation/schema implementation is authorized; an absent model field does not make that mechanism undefined. **DECISION_REQUIRED** applies only to unauthored production policy choices such as conflict grouping, rankings and game-specific semantics.

Authority: [BEHAVIOR §3, line 58](../../BEHAVIOR.md#L58) and [RUNTIME-INTEGRATION-CONTRACTS §3](../../RUNTIME-INTEGRATION-CONTRACTS.md#L82) require a declared stable total order for conflicting Subject/field candidates, including different Capabilities, and rejection of undeclared conflicts.

The current model has only `BTreeMap<CapabilityId, ArbitrationRule>`; [ArbitrationRule](../../../crates/senkei-model/src/rules.rs#L388) has conflict keys and a per-capability resolution. [Catalog override validation](../../../crates/senritsu/src/catalog.rs#L1732) validates each binding independently. The [Behavior arbitration consumer](../../../crates/senkei-behavior/src/lib.rs#L1175) groups by Capability before arbitration. [Profile composition](../../../crates/senkei-behavior/src/lib.rs#L537) rejects different surviving values for the same field with `UnresolvedCandidateConflict`. Identical per-capability sort keys do not declare an order between those groups.

## Executed narrow proof

A scratch-only harness used the existing `senkei-behavior/tests/runtime.rs` test metadata helper with the real `next_package`, `validate_with_catalog_extension`, `DomainCatalog`, Jinrei compiler/VM and `BehaviorResolver`. No tracked Rust source was changed.

1. Author a **test extension** binding `move` argument 1 and `activate` argument 1 to the same existing `navigation.destination` String(64) field. Both actor arguments have concrete type `hero`, control scope Hero and phase `transition`; both advertised preconditions are `0 < actor.hp`.
2. Recompute semantic extension and package digests and bind the extension to the exact package identity. Authoritative RulePackage validation and real Catalog construction both accept it. Package digest: `d5b81bb03a8ab4b20efb7c458b8cf797dad072dff554876920b1d904fbc8c893`.
3. Compile and run a real Jinrei program with both actions for one observed Hero. The VM emits `move_choice` with `"A.TOP.J"` and `skill_choice` with the actual catalog string `"f01_a_active"`; charged CU is 33.
4. With **caller-supplied test KnownLegal facts**, either candidate alone composes successfully. Both together return `Err(UnresolvedCandidateConflict)`. Reversing enumeration returns the same error.
5. Change only the second test binding to the different existing `targeting.mode` field, rebind/recompile against that package and rerun the real VM. Both writes then compose successfully.

Executed command exited 0: `CARGO_TARGET_DIR=/workspace/scratch/behavior-proof-target cargo run --manifest-path /workspace/scratch/behavior-conflict-proof/Cargo.toml --offline`. The session log is `/workspace/scratch/behavior-conflict-proof.log`; the scratch harness is not a repository deliverable or production fixture.

**Proof limit:** these arbitrary test profile strings do not define production navigation/targeting behavior. KnownLegal is supplied by the caller for the resolver test; no actual Enbu match was run and no simultaneous real-world move/Skill legality was established. The bundled next package still has no production Behavior profile. The proof establishes the accepted-Catalog/late-fail-closed seam only. Production execution and acceptance remain **NOT_CHECKED**.

## Missing decision and implementation consequence

The defined implementation gap is a common typed authored-order representation, validation of completeness/consistency, and consumption by the resolver. Implementing that mechanism is authorized without choosing production rankings. Actual production conflict groups, cross-scope subject mappings and rankings must be authored explicitly rather than inferred from fixture values. The latter product choices remain DECISION_REQUIRED where no authority supplies them. This is separate from already implemented semantic-extension digest binding.

A blanket ban on multiple Capabilities, or even on every same-scope/same-field declaration, would reject legitimate disjoint actor types/scopes/fields/phases, singleton-equal values or mutually exclusive conditions. Creating an ad hoc satisfiability/witness subsystem to recognize selected cases would expand this future extension and still not establish the complete contract. A partial validator must not be reported as full BH-03 acceptance.

Therefore no validator, new global rank, model schema or game default is introduced in this work. Existing runtime rejection remains in place. A later bounded task may implement the common authored-order mechanism without inventing production policy; selecting production groups/ranks remains deferred. Unrelated UI, persistence, source-location and renderer work continues independently. This decision boundary is not a goal-completion claim.
