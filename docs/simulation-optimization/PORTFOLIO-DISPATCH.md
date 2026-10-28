# Synthetic portfolio execution — algebraic kernels, partition granularity, and dispatch economics

Status: **research prototype in `apps/simulation-lab/core.mjs`, not production Enbu**. This note records executable algorithms, their proof obligations, measured limitations, and subsequent research. A matching numerical result in this independent, fixed-order combat toy does **not** certify Jinrei observations, CU, replay, or native/WASM equivalence.

## 1. Algorithms now implemented (11 alternatives)

Existing methods: `tick`, `active`, `heap`, `bucket`, `periodic`, `hybrid`, `adaptive`. Newly implemented, independently selectable and differentially tested:

| Method | Computational idea | Important cost / guard |
| --- | --- | --- |
| `arithmetic` | For permanent visibility, each actor's cumulative hits by Tick `t` are `max(0, 1 + floor((t-first)/interval))`. Sum damage across actors and binary-search the **first lethal Tick**. The last attack and accumulated Tick sum follow arithmetic-series formulas. | `O(A log T + K)` for a group (K is requested materialized attacks); visibility with gaps delegates to the existing exact periodic solver. Only valid when damage is monotone and timing/target are fixed. |
| `scan` | For each independent shared target, linearly scan the next due time per actor; commit all equal-Tick attacks together, then advance clocks. | `O(A E)` operations, lower constant overhead than a heap for **tiny** actor groups and sparse events. Dense groups are a deliberate worst case. |
| `phase_cache` | Compile a cyclic visibility schedule once per `(interval, firstVisible mod period)` within a group, then reuse it at other absolute start times shifted by whole visibility periods. | Adds cache/hash allocations; profitable only when phases repeat often enough. Accumulated time sums require `sum + count * shift` and final timestamp `last + shift`. |
| `planned` | Single-pass grouping and domain feature extraction, low-cost decision DAG, specialized single-target/independent-actor routes, plus exact per-group kernels. | O(A + G) general planning; skip idle groups and only materialize mutable actor objects when needed. The planner's cost is included in the timed call. **Not claimed universally fastest.** |

`A`: actors; `G`: independent shared-target groups; `E`: processed attack events; `K`: physically materialized output events; `T`: Tick horizon. All are *synthetic model* quantities.

### Exact kill boundary

All contenders attacking at the lethal Tick must attack, using the same HP at the start of that Tick. For constant-damage actors with attack times `f_i + j Δ_i`, define

```text
H_i(t) = 0                                  when t < f_i
       = 1 + floor((t - f_i) / Δ_i)          otherwise
D(t)   = Σ_i damage_i * H_i(t)
τ      = min { t ≤ T | D(t) ≥ target HP }, if it exists
```

Evaluate all actor aggregates through `τ` (inclusive). Do not stop after the first attack within Tick `τ`. When visibility windows are periodic, a compiled phase cycle and prefix sums implement the equivalent `H_i(t)` and attack-Tick sum. Trace capture still requires `Ω(K)` output writes; a fast result-only aggregate is not a promise of free replay.

### Single-pass general classification

`buildPlan()` scans actors once, recording each enabled actor's first eligible attack Tick, a **conservative visibility-independent upper bound** on the number of attacks, earliest-volley damage, and its target-group membership. It then emits at most one decision per target group, excluding idle execution entries:

```text
No attack within T  -> idle (no executor allocation)
First volley lethal -> first_volley (no queue, no per-attack event scheduling)
One attacker        -> single (closed-form without visibility, periodic otherwise)
≤ 8 attackers and ≤ 12 upper-bound events -> scan
Permanent visibility -> arithmetic
Otherwise            -> phase_cache
```

`plannedRun()` also checks a **proved bijection between actor index and target index** before allocating group arrays, directly executing independent singleton formulas, and has a guard for trivially low-HP shared targets. These guards depend on the current state, **not on scenario names**. The current fixed thresholds are provisional and must be tuned per backend from independent trials; changing them is performance calibration, not a semantic change. No per-Tick algorithm selection occurs.

`buildPlan` produces *actor indices*, not references into the source state, so the same plan can execute against an identical cloned initial state. It must **never** be applied to a world whose shape or relevant mutable values differ. Production needs explicit versioned dependencies / invalidation certificates before cross-window reuse.

## 2. Selecting the selector: minimize net wall time

The theoretical fastest execution kernel may lose once classification or re-planning is counted. The actual objective is:

```text
NetCost(plan, world, window) =
  classify + partition + compile + execute + materialize + cross-domain barriers
  + validate/invalidate + switch + logical-CU/replay reconstruction
```

Use a **cascaded dispatcher**:

1. Constant-shape, low-risk guards without allocations (`no work`, a proven singleton partition, a proven first volley).
2. A single O(A+G) state scan **only when the cheap guards fail**; collect feature counts while creating target memberships; no second classification pass for the same window.
3. A fixed, small decision table per *independent causal domain*, not an exhaustive search of all kernel variants on each Tick.
4. Prefer arithmetic/periodic aggregation where exact, and avoid heap/bucket overhead when the event density is high. `scan` is only a small-group candidate.
5. Future, for dynamic real-world domains: cache shape/dependency metadata keyed by RulePlan/Program/world versions, invalidate at causal boundaries, apply hysteresis before switching and explicitly charge replan/synchronization overhead.

