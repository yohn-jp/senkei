//! Deterministic graph navigation for the finite `senkei.next` world.

use crate::next_support::{alive, int, param, set_int, set_string, string};
use senkei_model::{
    BattleMap, CombatantSide, DomainValue, EntityId, EntityState, MapEdge, NextRules, SkillEffect,
    WorldState,
};
use std::collections::{BTreeMap, BTreeSet};

const RATE_SCALE: i128 = 1_000;
// Four per-mille modifiers are combined before terrain is applied:
// minion vision, squad size, haste, and slow.
const CAPACITY_SCALE: i128 = RATE_SCALE * RATE_SCALE * RATE_SCALE * RATE_SCALE;

struct MovementIntent {
    goal: String,
    track: String,
    terrain_milli: Option<i64>,
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
    let snapshot = world.clone();
    let mut ids = snapshot
        .entities
        .iter()
        .filter(|(_, entity)| is_mobile(entity.entity_type.as_str()) && alive(entity))
        .map(|(id, entity)| {
            (
                if entity.entity_type.as_str() == "minion" {
                    0
                } else {
                    1
                },
                id.clone(),
            )
        })
        .collect::<Vec<_>>();
    // Minion reservations have priority; stable identity resolves all ties.
    ids.sort();
    let mut bridge_reservations = BTreeSet::<(String, String)>::new();
    let mut cross_reservations = BTreeSet::<(String, i64, String)>::new();
    for (_, id) in ids {
        let Some(start) = snapshot.entities.get(&id) else {
            continue;
        };
        if start.entity_type.as_str() == "hero"
            && hero_cohort(&id, start, &snapshot)
                .iter()
                .any(|(_, member)| int(member, "action_lock_until") > i64::from(tick))
        {
            continue;
        }
        let Some(entity) = world.entities.get_mut(&id) else {
            continue;
        };
        let mut next = start.clone();
        let movement = movement_intent(&id, start, &snapshot, rules, tick);
        advance_entity(
            &id,
            &mut next,
            rules,
            &movement,
            &snapshot,
            &mut bridge_reservations,
            &mut cross_reservations,
            tick,
        );
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

fn advance_entity(
    actor_id: &EntityId,
    entity: &mut EntityState,
    rules: &NextRules,
    movement: &MovementIntent,
    snapshot: &WorldState,
    bridge_reservations: &mut BTreeSet<(String, String)>,
    cross_reservations: &mut BTreeSet<(String, i64, String)>,
    tick: u32,
) {
    if int(entity, "action_lock_until") > i64::from(tick) {
        return;
    }
    let goal = &movement.goal;
    let mut node = string(entity, "node");
    if node.is_empty() || !rules.map.nodes.contains_key(&node) {
        return;
    }
    let explicit_move = int(entity, "move_intent_tick") == i64::from(tick) + 1
        || int(entity, "track_intent_tick") == i64::from(tick) + 1;
    if (goal.is_empty() && !explicit_move && string(entity, "edge_to").is_empty())
        || (!goal.is_empty() && !rules.map.nodes.contains_key(goal))
    {
        return;
    }
    if explicit_move {
        mark_moved(entity, tick);
    }

    // Normal bridges, broken-bridge fords, river fords, and lateral crossings
    // are transit states. A legal attack opportunity cannot freeze them midway.
    // If a bridge is destroyed while a traveler is already on its edge,
    // promote that incumbent to a ford state without relocating its progress.
    let incumbent_edge = string(entity, "edge_to");
    let incumbent_node = string(entity, "node");
    if int(entity, "ford_active") == 0 && !incumbent_edge.is_empty() {
        if let Some(edge) = edge_for_nodes(&rules.map, &incumbent_node, &incumbent_edge) {
            if is_bridge(edge) && bridge_state(snapshot, &edge.bridge_site) == "destroyed" {
                set_int(entity, "ford_active", 1);
                let extra = param(rules, "ford_extra_ticks", 24).max(0);
                if extra > 0 {
                    set_int(entity, "ford_remaining", extra - 1);
                    mark_moved(entity, tick);
                    return;
                }
            }
        }
    }
    let forced_transit = is_forced_transit(entity, &rules.map);
    if forced_transit {
        mark_moved(entity, tick);
    }
    // Attackers in the current combat domain hold the whole Squad; an explicit
    // retreat or MOVE/TRACK selection suppresses default auto-stop this tick.
    if !explicit_move
        && !forced_transit
        && int(entity, "retreating") == 0
        && should_hold_for_attack(actor_id, entity, snapshot, rules, tick)
    {
        return;
    }

    let remaining = movement.budget;
    let mut edge_to = string(entity, "edge_to");
    if !edge_to.is_empty() {
        let Some(edge) = edge_for_nodes(&rules.map, &node, &edge_to) else {
            return;
        };
        let progress = int(entity, "edge_progress").clamp(0, edge.length);
        if progress == edge.length {
            // Normalize old boundary state, but never use the same opportunity
            // to enter the next edge.
            node = edge_to.clone();
            edge_to.clear();
            set_string(entity, "node", &node);
            set_string(entity, "edge_to", "");
            set_int(entity, "edge_progress", 0);
            clear_track(entity);
            set_int(entity, "ford_active", 0);
            set_int(entity, "ford_remaining", 0);
            mark_moved(entity, tick);
            if let Some(point) = rules.map.nodes.get(&node) {
                set_int(entity, "x", point.x);
                set_int(entity, "y", point.y);
            }
            return;
        }
        set_int(entity, "edge_progress", progress);
        set_edge_position(entity, &node, &edge_to, progress, edge, &rules.map, (0, 0));
    } else {
        set_string(entity, "node", &node);
        set_string(entity, "edge_to", "");
        set_int(entity, "edge_progress", 0);
        ensure_node_position(entity, &node, &rules.map);
    }

    // A requested lane change is a three-tick transit state through CENTER.
    if entity.entity_type.as_str() == "hero" {
        let from = string(entity, "track");
        let to = if movement.track.is_empty() {
            "LEFT"
        } else {
            movement.track.as_str()
        };
        let crossing = int(entity, "cross_remaining");
        if crossing > 0 {
            mark_moved(entity, tick);
            set_int(entity, "cross_remaining", crossing - 1);
            if crossing == 1 {
                let arrived = string(entity, "track_cross_to");
                set_string(entity, "track", arrived);
                set_string(entity, "track_cross_from", "");
                set_string(entity, "track_cross_to", "");
            }
            return;
        }
        if !from.is_empty() && from != to && !edge_to.is_empty() {
            let Some(edge) = edge_for_nodes(&rules.map, &node, &edge_to) else {
                return;
            };
            if edge.region == "lane" && !is_bridge(edge) {
                let slot = edge_identity(edge, &rules.map);
                let progress = int(entity, "edge_progress");
                let radius = param(rules, "track_occupancy_radius_wu", 20).max(0);
                let blocked_by_minion = snapshot.entities.values().any(|other| {
                    other.entity_type.as_str() == "minion"
                        && alive(other)
                        && string(other, "node") == node
                        && string(other, "edge_to") == edge_to
                        && (int(other, "edge_progress") - progress).abs() <= radius
                });
                let group = movement_group(actor_id, entity);
                let crossing_active = snapshot.entities.iter().any(|(other_id, other)| {
                    other.entity_type.as_str() == "hero"
                        && alive(other)
                        && int(other, "cross_remaining") > 0
                        && string(other, "node") == node
                        && string(other, "edge_to") == edge_to
                        && movement_group(other_id, other) != group
                        && (int(other, "edge_progress") - progress).abs() <= radius
                });
                let crossing_reserved = cross_reservations.iter().any(
                    |(reserved_edge, reserved_progress, reserved_group)| {
                        reserved_edge == &slot
                            && reserved_group != &group
                            && (*reserved_progress - progress).abs() <= radius
                    },
                );
                if blocked_by_minion || crossing_active || crossing_reserved {
                    let waited = int(entity, "track_wait_ticks").saturating_add(1);
                    let maximum = param(rules, "track_occupancy_max_ticks", 30).max(1);
                    if waited >= maximum {
                        // Cancel the stalled lateral order at its safe origin;
                        // a later explicit Jinrei order may retry after space clears.
                        set_string(entity, "track_goal", &from);
                        set_int(entity, "track_wait_ticks", 0);
                    } else {
                        set_int(entity, "track_wait_ticks", waited);
                    }
                    mark_moved(entity, tick);
                    return;
                }
                cross_reservations.insert((slot, progress, group));
                set_int(entity, "track_wait_ticks", 0);
                let duration = param(rules, "lane_cross_track_ticks", 3).max(1);
                set_int(entity, "cross_remaining", duration - 1);
                set_string(entity, "track_cross_from", &from);
                set_string(entity, "track_cross_to", to);
                mark_moved(entity, tick);
                if duration == 1 {
                    set_string(entity, "track", to);
                    set_string(entity, "track_cross_from", "");
                    set_string(entity, "track_cross_to", "");
                }
                return;
            }
        }
    }

    // An ongoing ford is an actual occupied movement state. Its remaining
    // ticks survive bridge construction or destruction after entry.
    let ford_remaining = int(entity, "ford_remaining");
    if ford_remaining > 0 {
        mark_moved(entity, tick);
        set_int(entity, "ford_remaining", ford_remaining - 1);
        return;
    }
    if !edge_to.is_empty() && int(entity, "edge_progress") == 0 {
        if let Some(edge) = edge_for_nodes(&rules.map, &node, &edge_to) {
            if edge.ford
                || (is_bridge(edge) && bridge_state(snapshot, &edge.bridge_site) == "destroyed")
            {
                set_int(entity, "ford_active", 1);
                let extra = param(rules, "ford_extra_ticks", 24).max(0);
                if extra > 0 {
                    mark_moved(entity, tick);
                    set_int(entity, "ford_remaining", extra - 1);
                    return;
                }
            }
        }
    }

    if edge_to.is_empty() {
        if node == *goal {
            return;
        }
        let Some(route) = route_for_entity(
            entity, &rules.map, &node, goal, snapshot, movement, rules, tick,
        ) else {
            return;
        };
        let Some(next_node) = route.get(1) else {
            return;
        };
        let Some(edge) = edge_for_nodes(&rules.map, &node, next_node) else {
            return;
        };
        if !exit_allowed(entity, &node, next_node, snapshot, &rules.map) {
            return;
        }
        if !edge_allows_track(entity, movement, edge, snapshot) {
            return;
        }
        let entering_track = bridge_track_for(entity, movement, edge, snapshot);
        if is_bridge(edge)
            && !reserve_bridge(
                actor_id,
                entity,
                edge,
                &entering_track,
                snapshot,
                bridge_reservations,
                rules,
            )
        {
            mark_moved(entity, tick);
            return;
        }
        edge_to = next_node.clone();
        set_string(entity, "node", &node);
        set_string(entity, "edge_to", &edge_to);
        set_int(entity, "edge_progress", 0);
        if edge.region == "lane" {
            set_string(entity, "track", &entering_track);
        } else {
            clear_track(entity);
        }
        set_edge_position(entity, &node, &edge_to, 0, edge, &rules.map, (0, 0));
        if edge.ford
            || (is_bridge(edge) && bridge_state(snapshot, &edge.bridge_site) == "destroyed")
        {
            set_int(entity, "ford_active", 1);
            let extra = param(rules, "ford_extra_ticks", 24).max(0);
            if extra > 0 {
                mark_moved(entity, tick);
                set_int(entity, "ford_remaining", extra - 1);
                return;
            }
        }
    } else {
        let Some(edge) = edge_for_nodes(&rules.map, &node, &edge_to) else {
            return;
        };
        if is_bridge(edge)
            && !reserve_bridge(
                actor_id,
                entity,
                edge,
                &string(entity, "track"),
                snapshot,
                bridge_reservations,
                rules,
            )
        {
            mark_moved(entity, tick);
            return;
        }
    }

    let Some(edge) = edge_for_nodes(&rules.map, &node, &edge_to) else {
        return;
    };
    let progress = int(entity, "edge_progress").clamp(0, edge.length);
    let left = edge.length - progress;
    let terrain = terrain_speed_milli(rules, edge, movement);
    if left <= 0 || terrain <= 0 {
        return;
    }
    let cost = units_to_base_budget(left, terrain);
    if remaining >= cost {
        set_edge_position(
            entity,
            &node,
            &edge_to,
            edge.length,
            edge,
            &rules.map,
            (0, 0),
        );
        node = edge_to;
        set_string(entity, "node", &node);
        set_string(entity, "edge_to", "");
        set_int(entity, "edge_progress", 0);
        clear_track(entity);
        set_int(entity, "ford_active", 0);
        set_int(entity, "ford_remaining", 0);
        ensure_node_position(entity, &node, &rules.map);
        mark_moved(entity, tick);
    } else {
        let step = budget_to_units(remaining, terrain).min(left);
        if step > 0 {
            let next = progress.saturating_add(step).min(edge.length);
            set_int(entity, "edge_progress", next);
            set_edge_position(entity, &node, &edge_to, next, edge, &rules.map, (0, 0));
        }
        mark_moved(entity, tick);
    }
}

fn mark_moved(entity: &mut EntityState, tick: u32) {
    set_int(entity, "moved_tick", i64::from(tick) + 1);
}
fn clear_track(entity: &mut EntityState) {
    set_string(entity, "track", "");
}

fn should_hold_for_attack(
    actor_id: &EntityId,
    entity: &EntityState,
    snapshot: &WorldState,
    rules: &NextRules,
    tick: u32,
) -> bool {
    let actors = if entity.entity_type.as_str() == "hero" {
        hero_cohort(actor_id, entity, snapshot)
    } else {
        vec![(actor_id.clone(), entity.clone())]
    };
    actors.iter().any(|(source_id, source)| {
        snapshot.entities.iter().any(|(target_id, target)| {
            target.owner.is_some()
                && target.owner != source.owner
                && alive(target)
                && crate::next_combat::can_basic_attack(
                    source_id, source, target_id, target, snapshot, rules, tick,
                )
        })
    })
}

fn is_forced_transit(entity: &EntityState, map: &BattleMap) -> bool {
    if int(entity, "cross_remaining") > 0 || int(entity, "ford_active") > 0 {
        return true;
    }
    let from = string(entity, "node");
    let to = string(entity, "edge_to");
    if to.is_empty() {
        return false;
    }
    let Some(edge) = edge_for_nodes(map, &from, &to) else {
        return false;
    };
    edge.ford || (is_bridge(edge) && string(entity, "track") == "CENTER")
}

fn bridge_track_for(
    entity: &EntityState,
    movement: &MovementIntent,
    edge: &MapEdge,
    snapshot: &WorldState,
) -> String {
    if entity.entity_type.as_str() == "minion" {
        return "CENTER".into();
    }
    if is_bridge(edge) && bridge_state(snapshot, &edge.bridge_site) != "expanded" {
        return "CENTER".into();
    }
    if is_bridge(edge) && movement.track == "CENTER" {
        return "LEFT".into();
    }
    movement.track.clone()
}

fn is_bridge(edge: &MapEdge) -> bool {
    !edge.bridge_site.is_empty()
}
fn edge_identity(edge: &MapEdge, _map: &BattleMap) -> String {
    if !edge.id.is_empty() {
        edge.id.clone()
    } else {
        format!(
            "{}|{}",
            edge.from.clone().min(edge.to.clone()),
            edge.from.clone().max(edge.to.clone())
        )
    }
}
fn bridge_state(world: &WorldState, site: &str) -> String {
    world
        .entities
        .values()
        .find(|e| e.entity_type.as_str() == "bridge" && string(e, "site") == site)
        .map(|e| string(e, "bridge_state"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "normal".into())
}
fn edge_allows_track(
    entity: &EntityState,
    movement: &MovementIntent,
    edge: &MapEdge,
    _snapshot: &WorldState,
) -> bool {
    if entity.entity_type.as_str() == "minion" {
        return true;
    }
    if edge.region != "lane" {
        return true;
    }
    if is_bridge(edge) {
        return matches!(movement.track.as_str(), "LEFT" | "RIGHT" | "CENTER");
    }
    matches!(movement.track.as_str(), "LEFT" | "RIGHT")
}
fn reserve_bridge(
    actor_id: &EntityId,
    entity: &EntityState,
    edge: &MapEdge,
    requested_track: &str,
    snapshot: &WorldState,
    reservations: &mut BTreeSet<(String, String)>,
    rules: &NextRules,
) -> bool {
    let current_track = string(entity, "track");
    let track = if current_track.is_empty() {
        requested_track
    } else {
        current_track.as_str()
    };
    let edge_id = edge_identity(edge, &rules.map);
    let edge_key = format!("{}|{}", edge_id, track);
    let occupants = snapshot
        .entities
        .iter()
        .filter(|(_, other)| {
            alive(other)
                && !string(other, "edge_to").is_empty()
                && string(other, "track") == track
                && edge_for_nodes(
                    &rules.map,
                    &string(other, "node"),
                    &string(other, "edge_to"),
                )
                .is_some_and(|occupied_edge| edge_identity(occupied_edge, &rules.map) == edge_id)
        })
        .map(|(id, other)| movement_group(id, other))
        .collect::<BTreeSet<_>>();
    let group = movement_group(actor_id, entity);
    // An incumbent keeps its local lane reservation until it exits.
    if occupants.contains(&group) {
        reservations.insert((edge_key, group));
        return true;
    }
    let capacity = param(rules, "bridge_crossing_capacity", 1).max(1) as usize;
    let already_reserved = reservations
        .iter()
        .filter(|(reserved_edge, _)| reserved_edge == &edge_key)
        .count();
    if !reservations.contains(&(edge_key.clone(), group.clone()))
        && occupants.len() + already_reserved >= capacity
    {
        return false;
    }
    reservations.insert((edge_key, group));
    true
}

fn movement_group(id: &EntityId, entity: &EntityState) -> String {
    let squad = string(entity, "squad");
    if entity.entity_type.as_str() == "hero" && !squad.is_empty() {
        format!("{:?}:{}", entity.owner, squad)
    } else {
        id.to_string()
    }
}
fn exit_allowed(
    entity: &EntityState,
    from: &str,
    to: &str,
    snapshot: &WorldState,
    map: &BattleMap,
) -> bool {
    let Some(side) = entity.owner else {
        return true;
    };
    let enemy = match side {
        CombatantSide::Attacker => "B",
        CombatantSide::Defender => "A",
    };
    let blocked = snapshot.entities.values().any(|other| {
        alive(other)
            && matches!(other.entity_type.as_str(), "hero" | "minion")
            && other.owner
                == Some(match side {
                    CombatantSide::Attacker => CombatantSide::Defender,
                    CombatantSide::Defender => CombatantSide::Attacker,
                })
            && string(other, "node") == from
            && string(other, "edge_to").is_empty()
    });
    !blocked
        || map
            .nodes
            .get(to)
            .map(|node| node.allegiance != enemy)
            .unwrap_or(true)
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
            track: if entity.entity_type.as_str() == "minion" {
                "CENTER".into()
            } else {
                preferred_track(entity)
            },
            terrain_milli: None,
            budget: speed.checked_mul(CAPACITY_SCALE).unwrap_or(0),
        };
    }

    let members = hero_cohort(entity_id, entity, world);
    let Some((_, leader)) = members.first() else {
        return MovementIntent {
            goal: string(entity, "goal"),
            track: preferred_track(entity),
            terrain_milli: Some(1_000),
            budget: 0,
        };
    };
    let goal = string(leader, "goal");
    let size = members.len().clamp(1, 5);
    let track = preferred_track(leader);
    let placeholder = MovementIntent {
        goal: goal.clone(),
        track: track.clone(),
        terrain_milli: None,
        budget: 0,
    };
    let generic_squad = members
        .iter()
        .any(|(_, candidate)| has_skill_effect(candidate, rules, SkillEffect::TerrainAdaptation));
    // Adaptation is evaluated for each carrier on its own current/next edge
    // before the cohort's slowest corrected speed. Specialist effects stay personal.
    let base_budget = members
        .iter()
        .map(|(_, member)| {
            let mut budget = hero_base_speed_budget(member, tick);
            let region = if !string(member, "edge_to").is_empty() {
                edge_for_nodes(
                    &rules.map,
                    &string(member, "node"),
                    &string(member, "edge_to"),
                )
                .map(|edge| edge.region.clone())
                .unwrap_or_else(|| "lane".into())
            } else {
                route_for_entity(
                    member,
                    &rules.map,
                    &string(member, "node"),
                    &goal,
                    world,
                    &placeholder,
                    rules,
                    tick,
                )
                .and_then(|route| {
                    route
                        .get(1)
                        .and_then(|next| edge_for_nodes(&rules.map, &route[0], next))
                })
                .map(|edge| edge.region.clone())
                .unwrap_or_else(|| "lane".into())
            };
            let terrain_factor = hero_terrain_factor(member, rules, &region, generic_squad);
            budget = budget.saturating_mul(i128::from(terrain_factor.max(0))) / 1_000;
            if size == 1 && has_skill_effect(member, rules, SkillEffect::SoloMobility) {
                budget = budget.saturating_mul(i128::from(
                    param(rules, "solo_high_mobility_milli", 1_100).max(0),
                )) / 1_000;
            }
            budget
        })
        .min()
        .unwrap_or(0);
    let vision_milli = leader
        .owner
        .filter(|side| crate::next_vision::minion_vision(world, rules, *side, leader))
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

    MovementIntent {
        goal,
        track,
        terrain_milli: Some(1_000),
        budget,
    }
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

fn is_jungle_region(region: &str) -> bool {
    matches!(region, "jungle" | "jungle_camp" | "river_ford" | "forest")
}

fn hero_terrain_factor(
    hero: &EntityState,
    rules: &NextRules,
    region: &str,
    generic_squad: bool,
) -> i64 {
    if !is_jungle_region(region) {
        return 1_000;
    }
    if has_skill_effect(hero, rules, SkillEffect::JungleSpecialist) {
        param(rules, "specialist_jungle_adapt_milli", 1_000)
    } else if generic_squad || has_skill_effect(hero, rules, SkillEffect::TerrainAdaptation) {
        param(rules, "generic_squad_terrain_adapt_milli", 900)
    } else {
        param(rules, "terrain_jungle_speed_milli", 800)
    }
}

fn has_skill_effect(hero: &EntityState, rules: &NextRules, effect: SkillEffect) -> bool {
    let catalog = string(hero, "catalog_id");
    let learned = match hero.fields.get(&"skills".into()) {
        Some(DomainValue::List(skills)) => skills
            .iter()
            .filter_map(|skill| match skill {
                DomainValue::String(id) => Some(id.clone()),
                _ => None,
            })
            .collect::<BTreeSet<_>>(),
        _ => BTreeSet::new(),
    };
    rules
        .heroes
        .iter()
        .find(|definition| definition.id == catalog)
        .is_some_and(|definition| {
            definition
                .skills
                .iter()
                .any(|skill| skill.passive && learned.contains(&skill.id) && skill.effect == effect)
        })
}

fn preferred_track(entity: &EntityState) -> String {
    let goal = string(entity, "track_goal");
    if !goal.is_empty() {
        return normalized_track(&goal);
    }
    let current = string(entity, "track");
    if matches!(current.as_str(), "LEFT" | "RIGHT") {
        current
    } else {
        "LEFT".into()
    }
}

fn normalized_track(track: &str) -> String {
    match track.to_ascii_uppercase().as_str() {
        "LEFT" => "LEFT",
        "RIGHT" => "RIGHT",
        "CENTER" => "CENTER",
        _ => "LEFT",
    }
    .into()
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

fn terrain_speed_milli(rules: &NextRules, edge: &MapEdge, movement: &MovementIntent) -> i64 {
    if let Some(terrain) = movement.terrain_milli {
        return terrain;
    }
    match edge.region.as_str() {
        "river_ford" => param(rules, "terrain_jungle_speed_milli", 800),
        "jungle_camp" => param(rules, "terrain_jungle_speed_milli", 800),
        "forest" => param(rules, "terrain_forest_speed_milli", 800),
        "jungle" => param(rules, "terrain_jungle_speed_milli", 800),
        _ => param(rules, "terrain_lane_speed_milli", 1_000),
    }
}

fn route_for_entity(
    entity: &EntityState,
    map: &BattleMap,
    from: &str,
    to: &str,
    snapshot: &WorldState,
    movement: &MovementIntent,
    rules: &NextRules,
    tick: u32,
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
                        if legal
                            && route
                                .get(1)
                                .map(|next| {
                                    !known_enemy_blocks_exit(
                                        entity, from, next, snapshot, rules, map,
                                    )
                                })
                                .unwrap_or(true)
                        {
                            return Some(route);
                        }
                        return None;
                    }
                    return None;
                }
            }
        }
    }
    // Tactical route evaluation uses only the actor's authorized observation
    // for enemy blockers and bridge status. Full S[t] is used separately for
    // the mandatory exit legality check at the instant of leaving a node.
    let mut legal_map = map.clone();
    for edge in &mut legal_map.edges {
        let next = if edge.from == from {
            Some(edge.to.as_str())
        } else if edge.to == from {
            Some(edge.from.as_str())
        } else {
            None
        };
        if next
            .map(|next| known_enemy_blocks_exit(entity, from, next, snapshot, rules, map))
            .unwrap_or(false)
        {
            edge.blocked = true;
        }
        if is_bridge(edge)
            && entity.entity_type.as_str() == "hero"
            && !edge_allows_track(entity, movement, edge, snapshot)
        {
            edge.blocked = true;
        }
    }
    path_by_travel_time(&legal_map, entity, from, to, snapshot, rules, tick)
}

