# `senkei.next` 1.0.0 provisional parameters

This is the W5 record for the initial values returned by
[`next_content.rs`](../../crates/senritsu/src/next_content.rs). The package
contains the values; this document records which values are agreed starting
ratios and which are provisional implementation choices. Changing these
numbers changes the versioned package data and its digest.

## Agreed movement ratios

These integer per-mille values encode the initial ratios already recorded in
`WORLD.md`, `UNITS.md`, and `BALANCE.md`.

| Parameter | Value | Meaning |
| --- | ---: | --- |
| `terrain_lane_speed_milli` | 1000 | Lane movement factor ×1.00 |
| `terrain_jungle_speed_milli` | 800 | Jungle movement factor ×0.80 |
| `minion_vision_speed_milli` | 1200 | Friendly Minion vision factor ×1.20; overlaps do not stack |
| `squad_1_speed_milli` | 1000 | Solo factor ×1.00 |
| `squad_2_speed_milli` | 950 | Duo factor ×0.95 |
| `squad_3_speed_milli` | 900 | Trio factor ×0.90 |
| `squad_4_speed_milli` | 850 | Quartet factor ×0.85 |
| `squad_5_speed_milli` | 800 | Quintet factor ×0.80 |

## Provisional world and progression values

The design documents do not fix these detailed values. They are explicit
starting points chosen to make the first finite implementation runnable and
measurable.

| Parameter | Value | Reason for this provisional value |
| --- | ---: | --- |
| `minion_spawn_interval` | 30 ticks | Gives each lane repeated, deterministic pressure without requiring Jinrei to spawn units. |
| `minion_vision` | 180 world units | A sensor radius suited to W1's 250–400 unit lane edges; each unit also stores 180 in its `vision` stat. |
| `hero_start_level` | 1 | Keeps every configured Hero at the start of the shared progression curve. |
| `hero_start_xp` | 0 | Makes the first earned reward the first progression event. |
| `hero_initial_energy` | 100 | Gives each Hero a common starting pool for active skills. |
| `hero_max_energy` | 100 | Bounds stored energy and makes one initial pool easy to inspect. |
| `hero_energy_regen_per_tick` | 1 | Slowly replenishes skill use while cooldowns remain the main short-term limit. |
| `hero_max_level` | 6 | Keeps the initial curve finite while unlocking the two catalog skill tiers. |
| `hero_xp_per_level` | 100 | A flat first curve is easy to audit; later scenarios can justify a nonlinear curve. |
| `xp_scale` | 2520 | Required exact XP storage scale: 2520 is the least common multiple of eligible group sizes 1 through 10, covering a contested neutral kill shared across both teams. |
| `hero_respawn_base_ticks` | 20 | Gives a first death a meaningful but short return delay. |
| `hero_respawn_per_level_ticks` | 5 | Makes later deaths cost more time without removing a Hero for most of a match. |
| `hero_kill_xp` | 80 | Rewards a Hero takedown between a Minion and a stronger neutral camp. |
| `xp_eligibility_range` | 250 | Covers the local fight while excluding distant Heroes on W1's map scale. |
| `structure_tower_xp` | 120 | Gives structure pressure a progression reward comparable to a neutral objective. |
| `structure_base_xp` | 0 | The base ends the match, so no post-victory progression reward is needed. |
| `squad_maturation_ticks` | 40 | A short, observable delay before a maintained formation reaches full coordination. |
| `squad_merge_distance` | 30 world units | Requires Heroes to rendezvous closely relative to W1's edge lengths. |
| `formation_spacing` | 8 world units | Starting offset for the five-Hero cardinal formation; its maximum diameter is 16, below the 30-unit merge distance, while making each Hero's position visible. |
| `squad_shield_per_ally` | 2 shield | At full maturity, each other living Squad member contributes two shield points to a Hero; the contribution scales with the contributor's maturity and `maturity_effect_milli`, then rounds up to a whole shield point. |
| `max_match_ticks` | 600 | A finite package-level runtime ceiling for the first implementation; it is not a claim that 600 ticks is the ideal match length. |
| `tick_duration_ms` | 100 | Gives replay and UI consumers a first wall-clock interpretation of one simulation tick. |

