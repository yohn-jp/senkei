//! Finite bridge work and MID observation-base control.
//!
//! Bridge construction is prepared before navigation, spends energy once, and
//! advances after combat. A completed state is visible to navigation on the
//! following tick. Capture uses one frozen tick snapshot as well.
use crate::next_support as support;
use senkei_model::{
    CombatantSide, DomainValue, EntityId, EntityState, FieldId, Intent, NextRules,
    PresentationEvent, UnitStats, WorldState,
};
use std::collections::{BTreeMap, BTreeSet};

const BRIDGE: &str = "bridge";
const OBSERVATION: &str = "observation";
const HERO: &str = "hero";

/// Add the three fixed bridge sites and the independent MID observation base.
pub fn initialize(world: &mut WorldState, rules: &NextRules) {
    let observation_node = rules.map.nodes.iter().find(|(id, node)| {
        id.to_ascii_uppercase().contains("MID.OBS")
            || node.region.eq_ignore_ascii_case("observation")
    });
    let mut sites = BTreeSet::new();
    for edge in &rules.map.edges {
        if edge.bridge_site.is_empty() || !sites.insert(edge.bridge_site.clone()) {
            continue;
        }
        let id = EntityId::from(format!("bridge.{}", edge.bridge_site));
        if world.entities.contains_key(&id) { continue; }
        let site_edges = rules.map.edges.iter()
            .filter(|candidate| candidate.bridge_site == edge.bridge_site)
            .collect::<Vec<_>>();
        let mut entity = facility_unit(BRIDGE, None, rules, &edge.from);
        let (x, y) = site_edges.iter().filter_map(|candidate| {
            let from = rules.map.nodes.get(&candidate.from)?;
            let to = rules.map.nodes.get(&candidate.to)?;
            Some((from.x + to.x, from.y + to.y))
        }).fold((0_i64, 0_i64), |(x, y), (next_x, next_y)| (x + next_x, y + next_y));
        let count = (site_edges.len() as i64).max(1) * 2;
        support::set_int(&mut entity, "x", x / count);
        support::set_int(&mut entity, "y", y / count);
        if edge.bridge_site == "MID" {
            if let Some((node_id, node)) = observation_node {
                support::set_string(&mut entity, "node", node_id.clone());
                support::set_string(&mut entity, "edge_to", "");
                support::set_int(&mut entity, "edge_progress", 0);
                support::set_int(&mut entity, "x", node.x);
                support::set_int(&mut entity, "y", node.y);
            }
        } else if let Some(anchor) = site_edges.first() {
            support::set_string(&mut entity, "node", anchor.from.clone());
            support::set_string(&mut entity, "edge_to", anchor.to.clone());
            support::set_int(&mut entity, "edge_progress", anchor.length / 2);
        }
        support::set_string(&mut entity, "site", edge.bridge_site.clone());
        support::set_string(&mut entity, "bridge_state", "normal");
        support::set_string(&mut entity, "build_kind", "");
        support::set_int(&mut entity, "build_remaining", 0);
        support::set_int(&mut entity, "hp", support::param(rules, "bridge_hp", 500));
        support::set_int(&mut entity, "max_hp", support::param(rules, "bridge_hp", 500));
        entity.fields.insert(FieldId::from("builder"), DomainValue::Null);
        entity.fields.insert(FieldId::from("builder_side"), DomainValue::String(String::new()));
        entity.fields.insert(FieldId::from("builder_squad"), DomainValue::String(String::new()));
        world.entities.insert(id, entity);
    }

    let Some((node_id, node)) = observation_node else { return };
    let id = EntityId::from("observation.mid");
    if world.entities.contains_key(&id) { return; }
    let mut entity = facility_unit(OBSERVATION, None, rules, node_id);
    support::set_int(&mut entity, "x", node.x);
    support::set_int(&mut entity, "y", node.y);
    support::set_int(&mut entity, "capture_progress", 0);
    support::set_string(&mut entity, "capture_owner", "neutral");
    support::set_string(&mut entity, "capture_progress_side", "");
    world.entities.insert(id, entity);
}

