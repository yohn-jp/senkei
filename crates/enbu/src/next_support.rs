//! Shared deterministic scalar access for finite battle primitives.
use senkei_model::*;
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::marker::PhantomData;
use std::rc::Rc;

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

/// A match-scoped structural edge index. The first authored edge is retained
/// for canonical combat distance and graph endpoint projection; separately,
/// the longest *positive* parallel edge certifies valid progress in
/// valid_graph_position. This distinction exactly matches the reference
/// any-edge validator and first-edge distance selector.
#[derive(Clone, Copy, Debug)]
struct IndexedEdge {
    first_index: usize,
    longest_positive: i64,
}

#[derive(Default)]
struct ScopedTopology {
    adjacency: BTreeMap<String, BTreeMap<String, IndexedEdge>>,
}

impl ScopedTopology {
    fn build(map: &BattleMap) -> Self {
        let mut topology = Self::default();
        for (index, edge) in map.edges.iter().enumerate() {
            for (from, to) in [(&edge.from, &edge.to), (&edge.to, &edge.from)] {
                let value = topology.adjacency.entry(from.clone())
                    .or_default().entry(to.clone()).or_insert(IndexedEdge {
                        first_index: index,
                        longest_positive: 0,
                    });
                value.longest_positive = value.longest_positive.max(edge.length.max(0));
            }
        }
        topology
    }

    fn edge(&self, from: &str, to: &str) -> Option<IndexedEdge> {
        self.adjacency.get(from).and_then(|edges| edges.get(to)).copied()
    }
}

/// None => no map scope (use Reference); Some(None) => scoped proof that no
/// authored edge exists. Thus a missing edge never triggers an O(E) scan.
fn scoped_edge(map: &BattleMap, from: &str, to: &str)
    -> Option<Option<IndexedEdge>>
{
    let stamp = GRAPH_SCOPE_ACTIVE.with(|active| active.get()).filter(|stamp| {
        stamp.map_address == map as *const BattleMap as usize
    })?;
    Some(GRAPH_TOPOLOGY_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.as_ref().is_none_or(|(previous, _)| *previous != stamp) {
            *cache = Some((stamp, ScopedTopology::build(map)));
        }
        #[cfg(test)]
        GRAPH_TOPOLOGY_LOOKUPS.with(|counter|
            counter.set(counter.get().saturating_add(1)));
        cache.as_ref().and_then(|(_, topology)| topology.edge(from, to))
    }))
}

fn canonical_edge<'a>(map: &'a BattleMap, from: &str, to: &str) -> Option<&'a MapEdge> {
    match scoped_edge(map, from, to) {
        Some(index) => index.and_then(|entry| map.edges.get(entry.first_index)),
        None => map.edges.iter().find(|edge| {
            (edge.from == from && edge.to == to)
                || (edge.to == from && edge.from == to)
        }),
    }
}


/// A trust token is valid only while an immutable BattleMap is borrowed by
/// the *synchronous* Enbu match runner. It is never a digest or a map ID.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct GraphScopeStamp {
    epoch: u64,
    map_address: usize,
}

thread_local! {
    /// Outside an explicit match scope, every lookup still validates the
    /// complete graph contents, including edits under an unchanged map ID.
    static VISION_GRAPH_CACHE:
        RefCell<Option<(VisionGraphKey, VisionGraphDistances, Option<GraphScopeStamp>)>> =
        RefCell::new(None);
    static GRAPH_TOPOLOGY_CACHE:
        RefCell<Option<(GraphScopeStamp, ScopedTopology)>> = RefCell::new(None);
    #[cfg(test)]
    static GRAPH_TOPOLOGY_LOOKUPS: Cell<u64> = const { Cell::new(0) };
    static GRAPH_SCOPE_ACTIVE: Cell<Option<GraphScopeStamp>> = const { Cell::new(None) };
    static GRAPH_SCOPE_SERIAL: Cell<u64> = const { Cell::new(0) };
    #[cfg(test)]
    static GRAPH_SCOPE_REUSE: Cell<u64> = const { Cell::new(0) };
}

