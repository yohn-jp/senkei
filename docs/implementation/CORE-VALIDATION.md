# Core validation and local runner

The native `senkei-runner` facade is the end-to-end local execution path. It
validates the bundled `senritsu::initial_package`, compiles both supplied
Jinrei programs against that verified plan, creates snapshots and a canonical
Enbu match context, then runs the match through the production Jinrei VM and
Enbu engine. It does not use a mock execution port.

## Run locally

From the repository root:

```sh
cargo run -p senkei-runner -- run examples/local-match.json
```

The command accepts a path or `-` to read one JSON input from stdin. The
default output contains the resolved `RulesetRef`, `MatchResult`, allowlisted
`PresentationReplay`, per-side compile CU estimates, and restricted local diagnostics. Use
`--public-only` to emit only the public result and replay:

```sh
cargo run -p senkei-runner -- run examples/local-match.json --public-only
```

The CLI runs offline after Rust dependencies have been fetched. It has no
server, account, network, or ticket requirement. The bundled ruleset provides
the defaults for omitted configuration values. A supplied configuration
replaces the default value for that named Senritsu field.

Input schema `1.0.0`:

```json
{
  "schema_version": { "major": 1, "minor": 0, "patch": 0 },
  "match_id": "local-example-001",
  "ruleset_ref": {
    "id": "senkei.initial",
    "version": { "major": 1, "minor": 0, "patch": 0 },
    "digest": "d74b06f37399873162a32f03b7b493e41f0b7e0dbe31201246d8113266700232"
  },
  "attacker": {
    "id": "attacker-demo",
    "revision": "1",
    "configuration": {},
    "initial_memory": {},
    "tactics": "senkei wait { action hold { when false, do move_forward(argmin unit in allies.units by unit.position then unit.id), }, }"
  },
  "defender": {
    "id": "defender-demo",
    "revision": "1",
    "configuration": {},
    "initial_memory": {},
    "tactics": "senkei wait { action hold { when false, do move_forward(argmin unit in allies.units by unit.position then unit.id), }, }"
  }
}
```

The CLI rejects unknown fields, unknown schema versions, failed package
validation, a `ruleset_ref` that does not exactly match the bundled package,
invalid configurations, failed tactic compilation, and Enbu simulation
errors. Input is limited to 4,000,000 bytes. Output follows the bundled
ruleset's output limit. The local response includes the selected ruleset ref
so a saved input/output pair records the package digest used for the match.

## Integration evidence

`cargo test -p senkei-runner` exercises the real initial package and real
compiled programs for deterministic repeated matches, tactical edits that
change the result, multi-tick movement, unit attrition, tower damage, and core
destruction. It also compiles all seven evaluated text sources in
`scenarios/campaign/source-fixtures.json` against the verified initial ruleset.
The scenario conformance check keeps that fixture synchronized with the
TypeScript campaign catalog. A schema-only unit-class enum extension is
validated separately from an engine compatibility declaration that lacks a
required transition primitive.

`cargo test --workspace` is the required full native core verification. The
WASM adapter is kept as a separate boundary crate; Enbu itself depends on the
shared model and execution port, not Jinrei.