const ROUTE_TIME_SCALE: i128 = 1_000;
fn path_by_travel_time(
    map: &BattleMap,
    actor: &EntityState,
    from: &str,
    to: &str,
    world: &WorldState,
    rules: &NextRules,
    tick: u32,
) -> Option<Vec<String>> {
    if !map.nodes.contains_key(from) || !map.nodes.contains_key(to) {
        return None;
    }
    if from == to {
        return Some(vec![from.to_owned()]);
    }
    let mut best = BTreeMap::<String, (i128, Vec<String>)>::new();
    let mut queue = BTreeSet::<(i128, Vec<String>, String)>::new();
    let initial = vec![from.to_owned()];
    best.insert(from.to_owned(), (0, initial.clone()));
    queue.insert((0, initial, from.to_owned()));
    while let Some((cost, route, node)) = queue.pop_first() {
        if best.get(&node) != Some(&(cost, route.clone())) {
            continue;
        }
        if node == to {
            return Some(route);
        }
        let mut outgoing = map
            .edges
            .iter()
            .filter(|edge| {
                !edge.blocked
                    && edge.length > 0
                    && edge.from != edge.to
                    && map.nodes.contains_key(&edge.from)
                    && map.nodes.contains_key(&edge.to)
                    && (edge.from == node || edge.to == node)
            })
            .collect::<Vec<_>>();
        outgoing.sort_by_key(|edge| (edge.id.as_str(), edge.from.as_str(), edge.to.as_str()));
        for edge in outgoing {
            let next = if edge.from == node {
                &edge.to
            } else {
                &edge.from
            };
            let edge_cost = route_edge_cost(actor, edge, world, rules, tick);
            let Some(candidate_cost) = cost.checked_add(edge_cost) else {
                return None;
            };
            let mut candidate_route = route.clone();
            candidate_route.push(next.clone());
            let candidate = (candidate_cost, candidate_route.clone());
            if best
                .get(next)
                .map(|known| candidate < *known)
                .unwrap_or(true)
            {
                best.insert(next.clone(), candidate);
                queue.insert((candidate_cost, candidate_route, next.clone()));
            }
        }
    }
    None
}

