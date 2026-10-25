//! Shared deterministic scalar access for finite battle primitives.
use senkei_model::*;
use std::cell::RefCell;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
struct VisionGraphKey {
    nodes: Vec<String>,
    edges: Vec<(String, String, i64)>,
}

#[derive(Clone, Debug)]
struct VisionGraphDistances {
    node_index: BTreeMap<String, usize>,
    distances: Vec<Vec<Option<i64>>>,
}

thread_local! {
    /// Non-authoritative, thread-local memo for the last complete vision graph.
    /// Equality checks the graph contents on every call, so matching map IDs or
    /// allocation addresses can never return stale distances.
    static VISION_GRAPH_CACHE: RefCell<Option<(VisionGraphKey, VisionGraphDistances)>> = RefCell::new(None);
}

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
    if !valid_graph_position(a, rules) || !valid_graph_position(b, rules) {
        return None;
    }
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
    if edge.length <= 0 {
        return None;
    }
    let a_progress = int(a, "edge_progress");
    let b_progress = int(b, "edge_progress");
    let a_canonical = if a_node == edge.from { a_progress } else { edge.length - a_progress };
    let b_canonical = if b_node == edge.from { b_progress } else { edge.length - b_progress };
    let dx = i128::from(a_canonical) - i128::from(b_canonical);
    let mut distance2 = dx * dx;
    if edge.region == "lane" && edge.bridge_site.is_empty() && !edge.ford {
        let offset = |entity: &EntityState| match if int(entity, "cross_remaining") > 0 { "CENTER".into() } else { string(entity, "track") }.as_str() {
            "LEFT" => -param(rules, "lane_track_offset_wu", 20),
            "RIGHT" => param(rules, "lane_track_offset_wu", 20),
            _ => 0,
        };
        let dy = i128::from(offset(a)) - i128::from(offset(b));
        distance2 = distance2.saturating_add(dy * dy);
    }
    Some(distance2)
}

fn valid_graph_position(entity: &EntityState, rules: &NextRules) -> bool {
    let node = string(entity, "node");
    let edge_to = string(entity, "edge_to");
    if node.is_empty() || !rules.map.nodes.contains_key(&node) {
        return false;
    }
    let progress = int(entity, "edge_progress");
    if edge_to.is_empty() {
        // Node positions have no progress; stale edge-progress payloads are
        // ignored once the graph position says Node.
        return true;
    }
    if !rules.map.nodes.contains_key(&edge_to) {
        return false;
    }
    rules.map.edges.iter().any(|edge| {
        edge.length > 0
            && progress >= 0
            && progress <= edge.length
            && ((edge.from == node && edge.to == edge_to)
                || (edge.to == node && edge.from == edge_to))
    })
}
/// Graph-geodesic distance for vision, independent of renderer coordinates.
/// Unlike combat range, observers may see through a chain of adjacent graph
/// edges according to their logical range.
pub fn world_distance2(a: &EntityState, b: &EntityState, rules: &NextRules) -> Option<i128> {
    if param(rules, "vision_graph_metric", 1) != 1 || param(rules, "vision_occlusion_enabled", 0) != 0 {
        return None;
    }
    if !valid_graph_position(a, rules) || !valid_graph_position(b, rules) {
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
    graph_distance_cached(&rules.map, &a_points, &b_points)
        .map(|distance| i128::from(distance) * i128::from(distance))
}

fn vision_graph_key(map: &BattleMap) -> VisionGraphKey {
    let nodes = map.nodes.keys().cloned().collect();
    let edges: Vec<_> = map.edges.iter().map(|edge| {
        let (from, to) = if edge.from <= edge.to {
            (edge.from.clone(), edge.to.clone())
        } else {
            (edge.to.clone(), edge.from.clone())
        };
        (from, to, edge.length)
    }).collect();
    VisionGraphKey { nodes, edges }
}

// Compare borrowed graph content on cache hits. Reordering edges may rebuild
// this non-authoritative memo, but can never change its computed distances.
fn vision_graph_matches(key: &VisionGraphKey, map: &BattleMap) -> bool {
    key.nodes.len() == map.nodes.len()
        && key.nodes.iter().zip(map.nodes.keys()).all(|(cached, node)| cached == node)
        && key.edges.len() == map.edges.len()
        && key.edges.iter().zip(&map.edges).all(|((cached_from, cached_to, length), edge)| {
            let (from, to) = if edge.from <= edge.to { (&edge.from, &edge.to) } else { (&edge.to, &edge.from) };
            cached_from == from && cached_to == to && *length == edge.length
        })
}

fn graph_distance_cached(map: &BattleMap, from: &[(String, i64)], to: &[(String, i64)]) -> Option<i64> {
    VISION_GRAPH_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.as_ref().map_or(true, |(cached_key, _)| !vision_graph_matches(cached_key, map)) {
            *cache = Some((vision_graph_key(map), build_vision_graph_distances(map)));
        }
        let (_, graph) = cache.as_ref()?;
        graph_distance_between(graph, from, to)
    })
}