/// Reserve and begin accepted bridge work before movement and combat select
/// their actions. The builder remains at the fixed site for the finite work.
pub fn prepare(
    world: &mut WorldState,
    snapshot: &WorldState,
    rules: &NextRules,
    accepted: &[(CombatantSide, Intent)],
    tick: u32,
) {
    let movement_cohorts = accepted.iter().filter_map(|(side, intent)| {
        if !matches!(intent.capability.as_str(), "move" | "retreat" | "pursue" | "select_track") {
            return None;
        }
        let actor_id = intent.arguments.first().and_then(entity_value)
            .or_else(|| intent.actor.clone())?;
        let actor = snapshot.entities.get(&actor_id)?;
        if actor.entity_type.as_str() != HERO || actor.owner != Some(*side) || !support::alive(actor) {
            return None;
        }
        let squad = support::string(actor, "squad");
        Some(if squad.is_empty() {
            format!("{}:solo:{actor_id}", support::side_name(*side))
        } else {
            format!("{}:{squad}", support::side_name(*side))
        })
    }).collect::<BTreeSet<_>>();
    let mut candidates = accepted.iter().filter_map(|(side, intent)| {
        if intent.capability.as_str() != "bridge_work" { return None; }
        let actor_id = intent.arguments.first().and_then(entity_value)?;
        let bridge_id = intent.arguments.get(1).and_then(entity_value)
            .or_else(|| intent.target.clone())?;
        let operation = match intent.arguments.get(2)? {
            DomainValue::Enum(value) => value.as_str().to_owned(),
            DomainValue::String(value) => value.clone(),
            _ => return None,
        };
        let (duration_key, duration_default) = match operation.as_str() {
            "expand" => ("bridge_expand_ticks", 12),
            "rebuild" => ("bridge_rebuild_ticks", 24),
            "destroy" => ("bridge_destroy_ticks", 8),
            _ => return None,
        };
        Some((bridge_id, actor_id, *side, operation,
            support::param(rules, duration_key, duration_default).max(1),
            support::param(rules, "bridge_work_energy", 25).max(0),
            intent.action_id.clone()))
    }).collect::<Vec<_>>();
    candidates.sort();

    let mut reserved_bridges = BTreeSet::new();
    let mut reserved_actors = BTreeSet::new();
    let mut reserved_cohorts = BTreeSet::new();
    for (bridge_id, actor_id, side, operation, duration, energy_cost, _) in candidates {
        let (Some(actor_start), Some(bridge_start)) =
            (snapshot.entities.get(&actor_id), snapshot.entities.get(&bridge_id)) else { continue };
        if actor_start.entity_type.as_str() != HERO
            || actor_start.owner != Some(side)
            || !support::alive(actor_start)
            || support::int(actor_start, "action_lock_until") > i64::from(tick)
            || bridge_start.entity_type.as_str() != BRIDGE
            || !adjacent_to_bridge(actor_start, bridge_start, rules)
            || support::int(bridge_start, "build_remaining") > 0
        { continue; }

        let state = support::string(bridge_start, "bridge_state");
        let legal = match operation.as_str() {
            "expand" => state == "normal",
            "rebuild" => state == "destroyed",
            "destroy" => state != "destroyed",
            _ => false,
        };
        if !legal || support::int(actor_start, "energy") < energy_cost { continue; }

        let squad = support::string(actor_start, "squad");
        let cohort = if squad.is_empty() {
            format!("solo:{actor_id}")
        } else {
            format!("{}:{squad}", support::side_name(side))
        };
        let cohort_key = if squad.is_empty() {
            format!("{}:{cohort}", support::side_name(side))
        } else {
            cohort.clone()
        };
        if movement_cohorts.contains(&cohort_key) { continue; }
        let member_ids = snapshot.entities.iter().filter_map(|(member_id, member)| {
            (member.entity_type.as_str() == HERO && member.owner == Some(side)
                && support::alive(member)
                && if squad.is_empty() { member_id == &actor_id }
                    else { support::string(member, "squad") == squad })
                .then_some(member_id.clone())
        }).collect::<Vec<_>>();
        if reserved_bridges.contains(&bridge_id)
            || reserved_actors.contains(&actor_id)
            || reserved_cohorts.contains(&cohort)
            || member_ids.iter().any(|member_id| snapshot.entities.get(member_id)
                .is_some_and(|member| support::int(member, "action_lock_until") > i64::from(tick)
                    || crate::next_navigation::forced_transit_in(member, rules, snapshot)))
        { continue; }

        reserved_bridges.insert(bridge_id.clone());
        reserved_actors.insert(actor_id.clone());
        reserved_cohorts.insert(cohort);
        let lock_until = i64::from(tick).saturating_add(duration).saturating_add(1);
        for member_id in member_ids {
            if let Some(member) = world.entities.get_mut(&member_id) {
                if member_id == actor_id {
                    support::set_int(member, "energy", support::int(member, "energy") - energy_cost);
                }
                support::set_int(member, "action_lock_until",
                    support::int(member, "action_lock_until").max(lock_until));
            }
        }
        if let Some(bridge) = world.entities.get_mut(&bridge_id) {
            support::set_string(bridge, "build_kind", &operation);
            support::set_int(bridge, "build_remaining", duration);
            bridge.fields.insert("builder".into(), DomainValue::Entity(actor_id));
            support::set_string(bridge, "builder_side", support::side_name(side));
            support::set_string(bridge, "builder_squad", &squad);
            support::set_int(bridge, "build_started_tick", i64::from(tick) + 1);
            support::set_int(bridge, "build_lock_until", lock_until);
        }
    }
}

