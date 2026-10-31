# Certified Execution Windows — Enbu production contract

## Scope, authority and current implementation

The canonical engine is `crates/enbu/src/lib.rs::simulate_inner`. The
verified RulePlan, Jinrei three-valued evaluation, logical CU, diagnostics,
public/owner Replay, FogHistory, stable simultaneous effects and error timing
are not optional optimizations. This document augments the existing
[SEMANTICS](SEMANTICS.md), [OBSERVABILITY](OBSERVABILITY.md), and
[CONFORMANCE](CONFORMANCE.md) contracts; it does not redefine rules.

The TS research achieved major improvements by using finite causal windows,
event times, and closed-form arithmetic in a smaller model. Its ratios do not
measure the end-to-end Rust/WASM engine, which has mandatory Tick-level
observation and output obligations.

### Two different meanings of a window

- **Phase-local cross-Tick certificate (implemented):** For one independent
  calculation domain, prove that the canonical phase would do no work or
  that its eligible sources are unchanged. Other phases still execute each
  canonical Tick. Existing basic-attack and reveal frontiers live in
  `execution/scheduler.rs`. The new movement active-source certificate
  lives in `execution/movement.rs`.
- **Closed-domain algebraic timeline (not yet wired into the full engine):**
  Resolve the dependency graph, compute the domain's exact state transitions
  across a bounded interval, and materialize every required canonical output
  and failure at the original Tick. `execution/arithmetic.rs` already has
  verified integer attack-count and first-lethal solvers, but the
  full output reconstruction and multi-phase admission proof remain work.

## Compiled passive lifecycle (real Enbu pre-observation phase)

The opt-in `lab-opt-passive-lifecycle` compiles immutable per-Hero
Haste, Slow and Shield passive definitions once from the verified `NextRules`
and executes them with one current-Tick mutable World traversal. Each living
Hero's current learned-skill IDs, catalog, HP, life/passive generation,
expiry timers and shield value remain authoritative. No passive effect,
respawn or observation is speculatively skipped. The original two-scan
lifecycle remains the independent reference path; a real Enbu 40-Tick
fixture checks full World and neutral-lifecycle events across death,
resurrection, learned-skill changes and unknown catalogs. This avoids
rebuilding learned-skill sets, repeated linear rule searches, and two
Hero-ID lists on each Tick. It is compiled into `lab-opt-hybrid` alongside
phase-local Scheduler and MovementWindow, but is not a global Tick jump.

## MovementWindow: real Next P7 execution

The `lab-opt-movement-window` feature adds a one-match, route-free,
cross-Tick Active Set to the *actual* Next navigation kernel. The new
`advance_from_snapshot_window` entrypoint passes its ordered eligible IDs
to the original `advance_entity` logic. It never reconstructs movement
effects from a guessed formula. It never changes the logical Tick clock.

**Eligibility:** Admit any living Hero, Minion or Monster with its own goal,
incumbent edge, any nonzero explicit movement marker, or a living same-side
Squad leader with a goal. An extra admitted source is harmless. Any rejected
source is guaranteed to exit `advance_entity` before its first write for
all Tick values while these inputs are unchanged.

**Proof:** The first call scans `WorldState.entities` once and retains
the exact read set, including nonmobile actors that might later become mobile.
Later Ticks compare entity membership and ID order, type, owner, **HP liveness**, Squad,
personal goal, incumbent edge and both explicit markers. A changed field,
spawn, removal, owner conversion or death triggers a domain-local rebuild.
Nonlethal HP magnitude changes leave movement source eligibility unchanged;
death or resurrection invalidates it, and admitted actors continue to read
the live World on their original canonical Tick. The proof does not rely
on hashing alone, a preselected TTL or scenario names.

**Exclusions:** A configured `next_route::Runtime` can supply a waypoint
without changing the entity goal. Such a match uses the original complete
navigation path, never the Active Set. Eligible actors still perform all
canonical dynamic speed/vision, track occupancy, bridge reservations,
target selection and side-effect calculations. Reference remains available.

