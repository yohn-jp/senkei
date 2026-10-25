//! Deterministic combat, skill, growth, and neutral-objective transitions.
//!
//! `xp` is stored in 1/2520 XP units. A kill is split equally among all
//! phase-start living Heroes on a contributing side who are in range, across
//! one or both teams. This exactly represents every possible denominator up
//! to ten without an ordering-based remainder.
//!
//! A combat phase reads one frozen start-of-phase snapshot. All basic attacks
//! and accepted skill activations from living units are selected from that
//! snapshot before damage is committed. Instant heals, shields, and timed
//! modifiers apply before the collected damage; damage is summed per target,
//! then HP/death, XP, level growth, and path unlocks are resolved. Thus a unit
//! killed during this phase still completes its already-selected attack.

use crate::next_support as support;
use senkei_model::{
    CombatantSide, DomainValue, EntityId, EntityState, FieldId, Intent,
    MatchOutcome, NextRules, PresentationEvent, SkillDefinition, SkillEffect, UnitStats,
    WorldState,
};
use std::collections::{BTreeMap, BTreeSet};

const XP_SCALE: i64 = 2520;

#[derive(Clone)]
struct Hit {
    source: EntityId,
    target: EntityId,
    raw_power: i64,
    event: &'static str,
    uses_basic_attack: bool,
}

#[derive(Clone)]
struct PendingEffect {
    source: EntityId,
    target: EntityId,
    skill: SkillDefinition,
    side: CombatantSide,
}

/// Add towers, bases, and each camp's neutral monster to the initial world.
/// Stable IDs are derived only from the versioned map and camp definitions.
pub fn initialize_objectives(world: &mut WorldState, rules: &NextRules) {
    for placement in &rules.map.towers {
        let id = EntityId::from(format!("tower.{}", placement.id));
        if world.entities.contains_key(&id) {
            continue;
        }
        let Some(side) = parse_side(&placement.side) else {
            continue;
        };
        let mut entity = support::unit("tower", Some(side), &structure_stats(rules, "tower"), &placement.node, rules);
        support::set_string(&mut entity, "catalog_id", placement.id.clone());
        support::set_string(&mut entity, "lane", placement.lane.clone());
        support::set_int(&mut entity, "xp_reward", support::param(rules, "structure_tower_xp", 0).max(0));
        world.entities.insert(id, entity);
    }

    for (side, node) in [
        (CombatantSide::Attacker, rules.map.attacker_base.as_str()),
        (CombatantSide::Defender, rules.map.defender_base.as_str()),
    ] {
        let id = base_id(side);
        if world.entities.contains_key(&id) {
            continue;
        }
        let mut entity = support::unit("base", Some(side), &structure_stats(rules, "base"), node, rules);
        support::set_string(&mut entity, "catalog_id", format!("base.{}", support::side_name(side)));
        support::set_int(&mut entity, "xp_reward", support::param(rules, "structure_base_xp", 0).max(0));
        world.entities.insert(id, entity);
    }

    for camp in &rules.camps {
        let id = EntityId::from(format!("monster.{}", camp.id));
        if world.entities.contains_key(&id) {
            continue;
        }
        let Some(definition) = rules.monsters.iter().find(|monster| monster.id == camp.monster) else {
            continue;
        };
        let mut entity = support::unit("monster", None, &definition.stats, &camp.node, rules);
        support::set_string(&mut entity, "catalog_id", definition.id.clone());
        support::set_string(&mut entity, "camp", camp.id.clone());
        support::set_int(&mut entity, "respawn_at", 0);
        support::set_int(&mut entity, "xp_reward", definition.xp.max(0));
        world.entities.insert(id, entity);
    }
}

/// Respawn due camp monsters. Sol should call this before generating the
/// current tick's frozen observations; `resolve` also calls it defensively.
pub fn objective_lifecycle(
    world: &mut WorldState,
    rules: &NextRules,
    tick: u32,
) -> Vec<PresentationEvent> {
    reapply_movement_passives(world, rules, tick);
    regrant_passive_shields(world, rules);
    let due: Vec<_> = world.entities.iter()
        .filter(|(_, entity)| entity.entity_type.as_str() == "monster")
        .filter(|(_, entity)| support::int(entity, "hp") <= 0)
        .filter(|(_, entity)| {
            let at = support::int(entity, "respawn_at");
            at > 0 && i64::from(tick) >= at
        })
        .map(|(id, _)| id.clone())
        .collect();
    let mut events = Vec::with_capacity(due.len());
    for id in due {
        let Some(monster) = world.entities.get_mut(&id) else { continue };
        let max_hp = support::int(monster, "max_hp").max(1);
        support::set_int(monster, "hp", max_hp);
        support::set_int(monster, "attack_ready", i64::from(tick));
        support::set_int(monster, "respawn_at", 0);
        events.push(event("next.neutral_respawn", Some(id), BTreeMap::new()));
    }
    events
}

/// Resolve skills, simultaneous basic attacks, XP, and levels for one tick.
pub fn resolve(
    world: &mut WorldState,
    rules: &NextRules,
    accepted: &[(CombatantSide, Intent)],
    tick: u32,
) -> Vec<PresentationEvent> {
    let events = objective_lifecycle(world, rules, tick);
    let start = world.clone();
    resolve_snapshot_with_events(world, &start, rules, accepted, tick, events)
}

/// Resolve attacks against a frozen pre-movement snapshot while committing
/// their effects to the post-movement world. Movement intents are marked in
/// that world and therefore suppress their source's ordinary attack.
pub fn resolve_from_snapshot(
    world: &mut WorldState,
    snapshot: &WorldState,
    rules: &NextRules,
    accepted: &[(CombatantSide, Intent)],
    tick: u32,
) -> Vec<PresentationEvent> {
    resolve_snapshot_with_events(world, snapshot, rules, accepted, tick, Vec::new())
}

/// Reserve a legal active skill as this Hero's action before movement runs.
/// Explicit movement/track/bridge actions take precedence when both intent
/// kinds target the same actor in one arbitration batch; the skill remains
/// deferred for a later tick. The marker lets the combat phase distinguish a
/// prepared skill's own lock from an earlier lock.
pub fn prepare_actions(
    world: &mut WorldState,
    snapshot: &WorldState,
    rules: &NextRules,
    accepted: &[(CombatantSide, Intent)],
    tick: u32,
) {
    let mut actions = accepted.iter().collect::<Vec<_>>();
    actions.sort_by(|(side_a, a), (side_b, b)| {
        (side_a, &a.actor, &a.action_id).cmp(&(side_b, &b.actor, &b.action_id))
    });
    let mut reserved = BTreeSet::new();
    for (side, intent) in actions {
        let Some(actor_id) = intent.actor.as_ref() else { continue };
        if reserved.contains(actor_id) || explicit_movement_action_for(actor_id, accepted, snapshot) {
            continue;
        }
        if active_skill_target(intent, *side, snapshot, rules, tick).is_none() { continue; }
        if cohort_action_lock_until(world, snapshot, actor_id) > i64::from(tick) {
            continue;
        }
        let Some(actor) = world.entities.get_mut(actor_id) else { continue };
        support::set_int(actor, "prepared_action_tick", i64::from(tick).saturating_add(1));
        let preparation = support::param(rules, "attack_preparation_ticks", 0).max(0);
        let recovery = support::param(rules, "attack_recovery_ticks", 1).max(0);
        let lock = preparation.saturating_add(recovery).max(1);
        support::set_int(actor, "action_lock_until", i64::from(tick).saturating_add(lock));
        lock_cohort(world, actor_id, i64::from(tick).saturating_add(lock));
        reserved.insert(actor_id.clone());
    }
}

fn explicit_movement_action_for(
    actor_id: &EntityId,
    accepted: &[(CombatantSide, Intent)],
    snapshot: &WorldState,
) -> bool {
    let Some(actor) = snapshot.entities.get(actor_id) else { return false };
    let actor_squad = support::string(actor, "squad");
    accepted.iter().any(|(_, intent)| {
        let Some(other_id) = intent.actor.as_ref() else { return false };
        let same_subject = if other_id == actor_id {
            true
        } else if actor_squad.is_empty() {
            false
        } else {
            snapshot.entities.get(other_id).is_some_and(|other| {
                other.entity_type.as_str() == "hero"
                    && actor.entity_type.as_str() == "hero"
                    && other.owner == actor.owner
                    && support::string(other, "squad") == actor_squad
            })
        };
        same_subject
            && matches!(intent.capability.as_str(), "move" | "pursue" | "retreat" | "select_track" | "bridge_work")
    })
}

fn cohort_member_ids(world: &WorldState, actor_id: &EntityId) -> Vec<EntityId> {
    let Some(actor) = world.entities.get(actor_id) else { return Vec::new() };
    if actor.entity_type.as_str() != "hero" {
        return vec![actor_id.clone()];
    }
    let squad = support::string(actor, "squad");
    if squad.is_empty() {
        return vec![actor_id.clone()];
    }
    world.entities.iter()
        .filter(|(_, member)| member.entity_type.as_str() == "hero"
            && member.owner == actor.owner
            && support::string(member, "squad") == squad
            && support::alive(member))
        .map(|(id, _)| id.clone())
        .collect()
}

fn lock_cohort(world: &mut WorldState, actor_id: &EntityId, until: i64) {
    let ids = cohort_member_ids(world, actor_id);
    for id in ids {
        if let Some(member) = world.entities.get_mut(&id) {
            support::set_int(member, "action_lock_until", support::int(member, "action_lock_until").max(until));
        }
    }
}

fn cohort_moved_this_tick(world: &WorldState, start: &WorldState, actor_id: &EntityId, tick: u32) -> bool {
    cohort_member_ids(start, actor_id).iter().any(|member_id| {
        world.entities.get(member_id).is_some_and(|member| {
            support::int(member, "moved_tick") == i64::from(tick).saturating_add(1)
        })
    })
}

fn cohort_action_lock_until(world: &WorldState, start: &WorldState, actor_id: &EntityId) -> i64 {
    cohort_member_ids(start, actor_id).iter().map(|member_id| {
        world.entities.get(member_id).map(|member| support::int(member, "action_lock_until")).unwrap_or_default()
            .max(start.entities.get(member_id).map(|member| support::int(member, "action_lock_until")).unwrap_or_default())
    }).max().unwrap_or_default()
}