/// Guarantees map identity and lifetime without changing the public game
/// schema or holding an unsafe global reference. A nested simulation gets
/// another epoch; its parent's cache tag is invalidated until revalidated.
pub(crate) struct VisionGraphScope<'a> {
    previous: Option<GraphScopeStamp>,
    _map: PhantomData<&'a BattleMap>,
    _not_send: PhantomData<Rc<()>>,
}

impl<'a> VisionGraphScope<'a> {
    pub(crate) fn enter(map: &'a BattleMap) -> Self {
        let previous = GRAPH_SCOPE_ACTIVE.with(|current| {
            let prior = current.get();
            let epoch = GRAPH_SCOPE_SERIAL.with(|serial| {
                let next = serial.get().checked_add(1);
                if let Some(id) = next { serial.set(id); }
                next
            });
            current.set(epoch.map(|epoch| GraphScopeStamp {
                epoch, map_address: map as *const BattleMap as usize,
            }));
            prior
        });
        Self { previous, _map: PhantomData, _not_send: PhantomData }
    }
}

impl Drop for VisionGraphScope<'_> {
    fn drop(&mut self) {
        GRAPH_SCOPE_ACTIVE.with(|current| current.set(self.previous));
    }
}

// FieldId's public API stays unchanged. A borrowed-key impl on FieldId
// makes arbitrary existing BTreeMap::get(&"...".into()) expressions ambiguous
// throughout the RulePlan compiler. Instead specialize only the hot Enbu
// scalar accessors with static, canonical owned FieldId values.
fn cached_scalar_key(key: &str) -> Option<&'static FieldId> {
    use std::sync::LazyLock;
    macro_rules! cached_key {
        ($name:literal) => {{
            static KEY: LazyLock<FieldId> =
                LazyLock::new(|| FieldId::from($name));
            Some(&*KEY)
        }};
    }
    match key {
        "hp" => cached_key!("hp"),
        "goal" => cached_key!("goal"),
        "squad" => cached_key!("squad"),
        "node" => cached_key!("node"),
        "edge_to" => cached_key!("edge_to"),
        "edge_progress" => cached_key!("edge_progress"),
        "move_intent_tick" => cached_key!("move_intent_tick"),
        "track_intent_tick" => cached_key!("track_intent_tick"),
        "attack" => cached_key!("attack"),
        "attack_ready" => cached_key!("attack_ready"),
        "attack_interval" => cached_key!("attack_interval"),
        "range" => cached_key!("range"),
        "vision" => cached_key!("vision"),
        "track" => cached_key!("track"),
        "cross_remaining" => cached_key!("cross_remaining"),
        "speed" => cached_key!("speed"),
        "action_lock_until" => cached_key!("action_lock_until"),
        "moved_tick" => cached_key!("moved_tick"),
        "shield" => cached_key!("shield"),
        "max_hp" => cached_key!("max_hp"),
        "energy" => cached_key!("energy"),
        "maturity" => cached_key!("maturity"),
        "catalog_id" => cached_key!("catalog_id"),
        "slot_id" => cached_key!("slot_id"),
        "death_tick" => cached_key!("death_tick"),
        "respawn_at" => cached_key!("respawn_at"),
        "defense" => cached_key!("defense"),
        "xp" => cached_key!("xp"),
        "level" => cached_key!("level"),
        "x" => cached_key!("x"),
        "y" => cached_key!("y"),
        "reveal_until" => cached_key!("reveal_until"),
        "reveal_attacker_until" => cached_key!("reveal_attacker_until"),
        "reveal_defender_until" => cached_key!("reveal_defender_until"),
        "retreating" => cached_key!("retreating"),
        "ford_remaining" => cached_key!("ford_remaining"),
        "crossing" => cached_key!("crossing"),
        "formation" => cached_key!("formation"),
        "target" => cached_key!("target"),
        "attack_prepared_tick" => cached_key!("attack_prepared_tick"),
        "haste" => cached_key!("haste"),
        "haste_until" => cached_key!("haste_until"),
        "slow" => cached_key!("slow"),
        "slow_until" => cached_key!("slow_until"),
        "ford_active" => cached_key!("ford_active"),
        "max_energy" => cached_key!("max_energy"),
        "speed_bonus" => cached_key!("speed_bonus"),
        "energy_regen" => cached_key!("energy_regen"),
        "crossing_enter_tick" => cached_key!("crossing_enter_tick"),
        "progress" => cached_key!("progress"),
        "camp" => cached_key!("camp"),
        "region" => cached_key!("region"),
        "action_state" => cached_key!("action_state"),
        "prepared_action_tick" => cached_key!("prepared_action_tick"),
        _ => None,
    }
}

