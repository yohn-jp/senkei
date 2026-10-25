//! Deterministic graph navigation for the finite `senkei.next` world.

use crate::next_support::{alive, int, param, set_int, set_string, string};
use senkei_model::{
    BattleMap, CombatantSide, EntityId, EntityState, MapEdge, NextRules, WorldState,
};
use std::collections::{BTreeMap, BTreeSet};

const RATE_SCALE: i128 = 1_000;
// Four per-mille modifiers are combined before terrain is applied:
// minion vision, squad size, haste, and slow.
const CAPACITY_SCALE: i128 = RATE_SCALE * RATE_SCALE * RATE_SCALE * RATE_SCALE;

struct MovementIntent {
    goal: String,
    budget: i128,
}

/// Advance every living mobile entity with a valid node goal by one tick.
///
/// Movement factors are sampled from the same start-of-movement world for all
/// entities. A Hero squad uses its lowest living member's effective base
/// speed, the lowest-ID living member's movement goal, and that member's
/// minion-vision sample. All members keep their own graph position and edge
/// progress; the shared movement intent never snaps their coordinates. The
/// world-unit result floors fractional progress, carrying unused fixed-point
/// budget over multiple edges in the same tick.
pub fn advance(world: &mut WorldState, rules: &NextRules, tick: u32) {
    // Vision and squad membership are both sampled before any entity moves.
    let start_world = world.clone();
    let entity_ids = start_world
        .entities
        .iter()
        .filter(|(_, entity)| is_mobile(entity.entity_type.as_str()) && alive(entity))
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();

    for id in entity_ids {
        let Some(start) = start_world.entities.get(&id) else {
            continue;
        };
        let Some(entity) = world.entities.get_mut(&id) else {
            continue;
        };
        let mut next = start.clone();
        let movement = movement_intent(&id, start, &start_world, rules, tick);
        advance_entity(&mut next, rules, &movement);
        *entity = next;
    }
}

/// Return a deterministic shortest legal route, including both endpoints.
///
/// Edges are undirected. Blocked, non-positive, self, and dangling edges are
/// ignored. Equal-length routes choose the lexicographically smaller complete
/// node sequence, independent of the order of `map.edges`.
pub fn path(map: &BattleMap, from: &str, to: &str) -> Option<Vec<String>> {
    if !map.nodes.contains_key(from) || !map.nodes.contains_key(to) {
        return None;
    }
    if from == to {
        return Some(vec![from.to_owned()]);
    }

    let mut best = BTreeMap::<String, (i128, Vec<String>)>::new();
    let mut queue = BTreeSet::<(i128, Vec<String>, String)>::new();
    let start_path = vec![from.to_owned()];
    best.insert(from.to_owned(), (0, start_path.clone()));
    queue.insert((0, start_path, from.to_owned()));

    while let Some((distance, route, node)) = queue.pop_first() {
        if best.get(&node) != Some(&(distance, route.clone())) {
            continue;
        }
        if node == to {
            return Some(route);
        }

        for (neighbor, edge_length) in neighbors(map, &node) {
            let candidate_distance = distance.checked_add(i128::from(edge_length))?;
            let mut candidate_route = route.clone();
            candidate_route.push(neighbor.clone());
            let candidate = (candidate_distance, candidate_route.clone());
            let improves = best
                .get(&neighbor)
                .map(|known| candidate < *known)
                .unwrap_or(true);
            if improves {
                best.insert(neighbor.clone(), candidate);
                queue.insert((candidate_distance, candidate_route, neighbor));
            }
        }
    }

    None
}

fn is_mobile(entity_type: &str) -> bool {
    matches!(entity_type, "hero" | "minion" | "monster")
}