fn active_skill_target(
    intent: &Intent,
    side: CombatantSide,
    snapshot: &WorldState,
    rules: &NextRules,
    tick: u32,
) -> Option<(SkillDefinition, EntityId)> {
    let capability = intent.capability.as_str();
    if capability != "activate" && !capability.ends_with(".activate") {
        return None;
    }
    let actor_id = intent.actor.as_ref()?;
    let actor = snapshot.entities.get(actor_id)?;
    if actor.entity_type.as_str() != "hero" || actor.owner != Some(side) || !support::alive(actor) {
        return None;
    }
    let skill_id = intent.arguments.iter().find_map(|argument| match argument {
        DomainValue::String(value) => Some(value.as_str()),
        _ => None,
    })?;
    let hero = rules.heroes.iter().find(|hero| hero.id == support::string(actor, "catalog_id"))?;
    let skill = hero.skills.iter().find(|skill| skill.id == skill_id)?.clone();
    if skill.passive || !has_skill(actor, skill_id)
        || cooldown_ready(actor, skill_id) > i64::from(tick)
        || support::int(actor, "energy") < skill.cost.max(0)
    {
        return None;
    }
    let target_id = skill_target_id(intent, actor_id, &skill.target)?;
    let target = snapshot.entities.get(&target_id)?;
    if !support::alive(target)
        || !skill_target_allowed(&skill.target, side, actor_id, &target_id, target)
        || !support::in_combat_range(actor, target, skill.range.max(0), rules)
        || (target.owner != Some(side) && !crate::next_vision::visible(snapshot, rules, side, target))
    {
        return None;
    }
    Some((skill, target_id))
}

fn resolve_snapshot_with_events(
    world: &mut WorldState,
    start: &WorldState,
    rules: &NextRules,
    accepted: &[(CombatantSide, Intent)],
    tick: u32,
    mut events: Vec<PresentationEvent>,
) -> Vec<PresentationEvent> {
    // Skills already on a selected path unlock automatically once level and
    // prerequisite conditions are met. Initial level-one heroes are handled
    // here as well as after XP below.
    learn_path_skills(world, rules, &mut events);
    // Preserve the existing same-tick passive unlock semantics while keeping
    // the supplied graph positions frozen before movement.
    let mut combat_start = start.clone();
    learn_path_skills(&mut combat_start, rules, &mut Vec::new());

    // Mature squads offer a capped, member-to-member protective shield. It is
    // a support effect with quadratic group contribution, not a blanket stat
    // multiplier; solo Heroes receive no squad contribution. Each contributor
    // is independently rounded up to a whole shield point after applying its
    // maturity and catalog modifier.
    apply_mature_squad_shields(world, rules);

    let (mut skill_damage, activations) = collect_skill_activations(world, &combat_start, rules, accepted, tick, &mut events);
    let mut hits = collect_basic_attacks(world, &combat_start, rules, tick);
    hits.append(&mut skill_damage);

    // Timed support effects are prepared together, independent of accepted
    // intent iteration order. Their magnitudes are powers from NextRules.
    apply_activations(world, rules, &combat_start, activations, tick, &mut events);

    // Damage is calculated from frozen attack values and the post-activation
    // defense state, then accumulated so target iteration cannot change who
    // survives a simultaneous exchange.
    let mut damage_by_target: BTreeMap<EntityId, i64> = BTreeMap::new();
    let mut sources_by_target: BTreeMap<EntityId, BTreeSet<EntityId>> = BTreeMap::new();
    for hit in &hits {
        let Some(source) = combat_start.entities.get(&hit.source) else { continue };
        let Some(target_start) = combat_start.entities.get(&hit.target) else { continue };
        if !support::alive(source) || !support::alive(target_start) {
            continue;
        }
        let target_now = world.entities.get(&hit.target).unwrap_or(target_start);
        let defense = effective_defense(target_now, tick);
        let power = if hit.uses_basic_attack {
            let source_now = world.entities.get(&hit.source).unwrap_or(source);
            support::int(source, "attack")
                .saturating_add(active_magnitude(source_now, "empower", "empower_until", tick))
        } else {
            hit.raw_power
        };
        let mut damage = power.saturating_sub(defense).max(1);
        if support::is_ford_position(target_start, &combat_start, rules) {
            let received = support::param(rules, "ford_received_damage_milli", 1_500).max(0);
            damage = i64::try_from(
                (i128::from(damage) * i128::from(received) + 999) / 1_000,
            ).unwrap_or(i64::MAX).max(1);
        }
        let total = damage_by_target.entry(hit.target.clone()).or_default();
        *total = total.saturating_add(damage);
        sources_by_target.entry(hit.target.clone()).or_default().insert(hit.source.clone());
        let mut payload = BTreeMap::new();
        payload.insert("source".into(), DomainValue::Entity(hit.source.clone()));
        payload.insert("target".into(), DomainValue::Entity(hit.target.clone()));
        payload.insert("amount".into(), DomainValue::Integer(damage));
        events.push(event(hit.event, Some(hit.target.clone()), payload));
    }

    let mut newly_dead = Vec::new();
    let mut reward_sources = Vec::new();
    for (target, total_damage) in &damage_by_target {
        let Some(entity) = world.entities.get_mut(target) else { continue };
        if !support::alive(entity) {
            continue;
        }
        let shield = support::int(entity, "shield").max(0);
        let absorbed = shield.min(*total_damage);
        support::set_int(entity, "shield", shield - absorbed);
        let hp_damage = total_damage.saturating_sub(absorbed);
        let old_hp = support::int(entity, "hp");
        let new_hp = old_hp.saturating_sub(hp_damage).max(0);
        support::set_int(entity, "hp", new_hp);
        if old_hp > 0 && new_hp == 0 {
            support::set_int(entity, "death_tick", i64::from(tick));
            newly_dead.push(target.clone());
            reward_sources.push(target.clone());
        }
    }

    // A dying attacker still has a collected hit; skill healing and shields
    // apply before the shared damage pool by the phase rule documented above.
    for target in newly_dead {
        let Some(victim) = world.entities.get(&target) else { continue };
        let victim_kind = victim.entity_type.to_string();
        let camp_id = support::string(victim, "camp");
        if victim_kind == "monster" {
            let respawn_ticks = rules.camps.iter()
                .find(|camp| camp.id == camp_id)
                .map(|camp| camp.respawn_ticks.max(1))
                .unwrap_or(1);
            let respawn_at = i64::from(tick).saturating_add(respawn_ticks);
            if let Some(monster) = world.entities.get_mut(&target) {
                support::set_int(monster, "respawn_at", respawn_at);
            }
        }
        let mut payload = BTreeMap::new();
        if let Some(source) = sources_by_target.get(&target).and_then(|sources| sources.iter().next()) {
            payload.insert("source".into(), DomainValue::Entity(source.clone()));
        }
        payload.insert("target".into(), DomainValue::Entity(target.clone()));
        payload.insert("amount".into(), DomainValue::Integer(
            damage_by_target.get(&target).copied().unwrap_or_default(),
        ));
        events.push(event("next.death", Some(target.clone()), payload));
        if victim_kind == "tower" || victim_kind == "base" {
            let mut payload = BTreeMap::new();
            payload.insert("kind".into(), DomainValue::String(victim_kind));
            events.push(event("next.objective_destroyed", Some(target), payload));
        }
    }

    // Qualification is frozen at phase start: living allied Heroes in the
    // configured radius share each integer reward equally. Heroes killed in
    // this combat phase remain eligible; Heroes already dead at phase start do not.
    distribute_rewards(world, rules, &combat_start, &reward_sources, &sources_by_target, &mut events);

    // Each living Hero regenerates from the configured pool after any active
    // skill cost was paid. A skill cannot spend energy generated this tick.
    regenerate_energy(world, rules, tick);
    events
}

/// Return a finished match only after all same-tick base damage is committed.
pub fn outcome(world: &WorldState) -> Option<MatchOutcome> {
    let attacker_down = world.entities.get(&base_id(CombatantSide::Attacker))
        .is_some_and(|base| support::int(base, "hp") <= 0);
    let defender_down = world.entities.get(&base_id(CombatantSide::Defender))
        .is_some_and(|base| support::int(base, "hp") <= 0);
    match (attacker_down, defender_down) {
        (true, true) => Some(MatchOutcome::Draw),
        (false, true) => Some(MatchOutcome::AttackerVictory),
        (true, false) => Some(MatchOutcome::DefenderVictory),
        (false, false) => None,
    }
}

fn collect_basic_attacks(
    world: &mut WorldState,
    start: &WorldState,
    rules: &NextRules,
    tick: u32,
) -> Vec<Hit> {
    let mut attacks = Vec::new();
    for (source_id, source) in &start.entities {
        if !support::alive(source) || !is_combatant(source) {
            continue;
        }
        // Persistent movement goals do not consume a tick. Only movement
        // selected by navigation for any cohort member excludes an attack.
        let moved_this_tick = cohort_moved_this_tick(world, start, source_id, tick);
        let current_action_lock = cohort_action_lock_until(world, start, source_id);
        if moved_this_tick
            || support::int(source, "action_lock_until").max(current_action_lock) > i64::from(tick)
        {
            continue;
        }
        let interval = support::int(source, "attack_interval").max(1);
        if support::int(source, "attack_ready") > i64::from(tick)
            || support::int(source, "attack") <= 0
            || support::int(source, "range") < 0
        {
            continue;
        }
        let selected = requested_target(source, start)
            .filter(|(target_id, target)| can_basic_attack(source_id, source, target_id, target, start, rules, tick));
        let selected = selected.or_else(|| {
            start.entities.iter()
                .filter(|(target_id, target)| can_basic_attack(source_id, source, target_id, target, start, rules, tick))
                .min_by(|(a_id, a), (b_id, b)| {
                    support::combat_distance2(source, a, rules).unwrap_or(i128::MAX)
                        .cmp(&support::combat_distance2(source, b, rules).unwrap_or(i128::MAX))
                        .then_with(|| a_id.cmp(b_id))
                })
                .map(|(id, entity)| (id.clone(), entity))
        });
        let Some((target_id, _)) = selected else { continue };
        if let Some(source_now) = world.entities.get_mut(source_id) {
            support::set_int(source_now, "attack_ready", i64::from(tick).saturating_add(interval));
            let preparation = support::param(rules, "attack_preparation_ticks", 0).max(0);
            let recovery = support::param(rules, "attack_recovery_ticks", 1).max(0);
            support::set_int(source_now, "action_lock_until", i64::from(tick).saturating_add(preparation.saturating_add(recovery).max(1)));
        }
        attacks.push(Hit {
            source: source_id.clone(),
            target: target_id,
            raw_power: support::int(source, "attack"),
            event: "next.attack",
            uses_basic_attack: true,
        });
    }
    let preparation = support::param(rules, "attack_preparation_ticks", 0).max(0);
    let recovery = support::param(rules, "attack_recovery_ticks", 1).max(0);
    let lock_until = i64::from(tick).saturating_add(preparation.saturating_add(recovery).max(1));
    let attackers = attacks.iter().map(|hit| hit.source.clone()).collect::<BTreeSet<_>>();
    for actor_id in attackers {
        lock_cohort(world, &actor_id, lock_until);
    }
    attacks
}