fn route_edge_cost(
    actor: &EntityState,
    edge: &MapEdge,
    world: &WorldState,
    rules: &NextRules,
    tick: u32,
) -> i128 {
    let base_speed = route_speed(actor, world, rules, tick).max(1);
    let terrain = if actor.entity_type.as_str() == "hero" {
        let actor_id = world
            .entities
            .iter()
            .find(|(_, value)| *value == actor)
            .map(|(id, _)| id.clone());
        let members = actor_id
            .as_ref()
            .map(|id| hero_cohort(id, actor, world))
            .unwrap_or_default();
        let generic_squad = members
            .iter()
            .any(|(_, member)| has_skill_effect(member, rules, SkillEffect::TerrainAdaptation));
        members
            .iter()
            .map(|(_, member)| hero_terrain_factor(member, rules, &edge.region, generic_squad))
            .min()
            .unwrap_or_else(|| default_terrain_milli(&edge.region, rules))
    } else {
        default_terrain_milli(&edge.region, rules)
    }
    .max(1);
    let distance_cost = i128::from(edge.length)
        .saturating_mul(ROUTE_TIME_SCALE)
        .saturating_mul(1_000)
        .checked_div(i128::from(base_speed).saturating_mul(i128::from(terrain)))
        .unwrap_or(i128::MAX);
    let state = if is_bridge(edge) {
        observed_bridge_state(actor.owner, &edge.bridge_site, world, rules)
    } else {
        String::new()
    };
    let ford = edge.ford || (is_bridge(edge) && state == "destroyed");
    let ford_delay = if ford {
        i128::from(param(rules, "ford_extra_ticks", 24).max(0)).saturating_mul(ROUTE_TIME_SCALE)
    } else {
        0
    };
    let queue_delay = if is_bridge(edge) {
        known_bridge_queue(actor, edge, world, rules).saturating_mul(ROUTE_TIME_SCALE)
    } else {
        0
    };
    distance_cost
        .saturating_add(ford_delay)
        .saturating_add(queue_delay)
}