fn advance_entity(entity: &mut EntityState, rules: &NextRules, movement: &MovementIntent) {
    let goal = &movement.goal;
    let mut node = string(entity, "node");
    if node.is_empty() || !rules.map.nodes.contains_key(&node) {
        return;
    }

    let mut remaining = if goal.is_empty() || !rules.map.nodes.contains_key(goal) {
        0
    } else {
        movement.budget
    };

    // Normalize a pre-existing edge state, or leave it untouched if it names
    // an illegal edge. In particular, navigation never crosses a blocked or
    // non-adjacent pair by interpreting node names as coordinates.
    let mut edge_to = string(entity, "edge_to");
    if !edge_to.is_empty() {
        let Some(edge) = edge_for_nodes(&rules.map, &node, &edge_to) else {
            return;
        };
        let progress = int(entity, "edge_progress").clamp(0, edge.length);
        let offset = edge_offset(entity, &node, &edge_to, progress, edge, &rules.map);
        if progress == edge.length {
            set_edge_position(entity, &node, &edge_to, progress, edge, &rules.map, offset);
            node = edge_to.clone();
            edge_to.clear();
            set_string(entity, "node", &node);
            set_string(entity, "edge_to", "");
            set_int(entity, "edge_progress", 0);
        } else {
            set_int(entity, "edge_progress", progress);
            set_edge_position(entity, &node, &edge_to, progress, edge, &rules.map, offset);
        }
    } else {
        set_string(entity, "node", &node);
        set_string(entity, "edge_to", "");
        set_int(entity, "edge_progress", 0);
        ensure_node_position(entity, &node, &rules.map);
    }

    if goal.is_empty() || !rules.map.nodes.contains_key(goal) || remaining <= 0 {
        return;
    }

    // A route is recomputed after each node arrival so a changed goal applies
    // as soon as the entity reaches the next legal graph node.
    let mut traversed_edges = 0_usize;
    let max_edges = rules.map.nodes.len();
    loop {
        if traversed_edges >= max_edges {
            break;
        }

        if edge_to.is_empty() {
            if node == goal.as_str() {
                break;
            }
            let Some(route) = route_for_entity(entity, &rules.map, &node, goal) else {
                break;
            };
            let Some(next_node) = route.get(1) else {
                break;
            };
            if edge_for_nodes(&rules.map, &node, next_node).is_none() {
                break;
            }
            edge_to = next_node.clone();
            let Some(edge) = edge_for_nodes(&rules.map, &node, &edge_to) else {
                break;
            };
            let offset = node_offset(entity, &node, &rules.map);
            set_string(entity, "node", &node);
            set_string(entity, "edge_to", &edge_to);
            set_int(entity, "edge_progress", 0);
            set_edge_position(entity, &node, &edge_to, 0, edge, &rules.map, offset);
        }

        let Some(edge) = edge_for_nodes(&rules.map, &node, &edge_to) else {
            // This should only be possible for malformed map/state input.
            // Stop in place instead of making an illegal jump.
            break;
        };
        let progress = int(entity, "edge_progress").clamp(0, edge.length);
        let left_on_edge = edge.length - progress;
        let offset = edge_offset(entity, &node, &edge_to, progress, edge, &rules.map);
        let terrain_milli = terrain_speed_milli(rules, edge);
        if left_on_edge <= 0 || terrain_milli <= 0 {
            break;
        }

        let edge_cost = units_to_base_budget(left_on_edge, terrain_milli);
        if remaining >= edge_cost {
            remaining -= edge_cost;
            set_edge_position(
                entity,
                &node,
                &edge_to,
                edge.length,
                edge,
                &rules.map,
                offset,
            );
            node = edge_to.clone();
            edge_to.clear();
            set_string(entity, "node", &node);
            set_string(entity, "edge_to", "");
            set_int(entity, "edge_progress", 0);
            traversed_edges += 1;
            if remaining == 0 || node == goal.as_str() {
                break;
            }
            continue;
        }

        let step = budget_to_units(remaining, terrain_milli).min(left_on_edge);
        if step > 0 {
            let next_progress = progress.saturating_add(step).min(edge.length);
            set_int(entity, "edge_progress", next_progress);
            set_edge_position(
                entity,
                &node,
                &edge_to,
                next_progress,
                edge,
                &rules.map,
                offset,
            );
        }
        break;
    }
}