/// Shared target predicate used by navigation's stop-and-attack decision and
/// combat resolution. It reads only the supplied snapshot.
pub fn can_basic_attack(
    source_id: &EntityId,
    source: &EntityState,
    target_id: &EntityId,
    target: &EntityState,
    snapshot: &WorldState,
    rules: &NextRules,
    tick: u32,
) -> bool {
    if source_id == target_id
        || !support::alive(source)
        || !support::alive(target)
        || !is_targetable(target)
        || support::int(source, "attack") <= 0
        || support::int(source, "range") < 0
    {
        return false;
    }
    let _ = tick; // readiness/recovery affect action selection, not target range.
    let source_side = source.owner;
    if source_side.is_some_and(|side| target.owner == Some(side)) {
        return false;
    }
    if source.entity_type.as_str() == "monster" {
        if !matches!(target.entity_type.as_str(), "hero" | "minion") || target.owner.is_none()
            || !support::in_combat_range(source, target, support::int(source, "vision").max(0), rules)
        {
            return false;
        }
    } else if matches!(source.entity_type.as_str(), "tower" | "base") {
        if !matches!(target.entity_type.as_str(), "hero" | "minion") || target.owner.is_none() {
            return false;
        }
    }
    if !support::in_combat_range(source, target, support::int(source, "range").max(0), rules) {
        return false;
    }
    if let Some(source_side) = source_side {
        if !crate::next_vision::visible(snapshot, rules, source_side, target) {
            return false;
        }
    }
    true
}

fn collect_skill_activations(
    world: &mut WorldState,
    start: &WorldState,
    rules: &NextRules,
    accepted: &[(CombatantSide, Intent)],
    tick: u32,
    events: &mut Vec<PresentationEvent>,
) -> (Vec<Hit>, Vec<PendingEffect>) {
    let mut intents: Vec<_> = accepted.iter().collect();
    intents.sort_by(|(a_side, a), (b_side, b)| {
        (a_side, &a.actor, &a.action_id, &a.target, &a.arguments)
            .cmp(&(b_side, &b.actor, &b.action_id, &b.target, &b.arguments))
    });
    let mut used = BTreeSet::new();
    let mut damage = Vec::new();
    let mut effects = Vec::new();

    for (side, intent) in intents {
        let cap = intent.capability.as_str();
        if cap != "activate" && !cap.ends_with(".activate") {
            continue;
        }
        let Some(actor_id) = &intent.actor else { continue };
        let Some(actor) = start.entities.get(actor_id) else { continue };
        let moved_this_tick = cohort_moved_this_tick(world, start, actor_id, tick);
        let issued_other_action = explicit_movement_action_for(actor_id, accepted, start);
        let current_action_lock = cohort_action_lock_until(world, start, actor_id);
        let prepared_this_tick = world.entities.get(actor_id).is_some_and(|entity| {
            support::int(entity, "prepared_action_tick") == i64::from(tick).saturating_add(1)
        });
        if used.contains(actor_id)
            || moved_this_tick
            || issued_other_action
            || (support::int(actor, "action_lock_until").max(current_action_lock) > i64::from(tick)
                && !prepared_this_tick)
        {
            continue;
        }
        if actor.entity_type.as_str() != "hero" || actor.owner != Some(*side) || !support::alive(actor) {
            continue;
        }
        let Some(skill_id) = intent.arguments.iter().find_map(|arg| match arg {
            DomainValue::String(value) => Some(value.as_str()),
            _ => None,
        }) else { continue };
        let Some(hero) = rules.heroes.iter().find(|hero| hero.id == support::string(actor, "catalog_id")) else {
            continue;
        };
        let Some(skill) = hero.skills.iter().find(|skill| skill.id == skill_id) else { continue };
        if skill.passive || !has_skill(actor, skill_id) {
            continue;
        }
        if cooldown_ready(actor, skill_id) > i64::from(tick)
            || support::int(actor, "energy") < skill.cost.max(0)
        {
            continue;
        }
        let Some(target_id) = skill_target_id(intent, actor_id, &skill.target) else { continue };
        let Some(target) = start.entities.get(&target_id) else { continue };
        if !support::alive(target)
            || !skill_target_allowed(&skill.target, *side, actor_id, &target_id, target)
            || !support::in_combat_range(actor, target, skill.range.max(0), rules)
        {
            continue;
        }
        if target.owner != Some(*side) && !crate::next_vision::visible(start, rules, *side, target) {
            continue;
        }
        used.insert(actor_id.clone());
        if let Some(actor_now) = world.entities.get_mut(actor_id) {
            let energy = support::int(actor_now, "energy").saturating_sub(skill.cost.max(0));
            support::set_int(actor_now, "energy", energy);
            set_cooldown(actor_now, skill_id, i64::from(tick).saturating_add(skill.cooldown.max(0)));
            let preparation = support::param(rules, "attack_preparation_ticks", 0).max(0);
            let recovery = support::param(rules, "attack_recovery_ticks", 1).max(0);
            let lock_until = i64::from(tick).saturating_add(preparation.saturating_add(recovery).max(1));
            support::set_int(actor_now, "action_lock_until", lock_until);
            support::set_int(actor_now, "prepared_action_tick", 0);
        }
        let preparation = support::param(rules, "attack_preparation_ticks", 0).max(0);
        let recovery = support::param(rules, "attack_recovery_ticks", 1).max(0);
        lock_cohort(world, actor_id, i64::from(tick).saturating_add(preparation.saturating_add(recovery).max(1)));
        let mut payload = BTreeMap::new();
        payload.insert("source".into(), DomainValue::Entity(actor_id.clone()));
        payload.insert("target".into(), DomainValue::Entity(target_id.clone()));
        payload.insert("skill".into(), DomainValue::String(skill.id.clone()));
        events.push(event("next.skill", Some(actor_id.clone()), payload));
        if skill.effect == SkillEffect::Damage {
            let power = scaled_ally_effect_power(rules, actor_id, actor, &target_id, target, skill, *side);
            damage.push(Hit {
                source: actor_id.clone(),
                target: target_id,
                raw_power: power,
                event: "next.skill_damage",
                uses_basic_attack: false,
            });
        } else if skill.effect == SkillEffect::AreaDamage {
            let radius = support::param(rules, "skill_area_radius", 80).max(0);
            let radius_squared = i128::from(radius) * i128::from(radius);
            for (area_target_id, area_target) in &start.entities {
                if area_target.owner == Some(*side)
                    || !support::alive(area_target)
                    || !is_targetable(area_target)
                    || support::combat_distance2(target, area_target, rules)
                        .map_or(true, |distance| distance > radius_squared)
                    || !crate::next_vision::visible(start, rules, *side, area_target)
                {
                    continue;
                }
                damage.push(Hit {
                    source: actor_id.clone(),
                    target: area_target_id.clone(),
                    raw_power: skill.power,
                    event: "next.skill_damage",
                    uses_basic_attack: false,
                });
            }
        } else {
            effects.push(PendingEffect { source: actor_id.clone(), target: target_id, skill: skill.clone(), side: *side });
        }
    }
    (damage, effects)
}

fn apply_activations(
    world: &mut WorldState,
    rules: &NextRules,
    start: &WorldState,
    effects: Vec<PendingEffect>,
    tick: u32,
    events: &mut Vec<PresentationEvent>,
) {
    let mut healing = BTreeMap::<EntityId, i64>::new();
    let mut shields = BTreeMap::<EntityId, i64>::new();
    let mut timed = BTreeMap::<(EntityId, u8, CombatantSide), (SkillEffect, i64, i64)>::new();
    for pending in effects {
        let Some(caster) = start.entities.get(&pending.source) else { continue };
        let Some(target_start) = start.entities.get(&pending.target) else { continue };
        let power = scaled_ally_effect_power(
            rules, &pending.source, caster, &pending.target, target_start, &pending.skill, pending.side,
        ).max(0);
        match pending.skill.effect {
            SkillEffect::Heal => {
                let value = healing.entry(pending.target).or_default();
                *value = value.saturating_add(power);
            }
            SkillEffect::Shield => {
                let value = shields.entry(pending.target).or_default();
                *value = value.saturating_add(power);
            }
            SkillEffect::Haste | SkillEffect::Slow | SkillEffect::Reveal | SkillEffect::Empower | SkillEffect::Defense => {
                let expiry = i64::from(tick).saturating_add(pending.skill.duration.max(0));
                let key = (pending.target, effect_order(&pending.skill.effect), pending.side);
                let entry = timed.entry(key).or_insert((pending.skill.effect.clone(), 0, 0));
                if (power, expiry) > (entry.1, entry.2) {
                    *entry = (pending.skill.effect.clone(), power, expiry);
                }
            }
            SkillEffect::Damage => {}
            SkillEffect::AreaDamage => {}
            SkillEffect::TerrainAdaptation | SkillEffect::JungleSpecialist | SkillEffect::SoloMobility => {}
        }
    }

    for (target_id, amount) in healing {
        if let Some(target) = world.entities.get_mut(&target_id) {
            let old_hp = support::int(target, "hp");
            let max_hp = support::int(target, "max_hp").max(old_hp);
            let healed = amount.min(max_hp.saturating_sub(old_hp).max(0));
            support::set_int(target, "hp", old_hp.saturating_add(healed));
            if healed > 0 {
                events.push(amount_event("next.heal", target_id, healed));
            }
        }
    }
    for (target_id, amount) in shields {
        if let Some(target) = world.entities.get_mut(&target_id) {
            let shield = support::int(target, "shield").max(0).saturating_add(amount);
            support::set_int(target, "shield", shield);
        }
    }
    for ((target_id, _, side), (effect, power, expiry)) in timed {
        let Some(target) = world.entities.get_mut(&target_id) else { continue };
        match effect {
            SkillEffect::Haste => set_timed_magnitude(target, "haste", "haste_until", power, expiry, tick),
            SkillEffect::Slow => set_timed_magnitude(target, "slow", "slow_until", power, expiry, tick),
            SkillEffect::Reveal => {
                let field = if side == CombatantSide::Attacker { "reveal_attacker_until" } else { "reveal_defender_until" };
                set_max_int(target, field, expiry);
                set_max_int(target, "reveal_until", expiry);
            }
            SkillEffect::Empower => set_timed_magnitude(target, "empower", "empower_until", power, expiry, tick),
            SkillEffect::Defense => set_timed_magnitude(target, "defense_bonus", "defense_until", power, expiry, tick),
            SkillEffect::Damage | SkillEffect::AreaDamage | SkillEffect::Heal | SkillEffect::Shield
            | SkillEffect::TerrainAdaptation | SkillEffect::JungleSpecialist | SkillEffect::SoloMobility => {}
        }
    }
}

fn distribute_rewards(
    world: &mut WorldState,
    rules: &NextRules,
    start: &WorldState,
    dead_targets: &[EntityId],
    sources_by_target: &BTreeMap<EntityId, BTreeSet<EntityId>>,
    events: &mut Vec<PresentationEvent>,
) {
    let range = support::param(rules, "xp_eligibility_range", 0).max(0);
    for target_id in dead_targets {
        let Some(target) = start.entities.get(target_id) else { continue };
        let reward = xp_reward(target, rules).max(0);
        if reward == 0 {
            continue;
        }
        let recipient_sides: BTreeSet<_> = sources_by_target.get(target_id).into_iter().flat_map(|ids| ids.iter())
            .filter_map(|id| start.entities.get(id).and_then(|source| source.owner))
            .filter(|side| target.owner != Some(*side))
            .collect();
        let eligible: Vec<_> = recipient_sides.into_iter().flat_map(|side| {
            start.entities.iter()
                .filter(move |(_, hero)| {
                    hero.entity_type.as_str() == "hero"
                        && hero.owner == Some(side)
                        && support::alive(hero)
                        && support::world_distance2(hero, target, rules)
                            .is_some_and(|distance| distance <= i128::from(range) * i128::from(range))
                })
                .map(|(id, _)| id.clone())
        }).collect();
        if eligible.is_empty() {
            continue;
        }
        let share = exact_xp_share(reward, eligible.len());
        for hero_id in eligible {
            if let Some(hero) = world.entities.get_mut(&hero_id) {
                let xp = support::int(hero, "xp").saturating_add(share);
                support::set_int(hero, "xp", xp);
            }
            progress_levels(world, rules, &hero_id, events);
        }
    }
}