fn build_vision_graph_distances(map: &BattleMap) -> VisionGraphDistances {
    let node_index: BTreeMap<_, _> = map.nodes.keys().cloned().enumerate()
        .map(|(index, node)| (node, index)).collect();
    let count = node_index.len();
    let mut distances = vec![vec![None; count]; count];
    for index in 0..count {
        distances[index][index] = Some(0);
    }
    for edge in &map.edges {
        // Traversal blockages do not imply vision occlusion.
        if edge.length <= 0 || edge.from == edge.to {
            continue;
        }
        let (Some(&from), Some(&to)) = (node_index.get(&edge.from), node_index.get(&edge.to)) else {
            continue;
        };
        for (source, destination) in [(from, to), (to, from)] {
            if distances[source][destination].map_or(true, |known| edge.length < known) {
                distances[source][destination] = Some(edge.length);
            }
        }
    }

    // A bounded all-pairs matrix makes repeated vision queries O(1) per
    // endpoint pair instead of running a fresh graph traversal for every
    // visible-source/target pair.
    for pivot in 0..count {
        for source in 0..count {
            let Some(to_pivot) = distances[source][pivot] else {
                continue;
            };
            for destination in 0..count {
                let Some(from_pivot) = distances[pivot][destination] else {
                    continue;
                };
                let Some(candidate) = to_pivot.checked_add(from_pivot) else {
                    continue;
                };
                if distances[source][destination].map_or(true, |known| candidate < known) {
                    distances[source][destination] = Some(candidate);
                }
            }
        }
    }
    VisionGraphDistances { node_index, distances }
}

