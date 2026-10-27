//! Hero deployment, squad regrouping, and the Hero death/respawn lifecycle.
//!
//! Squad membership is stored on Heroes rather than as a second entity. Every
//! lookup is scoped to the owning side, and all order-sensitive work uses
//! stable entity/configuration identifiers.

use crate::next_support as support;
use senkei_model::{
    ApiError, ApiErrorCode, CombatantSide, DomainValue, EntityId, EntityState,
    FieldId, Intent, NextRules, SenkeiSnapshot, WorldState,
};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

const HERO_COUNT: usize = 5;
const HEROES_FIELD: &str = "heroes";
const MAX_WORLD_INT: i64 = 1_000_000_000;
const MAX_SAFE_JSON_INT: i64 = 9_007_199_254_740_991;

#[derive(Clone)]
struct HeroSeed {
    slot_id: String,
    catalog_id: String,
    squad_id: String,
    node: String,
    skill_path: String,
    definition: senkei_model::HeroDefinition,
}

/// Create the five configured Heroes for one side.
///
/// Configuration is checked in full before the world is changed, so invalid
/// deployment data cannot leave a partial army behind.
pub fn initialize(
    world: &mut WorldState,
    snapshot: &SenkeiSnapshot,
    side: CombatantSide,
    rules: &NextRules,
) -> Result<(), ApiError> {
    if world.entities.values().any(|entity| {
        entity.entity_type.as_str() == "hero" && entity.owner == Some(side)
    }) {
        return Err(invalid("Heroes for this side have already been initialized"));
    }

    let seeds = parse_loadout(snapshot, side, rules)?;
    let starting_level = support::param(rules, "hero_start_level", 1);
    let starting_xp = support::param(rules, "hero_start_xp", 0).saturating_mul(2520);
    let starting_energy = support::param(rules, "hero_initial_energy", 100);
    let max_level = support::param(rules, "hero_max_level", 6);
    if max_level < 1
        || max_level > MAX_WORLD_INT
        || starting_level < 1
        || starting_level > max_level
        || starting_level > MAX_WORLD_INT
    {
        return Err(invalid("Hero starting level must be between one and the configured maximum"));
    }
    if starting_xp < 0 || starting_xp > MAX_SAFE_JSON_INT || starting_energy < 0 || starting_energy > MAX_WORLD_INT {
        return Err(invalid("Hero starting XP and energy are outside the supported range"));
    }
    let formation_spacing = support::param(rules, "formation_spacing", 8);
    let merge_distance = support::param(rules, "squad_merge_distance", 30);
    if formation_spacing <= 0 || merge_distance < 0 || formation_spacing > merge_distance / 2 {
        return Err(invalid("formation spacing must be positive and fit inside the squad merge distance"));
    }
    let home = base_node(side, rules);
    if !rules.map.nodes.contains_key(home) {
        return Err(invalid("the configured home base is not a node on the battle map"));
    }

    let mut formation_by_slot = BTreeMap::new();
    let mut groups: BTreeMap<&str, Vec<&HeroSeed>> = BTreeMap::new();
    for seed in &seeds {
        groups.entry(&seed.squad_id).or_default().push(seed);
    }
    for members in groups.values_mut() {
        members.sort_by(|left, right| formation_seed_order(left, right));
        for (rank, seed) in members.iter().enumerate() {
            let (x, y) = formation_offset(rank, members.len(), formation_spacing, side);
            formation_by_slot.insert(seed.slot_id.clone(), (rank as i64, x, y));
        }
    }

    let mut prepared = Vec::with_capacity(HERO_COUNT);
    for seed in seeds {
        let id = hero_entity_id(side, &seed.slot_id);
        if world.entities.contains_key(&id) {
            return Err(invalid(format!("Hero entity ID `{id}` is already present")));
        }
        let level_stats = stats_at_level(&seed.definition, starting_level)?;
        let mut entity = support::unit("hero", Some(side), &level_stats, &seed.node, rules);
        let (rank, offset_x, offset_y) = formation_by_slot
            .get(&seed.slot_id)
            .copied()
            .unwrap_or((0, 0, 0));
        let node = &rules.map.nodes[&seed.node];
        let x = node.x.checked_add(offset_x).filter(|value| (-MAX_WORLD_INT..=MAX_WORLD_INT).contains(value))
            .ok_or_else(|| invalid("Hero formation position exceeds the supported coordinate range"))?;
        let y = node.y.checked_add(offset_y).filter(|value| (-MAX_WORLD_INT..=MAX_WORLD_INT).contains(value))
            .ok_or_else(|| invalid("Hero formation position exceeds the supported coordinate range"))?;
        support::set_int(&mut entity, "x", x);
        support::set_int(&mut entity, "y", y);
        support::set_string(&mut entity, "goal", "");
        support::set_string(&mut entity, "lane", "");
        support::set_string(&mut entity, "slot_id", &seed.slot_id);
        support::set_string(&mut entity, "catalog_id", &seed.catalog_id);
        support::set_string(&mut entity, "squad", &seed.squad_id);
        support::set_string(&mut entity, "skill_path", &seed.skill_path);
        support::set_int(&mut entity, "xp", starting_xp);
        support::set_int(&mut entity, "level", starting_level);
        // W4 uses these generation markers to reapply one-time passive effects
        // once per life without repeating their initial-life application.
        support::set_int(&mut entity, "life_generation", 0);
        support::set_int(&mut entity, "passive_generation", 0);
        support::set_int(&mut entity, "maturity", 0);
        support::set_int(&mut entity, "formation", rank);
        support::set_int(&mut entity, "respawn_at", 0);
        support::set_int(&mut entity, "death_tick", 0);
        support::set_int(&mut entity, "energy", starting_energy);
        entity.fields.insert(FieldId::from("skills"), DomainValue::List(Vec::new()));
        entity.fields.insert(FieldId::from("target"), DomainValue::Null);
        let cooldowns = rules
            .heroes
            .iter()
            .flat_map(|hero| hero.skills.iter().map(|skill| skill.id.as_str()))
            .map(|skill_id| (FieldId::from(skill_id), DomainValue::Integer(0)))
            .collect();
        entity.fields.insert(FieldId::from("cooldowns"), DomainValue::Record(cooldowns));
        prepared.push((id, entity));
    }

    for (id, entity) in prepared {
        world.entities.insert(id, entity);
    }
    Ok(())
}

/// Resolve accepted squad intents in a stable actor-first order.
///
/// Invalid or conflicting transitions are inert. The input has already passed
/// the shared capability validator; this hook checks the remaining world-level
/// rules such as side ownership, cohesion, and the five-Hero cap.
pub fn intents(
    world: &mut WorldState,
    rules: &NextRules,
    accepted: &[(CombatantSide, Intent)],
    _tick: u32,
) {
    let mut actions = accepted
        .iter()
        .filter(|(_, intent)| is_squad_capability(intent.capability.as_str()))
        .collect::<Vec<_>>();
    actions.sort_by(|(left_side, left), (right_side, right)| {
        actor_for(left)
            .cmp(&actor_for(right))
            .then_with(|| left_side.cmp(right_side))
            .then_with(|| left.capability.cmp(&right.capability))
            .then_with(|| target_for(left).cmp(&target_for(right)))
            .then_with(|| left.action_id.cmp(&right.action_id))
    });

    for (side, intent) in actions {
        let Some(actor_id) = actor_for(intent) else { continue };
        let Some(actor) = world.entities.get(&actor_id) else { continue };
        if support::int(actor, "action_lock_until") > i64::from(_tick) { continue; }
        let mut affected = squad_members(world, *side, &support::string(actor, "squad"));
        if !affected.contains(&actor_id) { affected.push(actor_id.clone()); }
        if let Some(target_id) = target_for(intent) {
            if let Some(target) = world.entities.get(&target_id) {
                affected.extend(squad_members(world, *side, &support::string(target, "squad")));
            }
        }
        affected.sort(); affected.dedup();
        if affected.iter().any(|id| world.entities.get(id).is_some_and(|entity| support::int(entity, "action_lock_until") > i64::from(_tick)
            || crate::next_navigation::forced_transit_in(entity, rules, world))) { continue; }
        let before = affected.iter().filter_map(|id| world.entities.get(id).map(|entity| (id.clone(), support::string(entity, "squad")))).collect::<Vec<_>>();
        match intent.capability.as_str() {
            "split" => split(world, rules, *side, &actor_id, _tick),
            "merge" | "regroup" => {
                let Some(target_id) = target_for(intent) else { continue };
                merge(world, rules, *side, &actor_id, &target_id);
            }
            _ => {}
        }
        if before.iter().any(|(id, prior)| world.entities.get(id).is_some_and(|entity| support::string(entity, "squad") != *prior)) {
            for id in affected {
                if let Some(entity) = world.entities.get_mut(&id) {
                    support::set_int(entity, "action_lock_until", support::int(entity, "action_lock_until").max(i64::from(_tick) + 1));
                }
            }
        }
    }
}

