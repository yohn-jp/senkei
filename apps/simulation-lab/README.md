# Senkei Simulation Lab

A static, client-side **synthetic** strategy benchmark. GitHub Pages URL (once Pages deploy is enabled): `https://yohn-jp.github.io/senkei/simulation-lab/`.

The entire test runs on the visiting browser in a module Web Worker, without a server or telemetry. The page measures the seven algorithms and fourteen scenarios from `tools/senrei-bench/extended.mjs`. See `core.mjs` (browser-safe snapshot of the same synthetic model). The measurements **do not benchmark production Rust Enbu, Jinrei, logical CU, or WASM**. Never label the values as real game performance.

## Local use

Run a local HTTP server from the repository root (module Workers require an HTTP origin):

```bash
python3 -m http.server 8000
# Open http://localhost:8000/apps/simulation-lab/
```

Quick regression test (Node.js 22+):

```bash
node --test apps/simulation-lab/core.test.mjs
```

The site's start action first runs 560 deterministic fixtures and 200 seeded fuzz fixtures against the naive Tick algorithm (unless preflight is disabled). For every measured workload, each method is checked against the Tick reference again. With full event output enabled, the attack Tick arrays are part of this equality check. Workload cloning and result comparison happen outside the timed section. Measurements include raw sample times and median / p95, with a short warmup and batch timing for very fast operations. Runs can be interrupted by terminating the Worker; partial results are tagged `complete: false` in JSON. Both CSV and JSON are generated locally. No results are uploaded automatically.

## GitHub Pages deployment

`.github/workflows/simulation-lab-pages.yml` deploys only the contents of this directory (not the heavy production game build) to the repository Pages site, under `/simulation-lab/`. `simulation-lab/build.json` is generated during build with the exact revision. The workflow runs a Node differential test and validates the exported static files before uploading.

GitHub repo **Settings → Pages → Build and deployment → Source: GitHub Actions** must be selected once by a repository administrator if it is not already enabled. The workflow requires `pages: write` / `id-token: write`. Normal PR checks and the existing CI are not modified. GitHub-hosted Pages URLs may take time to propagate after a successful deployment.

## Constraints and next extension

- Model: independent movement, fixed destinations, periodic synthetic visibility, simultaneous damage per shared target, independent target groups. No cross-group causal interaction, Jinrei evaluation, CU, real Fog, obstacles, Replay, or dynamic orders.
- `core.mjs` should remain traceable to `tools/senrei-bench/extended.mjs`. Sync changes deliberately and require differential verification before updating.
- For production-valid benchmarks, add a separate **Enbu WASM mode** and compare actual Enbu outputs/semantics without reusing synthetic speedup results.
- Browser measurements vary with CPU throttling, JIT warmup, GC, tab visibility, battery state and mobile thermal limits. Export environment/settings; run multiple independent trials for decisions.