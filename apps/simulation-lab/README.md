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

### Production Enbu matrix: thirty-five real Rust/WASM builds

The existing **11 strategy / 14 scenario synthetic** benchmark and independent
synthetic Tick Inspector remain unchanged and are never used to claim production
speedups. The production lane compiles **thirty-five** distinct WASM binaries from the
**same production Enbu Rust source** and JSON ABI: the original eight T/C/S
factorial configurations plus R, V, R+V, T+C+S+R+V, P (one-Tick Planned candidate index), A (Arithmetic phase dispatcher), F (frozen snapshot reuse), FPA and G (certified Fog probe reuse), TCSRVG, the independent Y / TCSRVGY Replay-fusion variants, and O / TCSRVGO variants. The original T/C/S
factorial varies these independent Cargo features:

| Bit | Feature | Work eliminated |
| --- | --- | --- |
| T (4) | `lab-opt-termination` | Repeated termination sort and compact trace mode computation |
| C (2) | `lab-opt-cohort` | Repeated per-hero squad membership/lock/movement scans during basic attack selection |
| S (1) | `lab-opt-shields` | Repeated per-recipient shield contribution sums |

`000` is the unoptimized canonical Reference used by Native golden
and all differential comparisons. `111` is the historical
`lab-optimizations` alias; the other subsets are real Enbu builds.
The experimental `TCSRVGAS` variant isolates the bounded real-Enbu Arithmetic
candidate timeline and canonical attack Scheduler on top of the previous production `TCSRVG`.
It retains every Tick's Jinrei, CU, Fog, full Replay and canonical damage;
only certified basic-attack selection is compressed. It is not promoted by
default. The Lab defines its build and future full-response golden checks;
no performance result is implied by registration.

The production `scripts/wasm/build.sh` now compiles the **unverified TCSRVGY candidate**
(TCSRVG plus Replay-fusion) by default, retaining the measured TCSRVG as a
same-revision comparator. The full golden and wall-clock results of TCSRVGY
must be checked before calling it an improvement. `SENKEI_WASM_FEATURES=reference` forces
the original Reference WASM for diagnostics. TCSRV previously delivered a
1.049× equal-case geometric mean on seven full-output real WASM cases (prior promotion data; now eight with Next Behavior)
(no regressed case in that run); these timings are source- and environment-
specific, not a universal speedup guarantee. The Lab builds and verifies
`000` independently rather than copying the optimized production binary.
Any promoted combination is the **same Rust code**, not synthetic JS.

The Pages workflow builds the production WASM and all thirty-five benchmark variants
from one Git revision, publishes a SHA-256 and byte-size manifest, and rejects
publication unless **every variant** reproduces **all native Rust golden JSON
responses** (the full response, including replay, CU, diagnostics, and output
ordering). Browser measurements repeat this exact check on **every timing
sample** and fail closed. Eight native Next fixtures cover 1, 4, 16, 64, and 128 Tick, plus an assembled Quintet at 64 Tick and a same-node combat clash at 16 Tick and a Next Behavior scenario at 16 Tick,
and the workflow runs additional real-Jinrei native behavioral regressions.
These fixtures are a baseline, **not exhaustive gameplay equivalence**.

#### Measurements and ranking

The Worker can run all thirty-five variants or the baseline against one selected
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

### Production Rust algorithm reductions (R / V / P)