**Complexity:** Reclassification is O(N log N) due to ordered Squad and
actor membership; a successful certificate costs O(N) to validate exact
fields, plus O(A) for the truly admitted active actors. Reference can cost
O(N²) for inactive Hero cohort construction and redundant movement checks.
This is a real cross-Tick calculation reuse, *not* O(1) dirty tracking or
a global whole-Tick skip.

A differential regression test compares the two physical Next navigation
paths over 30 actual Ticks with a new wave actor, changing leader goals,
death, explicit movement, and a changed minion goal.

## Frozen graph-local combat partition (real Enbu P7)

The experimental `lab-opt-spatial` feature builds an ordered
`CombatLocation::Node` or unordered-endpoint `CombatLocation::Edge`
index over the **same immutable P7 combat snapshot**. It specializes
`execution/strategies/planned.rs`, not the game rules or target selection.

**Proof:** `next_support::combat_distance2` can return a distance only
when both actors occupy the identical graph node with no incumbent edge,
or both occupy the same undirected authored edge. Consequently actors in
different buckets can *never* generate a normal attack on this Tick.
All candidates retained in a bucket pass through the unmodified
`can_basic_attack_with_sources` predicate: health, owner and type
eligibility, range, lane offsets, bridge/ford properties, reveal, source
visibility, and effective original graph position are rechecked.

The same frozen snapshot spatial buckets are also consumed by
`next_navigation::should_hold_for_attack_indexed` when deciding whether a
moving Hero/Minion/Monster should stop to engage. A lazy, snapshot-scoped
`OnceCell` builds the buckets at most once in movement, and the same
original `can_basic_attack_with_visibility` predicate remains the final
arbiter. Route-runtime waypoints remain authoritative and are not
invalidated or inferred from spatial candidates. This removes repeated
global enemy scans from the Next navigation combat-hold check.

**Trace fidelity:** Buckets are appended in original
`WorldState.entities` BTreeMap ID order. `nearest_in_candidates`
applies the same distance comparison and ID tie-break and emits identical
owner-only actor-decision candidate traces, including invalid edge
positions. Explicit requested-target selection remains untouched.

**Cost:** The index is built only for at least 24 entities, and a source
uses its local bucket only when it contains fewer candidates than the
original ownership/type partition; otherwise it uses that existing
`PlannedCombatCandidates` slice. This is a phase-local partition with
`O(N log N + K)` nominal indexing plus eligible-candidate traversal,
not a cross-Tick inference. It does not skip events, mutable writes, or
Replay projection. No new public fields or CU changes occur.

Native regression tests compare full hit orders, current World and
owner decision traces for mixed Nodes, reversed edges, invalid edges,
deaths, readiness, and ownership. Real Lab variants `X` and
`TCSRVGX` compare this exact source revision and complete Native
SHA-256 response against unchanged TCSRVG, including 64-Tick Quintet
through the actual browser Worker. **Promotion remains contingent on
those tests passing and measured wall-clock improvement**, not a claim
from synthetic TS timings.

## P7 frozen-snapshot squad and vision sharing (implemented)

The production Next navigation executor now builds an immutable,
per-P7-snapshot `NavigationCohorts` index for nontrivial worlds. It groups
living Heroes by (owner, Squad) in original EntityId order and classifies
living friendly Minions by side. The previous canonical per-Hero global scan
is replaced with an indexed membership lookup for action-lock checks,
movement-intent aggregation and attack-hold selection. Route-supplied
waypoints retain their independent actor-specific evaluation.

Within a route-free Tick, a complete `MovementIntent` is computed only once
for a living same-owner, nonempty Squad. Its leader, slowest corrected speed,
minion visibility, terrain effects and goal all derive from the same frozen
World and Tick. There is no sharing across Ticks, across owners or across
distinct route waypoints. Owner/HP/Squad changes are reflected by rebuilding
the snapshot index the next Tick. Cached and uncached executors are compared
over actual multistep navigation with spawn, deaths, leader goal changes and
dynamic membership.

`minion_vision_from_sources` preserves the canonical boolean geodesic
predicate while avoiding repeat scans of non-minion or opposite-side
entities. Observation visibility's independent `lab-opt-observation`
variant uses a current-World, current-side table that classifies each
entity's visibility once, then applies each schema field's original
authorization separately. This table does not persist into combat or the
following Tick.