/// Movement budget uses one-trillionth world-unit precision for the product
/// of per-mille vision, squad, haste, and slow multipliers. Terrain is applied
/// per edge below. Integer edge progress floors fractional world units.
fn movement_intent(
    entity_id: &EntityId,
    entity: &EntityState,
    world: &WorldState,
    rules: &NextRules,
    tick: u32,
) -> MovementIntent {
    if entity.entity_type.as_str() != "hero" {
        let speed = i128::from(int(entity, "speed").max(0));
        return MovementIntent {
            goal: string(entity, "goal"),
            budget: speed.checked_mul(CAPACITY_SCALE).unwrap_or(0),
        };
    }

    let members = hero_cohort(entity_id, entity, world);
    let Some((_, leader)) = members.first() else {
        return MovementIntent {
            goal: string(entity, "goal"),
            budget: 0,
        };
    };
    let goal = string(leader, "goal");
    let size = members.len().clamp(1, 5);
    let base_budget = members
        .iter()
        .map(|(_, member)| hero_base_speed_budget(member, tick))
        .min()
        .unwrap_or(0);
    let vision_milli = leader
        .owner
        .filter(|side| crate::next_vision::minion_vision(world, *side, leader))
        .map(|_| param(rules, "minion_vision_speed_milli", 1_200))
        .unwrap_or(1_000);
    let squad_milli = squad_speed_milli(size, rules);
    let budget = if vision_milli <= 0 || squad_milli <= 0 {
        0
    } else {
        base_budget
            .checked_mul(i128::from(vision_milli))
            .and_then(|value| value.checked_mul(i128::from(squad_milli)))
            .unwrap_or(0)
    };

    MovementIntent { goal, budget }
}

fn hero_cohort(
    actor_id: &EntityId,
    actor: &EntityState,
    world: &WorldState,
) -> Vec<(EntityId, EntityState)> {
    // WorldState's BTreeMap order makes the first living member the stable
    // cohort leader for goal and vision sampling.
    let squad = string(actor, "squad");
    let Some(side) = actor.owner.filter(|_| !squad.is_empty()) else {
        return vec![(actor_id.clone(), actor.clone())];
    };

    let members = world
        .entities
        .iter()
        .filter(|(_, candidate)| {
            candidate.entity_type.as_str() == "hero"
                && candidate.owner == Some(side)
                && alive(candidate)
                && string(candidate, "squad") == squad
        })
        .map(|(id, candidate)| (id.clone(), candidate.clone()))
        .collect::<Vec<_>>();
    if members.is_empty() {
        vec![(actor_id.clone(), actor.clone())]
    } else {
        members
    }
}

fn hero_base_speed_budget(entity: &EntityState, tick: u32) -> i128 {
    let speed = i128::from(int(entity, "speed").max(0));
    if speed == 0 {
        return 0;
    }
    let haste_milli = if int(entity, "haste_until") > i64::from(tick) {
        1_000_i128 + i128::from(int(entity, "haste").max(0))
    } else {
        1_000
    };
    let slow_milli = if int(entity, "slow_until") > i64::from(tick) {
        1_000_i128.saturating_sub(i128::from(int(entity, "slow").max(0)))
    } else {
        1_000
    };
    speed
        .checked_mul(haste_milli)
        .and_then(|value| value.checked_mul(slow_milli))
        .unwrap_or(0)
}

fn squad_speed_milli(size: usize, rules: &NextRules) -> i64 {
    let (parameter, fallback) = match size {
        1 => ("squad_1_speed_milli", 1_000),
        2 => ("squad_2_speed_milli", 950),
        3 => ("squad_3_speed_milli", 900),
        4 => ("squad_4_speed_milli", 850),
        _ => ("squad_5_speed_milli", 800),
    };
    param(rules, parameter, fallback)
}

fn terrain_speed_milli(rules: &NextRules, edge: &MapEdge) -> i64 {
    match edge.region.as_str() {
        "jungle" => param(rules, "terrain_jungle_speed_milli", 800),
        _ => param(rules, "terrain_lane_speed_milli", 1_000),
    }
}

