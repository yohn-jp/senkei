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