## Periodic Arithmetic candidate windows (implemented, strict fallback)

`execution::arithmetic::CertifiedAttackTimeline` compiles attack-ready
recurrences from an actual frozen P7 snapshot. The existing checked
`execute_certified_window` heap-merges the next 128 Ticks into exact
ordered **candidate** batches, bounded at 8,192 potential hits. An
unsupported/over-budget schedule declines the optimization and leaves
Reference intact; the horizon is never silently extended. The live
`BasicAttackFrontier` consumes these batches at every original Tick
when `lab-opt-scheduler` and `lab-opt-arithmetic` are both selected. A complete, ordered read set
validates source identity, type, owner, attack, interval, readiness, range,
and causal HP dependencies on **every** current Tick before using the
prediction. On predicted no-due Ticks, only the basic attack-selection scan
is suppressed; on due Ticks, ordered candidate EntityIds are passed to the
existing canonical attack resolver.

An attack that was predicted but did not commit leaves `attack_ready`
different from its required recurrence on the following Tick, invalidating
the certificate. P1/P5/Skill rewrites, new combatants, death and interval
changes likewise revoke it before reuse. Nonlethal HP changes to an attack
source preserve a certified recurrence because the attack-readiness predicate
only depends on whether it is alive; a crossing of the alive/dead boundary
revokes the certificate. The simpler `BasicAttackFrontier` readiness
certificate uses the same liveness proof, avoiding unnecessary replanning
when an otherwise idle living actor loses HP. Damage to a permanently nonattacking target does
not invalidate source readiness. When all living combatants belong to the same non-neutral side, the
cheaper exact no-hostile-target frontier is used instead of staging hits
that cannot commit. Neutral combatants remain on the conservative path.
Neither `target`, `distance`, `visibility`, `damage` nor a predicted
lethal Tick is taken as authoritative; all such behavior is adjudicated
on its original canonical Tick.

This is **real multi-Tick Arithmetic dispatch for phase-local candidate
selection**, not closed-form state mutation or a whole-Tick jump. The
general fixed-target first-lethal kernel is implemented but is not allowed
to commit world damage without a full effect/read-write proof.

## Requirements before a closed-domain whole-Tick jump

A full `FastStep(S_a,[a+1,b])` is only valid when the engine can prove the
following for the chosen interval:

1. Every possible RulePlan/Jinrei/Behavior/Minion read and write is included
   in a versioned read-set with a complete invalidation mechanism. Unknown
   writes force a shorter window or Reference.
2. Periodic and arithmetic kernels use the actual same-Tick snapshot,
   stable tie ordering, shield/heal/damage semantics, checked arithmetic and
   exactly the same first-lethal and error/ResourceLimit boundaries.
3. For *every Tick* in the skipped interval, the exact public and
   side-authorized Fog/Replay, tactical memory, CU, diagnostic and
   event-index obligations are reconstructed, including known/unknown
   transitions and any first-observed timestamp.
4. Committed outputs are not speculatively exposed; failed proofs must
   fall back before any duplicate effects or CU charge.
5. The reference full JSON and Native/WASM outputs agree for all supported
   1/4/16/64/128+ Tick scenarios and adversarial dynamic interruptions.

The `FullCaptureLedger` currently requires every Tick and all owner
frames. It is intentionally not bypassed by the MovementWindow. A
ResultOnly API, checkpoint protocol or streaming ABI would be a separate
versioned output contract, not an implicit omission of existing Replay.

## Evidence and promotion

The Lab publishes two new variants, `W` (MovementWindow only) and
`TCSRVGW` (the measured incumbent TCSRVG plus MovementWindow), both
using real Rust/WASM. Reference `000`, unchanged TCSRVG and all other
variants remain accessible. All variants require exact Native golden
SHA-256 for every full response before timing is accepted.

The new optimization must prove improvement against **current TCSRVG**,
not just unoptimized `000`, including a dormant-world workload and a
dynamic-squad workload. Until those measurements are complete and green,
the production build remains TCSRVG. The earlier ~100x TS ratios are
algorithmic research evidence, not an end-to-end production target already
achieved.
