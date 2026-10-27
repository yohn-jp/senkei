//! Goal and explicit target updates for accepted hero tactical intents.
//!
//! Goal conflicts use an explicit finite order independent of input or DSL
//! declaration order: retreat, pursue, move, then actor ID, target, and action
//! ID. A selected order propagates to the actor's living squad.

use crate::next_support as support;
use senkei_model::{
    CombatantSide, DomainValue, EntityId, EntityState, Intent, NextRules, WorldState,
};
use std::collections::BTreeSet;

const HERO: &str = "hero";

#[derive(Clone, Debug)]
enum GoalOrder {
    Retreat { node: String },
    Pursue { target: EntityId, node: String },
    Move { node: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
enum GoalGroup {
    Squad(CombatantSide, String),
    Solo(CombatantSide, EntityId),
}

#[derive(Clone, Debug)]
struct Candidate {
    rank: u8,
    actor: EntityId,
    group: GoalGroup,
    target_key: String,
    action_id: senkei_model::ActionId,
    order: GoalOrder,
}

/// Apply the accepted move, pursue, and retreat capabilities.
///
/// The caller has already frozen observations, run Jinrei, validated target
/// visibility and side ownership, and arbitrated intents. This hook still
/// checks entity identity, current life, and map-node existence before writing
/// any world state so stale or malformed intents remain inert.
pub fn apply(
    world: &mut WorldState,
    rules: &NextRules,
    accepted: &[(CombatantSide, Intent)],
    tick: u32,
) {
    // Track selection is a typed, deterministic tactical order. A Squad shares
    // its selected lane; one stable actor/action wins contradictory orders.
    let mut track_orders = accepted
        .iter()
        .filter_map(|(side, intent)| {
            if intent.capability.as_str() != "select_track" {
                return None;
            }
            let actor = actor_id(intent)?;
            let track = match intent
                .arguments
                .get(1)
                .or_else(|| intent.arguments.first())?
            {
                DomainValue::Enum(value) => value.as_str().to_ascii_uppercase(),
                DomainValue::String(value) => value.to_ascii_uppercase(),
                _ => return None,
            };
            if !matches!(track.as_str(), "LEFT" | "RIGHT") {
                return None;
            }
            let entity = world.entities.get(&actor)?;
            if entity.entity_type.as_str() != HERO
                || entity.owner != Some(*side)
                || !support::alive(entity)
            {
                return None;
            }
            Some((actor, intent.action_id.clone(), *side, track))
        })
        .collect::<Vec<_>>();
    track_orders.sort();
    let mut tracked_groups = BTreeSet::new();
    for (actor_id, _, side, track) in track_orders {
        let actor = &world.entities[&actor_id];
        let squad = support::string(actor, "squad");
        let key = if squad.is_empty() {
            format!("solo:{side:?}:{actor_id}")
        } else {
            format!("squad:{side:?}:{squad}")
        };
        if !tracked_groups.insert(key) {
            continue;
        }
        for (id, entity) in world.entities.iter_mut() {
            if entity.entity_type.as_str() != HERO
                || entity.owner != Some(side)
                || !support::alive(entity)
            {
                continue;
            }
            if if squad.is_empty() {
                id != &actor_id
            } else {
                support::string(entity, "squad") != squad
            } {
                continue;
            }
            support::set_string(entity, "track_goal", &track);
            support::set_int(entity, "track_intent_tick", i64::from(tick) + 1);
        }
    }

    let mut candidates = Vec::new();
    for (side, intent) in accepted {
        let Some(actor_id) = actor_id(intent) else {
            continue;
        };
        let Some(actor) = world.entities.get(&actor_id) else {
            continue;
        };
        if actor.entity_type.as_str() != HERO
            || actor.owner != Some(*side)
            || !support::alive(actor)
        {
            continue;
        }

        let order = match intent.capability.as_str() {
            "move" => {
                let Some(DomainValue::String(node)) = intent.arguments.get(1) else {
                    continue;
                };
                if !rules.map.nodes.contains_key(node) {
                    continue;
                }
                GoalOrder::Move { node: node.clone() }
            }
            "pursue" => {
                let Some(target) = target_id(intent) else {
                    continue;
                };
                let Some(target_entity) = world.entities.get(&target) else {
                    continue;
                };
                if !supported_target(target_entity) || !support::alive(target_entity) {
                    continue;
                }
                let Some(node) = closest_node(target_entity, rules) else {
                    continue;
                };
                GoalOrder::Pursue { target, node }
            }
            "retreat" => {
                let node = match side {
                    CombatantSide::Attacker => &rules.map.attacker_base,
                    CombatantSide::Defender => &rules.map.defender_base,
                };
                if !rules.map.nodes.contains_key(node) {
                    continue;
                }
                GoalOrder::Retreat { node: node.clone() }
            }
            _ => continue,
        };

        let squad = support::string(actor, "squad");
        let group = if squad.is_empty() {
            GoalGroup::Solo(*side, actor_id.clone())
        } else {
            GoalGroup::Squad(*side, squad)
        };
        candidates.push(Candidate {
            rank: order_rank(&order),
            actor: actor_id,
            group,
            target_key: target_key(&order),
            action_id: intent.action_id.clone(),
            order,
        });
    }

    candidates.sort_by(|left, right| {
        left.rank
            .cmp(&right.rank)
            .then_with(|| left.actor.cmp(&right.actor))
            .then_with(|| left.target_key.cmp(&right.target_key))
            .then_with(|| left.action_id.cmp(&right.action_id))
    });

    let mut handled_groups = BTreeSet::new();
    for candidate in candidates {
        if !handled_groups.insert(candidate.group.clone()) {
            continue;
        }
        let (side, squad) = match candidate.group {
            GoalGroup::Squad(side, squad) => (side, Some(squad)),
            GoalGroup::Solo(side, _) => (side, None),
        };
        for (entity_id, entity) in world.entities.iter_mut() {
            if entity.entity_type.as_str() != HERO
                || entity.owner != Some(side)
                || !support::alive(entity)
            {
                continue;
            }
            if let Some(squad) = squad.as_deref() {
                if support::string(entity, "squad") != squad {
                    continue;
                }
            } else if entity_id != &candidate.actor {
                // A Solo order is scoped by its stable actor ID.
                continue;
            }
            apply_order(entity, &candidate.order, tick);
        }
    }
}

fn apply_order(entity: &mut EntityState, order: &GoalOrder, tick: u32) {
    match order {
        GoalOrder::Retreat { node } => {
            support::set_string(entity, "goal", node);
            support::set_int(entity, "retreating", 1);
            support::set_int(entity, "move_intent_tick", i64::from(tick) + 1);
            entity.fields.insert("target".into(), DomainValue::Null);
        }
        GoalOrder::Move { node } => {
            support::set_string(entity, "goal", node);
            support::set_int(entity, "retreating", 0);
            support::set_int(entity, "move_intent_tick", i64::from(tick) + 1);
            entity.fields.insert("target".into(), DomainValue::Null);
        }
        GoalOrder::Pursue { target, node } => {
            support::set_string(entity, "goal", node);
            support::set_int(entity, "retreating", 0);
            support::set_int(entity, "move_intent_tick", 0);
            entity
                .fields
                .insert("target".into(), DomainValue::Entity(target.clone()));
        }
    }
}

fn actor_id(intent: &Intent) -> Option<EntityId> {
    intent.actor.clone().or_else(|| entity_argument(intent, 0))
}

fn target_id(intent: &Intent) -> Option<EntityId> {
    intent.target.clone().or_else(|| entity_argument(intent, 1))
}

fn entity_argument(intent: &Intent, index: usize) -> Option<EntityId> {
    match intent.arguments.get(index) {
        Some(DomainValue::Entity(id)) => Some(id.clone()),
        _ => None,
    }
}

fn supported_target(entity: &EntityState) -> bool {
    matches!(
        entity.entity_type.as_str(),
        "hero" | "minion" | "monster" | "tower" | "base"
    )
}

fn closest_node(entity: &EntityState, rules: &NextRules) -> Option<String> {
    let node = support::string(entity, "node");
    if !rules.map.nodes.contains_key(&node) {
        return None;
    }
    let edge_to = support::string(entity, "edge_to");
    if edge_to.is_empty() || !rules.map.nodes.contains_key(&edge_to) {
        return Some(node);
    }

    let edge_length = rules.map.edges.iter().find_map(|edge| {
        ((edge.from == node && edge.to == edge_to) || (edge.to == node && edge.from == edge_to))
            .then_some(edge.length)
    });
    let Some(length) = edge_length.filter(|length| *length > 0) else {
        return Some(node);
    };
    let progress = support::int(entity, "edge_progress").clamp(0, length);
    // Equal distance chooses the current node, giving the tie a stable result.
    Some(if i128::from(progress) * 2 > i128::from(length) {
        edge_to
    } else {
        node
    })
}

fn order_rank(order: &GoalOrder) -> u8 {
    match order {
        GoalOrder::Retreat { .. } => 0,
        GoalOrder::Pursue { .. } => 1,
        GoalOrder::Move { .. } => 2,
    }
}

fn target_key(order: &GoalOrder) -> String {
    match order {
        GoalOrder::Retreat { node } | GoalOrder::Move { node } => node.clone(),
        GoalOrder::Pursue { target, .. } => target.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{BattleMap, MapEdge, MapNode, UnitDefinition, UnitStats, Version};
    use std::collections::BTreeMap;

    fn rules() -> NextRules {
        let nodes = ["attacker_base", "defender_base", "mid_a", "mid_b"]
            .into_iter()
            .map(|node| {
                (
                    node.to_owned(),
                    MapNode {
                        x: 0,
                        y: 0,
                        region: "mid".into(),
                        ..Default::default()
                    },
                )
            })
            .collect();
        NextRules {
            projection_policy: None,
            mechanics_version: Version::new(1, 0, 0),
            world_identity: None,
            map: BattleMap {
                id: "test".into(),
                world_identity: None,
                world_projection: None,
                nodes,
                edges: vec![MapEdge {
                    from: "mid_a".into(),
                    to: "mid_b".into(),
                    length: 10,
                    region: "mid".into(),
                    blocked: false,
                    ..Default::default()
                }],
                lanes: BTreeMap::new(),
                attacker_base: "attacker_base".into(),
                defender_base: "defender_base".into(),
                towers: Vec::new(),
            },
            heroes: Vec::new(),
            minions: vec![UnitDefinition {
                id: "minion".into(),
                stats: stats(),
                xp: 0,
            }],
            monsters: Vec::new(),
            camps: Vec::new(),
            parameters: BTreeMap::new(),
        }
    }

    fn stats() -> UnitStats {
        UnitStats {
            hp: 100,
            attack: 10,
            defense: 5,
            speed: 10,
            range: 10,
            attack_interval: 1,
            vision: 10,
        }
    }

    fn hero(side: CombatantSide, squad: &str, node: &str) -> EntityState {
        EntityState {
            entity_type: HERO.into(),
            owner: Some(side),
            fields: BTreeMap::from([
                ("hp".into(), DomainValue::Integer(100)),
                ("squad".into(), DomainValue::String(squad.into())),
                ("node".into(), DomainValue::String(node.into())),
                ("edge_to".into(), DomainValue::String(String::new())),
                ("edge_progress".into(), DomainValue::Integer(0)),
                ("goal".into(), DomainValue::String(String::new())),
                ("target".into(), DomainValue::Null),
            ]),
        }
    }

    fn intent(capability: &str, action: &str, actor: &str, arguments: Vec<DomainValue>) -> Intent {
        Intent {
            action_id: action.into(),
            capability: capability.into(),
            actor: Some(actor.into()),
            target: None,
            arguments,
            priority: None,
        }
    }

    #[test]
    fn track_selection_is_shared_by_squad_and_rejects_center_waiting() {
        let mut world = WorldState::default();
        world.entities.insert(
            "hero-a".into(),
            hero(CombatantSide::Attacker, "squad-a", "mid_a"),
        );
        world.entities.insert(
            "hero-b".into(),
            hero(CombatantSide::Attacker, "squad-a", "mid_a"),
        );
        let accepted = vec![(
            CombatantSide::Attacker,
            intent(
                "select_track",
                "track",
                "hero-a",
                vec![
                    DomainValue::Entity("hero-a".into()),
                    DomainValue::Enum("RIGHT".into()),
                ],
            ),
        )];
        apply(&mut world, &rules(), &accepted, 1);
        for id in ["hero-a", "hero-b"] {
            assert_eq!(
                support::string(&world.entities[&EntityId::from(id)], "track_goal"),
                "RIGHT"
            );
        }
        let center = vec![(
            CombatantSide::Attacker,
            intent(
                "select_track",
                "center",
                "hero-a",
                vec![
                    DomainValue::Entity("hero-a".into()),
                    DomainValue::Enum("CENTER".into()),
                ],
            ),
        )];
        apply(&mut world, &rules(), &center, 2);
        assert_eq!(
            support::string(&world.entities[&EntityId::from("hero-a")], "track_goal"),
            "RIGHT"
        );
    }

    #[test]
    fn explicit_retreat_marks_intent_and_clears_it_on_move_or_pursuit() {
        let mut world = WorldState::default();
        world
            .entities
            .insert("hero-a".into(), hero(CombatantSide::Attacker, "", "mid_a"));
        apply(
            &mut world,
            &rules(),
            &[(
                CombatantSide::Attacker,
                intent("retreat", "r", "hero-a", vec![]),
            )],
            3,
        );
        assert_eq!(
            support::int(&world.entities[&EntityId::from("hero-a")], "retreating"),
            1
        );
        apply(
            &mut world,
            &rules(),
            &[(
                CombatantSide::Attacker,
                intent(
                    "move",
                    "m",
                    "hero-a",
                    vec![
                        DomainValue::Entity("hero-a".into()),
                        DomainValue::String("mid_b".into()),
                    ],
                ),
            )],
            4,
        );
        assert_eq!(
            support::int(&world.entities[&EntityId::from("hero-a")], "retreating"),
            0
        );
    }

    #[test]
    fn move_and_pursue_propagate_to_living_squad_with_pursuit_edge_endpoint() {
        let mut world = WorldState::default();
        world.entities.insert(
            "hero-a".into(),
            hero(CombatantSide::Attacker, "squad-a", "mid_a"),
        );
        world.entities.insert(
            "hero-b".into(),
            hero(CombatantSide::Attacker, "squad-a", "mid_a"),
        );
        let mut target = hero(CombatantSide::Defender, "enemy", "mid_a");
        support::set_string(&mut target, "edge_to", "mid_b");
        support::set_int(&mut target, "edge_progress", 7);
        world.entities.insert("enemy".into(), target);

        let rules = rules();
        let accepted = vec![
            (
                CombatantSide::Attacker,
                intent(
                    "move",
                    "move",
                    "hero-a",
                    vec![
                        DomainValue::Entity("hero-a".into()),
                        DomainValue::String("mid_a".into()),
                    ],
                ),
            ),
            (
                CombatantSide::Attacker,
                intent(
                    "pursue",
                    "pursue",
                    "hero-b",
                    vec![
                        DomainValue::Entity("hero-b".into()),
                        DomainValue::Entity("enemy".into()),
                    ],
                ),
            ),
        ];
        apply(&mut world, &rules, &accepted, 1);

        for hero_id in ["hero-a", "hero-b"] {
            let entity = &world.entities[&EntityId::from(hero_id)];
            assert_eq!(support::string(entity, "goal"), "mid_b");
            assert_eq!(
                entity.fields[&senkei_model::FieldId::from("target")],
                DomainValue::Entity("enemy".into())
            );
        }
    }

    #[test]
    fn retreat_beats_pursue_and_move_independent_of_accepted_order() {
        let mut world = WorldState::default();
        world.entities.insert(
            "hero-a".into(),
            hero(CombatantSide::Attacker, "squad-a", "mid_a"),
        );
        world.entities.insert(
            "hero-b".into(),
            hero(CombatantSide::Attacker, "squad-a", "mid_a"),
        );
        world.entities.insert(
            "enemy".into(),
            hero(CombatantSide::Defender, "enemy", "mid_b"),
        );
        let move_order = (
            CombatantSide::Attacker,
            intent(
                "move",
                "move",
                "hero-a",
                vec![
                    DomainValue::Entity("hero-a".into()),
                    DomainValue::String("mid_b".into()),
                ],
            ),
        );
        let pursue_order = (
            CombatantSide::Attacker,
            intent(
                "pursue",
                "pursue",
                "hero-a",
                vec![
                    DomainValue::Entity("hero-a".into()),
                    DomainValue::Entity("enemy".into()),
                ],
            ),
        );
        let retreat_order = (
            CombatantSide::Attacker,
            intent(
                "retreat",
                "retreat",
                "hero-b",
                vec![DomainValue::Entity("hero-b".into())],
            ),
        );
        let rules = rules();
        apply(
            &mut world,
            &rules,
            &[
                move_order.clone(),
                pursue_order.clone(),
                retreat_order.clone(),
            ],
            1,
        );
        for hero_id in ["hero-a", "hero-b"] {
            assert_eq!(
                support::string(&world.entities[&EntityId::from(hero_id)], "goal"),
                "attacker_base"
            );
        }

        let mut reversed = WorldState::default();
        reversed.entities.insert(
            "hero-a".into(),
            hero(CombatantSide::Attacker, "squad-a", "mid_a"),
        );
        reversed.entities.insert(
            "hero-b".into(),
            hero(CombatantSide::Attacker, "squad-a", "mid_a"),
        );
        reversed.entities.insert(
            "enemy".into(),
            hero(CombatantSide::Defender, "enemy", "mid_b"),
        );
        apply(
            &mut reversed,
            &rules,
            &[retreat_order, pursue_order, move_order],
            1,
        );
        assert_eq!(world, reversed);
    }
}