/// Apply deaths, Solo respawns, and the time spent maintaining formation.
/// W4 sets `hp` to zero and writes `death_tick` before this hook runs.
#[cfg(test)]
pub fn lifecycle(world: &mut WorldState, rules: &NextRules, tick: u32) {
    lifecycle_with_relationships(world, rules, tick, None).expect("maturity without a projection is infallible");
}

/// Use the frozen relationship policy, when present, in the ordinary Squad
/// maturity update after deaths and Solo respawns have been processed.
pub(crate) fn lifecycle_with_relationships(
    world: &mut WorldState,
    rules: &NextRules,
    tick: u32,
    relationships: Option<&crate::projected_assets::RelationRuntime>,
) -> Result<(), ApiError> {
    let mut changed_squads = BTreeSet::new();
    let hero_ids = world
        .entities
        .iter()
        .filter(|(_, entity)| entity.entity_type.as_str() == "hero")
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();

    // Mark departures first so no dead Hero contributes to group size or
    // cohesion in this tick.
    for id in &hero_ids {
        let Some(entity) = world.entities.get_mut(id) else { continue };
        if support::alive(entity) {
            continue;
        }

        let side = entity.owner;
        let prior_squad = support::string(entity, "squad");
        if let Some(side) = side {
            if !prior_squad.is_empty() {
                changed_squads.insert((side, prior_squad.clone()));
            }
        }

        let scheduled = integer_field(entity, "respawn_at").unwrap_or(0);
        if scheduled <= 0 {
            let level = integer_field(entity, "level").unwrap_or(1).max(1);
            let death_tick = integer_field(entity, "death_tick").unwrap_or(i64::from(tick)).max(0);
            let base = support::param(rules, "hero_respawn_base_ticks", 20).max(0);
            let per_level = support::param(rules, "hero_respawn_per_level_ticks", 5).max(0);
            let cooldown = base.saturating_add(per_level.saturating_mul(level.saturating_sub(1)));
            let respawn_at = death_tick.saturating_add(cooldown).min(i64::from(u32::MAX));
            support::set_int(entity, "respawn_at", respawn_at);
        }
        if !prior_squad.is_empty() {
            support::set_string(entity, "squad", "");
        }
        support::set_int(entity, "maturity", 0);
        support::set_int(entity, "formation", 0);
    }

    for (side, squad_id) in &changed_squads {
        refresh_squad(world, *side, squad_id, rules, true);
    }

    // A dead Hero respawns at (or after) its scheduled tick as a new Solo.
    // XP, level, unlocked skills, and cooldown records remain on the entity.
    for id in &hero_ids {
        let due = world.entities.get(id).is_some_and(|entity| {
            !support::alive(entity)
                && integer_field(entity, "respawn_at")
                    .is_some_and(|respawn_at| respawn_at <= i64::from(tick))
        });
        if !due {
            continue;
        }

        let Some(side) = world.entities.get(id).and_then(|entity| entity.owner) else { continue };
        let slot = world
            .entities
            .get(id)
            .map(|entity| support::string(entity, "slot_id"))
            .filter(|slot| !slot.is_empty())
            .unwrap_or_else(|| id.as_str().to_owned());
        let solo_id = unique_solo_id(world, side, &format!("respawn/{tick}/{slot}"));
        let home = base_node(side, rules).to_owned();

        let Some(entity) = world.entities.get_mut(id) else { continue };
        support::place(entity, &home, rules);
        let max_hp = support::int(entity, "max_hp");
        support::set_int(entity, "hp", max_hp);
        support::set_int(entity, "attack_ready", i64::from(tick));
        let generation = integer_field(entity, "life_generation")
            .unwrap_or(0)
            .clamp(0, MAX_WORLD_INT - 1)
            .saturating_add(1);
        support::set_int(entity, "life_generation", generation);
        // Keep the last applied passive generation; W4 observes the mismatch
        // and reapplies a passive shield exactly once for this new life.
        support::set_string(entity, "goal", "");
        entity.fields.insert("target".into(), DomainValue::Null);
        support::set_string(entity, "lane", "");
        support::set_string(entity, "squad", solo_id);
        support::set_int(entity, "maturity", 0);
        support::set_int(entity, "formation", 0);
        support::set_int(entity, "respawn_at", 0);
        support::set_int(
            entity,
            "energy",
            support::param(rules, "hero_initial_energy", 100).max(0),
        );
        clear_temporary_effects(entity);
        let squad_id = support::string(entity, "squad");
        changed_squads.insert((side, squad_id));
    }

    for (side, squad_id) in &changed_squads {
        refresh_squad(world, *side, squad_id, rules, true);
    }

    advance_maturity(world, rules, &changed_squads, relationships)
}

fn parse_loadout(
    snapshot: &SenkeiSnapshot,
    side: CombatantSide,
    rules: &NextRules,
) -> Result<Vec<HeroSeed>, ApiError> {
    let roster_error = |error| loadout_error(error, side, None, None, None);
    let Some(DomainValue::List(records)) = snapshot.configuration.get(&FieldId::from(HEROES_FIELD)) else {
        return Err(roster_error(invalid("snapshot configuration must contain a `heroes` list")));
    };
    if records.len() != HERO_COUNT {
        return Err(roster_error(invalid("snapshot configuration must contain exactly five Heroes")));
    }

    let required = ["slot_id", "catalog_id", "squad", "node", "skill_path"];
    let mut slots = BTreeSet::new();
    let mut squad_nodes: BTreeMap<String, String> = BTreeMap::new();
    let mut seeds = Vec::with_capacity(HERO_COUNT);
    for (index, record) in records.iter().enumerate() {
        let DomainValue::Record(fields) = record else {
            return Err(loadout_error(invalid(format!("`heroes[{index}]` must be a record")), side, Some(index), None, None));
        };
        let annotate = |error, field| loadout_error(error, side, Some(index), Some(fields), field);
        if fields.len() != required.len() || required.iter().any(|key| !fields.contains_key(&FieldId::from(*key))) {
            return Err(annotate(invalid(format!("`heroes[{index}]` must have exactly slot_id, catalog_id, squad, node, and skill_path")), None));
        }
        let slot_id = required_string(fields, "slot_id", index).map_err(|error| annotate(error, Some("slot_id")))?;
        let catalog_id = required_string(fields, "catalog_id", index).map_err(|error| annotate(error, Some("catalog_id")))?;
        let squad_label = required_string(fields, "squad", index).map_err(|error| annotate(error, Some("squad")))?;
        let node = required_string(fields, "node", index).map_err(|error| annotate(error, Some("node")))?;
        let skill_path = required_string(fields, "skill_path", index).map_err(|error| annotate(error, Some("skill_path")))?;
        for (name, value) in [
            ("slot_id", &slot_id),
            ("catalog_id", &catalog_id),
            ("squad", &squad_label),
            ("node", &node),
            ("skill_path", &skill_path),
        ] {
            if value.trim().is_empty() {
                return Err(annotate(invalid(format!("`heroes[{index}].{name}` must not be empty")), Some(name)));
            }
        }
        if !slots.insert(slot_id.clone()) {
            return Err(annotate(invalid(format!("Hero slot `{slot_id}` is configured more than once")), Some("slot_id")));
        }
        if !rules.map.nodes.contains_key(&node) {
            return Err(annotate(invalid(format!("Hero slot `{slot_id}` names unknown map node `{node}`")), Some("node")));
        }

        if let Some(existing_node) = squad_nodes.get(&squad_label) {
            if existing_node != &node {
                return Err(annotate(invalid(format!("initial squad `{squad_label}` spans multiple map nodes")), Some("node")));
            }
        } else {
            squad_nodes.insert(squad_label.clone(), node.clone());
        }

        let matching = rules.heroes.iter().filter(|definition| definition.id == catalog_id).collect::<Vec<_>>();
        if matching.len() != 1 {
            return Err(annotate(invalid(format!("Hero catalog ID `{catalog_id}` must identify exactly one catalog entry")), Some("catalog_id")));
        }
        let definition = matching[0];
        validate_hero_stats(definition)?;
        let Some(path) = definition.skill_paths.get(&skill_path) else {
            return Err(annotate(invalid(format!("Hero `{catalog_id}` has no configured skill path `{skill_path}`")), Some("skill_path")));
        };
        let mut path_skills = BTreeSet::new();
        for skill_id in path {
            let matches = definition.skills.iter().filter(|skill| skill.id == *skill_id).count();
            if matches != 1 || !path_skills.insert(skill_id) {
                return Err(annotate(invalid(format!("skill path `{skill_path}` for `{catalog_id}` contains an unknown or repeated skill `{skill_id}`")), Some("skill_path")));
            }
        }

        seeds.push(HeroSeed {
            slot_id,
            catalog_id,
            squad_id: format!("{}:{squad_label}", support::side_name(side)),
            node,
            skill_path,
            definition: definition.clone(),
        });
    }
    Ok(seeds)
}