fn route_for_entity(
    entity: &EntityState,
    map: &BattleMap,
    from: &str,
    to: &str,
) -> Option<Vec<String>> {
    // Lane minions target the opposing base but should remain on their assigned
    // lane. Heroes, monsters, and units with an explicit waypoint use the
    // general shortest legal route through the whole graph.
    if entity.entity_type.as_str() == "minion" {
        if let Some(side) = entity.owner {
            let lane = string(entity, "lane");
            if let Some(lane_nodes) = map.lanes.get(&lane) {
                let (expected_goal, lane_route) = match side {
                    CombatantSide::Attacker => (map.defender_base.as_str(), lane_nodes.clone()),
                    CombatantSide::Defender => (
                        map.attacker_base.as_str(),
                        lane_nodes.iter().rev().cloned().collect(),
                    ),
                };
                if to == expected_goal {
                    let start = lane_route.iter().position(|node| node == from)?;
                    let finish = lane_route.iter().position(|node| node == to)?;
                    if start <= finish {
                        let route = lane_route[start..=finish].to_vec();
                        let legal = route
                            .windows(2)
                            .all(|pair| edge_for_nodes(map, &pair[0], &pair[1]).is_some());
                        if legal {
                            return Some(route);
                        }
                        return None;
                    }
                    return None;
                }
            }
        }
    }
    path(map, from, to)
}

fn units_to_base_budget(units: i64, terrain_milli: i64) -> i128 {
    // A segment's full-edge budget is units / terrain. One base-budget unit is
    // 1/CAPACITY_SCALE world units.
    let numerator = i128::from(units)
        .checked_mul(CAPACITY_SCALE)
        .and_then(|value| value.checked_mul(RATE_SCALE));
    let Some(numerator) = numerator else {
        return i128::MAX;
    };
    div_ceil(numerator, i128::from(terrain_milli))
}

fn budget_to_units(budget: i128, terrain_milli: i64) -> i64 {
    let Some(numerator) = budget.checked_mul(i128::from(terrain_milli)) else {
        return i64::MAX;
    };
    let denominator = CAPACITY_SCALE * RATE_SCALE;
    i64::try_from(numerator / denominator).unwrap_or(i64::MAX)
}

fn div_ceil(numerator: i128, denominator: i128) -> i128 {
    if numerator <= 0 || denominator <= 0 {
        return 0;
    }
    (numerator - 1) / denominator + 1
}

fn neighbors(map: &BattleMap, node: &str) -> Vec<(String, i64)> {
    let mut shortest = BTreeMap::<String, i64>::new();
    for edge in &map.edges {
        if edge.blocked
            || edge.length <= 0
            || edge.from == edge.to
            || !map.nodes.contains_key(&edge.from)
            || !map.nodes.contains_key(&edge.to)
        {
            continue;
        }
        let neighbor = if edge.from == node {
            &edge.to
        } else if edge.to == node {
            &edge.from
        } else {
            continue;
        };
        shortest
            .entry(neighbor.clone())
            .and_modify(|length| *length = (*length).min(edge.length))
            .or_insert(edge.length);
    }
    shortest.into_iter().collect()
}

fn edge_for_nodes<'a>(map: &'a BattleMap, from: &str, to: &str) -> Option<&'a MapEdge> {
    map.edges
        .iter()
        .filter(|edge| {
            !edge.blocked
                && edge.length > 0
                && edge.from != edge.to
                && map.nodes.contains_key(&edge.from)
                && map.nodes.contains_key(&edge.to)
                && ((edge.from == from && edge.to == to) || (edge.from == to && edge.to == from))
        })
        .min_by_key(|edge| {
            (
                edge.length,
                edge.region.as_str(),
                edge.from.as_str(),
                edge.to.as_str(),
            )
        })
}

fn set_edge_position(
    entity: &mut EntityState,
    from: &str,
    to: &str,
    progress: i64,
    edge: &MapEdge,
    map: &BattleMap,
    offset: (i128, i128),
) {
    let Some((x, y)) = interpolated_position(from, to, progress, edge, map) else {
        return;
    };
    set_int(entity, "x", world_coordinate(x + offset.0));
    set_int(entity, "y", world_coordinate(y + offset.1));
}

fn edge_offset(
    entity: &EntityState,
    from: &str,
    to: &str,
    progress: i64,
    edge: &MapEdge,
    map: &BattleMap,
) -> (i128, i128) {
    let Some((expected_x, expected_y)) = interpolated_position(from, to, progress, edge, map)
    else {
        return (0, 0);
    };
    let offset_x = has_integer_field(entity, "x")
        .then(|| i128::from(int(entity, "x")) - expected_x)
        .unwrap_or(0);
    let offset_y = has_integer_field(entity, "y")
        .then(|| i128::from(int(entity, "y")) - expected_y)
        .unwrap_or(0);
    (offset_x, offset_y)
}