/// Commit one tick of existing bridge work and MID capture after combat. The
/// supplied snapshot freezes legality and capture occupancy to the tick start.
pub fn resolve(
    world: &mut WorldState,
    snapshot: &WorldState,
    rules: &NextRules,
    _accepted: &[(CombatantSide, Intent)],
    tick: u32,
) -> Vec<PresentationEvent> {
    let mut events = advance_bridge_work(world, snapshot, rules, tick);
    events.extend(resolve_observation(world, snapshot, rules));
    events
}

fn advance_bridge_work(
    world: &mut WorldState,
    snapshot: &WorldState,
    rules: &NextRules,
    tick: u32,
) -> Vec<PresentationEvent> {
    let ids = snapshot.entities.iter()
        .filter(|(_, entity)| entity.entity_type.as_str() == BRIDGE)
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    let mut events = Vec::new();
    for id in ids {
        let Some(start) = snapshot.entities.get(&id) else { continue };
        if support::int(start, "build_remaining") <= 0
            || support::int(start, "build_started_tick") >= i64::from(tick) + 1
        { continue; }
        let builder_id = match start.fields.get(&FieldId::from("builder")) {
            Some(DomainValue::Entity(id)) => id.clone(),
            _ => {
                cancel_bridge_work(world, start, snapshot);
                continue;
            }
        };
        let Some(builder) = snapshot.entities.get(&builder_id) else {
            cancel_bridge_work(world, start, snapshot);
            continue;
        };
        let moved = world.entities.get(&builder_id)
            .is_some_and(|current| support::int(current, "moved_tick") == i64::from(tick) + 1);
        let builder_after_combat = world.entities.get(&builder_id);
        if !support::alive(builder)
            || builder_after_combat.map_or(true, |current| !support::alive(current))
            || !adjacent_to_bridge(builder, start, rules)
            || builder_after_combat.map_or(true, |current| !adjacent_to_bridge(current, start, rules))
            || moved
        {
            cancel_bridge_work(world, start, snapshot);
            continue;
        }

        let Some(bridge) = world.entities.get_mut(&id) else { continue };
        let remaining = support::int(start, "build_remaining").saturating_sub(1).max(0);
        support::set_int(bridge, "build_remaining", remaining);
        if remaining != 0 { continue; }

        let operation = support::string(start, "build_kind");
        let state = match operation.as_str() {
            "expand" => "expanded",
            "rebuild" => "normal",
            "destroy" => "destroyed",
            _ => continue,
        };
        support::set_string(bridge, "bridge_state", state);
        support::set_string(bridge, "build_kind", "");
        support::set_int(bridge, "hp", if state == "destroyed" { 0 } else { support::int(bridge, "max_hp") });
        bridge.fields.insert("builder".into(), DomainValue::Null);
        support::set_string(bridge, "builder_side", "");
        support::set_string(bridge, "builder_squad", "");
        support::set_int(bridge, "build_started_tick", 0);
        support::set_int(bridge, "build_lock_until", 0);
        let mut payload = BTreeMap::new();
        payload.insert("site".into(), DomainValue::String(support::string(start, "site")));
        payload.insert("state".into(), DomainValue::String(state.into()));
        events.push(support::event("next.bridge_state", Some(id), payload));
    }
    events
}