fn graph_distance_between(graph: &VisionGraphDistances, from: &[(String, i64)], to: &[(String, i64)]) -> Option<i64> {
    let mut best = None;
    for (source_node, source_offset) in from {
        let Some(&source_index) = graph.node_index.get(source_node) else {
            continue;
        };
        for (destination_node, destination_offset) in to {
            let Some(&destination_index) = graph.node_index.get(destination_node) else {
                continue;
            };
            let Some(path) = graph.distances[source_index][destination_index] else {
                continue;
            };
            let Some(candidate) = source_offset.max(&0).checked_add(path)
                .and_then(|distance| distance.checked_add((*destination_offset).max(0))) else {
                continue;
            };
            best = Some(best.map_or(candidate, |known: i64| known.min(candidate)));
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_distance_checks_all_weighted_target_edge_endpoints_and_rejects_bad_positions() {
        let nodes = ["a", "b", "c", "d", "x"].into_iter().map(|id| {
            (id.to_owned(), MapNode { x: 0, y: 0, region: "lane".into(), ..Default::default() })
        }).collect();
        let edge = |id: &str, from: &str, to: &str, length| MapEdge {
            id: id.into(), from: from.into(), to: to.into(), length,
            region: "lane".into(), blocked: false, ..Default::default()
        };
        let rules = NextRules {
            mechanics_version: crate::Version::new(1, 0, 0),
            world_identity: None,
            map: BattleMap {
                id: "weighted-endpoints".into(),
                world_identity: None,
                nodes,
                edges: vec![
                    edge("ab", "a", "b", 100),
                    edge("bc", "b", "c", 10),
                    edge("cd", "c", "d", 100),
                    edge("bx", "b", "x", 10),
                    edge("xd", "x", "d", 10),
                ],
                lanes: BTreeMap::new(),
                attacker_base: "a".into(),
                defender_base: "d".into(),
                towers: Vec::new(),
            },
            heroes: Vec::new(),
            minions: Vec::new(),
            monsters: Vec::new(),
            camps: Vec::new(),
            parameters: BTreeMap::from([
                ("vision_graph_metric".into(), 1),
                ("vision_occlusion_enabled".into(), 0),
            ]),
        };
        let on_edge = |from: &str, to: &str, progress| {
            let mut entity = EntityState { entity_type: "hero".into(), owner: None, fields: BTreeMap::new() };
            set_string(&mut entity, "node", from);
            set_string(&mut entity, "edge_to", to);
            set_int(&mut entity, "edge_progress", progress);
            entity
        };
        let source = on_edge("a", "b", 50);
        // The nearer target endpoint is C (distance 60 + offset 90 = 150),
        // while D is reached later but has only 10 WU remaining (70 + 10 = 80).
        let target = on_edge("c", "d", 90);
        assert_eq!(world_distance2(&source, &target, &rules), Some(80 * 80));

        // Cache identity is the full graph contents, not the map ID. Mutating
        // edge weights under the same ID must rebuild the all-pairs matrix.
        let mut changed_graph_rules = rules.clone();
        for edge in &mut changed_graph_rules.map.edges {
            if edge.id == "bx" || edge.id == "xd" {
                edge.length = 200;
            }
        }
        assert_eq!(changed_graph_rules.map.id, rules.map.id);
        assert_eq!(world_distance2(&source, &target, &changed_graph_rules), Some(150 * 150));

        let unpositioned = on_edge("", "", 0);
        assert_eq!(combat_distance2(&unpositioned, &unpositioned, &rules), None);
        assert_eq!(world_distance2(&unpositioned, &unpositioned, &rules), None);

        let unknown_node = on_edge("unknown", "", 0);
        assert_eq!(combat_distance2(&unknown_node, &unknown_node, &rules), None);
        assert_eq!(world_distance2(&unknown_node, &unknown_node, &rules), None);

        let dangling_edge = on_edge("a", "missing", 25);
        assert_eq!(combat_distance2(&dangling_edge, &dangling_edge, &rules), None);
        assert_eq!(world_distance2(&dangling_edge, &source, &rules), None);

        let malformed_progress = on_edge("a", "b", 101);
        assert_eq!(combat_distance2(&malformed_progress, &source, &rules), None);
        assert_eq!(world_distance2(&malformed_progress, &source, &rules), None);

        // The transition snapshot can show a destroyed site before navigation
        // has had a chance to mark this incumbent as ford_active.
        let mut bridge_rules = rules.clone();
        bridge_rules.map.edges[0].bridge_site = "TOP".into();
        let mut bridge = EntityState { entity_type: "bridge".into(), owner: None, fields: BTreeMap::new() };
        set_string(&mut bridge, "bridge_state", "destroyed");
        let mut snapshot = WorldState::default();
        snapshot.entities.insert("bridge.TOP".into(), bridge);
        let incumbent = on_edge("a", "b", 50);
        assert!(is_ford_position(&incumbent, &snapshot, &bridge_rules));
    }
}
pub fn in_combat_range(a: &EntityState, b: &EntityState, range: i64, rules: &NextRules) -> bool {
    combat_distance2(a, b, rules).is_some_and(|distance| distance <= i128::from(range.max(0)).pow(2))
}
/// Ford damage state is explicit for broken constructed bridges and can also
/// be derived from permanent Jungle ford edges. Navigation owns and advances
/// `ford_remaining`, so a destroyed/rebuilt bridge never relocates an actor.
pub fn is_ford_position(entity: &EntityState, snapshot: &WorldState, rules: &NextRules) -> bool {
    if int(entity, "ford_active") > 0 || int(entity, "ford_remaining") > 0 {
        return true;
    }
    let from = string(entity, "node");
    let to = string(entity, "edge_to");
    if from.is_empty() || to.is_empty() {
        return false;
    }
    rules.map.edges.iter().any(|edge| {
        let interior = int(entity, "edge_progress") > 0
            && int(entity, "edge_progress") < edge.length;
        if !interior || !((edge.from == from && edge.to == to) || (edge.to == from && edge.from == to)) {
            return false;
        }
        if edge.ford {
            return true;
        }
        if edge.bridge_site.is_empty() {
            return false;
        }
        let bridge_id = EntityId::from(format!("bridge.{}", edge.bridge_site));
        snapshot.entities.get(&bridge_id).is_some_and(|bridge| {
            bridge.entity_type.as_str() == "bridge"
                && string(bridge, "bridge_state") == "destroyed"
        })
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
    for key in ["track", "track_cross_from", "track_cross_to"] { set_string(e, key, ""); }
    for key in ["cross_remaining", "ford_remaining", "ford_active", "track_wait_ticks", "action_lock_until", "prepared_action_tick", "moved_tick"] { set_int(e, key, 0); }
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