W3 applies `formation_spacing` to actual initial Hero positions: slots 0–4 use
offsets `(+s,0)`, `(0,+s)`, `(0,0)`, `(-s,0)`, `(0,-s)` from the configured
node; the defender orientation is reversed. A Solo remains centered. Enbu owns
these coordinates, and navigation preserves them as entity positions for the
renderer to display; the renderer does not invent a formation.

The `xp` world field stores integer units of 1/`xp_scale` XP; the validator
requires `xp_scale=2520`. A normal enemy or structure reward goes to the
eligible Heroes on its single credited opposing side. For a contested neutral
reward, W4 collects all phase-start living Heroes within `xp_eligibility_range`
on sides that dealt damage to the neutral during that phase, then divides the
whole reward equally across that combined Hero set. It does not split by side
first. If only one side has eligible contributors, its eligible Heroes receive
the full reward. Heroes killed during the phase remain eligible; Heroes
already dead at phase start do not. Squad membership does not affect
eligibility. Across ordinary and contested events, the possible equal-share
group sizes are 1 through 10; 2520 is their least common multiple, so all
fractions are exact. `hero_xp_per_level=100` is the per-level cost subtracted
on level-up. XP scale is a required versioned semantic rather than a tuning
choice.
## Provisional structure values

The same tower values apply to every W1 tower placement. The base is a
stationary victory objective rather than an attacking unit.

| Parameter | Value | Reason |
| --- | ---: | --- |
| `structure_tower_hp` | 1200 | Durable enough to require a lane push rather than one ordinary hit. |
| `structure_tower_attack` | 60 | A tower can punish a lone unit while remaining finite against a wave. |
| `structure_tower_defense` | 20 | Prevents attacks from treating a structure like an unarmored Minion. |
| `structure_tower_range` | 200 | Covers nearby lane combat on W1's scale. |
| `structure_tower_attack_interval` | 4 ticks | Provides periodic deterministic pressure. |
| `structure_tower_vision` | 220 | Slightly exceeds attack range for objective observation. |
| `structure_base_hp` | 2400 | Makes the final objective last longer than a single tower. |
| `structure_base_attack` | 0 | Keeps the base's initial role limited to being the victory target. |
| `structure_base_defense` | 25 | Gives the final objective modest protection. |
| `structure_base_range` | 0 | The base has no attack in this package. |
| `structure_base_attack_interval` | 1 tick | A valid positive interval for the non-attacking base entity. |
| `structure_base_vision` | 260 | Supports observation around the home objective. |

## Hero catalog

The IDs and three-axis role matrix follow the initial catalog in `UNITS.md`.
Names, stat profiles, growth, skills, and synergy values below are provisional
content. `UnitStats` columns are `hp / attack / defense / speed / range /
attack_interval / vision`; growth is the addition at each level after level 1.

| ID | Name | Placement / role / trait | Base stats | Per-level growth |
| --- | --- | --- | --- | --- |
| F01 | Bannerhold | frontline / defense / command | 260 / 32 / 24 / 48 / 85 / 4 / 190 | 22 / 3 / 3 / 0 / 0 / 0 / 4 |
| F02 | Stoneheart | frontline / defense / sustain | 285 / 28 / 27 / 43 / 70 / 4 / 175 | 25 / 2 / 3 / 0 / 0 / 0 / 3 |
| F03 | Breach | frontline / damage / assault | 220 / 43 / 16 / 54 / 80 / 3 / 180 | 18 / 5 / 1 / 0 / 0 / 0 / 3 |
| F04 | Rook | frontline / damage / skirmish | 195 / 39 / 13 / 68 / 75 / 3 / 225 | 15 / 4 / 1 / 1 / 0 / 0 / 5 |
| F05 | Lockstep | frontline / support / control | 225 / 27 / 17 / 52 / 95 / 4 / 190 | 19 / 2 / 2 / 0 / 0 / 0 / 4 |
| F06 | Pathfinder | frontline / support / recon | 190 / 24 / 12 / 65 / 125 / 4 / 285 | 16 / 2 / 1 / 1 / 0 / 0 / 7 |
| R01 | Tempest | backline / damage / control | 180 / 41 / 11 / 48 / 190 / 4 / 240 | 14 / 4 / 1 / 0 / 0 / 0 / 5 |
| R02 | Farshot | backline / damage / assault | 165 / 52 / 8 / 45 / 260 / 5 / 270 | 13 / 6 / 1 / 0 / 0 / 0 / 4 |
| R03 | Farwatch | backline / damage / recon | 170 / 39 / 9 / 54 / 320 / 5 / 330 | 14 / 4 / 1 / 0 / 0 / 0 / 7 |
| R04 | Lifeline | backline / support / sustain | 190 / 20 / 12 / 48 / 180 / 4 / 235 | 16 / 2 / 1 / 0 / 0 / 0 / 5 |
| R05 | Conductor | backline / support / command | 180 / 25 / 11 / 50 / 185 / 4 / 250 | 15 / 2 / 1 / 0 / 0 / 0 / 6 |
| R06 | Aegis | backline / defense / skirmish | 220 / 30 / 16 / 55 / 165 / 4 / 225 | 19 / 3 / 2 / 0 / 0 / 0 / 4 |

