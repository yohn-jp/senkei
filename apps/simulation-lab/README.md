# Senkei Simulation Lab

Client-side research and real Enbu WASM benchmark: https://yohn-jp.github.io/senkei/simulation-lab/ . All computation runs in a Web Worker. The original synthetic algorithms and the production Rust/WASM lane remain separate; no telemetry or server simulation is involved.

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

### Production Enbu matrix: eight real Rust/WASM builds

The existing **11 strategy / 14 scenario synthetic** benchmark and independent
synthetic Tick Inspector remain unchanged and are never used to claim production
speedups. The production lane compiles **eight** distinct binaries from the
**same production Enbu Rust source** and JSON ABI, toggling these independent
Cargo features:

| Bit | Feature | Work eliminated |
| --- | --- | --- |
| T (4) | `lab-opt-termination` | Repeated termination sort and compact trace mode computation |
| C (2) | `lab-opt-cohort` | Repeated per-hero squad membership/lock/movement scans during basic attack selection |
| S (1) | `lab-opt-shields` | Repeated per-recipient shield contribution sums |

`000` is the production reference. `111` is the historical
`lab-optimizations` all-on alias; all other six subsets are actual compiled
Enbu, not synthetic stand-ins. No optimization is enabled by default in the
game. Any promoted combination is the **same Rust code and feature set**,
not a second JS implementation.

The Pages workflow builds the production WASM and all seven other variants
from one Git revision, publishes a SHA-256 and byte-size manifest, and rejects
publication unless **every variant** reproduces **all native Rust golden JSON
responses** (the full response, including replay, CU, diagnostics, and output
ordering). Browser measurements repeat this exact check on **every timing
sample** and fail closed. Seven native Next fixtures cover 1, 4, 16, 64, and 128 Tick, plus an assembled Quintet at 64 Tick and a same-node combat clash at 16 Tick,
and the workflow runs additional real-Jinrei native behavioral regressions.
These fixtures are a baseline, **not exhaustive gameplay equivalence**.

#### Measurements and ranking

The Worker can run all eight variants or the baseline against one selected
variant, for all fixtures or one Tick count. Each variant is instantiated once,
then run in alternating, rotating order with two warmups. Median/p95,
input-transfer, WASM dispatch, output-transfer, WebAssembly linear memory,
binary size, module fetch/compile/instantiation times, and each complete
response digest are included in the downloadable JSON.

**WASM dispatch** still includes Rust-side JSON parse and result serialization:
it is *not* an isolated pure-Enbu timing. The host-side input and output phases
are measured separately from dispatch, but internal Rust phases require
additional authoritative instrumentation to distinguish. Statistics are
descriptive: aggregate ranking uses the equal-case geometric mean of
per-case median baseline/candidate time ratios, with the worst-case ratio
and number of regressions visible. Small changes require repeated experiments
on a controlled device before adoption. Relative ratios are only meaningful
for **identical native-authored fixtures and output contracts**.

The Node CI gate performs a smaller interleaved timing pass, and stores its
machine-specific `enbu-ci-report.json` with all binary hashes, verified cases,
and performance results in the Pages artifact; it must never infer browser
speedups from CI measurements. The browser suite may be cancelled without
publishing or showing partial statistics.

#### Local workflow

```sh
node --test apps/simulation-lab/*.test.mjs
SENKEI_LAB_FIXTURE_OUT=/tmp/enbu-fixtures.json cargo test --locked --release \
  -p senkei-wasm --test preflight_dispatch export_enbu_lab_fixtures -- --exact
bash scripts/wasm/build.sh
# Each feature set is a separate WASM binary:
cargo build --locked --release --target wasm32-unknown-unknown -p senkei-wasm \
  --lib --features lab-opt-termination,lab-opt-cohort
```

Local direct file serving of `apps/simulation-lab/` **cannot** load the real
WASM suite because its fixture/manifest/revisioned WASM artifacts are generated
by the Pages workflow. Synthetic algorithms still run independently. Use the
published page, or serve the complete assembled `_site/` build output.

A **full-factorial marginal-effect report** measures T, C and S independently:
for each feature, it compares the ON and OFF versions in each of the four
contexts formed by the other two features, on every selected real Enbu case.
The geometric mean of those paired *configuration* ratios is shown beside
best/worst and regressed comparisons. These are descriptive cross-build
statistics, not causal attribution to isolated instructions or confidence
intervals; rerun on a quiet device before promoting a marginal advantage.

### Production Rust algorithm reductions (R / V)

Unlike disabling output paths or measuring synthetic simulations, these flags
change the computation in the authoritative Enbu Tick engine:

- `R` / `lab-opt-route`: per-search adjacency index instead of scanning and
  re-sorting every map edge on every graph vertex; one actor/cohort speed
  derivation per search; one cached travel cost per traversed edge; a dynamic
  blocked-edge overlay rather than cloning the BattleMap per route. Tie ordering,
  dynamic bridge legality, and saturating arithmetic are retained.
- `V` / `lab-opt-visibility`: batch and deduplicate the actual authorized
  vision sources before each public/owner replay projection; all required
  views are still produced.

The 12 published real-WASM candidates include the prior 8-way T/C/S matrix,
R, V, R+V and the combined T+C+S+R+V build. Each must reproduce the
complete native Rust SHA-256 across all 7 fixture scenarios to publish. The
3-factor T/C/S marginal-effect study continues to use only the original eight
combinations; R/V are compared directly by case, since extrapolating a full
five-factor experiment from only twelve builds would be invalid.
