# NPC scenarios and presets

`campaign/catalog.ts` exports two builders for the browser App:

- `createCampaignScenarios(ruleset)` returns NPC draft recipes with campaign
  metadata, challenge criteria, difficulty, and tactics source.
- `createBeginnerPreset(ruleset)` returns a no-code structured-AST starter
  draft that advances the first friendly unit. Its configuration and tactical
  memory come from the supplied package's schema defaults.

Both builders consume the actual `RulePackage` returned by
`CoreClient.initialRuleset()`. They fail if the initial package omits a field,
capability, collection, or symbol that a recipe uses. They do not create a
world, match context, or simulation snapshot. The App compiles the player and
NPC drafts through `CoreClient`, then requests the canonical match context;
Enbu applies the package's world initialization projection.

The first campaign has seven NPC archetypes across three difficulty levels:

| Difficulty | Scenario archetypes |
| --- | --- |
| Beginner | Advance one unit; pressure the opposing core |
| Standard | Intercept a visible unit; attack a visible tower |
| Expert | Withdraw when the core is wounded; support an ally; deploy a timed reserve |

The tactic input uses the package's real `allies.*` and `enemies.visible_*`
collections. It is compiled by Jinrei; no test-only battle rules or local
outcome calculations are included here.

`campaign/source-fixtures.json` stores the evaluated text of the seven recipe
builders for the Rust runner's direct compile tests. The fixture is checked
against `catalog.ts` using the package returned by the native core dispatcher.
The same generator writes the immutable simulation request inputs used by
native/WASM goldens:

```sh
node tests/conformance/generate-scenario-inputs.mjs --check
node tests/conformance/generate-scenario-inputs.mjs --write-all
```

The generator compiles every draft through the actual dispatcher, creates each
canonical match context, and runs each NPC recipe against the beginner preset.
It checks event damage against consecutive public replay HP values, verifies
the tower destruction case, and checks both reserve deployment events against
the final deployed unit state.
