# Verification suite

The Rust crates and the browser app are the only battle oracle. A scenario is
never considered successful because a fixture matches a mock implementation.
Golden outputs are captured from the real `initial_package` → Jinrei compile →
Enbu simulate path, then run through the native and browser/WASM adapters.

## Required conformance matrix

`conformance/matrix.json` maps these required properties to stable case IDs.
The cases follow the contracts in `docs/implementation/CORE-API.md`,
`docs/implementation/WEB-API.md`, and the design documents cited below.

1. **Determinism:** the same validated inputs produce byte-equivalent result,
   replay, logical CU, and ordered diagnostics on repeated native runs
   (`DELIVERY.md`, `SIMULATION.md`).
2. **Native/WASM parity:** each golden input is sent through native Rust and
   the real compiled WASM adapter; compare result, replay, CU, and ordered
   diagnostics (`CORE-API.md` acceptance checks).
3. **Editor/compiler equivalence:** equivalent text and structured-AST
   tactics produce the same intents, battle result, and CU
   (`JINREI-GRAMMAR.md`, `TACTICS.md`).
4. **No undeclared first-mover advantage:** run a symmetric case in both
   attacker/defender orientations and compare the defined outcome
   (`SIMULATION.md`).
5. **Simultaneous conflict ordering:** contested actions, equal priorities,
   and target ties follow explicit stable tie-break rules, independent of
   declaration or map iteration order (`CORE-API.md`, `SIMULATION.md`).
6. **Finite execution:** max-tick termination, boundary values, intent limits,
   and CU exhaustion follow their declared deterministic rules
   (`SIMULATION.md`, `EXECUTION.md`).
7. **Input rejection:** malformed programs, unsupported versions, bad digests,
   oversized values, and incompatible snapshots fail explicitly before a
   battle (`CORE-API.md`, `JINREI-GRAMMAR.md`).
8. **Capability/primitive validation:** unknown capabilities, unsupported
   primitives, illegal arguments, and missing arbitration order are rejected
   by the validators (`CORE-API.md`, `SENRITSU.md`).
9. **Observation boundary:** unknown is preserved separately from known null;
   hidden values are not readable through an opponent observation
   (`CORE-API.md`, `SENRITSU.md`).
10. **Public output boundary:** public result/replay do not serialize
    restricted diagnostics, private tactic input, or reproduction context
    (`CORE-API.md`, `ONLINE.md`).
11. **Ruleset extensibility boundary:** a compatible data-only ruleset change
    is accepted without game fields being hard-coded in Jinrei/Enbu, while a
    new unsupported transition primitive is rejected (`COMPONENTS.md`,
    `SENRITSU.md`).
12. **Playable local loop:** in a real browser with the real WASM module, a
    new player can start from a no-code preset, edit/compile, battle an NPC,
    inspect analysis, save, reload, rematch, and complete the workflow offline
    after initial assets are cached (`PRODUCT.md`, `DELIVERY.md`,
    `WEB-API.md`).

The matrix is a coverage contract, not a report that every property already
passes. A property is only marked implemented when an executable test drives
the real owning component. Any phase that is not present in the checkout is
reported as pending; CI must not turn it green with a placeholder result.

## Scenario data

`../scenarios/campaign/` contains playable, versioned NPC inputs and tutorial
presets. The package's actual schema is authoritative: case fixtures are
validated against `senritsu::initial_package()` before being used, and tactic
source is compiled with the real Jinrei compiler. Do not introduce a parallel
combat model in TypeScript, Python, or test-only Rust.

## Browser test dependencies

Browser runner setup is isolated under `tests/browser/`. It owns Playwright
and browser binaries; the application package remains owned by `apps/web`.
The browser suite must load the production-built app and actual WASM artifact.
It must not stub `CoreClient`, Workers, IndexedDB, compilation, or simulation.

After scenarios and the WASM adapter are present, compare the same committed
`*.request.json` simulation envelopes like this:

```sh
bash scripts/wasm/build.sh
node tests/conformance/compare-adapters.mjs scenarios/campaign/<case>.request.json
```

The comparator also accepts multiple request files. With no arguments it
recursively finds `*.request.json` under `scenarios/`; it errors when none are
found. It sends every envelope to the real native dispatcher and invokes the
same exported JSON dispatcher in the compiled WASM module. It compares the
complete response envelope after sorting object keys, while preserving array
order.

Browser smoke uses the production preview and the cached public WASM artifact:

```sh
npm ci
bash scripts/wasm/build.sh
npm run build
npm ci --prefix tests/browser
npx --prefix tests/browser playwright install --with-deps chromium
npm run test:e2e --prefix tests/browser
```
