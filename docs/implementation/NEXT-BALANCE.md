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
- five independent Solo movement actions in one tick, plus eight full-length
  lineups and opening policies run to the 600-tick ruleset cap or base
  destruction. The set includes Solo against Quintet, 2+2+1 against 3+2, a
  jungle push against lane defense, a mirrored jungle and lane setup, and four
  base-assault cases that swap attacker/defender orientation;
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

The current eight-case strategic set was measured after the normal-bridge
center-entry fix with mechanics and ruleset version `2.0.0`, package digest
`31ce86db9492354e339ed4172ca19b4a5f92b076ea73fe36e0d8be1ce97eb481` (base
commit `84d0a25`). Its exact observed outcomes are:

| Scenario | Outcome | Final tick | Termination |
| --- | --- | ---: | --- |
| `balanced-solos-vs-quintet` | Draw | 600 | Time limit |
| `split-2-2-1-vs-3-2-role-mix` | Draw | 600 | Time limit |
| `jungle-push-vs-lane-defense` | Draw | 600 | Time limit |
| `mirrored-lane-defense-vs-jungle-push` | Draw | 600 | Time limit |
| `base-assault-solos-vs-quintet` | Draw | 600 | Time limit |
| `base-assault-quintet-vs-solos-mirrored` | Attacker victory | 417 | Base destroyed |
| `base-assault-duos-vs-trio-duo` | Draw | 600 | Time limit |
| `base-assault-trio-duo-vs-duos-mirrored` | Defender victory | 456 | Base destroyed |

The two base-assault victories destroy the opposing base in opposite
orientations. The report records each setup's visible event counts, final
digest, hero state, CU, outcome and termination class. These fixed opening
policies do not establish a win rate, general balance, or a balance threshold;
each Draw at tick 600 is only a time-limited observation. The separate
controlled real-Enbu base assaults verify base destruction by both sides. The
repeated determinism run is the same input and is not a separate matchup
sample. `tests/conformance/next-scenario-matrix.json` records these observed
values and their limits.

The fragile-Hero derivative is a lifecycle fixture, not a canonical tuning
claim. Camp respawn observes the neutral's HP before and on the configured
respawn tick; hidden neutral lifecycle fields are not read from the owner
projection. Longer-term objectives, broader composition coverage, and victory
rates remain unmeasured.

W9 currently covers minion vision as a movement modifier and checks that the
initial public fog view does not reveal distant enemies. It does not yet run a
W9-level observation-boundary or reveal-expiry scenario; those rules have
separate W2 unit coverage. W9 does not assert tactical value from visible area,
XP, damage, or a single matchup. Logical Jinrei CU is reported separately from
physical runtime cost.
