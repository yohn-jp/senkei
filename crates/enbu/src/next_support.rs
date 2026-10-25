//! Shared deterministic scalar access for finite battle primitives.
use senkei_model::*;
use std::collections::BTreeMap;
pub fn int(e: &EntityState, key: &str) -> i64 {
    match e.fields.get(&FieldId::from(key)) {
        Some(DomainValue::Integer(v)) => *v,
        _ => 0,
    }
}
pub fn string(e: &EntityState, key: &str) -> String {
    match e.fields.get(&FieldId::from(key)) {
        Some(DomainValue::String(v)) => v.clone(),
        Some(DomainValue::Enum(v)) => v.as_str().into(),
        _ => String::new(),
    }
}
pub fn set_int(e: &mut EntityState, key: &str, value: i64) {
    e.fields.insert(key.into(), DomainValue::Integer(value));
}
pub fn set_string(e: &mut EntityState, key: &str, value: impl Into<String>) {
    e.fields
        .insert(key.into(), DomainValue::String(value.into()));
}
pub fn alive(e: &EntityState) -> bool {
    int(e, "hp") > 0
}
pub fn param(r: &NextRules, key: &str, fallback: i64) -> i64 {
    r.parameters.get(key).copied().unwrap_or(fallback)
}
pub fn side_name(s: CombatantSide) -> &'static str {
    match s {
        CombatantSide::Attacker => "attacker",
        CombatantSide::Defender => "defender",
    }
}
pub fn enemy(s: CombatantSide) -> CombatantSide {
    match s {
        CombatantSide::Attacker => CombatantSide::Defender,
        CombatantSide::Defender => CombatantSide::Attacker,
    }
}
pub fn distance2(a: &EntityState, b: &EntityState) -> i128 {
    let dx = i128::from(int(a, "x")) - i128::from(int(b, "x"));
    let dy = i128::from(int(a, "y")) - i128::from(int(b, "y"));
    dx * dx + dy * dy
}
/// Logical combat distance. Presentation coordinates are intentionally ignored:
/// only actors in the same Node or on the same graph edge can engage.
pub fn combat_distance2(a: &EntityState, b: &EntityState, rules: &NextRules) -> Option<i128> {
    let a_node = string(a, "node");
    let a_to = string(a, "edge_to");
    let b_node = string(b, "node");
    let b_to = string(b, "edge_to");
    if a_to.is_empty() && b_to.is_empty() {
        return (a_node == b_node).then_some(0);
    }
    if a_to.is_empty() || b_to.is_empty() {
        return None;
    }
    let edge = rules.map.edges.iter().find(|edge| {
        (edge.from == a_node && edge.to == a_to) || (edge.to == a_node && edge.from == a_to)
    })?;
    if !((b_node == edge.from && b_to == edge.to) || (b_node == edge.to && b_to == edge.from)) {
        return None;
    }
    let a_progress = int(a, "edge_progress").clamp(0, edge.length);
    let b_progress = int(b, "edge_progress").clamp(0, edge.length);
    let a_canonical = if a_node == edge.from { a_progress } else { edge.length - a_progress };
    let b_canonical = if b_node == edge.from { b_progress } else { edge.length - b_progress };
    let dx = i128::from(a_canonical) - i128::from(b_canonical);
    let mut distance2 = dx * dx;
    if edge.region == "lane" && edge.bridge_site.is_empty() && !edge.ford {
        let offset = |entity: &EntityState| match string(entity, "track").as_str() {
            "LEFT" => -param(rules, "lane_track_offset_wu", 20),
            "RIGHT" => param(rules, "lane_track_offset_wu", 20),
            _ => 0,
        };
        let dy = i128::from(offset(a)) - i128::from(offset(b));
        distance2 = distance2.saturating_add(dy * dy);
    }
    Some(distance2)
}
/// Graph-geodesic distance for vision, independent of renderer coordinates.
/// Unlike combat range, observers may see through a chain of adjacent graph
/// edges according to their logical range.
pub fn world_distance2(a: &EntityState, b: &EntityState, rules: &NextRules) -> Option<i128> {
    if param(rules, "vision_graph_metric", 1) != 1 || param(rules, "vision_occlusion_enabled", 0) != 0 {
        return None;
    }
    if let Some(distance) = combat_distance2(a, b, rules) {
        return Some(distance);
    }
    let endpoints = |entity: &EntityState| -> Option<Vec<(String, i64)>> {
        let from = string(entity, "node");
        let to = string(entity, "edge_to");
        if to.is_empty() {
            return rules.map.nodes.contains_key(&from).then_some(vec![(from, 0)]);
        }
        let edge = rules.map.edges.iter().find(|edge| {
            (edge.from == from && edge.to == to) || (edge.to == from && edge.from == to)
        })?;
        let progress = int(entity, "edge_progress").clamp(0, edge.length);
        Some(vec![(from, progress), (to, edge.length - progress)])
    };
    let a_points = endpoints(a)?;
    let b_points = endpoints(b)?;
    graph_distance_between(&rules.map, &a_points, &b_points)
        .map(|distance| i128::from(distance) * i128::from(distance))
}

