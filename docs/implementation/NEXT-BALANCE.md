# Next tactical measurements and conformance report

## What the suite measures

The suite consumes `senritsu::next_package()` and
`next_engine_compatibility()`, validates that package, and runs matches through
Enbu's published simulation loop. It does not implement a second simulator.
The exact package version and canonical digest, cases, outcomes, termination
ticks, visible combat events, and per-side logical CU are written to
`target/next-balance/latest.json`. The JSON separates `fixed_regression`
evidence from a `tactical_effectiveness_matrix` of distinct long-run lineups.
A repeated identical input remains a regression check, never another matchup
sample.

Run the full headless and adapter suite with:

```sh
bash scripts/balance/run-next.sh
```

The command runs the Enbu scenarios in release mode, emits seven adapter
request fixtures, and compares complete native, repeated-native and compiled
WebAssembly dispatcher responses. Cases cover a public match, a controlled
canonical public/owner battle, a full 600-tick owner-local battle above 32 MB,
and invalid engine, roster and ruleset requests. Public-only requests use
`include_diagnostics: false` and must omit owner replay and diagnostics. Owner
requests explicitly authorize attacker-local replay/diagnostics; opponent
private state remains excluded. Exact CU and full response hashes are checked
for reproducibility and cross-target agreement.

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

The current eight-case tactical comparison set was measured with mechanics and
ruleset version `2.0.0`, package digest
`c045f65b261939c866f7a08c18fe4d0dca24c81a0fdb07a4728f50eeb74e688f` (Engine
1.3 compatibility, required by `6e7354e`). The prior outcome pins were stale
after the canonical World alignment in `8ee22e7`: battlefield observations now
use World bridge site IDs (`bridge.top`, `bridge.mid`, `bridge.bot`) and the
Jungle ford delay starts at the World-projected crossing interval. This changes
route selection and fixed-input match trajectories through stable ordering; no
combat, damage, economy, or duration values were retuned. The measurements are
rerun against the package above, and the exact observed outcomes are:
The authored source World is
[`initial-battlefield.json`](../../crates/senkei-world/fixtures/initial-battlefield.json);
the matching runtime projection is covered by
[`BATTLEFIELD-CANONICAL.md`](BATTLEFIELD-CANONICAL.md).

| Scenario | Outcome | Final tick | Termination |
| --- | --- | ---: | --- |
| `balanced-solos-vs-quintet` | Draw | 600 | Time limit |
| `split-2-2-1-vs-3-2-role-mix` | Draw | 600 | Time limit |
| `jungle-push-vs-lane-defense` | Draw | 600 | Time limit |
| `mirrored-lane-defense-vs-jungle-push` | Draw | 600 | Time limit |
| `base-assault-solos-vs-quintet` | Defender victory | 568 | Base destroyed |
| `base-assault-quintet-vs-solos-mirrored` | Attacker victory | 447 | Base destroyed |
| `base-assault-duos-vs-trio-duo` | Attacker victory | 593 | Base destroyed |
| `base-assault-trio-duo-vs-duos-mirrored` | Draw | 600 | Time limit |

The base-assault cases include base destruction in both orientations. Each
terminal owner-frame structure snapshot asserts the destroyed base HP is zero
and the surviving base remains positive; the public structure snapshot remains
separately recorded under fog. The report records each setup's visible event counts, final
digest, hero state, CU, outcome and termination class. These fixed opening
policies do not establish a win rate, general balance, or a balance threshold;
each Draw at tick 600 is only a time-limited observation. The separate
controlled real-Enbu base assaults verify base destruction by both sides. The
repeated determinism run is the same input and is not a separate matchup
sample. `tests/conformance/next-scenario-matrix.json` records these observed
values and their limits. The generated report's `fixed_regression` section
contains catalog, partition, movement, lifecycle, XP, adapter, and invariant
cases; `tactical_effectiveness_matrix` contains the eight distinct long-run
lineups. Neither group claims a representative win rate.

The fragile-Hero derivative is a lifecycle fixture, not a canonical tuning
claim. Camp respawn observes the neutral's HP before and on the configured
respawn tick; hidden neutral lifecycle fields are not read from the owner
projection. Longer-term objectives, broader composition coverage, and victory
rates remain unmeasured.

## Authored campaign clear

The first authored NPC was also run through the production `senkei-runner` and
Enbu path with a distinct, valid quintet base assault from the normal default
player start. On the same package digest above, the player destroyed the
opposing base at tick 447 (`AttackerVictory`, `base_destroyed`); the NPC
accepted 20 movement intents.
This fixed clear proves that the first progression step can unlock within the
600-tick package limit. It is one tested input, not a win-rate estimate.
[`campaign-clear.json`](../../docs/evidence/next/campaign-clear.json) records
the exact setup and outcome.

The suite covers minion vision as a movement modifier and checks that the
initial public fog view does not reveal distant enemies. Separate actual-Enbu
integration tests cover hidden-bridge Unknown handling, zero unauthorized
energy spend, and identical reveal expiry in owner/public replay. The suite
does not assert tactical value from visible area,
XP, damage, or a single matchup. Logical Jinrei CU is reported separately from
physical runtime cost.