fn node_offset(entity: &EntityState, node: &str, map: &BattleMap) -> (i128, i128) {
    let Some(position) = map.nodes.get(node) else {
        return (0, 0);
    };
    let offset_x = has_integer_field(entity, "x")
        .then(|| i128::from(int(entity, "x")) - i128::from(position.x))
        .unwrap_or(0);
    let offset_y = has_integer_field(entity, "y")
        .then(|| i128::from(int(entity, "y")) - i128::from(position.y))
        .unwrap_or(0);
    (offset_x, offset_y)
}

fn interpolated_position(
    from: &str,
    to: &str,
    progress: i64,
    edge: &MapEdge,
    map: &BattleMap,
) -> Option<(i128, i128)> {
    let (start, end) = (map.nodes.get(from)?, map.nodes.get(to)?);
    if edge.length <= 0 {
        return None;
    }
    let progress = i128::from(progress.clamp(0, edge.length));
    let length = i128::from(edge.length);
    let x = i128::from(start.x) + (i128::from(end.x) - i128::from(start.x)) * progress / length;
    let y = i128::from(start.y) + (i128::from(end.y) - i128::from(start.y)) * progress / length;
    Some((x, y))
}

fn ensure_node_position(entity: &mut EntityState, node: &str, map: &BattleMap) {
    let Some(position) = map.nodes.get(node) else {
        return;
    };
    if !has_integer_field(entity, "x") {
        set_int(entity, "x", position.x);
    }
    if !has_integer_field(entity, "y") {
        set_int(entity, "y", position.y);
    }
}

fn has_integer_field(entity: &EntityState, key: &str) -> bool {
    matches!(
        entity.fields.get(&key.into()),
        Some(senkei_model::DomainValue::Integer(_))
    )
}

