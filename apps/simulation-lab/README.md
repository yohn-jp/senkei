# Senkei Simulation Lab

Static client-side **synthetic** algorithm research benchmark: https://yohn-jp.github.io/senkei/simulation-lab/ . All computation runs in a Web Worker. No telemetry, server execution, or production WASM is involved.

This lab currently evaluates **11 execution strategies** (original seven plus `arithmetic`, `scan`, `phase_cache`, and `planned`) on **14 synthetic scenarios**. The planner classifies **independent shared-target groups**, not scenario-name labels, and provides a separate estimate of generic classification overhead. See [portfolio dispatch research](../../docs/simulation-optimization/PORTFOLIO-DISPATCH.md) for algorithm design, cost models, performance counterexamples, and proof boundaries.

Run a local HTTP server from the repository root (module Workers require an HTTP origin):

```bash
python3 -m http.server 8000
# Open http://localhost:8000/apps/simulation-lab/
```

Node.js 22+ smoke and reproducible exploratory timing:

```bash
node --test apps/simulation-lab/core.test.mjs
LAB_ACTORS=256 LAB_TICKS=2000 node apps/simulation-lab/portfolio-bench.mjs
```

Before each browser benchmark, 560 deterministic and 200 seeded fuzz fixtures check equivalence against a Tick reference, unless preflight is explicitly disabled. Every measured workload is independently compared against the Tick reference as well. With attack output enabled, full per-actor attack Tick arrays are part of equality checking. The benchmark uses bounded multi-batch timing to mitigate coarse mobile clocks, reports median and p95, and flags timer-limited cases rather than presenting `Infinityx` as a valid speedup. Each result contains general plan build costs, algorithm choice counts, environment and settings. JSON, CSV, and copyable text reports are local to the browser; there is no automatic upload.

### Pages deployment

`.github/workflows/simulation-lab-pages.yml` assembles the static `apps/simulation-lab` directory at `/simulation-lab/` on the repository's GitHub Pages site and adds `build.json` with the exact Git revision. GitHub Pages Settings must use `Build and deployment → Source: GitHub Actions`. The workflow runs Node differential regression tests and checks the static artifacts. It does not deploy the game production build.

### Research constraints

- Synthetic model: fixed movement, deterministic attack cadence, periodic synthetic visibility, simultaneous damage to independent shared target groups. **No cross-group causal coupling**. Not an Enbu, Jinrei, Senritsu, CU, real Fog, Replay or WASM performance benchmark.
- `core.mjs` originates in `tools/senrei-bench/extended.mjs`; new variants are explicitly **Lab research extensions** and should only be promoted upstream after independent evaluation. Do not silently treat this Lab fork as the production algorithm authority.
- General plan decisions are valid only for the state and window whose relevant values were analyzed. In production, cache reuse must be protected by dependency versions and invalidation at exact causal boundaries.
- `capture=false` is final-state-only; `capture=true` allocates every attack event and incurs an output lower bound. The copyable report includes the mode; comparisons across output modes are not directly interchangeable.
- Mobile CPU throttling, JIT warmup, GC, tab visibility, battery state, and timer resolution influence results. Run independent trials; no scenario winner is a universal guarantee. Production acceptance needs native Rust/WASM and actual world/observation/CU/replay equality.
### Deterministic Tick projection and compact battle result (research extension)

`timeline.mjs` adds three separate operations without changing any of the 11 simulation strategies:

- `stateAt(initial,tick,method)`: recompute the one canonical state at any nonnegative Tick, without retaining a full Tick history. The same source and Tick must return the same state for all methods; `timeline.test.mjs` checks this against the Tick oracle at multiple horizons.
- `inspectTick(initial,tick,actorId)`: compare adjacent canonical states, explain the **synthetic attack gate** (disabled, not spawned, moving, dead target, cooldown, synthetic visibility, or attacked), and expose both before/after values. This is **not Jinrei rule evaluation**; the synthetic kernel has no Jinrei.
- `summarizeResult(initial,horizon)` / `streamResult(summary)`: produce a compact ordered projection containing each target's first engagement and exact defeat Tick, and aggregate results. Individual attacks are intentionally omitted from this **display** projection but remain in the underlying deterministic model.

The browser's independent Tick Inspector uses a Worker and reports a measured random-access query cost, serialized snapshot size, and summary size. The benchmark's 11-method timing path is unchanged; do **not** compare these inspector timings with isolated strategy timings as though they were one end-to-end workload. Summary creation can require repeated state queries (binary search for exact defeat Tick) and its cost is not included in the single-Tick query metric.

**Semantics:** Every Tick has a uniquely defined state even when its computation is skipped in the fast final-state path. Arbitrary-Tick reconstruction is presently on-demand re-execution from the initial fixture, not O(1), not an optimized checkpoint system, and not a production Enbu guarantee. First engagement/defeat are deliberately limited to the independent-target attack model; no decisions, CU, cross-group causal effects or production observation semantics are invented.

The result contract separates canonical state, optional on-demand inspection, and lightweight displayed summary. Future Rust/WASM work must first demonstrate full rule equivalence before adopting any compressed representation.

### Production Enbu (Rust/WASM) lane

The existing 11-method, 14-scenario synthetic benchmark and synthetic Tick
Inspector remain independent. A second UI section executes the real
`senkei-wasm` JSON adapter, calling `enbu::simulate` with valid Next snapshots
and tactical programs. It is **not a port of the 11 synthetic methods**.

The Pages build exports three deterministic production fixtures (1, 4, 16
ticks) from native Rust, builds the **same revision** of the production WASM,
and rejects publication if the complete native/WASM JSON response SHA-256
differs for any fixture. The browser Worker checks the same golden digest on
**every timed iteration**, discarding timings if any run fails.

This is production-core conformance and baseline measurement, not yet a
benchmark of new Enbu optimization strategies. The distinct semantics of the
synthetic JS kernel cannot be automatically transferred to actual Enbu/Jinrei
without proving state, CU, diagnostics, and replay equivalence.

To generate fixtures locally:

```sh
SENKEI_LAB_FIXTURE_OUT=/tmp/enbu-fixtures.json cargo test --locked --release \
  -p senkei-wasm --test preflight_dispatch export_enbu_lab_fixtures -- --exact
scripts/wasm/build.sh
```

The published GitHub Pages release is built by the dedicated
`simulation-lab-pages.yml` workflow; serving `apps/simulation-lab/` directly
without the build's `enbu-fixtures.json` and `wasm/` leaves the production lane
unavailable (the synthetic lane still works).

### Controlled Rust optimizer experiment (stacked change)

The production lane compares **two WASM modules built from one Enbu source**:
the default production reference and `--features lab-optimizations`.
The experimental feature implements (1) immutable RulePlan/termination ordering
hoisting, (2) one-per-Tick Squad movement/action-lock aggregate instead of
repeated hero scans, and (3) grouped shield contributions instead of quadratic
per-recipient accumulation, with an overflow fallback matching the original.

The native Rust golden response hash is checked for **both** modules on every
measurement. No optimization is enabled by default in the game. The browser
reports end-to-end per-dispatch timings for both and their ratio; scores are
descriptive, not proof of global superiority. Do not merge an experiment
showing incorrect state, CU, diagnostics, or replay.

Extended acceptance: 1/4/16/64/128 Tick Native/dual-WASM golden fixtures,
plus optimized native real-Jinrei canonical battlefield and individual combat
regression tests. The Pages gate prints interleaved 7-sample performance data
for both WASM builds, without treating noisy CI timing as an optimization pass.