// The metadata is evidence from this validation site, never inferred from text.
fn loadout_error(
    mut error: ApiError,
    side: CombatantSide,
    index: Option<usize>,
    fields: Option<&BTreeMap<FieldId, DomainValue>>,
    field: Option<&str>,
) -> ApiError {
    let side = support::side_name(side);
    let mut path = format!("{side}.configuration.heroes");
    error.details.entry("preflight_side".into()).or_insert_with(|| side.into());
    if let Some(index) = index {
        path.push_str(&format!(".value[{index}]"));
        error.details.entry("preflight_record_index".into()).or_insert_with(|| index.to_string());
    }
    if let Some(field) = field {
        path.push_str(&format!(".value.{field}"));
        error.details.entry("preflight_field".into()).or_insert_with(|| field.into());
    }
    if let Some(fields) = fields {
        for (name, key) in [("slot_id", "preflight_slot_id"), ("squad", "preflight_squad_id")] {
            if let Some(DomainValue::String(value)) = fields.get(&FieldId::from(name)) {
                if !value.trim().is_empty() {
                    error.details.entry(key.into()).or_insert_with(|| value.clone());
                }
            }
        }
    }
    if error.path.is_none() { error.path = Some(path); }
    error
}

fn required_string(
    fields: &BTreeMap<FieldId, DomainValue>,
    key: &str,
    index: usize,
) -> Result<String, ApiError> {
    match fields.get(&FieldId::from(key)) {
        Some(DomainValue::String(value)) => Ok(value.clone()),
        _ => Err(invalid(format!("`heroes[{index}].{key}` must be a string"))),
    }
}

fn validate_hero_stats(definition: &senkei_model::HeroDefinition) -> Result<(), ApiError> {
    let stats = &definition.stats;
    if stats.hp <= 0
        || stats.attack < 0
        || stats.defense < 0
        || stats.speed < 0
        || stats.range < 0
        || stats.attack_interval <= 0
        || stats.vision < 0
    {
        return Err(invalid(format!("Hero catalog entry `{}` has invalid base statistics", definition.id)));
    }
    let growth = &definition.growth;
    if [
        growth.hp,
        growth.attack,
        growth.defense,
        growth.speed,
        growth.range,
        growth.attack_interval,
        growth.vision,
    ]
    .into_iter()
    .any(|value| value < 0)
    {
        return Err(invalid(format!("Hero catalog entry `{}` has negative growth", definition.id)));
    }
    Ok(())
}

fn stats_at_level(
    definition: &senkei_model::HeroDefinition,
    level: i64,
) -> Result<senkei_model::UnitStats, ApiError> {
    let levels_gained = level.saturating_sub(1);
    let grow = |base: i64, increase: i64| {
        increase
            .checked_mul(levels_gained)
            .and_then(|bonus| base.checked_add(bonus))
            .filter(|value| *value >= 0 && *value <= MAX_WORLD_INT)
    };
    let base = &definition.stats;
    let growth = &definition.growth;
    let stat = |base: i64, increase: i64| {
        grow(base, increase).ok_or_else(|| {
            invalid(format!("Hero `{}` level {level} exceeds the supported stat range", definition.id))
        })
    };
    let attack_interval = stat(base.attack_interval, growth.attack_interval)?;
    if attack_interval < 1 {
        return Err(invalid(format!("Hero `{}` has an invalid attack interval at level {level}", definition.id)));
    }
    Ok(senkei_model::UnitStats {
        hp: stat(base.hp, growth.hp)?,
        attack: stat(base.attack, growth.attack)?,
        defense: stat(base.defense, growth.defense)?,
        speed: stat(base.speed, growth.speed)?,
        range: stat(base.range, growth.range)?,
        attack_interval,
        vision: stat(base.vision, growth.vision)?,
    })
}

fn formation_offset(rank: usize, squad_size: usize, spacing: i64, side: CombatantSide) -> (i64, i64) {
    if squad_size <= 1 || rank >= HERO_COUNT {
        return (0, 0);
    }
    let layout = [
        (spacing, 0),
        (0, spacing),
        (0, 0),
        (-spacing, 0),
        (0, -spacing),
    ];
    let (sum_x, sum_y) = layout[..squad_size.min(HERO_COUNT)]
        .iter()
        .fold((0_i128, 0_i128), |(sum_x, sum_y), (x, y)| {
            (sum_x + i128::from(*x), sum_y + i128::from(*y))
        });
    let count = i128::try_from(squad_size).unwrap_or(1).max(1);
    let center_x = rounded_division(sum_x, count);
    let center_y = rounded_division(sum_y, count);
    let (mut x, mut y) = layout[rank];
    x = (i128::from(x) - center_x) as i64;
    y = (i128::from(y) - center_y) as i64;
    if side == CombatantSide::Defender {
        x = -x;
        y = -y;
    }
    (x, y)
}

fn rounded_division(value: i128, divisor: i128) -> i128 {
    if value >= 0 {
        (value + divisor / 2) / divisor
    } else {
        -((-value + divisor / 2) / divisor)
    }
}

fn formation_seed_order(left: &HeroSeed, right: &HeroSeed) -> Ordering {
    placement_rank(&left.definition.placement)
        .cmp(&placement_rank(&right.definition.placement))
        .then_with(|| left.slot_id.cmp(&right.slot_id))
}

fn placement_rank(placement: &str) -> u8 {
    match placement {
        "frontline" | "front" | "front_line" => 0,
        "backline" | "back" | "back_line" => 1,
        _ => 2,
    }
}

pub(crate) fn hero_entity_id(side: CombatantSide, slot_id: &str) -> EntityId {
    senkei_model::derive_projected_entity_id(
        &senkei_model::ContentDigest::new("0".repeat(64)),
        &senkei_model::ProjectionId::from("next.hero"),
        &senkei_model::TypeId::from("hero"),
        Some(side),
        &DomainValue::String(slot_id.to_owned()),
    ).expect("a string Hero key is valid")
}

fn base_node(side: CombatantSide, rules: &NextRules) -> &str {
    match side {
        CombatantSide::Attacker => &rules.map.attacker_base,
        CombatantSide::Defender => &rules.map.defender_base,
    }
}

fn is_squad_capability(capability: &str) -> bool {
    matches!(capability, "split" | "merge" | "regroup")
}

fn actor_for(intent: &Intent) -> Option<EntityId> {
    intent.actor.clone().or_else(|| entity_argument(intent, 0))
}

fn target_for(intent: &Intent) -> Option<EntityId> {
    intent.target.clone().or_else(|| entity_argument(intent, 1))
}

fn entity_argument(intent: &Intent, index: usize) -> Option<EntityId> {
    match intent.arguments.get(index) {
        Some(DomainValue::Entity(id)) => Some(id.clone()),
        _ => None,
    }
}

fn split(world: &mut WorldState, rules: &NextRules, side: CombatantSide, actor_id: &EntityId, tick: u32) {
    let Some(actor) = world.entities.get(actor_id) else { return };
    if actor.entity_type.as_str() != "hero" || actor.owner != Some(side) || !support::alive(actor) {
        return;
    }
    let source_id = support::string(actor, "squad");
    if source_id.is_empty() {
        return;
    }
    let members = squad_members(world, side, &source_id);
    if members.len() <= 1 {
        return;
    }

    let solo_id = unique_solo_id(world, side, &format!("split/{tick}/{actor_id}"));
    if let Some(actor) = world.entities.get_mut(actor_id) {
        support::set_string(actor, "squad", solo_id);
    }
    refresh_squad(world, side, &source_id, rules, true);
    let new_id = world.entities.get(actor_id).map(|entity| support::string(entity, "squad"));
    if let Some(new_id) = new_id {
        refresh_squad(world, side, &new_id, rules, true);
    }
}