fn route_speed(actor: &EntityState, world: &WorldState, rules: &NextRules, tick: u32) -> i128 {
    if actor.entity_type.as_str() != "hero" {
        return i128::from(int(actor, "speed").max(1));
    }
    let actor_id = world
        .entities
        .iter()
        .find(|(_, value)| *value == actor)
        .map(|(id, _)| id.clone());
    let members = actor_id
        .as_ref()
        .map(|id| hero_cohort(id, actor, world))
        .unwrap_or_else(|| vec![(EntityId::from("route"), actor.clone())]);
    let mut speed = members
        .iter()
        .map(|(_, member)| hero_base_speed_budget(member, tick) / (RATE_SCALE * RATE_SCALE))
        .min()
        .unwrap_or(1)
        .max(1);
    let size = members.len().clamp(1, 5);
    let leader = members.first().map(|(_, member)| member).unwrap_or(actor);
    if let Some(side) = leader.owner {
        if crate::next_vision::minion_vision(world, rules, side, leader) {
            speed = speed.saturating_mul(i128::from(
                param(rules, "minion_vision_speed_milli", 1_200).max(0),
            )) / 1_000;
        }
    }
    speed = speed.saturating_mul(i128::from(squad_speed_milli(size, rules).max(0))) / 1_000;
    if size == 1 && has_skill_effect(leader, rules, SkillEffect::SoloMobility) {
        speed = speed.saturating_mul(i128::from(
            param(rules, "solo_high_mobility_milli", 1_100).max(0),
        )) / 1_000;
    }
    speed.max(1)
}

