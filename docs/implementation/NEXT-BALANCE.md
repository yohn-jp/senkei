# Next balance and conformance report

## Current status

The W9 package checks and headless partition scenarios have been authored on
baseline `7c1485a`, but that checkout does not yet publish
`senritsu::next_package()` or `next_engine_compatibility()`, or provide a
Next-aware simulation path. The tests have not been compiled or run. No Next
battle has been run, so this file makes no claim about balance, conformance,
determinism, or adapter parity.

After the producer and runtime APIs are published, run:

```sh
bash scripts/balance/run-next.sh
```

The integration test will use the validated Senritsu package and real Enbu
simulation path. Its machine-readable report will record the package version,
content digest, case IDs, input differences, and observed outcomes. The suite
must compare distinct setups, policies, or orientations. Replaying an identical
deterministic input checks reproducibility; it does not add a win-rate sample.

## Planned coverage

The executable suite is tracked by
[`tests/conformance/next-scenario-matrix.json`](../../tests/conformance/next-scenario-matrix.json).
The matrix covers catalog and five-Hero validation; all seven initial squad
partitions; the lane/jungle, minion-vision, and squad-size movement grid;
maturation and explicit regroup; hidden information; jungle and XP scenarios;
death and Solo respawn; rejected inputs and intents; public replay
confidentiality; and deterministic native/WASM parity once the real WASM
adapter supports this ruleset. The current test code covers package/catalog
invariants, the agreed movement-factor arithmetic, version compatibility,
all seven partition initializations through Enbu, repeat determinism, and
public-output confidentiality. Remaining matrix cases are pending runtime
integration and adapter support.

## Limits on conclusions

The suite will distinguish mechanical conformance from balance observations.
The agreed speed multipliers, five-Hero roster size, catalog size and
front/rear split, equal XP shares among eligible Heroes, immediate departure
on death, and Solo respawn can be asserted directly. Outcomes involving
unsettled reward values, eligibility rules, rounding, path geometry, maturity
curves, combat values, or respawn timing will be reported without invented
pass thresholds.

No general strength or win-rate claim is justified by one matchup. Any later
balance conclusion must identify the package version and digest, list the
distinct lineups and scenario controls compared, and state the remaining
untested mechanics. Logical Jinrei CU and physical runtime cost are separate
measurements.