The positive growth fields emphasize health, attack, defense, and (for selected
Heroes) vision. Speed, range, and attack interval otherwise stay fixed so a
level does not silently change navigation or attack cadence for most Heroes.
Zero values in those growth columns are intentional.

Each Hero has two preconfigured paths, `path_a` and `path_b`. Each path grants
its own passive at level 2 and its own active at level 4; the active requires
that path's passive. Passives have range, cooldown, cost, and duration 0 and
target `self`. Active powers are raw HP/attack/defense points except Haste and
Slow, whose powers use per-mille movement units (`100` means ten percent).
Reveal uses a nonzero marker power and the skill's range/duration fields.

| Hero | Path A passive | Path B passive |
| --- | --- | --- |
| F01 | Steadfast Standard — Defense +4 | War Chorus — Empower +3 attack |
| F02 | Second Wind — Shield +16 | Granite Hide — Defense +5 |
| F03 | Siegebreaker — Empower +5 attack | Relentless Advance — Haste 100‰ |
| F04 | Quickstep — Haste 100‰ | Opportunist — Empower +3 attack |
| F05 | Grounded Stance — Defense +3 | Field Rations — Shield +12 |
| F06 | Trail Runner — Haste 100‰ | Fieldcraft — Empower +2 attack |
| R01 | Gathering Storm — Empower +4 attack | Eye of the Gale — Defense +2 |
| R02 | Deadeye — Empower +6 attack | Steady Aim — Haste 80‰ |
| R03 | Long Sight — Empower +3 attack | Light Footfall — Haste 80‰ |
| R04 | Restorative Training — Shield +14 | Protective Drill — Defense +2 |
| R05 | Clear Orders — Defense +2 | Tempo Keeper — Haste 80‰ |
| R06 | Rear Guard — Defense +4 | Escape Drill — Haste 80‰ |

The `synergy` map is finite, typed numeric metadata with two shared keys:
`maturity_effect_milli` multiplies only the Hero's contribution to the
renewable mature-Squad shield pool (1000 for the baseline, 1150 for the two
command Heroes); it does not change ordinary attacks. At full maturity, each
other living squad member contributes `squad_shield_per_ally` shield points to
the receiving Hero. Each contribution scales by that contributing Hero's
maturity over `squad_maturation_ticks` and by their `maturity_effect_milli`,
then rounds up to a whole shield point. Thus a fully mature ordinary member
contributes 2 shield while F01/R05 contributes 3 (2 × 1.15 rounded up).
`ally_skill_effect_milli` scales only the outgoing magnitude of effects aimed
at allies (1000 baseline, 1100 for support Heroes).

