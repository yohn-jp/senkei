# Initial Senritsu campaigns

`catalog.ts` exports the beginner no-code preset and seven local NPC recipes.
The catalog is an input-data adapter: it uses the active `RulePackage` for
configuration and tactical-memory defaults, and stores no initial world,
simulation context, result, or browser-specific battle state. The app compiles
the player's draft and selected NPC draft, requests a canonical match context
from the core, then uses the regular simulation path.

The recipes require the `senkei.initial` 1.0.0 domain described in
[`specs/initial-senritsu/README.md`](../../specs/initial-senritsu/README.md). The factory checks the ruleset identity,
configuration fields, capabilities, observable collections, and symbols before
returning data. Tactics are ordinary Jinrei text and go through the same real
compiler as player input; the beginner preset is a versioned structured AST.

The catalog includes movement, core pressure, visible-unit targeting, tower
pressure, observation-based branching, medic support, and reserve deployment.
Custom configurations vary roster composition and lane/position while staying
inside the initial package's declared domains and limits.

Executable native/WASM cases belong beside this catalog as
`*.request.json`/`*.golden.json` pairs. Those are generated and reviewed only
after the real package, compiler, simulator, and WASM dispatcher are available;
fixtures must not substitute a test-only combat model for those components.