fn progress_levels(
    world: &mut WorldState,
    rules: &NextRules,
    hero_id: &EntityId,
    events: &mut Vec<PresentationEvent>,
) {
    let Some(hero_start) = world.entities.get(hero_id).cloned() else { return };
    let Some(definition) = rules.heroes.iter().find(|hero| hero.id == support::string(&hero_start, "catalog_id")) else {
        return;
    };
    let max_level = support::param(rules, "hero_max_level", 1).max(1);
    let threshold = support::param(rules, "hero_xp_per_level", 0).max(0).saturating_mul(XP_SCALE);
    if threshold <= 0 {
        return;
    }
    let initial_alive = support::alive(&hero_start);
    loop {
        let Some(hero) = world.entities.get(hero_id) else { return };
        let level = support::int(hero, "level").max(1);
        let xp = support::int(hero, "xp");
        if level >= max_level || xp < threshold {
            break;
        }
        let next_level = level.saturating_add(1);
        if let Some(hero) = world.entities.get_mut(hero_id) {
            let xp_after = support::int(hero, "xp").saturating_sub(threshold);
            support::set_int(hero, "xp", xp_after);
            support::set_int(hero, "level", next_level);
            grow_hero(hero, &definition.growth, initial_alive);
        }
        let mut payload = BTreeMap::new();
        payload.insert("level".into(), DomainValue::Integer(next_level));
        events.push(event("next.level_up", Some(hero_id.clone()), payload));
    }
    learn_path_skills(world, rules, events);
}

fn learn_path_skills(world: &mut WorldState, rules: &NextRules, events: &mut Vec<PresentationEvent>) {
    let hero_ids: Vec<_> = world.entities.iter()
        .filter(|(_, entity)| entity.entity_type.as_str() == "hero")
        .map(|(id, _)| id.clone())
        .collect();
    for hero_id in hero_ids {
        let Some(hero_state) = world.entities.get(&hero_id).cloned() else { continue };
        let Some(definition) = rules.heroes.iter().find(|hero| hero.id == support::string(&hero_state, "catalog_id")) else {
            continue;
        };
        let path_id = support::string(&hero_state, "skill_path");
        let Some(path) = definition.skill_paths.get(&path_id) else { continue };
        let level = support::int(&hero_state, "level").max(1);
        let mut learned = skill_ids(&hero_state);
        // Repeat path-order passes so a prerequisite later in the configured
        // vector can become available without depending on map iteration.
        for _ in 0..=path.len() {
            let mut changed = false;
            for skill_id in path {
                if learned.contains(skill_id) {
                    continue;
                }
                let Some(skill) = definition.skills.iter().find(|skill| &skill.id == skill_id) else {
                    continue;
                };
                if skill.unlock_level > level || !skill.prerequisites.iter().all(|required| learned.contains(required)) {
                    continue;
                }
                learned.insert(skill.id.clone());
                if let Some(hero) = world.entities.get_mut(&hero_id) {
                    push_skill(hero, &skill.id);
                    if skill.passive {
                        apply_passive(hero, skill, rules);
                    }
                }
                let mut payload = BTreeMap::new();
                payload.insert("skill".into(), DomainValue::String(skill.id.clone()));
                events.push(event("next.skill_acquired", Some(hero_id.clone()), payload));
                changed = true;
            }
            if !changed {
                break;
            }
        }
    }
}

fn apply_passive(hero: &mut EntityState, skill: &SkillDefinition, rules: &NextRules) {
    let power = skill.power.max(0);
    let permanent_until = support::param(rules, "max_match_ticks", i64::from(u32::MAX))
        .max(0)
        .saturating_add(1);
    match skill.effect {
        SkillEffect::Damage | SkillEffect::Empower => {
            add_int(hero, "attack", power);
        }
        SkillEffect::AreaDamage => {}
        SkillEffect::Heal => {
            if support::alive(hero) {
                let hp = support::int(hero, "hp");
                let max_hp = support::int(hero, "max_hp").max(hp);
                support::set_int(hero, "hp", hp.saturating_add(power).min(max_hp));
            }
        }
        SkillEffect::Shield => {
            let shield = support::int(hero, "shield").max(0).saturating_add(power);
            support::set_int(hero, "shield", shield);
        }
        SkillEffect::Haste => {
            set_max_int(hero, "haste", power);
            set_max_int(hero, "haste_until", permanent_until);
        }
        SkillEffect::Slow => {
            set_max_int(hero, "slow", power);
            set_max_int(hero, "slow_until", permanent_until);
        }
        SkillEffect::Reveal => {
            add_int(hero, "vision", power);
        }
        SkillEffect::Defense => {
            add_int(hero, "defense", power);
        }
        SkillEffect::TerrainAdaptation | SkillEffect::JungleSpecialist | SkillEffect::SoloMobility => {}
    }
}

/// Reapply only timed movement modifiers from acquired passive skills. W3
/// clears temporary effect fields on death/respawn while retaining skill IDs;
/// scanning those IDs restores passive Haste/Slow before this tick's
/// observation and movement phases without repeating permanent stat gains.
fn reapply_movement_passives(world: &mut WorldState, rules: &NextRules, tick: u32) {
    let permanent_until = support::param(rules, "max_match_ticks", i64::from(u32::MAX))
        .max(0)
        .saturating_add(1);
    let hero_ids: Vec<_> = world.entities.iter()
        .filter(|(_, hero)| hero.entity_type.as_str() == "hero" && support::alive(hero))
        .map(|(id, _)| id.clone())
        .collect();
    for hero_id in hero_ids {
        let Some(hero_state) = world.entities.get(&hero_id) else { continue };
        let catalog_id = support::string(hero_state, "catalog_id");
        let learned = skill_ids(hero_state);
        let Some(definition) = rules.heroes.iter().find(|hero| hero.id == catalog_id) else { continue };
        let mut haste = 0_i64;
        let mut slow = 0_i64;
        for skill in &definition.skills {
            if !skill.passive || !learned.contains(&skill.id) {
                continue;
            }
            match &skill.effect {
                SkillEffect::Haste => haste = haste.max(skill.power.max(0)),
                SkillEffect::Slow => slow = slow.max(skill.power.max(0)),
                _ => {}
            }
        }
        let Some(hero) = world.entities.get_mut(&hero_id) else { continue };
        if haste > 0 && support::int(hero, "haste_until") <= i64::from(tick) {
            support::set_int(hero, "haste", haste);
            support::set_int(hero, "haste_until", permanent_until);
        }
        if slow > 0 && support::int(hero, "slow_until") <= i64::from(tick) {
            support::set_int(hero, "slow", slow);
            support::set_int(hero, "slow_until", permanent_until);
        }
    }
}

/// Regrant one-time passive shields once per Hero life. Permanent stat
/// passives are intentionally excluded: W3 preserves their stat changes and
/// this generation marker covers only shields cleared on death.
fn regrant_passive_shields(world: &mut WorldState, rules: &NextRules) {
    let hero_ids: Vec<_> = world.entities.iter()
        .filter(|(_, hero)| hero.entity_type.as_str() == "hero" && support::alive(hero))
        .filter(|(_, hero)| support::int(hero, "life_generation") != support::int(hero, "passive_generation"))
        .map(|(id, _)| id.clone())
        .collect();
    for hero_id in hero_ids {
        let Some(hero_state) = world.entities.get(&hero_id) else { continue };
        let catalog_id = support::string(hero_state, "catalog_id");
        let learned = skill_ids(hero_state);
        let life_generation = support::int(hero_state, "life_generation");
        let shield = rules.heroes.iter()
            .find(|definition| definition.id == catalog_id)
            .map(|definition| definition.skills.iter()
                .filter(|skill| skill.passive && skill.effect == SkillEffect::Shield && learned.contains(&skill.id))
                .map(|skill| skill.power.max(0))
                .fold(0_i64, i64::saturating_add))
            .unwrap_or(0);
        if let Some(hero) = world.entities.get_mut(&hero_id) {
            if shield > 0 {
                add_int(hero, "shield", shield);
            }
            support::set_int(hero, "passive_generation", life_generation);
        }
    }
}

fn grow_hero(hero: &mut EntityState, growth: &UnitStats, was_alive: bool) {
    for (field, amount) in [
        ("attack", growth.attack),
        ("defense", growth.defense),
        ("speed", growth.speed),
        ("range", growth.range),
        ("attack_interval", growth.attack_interval),
        ("vision", growth.vision),
    ] {
        add_int(hero, field, amount);
    }
    let old_max = support::int(hero, "max_hp");
    let new_max = old_max.saturating_add(growth.hp).max(1);
    support::set_int(hero, "max_hp", new_max);
    if was_alive {
        let hp = support::int(hero, "hp").saturating_add(growth.hp).min(new_max);
        support::set_int(hero, "hp", hp);
    }
}

fn regenerate_energy(world: &mut WorldState, rules: &NextRules, _tick: u32) {
    let regen = support::param(rules, "hero_energy_regen_per_tick", 0).max(0);
    let cap = support::param(rules, "hero_max_energy", i64::MAX).max(0);
    if regen == 0 {
        return;
    }
    for hero in world.entities.values_mut().filter(|entity| entity.entity_type.as_str() == "hero" && support::alive(entity)) {
        let energy = support::int(hero, "energy").saturating_add(regen).min(cap);
        support::set_int(hero, "energy", energy);
    }
}

