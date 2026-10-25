# Behavior Runtime — independent resolver contract

`senkei-behavior` is a deterministic consumer of a validated Senritsu `DomainCatalog`. It composes typed preferences and selects among typed Intent candidates supplied by a future Behavior/Enbu policy. It does not create movement, attack, targeting, or pathfinding candidates and it does not inspect or mutate a World.

## Producer seam

Construction requires the exact `CatalogCompatibilityKey` and an authored `BehaviorProfileMetadata` extension. Catalog mismatch and packages without Behavior Profile metadata are errors. The resolver consumes the Producer's field IDs, types, scopes, inheritance order, aggregation policy, Hero defaults, and preset data; it does not infer the six preference domains from field names.

`CapabilityContractMetadata.behaviorOverrideArguments` is an additive, optional wire field. It maps a profile field ID to the zero-based argument index in that same typed capability signature. Older serialized extensions decode the missing map as empty. The map is omitted from canonical JSON when empty, preserving existing unbound Catalog and extension digests; a non-empty mapping participates in both digests and therefore in the compatibility key. No Catalog schema version bump is needed for this optional additive field. Senritsu validates that each binding references a declared field and argument, has an exact type match, targets a conditionally overridable field, and uses an actor-scoped, Tick-bounded capability. The projection exposes the validated mapping in `CapabilityDefinition`.

The current bundled `senkei.next` RulePackage does not author Behavior Profile defaults or a no-op capability. Tests attach a package-bound extension through the real `DomainCatalog` Producer. A downstream ruleset must author its own defaults and policy before this consumer can resolve those package-specific choices.

## Composition

Composition follows the Catalog's inheritance order and keeps the prior value for every unspecified field. It reports typed provenance for each effective field. Squad aggregation follows the field's declared `AggregationPolicy` and sorts roster members by stable subject ID first. A Hero composition in a Squad must include that exact Hero ID and Hero Catalog ID in the current roster. Profile identity includes Catalog key, actor, movement context, tick, side, sorted roster, and effective values so stale compositions and default candidates are rejected.

Army and Squad preference inputs are maps of typed Catalog field IDs and values. Unknown fields, invalid scope, invalid types, missing required defaults, and conflicting `RequireAgreement` values return errors. Conditional Jinrei preference writes are read only from `TacticalExecutionOutput` Intents with a validated Catalog argument binding and caller-supplied `KnownLegal` evidence. Missing or Unknown legality is retained as Unknown; permission denial and known rejection remain separate. The VM's `when_unknown` notices remain visible and do not change profile values.

## Candidate resolution

The caller supplies explicit Intent candidates and profile-bound Default candidates. Candidate signatures, actor and target argument identity, tick, side, and default-profile digest are checked. The resolver applies the `RulePlan` arbitration policy within each capability and uses canonical Intent fields for stable ordering where the RulePlan tie-breaks. If multiple legal capabilities remain for the actor and no cross-capability total order is available here, resolution returns `UnresolvedCandidateConflict`; it does not silently choose a Default or no-op. Cross-side arbitration remains Enbu's responsibility.

World, combat, observation, and capability legality are caller-owned facts. `KnownLegal` means the caller has authorized that exact candidate for this actor and Tick. In particular, Enbu must reject a Hero's individual movement while the Hero belongs to a multi-Hero Squad; the resolver does not guess which capability IDs mean movement. Individual Hero attacks or skills may still be supplied when the caller certifies them legal. The tests exercise this trust boundary with a caller-rejected individual movement candidate.

`NoOpFallbackCandidate` represents Hold/Wait without an Intent. The caller must certify the current no-op policy as `KnownLegal`; the result sets `fallback_kind` and emits no capability or World-changing Intent. Unknown, denied, rejected, or stale no-op certifications cannot select a fallback. This does not claim that the current `senkei.next` package has configured Hold/Wait policy or that an Enbu Tick loop consumes this result.

## Deliberate integration boundary

The resolver returns effective profile data and a bounded decision trace with inherited values, selected candidates, Unknown states, and rejection reasons. It does not generate candidates from Navigation, Engagement, Targeting, Pursuit, Survival, or Objective preferences. It does not assign scoring weights, search paths, enforce World rules, produce committed events, or persist restricted diagnostics. Candidate generation, Enbu legality, cross-side arbitration, Tick-loop connection, and result/event linkage remain integration work.

The crate uses only shared Rust data types and deterministic ordered maps/serialization; native and `wasm32` compilation use the same implementation. Compilation on both targets does not by itself establish execution equivalence, which requires a later shared-runtime conformance test.
