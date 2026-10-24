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
    if starting_level < 1 || starting_xp < 0 || starting_energy < 0 {
        return Err(invalid("Hero starting level, XP, and energy must be non-negative (level at least one)"));
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
            formation_by_slot.insert(seed.slot_id.clone(), rank as i64);
        }
    }

    let mut prepared = Vec::with_capacity(HERO_COUNT);
    for seed in seeds {
        let id = hero_entity_id(side, &seed.slot_id);
        if world.entities.contains_key(&id) {
            return Err(invalid(format!("Hero entity ID `{id}` is already present")));
        }
        let mut entity = support::unit("hero", Some(side), &seed.definition.stats, &seed.node, rules);
        support::set_string(&mut entity, "slot_id", &seed.slot_id);
        support::set_string(&mut entity, "catalog_id", &seed.catalog_id);
        support::set_string(&mut entity, "squad", &seed.squad_id);
        support::set_string(&mut entity, "skill_path", &seed.skill_path);
        support::set_int(&mut entity, "xp", starting_xp);
        support::set_int(&mut entity, "level", starting_level);
        support::set_int(&mut entity, "maturity", 0);
        support::set_int(
            &mut entity,
            "formation",
            formation_by_slot.get(&seed.slot_id).copied().unwrap_or(0),
        );
        support::set_int(&mut entity, "respawn_at", 0);
        support::set_int(&mut entity, "energy", starting_energy);
        entity.fields.insert(FieldId::from("skills"), DomainValue::List(Vec::new()));
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
        match intent.capability.as_str() {
            "split" => split(world, rules, *side, &actor_id, _tick),
            "merge" | "regroup" => {
                let Some(target_id) = target_for(intent) else { continue };
                merge(world, rules, *side, &actor_id, &target_id);
            }
            _ => {}
        }
    }
}

/// Apply deaths, Solo respawns, and the time spent maintaining formation.
/// W4 sets `hp` to zero and writes `death_tick` before this hook runs.
pub fn lifecycle(world: &mut WorldState, rules: &NextRules, tick: u32) {
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
            support::set_int(entity, "respawn_at", death_tick.saturating_add(cooldown));
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

    advance_maturity(world, rules, &changed_squads);
}

fn parse_loadout(
    snapshot: &SenkeiSnapshot,
    side: CombatantSide,
    rules: &NextRules,
) -> Result<Vec<HeroSeed>, ApiError> {
    let Some(DomainValue::List(records)) = snapshot.configuration.get(&FieldId::from(HEROES_FIELD)) else {
        return Err(invalid("snapshot configuration must contain a `heroes` list"));
    };
    if records.len() != HERO_COUNT {
        return Err(invalid("snapshot configuration must contain exactly five Heroes"));
    }

    let required = ["slot_id", "catalog_id", "squad", "node", "skill_path"];
    let mut slots = BTreeSet::new();
    let mut squad_nodes: BTreeMap<String, String> = BTreeMap::new();
    let mut seeds = Vec::with_capacity(HERO_COUNT);
    for (index, record) in records.iter().enumerate() {
        let DomainValue::Record(fields) = record else {
            return Err(invalid(format!("`heroes[{index}]` must be a record")));
        };
        if fields.len() != required.len() || required.iter().any(|key| !fields.contains_key(&FieldId::from(*key))) {
            return Err(invalid(format!("`heroes[{index}]` must have exactly slot_id, catalog_id, squad, node, and skill_path")));
        }
        let slot_id = required_string(fields, "slot_id", index)?;
        let catalog_id = required_string(fields, "catalog_id", index)?;
        let squad_label = required_string(fields, "squad", index)?;
        let node = required_string(fields, "node", index)?;
        let skill_path = required_string(fields, "skill_path", index)?;
        for (name, value) in [
            ("slot_id", &slot_id),
            ("catalog_id", &catalog_id),
            ("squad", &squad_label),
            ("node", &node),
            ("skill_path", &skill_path),
        ] {
            if value.trim().is_empty() {
                return Err(invalid(format!("`heroes[{index}].{name}` must not be empty")));
            }
        }
        if !slots.insert(slot_id.clone()) {
            return Err(invalid(format!("Hero slot `{slot_id}` is configured more than once")));
        }
        if !rules.map.nodes.contains_key(&node) {
            return Err(invalid(format!("Hero slot `{slot_id}` names unknown map node `{node}`")));
        }

        if let Some(existing_node) = squad_nodes.get(&squad_label) {
            if existing_node != &node {
                return Err(invalid(format!("initial squad `{squad_label}` spans multiple map nodes")));
            }
        } else {
            squad_nodes.insert(squad_label.clone(), node.clone());
        }

        let matching = rules.heroes.iter().filter(|definition| definition.id == catalog_id).collect::<Vec<_>>();
        if matching.len() != 1 {
            return Err(invalid(format!("Hero catalog ID `{catalog_id}` must identify exactly one catalog entry")));
        }
        let definition = matching[0];
        validate_hero_stats(definition)?;
        let Some(path) = definition.skill_paths.get(&skill_path) else {
            return Err(invalid(format!("Hero `{catalog_id}` has no configured skill path `{skill_path}`")));
        };
        let mut path_skills = BTreeSet::new();
        for skill_id in path {
            let matches = definition.skills.iter().filter(|skill| skill.id == *skill_id).count();
            if matches != 1 || !path_skills.insert(skill_id) {
                return Err(invalid(format!("skill path `{skill_path}` for `{catalog_id}` contains an unknown or repeated skill `{skill_id}`")));
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

fn hero_entity_id(side: CombatantSide, slot_id: &str) -> EntityId {
    EntityId::from(format!("hero:{}:{slot_id}", support::side_name(side)))
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
    if !cohesive(world, &members, distance) {
        return;
    }

    for member_id in &members {
        if let Some(member) = world.entities.get_mut(member_id) {
            support::set_string(member, "squad", &target_squad_id);
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

fn cohesive(world: &WorldState, members: &[EntityId], distance: i64) -> bool {
    let max_distance_squared = i128::from(distance).saturating_mul(i128::from(distance));
    for left_index in 0..members.len() {
        let Some(left) = world.entities.get(&members[left_index]) else { return false };
        for right_id in members.iter().skip(left_index + 1) {
            let Some(right) = world.entities.get(right_id) else { return false };
            if support::distance2(left, right) > max_distance_squared {
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
) {
    let cap = support::param(rules, "squad_maturation_ticks", 40).max(1);
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
        if !cohesive(world, &members, distance) {
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
        let next = prior.saturating_add(1).min(cap);
        for id in &members {
            if let Some(entity) = world.entities.get_mut(id) {
                support::set_int(entity, "maturity", next);
            }
        }
    }
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
            mechanics_version: Version::new(1, 0, 0),
            map: BattleMap {
                id: "test-map".to_owned(),
                nodes: BTreeMap::from([
                    ("field".to_owned(), MapNode { x: 10, y: 10, region: "lane".to_owned() }),
                    ("home".to_owned(), MapNode { x: 0, y: 0, region: "base".to_owned() }),
                    ("far".to_owned(), MapNode { x: 500, y: 500, region: "lane".to_owned() }),
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
                ("hero_start_xp".to_owned(), 0),
                ("hero_initial_energy".to_owned(), 100),
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
        assert_eq!(field_string(&first, &hero_id("h1"), "squad"), "attacker:solo");
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
}
