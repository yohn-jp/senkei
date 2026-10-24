# Initial Senritsu package

This directory records the first playable ruleset's choices. Every number and
name below is a versioned initial implementation value, not an earlier
balance agreement. `crates/senritsu/src/initial.rs` is the package builder;
`senritsu::validate` is the required path from this package to an executable
`VerifiedRulePlan`.

## Identity and versions

- Ruleset ID: `senkei.initial`, version `1.0.0`.
- Engine/model/primitive-set/Jinrei language/structured AST/typed IR/bytecode:
  version `1.0.0`.
- Primitive set ID: `senkei.finite-transitions`.
- Cost schedule ID: `senkei.initial.cu`, version `1.0.0`.
- Initial topology: the `lane` symbol domain has `top`, `mid`, and `bot`.
- Unit class symbols: `infantry`, `archer`, `cavalry`, and `medic`.

## Configuration

Each deployment record is one individual unit. The finite lists allow players
to choose lane and initial position without making unit classes or lane names
part of the Jinrei type system.

| Field | Type and limit | Default |
| --- | --- | --- |
| `starting_credits` | integer `0..500` | `24` |
| `initial_deployments` | list of at most 16 `{slot_id, unit_class, lane, position}` records | infantry/top, archer/mid, cavalry/bot; each at position `4` |
| `reinforcements` | list of at most 16 `{slot_id, unit_class, lane, available_tick}` records | medic/mid at tick `4`, infantry/bot at tick `8` |

`slot_id` is a unique, stable string key within its roster list. The engine
derives entity IDs from the projection, side, type, and slot key; list order
does not affect identity. Reinforcement launch costs one credit. Initial
deployment list entries are already part of the submitted army. Credits,
positions, launch timing, roster size, and all world limits are validated
before simulation. One reserve can be deployed per side per tick; this keeps
simultaneous actions from spending the same phase-start credit twice.

## Initial world values

- Each side receives one core at relative position `0`, with `300` HP.
- Each side receives one barracks with the configured starting credits.
- Each side receives one tower in each lane at relative position `5`, with
  `150` HP.
- Individual units have `100` HP, attack range `2`, and move one position per
  forward or backward command. Position is measured from that unit's own core
  on the finite `0..20` lane axis.
- `infantry`, `archer`, and `medic` attacks deal `10` HP; `cavalry` deals `20`.
  The medic ability restores `10` HP to an allied unit. A unit can act once per
  accepted capability; there is no random hit check or hidden cooldown.
- A unit can attack an opposing unit or tower when both are in the same lane
  and their relative positions are within the configured attack range. Core
  attacks use the same relative-distance rule. HP is bounded at zero, and an
  entity at zero HP remains present for deterministic termination and replay.

## Observations and capabilities

Scalar observation paths are `match.tick`, `self.resources`, `self.core.hp`,
and `enemy.core.hp`. Finite entity collections are `allies.units`,
`allies.reserves`, `enemies.visible_units`, `allies.towers`,
`enemies.visible_towers`, `allies.cores`, `enemies.visible_cores`,
`allies.barracks`, and `enemies.visible_barracks`. Every collection has a
typed schema, explicit owner filter, bounded size, visible-field allowlist,
ascending field sort, and the stable entity-ID tie-break.

The capability catalog is finite and typed:

| Capability | Actor | Target / arguments | Owner rule |
| --- | --- | --- | --- |
| `deploy` | barracks | reserve unit, lane | target is allied |
| `move_forward` | unit | — | actor is allied |
| `move_backward` | unit | — | actor is allied |
| `shift_lane` | unit | lane | actor is allied |
| `attack_unit` | unit | unit | target is opposing |
| `attack_tower` | unit | tower | target is opposing |
| `attack_core` | unit | core | target is opposing |
| `use_ability` | unit | unit | target is allied; actor must be a medic |

The shared capability contract names actor and target argument indexes. All
actions return Intent candidates; Enbu validates ownership, range, lane,
availability, and credits before applying Senritsu transitions.
The `match.tick` path reads the engine tick, and reserve availability checks
use the typed `CurrentTick` rule expression rather than a mutable world field.

## Ordering, termination, and cost

The six execution phases are ordered `snapshot`, `tactical_evaluation`,
`intent_validation`, `arbitration`, `transition`, `termination`. Rule and
termination conditions use unique explicit numeric order. Arbitration selects
by descending optional priority, then the shared stable total suffix
`(side, action_id, actor, target, capability, arguments)`; action source order
has no meaning. A unit acting, same-reserve deployment, or other declared
conflict is resolved by an explicit capability-specific conflict key.

The match ends when a core reaches zero HP. Simultaneous destruction is a draw;
one destroyed core awards victory to the other side. At `500` ticks, the result
is a draw. The package uses a `100,000` CU per-tick budget per side and a `100,000,000`
CU per-match budget, with `RejectTickAndKeepMemory` and
`OnCompletedEvaluation` as the versioned initial overrun/memory policies.

The schedule prices all ten required Jinrei operation groups: path read,
comparison, arithmetic, logic, state reference, collection iteration,
aggregate, memory read, memory write, and capability issue. Each base and
per-item price is explicit in the package. Logical CU never depends on host
time, runtime, or optimization.