The architecture for migrating beyond all-Tick execution into a proof-gated
Hybrid Execution Engine is documented separately in
[Enbu Hybrid execution contracts](../../docs/enbu-execution/README.md).
R/V, P and A reduce work inside the existing Tick engine. P is a **real
snapshot-scoped Planned combat-selection kernel**. S adds a real cross-Tick
Event Scheduler with exactly certified subphase idle windows; every Tick's
observable obligations continue to materialize. The general full-Tick window
skipping and arbitrary replay reconstruction design remains a separate proof
problem; this matrix cannot certify it merely through matching outputs.

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
- `X` / `lab-opt-spatial`: deterministic frozen-snapshot combat partition by exact Node or unordered Edge, reused in both the Next movement auto-stop check and basic attack selection. Invalid topology/edge coordinates remain rejected by the **original** attack predicate; owner diagnostics and the complete simultaneous combat path remain authoritative. Adds no time skipping. `TCSRVGX` combines this candidate search with shipped TCSRVG for paired Native-equal WASM comparison.
- `W` / `lab-opt-movement-window`: canonical Next P7 cross-Tick MovementWindow, which validates exact entity membership, type, HP liveness, owner, Squad, goal, edge and explicit movement markers before reusing its ordered Active Set. Route-driven waypoints bypass the window. `TCSRVGW` combines this experimental kernel with the incumbent measured TCSRVG, without automatically promoting it.
- `S` / `lab-opt-scheduler`: physical cross-Tick phase scheduling for two independently certified domains. The basic-attack frontier records the earliest possible next attack readiness and skips combat target/cohort traversal on intervening certified Ticks; the reveal frontier skips expiration scans until the first due deadline. Both compare their complete causal read sets each Tick (not an unsafe hash) and invalidate scheduled events on entity set, HP/attack/range/readiness or reveal-timer changes. Generation-checks, stable ordering, stale compaction and bounded queue capacity are enforced. Jinrei, RulePlan transitions, Fog, public/owner Replay, skills, support effects and logical CU continue on **every** Tick. `TCSRVS` and `TCSRVHS` measure the time-bound domains independently and alongside Phase Hybrid. No end-to-end speedup is claimed without real WASM evidence.
- `H` / `lab-opt-hybrid`: match-owned Rust Hybrid portfolio combining canonical Reference, sparse Arithmetic, dense Planned candidate selection, the proof-gated attack/Reveal Event Scheduler, MovementWindow Active Set, frozen-snapshot reuse, exact graph-local spatial candidate partition, current-Tick observation index, in-place navigation, frozen visibility frontier and compiled passive/respawn lifecycle. The scheduler's exact current-Tick readiness proof now prevents a duplicate global dispatcher classification on dense due batches. Planned starts at 48+ entities and standalone Arithmetic classification at 64+; owner decision traces remain fully visited. It does not skip Jinrei, Replay or whole Ticks. `TCSRVH` measures H combined with the TCSRV base. `TCSRVHS` is the historical explicit S mask, now an effective-feature duplicate of TCSRVH because S is already part of H.
- `lab-opt-passive-lifecycle`: one-match immutable Hero passive plan, applied together with exact Monster respawns in one in-place current-World pass; avoids two extra Hero-ID scans, repeated learned-skill sets and linear definition searches. Included in H; explicit standalone Cargo/WASM feature is available for conformance without adding an extra Lab binary to the 33-build matrix.
- `I` / `lab-opt-inplace`: PR #71's per-unit in-place navigation state update, retaining the immutable pre-navigation freeze. It removes redundant entity clones under an independent benchmark feature.
- `B` / `lab-opt-frontier`: PR #71's snapshot-scoped indexed combat visibility frontier, lazily compiled for dense eligible attack/hold checks. The original target predicate, stable order, fog authorization and owner trace remain authoritative. `TCSRVIB` measures I+B on top of the previously measured best production strategy set.
- `O` / `lab-opt-observation`: build one deduplicated source set per side and observation Tick when the actor population is at least 16, and reuse it for all RulePlan visibility-field, collection, and nested derived-value eligibility checks. All checks remain current-Tick, full Jinrei/CU and owner replay are retained. `TCSRVGO` benchmarks this path on top of TCSRVG.
- `Y` / `lab-opt-replay-fusion`: reuse exact authorized owner-frame visibility when constructing public Replay; defer precombat owner views behind a frozen same-Tick snapshot when events are unlikely, and rebuild them upon any unexpected event. Full replay and private-state rules remain intact.\n- `G` / `lab-opt-fog-cache`: retain exact node/edge visibility booleans across Ticks while the same side, source graph positions/radii, map nodes/edges, and vision semantics are unchanged. Any changed dependency invalidates the certificate. Every Tick's Fog exploration, owner facilities, Jinrei/CU, and replay are still materialized. `TCSRVG` tests G combined with the prior measured best five-feature set.
- `F` / `lab-opt-frozen`: omit provably redundant World clones and idle unit movement preparation; `FPA` combines F, Planned and Arithmetic. Neither physically skips entire Ticks.
- `A` / `lab-opt-arithmetic`: same-Tick dispatcher proving that no basic attacks are due or selecting at most eight ready combatants when they are sparse. With `S` enabled, the actual Enbu `BasicAttackFrontier` additionally compiles bounded 128-Tick periodic readiness schedules using exact Scan (small), Heap (sparse), and Bucket (dense) due-batch kernels. Each current frozen World revalidates the complete ordered source dependency set before dispatch; missed hits, new combatants, death, owner/clock/interval changes and horizon expiry revoke the prediction. Only basic-attack *candidate work* is elided; target legality, damage, simultaneous effects, every Replay frame and Jinrei/CU remain canonical. `TCSRVGAS` isolates A+S on current production TCSRVG. General long-window first-lethal damage commits and whole-Tick skipping remain non-dispatched pending a stronger full-output causal proof.
- `P` / `lab-opt-planned`: lazily compile a single frozen combat-phase target
  candidate partition and shared source-visibility set; apply the **existing**
  target eligibility and distance/tie-break for every candidate. Original
  per-actor full scan remains the Reference path. This is not the TS
  synthetic `planned` executor nor a multi-Tick acceleration.

The 35 real-WASM candidates include the prior 8-way T/C/S matrix,
R, V, R+V, the combined T+C+S+R+V build, P (Planned candidate selection), and A (Arithmetic phase dispatcher). Each must reproduce the
complete native Rust SHA-256 across all 8 fixture scenarios to publish. The
3-factor T/C/S marginal-effect study continues to use only the original eight
combinations; R/V are compared directly by case, since extrapolating a full
five-factor experiment from only fourteen builds would be invalid.