The minimum planning cost is still `Ω(A+G)` for an arbitrary **uncached** initial assignment, because every potentially enabled actor must be inspected. If structure is certified immutable within a window, subsequent decision checks can be `O(changed dependencies)` instead; that improvement is **not implemented** in the synthetic lab. The absence of global coupling in this synthetic kernel allows per-target independence. Real Enbu may have cross-target movement, visibility, resources, effects, and globally synchronized Jinrei phases; group boundaries must be derived from a dependency graph, not assumed from target ownership.

### Why a global static winner is a trap

- Dense attacks: heap and bucket may be far slower than direct arithmetic.
- Few actors and few events: scanning due times can avoid heap allocation and sift operations.
- Many independent singleton targets: a general group planner wastes more time than direct actor-major formulas.
- Low-HP first volley: computing a schedule or queue may cost more than proving the first lethal Tick.
- Short or sparse workloads: even an O(A+G) dispatch pass can dominate execution.
- Repeated visibility phases: phase caching can help, **but may lose to uncached periodic aggregation** because of hash/shift overhead.
- `capture=true`: trace size provides a physical lower bound; take care not to compare output-free algorithms with trace-producing ones.

## 3. Measurements: early evidence, not a ranking certification

Run locally:

```bash
node --test apps/simulation-lab/core.test.mjs
LAB_ACTORS=256 LAB_TICKS=2000 LAB_SAMPLES=7 LAB_BATCH=24 node apps/simulation-lab/portfolio-bench.mjs
# Optionally LAB_CAPTURE=1, with smaller LAB_TICKS / LAB_ACTORS
```

A single exploratory Node v22.16.0 run, 256 actors / 2,000 Ticks / result-only / 5 samples / 16 workloads per sample, **uncontrolled host, significant JIT/GC noise** gave these illustrative medians (µs per simulated run). They must not be copied as iPhone or production measurements:

| Scenario | Planner build only | `planned` incl. classification | `hybrid` | `arithmetic` | `phase_cache` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `solo_duels` | 36.0 | 17.0 (bijective shortcut) | 98.0 | 51.2 | 156.5 |
| `dense_hits` | 5.3 | 13.4 | 21.7 | 28.2 | 35.9 |
| `fog_half` | 5.8 | 61.5 | 88.5 | 85.4 | 56.9 |
| `fog_rapid` | 5.8 | 116.1 | 55.0 | 96.9 | 124.8 |
| `shared_many` | 12.1 | 146.1 | 87.5 | 29.4 | 133.6 |

The standalone general planner build time is **not** charged on a specialization path. These numbers demonstrate both algorithmic wins and selector **regressions**: our current dispatch heuristics are not globally optimal and therefore remain tunable. Timers and strategy performance differ substantially between Node and mobile Safari. The browser benchmark measures general plan construction separately and includes actual planning in `planned` end-to-end time. No reported infinity speedup should be treated as valid.

## 4. Verification and limits

- `differential()`: 14 scenarios × 5 actor counts × 8 horizons = **560** deterministic cases, each compared against every non-Tick method.
- `fuzz(200)`: 200 seeded randomized worlds with full attack Tick traces, compared against all methods.
- Additional tests: medium horizon, plan immutability against a cloned state, all selector branches, fog phase/shift and lethal Tick boundaries, `capture=true` equality.
- The exact equality oracle compares target HP, actor positions, readiness, hit counts, tick sums, and (when requested) every attack Tick.
- This does **not** include per-Tick world snapshots, three-valued Jinrei observation, CU, rollback, production Enbu, WASM, GPU, or native Rust implementation. Those remain separate acceptance gates.

## 5. Further variants worth implementing, ranked by expected net benefit

| Candidate | Granularity / benefit | Preconditions and experiment |
| --- | --- | --- |
| **Cohort quotient/remainder compression** | Aggregate actors with identical `(interval, phase, damage, start window)` into multiplicities; reduce damage-solver cost from O(A log T) toward O(C log T), `C ≪ A` | Individual event and `ready` updates must still be reconstructed; compare compile+reconstruction against direct arithmetic |
| **Dominance frontier / monotone lower envelope** | For each target, summarize `D(t)` in piecewise segments; solve multiple thresholds without repeating binary search | Higher upfront cost; useful only for repeated queries, shield phases, or repeated samples |
| **Direct timer wheel with active slot masks** | For bounded small horizons, O(E+T+slots) with low constant and cache locality | Only if timers actually need per-event processing and dense arrays beat arithmetic |
| **Dependency SCC certificates + dirty frontier** | Compile group boundaries from actual Read/Write dependencies rather than fixed target partitions | Versioned invalidation and phase-correct synchronization mandatory; measure replan/switch rate |
| **Finite-state matrix / binary lifting** | Many repeated identical discrete modes with long empty horizons | All state and logical side effects must form a closed finite recurrence; prevent state explosion |
| **Arithmetic cohort SIMD / SoA** | Hot dense arithmetic kernels, lower memory traffic on Rust/WASM | Only after real backend and data-layout benchmarks; equality of integer/overflow semantics |
| **Trace-on-demand checkpoints** | Result-only fast forward with sparse replay seek | Prove requested projections and bounded reconstruction, not just final state |

**Decision:** Keep the portfolio architecture; do **not** freeze specific winner-per-scenario tables or cost coefficients. The next performance gate is an equivalent Rust/WASM implementation with observed Enbu semantics and realistic representative workloads. Adapt the dispatch policy from features and measured *net* costs, with exact fallback whenever proof obligations fail.