fn apply_mature_squad_shields(world: &mut WorldState, rules: &NextRules) {
    let base = support::param(rules, "squad_shield_per_ally", 0).max(0);
    let maturity_cap = support::param(rules, "squad_maturation_ticks", 0).max(0);
    if base == 0 || maturity_cap == 0 {
        return;
    }
    let members: Vec<_> = world.entities.iter()
        .filter(|(_, hero)| hero.entity_type.as_str() == "hero" && support::alive(hero))
        .filter_map(|(id, hero)| {
            let squad = support::string(hero, "squad");
            let side = hero.owner?;
            if squad.is_empty() {
                return None;
            }
            let catalog_id = support::string(hero, "catalog_id");
            let multiplier = rules.heroes.iter()
                .find(|definition| definition.id == catalog_id)
                .and_then(|definition| definition.synergy.get("maturity_effect_milli"))
                .copied()
                .unwrap_or(1000)
                .max(0);
            Some((id.clone(), side, squad, support::int(hero, "maturity").clamp(0, maturity_cap), multiplier))
        })
        .collect();

    let mut shield_caps = BTreeMap::<EntityId, i64>::new();
    for (recipient_id, recipient_side, recipient_squad, _, _) in &members {
        let denominator = i128::from(maturity_cap).saturating_mul(1000).max(1);
        let contribution = members.iter()
            .filter(|(contributor_id, side, squad, _, _)| {
                contributor_id != recipient_id && side == recipient_side && squad == recipient_squad
            })
            .fold(0_i128, |total, (_, _, _, maturity, multiplier)| {
                let raw = i128::from(base)
                    .saturating_mul(i128::from(*maturity))
                    .saturating_mul(i128::from(*multiplier));
                let whole = raw / denominator;
                let rounded = whole + if raw % denominator != 0 { 1 } else { 0 };
                total.saturating_add(rounded)
            })
            ;
        let value = contribution.min(i128::from(i64::MAX)) as i64;
        shield_caps.insert(recipient_id.clone(), value);
    }
    for (hero_id, cap) in shield_caps {
        if let Some(hero) = world.entities.get_mut(&hero_id) {
            let current = support::int(hero, "shield").max(0);
            support::set_int(hero, "shield", current.max(cap));
        }
    }
}

fn exact_xp_share(reward_xp: i64, recipients: usize) -> i64 {
    if recipients == 0 {
        return 0;
    }
    let count = i128::try_from(recipients).unwrap_or(i128::MAX);
    let share = i128::from(reward_xp.max(0)) * i128::from(XP_SCALE) / count;
    share.min(i128::from(i64::MAX)) as i64
}

fn xp_reward(entity: &EntityState, rules: &NextRules) -> i64 {
    match entity.entity_type.as_str() {
        "hero" => support::param(rules, "hero_kill_xp", 0),
        "tower" => support::param(rules, "structure_tower_xp", 0),
        "base" => support::param(rules, "structure_base_xp", 0),
        "monster" | "minion" => support::int(entity, "xp_reward"),
        _ => 0,
    }
}

fn scaled_ally_effect_power(
    rules: &NextRules,
    caster_id: &EntityId,
    caster: &EntityState,
    target_id: &EntityId,
    target: &EntityState,
    skill: &SkillDefinition,
    side: CombatantSide,
) -> i64 {
    let ally_support_effect = matches!(skill.effect,
        SkillEffect::Heal | SkillEffect::Shield | SkillEffect::Haste | SkillEffect::Empower | SkillEffect::Defense)
        && target.owner == Some(side)
        && caster_id != target_id;
    if !ally_support_effect {
        return skill.power;
    }
    let catalog_id = support::string(caster, "catalog_id");
    let multiplier = rules.heroes.iter()
        .find(|hero| hero.id == catalog_id)
        .and_then(|hero| hero.synergy.get("ally_skill_effect_milli"))
        .copied()
        .unwrap_or(1000)
        .max(0);
    skill.power.saturating_mul(multiplier).checked_div(1000).unwrap_or(0)
}

fn effective_defense(target: &EntityState, tick: u32) -> i64 {
    support::int(target, "defense").saturating_add(active_magnitude(target, "defense_bonus", "defense_until", tick)).max(0)
}

fn active_magnitude(entity: &EntityState, magnitude: &str, until: &str, tick: u32) -> i64 {
    if support::int(entity, until) > i64::from(tick) {
        support::int(entity, magnitude).max(0)
    } else {
        0
    }
}

fn set_timed_magnitude(entity: &mut EntityState, magnitude: &str, until: &str, power: i64, expiry: i64, tick: u32) {
    let current_expiry = support::int(entity, until);
    if current_expiry <= i64::from(tick) {
        support::set_int(entity, magnitude, power.max(0));
        support::set_int(entity, until, expiry);
    } else if (power, expiry) > (support::int(entity, magnitude), current_expiry) {
        support::set_int(entity, magnitude, power.max(0));
        support::set_int(entity, until, expiry);
    }
}

fn add_int(entity: &mut EntityState, key: &str, amount: i64) {
    let value = support::int(entity, key).saturating_add(amount);
    support::set_int(entity, key, value);
}

fn set_max_int(entity: &mut EntityState, key: &str, value: i64) {
    let value = support::int(entity, key).max(value);
    support::set_int(entity, key, value);
}

fn effect_order(effect: &SkillEffect) -> u8 {
    match effect {
        SkillEffect::AreaDamage => 0,
        SkillEffect::Damage => 1,
        SkillEffect::Heal => 2,
        SkillEffect::Shield => 3,
        SkillEffect::Haste => 4,
        SkillEffect::Slow => 5,
        SkillEffect::Reveal => 6,
        SkillEffect::Empower => 7,
        SkillEffect::Defense => 8,
        SkillEffect::TerrainAdaptation => 9,
        SkillEffect::JungleSpecialist => 10,
        SkillEffect::SoloMobility => 11,
    }
}

fn skill_target_id(intent: &Intent, actor: &EntityId, target_kind: &str) -> Option<EntityId> {
    if target_kind == "self" {
        if intent.target.as_ref().is_some_and(|target| target != actor) {
            return None;
        }
        return Some(actor.clone());
    }
    intent.target.clone()
}

fn skill_target_allowed(
    target_kind: &str,
    side: CombatantSide,
    actor_id: &EntityId,
    target_id: &EntityId,
    target: &EntityState,
) -> bool {
    match target_kind {
        "self" => target_id == actor_id && target.owner == Some(side),
        "ally" => target.owner == Some(side),
        "enemy" => target.owner != Some(side),
        _ => false,
    }
}

fn requested_target<'a>(source: &EntityState, world: &'a WorldState) -> Option<(EntityId, &'a EntityState)> {
    let target = match source.fields.get(&FieldId::from("target")) {
        Some(DomainValue::Entity(id)) => id.clone(),
        Some(DomainValue::String(id)) => EntityId::from(id.clone()),
        _ => return None,
    };
    world.entities.get(&target).map(|entity| (target, entity))
}

fn is_combatant(entity: &EntityState) -> bool {
    matches!(entity.entity_type.as_str(), "hero" | "minion" | "monster" | "tower" | "base")
}

fn is_targetable(entity: &EntityState) -> bool {
    matches!(entity.entity_type.as_str(), "hero" | "minion" | "monster" | "tower" | "base")
}

fn has_skill(hero: &EntityState, skill_id: &str) -> bool {
    match hero.fields.get(&FieldId::from("skills")) {
        Some(DomainValue::List(skills)) => skills.iter().any(|value| match value {
            DomainValue::String(value) => value == skill_id,
            _ => false,
        }),
        _ => false,
    }
}

fn skill_ids(hero: &EntityState) -> BTreeSet<String> {
    match hero.fields.get(&FieldId::from("skills")) {
        Some(DomainValue::List(skills)) => skills.iter().filter_map(|value| match value {
            DomainValue::String(value) => Some(value.clone()),
            _ => None,
        }).collect(),
        _ => BTreeSet::new(),
    }
}

fn push_skill(hero: &mut EntityState, skill_id: &str) {
    let mut skills = match hero.fields.get(&FieldId::from("skills")) {
        Some(DomainValue::List(values)) => values.clone(),
        _ => Vec::new(),
    };
    if !skills.iter().any(|value| matches!(value, DomainValue::String(value) if value == skill_id)) {
        skills.push(DomainValue::String(skill_id.to_string()));
    }
    hero.fields.insert("skills".into(), DomainValue::List(skills));
}

fn cooldown_ready(hero: &EntityState, skill_id: &str) -> i64 {
    match hero.fields.get(&FieldId::from("cooldowns")) {
        Some(DomainValue::Record(values)) => values.get(&FieldId::from(skill_id)).and_then(|value| match value {
            DomainValue::Integer(value) => Some(*value),
            _ => None,
        }).unwrap_or(0),
        _ => 0,
    }
}

fn set_cooldown(hero: &mut EntityState, skill_id: &str, ready_tick: i64) {
    let mut cooldowns = match hero.fields.get(&FieldId::from("cooldowns")) {
        Some(DomainValue::Record(values)) => values.clone(),
        _ => BTreeMap::new(),
    };
    cooldowns.insert(skill_id.into(), DomainValue::Integer(ready_tick));
    hero.fields.insert("cooldowns".into(), DomainValue::Record(cooldowns));
}

fn structure_stats(rules: &NextRules, kind: &str) -> UnitStats {
    UnitStats {
        hp: support::param(rules, &format!("structure_{kind}_hp"), 1).max(1),
        attack: support::param(rules, &format!("structure_{kind}_attack"), 0).max(0),
        defense: support::param(rules, &format!("structure_{kind}_defense"), 0).max(0),
        speed: 0,
        range: support::param(rules, &format!("structure_{kind}_range"), 0).max(0),
        attack_interval: support::param(rules, &format!("structure_{kind}_attack_interval"), 1).max(1),
        vision: support::param(rules, &format!("structure_{kind}_vision"), 0).max(0),
    }
}

fn parse_side(value: &str) -> Option<CombatantSide> {
    match value {
        "attacker" => Some(CombatantSide::Attacker),
        "defender" => Some(CombatantSide::Defender),
        _ => None,
    }
}

fn base_id(side: CombatantSide) -> EntityId {
    EntityId::from(format!("base.{}", support::side_name(side)))
}

fn amount_event(name: &str, entity: EntityId, amount: i64) -> PresentationEvent {
    let mut payload = BTreeMap::new();
    payload.insert("amount".into(), DomainValue::Integer(amount));
    event(name, Some(entity), payload)
}