/// Interrupted work is cancelled with no refund, releasing only cohort locks
/// installed for this specific operation.
fn cancel_bridge_work(world: &mut WorldState, bridge_start: &EntityState, snapshot: &WorldState) {
    let builder_id = match bridge_start.fields.get(&FieldId::from("builder")) {
        Some(DomainValue::Entity(id)) => Some(id.clone()),
        _ => None,
    };
    let lock_until = support::int(bridge_start, "build_lock_until");
    if let Some(builder_id) = builder_id {
        let side = match support::string(bridge_start, "builder_side").as_str() {
            "attacker" => Some(CombatantSide::Attacker),
            "defender" => Some(CombatantSide::Defender),
            _ => snapshot.entities.get(&builder_id).and_then(|builder| builder.owner),
        };
        let squad = support::string(bridge_start, "builder_squad");
        for (member_id, member_start) in &snapshot.entities {
            if member_start.entity_type.as_str() != HERO || member_start.owner != side
                || (member_id != &builder_id && (squad.is_empty() || support::string(member_start, "squad") != squad))
            { continue; }
            if let Some(member) = world.entities.get_mut(member_id) {
                if support::int(member, "action_lock_until") == lock_until {
                    support::set_int(member, "action_lock_until", 0);
                }
            }
        }
    }
    let site = support::string(bridge_start, "site");
    if let Some(bridge) = world.entities.get_mut(&EntityId::from(format!("bridge.{site}"))) {
        support::set_int(bridge, "build_remaining", 0);
        support::set_string(bridge, "build_kind", "");
        support::set_int(bridge, "build_started_tick", 0);
        support::set_int(bridge, "build_lock_until", 0);
        bridge.fields.insert("builder".into(), DomainValue::Null);
        support::set_string(bridge, "builder_side", "");
        support::set_string(bridge, "builder_squad", "");
    }
}

fn resolve_observation(
    world: &mut WorldState,
    snapshot: &WorldState,
    rules: &NextRules,
) -> Vec<PresentationEvent> {
    let Some((id, objective)) = snapshot.entities.iter()
        .find(|(_, entity)| entity.entity_type.as_str() == OBSERVATION) else { return Vec::new() };
    let mut present = BTreeSet::new();
    for entity in snapshot.entities.values() {
        if !support::alive(entity)
            || !matches!(entity.entity_type.as_str(), "hero" | "minion" | "monster")
            || !support::string(entity, "edge_to").is_empty()
            || support::string(entity, "node").as_str() != support::string(objective, "node")
        { continue; }
        if let Some(side) = entity.owner { present.insert(side); }
    }

    let capture_ticks = support::param(rules, "mid_capture_ticks", 8).max(1);
    let old_owner = objective.owner;
    let old_progress = support::int(objective, "capture_progress");
    let old_progress_side = support::string(objective, "capture_progress_side");
    let (progress_side, progress) = match present.len() {
        0 => (String::new(), 0),
        1 => {
            let side = *present.iter().next().unwrap();
            if old_owner == Some(side) {
                (String::new(), 0)
            } else if old_progress_side == support::side_name(side) {
                (old_progress_side, old_progress.saturating_add(1).min(capture_ticks))
            } else {
                (support::side_name(side).to_owned(), 1)
            }
        }
        _ => (old_progress_side, old_progress),
    };

    let Some(current) = world.entities.get_mut(id) else { return Vec::new() };
    support::set_int(current, "capture_progress", progress);
    support::set_string(current, "capture_progress_side", progress_side.clone());
    if let Ok(side) = progress_side.parse::<SideName>() {
        if old_owner != Some(side.0) && progress >= capture_ticks {
            current.owner = Some(side.0);
            support::set_string(current, "capture_owner", support::side_name(side.0));
            support::set_int(current, "capture_progress", 0);
            support::set_string(current, "capture_progress_side", "");
        }
    }
    if current.owner == old_owner { return Vec::new(); }

    let mut payload = BTreeMap::new();
    let owner = current.owner.map(support::side_name).unwrap_or("neutral");
    payload.insert("owner".into(), DomainValue::String(owner.into()));
    vec![support::event("next.observation_capture", Some(id.clone()), payload)]
}