fn merge(
    world: &mut WorldState,
    rules: &NextRules,
    side: CombatantSide,
    actor_id: &EntityId,
    target_id: &EntityId,
) {
    if actor_id == target_id {
        return;
    }
    let Some(actor) = world.entities.get(actor_id) else { return };
    let Some(target) = world.entities.get(target_id) else { return };
    if actor.entity_type.as_str() != "hero"
        || target.entity_type.as_str() != "hero"
        || actor.owner != Some(side)
        || target.owner != Some(side)
        || !support::alive(actor)
        || !support::alive(target)
    {
        return;
    }
    let source_id = support::string(actor, "squad");
    let target_squad_id = support::string(target, "squad");
    if source_id.is_empty() || target_squad_id.is_empty() || source_id == target_squad_id {
        return;
    }

    let mut members = squad_members(world, side, &source_id);
    members.extend(squad_members(world, side, &target_squad_id));
    members.sort();
    members.dedup();
    if members.len() < 2 || members.len() > HERO_COUNT {
        return;
    }
    let distance = support::param(rules, "squad_merge_distance", 30).max(0);
    if !cohesive(world, &members, distance, rules) {
        return;
    }
    // A merge must form one spatial subject without teleporting members or
    // implicitly distributing them across connectors or lateral tracks.
    for (index, left_id) in members.iter().enumerate() {
        let left = &world.entities[left_id];
        for right_id in members.iter().skip(index + 1) {
            let right = &world.entities[right_id];
            if support::combat_distance2(left, right, rules).is_none()
                || support::string(left, "node") != support::string(right, "node")
                || support::string(left, "edge_to") != support::string(right, "edge_to")
                || support::string(left, "track") != support::string(right, "track")
            { return; }
        }
    }

    // The target Hero anchors the merged squad. All members receive its
    // current route and target so old cohort orders cannot immediately split
    // the new squad into multiple directions before this tick's tactics run.
    let target_goal = support::string(target, "goal");
    let target_lane = support::string(target, "lane");
    let target_order = target
        .fields
        .get(&FieldId::from("target"))
        .cloned()
        .unwrap_or(DomainValue::Null);

    for member_id in &members {
        if let Some(member) = world.entities.get_mut(member_id) {
            support::set_string(member, "squad", &target_squad_id);
            support::set_string(member, "goal", &target_goal);
            support::set_string(member, "lane", &target_lane);
            member.fields.insert(FieldId::from("target"), target_order.clone());
        }
    }
    refresh_squad(world, side, &target_squad_id, rules, true);
}

fn squad_members(world: &WorldState, side: CombatantSide, squad_id: &str) -> Vec<EntityId> {
    world
        .entities
        .iter()
        .filter(|(_, entity)| {
            entity.entity_type.as_str() == "hero"
                && entity.owner == Some(side)
                && support::alive(entity)
                && support::string(entity, "squad") == squad_id
        })
        .map(|(id, _)| id.clone())
        .collect()
}

fn unique_solo_id(world: &WorldState, side: CombatantSide, source: &str) -> String {
    let used = world
        .entities
        .values()
        .filter(|entity| {
            entity.entity_type.as_str() == "hero"
                && entity.owner == Some(side)
                && support::alive(entity)
        })
        .map(|entity| support::string(entity, "squad"))
        .filter(|squad| !squad.is_empty())
        .collect::<BTreeSet<_>>();
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in source.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let side_prefix = match side {
        CombatantSide::Attacker => "a",
        CombatantSide::Defender => "d",
    };
    let base = format!("{side_prefix}:solo:{hash:016x}");
    if !used.contains(&base) {
        return base;
    }
    for suffix in 1_u32.. {
        let candidate = format!("{base}:{suffix}");
        if !used.contains(&candidate) {
            return candidate;
        }
    }
    unreachable!("a free deterministic squad identifier always exists")
}

fn cohesive(world: &WorldState, members: &[EntityId], distance: i64, rules: &NextRules) -> bool {
    let max_distance_squared = i128::from(distance).saturating_mul(i128::from(distance));
    for left_index in 0..members.len() {
        let Some(left) = world.entities.get(&members[left_index]) else { return false };
        for right_id in members.iter().skip(left_index + 1) {
            let Some(right) = world.entities.get(right_id) else { return false };
            if support::world_distance2(left, right, rules).map_or(true, |distance| distance > max_distance_squared) {
                return false;
            }
        }
    }
    true
}

fn refresh_squad(
    world: &mut WorldState,
    side: CombatantSide,
    squad_id: &str,
    rules: &NextRules,
    reset_maturity: bool,
) {
    let mut members = squad_members(world, side, squad_id);
    members.sort_by(|left_id, right_id| {
        let left = world.entities.get(left_id);
        let right = world.entities.get(right_id);
        let left_catalog = left.map(|entity| support::string(entity, "catalog_id")).unwrap_or_default();
        let right_catalog = right.map(|entity| support::string(entity, "catalog_id")).unwrap_or_default();
        catalog_placement(rules, &left_catalog)
            .cmp(&catalog_placement(rules, &right_catalog))
            .then_with(|| {
                left.map(|entity| support::string(entity, "slot_id"))
                    .unwrap_or_default()
                    .cmp(&right.map(|entity| support::string(entity, "slot_id")).unwrap_or_default())
            })
            .then_with(|| left_id.cmp(right_id))
    });
    for (rank, member_id) in members.iter().enumerate() {
        if let Some(member) = world.entities.get_mut(member_id) {
            support::set_int(member, "formation", rank as i64);
            if reset_maturity {
                support::set_int(member, "maturity", 0);
            }
        }
    }
}

fn catalog_placement(rules: &NextRules, catalog_id: &str) -> u8 {
    rules
        .heroes
        .iter()
        .find(|definition| definition.id == catalog_id)
        .map(|definition| placement_rank(&definition.placement))
        .unwrap_or(2)
}

fn advance_maturity(
    world: &mut WorldState,
    rules: &NextRules,
    changed_squads: &BTreeSet<(CombatantSide, String)>,
    relationships: Option<&crate::projected_assets::RelationRuntime>,
) -> Result<(), ApiError> {
    let cap = support::param(rules, "squad_maturation_ticks", 40).clamp(1, MAX_WORLD_INT);
    let mut groups: BTreeMap<(CombatantSide, String), Vec<EntityId>> = BTreeMap::new();
    for (id, entity) in &world.entities {
        if entity.entity_type.as_str() != "hero" || !support::alive(entity) {
            continue;
        }
        let Some(side) = entity.owner else { continue };
        let squad_id = support::string(entity, "squad");
        if squad_id.is_empty() {
            continue;
        }
        groups.entry((side, squad_id)).or_default().push(id.clone());
    }

    let distance = support::param(rules, "squad_merge_distance", 30).max(0);
    for ((side, squad_id), members) in groups {
        if members.len() <= 1 {
            if let Some(id) = members.first().and_then(|id| world.entities.get_mut(id)) {
                support::set_int(id, "maturity", 0);
            }
            continue;
        }
        if changed_squads.contains(&(side, squad_id.clone())) {
            for id in &members {
                if let Some(entity) = world.entities.get_mut(id) {
                    support::set_int(entity, "maturity", 0);
                }
            }
            continue;
        }
        if !cohesive(world, &members, distance, rules) {
            for id in &members {
                if let Some(entity) = world.entities.get_mut(id) {
                    support::set_int(entity, "maturity", 0);
                }
            }
            continue;
        }

        let prior = members
            .iter()
            .filter_map(|id| world.entities.get(id).and_then(|entity| integer_field(entity, "maturity")))
            .min()
            .unwrap_or(0)
            .clamp(0, cap);
        let bonus = match relationships {
            Some(runtime) => runtime.maturity_increment(world, side, &members)?.unwrap_or(0),
            None => 0,
        };
        let next = prior.saturating_add(1).saturating_add(bonus).min(cap);
        for id in &members {
            if let Some(entity) = world.entities.get_mut(id) {
                support::set_int(entity, "maturity", next);
            }
        }
    }
    Ok(())
}

fn clear_temporary_effects(entity: &mut EntityState) {
    for field in [
        "shield",
        "haste_until",
        "slow_until",
        "reveal_until",
        "empower_until",
        "defense_until",
    ] {
        if entity.fields.contains_key(&FieldId::from(field)) {
            support::set_int(entity, field, 0);
        }
    }
}