fn event(name: &str, entity: Option<EntityId>, payload: BTreeMap<FieldId, DomainValue>) -> PresentationEvent {
    support::event(name, entity, payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(hp: i64, attack: i64, defense: i64, range: i64) -> UnitStats {
        UnitStats {
            hp,
            attack,
            defense,
            speed: 0,
            range,
            attack_interval: 1,
            vision: 100,
        }
    }

    fn rules() -> NextRules {
        let zero = stats(0, 0, 0, 0);
        NextRules {
            mechanics_version: senkei_model::Version::new(1, 0, 0),
            map: senkei_model::BattleMap {
                id: "test".into(),
                nodes: BTreeMap::from([
                    ("test_a".into(), senkei_model::MapNode { x: 0, y: 0, region: "lane".into(), ..Default::default() }),
                    ("test_b".into(), senkei_model::MapNode { x: 1_000, y: 0, region: "lane".into(), ..Default::default() }),
                    ("attacker_home".into(), senkei_model::MapNode { x: 0, y: 0, region: "base".into(), ..Default::default() }),
                    ("defender_home".into(), senkei_model::MapNode { x: 1_000, y: 0, region: "base".into(), ..Default::default() }),
                ]),
                edges: vec![senkei_model::MapEdge {
                    id: "test.lane".into(), from: "test_a".into(), to: "test_b".into(),
                    length: 1_000, region: "lane".into(), blocked: false, ..Default::default()
                }],
                lanes: BTreeMap::new(),
                attacker_base: "attacker_home".into(),
                defender_base: "defender_home".into(),
                towers: Vec::new(),
            },
            heroes: vec![senkei_model::HeroDefinition {
                id: "test_hero".into(),
                name: "Test".into(),
                placement: "frontline".into(),
                role: "damage".into(),
                trait_id: "assault".into(),
                appearance_key: "test".into(),
                stats: stats(100, 0, 0, 5),
                growth: zero,
                skills: Vec::new(),
                skill_paths: BTreeMap::new(),
                synergy: BTreeMap::new(),
            }],
            minions: Vec::new(),
            monsters: Vec::new(),
            camps: Vec::new(),
            parameters: BTreeMap::from([
                ("xp_eligibility_range".into(), 10),
                ("hero_max_level".into(), 6),
                ("hero_xp_per_level".into(), 100),
                ("hero_max_energy".into(), 100),
                ("hero_energy_regen_per_tick".into(), 1),
                ("squad_maturation_ticks".into(), 40),
                ("squad_shield_per_ally".into(), 2),
                ("max_match_ticks".into(), 600),
            ]),
        }
    }

    fn entity(kind: &str, side: Option<CombatantSide>, x: i64, hp: i64, attack: i64, range: i64) -> EntityState {
        let mut entity = EntityState {
            entity_type: kind.into(),
            owner: side,
            fields: BTreeMap::new(),
        };
        for (key, value) in [
            ("hp", hp),
            ("max_hp", hp),
            ("attack", attack),
            ("defense", 0),
            ("range", range),
            ("attack_interval", 1),
            ("attack_ready", 0),
            ("vision", 100),
            ("x", x),
            ("y", 0),
            ("xp", 0),
            ("level", 1),
            ("energy", 100),
            ("maturity", 0),
            ("shield", 0),
        ] {
            support::set_int(&mut entity, key, value);
        }
        support::set_string(&mut entity, "catalog_id", "test_hero");
        support::set_string(&mut entity, "node", "test_a");
        support::set_string(&mut entity, "edge_to", "test_b");
        support::set_int(&mut entity, "edge_progress", x.saturating_add(500).clamp(0, 1_000));
        support::set_string(&mut entity, "track", "LEFT");
        support::set_string(&mut entity, "slot_id", format!("{}-{x}", kind));
        support::set_string(&mut entity, "skill_path", "none");
        support::set_string(&mut entity, "squad", "");
        entity.fields.insert("skills".into(), DomainValue::List(Vec::new()));
        entity
    }

    fn insert(world: &mut WorldState, id: &str, entity: EntityState) {
        world.entities.insert(EntityId::from(id), entity);
    }

    #[test]
    fn combat_domains_use_graph_positions_and_lane_track_offsets() {
        let mut rules = rules();
        let source = entity("hero", Some(CombatantSide::Attacker), 0, 50, 10, 25);
        let mut target = entity("hero", Some(CombatantSide::Defender), 10, 50, 0, 0);
        assert!(support::in_combat_range(&source, &target, 25, &rules));

        support::set_string(&mut target, "track", "RIGHT");
        assert!(!support::in_combat_range(&source, &target, 25, &rules));
        support::set_string(&mut target, "track", "CENTER");
        assert!(support::in_combat_range(&source, &target, 25, &rules));

        // Node Combat Domains suppress range; distinct nodes and edges do not.
        let mut node_source = source.clone();
        support::set_string(&mut node_source, "edge_to", "");
        support::set_string(&mut node_source, "node", "test_a");
        support::set_int(&mut node_source, "x", 0);
        let mut node_target = target.clone();
        support::set_string(&mut node_target, "edge_to", "");
        support::set_string(&mut node_target, "node", "test_a");
        support::set_int(&mut node_target, "x", 1_000_000);
        assert!(support::in_combat_range(&node_source, &node_target, 0, &rules));
        support::set_string(&mut node_target, "node", "test_b");
        assert!(!support::in_combat_range(&node_source, &node_target, 1_000_000, &rules));
        support::set_string(&mut node_source, "edge_to", "test_b");
        support::set_string(&mut node_target, "node", "test_b");
        support::set_string(&mut node_target, "edge_to", "test_a");
        support::set_int(&mut node_target, "edge_progress", 490);
        support::set_string(&mut node_target, "track", "LEFT");
        assert!(support::in_combat_range(&node_source, &node_target, 10, &rules));

        // A bridge edge has no lateral distance or formation advantage.
        rules.map.edges[0].bridge_site = "TOP".into();
        support::set_int(&mut node_source, "edge_progress", 500);
        support::set_int(&mut node_target, "edge_progress", 500);
        support::set_string(&mut node_source, "node", "test_a");
        support::set_string(&mut node_source, "edge_to", "test_b");
        support::set_string(&mut node_source, "track", "LEFT");
        support::set_string(&mut node_target, "node", "test_a");
        support::set_string(&mut node_target, "edge_to", "test_b");
        support::set_string(&mut node_target, "track", "RIGHT");
        assert!(support::in_combat_range(&node_source, &node_target, 0, &rules));
    }

    #[test]
    fn vision_uses_graph_geodesics_and_ignores_presentation_coordinates() {
        let rules = rules();
        let mut source = entity("hero", Some(CombatantSide::Attacker), 0, 50, 0, 0);
        let mut target = entity("hero", Some(CombatantSide::Defender), 10, 50, 0, 0);
        assert_eq!(support::world_distance2(&source, &target, &rules), Some(100));
        support::set_int(&mut source, "x", -1_000_000_000);
        support::set_int(&mut target, "x", 1_000_000_000);
        assert_eq!(support::world_distance2(&source, &target, &rules), Some(100));

        support::set_string(&mut source, "edge_to", "");
        support::set_string(&mut source, "node", "test_a");
        support::set_string(&mut target, "edge_to", "");
        support::set_string(&mut target, "node", "test_b");
        assert_eq!(support::world_distance2(&source, &target, &rules), Some(1_000_000));
        let mut rules = rules;
        rules.map.edges[0].blocked = true;
        assert_eq!(support::world_distance2(&source, &target, &rules), Some(1_000_000));
    }

    #[test]
    fn same_tick_movement_blocks_ordinary_attack_but_targets_use_snapshot() {
        let rules = rules();
        let mut world = WorldState::default();
        let source_id = EntityId::from("attacker");
        let target_id = EntityId::from("defender");
        insert(&mut world, "attacker", entity("hero", Some(CombatantSide::Attacker), 0, 50, 10, 5));
        insert(&mut world, "defender", entity("hero", Some(CombatantSide::Defender), 1, 50, 0, 0));
        let snapshot = world.clone();

        // Cooldown is irrelevant to the stop-and-hold target check; movement
        // is still an exclusive action for the resolver.
        support::set_int(world.entities.get_mut(&source_id).unwrap(), "moved_tick", 1);
        support::set_int(world.entities.get_mut(&source_id).unwrap(), "attack_ready", 99);
        assert!(can_basic_attack(
            &source_id, &snapshot.entities[&source_id], &target_id, &snapshot.entities[&target_id],
            &snapshot, &rules, 0,
        ));
        let move_goal = Intent {
            action_id: "keep-moving-goal".into(), capability: "move".into(),
            actor: Some(source_id.clone()), target: None, arguments: Vec::new(), priority: None,
        };
        resolve_from_snapshot(&mut world, &snapshot, &rules, &[(CombatantSide::Attacker, move_goal)], 0);
        assert_eq!(support::int(&world.entities[&target_id], "hp"), 50);

        // Without the movement marker, the exact same pre-movement domain is
        // used even if presentation coordinates change after the snapshot.
        support::set_int(world.entities.get_mut(&source_id).unwrap(), "moved_tick", 0);
        support::set_int(world.entities.get_mut(&source_id).unwrap(), "attack_ready", 0);
        support::set_int(world.entities.get_mut(&target_id).unwrap(), "x", 999);
        resolve_from_snapshot(&mut world, &snapshot, &rules, &[], 0);
        assert_eq!(support::int(&world.entities[&target_id], "hp"), 40);
    }

    #[test]
    fn ford_vulnerability_is_sampled_from_the_combat_snapshot() {
        let mut rules = rules();
        rules.map.edges[0].ford = true;
        let mut world = WorldState::default();
        insert(&mut world, "attacker", entity("hero", Some(CombatantSide::Attacker), 0, 50, 10, 5));
        insert(&mut world, "defender", entity("hero", Some(CombatantSide::Defender), 0, 100, 0, 0));
        let snapshot = world.clone();
        resolve_from_snapshot(&mut world, &snapshot, &rules, &[], 0);
        assert_eq!(support::int(&world.entities[&EntityId::from("defender")], "hp"), 85);
    }

    #[test]
    fn legal_skill_reserves_movement_and_explicit_move_wins_conflicts() {
        let mut rules = rules();
        rules.heroes[0].skills = vec![SkillDefinition {
            id: "barrier".into(), name: "Barrier".into(), passive: false, unlock_level: 1,
            prerequisites: Vec::new(), cooldown: 5, cost: 2, range: 0,
            target: "self".into(), effect: SkillEffect::Shield, power: 12, duration: 0,
        }];
        let actor_id = EntityId::from("caster");
        let activation = Intent {
            action_id: "activate-barrier".into(), capability: "senkei.next.activate".into(),
            actor: Some(actor_id.clone()), target: Some(actor_id.clone()),
            arguments: vec![DomainValue::String("barrier".into())], priority: None,
        };
        let mut actor = entity("hero", Some(CombatantSide::Attacker), 0, 50, 0, 0);
        actor.fields.insert("skills".into(), DomainValue::List(vec![DomainValue::String("barrier".into())]));
        let mut world = WorldState::default();
        insert(&mut world, "caster", actor);
        let snapshot = world.clone();
        prepare_actions(&mut world, &snapshot, &rules, &[(CombatantSide::Attacker, activation.clone())], 0);
        assert_eq!(support::int(&world.entities[&actor_id], "action_lock_until"), 1);
        assert_eq!(support::int(&world.entities[&actor_id], "prepared_action_tick"), 1);
        resolve_from_snapshot(&mut world, &snapshot, &rules, &[(CombatantSide::Attacker, activation.clone())], 0);
        assert_eq!(support::int(&world.entities[&actor_id], "shield"), 12);

        let mut moving_world = WorldState::default();
        let mut moving_actor = entity("hero", Some(CombatantSide::Attacker), 0, 50, 0, 0);
        moving_actor.fields.insert("skills".into(), DomainValue::List(vec![DomainValue::String("barrier".into())]));
        insert(&mut moving_world, "caster", moving_actor);
        let moving_snapshot = moving_world.clone();
        let movement = Intent {
            action_id: "move-home".into(), capability: "move".into(),
            actor: Some(actor_id.clone()), target: None, arguments: Vec::new(), priority: None,
        };
        let accepted = [
            (CombatantSide::Attacker, activation),
            (CombatantSide::Attacker, movement),
        ];
        prepare_actions(&mut moving_world, &moving_snapshot, &rules, &accepted, 0);
        assert_eq!(support::int(&moving_world.entities[&actor_id], "action_lock_until"), 0);
        resolve_from_snapshot(&mut moving_world, &moving_snapshot, &rules, &accepted, 0);
        assert_eq!(support::int(&moving_world.entities[&actor_id], "shield"), 0);
    }

    #[test]
    fn integer_rewards_split_exactly_for_one_through_ten_heroes() {
        for recipients in 1..=10 {
            let share = exact_xp_share(100, recipients);
            assert_eq!(share * i64::try_from(recipients).unwrap(), 100 * XP_SCALE);
        }
        assert_eq!(exact_xp_share(1, 3), 840);
        assert_eq!(exact_xp_share(100, 3), 84_000);
        assert_eq!(exact_xp_share(1, 8), 315);
    }

    #[test]
    fn repeated_awards_with_different_eligible_counts_preserve_exact_total() {
        let xp = exact_xp_share(1, 3) * 3 + exact_xp_share(100, 5) * 5;
        assert_eq!(xp, 101 * XP_SCALE);
    }

    #[test]
    fn no_eligible_recipients_do_not_divide() {
        assert_eq!(exact_xp_share(100, 0), 0);
    }

    #[test]
    fn basic_attack_tie_uses_stable_entity_id() {
        let mut world = WorldState::default();
        insert(&mut world, "attacker", entity("hero", Some(CombatantSide::Attacker), 0, 50, 10, 5));
        insert(&mut world, "hero.a", entity("hero", Some(CombatantSide::Defender), 1, 50, 0, 0));
        insert(&mut world, "hero.b", entity("hero", Some(CombatantSide::Defender), -1, 50, 0, 0));

        resolve(&mut world, &rules(), &[], 0);

        assert_eq!(support::int(&world.entities[&EntityId::from("hero.a")], "hp"), 40);
        assert_eq!(support::int(&world.entities[&EntityId::from("hero.b")], "hp"), 50);
    }

    #[test]
    fn reciprocal_lethal_attacks_resolve_in_the_same_tick() {
        let mut world = WorldState::default();
        insert(&mut world, "attacker", entity("hero", Some(CombatantSide::Attacker), 0, 10, 20, 5));
        insert(&mut world, "defender", entity("hero", Some(CombatantSide::Defender), 1, 10, 20, 5));

        let events = resolve(&mut world, &rules(), &[], 7);

        assert_eq!(support::int(&world.entities[&EntityId::from("attacker")], "hp"), 0);
        assert_eq!(support::int(&world.entities[&EntityId::from("defender")], "hp"), 0);
        assert_eq!(support::int(&world.entities[&EntityId::from("attacker")], "death_tick"), 7);
        assert_eq!(support::int(&world.entities[&EntityId::from("defender")], "death_tick"), 7);
        assert_eq!(events.iter().filter(|event| event.event.as_str() == "next.death").count(), 2);
    }

    #[test]
    fn reward_is_equal_and_only_reaches_qualified_attackers() {
        let mut world = WorldState::default();
        let mut killer = entity("hero", Some(CombatantSide::Attacker), 0, 50, 20, 5);
        killer.fields.insert("target".into(), DomainValue::Entity(EntityId::from("minion")));
        insert(&mut world, "hero.a", killer);
        insert(&mut world, "hero.b", entity("hero", Some(CombatantSide::Attacker), 1, 50, 0, 0));
        insert(&mut world, "hero.c", entity("hero", Some(CombatantSide::Attacker), -1, 50, 0, 0));
        insert(&mut world, "hero.enemy", entity("hero", Some(CombatantSide::Defender), 1, 50, 0, 0));
        let mut minion = entity("minion", Some(CombatantSide::Defender), 1, 1, 0, 0);
        support::set_int(&mut minion, "xp_reward", 1);
        insert(&mut world, "minion", minion);

        // Keep attacker visibility intact, then move the other Heroes far in
        // presentation space without changing their graph positions. XP
        // membership must follow graph distance rather than renderer X/Y.
        support::set_int(world.entities.get_mut(&EntityId::from("hero.a")).unwrap(), "x", 100_000);
        support::set_int(world.entities.get_mut(&EntityId::from("hero.b")).unwrap(), "x", 500_000);
        support::set_int(world.entities.get_mut(&EntityId::from("hero.c")).unwrap(), "x", -500_000);
        support::set_int(world.entities.get_mut(&EntityId::from("minion")).unwrap(), "x", 100_001);

        resolve(&mut world, &rules(), &[], 0);

        for id in ["hero.a", "hero.b", "hero.c"] {
            assert_eq!(support::int(&world.entities[&EntityId::from(id)], "xp"), 840);
        }
        assert_eq!(support::int(&world.entities[&EntityId::from("hero.enemy")], "xp"), 0);
    }

    #[test]
    fn contested_neutral_reward_is_equal_across_one_vs_five_eligible_heroes() {
        let mut world = WorldState::default();
        let mut attacker = entity("hero", Some(CombatantSide::Attacker), 0, 50, 20, 5);
        attacker.fields.insert("target".into(), DomainValue::Entity(EntityId::from("neutral")));
        insert(&mut world, "hero.attacker", attacker);
        let mut defender_source = entity("hero", Some(CombatantSide::Defender), 2, 50, 20, 5);
        defender_source.fields.insert("target".into(), DomainValue::Entity(EntityId::from("neutral")));
        insert(&mut world, "hero.defender.0", defender_source);
        for index in 1..5 {
            insert(
                &mut world,
                &format!("hero.defender.{index}"),
                entity("hero", Some(CombatantSide::Defender), 2, 50, 0, 0),
            );
        }
        let mut neutral = entity("monster", None, 1, 1, 0, 0);
        support::set_int(&mut neutral, "xp_reward", 1);
        insert(&mut world, "neutral", neutral);

        resolve(&mut world, &rules(), &[], 0);

        let all_heroes = [
            "hero.attacker",
            "hero.defender.0",
            "hero.defender.1",
            "hero.defender.2",
            "hero.defender.3",
            "hero.defender.4",
        ];
        for id in all_heroes {
            assert_eq!(support::int(&world.entities[&EntityId::from(id)], "xp"), 420);
        }
        let total: i64 = all_heroes.iter()
            .map(|id| support::int(&world.entities[&EntityId::from(*id)], "xp"))
            .sum();
        assert_eq!(total, XP_SCALE);
    }

    #[test]
    fn learned_passive_haste_is_restored_before_observation_after_respawn() {
        let mut rules = rules();
        rules.heroes[0].skills.push(SkillDefinition {
            id: "trail_runner".into(),
            name: "Trail Runner".into(),
            passive: true,
            unlock_level: 2,
            prerequisites: Vec::new(),
            cooldown: 0,
            cost: 0,
            range: 0,
            target: "self".into(),
            effect: SkillEffect::Haste,
            power: 100,
            duration: 0,
        });
        let mut hero = entity("hero", Some(CombatantSide::Attacker), 0, 50, 0, 0);
        support::set_string(&mut hero, "catalog_id", "test_hero");
        support::set_int(&mut hero, "speed", 50);
        support::set_int(&mut hero, "attack", 20);
        support::set_int(&mut hero, "defense", 5);
        support::set_int(&mut hero, "haste", 250);
        support::set_int(&mut hero, "haste_until", 0); // W3 clears effect expiry on respawn.
        hero.fields.insert("skills".into(), DomainValue::List(vec![DomainValue::String("trail_runner".into())]));
        let mut world = WorldState::default();
        insert(&mut world, "hero", hero);

        assert!(objective_lifecycle(&mut world, &rules, 20).is_empty());
        let hero = &world.entities[&EntityId::from("hero")];
        assert_eq!(support::int(hero, "haste"), 100);
        assert_eq!(support::int(hero, "haste_until"), 601);
        assert_eq!(support::int(hero, "speed"), 50);
        assert_eq!(support::int(hero, "attack"), 20);
        assert_eq!(support::int(hero, "defense"), 5);

        objective_lifecycle(&mut world, &rules, 21);
        assert_eq!(support::int(&world.entities[&EntityId::from("hero")], "haste"), 100);
        assert_eq!(support::int(&world.entities[&EntityId::from("hero")], "attack"), 20);
    }

    #[test]
    fn acquired_passive_shield_is_regranted_once_per_hero_life() {
        let mut rules = rules();
        rules.heroes[0].skills = vec![
            SkillDefinition {
                id: "warding_skin".into(), name: "Warding Skin".into(), passive: true,
                unlock_level: 2, prerequisites: Vec::new(), cooldown: 0, cost: 0, range: 0,
                target: "self".into(), effect: SkillEffect::Shield, power: 16, duration: 0,
            },
            SkillDefinition {
                id: "iron_will".into(), name: "Iron Will".into(), passive: true,
                unlock_level: 2, prerequisites: Vec::new(), cooldown: 0, cost: 0, range: 0,
                target: "self".into(), effect: SkillEffect::Defense, power: 4, duration: 0,
            },
        ];
        let mut hero = entity("hero", Some(CombatantSide::Attacker), 0, 50, 0, 0);
        hero.fields.insert("skills".into(), DomainValue::List(vec![
            DomainValue::String("warding_skin".into()),
            DomainValue::String("iron_will".into()),
        ]));
        support::set_int(&mut hero, "defense", 14); // Includes the permanent passive gain.
        support::set_int(&mut hero, "life_generation", 1);
        support::set_int(&mut hero, "passive_generation", 0);
        support::set_int(&mut hero, "shield", 0); // W3 clears shield when the Hero respawns.
        let mut world = WorldState::default();
        insert(&mut world, "hero", hero);

        objective_lifecycle(&mut world, &rules, 20);
        let hero = &world.entities[&EntityId::from("hero")];
        assert_eq!(support::int(hero, "shield"), 16);
        assert_eq!(support::int(hero, "passive_generation"), 1);
        assert_eq!(support::int(hero, "defense"), 14);

        objective_lifecycle(&mut world, &rules, 21);
        assert_eq!(support::int(&world.entities[&EntityId::from("hero")], "shield"), 16);
        assert_eq!(support::int(&world.entities[&EntityId::from("hero")], "defense"), 14);

        // A later respawn receives the one-time passive shield again, without
        // applying permanent stat passives a second time.
        let hero = world.entities.get_mut(&EntityId::from("hero")).unwrap();
        support::set_int(hero, "life_generation", 2);
        support::set_int(hero, "shield", 0);
        objective_lifecycle(&mut world, &rules, 40);
        assert_eq!(support::int(&world.entities[&EntityId::from("hero")], "shield"), 16);
        assert_eq!(support::int(&world.entities[&EntityId::from("hero")], "passive_generation"), 2);
        assert_eq!(support::int(&world.entities[&EntityId::from("hero")], "defense"), 14);
    }

    #[test]
    fn area_damage_hits_visible_targets_in_radius_once_each() {
        let mut rules = rules();
        rules.parameters.insert("skill_area_radius".into(), 80);
        rules.heroes[0].skills.push(SkillDefinition {
            id: "flare".into(), name: "Flare".into(), passive: false,
            unlock_level: 1, prerequisites: Vec::new(), cooldown: 9, cost: 20, range: 5,
            target: "enemy".into(), effect: SkillEffect::AreaDamage, power: 42, duration: 0,
        });

        let mut world = WorldState::default();
        let mut caster = entity("hero", Some(CombatantSide::Attacker), 0, 100, 0, 0);
        support::set_int(&mut caster, "vision", 10);
        support::set_int(&mut caster, "energy", 40);
        caster.fields.insert("skills".into(), DomainValue::List(vec![DomainValue::String("flare".into())]));
        insert(&mut world, "caster", caster);
        insert(&mut world, "center", entity("hero", Some(CombatantSide::Defender), 1, 100, 0, 0));
        insert(&mut world, "nearby", entity("hero", Some(CombatantSide::Defender), 2, 100, 0, 0));
        insert(&mut world, "hidden", entity("hero", Some(CombatantSide::Defender), 50, 100, 0, 0));
        insert(&mut world, "far", entity("hero", Some(CombatantSide::Defender), 100, 100, 0, 0));
        let mut observer = entity("hero", Some(CombatantSide::Attacker), 95, 100, 0, 0);
        support::set_int(&mut observer, "vision", 10);
        insert(&mut world, "observer", observer);
        assert!(!crate::next_vision::visible(
            &world, &rules, CombatantSide::Attacker, &world.entities[&EntityId::from("hidden")],
        ));
        assert!(crate::next_vision::visible(
            &world, &rules, CombatantSide::Attacker, &world.entities[&EntityId::from("far")],
        ));

        let intent = Intent {
            action_id: "flare-1".into(),
            capability: "senkei.next.activate".into(),
            actor: Some(EntityId::from("caster")),
            target: Some(EntityId::from("center")),
            arguments: vec![DomainValue::String("flare".into())],
            priority: None,
        };
        let events = resolve(&mut world, &rules, &[(CombatantSide::Attacker, intent)], 0);

        for id in ["center", "nearby"] {
            assert_eq!(support::int(&world.entities[&EntityId::from(id)], "hp"), 58);
        }
        for id in ["hidden", "far"] {
            assert_eq!(support::int(&world.entities[&EntityId::from(id)], "hp"), 100);
        }
        assert_eq!(support::int(&world.entities[&EntityId::from("caster")], "energy"), 21);
        assert_eq!(cooldown_ready(&world.entities[&EntityId::from("caster")], "flare"), 9);
        assert_eq!(events.iter().filter(|event| event.event.as_str() == "next.skill").count(), 1);
        assert_eq!(events.iter().filter(|event| event.event.as_str() == "next.skill_damage").count(), 2);
    }

    #[test]
    fn selected_path_unlocks_passive_and_active_skill_cost_and_cooldown_apply() {
        let mut rules = rules();
        let guard = SkillDefinition {
            id: "guard".into(), name: "Guard".into(), passive: true, unlock_level: 2,
            prerequisites: Vec::new(), cooldown: 0, cost: 0, range: 0,
            target: "self".into(), effect: SkillEffect::Defense, power: 3, duration: 0,
        };
        let barrier = SkillDefinition {
            id: "barrier".into(), name: "Barrier".into(), passive: false, unlock_level: 4,
            prerequisites: vec!["guard".into()], cooldown: 5, cost: 20, range: 5,
            target: "self".into(), effect: SkillEffect::Shield, power: 10, duration: 4,
        };
        rules.heroes[0].skills = vec![guard, barrier];
        rules.heroes[0].skill_paths.insert("path_a".into(), vec!["guard".into(), "barrier".into()]);

        let mut wrong_world = WorldState::default();
        let mut wrong_actor = entity("hero", Some(CombatantSide::Attacker), 0, 50, 0, 5);
        support::set_int(&mut wrong_actor, "level", 4);
        support::set_int(&mut wrong_actor, "energy", 30);
        support::set_string(&mut wrong_actor, "skill_path", "path_a");
        let wrong_actor_id = EntityId::from("wrong_actor");
        insert(&mut wrong_world, "wrong_actor", wrong_actor);
        insert(&mut wrong_world, "other_ally", entity("hero", Some(CombatantSide::Attacker), 1, 50, 0, 5));
        let wrong_intent = Intent {
            action_id: "activate-wrong-target".into(),
            capability: "senkei.next.activate".into(),
            actor: Some(wrong_actor_id.clone()),
            target: Some(EntityId::from("other_ally")),
            arguments: vec![DomainValue::String("barrier".into())],
            priority: None,
        };
        let wrong_events = resolve(
            &mut wrong_world,
            &rules,
            &[(CombatantSide::Attacker, wrong_intent)],
            3,
        );
        let wrong_actor = &wrong_world.entities[&wrong_actor_id];
        assert_eq!(support::int(wrong_actor, "energy"), 31);
        assert_eq!(support::int(wrong_actor, "shield"), 0);
        assert_eq!(cooldown_ready(wrong_actor, "barrier"), 0);
        assert!(!wrong_events.iter().any(|event| event.event.as_str() == "next.skill"));

        let mut hero = entity("hero", Some(CombatantSide::Attacker), 0, 50, 0, 5);
        support::set_int(&mut hero, "level", 4);
        support::set_int(&mut hero, "energy", 30);
        support::set_string(&mut hero, "skill_path", "path_a");
        let hero_id = EntityId::from("hero");
        let mut world = WorldState::default();
        insert(&mut world, "hero", hero);
        let intent = Intent {
            action_id: "activate-1".into(),
            capability: "senkei.next.activate".into(),
            actor: Some(hero_id.clone()),
            target: Some(hero_id.clone()),
            arguments: vec![DomainValue::String("barrier".into())],
            priority: None,
        };

        let events = resolve(&mut world, &rules, &[(CombatantSide::Attacker, intent)], 3);
        let hero = &world.entities[&hero_id];

        assert_eq!(support::int(hero, "defense"), 3);
        assert_eq!(support::int(hero, "shield"), 10);
        assert_eq!(support::int(hero, "energy"), 11);
        assert_eq!(cooldown_ready(hero, "barrier"), 8);
        assert!(has_skill(hero, "guard") && has_skill(hero, "barrier"));
        assert!(events.iter().any(|event| event.event.as_str() == "next.skill"));
    }

    #[test]
    fn mature_squad_shield_uses_per_contributor_catalog_synergy() {
        let mut rules = rules();
        let mut command = rules.heroes[0].clone();
        command.id = "command".into();
        command.synergy.insert("maturity_effect_milli".into(), 1150);
        let mut baseline = rules.heroes[0].clone();
        baseline.id = "baseline".into();
        baseline.synergy.insert("maturity_effect_milli".into(), 1000);
        rules.heroes = vec![command, baseline];
        let mut world = WorldState::default();
        let mut command_hero = entity("hero", Some(CombatantSide::Attacker), 0, 50, 0, 0);
        support::set_string(&mut command_hero, "catalog_id", "command");
        support::set_string(&mut command_hero, "squad", "squad.1");
        support::set_int(&mut command_hero, "maturity", 40);
        insert(&mut world, "hero.command", command_hero);
        let mut baseline_hero = entity("hero", Some(CombatantSide::Attacker), 0, 50, 0, 0);
        support::set_string(&mut baseline_hero, "catalog_id", "baseline");
        support::set_string(&mut baseline_hero, "squad", "squad.1");
        support::set_int(&mut baseline_hero, "maturity", 40);
        insert(&mut world, "hero.baseline", baseline_hero);

        apply_mature_squad_shields(&mut world, &rules);

        assert_eq!(support::int(&world.entities[&EntityId::from("hero.command")], "shield"), 2);
        assert_eq!(support::int(&world.entities[&EntityId::from("hero.baseline")], "shield"), 3);
    }

    #[test]
    fn objectives_respawn_and_bases_determine_match_outcome() {
        let mut rules = rules();
        rules.map.nodes.insert("attacker_home".into(), senkei_model::MapNode { x: 0, y: 0, region: "base".into(), ..Default::default()
});
        rules.map.nodes.insert("defender_home".into(), senkei_model::MapNode { x: 100, y: 0, region: "base".into(), ..Default::default()
});
        rules.map.nodes.insert("top_tower".into(), senkei_model::MapNode { x: 50, y: 0, region: "lane".into(), ..Default::default()
});
        rules.map.nodes.insert("jungle".into(), senkei_model::MapNode { x: 50, y: 50, region: "jungle".into(), ..Default::default()
});
        rules.map.towers.push(senkei_model::TowerPlacement {
            id: "top_1".into(), node: "top_tower".into(), side: "defender".into(), lane: "top".into(),
        });
        rules.monsters.push(senkei_model::UnitDefinition {
            id: "brute".into(), stats: stats(25, 2, 1, 4), xp: 30,
        });
        rules.camps.push(senkei_model::CampDefinition {
            id: "camp_nw".into(), node: "jungle".into(), monster: "brute".into(), respawn_ticks: 5,
        });
        for (key, value) in [
            ("structure_tower_hp", 100), ("structure_tower_attack", 5),
            ("structure_tower_defense", 2), ("structure_tower_range", 10),
            ("structure_tower_attack_interval", 3), ("structure_tower_vision", 20),
            ("structure_base_hp", 200), ("structure_base_attack", 0),
            ("structure_base_defense", 3), ("structure_base_range", 0),
            ("structure_base_attack_interval", 1), ("structure_base_vision", 30),
        ] {
            rules.parameters.insert(key.into(), value);
        }
        let mut world = WorldState::default();
        initialize_objectives(&mut world, &rules);

        assert_eq!(support::int(&world.entities[&EntityId::from("tower.top_1")], "hp"), 100);
        assert_eq!(support::int(&world.entities[&EntityId::from("monster.camp_nw")], "hp"), 25);
        assert_eq!(outcome(&world), None);
        support::set_int(world.entities.get_mut(&EntityId::from("monster.camp_nw")).unwrap(), "hp", 0);
        support::set_int(world.entities.get_mut(&EntityId::from("monster.camp_nw")).unwrap(), "respawn_at", 5);
        assert!(objective_lifecycle(&mut world, &rules, 4).is_empty());
        assert_eq!(support::int(&world.entities[&EntityId::from("monster.camp_nw")], "hp"), 0);
        assert_eq!(objective_lifecycle(&mut world, &rules, 5).len(), 1);
        assert_eq!(support::int(&world.entities[&EntityId::from("monster.camp_nw")], "hp"), 25);
        support::set_int(world.entities.get_mut(&base_id(CombatantSide::Attacker)).unwrap(), "hp", 0);
        support::set_int(world.entities.get_mut(&base_id(CombatantSide::Defender)).unwrap(), "hp", 0);
        assert_eq!(outcome(&world), Some(MatchOutcome::Draw));
        support::set_int(world.entities.get_mut(&base_id(CombatantSide::Attacker)).unwrap(), "hp", 200);
        assert_eq!(outcome(&world), Some(MatchOutcome::AttackerVictory));
    }
}