#[derive(Clone, Copy)]
struct SideName(CombatantSide);
impl std::str::FromStr for SideName {
    type Err = ();
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "attacker" => Ok(Self(CombatantSide::Attacker)),
            "defender" => Ok(Self(CombatantSide::Defender)),
            _ => Err(()),
        }
    }
}

fn adjacent_to_bridge(actor: &EntityState, bridge: &EntityState, rules: &NextRules) -> bool {
    let node = support::string(actor, "node");
    let edge_to = support::string(actor, "edge_to");
    let site = support::string(bridge, "site");
    if !edge_to.is_empty() {
        return rules.map.edges.iter().any(|edge| {
            edge.bridge_site == site
                && ((edge.from == node && edge.to == edge_to)
                    || (edge.from == edge_to && edge.to == node))
        });
    }
    rules.map.edges.iter().filter(|edge| edge.bridge_site == site)
        .any(|edge| edge.from == node || edge.to == node)
}

fn facility_unit(
    kind: &str,
    owner: Option<CombatantSide>,
    rules: &NextRules,
    node: &str,
) -> EntityState {
    let stats = UnitStats {
        hp: 1, attack: 0, defense: 0, speed: 0, range: 0,
        attack_interval: 1, vision: 0,
    };
    support::unit(kind, owner, &stats, node, rules)
}

