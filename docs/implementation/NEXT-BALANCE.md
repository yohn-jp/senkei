# Next balance and conformance report

## What the suite measures

The W9 suite consumes `senritsu::next_package()` and
`next_engine_compatibility()`, validates that package, and runs matches through
Enbu's published simulation loop. It does not implement a second simulator.
The exact package version and canonical digest, cases, outcomes, termination
ticks, visible combat events, and per-side logical CU are written to
`target/next-balance/latest.json`.

Run the full headless and adapter suite with:

```sh
bash scripts/balance/run-next.sh
```

The command runs the Enbu scenarios in release mode, emits four adapter request
fixtures, and compares their native dispatcher results with the compiled
WebAssembly dispatcher. The adapter cases include a 120-tick public match with
five opening move actions per side and invalid engine, roster, and ruleset
requests. They use `include_diagnostics: false`; the public result must omit
the restricted owner replay and diagnostics. Identical native repeats are
checked only for reproducibility.

## Executable coverage

The current test code and
[`tests/conformance/next-scenario-matrix.json`](../../tests/conformance/next-scenario-matrix.json)
cover:

- all twelve catalog entries and their skill paths, all seven five-Hero squad
  partitions, duplicate or undersized rosters, unknown skill paths, and
  incompatible engine or mechanics versions;
- twenty real movement cases across lane and jungle terrain, friendly minion
  vision on or off, and squad sizes one through five; separate controls check
  that overlapping friendly vision does not stack and enemy minion vision
  grants no movement bonus;
- five independent Solo movement actions in one tick, plus four distinct
  lineups and opening policies run for up to 120 ticks, including Solo against
  Quintet, 2+2+1 against 3+2, a jungle push against lane defense, and a
  mirrored jungle and lane setup;
- real Enbu merge, split, and regroup intents, followed by maturity checks;
- catalog-derived neutral monster XP rewards with one, two, and five eligible
  Heroes, equal fixed-point shares, and no XP for Heroes outside the eligibility
  radius;
- a controlled neutral camp kill and observation of the defeated camp through
  the tick before its catalog-configured respawn;
- Hero death, immediate squad departure, respawn at the owning base, Solo
  membership, and no automatic rejoin, using a separately versioned test-only
  content derivative that makes one Hero fragile;
- frozen public output confidentiality, exact-run reproducibility, and native
  versus real WebAssembly public and negative-request parity.

The movement cases assert the versioned factors against observed one-tick edge
progress. The neutral and XP scenarios derive their reward and camp timing from
the validated package. The report records owner-local XP and lifecycle values
where needed; public adapter comparisons use only public responses.

## Observations and limits

The four current 120-tick lineup scenarios all reach their configured tick cap
with `Draw`. The report marks these as time-limited observations and records
each setup's visible event counts, final digest, hero state, and CU. They do
not establish a win rate, general balance, or a balance threshold. The repeated
determinism run is the same input and is not a separate matchup sample.

The fragile-Hero derivative is a lifecycle fixture, not a canonical tuning
claim. Camp respawn observes the neutral's HP before and on the configured
respawn tick; hidden neutral lifecycle fields are not read from the owner
projection. The full-match set ends at 120 ticks, so longer-term objectives,
high-level progression, and victory rates remain unmeasured.

W9 currently covers minion vision as a movement modifier and checks that the
initial public fog view does not reveal distant enemies. It does not yet run a
W9-level observation-boundary or reveal-expiry scenario; those rules have
separate W2 unit coverage. W9 does not assert tactical value from visible area,
XP, damage, or a single matchup. Logical Jinrei CU is reported separately from
physical runtime cost.
