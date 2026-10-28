# Extended deterministic scheduling benchmark

**Scope:** Synthetic Node.js model, NOT the actual Rust Enbu engine, Jinrei VM, or Senritsu.

Seven strategies: tick, active, heap, bucket, periodic residue-cycle aggregate, target-local hybrid, and global/local adaptive. All attacks directed at the same target in a given group resolve simultaneously each Tick; visibility is a synthetic periodic Boolean gate. Target death prevents later attacks. Arrival consumes its movement Tick. Actors move independently even after their target is dead. No cross-group dependencies, HP recovery, actual Fog/Unknown, CU, replay snapshots or bridge/collision semantics.

Node.js 22+ with no dependencies:

```bash
node tools/senrei-bench/extended.mjs --test
node tools/senrei-bench/extended.mjs --scale=quick --samples=5 --warmups=2 --json=quick.json
node tools/senrei-bench/extended.mjs --scale=quick --capture --samples=5 --warmups=2 --json=capture.json
node tools/senrei-bench/extended.mjs --scale=standard --samples=7 --warmups=3 --json=large.json
```

`--test` performs 560 fixed fixture combinations + 200 deterministic pseudorandom fixtures, verifying all six candidates against Tick for final state **and complete attack Tick lists**. For benchmark cases the final result is compared again against Tick. Results JSON gives median, p95, min, max, batch size, environment, scenario parameters, total attack hits, and verification flags.

Options: `--scale=quick|standard|large`, `--capture` (physically emit all attack Ticks), `--samples=N`, `--warmups=N`, `--fuzz-seeds=N`, `--json=path`. `large` can be expensive with dense Heap-event workloads. Timed region excludes fixture copies, comparison, JSON serialization; JIT and memory collection can still skew timing. Timer batches target ~2ms with cap of 48 executions. Always report the workload, output mode, and toolchain.

Measurements and explanations: [`docs/simulation-optimization/measurements/2026-10-29-extended.md`](../../docs/simulation-optimization/measurements/2026-10-29-extended.md).
