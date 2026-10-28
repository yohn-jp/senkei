# Minimal simulation scheduling experiment

This is an **isolated JavaScript semantic kernel**, not the production Enbu/Rust engine, nor Jinrei or Senritsu. It explores the computational difference between four execution strategies *before* altering production code.

Run with Node.js (zero dependencies):

```bash
node tools/senrei-bench/bench.mjs --test
node tools/senrei-bench/bench.mjs --json --count=1024 --ticks=10000 --warmups=4 --samples=11
```

The methods are: `tick` (every actor/every tick), `active` (live actors per tick), `event` (min-heap arrival/attack scheduling), and `analytic` (closed-form arrival time, periodic attack count, cumulative attack tick sum).

**Toy rules**: Actors move at a constant positive integer speed to an independent fixed stop location; arrival consumes its tick; they then attack a *private* target with fixed integer damage and fixed period until its HP reaches zero. Attacks do not modify other actors. Entities starting with zero HP are inactive. Final positions, target HP, next attack time, attack count and sum of attack tick numbers are compared. Differential tests additionally compare **every attack tick**. `sparse` activates one in ten actors; `bounded` activates all with finite goals and eventual kills; `dense` activates all with a target position beyond the horizon.

The harness performs 135 deterministic fixture combinations, comparing all three candidate methods to the naive Tick reference, including full per-actor attack timelines. It also checks output equivalence again for each benchmark workload.

Only **execution time** is timed: actor-array clones, output snapshots and differential checks are outside the timed interval. Short methods are automatically batched (capped at 128) to reduce timer granularity noise. Medians/p95 are calculated over samples, with optional warm-ups. Calibration and allocation can still affect timing through JIT/GC. The script emits environment, parameters, raw timing aggregates and speedup factors as JSON. Results are input-/machine-/JIT-specific.

**Not covered**: interacting units, simultaneous shared-target combat, Jinrei Truth/Unknown and CU, visibility/Fog, Behavior arbitration, Senritsu numeric saturation and overflow, dynamic bridges/routes, snapshots or Replay materialization, native Rust or WASM. The proof of concept is not a legal drop-in optimization for Enbu, and its speedup multipliers cannot be extrapolated to the game.

See [measurement report](../../docs/simulation-optimization/measurements/2026-10-28-minimal.md), [research catalog](../../docs/simulation-optimization/ALGORITHM-CATALOG.md), and [future benchmark matrix](../../docs/simulation-optimization/BENCHMARKS.md).