fn integer_field(entity: &EntityState, field: &str) -> Option<i64> {
    match entity.fields.get(&FieldId::from(field)) {
        Some(DomainValue::Integer(value)) => Some(*value),
        _ => None,
    }
}

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError::new(ApiErrorCode::InvalidSnapshot, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{
        ArtifactId, BattleMap, ContentDigest, CostScheduleId, HeroDefinition,
        MapNode, NextRules, RulesetId, RulesetRef, SkillDefinition,
        SkillEffect, TacticalProgram, UnitStats, Version,
    };

    fn stats() -> UnitStats {
        UnitStats {
            hp: 100,
            attack: 10,
            defense: 2,
            speed: 5,
            range: 10,
            attack_interval: 5,
            vision: 100,
        }
    }

    fn hero_definition(id: &str, placement: &str) -> HeroDefinition {
        let passive = format!("{id}_passive");
        let active = format!("{id}_active");
        HeroDefinition {
            id: id.to_owned(),
            name: id.to_owned(),
            placement: placement.to_owned(),
            role: "damage".to_owned(),
            trait_id: "assault".to_owned(),
            appearance_key: id.to_owned(),
            stats: stats(),
            growth: UnitStats {
                hp: 0,
                attack: 0,
                defense: 0,
                speed: 0,
                range: 0,
                attack_interval: 0,
                vision: 0,
            },
            skills: vec![
                SkillDefinition {
                    id: passive.clone(),
                    name: passive.clone(),
                    passive: true,
                    unlock_level: 2,
                    prerequisites: Vec::new(),
                    cooldown: 0,
                    cost: 0,
                    range: 0,
                    target: "self".to_owned(),
                    effect: SkillEffect::Defense,
                    power: 1,
                    duration: 0,
                },
                SkillDefinition {
                    id: active.clone(),
                    name: active.clone(),
                    passive: false,
                    unlock_level: 4,
                    prerequisites: vec![passive.clone()],
                    cooldown: 10,
                    cost: 5,
                    range: 10,
                    target: "enemy".to_owned(),
                    effect: SkillEffect::Damage,
                    power: 10,
                    duration: 0,
                },
            ],
            skill_paths: BTreeMap::from([("path_a".to_owned(), vec![passive, active])]),
            synergy: BTreeMap::new(),
        }
    }

    fn rules() -> NextRules {
        NextRules {
            projection_policy: None,
            minion_control: None,
            mechanics_version: Version::new(1, 0, 0),
            world_identity: None,
            map: BattleMap {
                id: "test-map".to_owned(),
                world_identity: None,
                world_projection: None,
                nodes: BTreeMap::from([
                    ("field".to_owned(), MapNode { x: 10, y: 10, region: "lane".to_owned(), ..Default::default()
}),
                    ("home".to_owned(), MapNode { x: 0, y: 0, region: "base".to_owned(), ..Default::default()
}),
                    ("far".to_owned(), MapNode { x: 500, y: 500, region: "lane".to_owned(), ..Default::default()
}),
                ]),
                edges: Vec::new(),
                lanes: BTreeMap::new(),
                attacker_base: "home".to_owned(),
                defender_base: "home".to_owned(),
                towers: Vec::new(),
            },
            heroes: vec![hero_definition("front", "frontline"), hero_definition("back", "backline")],
            minions: Vec::new(),
            monsters: Vec::new(),
            camps: Vec::new(),
            parameters: BTreeMap::from([
                ("hero_start_level".to_owned(), 1),
                ("hero_max_level".to_owned(), 6),
                ("hero_start_xp".to_owned(), 0),
                ("hero_initial_energy".to_owned(), 100),
                ("formation_spacing".to_owned(), 8),
                ("hero_respawn_base_ticks".to_owned(), 20),
                ("hero_respawn_per_level_ticks".to_owned(), 5),
                ("squad_maturation_ticks".to_owned(), 40),
                ("squad_merge_distance".to_owned(), 30),
            ]),
        }
    }

    fn snapshot(entries: &[(&str, &str, &str, &str, &str)]) -> SenkeiSnapshot {
        let heroes = entries
            .iter()
            .map(|(slot, catalog, squad, node, path)| {
                DomainValue::Record(BTreeMap::from([
                    (FieldId::from("slot_id"), DomainValue::String((*slot).to_owned())),
                    (FieldId::from("catalog_id"), DomainValue::String((*catalog).to_owned())),
                    (FieldId::from("squad"), DomainValue::String((*squad).to_owned())),
                    (FieldId::from("node"), DomainValue::String((*node).to_owned())),
                    (FieldId::from("skill_path"), DomainValue::String((*path).to_owned())),
                ]))
            })
            .collect();
        let ruleset = RulesetRef {
            id: RulesetId::from("senkei.next"),
            version: Version::new(1, 0, 0),
            digest: ContentDigest::new("a".repeat(64)),
        };
        let program = TacticalProgram {
            language_version: Version::new(1, 0, 0),
            ir_version: Version::new(1, 0, 0),
            bytecode_version: Version::new(1, 0, 0),
            cost_schedule_id: CostScheduleId::from("test"),
            cost_schedule_version: Version::new(1, 0, 0),
            ruleset: ruleset.clone(),
            content_digest: ContentDigest::new("b".repeat(64)),
            bytecode: Vec::new(),
        };
        SenkeiSnapshot {
            schema_version: Version::new(1, 0, 0),
            id: ArtifactId::from("army"),
            revision: senkei_model::RevisionId::from("r1"),
            ruleset,
            configuration: BTreeMap::from([(FieldId::from("heroes"), DomainValue::List(heroes))]),
            program,
            initial_memory: BTreeMap::new(),
        }
    }

    fn loadout() -> SenkeiSnapshot {
        snapshot(&[
            ("h1", "back", "alpha", "field", "path_a"),
            ("h2", "front", "alpha", "field", "path_a"),
            ("h3", "front", "bravo", "field", "path_a"),
            ("h4", "back", "bravo", "field", "path_a"),
            ("h5", "front", "solo", "field", "path_a"),
        ])
    }

    fn hero_id(slot: &str) -> EntityId {
        hero_entity_id(CombatantSide::Attacker, slot)
    }

    fn field_int(world: &WorldState, id: &EntityId, key: &str) -> i64 {
        support::int(&world.entities[id], key)
    }

    fn field_string(world: &WorldState, id: &EntityId, key: &str) -> String {
        support::string(&world.entities[id], key)
    }

    // Only this test fixture chooses numeric maturity coefficients.
    fn relationship_fixture(
        attacker: &SenkeiSnapshot,
        pairs: &[(&str, &str, Option<i64>, Option<i64>)],
    ) -> (WorldState, crate::projected_assets::RelationRuntime, senkei_model::ProjectionPolicy, senkei_model::MatchProjection) {
        use senkei_model::{AssetAuthority, MatchProjection, ProjectedHero, ProjectedRelation, ProjectedSide,
            ProjectedStat, ProjectionPolicy, RelationFormula, RelationMaturityAggregation, RelationMaturityPolicy,
            RelationMaturityPolicyRef, RelationMaturityTarget, RelationRounding};
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, attacker, CombatantSide::Attacker, &rules).unwrap();
        initialize(&mut world, &loadout(), CombatantSide::Defender, &rules).unwrap();
        let version = Version::new(1, 0, 0);
        let stat = RelationFormula { version, stat: ProjectedStat::Defense, add_per_level: 0, max_level: 10, max_bonus: 0, rounding: RelationRounding::Floor };
        let maturity = RelationMaturityPolicy { version: Version::new(3, 0, 0), target: RelationMaturityTarget::SquadMaturityIncrement, aggregation: RelationMaturityAggregation::CompletePairMean, add_per_level: 1, max_level: 10, max_bonus: 2, rounding: RelationRounding::Floor };
        let stat_digest = crate::digest_json(&stat).unwrap();
        let maturity_ref = RelationMaturityPolicyRef { version: maturity.version, digest: crate::digest_json(&maturity).unwrap() };
        let policy = ProjectionPolicy { schema_version: 1, test_only: true, hero_catalog_id: "test-catalog".into(), hero_catalog_version: version, hero_catalog_digest: ContentDigest::new("test-digest"), equipment: BTreeMap::new(), relation: Some(stat), maturity: Some(maturity) };
        let mut sides = BTreeMap::new();
        for side in [CombatantSide::Attacker, CombatantSide::Defender] {
            let owner = format!("owner-{side:?}");
            let heroes = (1..=5).map(|n| {
                let slot = format!("h{n}");
                let entity = &world.entities[&hero_entity_id(side, &slot)];
                ProjectedHero { slot_id: slot.clone(), owner_id: owner.clone(), instance_id: format!("{side:?}-{slot}"), catalog_id: support::string(entity, "catalog_id"), definition_catalog_id: policy.hero_catalog_id.clone(), definition_version: version, definition_digest: policy.hero_catalog_digest.clone(), equipment: vec![] }
            }).collect();
            let mut relations = Vec::new();
            if side == CombatantSide::Attacker {
                for (a, b, forward, backward) in pairs {
                    for (from, to, level) in [(*a, *b, *forward), (*b, *a, *backward)] {
                        relations.push(ProjectedRelation { from_instance_id: format!("{side:?}-{from}"), to_instance_id: format!("{side:?}-{to}"), level, formula_version: Some(version), formula_digest: Some(stat_digest.clone()), maturity_policy: Some(maturity_ref.clone()) });
                    }
                }
            }
            sides.insert(side, ProjectedSide { owner_id: owner, authority: AssetAuthority::Local, heroes, relations });
        }
        let projection = MatchProjection { schema_version: 1, sides };
        let runtime = crate::projected_assets::apply(&mut world, Some(&policy), &projection).unwrap();
        (world, runtime, policy, projection)
    }

    #[test]
    fn relationships_accelerate_existing_maturity_only_for_living_cohesive_squad() {
        let rules = rules();
        let (mut world, runtime, _, _) = relationship_fixture(&loadout(), &[("h1", "h2", Some(4), Some(6))]);
        for tick in 1..=2 {
            lifecycle_with_relationships(&mut world, &rules, tick, Some(&runtime)).unwrap();
            assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), i64::from(tick) * 3);
            assert_eq!(field_int(&world, &hero_id("h2"), "maturity"), i64::from(tick) * 3);
            assert_eq!(field_int(&world, &hero_id("h3"), "maturity"), i64::from(tick));
            assert_eq!(field_int(&world, &hero_id("h5"), "maturity"), 0);
            assert_eq!(field_int(&world, &hero_entity_id(CombatantSide::Defender, "h1"), "maturity"), i64::from(tick));
        }
        intents(&mut world, &rules, &[(CombatantSide::Attacker, intent("split", "h1", None, "split"))], 3);
        lifecycle_with_relationships(&mut world, &rules, 3, Some(&runtime)).unwrap();
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 0);
        assert_eq!(field_int(&world, &hero_id("h2"), "maturity"), 0);
        intents(&mut world, &rules, &[(CombatantSide::Attacker, intent("merge", "h1", Some("h2"), "merge"))], 5);
        lifecycle_with_relationships(&mut world, &rules, 5, Some(&runtime)).unwrap();
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 3);
        assert_eq!(field_int(&world, &hero_id("h2"), "maturity"), 3);

        let dead = world.entities.get_mut(&hero_id("h1")).unwrap();
        support::set_int(dead, "hp", 0);
        support::set_int(dead, "death_tick", 6);
        lifecycle_with_relationships(&mut world, &rules, 6, Some(&runtime)).unwrap();
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 0);
        assert_eq!(field_int(&world, &hero_id("h2"), "maturity"), 0);
        lifecycle_with_relationships(&mut world, &rules, 26, Some(&runtime)).unwrap();
        assert_ne!(field_string(&world, &hero_id("h1"), "squad"), field_string(&world, &hero_id("h2"), "squad"));
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 0);
        support::place(world.entities.get_mut(&hero_id("h1")).unwrap(), "field", &rules);
        intents(&mut world, &rules, &[(CombatantSide::Attacker, intent("merge", "h1", Some("h2"), "rejoin"))], 28);
        lifecycle_with_relationships(&mut world, &rules, 28, Some(&runtime)).unwrap();
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 3);
        support::place(world.entities.get_mut(&hero_id("h1")).unwrap(), "far", &rules);
        lifecycle_with_relationships(&mut world, &rules, 29, Some(&runtime)).unwrap();
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 0);
        assert_eq!(field_int(&world, &hero_id("h2"), "maturity"), 0);
    }

    #[test]
    fn pair_normalization_unknowns_and_cap_do_not_replace_normal_maturity() {
        let rules = rules();
        let three = snapshot(&[("h1", "back", "alpha", "field", "path_a"), ("h2", "front", "alpha", "field", "path_a"), ("h3", "front", "alpha", "field", "path_a"), ("h4", "back", "bravo", "field", "path_a"), ("h5", "front", "bravo", "field", "path_a")]);
        let pairs = [("h1", "h2", Some(1), Some(3)), ("h1", "h3", Some(1), Some(3)), ("h2", "h3", Some(1), Some(3))];
        let (mut pair_world, pair_runtime, _, _) = relationship_fixture(&loadout(), &[("h1", "h2", Some(1), Some(3))]);
        lifecycle_with_relationships(&mut pair_world, &rules, 1, Some(&pair_runtime)).unwrap();
        let (mut world, runtime, policy, projection) = relationship_fixture(&three, &pairs);
        lifecycle_with_relationships(&mut world, &rules, 1, Some(&runtime)).unwrap();
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), field_int(&pair_world, &hero_id("h1"), "maturity"), "three equal pairs have the same bonus as one pair");
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 3);
        for slot in ["h1", "h2", "h3"] { support::set_int(world.entities.get_mut(&hero_id(slot)).unwrap(), "maturity", 39); }
        lifecycle_with_relationships(&mut world, &rules, 2, Some(&runtime)).unwrap();
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 40);

        let mut unknown = projection.clone();
        unknown.sides.get_mut(&CombatantSide::Attacker).unwrap().relations[0].level = None;
        let (mut original, _, _, _) = relationship_fixture(&three, &pairs);
        for slot in ["h1", "h2", "h3"] { support::set_int(original.entities.get_mut(&hero_id(slot)).unwrap(), "maturity", 7); }
        let unknown_runtime = crate::projected_assets::apply(&mut original, Some(&policy), &unknown).unwrap();
        lifecycle_with_relationships(&mut original, &rules, 1, Some(&unknown_runtime)).unwrap();
        assert_eq!(field_int(&original, &hero_id("h1"), "maturity"), 8, "unknown does not erase normal progress or imply a bonus");

        let mut no_policy = policy.clone();
        no_policy.maturity = None;
        let mut no_refs = projection.clone();
        for relation in &mut no_refs.sides.get_mut(&CombatantSide::Attacker).unwrap().relations { relation.maturity_policy = None; }
        let (mut baseline, _, _, _) = relationship_fixture(&three, &pairs);
        let baseline_runtime = crate::projected_assets::apply(&mut baseline, Some(&no_policy), &no_refs).unwrap();
        lifecycle_with_relationships(&mut baseline, &rules, 1, Some(&baseline_runtime)).unwrap();
        assert_eq!(field_int(&baseline, &hero_id("h1"), "maturity"), 1, "absent policy preserves normal maturity");

        let mut reordered = projection.clone();
        let player = reordered.sides.get_mut(&CombatantSide::Attacker).unwrap();
        player.heroes.reverse(); player.relations.reverse();
        for relation in &mut player.relations { relation.level = relation.level.map(|level| if level == 1 { 3 } else { 1 }); }
        let (mut reordered_world, _, _, _) = relationship_fixture(&three, &pairs);
        let reordered_runtime = crate::projected_assets::apply(&mut reordered_world, Some(&policy), &reordered).unwrap();
        lifecycle_with_relationships(&mut reordered_world, &rules, 1, Some(&reordered_runtime)).unwrap();
        assert_eq!(field_int(&reordered_world, &hero_id("h1"), "maturity"), 3);
    }

    #[test]
    fn maturity_reference_and_limits_are_checked_before_world_mutation() {
        let pairs = [("h1", "h2", Some(4), Some(6))];
        let (world, _, policy, projection) = relationship_fixture(&loadout(), &pairs);
        let mut invalid = projection.clone();
        invalid.sides.get_mut(&CombatantSide::Attacker).unwrap().relations[0].maturity_policy.as_mut().unwrap().digest = ContentDigest::new("wrong");
        let mut unchanged = world.clone();
        assert!(crate::projected_assets::apply(&mut unchanged, Some(&policy), &invalid).is_err());
        assert_eq!(unchanged, world);
        let mut missing_stat_ref = projection.clone();
        missing_stat_ref.sides.get_mut(&CombatantSide::Attacker).unwrap().relations[0].formula_version = None;
        assert!(crate::projected_assets::apply(&mut unchanged, Some(&policy), &missing_stat_ref).is_err());
        assert_eq!(unchanged, world);
        for invalid_value in [-1, 1_000_001] {
            let mut bad = policy.clone();
            bad.maturity.as_mut().unwrap().max_bonus = invalid_value;
            assert!(crate::projected_assets::apply(&mut unchanged, Some(&bad), &projection).is_err());
            assert_eq!(unchanged, world);
        }
        let mut absent = policy.clone();
        absent.maturity = None;
        assert!(crate::projected_assets::apply(&mut unchanged, Some(&absent), &projection).is_err());
        assert_eq!(unchanged, world);
        let mut too_low = policy.clone();
        too_low.maturity.as_mut().unwrap().max_level = 4;
        let mut low_ref = projection.clone();
        let maturity = too_low.maturity.as_ref().unwrap();
        for relation in &mut low_ref.sides.get_mut(&CombatantSide::Attacker).unwrap().relations {
            relation.maturity_policy.as_mut().unwrap().digest = crate::digest_json(maturity).unwrap();
        }
        assert!(crate::projected_assets::apply(&mut unchanged, Some(&too_low), &low_ref).is_err());
        assert_eq!(unchanged, world);
    }

    fn intent(capability: &str, actor: &str, target: Option<&str>, action: &str) -> Intent {
        Intent {
            action_id: action.into(),
            capability: capability.into(),
            actor: Some(hero_id(actor)),
            target: target.map(hero_id),
            arguments: Vec::new(),
            priority: None,
        }
    }

    #[test]
    fn initializes_five_heroes_with_catalog_paths_partition_and_formation() {
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, &loadout(), CombatantSide::Attacker, &rules).unwrap();

        let heroes = world.entities.values().filter(|entity| entity.entity_type.as_str() == "hero").count();
        assert_eq!(heroes, 5);
        assert_eq!(field_string(&world, &hero_id("h1"), "squad"), "attacker:alpha");
        assert_eq!(field_int(&world, &hero_id("h2"), "formation"), 0);
        assert_eq!(field_int(&world, &hero_id("h1"), "formation"), 1);
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 0);
        assert_eq!(field_int(&world, &hero_id("h1"), "life_generation"), 0);
        assert_eq!(field_int(&world, &hero_id("h1"), "passive_generation"), 0);
        assert_eq!(field_int(&world, &hero_id("h1"), "x"), 6);
        assert_eq!(field_int(&world, &hero_id("h1"), "y"), 14);
        assert_eq!(field_int(&world, &hero_id("h2"), "x"), 14);
        assert_eq!(field_int(&world, &hero_id("h2"), "y"), 6);
        assert_eq!(field_int(&world, &hero_id("h5"), "x"), 10);
        assert_eq!(field_int(&world, &hero_id("h5"), "y"), 10);
        assert_eq!(field_string(&world, &hero_id("h1"), "skill_path"), "path_a");
        let DomainValue::Record(cooldowns) = &world.entities[&hero_id("h1")].fields[&FieldId::from("cooldowns")] else {
            panic!("cooldowns must be a finite record");
        };
        assert_eq!(cooldowns.len(), 4);

        let invalid_loadout = snapshot(&[
            ("h1", "front", "alpha", "field", "missing"),
            ("h1", "front", "alpha", "field", "path_a"),
            ("h3", "front", "bravo", "field", "path_a"),
            ("h4", "back", "bravo", "field", "path_a"),
            ("h5", "front", "solo", "field", "path_a"),
        ]);
        let before = world.clone();
        assert!(initialize(&mut world, &invalid_loadout, CombatantSide::Defender, &rules).is_err());
        assert_eq!(world, before, "failed preparation must not partially create Heroes");
    }

    #[test]
    fn five_hero_formation_offsets_are_ranked_distinct_and_side_reversed() {
        let rules = rules();
        let quintet = snapshot(&[
            ("h1", "back", "quintet", "field", "path_a"),
            ("h2", "front", "quintet", "field", "path_a"),
            ("h3", "front", "quintet", "field", "path_a"),
            ("h4", "back", "quintet", "field", "path_a"),
            ("h5", "front", "quintet", "field", "path_a"),
        ]);
        let mut attacker = WorldState::default();
        initialize(&mut attacker, &quintet, CombatantSide::Attacker, &rules).unwrap();
        let expected = [
            ("h2", 18, 10),
            ("h3", 10, 18),
            ("h5", 10, 10),
            ("h1", 2, 10),
            ("h4", 10, 2),
        ];
        for (slot, x, y) in expected {
            assert_eq!(field_int(&attacker, &hero_id(slot), "x"), x);
            assert_eq!(field_int(&attacker, &hero_id(slot), "y"), y);
        }

        let mut defender = WorldState::default();
        initialize(&mut defender, &quintet, CombatantSide::Defender, &rules).unwrap();
        assert_eq!(support::int(&defender.entities[&hero_entity_id(CombatantSide::Defender, "h2")], "x"), 2);
        assert_eq!(support::int(&defender.entities[&hero_entity_id(CombatantSide::Defender, "h2")], "y"), 10);
        assert_eq!(support::int(&defender.entities[&hero_entity_id(CombatantSide::Defender, "h4")], "x"), 10);
        assert_eq!(support::int(&defender.entities[&hero_entity_id(CombatantSide::Defender, "h4")], "y"), 18);
    }

    #[test]
    fn initial_level_scales_base_stats_and_respects_max_level() {
        let mut rules = rules();
        rules.parameters.insert("hero_start_level".to_owned(), 3);
        rules.parameters.insert("hero_start_xp".to_owned(), 2);
        rules.heroes[0].growth = UnitStats {
            hp: 5,
            attack: 2,
            defense: 1,
            speed: 1,
            range: 1,
            attack_interval: 0,
            vision: 2,
        };
        let mut world = WorldState::default();
        initialize(&mut world, &loadout(), CombatantSide::Attacker, &rules).unwrap();
        let front = &world.entities[&hero_id("h2")];
        assert_eq!(support::int(front, "level"), 3);
        assert_eq!(support::int(front, "xp"), 5_040);
        assert_eq!(support::int(front, "max_hp"), 110);
        assert_eq!(support::int(front, "hp"), 110);
        assert_eq!(support::int(front, "attack"), 14);
        assert_eq!(support::int(front, "speed"), 7);

        rules.parameters.insert("hero_max_level".to_owned(), 2);
        let mut invalid_world = WorldState::default();
        assert!(initialize(&mut invalid_world, &loadout(), CombatantSide::Attacker, &rules).is_err());
        assert!(invalid_world.entities.is_empty());
    }

    #[test]
    fn rejects_incomplete_rosters_and_initial_squads_spanning_nodes() {
        let rules = rules();
        let incomplete = snapshot(&[
            ("h1", "front", "alpha", "field", "path_a"),
            ("h2", "front", "alpha", "field", "path_a"),
            ("h3", "front", "bravo", "field", "path_a"),
            ("h4", "back", "bravo", "field", "path_a"),
        ]);
        let mut world = WorldState::default();
        assert!(initialize(&mut world, &incomplete, CombatantSide::Attacker, &rules).is_err());
        assert!(world.entities.is_empty());

        let split_partition = snapshot(&[
            ("h1", "front", "alpha", "field", "path_a"),
            ("h2", "back", "alpha", "far", "path_a"),
            ("h3", "front", "bravo", "field", "path_a"),
            ("h4", "back", "bravo", "field", "path_a"),
            ("h5", "front", "solo", "field", "path_a"),
        ]);
        assert!(initialize(&mut world, &split_partition, CombatantSide::Attacker, &rules).is_err());
        assert!(world.entities.is_empty());
    }

    #[test]
    fn split_regroup_and_merge_change_whole_cohorts_without_teleporting() {
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, &loadout(), CombatantSide::Attacker, &rules).unwrap();
        for id in [hero_id("h1"), hero_id("h2"), hero_id("h3"), hero_id("h4")] {
            support::set_int(world.entities.get_mut(&id).unwrap(), "maturity", 17);
        }

        intents(
            &mut world,
            &rules,
            &[(CombatantSide::Attacker, intent("split", "h1", None, "a1"))],
            1,
        );
        assert_ne!(field_string(&world, &hero_id("h1"), "squad"), field_string(&world, &hero_id("h2"), "squad"));
        assert_eq!(field_int(&world, &hero_id("h2"), "maturity"), 0);

        intents(
            &mut world,
            &rules,
            &[(CombatantSide::Attacker, intent("regroup", "h1", Some("h3"), "a2"))],
            2,
        );
        assert_eq!(field_string(&world, &hero_id("h1"), "squad"), "attacker:bravo");
        assert_eq!(field_string(&world, &hero_id("h4"), "squad"), "attacker:bravo");
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 0);

        intents(
            &mut world,
            &rules,
            &[(CombatantSide::Attacker, intent("merge", "h2", Some("h3"), "a3"))],
            3,
        );
        let merged_squad = field_string(&world, &hero_id("h2"), "squad");
        assert_eq!(merged_squad, "attacker:bravo");
        assert_eq!(field_string(&world, &hero_id("h1"), "squad"), merged_squad);
        assert_eq!(field_string(&world, &hero_id("h2"), "squad"), field_string(&world, &hero_id("h4"), "squad"));
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 0);

        let far = rules.map.nodes["far"].clone();
        support::set_string(world.entities.get_mut(&hero_id("h5")).unwrap(), "node", "far");
        support::set_int(world.entities.get_mut(&hero_id("h5")).unwrap(), "x", far.x);
        support::set_int(world.entities.get_mut(&hero_id("h5")).unwrap(), "y", far.y);
        intents(
            &mut world,
            &rules,
            &[(CombatantSide::Attacker, intent("merge", "h5", Some("h3"), "a4"))],
            4,
        );
        assert_eq!(field_string(&world, &hero_id("h5"), "squad"), "attacker:solo");
    }

    #[test]
    fn merge_propagates_target_squads_route_to_prevent_divergence() {
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, &loadout(), CombatantSide::Attacker, &rules).unwrap();
        for slot in ["h1", "h2"] {
            let hero = world.entities.get_mut(&hero_id(slot)).unwrap();
            support::set_string(hero, "goal", "far");
            hero.fields.insert("target".into(), DomainValue::Entity("old_target".into()));
        }
        for slot in ["h3", "h4"] {
            support::set_string(world.entities.get_mut(&hero_id(slot)).unwrap(), "goal", "field");
        }

        intents(
            &mut world,
            &rules,
            &[(CombatantSide::Attacker, intent("merge", "h1", Some("h3"), "merge-a"))],
            1,
        );
        for slot in ["h1", "h2", "h3", "h4"] {
            let hero = &world.entities[&hero_id(slot)];
            assert_eq!(support::string(hero, "goal"), "field");
            assert_eq!(hero.fields[&FieldId::from("target")], DomainValue::Null);
        }
    }

    #[test]
    fn competing_intents_resolve_independently_of_input_order() {
        let rules = rules();
        let mut first = WorldState::default();
        initialize(&mut first, &loadout(), CombatantSide::Attacker, &rules).unwrap();
        let mut second = first.clone();
        let join_first = intent("merge", "h1", Some("h3"), "a1");
        let join_second = intent("merge", "h2", Some("h5"), "a2");

        intents(
            &mut first,
            &rules,
            &[
                (CombatantSide::Attacker, join_first.clone()),
                (CombatantSide::Attacker, join_second.clone()),
            ],
            1,
        );
        intents(
            &mut second,
            &rules,
            &[
                (CombatantSide::Attacker, join_second),
                (CombatantSide::Attacker, join_first),
            ],
            1,
        );
        assert_eq!(first, second);
        // The first merge consumes the cohort's action. A second member cannot
        // move the newly merged subject into another Squad in the same tick.
        assert_eq!(field_string(&first, &hero_id("h1"), "squad"), "attacker:bravo");
        assert_eq!(field_int(&first, &hero_id("h2"), "action_lock_until"), 2);
    }

    #[test]
    fn death_departure_and_respawn_create_a_solo_that_needs_explicit_rejoin() {
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, &loadout(), CombatantSide::Attacker, &rules).unwrap();
        let dead = world.entities.get_mut(&hero_id("h1")).unwrap();
        support::set_int(dead, "hp", 0);
        support::set_int(dead, "death_tick", 3);
        support::set_int(dead, "xp", 77);
        dead.fields.insert(
            FieldId::from("skills"),
            DomainValue::List(vec![DomainValue::String("back_passive".to_owned())]),
        );

        lifecycle(&mut world, &rules, 3);
        assert_eq!(field_string(&world, &hero_id("h1"), "squad"), "");
        assert_eq!(field_string(&world, &hero_id("h2"), "squad"), "attacker:alpha");
        assert_eq!(field_int(&world, &hero_id("h1"), "respawn_at"), 23);

        lifecycle(&mut world, &rules, 22);
        assert_eq!(field_int(&world, &hero_id("h1"), "hp"), 0);
        lifecycle(&mut world, &rules, 23);
        assert_eq!(field_int(&world, &hero_id("h1"), "hp"), 100);
        assert_eq!(field_int(&world, &hero_id("h1"), "life_generation"), 1);
        assert_eq!(field_string(&world, &hero_id("h1"), "track"), "");
        assert_eq!(field_int(&world, &hero_id("h1"), "ford_active"), 0);
        assert_eq!(field_int(&world, &hero_id("h1"), "cross_remaining"), 0);
        assert_eq!(field_int(&world, &hero_id("h1"), "passive_generation"), 0);
        assert_eq!(field_string(&world, &hero_id("h1"), "node"), "home");
        assert_eq!(field_int(&world, &hero_id("h1"), "xp"), 77);
        assert_ne!(field_string(&world, &hero_id("h1"), "squad"), "attacker:alpha");
        assert_ne!(field_string(&world, &hero_id("h1"), "squad"), field_string(&world, &hero_id("h2"), "squad"));
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 0);

        let home = rules.map.nodes["home"].clone();
        let returning = world.entities.get_mut(&hero_id("h2")).unwrap();
        support::place(returning, "home", &rules);
        support::set_int(returning, "x", home.x);
        support::set_int(returning, "y", home.y);
        intents(
            &mut world,
            &rules,
            &[(CombatantSide::Attacker, intent("regroup", "h1", Some("h2"), "a5"))],
            24,
        );
        assert_eq!(field_string(&world, &hero_id("h1"), "squad"), field_string(&world, &hero_id("h2"), "squad"));
        assert_eq!(field_int(&world, &hero_id("h1"), "maturity"), 0);
    }

    #[test]
    fn squad_cohesion_depends_on_logical_positions_instead_of_drawing_coordinates() {
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, &loadout(), CombatantSide::Attacker, &rules).unwrap();
        let members = vec![hero_id("h1"), hero_id("h2")];
        support::set_int(world.entities.get_mut(&members[0]).unwrap(), "x", -1_000_000);
        support::set_int(world.entities.get_mut(&members[1]).unwrap(), "x", 1_000_000);
        assert!(cohesive(&world, &members, 30, &rules));
        support::place(world.entities.get_mut(&members[1]).unwrap(), "far", &rules);
        let x = support::int(&world.entities[&members[0]], "x");
        support::set_int(world.entities.get_mut(&members[1]).unwrap(), "x", x);
        assert!(!cohesive(&world, &members, 30, &rules));
    }


    #[test]
    fn expanded_bridge_merge_requires_a_shared_track() {
        let mut rules = rules();
        rules.map.edges.push(senkei_model::MapEdge {
            from: "field".into(), to: "home".into(), length: 100,
            region: "bridge".into(), bridge_site: "TOP".into(), ..Default::default()
        });
        let mut world = WorldState::default();
        initialize(&mut world, &loadout(), CombatantSide::Attacker, &rules).unwrap();
        for (slot, track) in [("h1", "LEFT"), ("h2", "LEFT"), ("h3", "RIGHT"), ("h4", "RIGHT")] {
            let entity = world.entities.get_mut(&hero_id(slot)).unwrap();
            support::set_string(entity, "edge_to", "home");
            support::set_int(entity, "edge_progress", 20);
            support::set_string(entity, "track", track);
        }
        merge(&mut world, &rules, CombatantSide::Attacker, &hero_id("h1"), &hero_id("h3"));
        assert_ne!(field_string(&world, &hero_id("h1"), "squad"), field_string(&world, &hero_id("h3"), "squad"));
        for slot in ["h3", "h4"] {
            support::set_string(world.entities.get_mut(&hero_id(slot)).unwrap(), "track", "LEFT");
        }
        merge(&mut world, &rules, CombatantSide::Attacker, &hero_id("h1"), &hero_id("h3"));
        assert_eq!(field_string(&world, &hero_id("h1"), "squad"), field_string(&world, &hero_id("h3"), "squad"));
    }

}
