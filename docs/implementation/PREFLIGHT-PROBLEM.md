# Preflight problem producer

`classifyPreflightProblem(cause, context)` in `preflight-problem.ts` preserves the worker category and original `ApiError`. It never reads a message to establish side, slot, field or source position. `PreflightLocalFailure` carries a local check's explicit invalid/unverified status.

The caller supplies `PreflightContext.stage`, `input` (`draft` or immutable `original_run`), `inputKey`, `scenarioId` and optional `slots` keyed by side. The slot arrays must be captured from the exact submitted input represented by that key. Consumer code must reject stale results and verify any current editor still corresponds to that input before applying a repair. The helper cannot prove that correspondence.

## Existing ApiError metadata

Enbu adds these string-valued keys to existing `ApiError.details` only where known at the validation site. Existing path/details entries are preserved.

| Key | Meaning |
| --- | --- |
| `preflight_side` | `attacker` or `defender` at the actual validating caller |
| `preflight_record_index` | Zero-based decimal index in the submitted Hero list |
| `preflight_slot_id` | Actual nonblank string from that record, when readable |
| `preflight_field` | Actual field checked: `slot_id`, `catalog_id`, `squad`, `node`, `skill_path`, or `program` |
| `preflight_squad_id` | Actual nonblank squad label from that record, when readable |

Paths are `<side>.configuration.heroes` for roster-wide checks; `<side>.configuration.heroes.value[<index>]` for record checks; that record path plus `.value.<field>` for field checks; and `<side>.program` for program validation. These are locations in Enbu's submitted input, without the transport's `payload` prefix. No source path is rewritten. Compiler `source@<UTF-8-byte-offset>` remains opaque to this classifier.

A split-node Squad reports the member record where the group constraint failed, with `field=node` and the real squad label. It does not assert that this member is uniquely wrong or that moving it is the only valid correction. Catalog/global/context failures without precise metadata remain unresolved.

## Repair and revalidation

`PreflightProblem` exposes status, stage/input/key, side, structured target, message, workerCode, apiError, repair and revalidation. `repair.kind` is `own_hero`, `own_jinrei`, `scenario`, `recovery` or `ready`. Hero repair includes the exact slot/record/field and `collection`, `skills` or `squads` screen. It requires a unique slot ID matching the caller's immutable mapping and consistent path/details. Missing, conflicting or ambiguous evidence yields Recovery rather than a guessed Hero.

Compiler stages `own_compile` and `opponent_compile` establish source ownership. NPC source/loadout errors route to the supplied scenario (or opponent chooser when its ID is null), never an own editor. Original-run own failures route to Recovery; current Draft edits do not silently repair immutable rematch inputs. Compatibility/runtime failures retain their categories and route to Recovery. A null-path combined Preflight failure stays unknown.

Revalidation is `compile_and_preflight` for the current Draft, `snapshot_preflight` for an original Run, or `reload_and_preflight` for compatibility/runtime recovery. Classification is not proof that repair or revalidation succeeded.

## Verification

`cargo test --locked -p senkei-wasm --test preflight_dispatch` checks real shared dispatch targets. After building the native dispatcher and a fresh WASM, `node tests/conformance/compare-preflight-problems.mjs` checks exact native/WASM response parity for both sides' invalid Skill, Squad and program inputs, a valid control, and unchanged compiler UTF-8 offsets with Unicode/CRLF. It never runs a battle.