fn scalar_value<'a>(entity: &'a EntityState, key: &str) -> Option<&'a DomainValue> {
    if let Some(cached) = cached_scalar_key(key) {
        entity.fields.get(cached)
    } else {
        // Unknown/extended schema fields retain the original exact lookup.
        entity.fields.get(&FieldId::from(key))
    }
}

pub fn int(e: &EntityState, key: &str) -> i64 {
    match scalar_value(e, key) {
        Some(DomainValue::Integer(v)) => *v,
        _ => 0,
    }
}
/// Read a canonical scalar without cloning the payload. The owned string()
/// accessor stays available for callers that persist or mutate a value.
pub fn string_ref<'a>(e: &'a EntityState, key: &str) -> &'a str {
    match scalar_value(e, key) {
        Some(DomainValue::String(v)) => v.as_str(),
        Some(DomainValue::Enum(v)) => v.as_str(),
        _ => "",
    }
}
pub fn string(e: &EntityState, key: &str) -> String {
    string_ref(e, key).to_owned()
}
pub fn set_int(e: &mut EntityState, key: &str, value: i64) {
    // Most physical Tick writes update existing scalar fields. Preserve the
    // existing canonical key and avoid allocating an equal FieldId each Tick.
    if let Some(id) = cached_scalar_key(key) {
        if let Some(current) = e.fields.get_mut(id) {
            *current = DomainValue::Integer(value);
            return;
        }
    }
    e.fields.insert(key.into(), DomainValue::Integer(value));
}
pub fn set_string(e: &mut EntityState, key: &str, value: impl Into<String>) {
    let value = DomainValue::String(value.into());
    if let Some(id) = cached_scalar_key(key) {
        if let Some(current) = e.fields.get_mut(id) {
            *current = value;
            return;
        }
    }
    e.fields.insert(key.into(), value);
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
    let a_node = string_ref(a, "node");
    let a_to = string_ref(a, "edge_to");
    let b_node = string_ref(b, "node");
    let b_to = string_ref(b, "edge_to");
    if a_to.is_empty() && b_to.is_empty() {
        return (a_node == b_node).then_some(0);
    }
    if a_to.is_empty() || b_to.is_empty() {
        return None;
    }
    let edge = canonical_edge(&rules.map, a_node, a_to)?;
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
        let offset = |entity: &EntityState| match if int(entity, "cross_remaining") > 0 { "CENTER" } else { string_ref(entity, "track") } {
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
    let node = string_ref(entity, "node");
    let edge_to = string_ref(entity, "edge_to");
    if node.is_empty() || !rules.map.nodes.contains_key(node) {
        return false;
    }
    let progress = int(entity, "edge_progress");
    if edge_to.is_empty() {
        // Node positions have no progress; stale edge-progress payloads are
        // ignored once the graph position says Node.
        return true;
    }
    if !rules.map.nodes.contains_key(edge_to) {
        return false;
    }
    match scoped_edge(&rules.map, node, edge_to) {
        Some(Some(edge)) => progress >= 0 && progress <= edge.longest_positive
            && edge.longest_positive > 0,
        Some(None) => false,
        None => rules.map.edges.iter().any(|edge| {
            edge.length > 0
                && progress >= 0
                && progress <= edge.length
                && ((edge.from == node && edge.to == edge_to)
                    || (edge.to == node && edge.from == edge_to))
        }),
    }
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
    let a_points = graph_endpoints(a, rules)?;
    let b_points = graph_endpoints(b, rules)?;
    graph_distance_cached(&rules.map, a_points.as_slice(), b_points.as_slice())
        .map(|distance| i128::from(distance) * i128::from(distance))
}

/// A frozen observer's endpoint references remain valid through the entire
/// read-only geodesic query. No String copies are needed for edge endpoints.
/// Graph positions have at most two adjacent node endpoints. Keep these
/// borrowed stack entries inline instead of allocating a Vec for each
/// source/target vision-distance request.
struct GraphEndpoints<'a> {
    values: [(&'a str, i64); 2],
    count: usize,
}

impl<'a> GraphEndpoints<'a> {
    fn as_slice(&self) -> &[(&'a str, i64)] {
        &self.values[..self.count]
    }
}

fn graph_endpoints<'a>(entity: &'a EntityState, rules: &NextRules)
    -> Option<GraphEndpoints<'a>>
{
    let from = string_ref(entity, "node");
    let to = string_ref(entity, "edge_to");
    if to.is_empty() {
        return rules.map.nodes.contains_key(from).then_some(GraphEndpoints {
            values: [(from, 0), (from, 0)],
            count: 1,
        });
    }
    let edge = canonical_edge(&rules.map, from, to)?;
    let progress = int(entity, "edge_progress").clamp(0, edge.length);
    Some(GraphEndpoints {
        values: [(from, progress), (to, edge.length - progress)],
        count: 2,
    })
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

fn graph_distance_cached(map: &BattleMap, from: &[(&str, i64)], to: &[(&str, i64)]) -> Option<i64> {
    let trusted = GRAPH_SCOPE_ACTIVE.with(|active| active.get()).filter(|stamp| {
        stamp.map_address == map as *const BattleMap as usize
    });
    VISION_GRAPH_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let trusted_hit = trusted.is_some()
            && cache.as_ref().is_some_and(|(_, _, prior)| *prior == trusted);
        if !trusted_hit && cache.as_ref()
            .map_or(true, |(cached_key, _, _)| !vision_graph_matches(cached_key, map))
        {
            *cache = Some((vision_graph_key(map), build_vision_graph_distances(map), trusted));
        } else if let Some((_, _, stamp)) = cache.as_mut() {
            // Reuse is safe after exact contents validation even if this
            // is a different match, a nested scope, or an outside-scope call.
            *stamp = trusted;
        }
        #[cfg(test)]
        if trusted_hit {
            GRAPH_SCOPE_REUSE.with(|hits| hits.set(hits.get().saturating_add(1)));
        }
        let (_, graph, _) = cache.as_ref()?;
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

fn graph_distance_between(graph: &VisionGraphDistances, from: &[(&str, i64)], to: &[(&str, i64)]) -> Option<i64> {
    let mut best = None;
    for (source_node, source_offset) in from {
        let Some(&source_index) = graph.node_index.get(*source_node) else {
            continue;
        };
        for (destination_node, destination_offset) in to {
            let Some(&destination_index) = graph.node_index.get(*destination_node) else {
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
    fn scoped_topology_preserves_parallel_edge_and_invalid_position_reference() {
        let nodes = ["a", "b", "c"].into_iter()
            .map(|id| (id.to_owned(), MapNode::default())).collect();
        let edge = |id: &str, from: &str, to: &str, length| MapEdge {
            id: id.into(), from: from.into(), to: to.into(), length,
            region: "lane".into(), ..Default::default()
        };
        // The FIRST authored parallel edge is invalid, while the second
        // makes progress on the same a-b pair valid. The combat distance
        // reader must still select the first authored edge exactly as before.
        let rules = NextRules {
            projection_policy: None, minion_control: None,
            mechanics_version: Version::new(1, 0, 0),
            world_identity: None,
            map: BattleMap {
                id: "parallel-edges".into(), world_identity: None, world_projection: None,
                nodes,
                edges: vec![
                    edge("invalid-first", "a", "b", 0),
                    edge("valid-second", "b", "a", 10),
                    edge("neighbor", "b", "c", 7),
                ],
                lanes: BTreeMap::new(), attacker_base: "a".into(),
                defender_base: "c".into(), towers: Vec::new(),
            },
            heroes: Vec::new(), minions: Vec::new(), monsters: Vec::new(),
            camps: Vec::new(), parameters: BTreeMap::new(),
        };
        let position = |node: &str, to: &str, progress: i64| {
            let mut e = EntityState {
                entity_type: "hero".into(), owner: None, fields: BTreeMap::new(),
            };
            set_string(&mut e, "node", node);
            set_string(&mut e, "edge_to", to);
            set_int(&mut e, "edge_progress", progress);
            e
        };
        let positions = [
            position("a", "", 0),
            position("b", "", 0),
            position("a", "b", 3),
            position("b", "a", 4),
            position("a", "b", 11),
            position("c", "b", 7),
            position("c", "unknown", 1),
        ];
        let pairs = || positions.iter().flat_map(|source| positions.iter().map(move |target| {
            (combat_distance2(source, target, &rules),
             world_distance2(source, target, &rules))
        })).collect::<Vec<_>>();
        let reference = pairs();
        let before = GRAPH_TOPOLOGY_LOOKUPS.with(|lookups| lookups.get());
        {
            let _scope = VisionGraphScope::enter(&rules.map);
            assert_eq!(pairs(), reference,
                "scoped topology must match exact Reference for all pairs");
            assert!(GRAPH_TOPOLOGY_LOOKUPS.with(|lookups| lookups.get()) > before);
            // Cache reuse is not an accident of the first construction.
            assert_eq!(pairs(), reference);
        }
        assert_eq!(pairs(), reference,
            "ending a match must restore exact unspecialized graph handling");
    }

    #[test]
    fn scoped_graph_cache_skips_only_stable_immutable_map_checks() {
        let mut map = BattleMap {
            id: "scoped-cache-test".into(),
            world_identity: None,
            world_projection: None,
            nodes: BTreeMap::new(),
            edges: Vec::new(),
            lanes: BTreeMap::new(),
            attacker_base: "a".into(),
            defender_base: "c".into(),
            towers: Vec::new(),
        };
        map.nodes.insert("a".into(), MapNode::default());
        map.nodes.insert("b".into(), MapNode::default());
        map.nodes.insert("c".into(), MapNode::default());
        map.edges.push(MapEdge {
            id: "ab".into(), from: "a".into(), to: "b".into(), length: 10,
            region: "lane".into(), ..Default::default()
        });
        map.edges.push(MapEdge {
            id: "bc".into(), from: "b".into(), to: "c".into(), length: 20,
            region: "lane".into(), ..Default::default()
        });
        let make_points = || {
            let mut a = EntityState {
                entity_type: "hero".into(), owner: None, fields: BTreeMap::new(),
            };
            set_string(&mut a, "node", "a");
            let mut b = a.clone();
            set_string(&mut b, "node", "c");
            (a, b)
        };
        let (source, target) = make_points();
        let mut rules = NextRules {
            projection_policy: None,
            minion_control: None,
            mechanics_version: Version::new(1,0,0),
            world_identity: None,
            map,
            heroes: Vec::new(), minions: Vec::new(), monsters: Vec::new(),
            camps: Vec::new(), parameters: BTreeMap::new(),
        };
        // The NextRules map is fixed while its scope is alive; a second
        // independent map gets a new epoch even at a reused memory address.
        let mut changed = rules.clone();
        changed.map.edges[1].length = 100;
        let before = GRAPH_SCOPE_REUSE.with(|hits| hits.get());
        {
            let _scope = VisionGraphScope::enter(&rules.map);
            for _ in 0..6 {
                assert_eq!(world_distance2(&source, &target, &rules), Some(30 * 30));
            }
            assert!(GRAPH_SCOPE_REUSE.with(|hits| hits.get()) >= before + 5);
            {
                let _nested = VisionGraphScope::enter(&changed.map);
                for _ in 0..4 {
                    assert_eq!(world_distance2(&source, &target, &changed), Some(110 * 110));
                }
            }
            assert_eq!(world_distance2(&source, &target, &rules), Some(30 * 30));
        }
        rules.map.edges[1].length = 5;
        // Outside the scope, even changing weights under the same map ID
        // must invalidate the cache and return the real graph distance.
        assert_eq!(world_distance2(&source, &target, &rules), Some(15 * 15));
    }

    #[test]
    fn graph_endpoints_use_stack_storage_with_exact_node_and_edge_cardinality() {
        let mut node = EntityState {
            entity_type: "hero".into(), owner: None, fields: BTreeMap::new(),
        };
        set_string(&mut node, "node", "a");
        let mut edge = node.clone();
        set_string(&mut edge, "edge_to", "b");
        set_int(&mut edge, "edge_progress", 3);
        let rules = NextRules {
            projection_policy: None, minion_control: None,
            mechanics_version: Version::new(1, 0, 0),
            world_identity: None,
            map: BattleMap {
                id: "stack-endpoints".into(), world_identity: None, world_projection: None,
                nodes: ["a", "b"].into_iter().map(|id| (id.into(), MapNode::default())).collect(),
                edges: vec![MapEdge {
                    id: "ab".into(), from: "a".into(), to: "b".into(),
                    length: 10, region: "lane".into(), ..Default::default()
                }],
                lanes: BTreeMap::new(), attacker_base: "a".into(),
                defender_base: "b".into(), towers: Vec::new(),
            },
            heroes: Vec::new(), minions: Vec::new(), monsters: Vec::new(),
            camps: Vec::new(), parameters: BTreeMap::new(),
        };
        assert_eq!(graph_endpoints(&node, &rules).unwrap().as_slice(), &[("a", 0)]);
        assert_eq!(graph_endpoints(&edge, &rules).unwrap().as_slice(),
            &[("a", 3), ("b", 7)]);
        assert_eq!(world_distance2(&node, &edge, &rules), Some(3 * 3));
    }

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
            projection_policy: None,
            minion_control: None,
            mechanics_version: crate::Version::new(1, 0, 0),
            world_identity: None,
            map: BattleMap {
                id: "weighted-endpoints".into(),
                world_identity: None,
                world_projection: None,
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

    #[test]
    fn projected_crossing_interval_is_direction_symmetric_and_does_not_cover_the_edge() {
        let nodes = ["a", "b"].into_iter().map(|id| {
            (id.to_owned(), MapNode { x: 0, y: 0, region: "jungle".into(), ..Default::default() })
        }).collect();
        let mut edge = MapEdge {
            id: "ab".into(), from: "a".into(), to: "b".into(), length: 100,
            region: "jungle".into(), blocked: false, ford: true, ..Default::default()
        };
        let identity = WorldIdentityRef {
            world_id: "test-world".into(), schema_version: Version::new(1, 0, 0),
            compiler_version: Version::new(1, 0, 0),
            minimum_compiler: Version::new(1, 0, 0), maximum_compiler_exclusive: None,
            validation_profile_id: None, validation_profile_version: None,
            logic_digest: ContentDigest::new("a".repeat(64)), presentation_digest: ContentDigest::new("b".repeat(64)),
        };
        let facts = WorldEdgeFacts {
            directionality: "undirected".into(), class: "jungle_path".into(),
            tracks: vec![WorldTrackRange { id: "single".into(), kind: "single".into(), start_progress_wu: 0, end_progress_wu: 100 }],
            river_crossing: Some(WorldRiverCrossing {
                river_id: "river".into(), kind: "foot_ford".into(), bridge_site_id: None,
                start_progress_wu: 40, end_progress_wu: 60,
            }),
            terrain_profile_id: "terrain.jungle".into(), terrain_kind: "jungle".into(), observation_semantics: "open".into(),
        };
        let mut rules = NextRules {
            projection_policy: None,
            minion_control: None,
            mechanics_version: Version::new(1, 0, 0), world_identity: Some(identity.clone()),
            map: BattleMap {
                id: "interval-test".into(), world_identity: Some(identity.clone()),
                world_projection: Some(BattleMapWorldProjection {
                    schema_version: Version::new(1, 0, 0), source_identity: identity,
                    node_ids: ["a".to_owned(), "b".to_owned()].into_iter().collect(),
                    edge_facts: BTreeMap::from([("ab".into(), facts)]), bridge_sites: BTreeMap::new(),
                    presentation_artifact: CanonicalPresentationWorldArtifact { schema_version: Version::new(1, 0, 0), content: serde_json::json!({}) },
                }),
                nodes, edges: vec![edge.clone()], lanes: BTreeMap::new(),
                attacker_base: "a".into(), defender_base: "b".into(), towers: Vec::new(),
            },
            heroes: Vec::new(), minions: Vec::new(), monsters: Vec::new(), camps: Vec::new(), parameters: BTreeMap::new(),
        };
        let position = |from: &str, to: &str, progress| {
            let mut entity = EntityState { entity_type: "hero".into(), owner: None, fields: BTreeMap::new() };
            set_string(&mut entity, "node", from);
            set_string(&mut entity, "edge_to", to);
            set_int(&mut entity, "edge_progress", progress);
            entity
        };
        for (from, to, progress, expected) in [
            ("a", "b", 39, false), ("a", "b", 40, true), ("a", "b", 60, true), ("a", "b", 61, false),
            ("b", "a", 39, false), ("b", "a", 40, true), ("b", "a", 60, true), ("b", "a", 61, false),
        ] {
            assert_eq!(river_crossing_at(&position(from, to, progress), &edge, &rules).is_some(), expected,
                "crossing occupancy for {from}->{to} at local progress {progress}");
            assert_eq!(is_ford_position(&position(from, to, progress), &WorldState::default(), &rules), expected);
        }
        rules.map.world_projection = None;
        edge.ford = true;
        assert!(occupies_crossing(&position("a", "b", 1), &edge, &rules), "legacy whole-edge flag remains compatible");
    }
}
pub fn in_combat_range(a: &EntityState, b: &EntityState, range: i64, rules: &NextRules) -> bool {
    combat_distance2(a, b, rules).is_some_and(|distance| distance <= i128::from(range.max(0)).pow(2))
}
/// Ford damage state is explicit for broken constructed bridges and can also
/// be derived from permanent Jungle ford edges. Navigation owns and advances
/// `ford_remaining`, so a destroyed/rebuilt bridge never relocates an actor.
pub fn is_ford_position(entity: &EntityState, snapshot: &WorldState, rules: &NextRules) -> bool {
    let from = string(entity, "node");
    let to = string(entity, "edge_to");
    if from.is_empty() || to.is_empty() {
        return false;
    }
    rules.map.edges.iter().any(|edge| {
        if !((edge.from == from && edge.to == to) || (edge.to == from && edge.from == to)) {
            return false;
        }
        if rules.map.world_projection.is_none() {
            let progress = int(entity, "edge_progress");
            let interior = progress > 0 && progress < edge.length;
            if !interior { return false; }
            if edge.ford { return true; }
            if edge.bridge_site.is_empty() { return false; }
            let bridge_id = EntityId::from(format!("bridge.{}", edge.bridge_site));
            return snapshot.entities.get(&bridge_id).is_some_and(|bridge| {
                bridge.entity_type.as_str() == "bridge" && string(bridge, "bridge_state") == "destroyed"
            });
        }
        let crossing = river_crossing_at(entity, edge, rules);
        if crossing.is_some_and(|crossing| crossing.kind == "foot_ford") {
            return true;
        }
        if crossing.is_some() && !edge.bridge_site.is_empty() {
            let bridge_id = EntityId::from(format!("bridge.{}", edge.bridge_site));
            if snapshot.entities.get(&bridge_id).is_some_and(|bridge| {
                bridge.entity_type.as_str() == "bridge" && string(bridge, "bridge_state") == "destroyed"
            }) {
                return true;
            }
        }
        if int(entity, "ford_active") <= 0 && int(entity, "ford_remaining") <= 0 {
            return false;
        }
        if edge.bridge_site.is_empty() || crossing.is_none() { return false; }
        let bridge_id = EntityId::from(format!("bridge.{}", edge.bridge_site));
        let destroyed = snapshot.entities.get(&bridge_id).is_some_and(|bridge| {
            bridge.entity_type.as_str() == "bridge" && string(bridge, "bridge_state") == "destroyed"
        });
        destroyed || int(entity, "ford_active") > 0 || int(entity, "ford_remaining") > 0
    })
}

/// Return the canonical river-crossing fact only while the entity occupies
/// its authored progress interval. World intervals use progress from MapEdge.from;
/// reverse traversal maps progress through `length - local_progress`.
pub fn river_crossing_at<'a>(
    entity: &EntityState,
    edge: &MapEdge,
    rules: &'a NextRules,
) -> Option<&'a WorldRiverCrossing> {
    let progress = if string(entity, "node") == edge.from {
        int(entity, "edge_progress")
    } else if string(entity, "node") == edge.to {
        edge.length.saturating_sub(int(entity, "edge_progress"))
    } else {
        return None;
    };
    if let Some(projection) = &rules.map.world_projection {
        let crossing = projection.edge_facts.get(&edge.id)?.river_crossing.as_ref()?;
        (progress >= crossing.start_progress_wu as i64
            && progress <= crossing.end_progress_wu as i64)
            .then_some(crossing)
    } else if edge.ford {
        None
    } else if !edge.bridge_site.is_empty() {
        None
    } else {
        None
    }
}

/// `None` projection preserves the pre-projection runtime convention in which
/// bridge/ford flags describe the whole edge.
pub fn occupies_crossing(entity: &EntityState, edge: &MapEdge, rules: &NextRules) -> bool {
    if rules.map.world_projection.is_none() {
        return edge.ford || !edge.bridge_site.is_empty();
    }
    river_crossing_at(entity, edge, rules).is_some()
}

pub fn is_foot_ford_at(entity: &EntityState, edge: &MapEdge, rules: &NextRules) -> bool {
    if rules.map.world_projection.is_none() { return edge.ford; }
    river_crossing_at(entity, edge, rules).is_some_and(|crossing| crossing.kind == "foot_ford")
}

pub fn world_track_covers(edge: &MapEdge, progress: i64, track: &str, rules: &NextRules) -> bool {
    let Some(projection) = rules.map.world_projection.as_ref() else { return true };
    projection.edge_facts.get(&edge.id).is_some_and(|facts| facts.tracks.iter().any(|range| {
        range.kind.eq_ignore_ascii_case(track)
            && i64::try_from(range.start_progress_wu).is_ok_and(|start| progress >= start)
            && i64::try_from(range.end_progress_wu).is_ok_and(|end| progress <= end)
    }))
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

#[cfg(test)]
mod borrowed_scalar_tests {
    use super::*;
    #[test]
    fn scalar_key_cache_matches_arbitrary_field_ids_without_schema_changes() {
        let mut e = EntityState {
            entity_type: "hero".into(), owner: None, fields: BTreeMap::new(),
        };
        for key in ["hp", "attack_ready", "goal", "future_extension"] {
            e.fields.insert(FieldId::from(key), DomainValue::Integer(23));
            assert_eq!(int(&e, key), 23);
            assert_eq!(scalar_value(&e, key), e.fields.get(&FieldId::from(key)));
        }
    }

    #[test]
    fn cached_scalar_writes_match_original_btree_insert_on_existing_and_new_fields() {
        let mut reference = EntityState {
            entity_type: "hero".into(), owner: None, fields: BTreeMap::new(),
        };
        let mut optimized = reference.clone();
        for (key, value) in [
            ("hp", 100_i64), ("hp", 80), ("energy", 2),
            ("energy", 5), ("future_extension", 9),
            ("future_extension", 12),
        ] {
            reference.fields.insert(FieldId::from(key), DomainValue::Integer(value));
            set_int(&mut optimized, key, value);
            assert_eq!(optimized, reference);
        }
        for (key, value) in [
            ("goal", "a"), ("goal", "b"),
            ("catalog_id", "hero-001"), ("catalog_id", "hero-002"),
            ("future_text", "a"), ("future_text", "b"),
        ] {
            reference.fields.insert(FieldId::from(key), DomainValue::String(value.into()));
            set_string(&mut optimized, key, value);
            assert_eq!(optimized, reference);
        }
        // Replacing an existing field with a different DomainValue kind is
        // semantically identical to BTreeMap::insert.
        reference.fields.insert("hp".into(), DomainValue::String("unknown".into()));
        set_string(&mut optimized, "hp", "unknown");
        assert_eq!(optimized, reference);
    }

    #[test]
    fn borrowed_string_matches_owned_for_all_scalar_representations() {
        let mut entity = EntityState {
            entity_type: "hero".into(),
            owner: None,
            fields: BTreeMap::new(),
        };
        entity.fields.insert("node".into(), DomainValue::String("lane-left".into()));
        entity.fields.insert("track".into(), DomainValue::Enum("CENTER".into()));
        entity.fields.insert("hp".into(), DomainValue::Integer(8));
        for key in ["node", "track", "hp", "missing"] {
            assert_eq!(string_ref(&entity, key), string(&entity, key));
        }
    }
}