fn entity_value(value: &DomainValue) -> Option<EntityId> {
    if let DomainValue::Entity(id) = value { Some(id.clone()) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{BattleMap, MapEdge, MapNode, NextRules, TowerPlacement, Version};
    use std::collections::BTreeMap;

    fn rules() -> NextRules {
        let nodes = BTreeMap::from([
            ("a_bank".into(), MapNode { x: 0, y: 0, region: "top".into(), allegiance: "A".into() }),
            ("b_bank".into(), MapNode { x: 100, y: 0, region: "top".into(), allegiance: "B".into() }),
            ("mid_obs".into(), MapNode { x: 50, y: -10, region: "observation".into(), allegiance: "N".into() }),
            ("farland".into(), MapNode { x: 300, y: 0, region: "jungle".into(), allegiance: "N".into() }),
        ]);
        let edges = vec![
            MapEdge { id: "top".into(), from: "a_bank".into(), to: "b_bank".into(), length: 100,
                region: "lane".into(), blocked: false, bridge_site: "TOP".into(), ford: false },
            MapEdge { id: "mid.a".into(), from: "a_bank".into(), to: "mid_obs".into(), length: 50,
                region: "bridge".into(), blocked: false, bridge_site: "MID".into(), ford: false },
            MapEdge { id: "mid.b".into(), from: "mid_obs".into(), to: "b_bank".into(), length: 50,
                region: "bridge".into(), blocked: false, bridge_site: "MID".into(), ford: false },
            MapEdge { id: "far".into(), from: "b_bank".into(), to: "farland".into(), length: 300,
                region: "jungle".into(), blocked: false, bridge_site: String::new(), ford: false },
        ];
        NextRules {
            mechanics_version: Version::new(2, 0, 0),
            world_identity: None,
            map: BattleMap { id: "test".into(), nodes, edges, lanes: BTreeMap::new(),
                world_identity: None,
                attacker_base: "a_bank".into(), defender_base: "b_bank".into(), towers: Vec::<TowerPlacement>::new() },
            heroes: Vec::new(), minions: Vec::new(), monsters: Vec::new(), camps: Vec::new(),
            parameters: BTreeMap::from([
                ("bridge_hp".into(), 100), ("bridge_expand_ticks".into(), 2),
                ("bridge_rebuild_ticks".into(), 2), ("bridge_destroy_ticks".into(), 2),
                ("bridge_work_energy".into(), 10), ("mid_capture_ticks".into(), 2),
            ]),
        }
    }

    fn hero(rules: &NextRules, side: CombatantSide, node: &str) -> EntityState {
        let mut entity = facility_unit(HERO, Some(side), rules, node);
        support::set_int(&mut entity, "hp", 10);
        support::set_int(&mut entity, "energy", 100);
        entity
    }

    #[test]
    fn bridge_work_waits_for_duration_and_never_starts_at_jungle() {
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, &rules);
        let actor_id = EntityId::from("a.hero");
        world.entities.insert(actor_id.clone(), hero(&rules, CombatantSide::Attacker, "a_bank"));
        let snapshot = world.clone();
        let intent = Intent {
            action_id: "work".into(), capability: "bridge_work".into(), actor: Some(actor_id.clone()),
            target: Some("bridge.TOP".into()),
            arguments: vec![DomainValue::Entity(actor_id.clone()), DomainValue::Entity("bridge.TOP".into()), DomainValue::Enum("expand".into())],
            priority: None,
        };
        prepare(&mut world, &snapshot, &rules, &[(CombatantSide::Attacker, intent)], 0);
        assert_eq!(support::string(&world.entities[&EntityId::from("bridge.TOP")], "bridge_state"), "normal");
        assert_eq!(support::int(&world.entities[&EntityId::from("bridge.TOP")], "build_remaining"), 2);
        let snapshot = world.clone();
        resolve(&mut world, &snapshot, &rules, &[], 1);
        assert_eq!(support::string(&world.entities[&EntityId::from("bridge.TOP")], "bridge_state"), "normal");
        assert_eq!(support::int(&world.entities[&actor_id], "action_lock_until"), 3);
        let snapshot = world.clone();
        let events = resolve(&mut world, &snapshot, &rules, &[], 2);
        assert_eq!(support::string(&world.entities[&EntityId::from("bridge.TOP")], "bridge_state"), "expanded");
        assert_eq!(support::int(&world.entities[&actor_id], "action_lock_until"), 3);
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn capture_requires_uncontested_continuous_presence_and_contests_pause_progress() {
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, &rules);
        let obs_id = EntityId::from("observation.mid");
        let node = support::string(&world.entities[&obs_id], "node");
        let a = EntityId::from("a.hero");
        let b = EntityId::from("b.hero");
        let neutral = EntityId::from("neutral.monster");
        world.entities.insert(a.clone(), hero(&rules, CombatantSide::Attacker, &node));
        world.entities.insert(neutral, facility_unit("monster", None, &rules, &node));
        let snapshot = world.clone();
        resolve(&mut world, &snapshot, &rules, &[], 0);
        assert_eq!(support::int(&world.entities[&obs_id], "capture_progress"), 1);
        world.entities.insert(b.clone(), hero(&rules, CombatantSide::Defender, &node));
        let snapshot = world.clone();
        resolve(&mut world, &snapshot, &rules, &[], 1);
        assert_eq!(support::int(&world.entities[&obs_id], "capture_progress"), 1);
        assert_eq!(world.entities[&obs_id].owner, None);
        world.entities.remove(&b);
        let snapshot = world.clone();
        let events = resolve(&mut world, &snapshot, &rules, &[], 2);
        assert_eq!(world.entities[&obs_id].owner, Some(CombatantSide::Attacker));
        assert_eq!(support::string(&world.entities[&obs_id], "capture_owner"), "attacker");
        assert_eq!(support::int(&world.entities[&obs_id], "capture_progress"), 0);
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn bridge_work_is_cancelled_without_refund_if_builder_dies_in_combat() {
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, &rules);
        let actor_id = EntityId::from("a.hero");
        world.entities.insert(actor_id.clone(), hero(&rules, CombatantSide::Attacker, "a_bank"));
        let action_start = world.clone();
        let intent = Intent {
            action_id: "work".into(), capability: "bridge_work".into(), actor: Some(actor_id.clone()),
            target: Some("bridge.TOP".into()),
            arguments: vec![DomainValue::Entity(actor_id.clone()), DomainValue::Entity("bridge.TOP".into()), DomainValue::Enum("expand".into())],
            priority: None,
        };
        prepare(&mut world, &action_start, &rules, &[(CombatantSide::Attacker, intent)], 0);
        let action_start = world.clone();
        let spent_energy = support::int(&world.entities[&actor_id], "energy");
        support::set_int(world.entities.get_mut(&actor_id).unwrap(), "hp", 0);
        resolve(&mut world, &action_start, &rules, &[], 1);

        let bridge = &world.entities[&EntityId::from("bridge.TOP")];
        assert_eq!(support::int(bridge, "build_remaining"), 0);
        assert_eq!(support::string(bridge, "build_kind"), "");
        assert!(matches!(bridge.fields.get(&FieldId::from("builder")), Some(DomainValue::Null)));
        assert_eq!(support::int(&world.entities[&actor_id], "energy"), spent_energy);
        assert_eq!(support::int(&world.entities[&actor_id], "action_lock_until"), 0);
    }

    #[test]
    fn accepted_squad_retreat_prevents_bridge_work_without_cost_or_lock() {
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, &rules);
        let builder_id = EntityId::from("a.builder");
        let retreating_id = EntityId::from("a.retreating");
        let mut builder = hero(&rules, CombatantSide::Attacker, "a_bank");
        let mut retreating = hero(&rules, CombatantSide::Attacker, "a_bank");
        support::set_string(&mut builder, "squad", "alpha");
        support::set_string(&mut retreating, "squad", "alpha");
        world.entities.insert(builder_id.clone(), builder);
        world.entities.insert(retreating_id.clone(), retreating);
        let snapshot = world.clone();
        let work = Intent {
            action_id: "work".into(), capability: "bridge_work".into(), actor: Some(builder_id.clone()),
            target: Some("bridge.TOP".into()),
            arguments: vec![DomainValue::Entity(builder_id.clone()), DomainValue::Entity("bridge.TOP".into()), DomainValue::Enum("expand".into())],
            priority: None,
        };
        let retreat = Intent {
            action_id: "retreat".into(), capability: "retreat".into(), actor: Some(retreating_id.clone()),
            target: None,
            arguments: vec![DomainValue::Entity(retreating_id.clone())],
            priority: None,
        };
        prepare(&mut world, &snapshot, &rules, &[
            (CombatantSide::Attacker, work),
            (CombatantSide::Attacker, retreat),
        ], 0);

        let bridge = &world.entities[&EntityId::from("bridge.TOP")];
        assert_eq!(support::int(bridge, "build_remaining"), 0);
        assert_eq!(support::string(bridge, "build_kind"), "");
        assert_eq!(support::int(&world.entities[&builder_id], "energy"), 100);
        assert_eq!(support::int(&world.entities[&retreating_id], "energy"), 100);
        assert_eq!(support::int(&world.entities[&builder_id], "action_lock_until"), 0);
        assert_eq!(support::int(&world.entities[&retreating_id], "action_lock_until"), 0);
    }

    #[test]
    fn owned_mid_observation_reveals_only_inside_its_parameterized_radius() {
        let rules = rules();
        let mut world = WorldState::default();
        initialize(&mut world, &rules);
        let obs_id = EntityId::from("observation.mid");
        world.entities.get_mut(&obs_id).unwrap().owner = Some(CombatantSide::Attacker);
        let mut near = hero(&rules, CombatantSide::Defender, "b_bank");
        support::set_int(&mut near, "x", 50);
        support::set_int(&mut near, "y", 200);
        let mut far = near.clone();
        support::set_string(&mut far, "node", "farland");
        support::set_int(&mut far, "x", 50);
        support::set_int(&mut far, "y", 0);
        assert!(crate::next_vision::visible(&world, &rules, CombatantSide::Attacker, &near));
        assert!(!crate::next_vision::visible(&world, &rules, CombatantSide::Attacker, &far));
    }
}