fn world_coordinate(value: i128) -> i64 {
    value.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{BattleMap, EntityId, MapNode, NextRules, Version};
    use std::collections::BTreeMap;

    fn node(region: &str, x: i64) -> (String, MapNode) {
        (
            region.to_owned(),
            MapNode {
                x,
                y: 0,
                region: "lane".into(),
            },
        )
    }

    fn test_map(edges: Vec<MapEdge>) -> BattleMap {
        BattleMap {
            id: "test".into(),
            nodes: BTreeMap::from([node("a", 0), node("b", 10), node("c", 20), node("d", 10)]),
            edges,
            lanes: BTreeMap::new(),
            attacker_base: "a".into(),
            defender_base: "c".into(),
            towers: Vec::new(),
        }
    }

    fn edge(from: &str, to: &str, length: i64, region: &str, blocked: bool) -> MapEdge {
        MapEdge {
            from: from.into(),
            to: to.into(),
            length,
            region: region.into(),
            blocked,
        ..Default::default()
}
    }

    fn rules(map: BattleMap) -> NextRules {
        let parameters = BTreeMap::from([
            ("terrain_lane_speed_milli".into(), 1_000),
            ("terrain_jungle_speed_milli".into(), 800),
            ("minion_vision_speed_milli".into(), 1_200),
            ("squad_1_speed_milli".into(), 1_000),
            ("squad_2_speed_milli".into(), 950),
            ("squad_3_speed_milli".into(), 900),
            ("squad_4_speed_milli".into(), 850),
            ("squad_5_speed_milli".into(), 800),
        ]);
        NextRules {
            mechanics_version: Version::new(1, 0, 0),
            map,
            heroes: Vec::new(),
            minions: Vec::new(),
            monsters: Vec::new(),
            camps: Vec::new(),
            parameters,
        }
    }

    fn entity(
        kind: &str,
        owner: Option<CombatantSide>,
        speed: i64,
        node: &str,
        goal: &str,
    ) -> EntityState {
        let mut state = EntityState {
            entity_type: kind.into(),
            owner,
            fields: BTreeMap::new(),
        };
        for (key, value) in [
            ("hp", 10),
            ("speed", speed),
            ("vision", 10),
            ("x", 0),
            ("y", 0),
            ("edge_progress", 0),
        ] {
            set_int(&mut state, key, value);
        }
        set_string(&mut state, "node", node);
        set_string(&mut state, "edge_to", "");
        set_string(&mut state, "goal", goal);
        set_string(&mut state, "squad", "s1");
        state
    }

    fn id(value: &str) -> EntityId {
        EntityId::from(value)
    }

    #[test]
    fn path_is_undirected_shortest_and_lexically_stable() {
        let edges = vec![
            edge("a", "b", 4, "lane", false),
            edge("b", "c", 4, "lane", false),
            edge("a", "d", 4, "lane", false),
            edge("d", "c", 4, "lane", false),
            edge("a", "c", 1, "lane", true),
        ];
        let forward = test_map(edges.clone());
        let reverse = test_map(edges.into_iter().rev().collect());
        assert_eq!(
            path(&forward, "a", "c"),
            Some(vec!["a", "b", "c"].into_iter().map(str::to_owned).collect())
        );
        assert_eq!(
            path(&forward, "c", "a"),
            Some(vec!["c", "b", "a"].into_iter().map(str::to_owned).collect())
        );
        assert_eq!(path(&forward, "a", "a"), Some(vec!["a".into()]));
        assert_eq!(path(&forward, "missing", "a"), None);
        assert_eq!(path(&forward, "a", "c"), path(&reverse, "a", "c"));
    }

    #[test]
    fn path_ignores_dangling_nonpositive_self_and_blocked_edges() {
        let map = test_map(vec![
            edge("a", "c", 1, "lane", true),
            edge("a", "b", 0, "lane", false),
            edge("a", "a", 1, "lane", false),
            edge("a", "unknown", 1, "lane", false),
        ]);
        assert_eq!(path(&map, "a", "c"), None);
    }

    #[test]
    fn edge_progress_and_coordinates_follow_the_route_without_teleporting() {
        let map = test_map(vec![
            edge("a", "b", 100, "lane", false),
            edge("b", "c", 100, "lane", false),
        ]);
        let mut world = WorldState::default();
        world.entities.insert(
            id("hero"),
            entity("hero", Some(CombatantSide::Attacker), 25, "a", "c"),
        );
        advance(&mut world, &rules(map), 1);
        let hero = &world.entities[&id("hero")];
        assert_eq!(string(hero, "node"), "a");
        assert_eq!(string(hero, "edge_to"), "b");
        assert_eq!(int(hero, "edge_progress"), 25);
        assert_eq!(int(hero, "x"), 2);

        // Mid-edge reversal still completes the current adjacent edge before
        // taking a route back; it never places the entity directly at `a`.
        set_string(world.entities.get_mut(&id("hero")).unwrap(), "goal", "a");
        set_int(world.entities.get_mut(&id("hero")).unwrap(), "speed", 100);
        advance(
            &mut world,
            &rules(test_map(vec![edge("a", "b", 100, "lane", false)])),
            2,
        );
        let hero = &world.entities[&id("hero")];
        assert_eq!(string(hero, "node"), "b");
        assert_eq!(string(hero, "edge_to"), "a");
        assert_eq!(int(hero, "edge_progress"), 25);
        assert_eq!((int(hero, "x"), int(hero, "y")), (8, 0));
    }

    #[test]
    fn exact_integer_movement_factors_apply_to_terrain_vision_and_squads() {
        let map = test_map(vec![edge("a", "b", 1_000, "lane", false)]);
        let config = rules(map.clone());

        let mut no_vision = WorldState::default();
        no_vision.entities.insert(
            id("h"),
            entity("hero", Some(CombatantSide::Attacker), 100, "a", "b"),
        );
        advance(&mut no_vision, &config, 1);
        assert_eq!(int(&no_vision.entities[&id("h")], "edge_progress"), 100);

        let mut vision = WorldState::default();
        vision.entities.insert(
            id("h"),
            entity("hero", Some(CombatantSide::Attacker), 100, "a", "b"),
        );
        vision.entities.insert(
            id("m"),
            entity("minion", Some(CombatantSide::Attacker), 0, "a", ""),
        );
        advance(&mut vision, &config, 1);
        assert_eq!(int(&vision.entities[&id("h")], "edge_progress"), 120);

        let jungle = rules(test_map(vec![edge("a", "b", 1_000, "jungle", false)]));
        let mut jungle_no_vision = WorldState::default();
        jungle_no_vision.entities.insert(
            id("h"),
            entity("hero", Some(CombatantSide::Attacker), 100, "a", "b"),
        );
        advance(&mut jungle_no_vision, &jungle, 1);
        assert_eq!(
            int(&jungle_no_vision.entities[&id("h")], "edge_progress"),
            80
        );

        let mut jungle_vision = WorldState::default();
        jungle_vision.entities.insert(
            id("h"),
            entity("hero", Some(CombatantSide::Attacker), 100, "a", "b"),
        );
        jungle_vision.entities.insert(
            id("m"),
            entity("minion", Some(CombatantSide::Attacker), 0, "a", ""),
        );
        advance(&mut jungle_vision, &jungle, 1);
        assert_eq!(int(&jungle_vision.entities[&id("h")], "edge_progress"), 96);

        let mut duo = WorldState::default();
        duo.entities.insert(
            id("h1"),
            entity("hero", Some(CombatantSide::Attacker), 100, "a", "b"),
        );
        duo.entities.insert(
            id("h2"),
            entity("hero", Some(CombatantSide::Attacker), 100, "a", "b"),
        );
        advance(&mut duo, &config, 1);
        assert_eq!(int(&duo.entities[&id("h1")], "edge_progress"), 95);
        assert_eq!(int(&duo.entities[&id("h2")], "edge_progress"), 95);
    }

    #[test]
    fn mixed_speed_squad_uses_slowest_living_speed_and_stays_coherent() {
        let map = test_map(vec![
            edge("a", "b", 1_000, "lane", false),
            edge("d", "b", 1_000, "lane", false),
            edge("b", "c", 1_000, "lane", false),
        ]);
        let rules = rules(map);
        let mut world = WorldState::default();
        world.entities.insert(
            id("a_slow"),
            entity("hero", Some(CombatantSide::Attacker), 48, "a", "c"),
        );
        let mut fast = entity("hero", Some(CombatantSide::Attacker), 65, "d", "c");
        set_int(&mut fast, "x", 10);
        world.entities.insert(id("b_fast"), fast);
        let mut dead = entity("hero", Some(CombatantSide::Attacker), 1, "a", "b");
        set_int(&mut dead, "hp", 0);
        world.entities.insert(id("z_dead"), dead);
        let mut vision_source = entity("minion", Some(CombatantSide::Attacker), 0, "a", "");
        set_int(&mut vision_source, "vision", 5);
        world.entities.insert(id("m_vision"), vision_source);

        advance(&mut world, &rules, 1);

        let slow = &world.entities[&id("a_slow")];
        let fast = &world.entities[&id("b_fast")];
        assert_eq!(int(slow, "edge_progress"), 54);
        assert_eq!(int(fast, "edge_progress"), 54);
        assert_eq!(string(slow, "node"), "a");
        assert_eq!(string(fast, "node"), "d");
        assert_eq!(string(slow, "edge_to"), string(fast, "edge_to"));
        assert_eq!(string(slow, "edge_to"), "b");
        assert_eq!((int(slow, "x"), int(slow, "y")), (0, 0));
        assert_eq!((int(fast, "x"), int(fast, "y")), (10, 0));
    }

    #[test]
    fn cohort_uses_one_stable_movement_goal() {
        let map = test_map(vec![
            edge("a", "b", 1_000, "lane", false),
            edge("b", "c", 1_000, "lane", false),
        ]);
        let rules = rules(map);
        let mut world = WorldState::default();
        world.entities.insert(
            id("a_leader"),
            entity("hero", Some(CombatantSide::Attacker), 50, "a", "b"),
        );
        world.entities.insert(
            id("z_member"),
            entity("hero", Some(CombatantSide::Attacker), 50, "a", "c"),
        );

        advance(&mut world, &rules, 1);

        for hero_id in [id("a_leader"), id("z_member")] {
            let hero = &world.entities[&hero_id];
            assert_eq!(string(hero, "node"), "a");
            assert_eq!(string(hero, "edge_to"), "b");
            assert_eq!(int(hero, "edge_progress"), 47);
        }
    }

    #[test]
    fn movement_preserves_formation_offsets_through_node_arrival() {
        let map = test_map(vec![edge("a", "b", 100, "lane", false)]);
        let rules = rules(map);
        let mut world = WorldState::default();
        let mut hero = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_int(&mut hero, "x", 3);
        set_int(&mut hero, "y", 4);
        world.entities.insert(id("h"), hero);

        advance(&mut world, &rules, 1);

        let hero = &world.entities[&id("h")];
        assert_eq!(string(hero, "node"), "b");
        assert_eq!((int(hero, "x"), int(hero, "y")), (13, 4));
    }

    #[test]
    fn movement_carries_unused_budget_across_terrain_boundaries() {
        let map = test_map(vec![
            edge("a", "b", 10, "jungle", false),
            edge("b", "c", 100, "lane", false),
        ]);
        let mut world = WorldState::default();
        world.entities.insert(
            id("minion"),
            entity("minion", Some(CombatantSide::Attacker), 20, "a", "c"),
        );
        advance(&mut world, &rules(map), 1);
        let mover = &world.entities[&id("minion")];
        assert_eq!(string(mover, "node"), "b");
        assert_eq!(string(mover, "edge_to"), "c");
        assert_eq!(int(mover, "edge_progress"), 7);
    }

    #[test]
    fn exact_arrival_stops_at_goal_and_blocked_edges_do_not_move() {
        let mut world = WorldState::default();
        world.entities.insert(
            id("hero"),
            entity("hero", Some(CombatantSide::Attacker), 100, "a", "b"),
        );
        advance(
            &mut world,
            &rules(test_map(vec![edge("a", "b", 100, "lane", false)])),
            1,
        );
        let hero = &world.entities[&id("hero")];
        assert_eq!(string(hero, "node"), "b");
        assert_eq!(string(hero, "edge_to"), "");
        assert_eq!(int(hero, "edge_progress"), 0);
        assert_eq!(int(hero, "x"), 10);

        let mut blocked = WorldState::default();
        blocked.entities.insert(
            id("hero"),
            entity("hero", Some(CombatantSide::Attacker), 100, "a", "b"),
        );
        advance(
            &mut blocked,
            &rules(test_map(vec![edge("a", "b", 100, "lane", true)])),
            1,
        );
        let hero = &blocked.entities[&id("hero")];
        assert_eq!(string(hero, "node"), "a");
        assert_eq!(string(hero, "edge_to"), "");
        assert_eq!(int(hero, "edge_progress"), 0);
        assert_eq!(int(hero, "x"), 0);
    }

    #[test]
    fn lane_minions_use_their_assigned_lane_to_reach_the_opposing_base() {
        let mut map = test_map(vec![
            edge("a", "b", 10, "lane", false),
            edge("b", "c", 10, "lane", false),
            edge("a", "d", 1, "jungle", false),
            edge("d", "c", 1, "jungle", false),
        ]);
        map.lanes
            .insert("top".into(), vec!["a".into(), "b".into(), "c".into()]);
        let mut minion = entity("minion", Some(CombatantSide::Attacker), 1, "a", "c");
        set_string(&mut minion, "lane", "top");
        assert_eq!(
            route_for_entity(&minion, &map, "a", "c"),
            Some(vec!["a", "b", "c"].into_iter().map(str::to_owned).collect())
        );
        assert_eq!(
            path(&map, "a", "c"),
            Some(vec!["a", "d", "c"].into_iter().map(str::to_owned).collect())
        );
    }

    #[test]
    fn active_haste_and_slow_use_per_mille_and_expiry_tick() {
        let map = test_map(vec![edge("a", "b", 1_000, "lane", false)]);
        let rules = rules(map);
        let mut world = WorldState::default();
        let mut hero = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_int(&mut hero, "haste", 500);
        set_int(&mut hero, "haste_until", 3);
        set_int(&mut hero, "slow", 500);
        set_int(&mut hero, "slow_until", 3);
        world.entities.insert(id("h"), hero);
        advance(&mut world, &rules, 2);
        assert_eq!(int(&world.entities[&id("h")], "edge_progress"), 75);

        let mut world = WorldState::default();
        let mut hero = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_int(&mut hero, "haste", 500);
        set_int(&mut hero, "haste_until", 3);
        set_int(&mut hero, "slow", 500);
        set_int(&mut hero, "slow_until", 3);
        world.entities.insert(id("h"), hero);
        advance(&mut world, &rules, 3);
        assert_eq!(int(&world.entities[&id("h")], "edge_progress"), 100);
    }
}
