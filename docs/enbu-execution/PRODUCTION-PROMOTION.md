# Production Enbu optimization promotion (2026-10-31)

## Scope and authority

The real local game builds Enbu through `scripts/wasm/build.sh`.
This is a **physical execution promotion**, not a change to Senritsu,
Jinrei, Enbu's canonical Tick semantics, logical CU, public/owner Replay,
or result serialization. The independent Reference (`000`) remains the
Native/WASM conformance oracle and explicit rollback option.

## Current production candidate: TCSRVGY (2026-10-31, not yet measured)

`scripts/wasm/build.sh` now selects TCSRVGY by default: the previously
measured TCSRVG features plus `lab-opt-replay-fusion`. The new kernel uses
the **actual current-Tick owner views** to prove public visibility membership,
then re-runs the original public field projection/allowlist. Neither owner's
private fields nor Fog globals are copied into the public replay. On quiet
nontrivial Ticks, it can defer the *precombat* owner projections until a real
combat/lifecycle event needs them; any unexpected event reconstructs those
views from a complete frozen World snapshot. Canonical state transitions,
Tick count, CU, observations and public/owner event ordering are unchanged.

This revision **does not have a completed Native/WASM result-equivalence or
wall-clock measurement** at the time of this edit. The Pages matrix builds
`Y` and `TCSRVGY` as independent real-WASM candidates, validates every
full JSON golden response, and verifies that the production binary equals
the TCSRVGY artifact byte-for-byte. The original `TCSRVG` portfolio is
retained on the **same revision** for a fair performance comparison and
rollback via `SENKEI_WASM_FEATURES`. A performance regression requires
reverting the default feature, regardless of isolated microbenchmark gains.
The earlier TCSRVG measured results below remain historical, not evidence
that TCSRVGY is faster.

## Measured promotion decision

The immutable reference measurement is [Simulation Lab Pages run 41057373991](https://github.com/yohn-jp/senkei/actions/runs/41057373991),
source revision `9bebc1b4390d33979c591c6242b9bf4ee204262a`,
job **Validate synthetic and real Enbu WASM benchmarks**, terminal
**SUCCESS**. The job compiled all **28** real Rust/WASM feature portfolios
and required **full Native JSON SHA-256 equality for every fixture and every
timed run**, not just the winner or final HP. Its seven fixtures cover
Next at 1/4/16/64/128 Tick, Quintet at 64 Tick and a 16-Tick clash.
Three timed samples per case and variant; Node.js Linux runner. Individual
numbers are descriptive, not a guarantee across devices.

| Actual Native-equivalent WASM fixture | Reference 000 median (ms) | Former production TCSRV (ms) | Promoted TCSRVG (ms) |
| --- | ---: | ---: | ---: |
| Next 1 Tick | 86.284 | 87.769 | 83.010 |
| Next 4 Tick | 198.288 | 197.313 | 179.991 |
| Next 16 Tick | 657.556 | 651.102 | 590.305 |
| Next 64 Tick | 2911.809 | 2932.934 | 2420.575 |
| Next 128 Tick | 6389.717 | 6407.164 | 5273.339 |
| Quintet 64 Tick | 3091.087 | 2959.780 | 2439.735 |
| Clash 16 Tick | 1421.671 | 1346.610 | 1306.930 |

Lab's equal-case geometric-mean speedups relative to its Reference:
TCSRV `1.012×`; **TCSRVG `1.144×`**; TCSRVS `1.029×`;
TCSRVHS `0.993×`; H-only `0.949×`. TCSRVG had zero cases
more than 2% worse than Reference in this run. The Fog probe cache
reuses only exact certified geometry/source signatures and separately
updates authorized exploration history. It does not cache enemy-only
private information into public outputs.

### Production implementation

- `scripts/wasm/build.sh` now builds TCSRVG as default: T+C+S+R+V+G.
- Explicit `SENKEI_WASM_FEATURES=reference` remains the complete
  independent fallback, without a game rule or protocol change.
- `simulation-lab-pages.yml` now verifies by bytewise `cmp` that the
  production WASM equals the same-revision TCSRVG lab artifact.
- The Lab defaults to TCSRVG vs `000` and still allows separate H, S,
  H+S and all 28 variants.
- `enbu-publication-smoke.mjs` executes the *actual* Lab Web Worker
  on the published assets and exact Native golden. The additional
  `enbu-browser-smoke.mjs` drives the published UI in Chromium and
  preserves JSON results and a rendered screenshot.
- The scheduler now compares certificate read sets against borrowed
  `WorldState` fields, eliminating per-Tick entity-ID cloning on
  a successful attack/reveal certificate revalidation. It retains exact
  equality, live entity membership, and canonical ordering; any
  unproved case still falls back to Reference phase.

### Verification status

**PASS**: prior-revision 28-variant Native/WASM exactness and seven-case
benchmarks at `9bebc1b`, as shown in the completed run above.

**NOT_CHECKED**: end-to-end new-revision production TCSRVG binary,
Native/WASM match, Lab Worker/Chromium publishing gates, real-device
timings, and user gameplay acceptance until the new commit's CI and
Pages jobs finish successfully. A queued, cancelled or ongoing run is not
PASS. The browser acceptance runs against local copies of the exact
published assets rather than an older live Pages revision.

**Not promoted**: W / TCSRVGW movement windows, and X / TCSRVGX graph-local attack partitions, remain behind explicit features until same-revision Native/WASM A/B conformance and actual wall-clock performance versus TCSRVG are verified. It is phase-local, not a general whole-Tick skip. General Hybrid H/HS, because that run records regressions
and no reliable end-to-end gain. A general whole-Tick scheduler that can
materialize all public/owner frames and CU while skipping arbitrary
Tick ranges is still not implemented; an optimized physical phase is
not a whole-Tick skip. A future promotion must show a new exactness
proof and improvement over the *current* TCSRVG production baseline,
not merely over `000`.

## Reproducible acceptance

```bash
# Native and WASM benchmark publication gate (builds 28 real Rust variants)
# .github/workflows/simulation-lab-pages.yml
node apps/simulation-lab/enbu-conformance.mjs
node apps/simulation-lab/enbu-publication-smoke.mjs
node apps/simulation-lab/enbu-browser-smoke.mjs
```

Those commands require the preceding workflow to have generated
`_site/simulation-lab/`, including its validated Native golden fixtures,
28 matching WASM binaries and exact revision manifest. They are not
standalone synthetic microbenchmarks.