| Hero | Path A active: target / effect / power / duration / range / cooldown / cost | Path B active: target / effect / power / duration / range / cooldown / cost |
| --- | --- | --- |
| F01 | ally / Shield / 30 / 4 / 100 / 8 / 20 | ally / Haste / 120‰ / 3 / 180 / 10 / 24 |
| F02 | ally / Heal / 34 / 0 / 110 / 8 / 18 | self / Shield / 36 / 5 / 70 / 10 / 24 |
| F03 | enemy / Damage / 45 / 0 / 90 / 8 / 24 | enemy / Damage / 34 / 0 / 100 / 7 / 20 |
| F04 | enemy / Damage / 32 / 0 / 100 / 7 / 18 | enemy / Slow / 180‰ / 3 / 120 / 9 / 20 |
| F05 | enemy / Slow / 220‰ / 3 / 130 / 10 / 22 | ally / Shield / 30 / 4 / 130 / 8 / 20 |
| F06 | enemy / Reveal / 1 / 4 / 260 / 10 / 20 | ally / Haste / 150‰ / 3 / 220 / 9 / 20 |
| R01 | enemy / Damage / 42 / 0 / 210 / 9 / 24 | enemy / Slow / 180‰ / 3 / 210 / 10 / 24 |
| R02 | enemy / Damage / 56 / 0 / 340 / 11 / 30 | enemy / Damage / 42 / 0 / 300 / 8 / 22 |
| R03 | enemy / Reveal / 1 / 4 / 420 / 10 / 20 | enemy / Damage / 35 / 0 / 390 / 8 / 20 |
| R04 | ally / Heal / 42 / 0 / 250 / 7 / 20 | ally / Shield / 34 / 4 / 210 / 8 / 20 |
| R05 | ally / Empower / 15 / 3 / 250 / 10 / 24 | ally / Haste / 180‰ / 4 / 250 / 11 / 26 |
| R06 | ally / Shield / 38 / 4 / 190 / 8 / 20 | ally / Haste / 200‰ / 3 / 190 / 10 / 22 |

The branches offer different tradeoffs: direct damage, protection, recovery,
movement, or control. R02 concentrates on long-range damage; F04 can trade
damage for a chase slow; F06/R03 invest in scouting range and extend tracking
of a currently visible target; R04 invests in recovery; F01/R05 improve squad
and ally support. Reveal is a single-target marker, not an area search or a
way to target an unseen enemy. These are initial values to compare across
deterministic scenarios, not claims of balanced win rates.

## Minions, monsters, and camps

Minion waves begin on tick 0 and use one of each definition per lane and side.
The two units are deliberately different: one is durable at close range and
one contributes from farther away. Both grant 20 XP when defeated.

| Unit ID | HP / attack / defense / speed / range / attack interval / vision | XP |
| --- | --- | ---: |
| `minion_melee` | 90 / 18 / 6 / 26 / 45 / 4 / 180 | 20 |
| `minion_ranged` | 62 / 14 / 3 / 24 / 130 / 5 / 180 | 20 |

Neutral definitions give three camps distinct durability, threat, and reward.
The map has one camp at each fixed jungle node from W1.

| Monster ID | HP / attack / defense / speed / range / attack interval / vision | XP | Camp / node / respawn |
| --- | --- | ---: | --- |
| `monster_grove_brute` | 210 / 32 / 12 / 30 / 55 / 4 / 150 | 90 | `camp_nw` / `jungle_nw` / 90 ticks |
| `monster_iron_warden` | 340 / 38 / 22 / 20 / 65 / 5 / 180 | 150 | `camp_center` / `jungle_center` / 120 ticks |
| `monster_storm_stalker` | 170 / 44 / 9 / 58 / 95 / 3 / 220 | 110 | `camp_se` / `jungle_se` / 90 ticks |

## Review limits

The exact numbers for Hero stats, growth, skill tuning, XP, death delay,
coordination, camp rewards, structures, cadence, tick duration, and match
ceiling are provisional because the design documents leave them open. The
agreed movement ratios above remain fixed initial design inputs. W9 should
report scenario coverage and imbalances; this parameter set does not claim a
balanced result or a target win rate.

## Provisional lifecycle and ordering policies

Squad identity is side-scoped. A shared initial squad label must refer to one
map node. Split/merge/regroup proposals resolve by actor ID, side, capability,
target, then action ID; invalid proposals have no effect. Merge and regroup
combine colocated cohorts into the target squad identity and reset preparation.
A death removes the Hero and resets the remaining cohort's preparation; it
continues at its new size. Respawn restores full max HP and starting energy,
clears temporary effects, and retains XP, levels, acquired skills and ready-tick
cooldowns. Respawn creates a new Solo identity at the home base. These choices
are provisional mechanics for this package, not previously agreed numerical
requirements. Goal arbitration prefers retreat, then pursuit, then movement.