fn default_terrain_milli(region: &str, rules: &NextRules) -> i64 {
    match region {
        "jungle" | "jungle_camp" | "river_ford" => param(rules, "terrain_jungle_speed_milli", 800),
        "forest" => param(rules, "terrain_forest_speed_milli", 800),
        _ => param(rules, "terrain_lane_speed_milli", 1_000),
    }
}

fn visible_team(
    entity: &EntityState,
    world: &WorldState,
    rules: &NextRules,
) -> Option<senkei_model::WorldStateView> {
    entity
        .owner
        .map(|side| crate::next_vision::team_view(world, rules, side))
}
fn known_enemy_blocks_exit(
    entity: &EntityState,
    from: &str,
    to: &str,
    world: &WorldState,
    rules: &NextRules,
    map: &BattleMap,
) -> bool {
    let Some(side) = entity.owner else {
        return false;
    };
    let enemy_allegiance = match side {
        CombatantSide::Attacker => "B",
        CombatantSide::Defender => "A",
    };
    if map.nodes.get(to).map(|node| node.allegiance.as_str()) != Some(enemy_allegiance) {
        return false;
    }
    let Some(view) = visible_team(entity, world, rules) else {
        return false;
    };
    let enemy_side = match side {
        CombatantSide::Attacker => CombatantSide::Defender,
        CombatantSide::Defender => CombatantSide::Attacker,
    };
    view.entities.values().any(|visible| {
        matches!(visible.entity_type.as_str(), "hero" | "minion")
            && visible.owner == Some(enemy_side)
            && visible
                .fields
                .get(&"node".into())
                .is_some_and(|v| v == &DomainValue::String(from.to_owned()))
            && visible
                .fields
                .get(&"edge_to".into())
                .is_some_and(|v| v == &DomainValue::String(String::new()))
            && visible
                .fields
                .get(&"hp".into())
                .is_some_and(|v| matches!(v,DomainValue::Integer(hp) if *hp > 0))
    })
}
fn observed_bridge_state(
    side: Option<CombatantSide>,
    site: &str,
    world: &WorldState,
    rules: &NextRules,
) -> String {
    let Some(side) = side else {
        return "normal".into();
    };
    let view = crate::next_vision::team_view(world, rules, side);
    view.entities
        .values()
        .find(|entity| {
            entity.entity_type.as_str() == "bridge"
                && entity.fields.get(&"site".into()) == Some(&DomainValue::String(site.into()))
        })
        .and_then(|entity| entity.fields.get(&"bridge_state".into()))
        .and_then(|value| match value {
            DomainValue::String(value) => Some(value.clone()),
            DomainValue::Enum(value) => Some(value.as_str().to_owned()),
            _ => None,
        })
        .unwrap_or_else(|| "normal".into())
}
fn known_bridge_queue(
    actor: &EntityState,
    edge: &MapEdge,
    world: &WorldState,
    rules: &NextRules,
) -> i128 {
    let Some(side) = actor.owner else {
        return 0;
    };
    let view = crate::next_vision::team_view(world, rules, side);
    let state = observed_bridge_state(Some(side), &edge.bridge_site, world, rules);
    let chosen_track = if state == "expanded" {
        preferred_track(actor)
    } else {
        "CENTER".into()
    };
    let occupants = view
        .entities
        .iter()
        .filter(|(_, entity)| {
            matches!(entity.entity_type.as_str(), "hero" | "minion")
                && entity
                    .fields
                    .get(&"node".into())
                    .and_then(|v| match v {
                        DomainValue::String(v) => Some(v.as_str()),
                        _ => None,
                    })
                    .zip(entity.fields.get(&"edge_to".into()).and_then(|v| match v {
                        DomainValue::String(v) => Some(v.as_str()),
                        _ => None,
                    }))
                    .zip(entity.fields.get(&"track".into()).and_then(|v| match v {
                        DomainValue::String(v) => Some(v.as_str()),
                        _ => None,
                    }))
                    .is_some_and(|((from, to), track)| {
                        track == chosen_track
                            && edge_for_nodes(&rules.map, from, to).is_some_and(|occupied| {
                                edge_identity(occupied, &rules.map)
                                    == edge_identity(edge, &rules.map)
                            })
                    })
        })
        .map(|(id, entity)| {
            if entity.entity_type.as_str() == "hero" {
                if let Some(DomainValue::String(squad)) = entity.fields.get(&"squad".into()) {
                    if !squad.is_empty() {
                        return format!("squad:{:?}:{squad}", entity.owner);
                    }
                }
            }
            format!("entity:{id}")
        })
        .collect::<BTreeSet<_>>();
    let count = occupants.len() as i128;
    if count == 0 {
        return 0;
    }
    let capacity = param(rules, "bridge_crossing_capacity", 1).max(1) as i128;
    let delay = param(rules, "bridge_known_occupancy_delay_ticks", 24).max(0) as i128;
    ((count + capacity - 1) / capacity).saturating_mul(delay)
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
    use senkei_model::{BattleMap, EntityId, MapNode, NextRules, UnitStats, Version};
    use std::collections::BTreeMap;

    fn skill(effect: SkillEffect) -> senkei_model::SkillDefinition {
        senkei_model::SkillDefinition {
            id: "adapt".into(),
            name: "Adapt".into(),
            passive: true,
            unlock_level: 1,
            prerequisites: Vec::new(),
            cooldown: 0,
            cost: 0,
            range: 0,
            target: "self".into(),
            effect,
            power: 0,
            duration: 0,
        }
    }

    fn hero_definition(id: &str, effect: SkillEffect) -> senkei_model::HeroDefinition {
        let base = UnitStats {
            hp: 100,
            attack: 10,
            defense: 0,
            speed: 100,
            range: 20,
            attack_interval: 1,
            vision: 0,
        };
        senkei_model::HeroDefinition {
            id: id.into(),
            name: id.into(),
            placement: "front".into(),
            role: "scout".into(),
            trait_id: id.into(),
            appearance_key: id.into(),
            stats: base.clone(),
            growth: base,
            skills: vec![skill(effect)],
            skill_paths: BTreeMap::new(),
            synergy: BTreeMap::new(),
        }
    }

    fn node(region: &str, x: i64) -> (String, MapNode) {
        (
            region.to_owned(),
            MapNode {
                x,
                y: 0,
                region: "lane".into(),
                ..Default::default()
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
            ("lane_cross_track_ticks".into(), 3),
            ("track_occupancy_radius_wu".into(), 20),
            ("track_occupancy_max_ticks".into(), 30),
            ("ford_extra_ticks".into(), 24),
            ("bridge_crossing_capacity".into(), 1),
            ("generic_squad_terrain_adapt_milli".into(), 900),
            ("specialist_jungle_adapt_milli".into(), 1_000),
            ("solo_high_mobility_milli".into(), 1_100),
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
        assert_eq!(string(hero, "edge_to"), "");
        assert_eq!(int(hero, "edge_progress"), 0);
        assert_eq!((int(hero, "x"), int(hero, "y")), (10, 0));
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
    fn logical_node_arrival_uses_canonical_node_position() {
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
        assert_eq!((int(hero, "x"), int(hero, "y")), (10, 0));
    }

    #[test]
    fn movement_stops_at_each_node_without_spending_surplus_on_next_edge() {
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
        assert_eq!(string(mover, "edge_to"), "");
        assert_eq!(int(mover, "edge_progress"), 0);
        assert_eq!(int(mover, "moved_tick"), 2);
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
    fn endpoint_is_a_full_tick_domain_even_when_speed_covers_multiple_edges() {
        let map = test_map(vec![
            edge("a", "b", 5, "lane", false),
            edge("b", "c", 5, "lane", false),
        ]);
        let mut world = WorldState::default();
        world.entities.insert(
            id("h"),
            entity("hero", Some(CombatantSide::Attacker), 100, "a", "c"),
        );
        let config = rules(map);
        advance(&mut world, &config, 0);
        let at_node = &world.entities[&id("h")];
        assert_eq!(
            (string(at_node, "node"), string(at_node, "edge_to")),
            ("b".into(), "".into())
        );
        assert_eq!(int(at_node, "moved_tick"), 1);
        advance(&mut world, &config, 1);
        let on_second_edge = &world.entities[&id("h")];
        // The second action opportunity may reach the next node, but the
        // first opportunity ended on b and could not bypass its combat domain.
        assert_eq!(string(on_second_edge, "node"), "c");
        assert_eq!(string(on_second_edge, "edge_to"), "");
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
            route_for_entity(
                &minion,
                &map,
                "a",
                "c",
                &WorldState::default(),
                &MovementIntent {
                    goal: "c".into(),
                    track: "CENTER".into(),
                    terrain_milli: None,
                    budget: 1
                },
                &rules(test_map(vec![])),
                1
            ),
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

    #[test]
    fn routes_use_travel_time_and_adaptation_instead_of_shortest_distance() {
        let map = test_map(vec![
            edge("a", "c", 650, "jungle", false),
            edge("a", "b", 400, "lane", false),
            edge("b", "c", 400, "lane", false),
        ]);
        let mut config = rules(map.clone());
        let mut ordinary = entity("hero", Some(CombatantSide::Attacker), 100, "a", "c");
        set_string(&mut ordinary, "squad", "");
        let mut world = WorldState::default();
        world.entities.insert(id("ordinary"), ordinary.clone());
        let selected = route_for_entity(
            &ordinary,
            &map,
            "a",
            "c",
            &world,
            &movement_intent(&id("ordinary"), &ordinary, &world, &config, 0),
            &config,
            0,
        )
        .unwrap();
        assert_eq!(selected, vec!["a", "b", "c"]); // 800 lane vs 812.5 ordinary Jungle
        assert_eq!(
            path(&map, "a", "c"),
            Some(vec!["a", "c"].into_iter().map(str::to_owned).collect())
        );

        config
            .heroes
            .push(hero_definition("expert", SkillEffect::JungleSpecialist));
        let mut specialist = entity("hero", Some(CombatantSide::Attacker), 100, "a", "c");
        set_string(&mut specialist, "squad", "");
        set_string(&mut specialist, "catalog_id", "expert");
        specialist.fields.insert(
            "skills".into(),
            DomainValue::List(vec![DomainValue::String("adapt".into())]),
        );
        let mut skilled_world = WorldState::default();
        skilled_world
            .entities
            .insert(id("expert"), specialist.clone());
        let route = route_for_entity(
            &specialist,
            &map,
            "a",
            "c",
            &skilled_world,
            &movement_intent(&id("expert"), &specialist, &skilled_world, &config, 0),
            &config,
            0,
        )
        .unwrap();
        assert_eq!(route, vec!["a", "c"]); // 650 specialist Jungle vs 800 lane
    }

    #[test]
    fn generic_adaptation_applies_to_the_whole_cohort_but_specialist_stays_individual() {
        let jungle_map = test_map(vec![edge("a", "b", 1_000, "jungle_camp", false)]);
        let mut config = rules(jungle_map);
        config
            .heroes
            .push(hero_definition("scout", SkillEffect::TerrainAdaptation));
        config
            .heroes
            .push(hero_definition("expert", SkillEffect::JungleSpecialist));

        let mut generic = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_string(&mut generic, "catalog_id", "scout");
        generic.fields.insert(
            "skills".into(),
            DomainValue::List(vec![DomainValue::String("adapt".into())]),
        );
        let mut plain = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_string(&mut plain, "catalog_id", "scout");
        let mut squad = WorldState::default();
        squad.entities.insert(id("a_generic"), generic.clone());
        squad.entities.insert(id("b_plain"), plain.clone());
        advance(&mut squad, &config, 1);
        assert_eq!(int(&squad.entities[&id("a_generic")], "edge_progress"), 85);
        assert_eq!(int(&squad.entities[&id("b_plain")], "edge_progress"), 85);

        let mut expert = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_string(&mut expert, "catalog_id", "expert");
        expert.fields.insert(
            "skills".into(),
            DomainValue::List(vec![DomainValue::String("adapt".into())]),
        );
        let mut untrained = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_string(&mut untrained, "catalog_id", "expert");
        let mut mixed = WorldState::default();
        mixed.entities.insert(id("a_expert"), expert);
        mixed.entities.insert(id("b_untrained"), untrained);
        advance(&mut mixed, &config, 1);
        assert_eq!(int(&mixed.entities[&id("a_expert")], "edge_progress"), 76);
        assert_eq!(
            int(&mixed.entities[&id("b_untrained")], "edge_progress"),
            76
        );
    }

    #[test]
    fn solo_mobility_is_not_inherited_by_a_two_hero_squad() {
        let mut config = rules(test_map(vec![edge("a", "b", 1_000, "lane", false)]));
        config
            .heroes
            .push(hero_definition("scout", SkillEffect::SoloMobility));
        let mut runner = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_string(&mut runner, "catalog_id", "scout");
        runner.fields.insert(
            "skills".into(),
            DomainValue::List(vec![DomainValue::String("adapt".into())]),
        );
        let mut solo = WorldState::default();
        solo.entities.insert(id("solo"), runner.clone());
        advance(&mut solo, &config, 1);
        assert_eq!(int(&solo.entities[&id("solo")], "edge_progress"), 110);

        let mut member = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_string(&mut member, "catalog_id", "scout");
        let mut squad = WorldState::default();
        squad.entities.insert(id("a_runner"), runner);
        squad.entities.insert(id("b_plain"), member);
        advance(&mut squad, &config, 1);
        assert_eq!(int(&squad.entities[&id("a_runner")], "edge_progress"), 95);
        assert_eq!(int(&squad.entities[&id("b_plain")], "edge_progress"), 95);
    }

    #[test]
    fn node_exit_block_is_symmetric_and_only_uses_enemy_units() {
        let mut map = test_map(vec![
            edge("a", "b", 10, "lane", false),
            edge("a", "d", 11, "jungle", false),
            edge("d", "b", 11, "jungle", false),
        ]);
        map.nodes.get_mut("a").unwrap().allegiance = "A".into();
        map.nodes.get_mut("b").unwrap().allegiance = "B".into();
        map.nodes.get_mut("d").unwrap().allegiance = "N".into();
        let config = rules(map.clone());
        let mut actor = entity("hero", Some(CombatantSide::Attacker), 1, "a", "b");
        set_string(&mut actor, "squad", "");
        let enemy = entity("hero", Some(CombatantSide::Defender), 1, "a", "");
        let mut world = WorldState::default();
        world.entities.insert(id("actor"), actor.clone());
        world.entities.insert(id("enemy"), enemy);
        assert!(!exit_allowed(&actor, "a", "b", &world, &map));
        assert!(exit_allowed(&actor, "a", "d", &world, &map));
        // The route avoids only the visible enemy. Here it is visible at the same node.
        let route = route_for_entity(
            &actor,
            &map,
            "a",
            "b",
            &world,
            &movement_intent(&id("actor"), &actor, &world, &config, 0),
            &config,
            0,
        )
        .unwrap();
        assert_eq!(route, vec!["a", "d", "b"]);

        let mut reverse = entity("hero", Some(CombatantSide::Defender), 1, "b", "");
        set_string(&mut reverse, "squad", "");
        let attacker = entity("hero", Some(CombatantSide::Attacker), 1, "b", "");
        let mut reverse_world = WorldState::default();
        reverse_world.entities.insert(id("r"), reverse.clone());
        reverse_world.entities.insert(id("a_enemy"), attacker);
        assert!(!exit_allowed(&reverse, "b", "a", &reverse_world, &map));

        let monster = entity("monster", None, 1, "a", "");
        let mut monster_world = WorldState::default();
        monster_world.entities.insert(id("actor"), actor.clone());
        monster_world.entities.insert(id("monster"), monster);
        assert!(exit_allowed(&actor, "a", "b", &monster_world, &map));
    }

    #[test]
    fn bridge_capacity_is_per_edge_and_incumbents_keep_their_slot() {
        let mut edge = edge("a", "b", 100, "lane", false);
        edge.id = "bridge.top".into();
        edge.bridge_site = "TOP".into();
        let map = test_map(vec![edge]);
        let config = rules(map);
        let mut world = WorldState::default();
        let mut first = entity("hero", Some(CombatantSide::Attacker), 5, "a", "b");
        set_string(&mut first, "squad", "");
        let mut second = entity("hero", Some(CombatantSide::Attacker), 5, "a", "b");
        set_string(&mut second, "squad", "");
        world.entities.insert(id("a_hero"), first);
        world.entities.insert(id("b_hero"), second);
        advance(&mut world, &config, 1);
        assert_eq!(string(&world.entities[&id("a_hero")], "edge_to"), "b");
        assert_eq!(string(&world.entities[&id("b_hero")], "edge_to"), "");
        advance(&mut world, &config, 2);
        assert_eq!(string(&world.entities[&id("a_hero")], "edge_to"), "b");
        assert_eq!(int(&world.entities[&id("a_hero")], "edge_progress"), 10);
        assert_eq!(string(&world.entities[&id("b_hero")], "edge_to"), "");
    }

    #[test]
    fn local_minion_center_occupancy_blocks_crossing_but_distant_traffic_does_not() {
        let map = test_map(vec![edge("a", "b", 1_000, "lane", false)]);
        let config = rules(map);
        let mut hero = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_string(&mut hero, "edge_to", "b");
        set_int(&mut hero, "edge_progress", 500);
        set_string(&mut hero, "track", "LEFT");
        set_string(&mut hero, "track_goal", "RIGHT");
        let mut minion = entity("minion", Some(CombatantSide::Attacker), 0, "a", "b");
        set_string(&mut minion, "edge_to", "b");
        set_int(&mut minion, "edge_progress", 500);
        set_string(&mut minion, "track", "CENTER");
        let mut world = WorldState::default();
        world.entities.insert(id("h"), hero);
        world.entities.insert(id("m"), minion);
        advance(&mut world, &config, 1);
        assert_eq!(int(&world.entities[&id("h")], "cross_remaining"), 0);
        set_int(
            world.entities.get_mut(&id("m")).unwrap(),
            "edge_progress",
            100,
        );
        advance(&mut world, &config, 2);
        assert_eq!(int(&world.entities[&id("h")], "cross_remaining"), 2);
        assert_eq!(string(&world.entities[&id("h")], "track"), "LEFT");
    }

    #[test]
    fn squad_members_share_a_local_track_crossing_reservation() {
        let map = test_map(vec![edge("a", "b", 1_000, "lane", false)]);
        let config = rules(map);
        let mut world = WorldState::default();
        for hero_id in ["hero-a", "hero-b"] {
            let mut hero = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
            set_string(&mut hero, "edge_to", "b");
            set_int(&mut hero, "edge_progress", 500);
            set_string(&mut hero, "track", "LEFT");
            set_string(&mut hero, "track_goal", "RIGHT");
            world.entities.insert(id(hero_id), hero);
        }
        advance(&mut world, &config, 1);
        for hero_id in ["hero-a", "hero-b"] {
            let hero = &world.entities[&id(hero_id)];
            assert_eq!(int(hero, "cross_remaining"), 2);
            assert_eq!(string(hero, "track"), "LEFT");
        }
    }

    #[test]
    fn ford_is_a_persistent_extra_time_state_even_if_bridge_is_rebuilt() {
        let mut crossing = edge("a", "b", 100, "lane", false);
        crossing.id = "bridge.top".into();
        crossing.bridge_site = "TOP".into();
        let map = test_map(vec![crossing]);
        let config = rules(map);
        let mut hero = entity("hero", Some(CombatantSide::Attacker), 100, "a", "b");
        set_string(&mut hero, "squad", "");
        let mut bridge = EntityState {
            entity_type: "bridge".into(),
            owner: None,
            fields: BTreeMap::new(),
        };
        set_string(&mut bridge, "site", "TOP");
        set_string(&mut bridge, "bridge_state", "destroyed");
        let mut world = WorldState::default();
        world.entities.insert(id("h"), hero);
        world.entities.insert(id("bridge.top"), bridge);
        advance(&mut world, &config, 1);
        assert_eq!(int(&world.entities[&id("h")], "ford_remaining"), 23);
        set_string(
            world.entities.get_mut(&id("bridge.top")).unwrap(),
            "bridge_state",
            "expanded",
        );
        advance(&mut world, &config, 2);
        assert_eq!(int(&world.entities[&id("h")], "edge_progress"), 0);
        assert_eq!(int(&world.entities[&id("h")], "ford_remaining"), 22);
    }

    #[test]
    fn normal_bridge_center_and_lateral_crossing_cannot_freeze_for_an_attack() {
        let mut crossing = edge("a", "b", 100, "lane", false);
        crossing.id = "bridge.top".into();
        crossing.bridge_site = "TOP".into();
        let config = rules(test_map(vec![crossing]));
        let mut mover = entity("hero", Some(CombatantSide::Attacker), 10, "a", "b");
        set_string(&mut mover, "edge_to", "b");
        set_int(&mut mover, "edge_progress", 50);
        set_string(&mut mover, "track", "CENTER");
        set_int(&mut mover, "range", 100);
        set_int(&mut mover, "attack_ready", 0);
        let mut target = entity("hero", Some(CombatantSide::Defender), 0, "a", "");
        set_string(&mut target, "edge_to", "b");
        set_int(&mut target, "edge_progress", 55);
        set_string(&mut target, "track", "CENTER");
        set_int(&mut target, "range", 100);
        set_int(&mut target, "attack_ready", 0);
        let mut bridge = EntityState {
            entity_type: "bridge".into(),
            owner: None,
            fields: BTreeMap::new(),
        };
        set_string(&mut bridge, "site", "TOP");
        set_string(&mut bridge, "bridge_state", "normal");
        let mut world = WorldState::default();
        world.entities.insert(id("mover"), mover);
        world.entities.insert(id("target"), target);
        world.entities.insert(id("bridge"), bridge);
        set_int(world.entities.get_mut(&id("mover")).unwrap(), "attack", 10);
        set_int(world.entities.get_mut(&id("mover")).unwrap(), "vision", 100);
        assert!(should_hold_for_attack(
            &id("mover"),
            &world.entities[&id("mover")],
            &world,
            &config,
            1,
        ));
        advance(&mut world, &config, 1);
        assert_eq!(int(&world.entities[&id("mover")], "edge_progress"), 60);
        assert_eq!(int(&world.entities[&id("mover")], "moved_tick"), 2);

        let mut lane = entity("hero", Some(CombatantSide::Attacker), 10, "a", "b");
        set_string(&mut lane, "edge_to", "b");
        set_int(&mut lane, "edge_progress", 50);
        set_string(&mut lane, "track", "LEFT");
        set_string(&mut lane, "track_goal", "RIGHT");
        set_int(&mut lane, "cross_remaining", 2);
        set_int(&mut lane, "range", 100);
        set_int(&mut lane, "attack", 10);
        set_int(&mut lane, "vision", 100);
        set_int(&mut lane, "attack_ready", 0);
        let mut lane_target = entity("hero", Some(CombatantSide::Defender), 0, "a", "");
        set_string(&mut lane_target, "edge_to", "b");
        set_int(&mut lane_target, "edge_progress", 55);
        set_string(&mut lane_target, "track", "RIGHT");
        set_int(&mut lane_target, "range", 100);
        set_int(&mut lane_target, "vision", 100);
        let mut cross_world = WorldState::default();
        cross_world.entities.insert(id("mover"), lane);
        cross_world.entities.insert(id("target"), lane_target);
        let lane_rules = rules(test_map(vec![edge("a", "b", 100, "lane", false)]));
        assert!(should_hold_for_attack(
            &id("mover"),
            &cross_world.entities[&id("mover")],
            &cross_world,
            &lane_rules,
            1,
        ));
        advance(&mut cross_world, &lane_rules, 1);
        assert_eq!(
            int(&cross_world.entities[&id("mover")], "cross_remaining"),
            1
        );
        assert_eq!(int(&cross_world.entities[&id("mover")], "moved_tick"), 2);
    }
}