fn graph_distance_between(map: &BattleMap, from: &[(String, i64)], to: &[(String, i64)]) -> Option<i64> {
    let destinations: BTreeMap<_, _> = to.iter().filter(|(node, _)| map.nodes.contains_key(node))
        .map(|(node, offset)| (node.clone(), *offset)).collect();
    if destinations.is_empty() {
        return None;
    }
    let mut queue = BTreeMap::<(i64, String), ()>::new();
    let mut best = BTreeMap::<String, i64>::new();
    for (node, offset) in from.iter().filter(|(node, _)| map.nodes.contains_key(node)) {
        let distance = (*offset).max(0);
        if best.get(node).map_or(true, |known| distance < *known) {
            best.insert(node.clone(), distance);
            queue.insert((distance, node.clone()), ());
        }
    }
    while let Some(((distance, node), ())) = queue.pop_first() {
        if best.get(&node).copied() != Some(distance) {
            continue;
        }
        if let Some(offset) = destinations.get(&node) {
            return distance.checked_add(*offset);
        }
        for edge in &map.edges {
            // Traversal blockages do not imply vision occlusion.
            if edge.length <= 0 || edge.from == edge.to {
                continue;
            }
            let neighbor = if edge.from == node {
                &edge.to
            } else if edge.to == node {
                &edge.from
            } else {
                continue;
            };
            if !map.nodes.contains_key(neighbor) {
                continue;
            }
            let candidate = distance.checked_add(edge.length)?;
            if best.get(neighbor).map_or(true, |known| candidate < *known) {
                best.insert(neighbor.clone(), candidate);
                queue.insert((candidate, neighbor.clone()), ());
            }
        }
    }
    None
}
pub fn in_combat_range(a: &EntityState, b: &EntityState, range: i64, rules: &NextRules) -> bool {
    combat_distance2(a, b, rules).is_some_and(|distance| distance <= i128::from(range.max(0)).pow(2))
}
/// Ford damage state is explicit for broken constructed bridges and can also
/// be derived from permanent Jungle ford edges. Navigation owns and advances
/// `ford_remaining`, so a destroyed/rebuilt bridge never relocates an actor.
pub fn is_ford_position(entity: &EntityState, rules: &NextRules) -> bool {
    if int(entity, "ford_active") > 0 || int(entity, "ford_remaining") > 0 {
        return true;
    }
    let from = string(entity, "node");
    let to = string(entity, "edge_to");
    if from.is_empty() || to.is_empty() {
        return false;
    }
    rules.map.edges.iter().any(|edge| {
        edge.ford
            && ((edge.from == from && edge.to == to) || (edge.to == from && edge.from == to))
            && int(entity, "edge_progress") > 0
            && int(entity, "edge_progress") < edge.length
    })
}
pub fn unit(
    kind: &str,
    owner: Option<CombatantSide>,
    stats: &UnitStats,
    node: &str,
    rules: &NextRules,
) -> EntityState {
    let mut e = EntityState {
        entity_type: kind.into(),
        owner,
        fields: BTreeMap::new(),
    };
    for (k, v) in [
        ("hp", stats.hp),
        ("max_hp", stats.hp),
        ("attack", stats.attack),
        ("defense", stats.defense),
        ("speed", stats.speed),
        ("range", stats.range),
        ("attack_interval", stats.attack_interval),
        ("vision", stats.vision),
        ("attack_ready", 0),
    ] {
        set_int(&mut e, k, v);
    }
    place(&mut e, node, rules);
    e
}
pub fn place(e: &mut EntityState, node: &str, r: &NextRules) {
    set_string(e, "node", node);
    set_string(e, "edge_to", "");
    set_int(e, "edge_progress", 0);
    if let Some(n) = r.map.nodes.get(node) {
        set_int(e, "x", n.x);
        set_int(e, "y", n.y);
    }
}
pub fn event(
    id: &str,
    entity: Option<EntityId>,
    payload: BTreeMap<FieldId, DomainValue>,
) -> PresentationEvent {
    PresentationEvent {
        event: id.into(),
        entity,
        payload,
    }
}
