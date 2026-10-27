//! Side-authorized, renderer-facing Fog of War replay projection.
//!
//! Version 1 is stored at `ReplayFrame.visible_state.global_fields.fog` as a
//! `DomainValue::Record`. Node and edge masks are computed from Enbu's existing
//! logical visibility check. They describe graph samples only; visual terrain
//! does not add sight blockers. Hidden units disappear. Only previously observed
//! facilities may retain a timestamped allowlist of their last observed state.

use crate::next_vision;
use senkei_model::{CombatantSide, DomainValue, EntityId, EntityState, FieldId, NextRules, TypeId, WorldState};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const FOG_REPLAY_SCHEMA_VERSION: u32 = 1;
pub const FOG_GLOBAL_FIELD: &str = "fog";

/// Samples include both ends, uniformly in logical edge progress.
/// The renderer maps the sample indices across the authored presentation route.
pub const EDGE_SAMPLE_COUNT: usize = 9;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FogVisibility {
    Unexplored,
    Explored,
    Visible,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FacilitySide {
    Attacker,
    Defender,
    Neutral,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FacilityStateValue {
    Integer(i64),
    String(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LastKnownFacility {
    /// Replay-local pseudonym, independent from Enbu's private EntityId.
    pub id: String,
    /// Always `last_known`; this is an observation timestamp, not current state.
    pub state: String,
    pub kind: String,
    pub side: FacilitySide,
    /// Public static site key used to locate the remembered facility marker.
    pub site: String,
    pub last_seen_tick: u32,
    /// Only approved observed state fields are kept; no value is refreshed while hidden.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub facility_state: BTreeMap<String, FacilityStateValue>,
}

/// A single tick's side-specific visibility mask and remembered facilities.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FogReplayState {
    pub schema_version: u32,
    pub tick: u32,
    pub side: CombatantSide,
    pub nodes: BTreeMap<String, FogVisibility>,
    /// Nine samples in `MapEdge.from` → `MapEdge.to` logical progress order.
    pub edges: BTreeMap<String, Vec<FogVisibility>>,
    /// Facilities seen before but not currently visible. Units are never retained.
    pub facilities: Vec<LastKnownFacility>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct ProbePosition {
    node: String,
    edge: Option<(String, i64)>,
}

impl ProbePosition {
    fn node(node: &str) -> Self {
        Self {
            node: node.into(),
            edge: None,
        }
    }

    fn edge(from: &str, to: &str, progress: i64, length: i64, endpoint_aliasing: bool) -> Self {
        // For a valid positive-length edge, its endpoint probe has the same
        // graph-geodesic position as the corresponding node probe. Lane
        // endpoints stay distinct because same-edge visibility can include a
        // lateral track offset that node-to-edge visibility does not.
        if endpoint_aliasing && length > 0 && progress == 0 {
            return Self::node(from);
        }
        if endpoint_aliasing && length > 0 && progress == length {
            return Self::node(to);
        }
        Self {
            node: from.into(),
            edge: Some((to.into(), progress)),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct FogHistory {
    explored_nodes: BTreeSet<String>,
    explored_edges: BTreeSet<(String, usize)>,
    /// Private keys remain inside Enbu. Only the generated facility serial exits.
    facilities: BTreeMap<EntityId, RememberedFacility>,
    next_facility: u64,
}

#[derive(Clone, Debug)]
struct RememberedFacility {
    id: String,
    kind: String,
    side: FacilitySide,
    site: String,
    last_seen_tick: u32,
    facility_state: BTreeMap<String, FacilityStateValue>,
}

impl FogHistory {
    /// Observe this tick through the existing Enbu visibility predicate.
    /// Call once for every emitted owner frame, in ascending Replay tick order.
    pub fn observe(
        &mut self,
        world: &WorldState,
        rules: &NextRules,
        side: CombatantSide,
        tick: u32,
    ) -> FogReplayState {
        let vision_sources = next_vision::vision_sources(world, rules, side);
        // Route endpoint samples coincide with node probes. Reuse only the
        // boolean probe result; history remains tracked independently for each
        // node and edge sample below.
        let mut probe_visibility = BTreeMap::new();
        let mut nodes = BTreeMap::new();
        for (node_id, node) in &rules.map.nodes {
            let probe = node_probe(node_id, node.x, node.y);
            let visible = *probe_visibility
                .entry(ProbePosition::node(node_id))
                .or_insert_with(|| {
                    next_vision::visible_from_sources(&vision_sources, rules, side, &probe)
                });
            let state = if visible {
                self.explored_nodes.insert(node_id.clone());
                FogVisibility::Visible
            } else if self.explored_nodes.contains(node_id) {
                FogVisibility::Explored
            } else {
                FogVisibility::Unexplored
            };
            nodes.insert(node_id.clone(), state);
        }

        let mut edges = BTreeMap::new();
        for edge in &rules.map.edges {
            let edge_id = if edge.id.is_empty() {
                format!("{}-{}", edge.from, edge.to)
            } else {
                edge.id.clone()
            };
            let mut samples = Vec::with_capacity(EDGE_SAMPLE_COUNT);
            for sample in 0..EDGE_SAMPLE_COUNT {
                let progress =
                    edge.length.saturating_mul(sample as i64) / (EDGE_SAMPLE_COUNT as i64 - 1);
                let probe = edge_probe(&edge.from, &edge.to, progress);
                let visible = edge.length >= 0
                    && *probe_visibility
                        .entry(ProbePosition::edge(
                            &edge.from,
                            &edge.to,
                            progress,
                            edge.length,
                            edge.region != "lane",
                        ))
                        .or_insert_with(|| {
                            next_vision::visible_from_sources(&vision_sources, rules, side, &probe)
                        });
                let state = if visible {
                    self.explored_edges.insert((edge_id.clone(), sample));
                    FogVisibility::Visible
                } else if self.explored_edges.contains(&(edge_id.clone(), sample)) {
                    FogVisibility::Explored
                } else {
                    FogVisibility::Unexplored
                };
                samples.push(state);
            }
            edges.insert(edge_id, samples);
        }

        let mut currently_visible_facilities = BTreeSet::new();
        for (entity_id, entity) in &world.entities {
            if !is_facility(&entity.entity_type) {
                continue;
            }
            if !next_vision::visible_from_sources(&vision_sources, rules, side, entity) {
                continue;
            }
            let Some(site) = facility_site(entity) else {
                continue;
            };
            currently_visible_facilities.insert(entity_id.clone());
            let id = self.facility_id(entity_id);
            let remembered = self
                .facilities
                .get_mut(entity_id)
                .expect("facility_id inserts facility");
            remembered.id = id;
            remembered.kind = entity.entity_type.to_string();
            remembered.side = facility_side(entity.owner);
            remembered.site = site;
            remembered.last_seen_tick = tick;
            remembered.facility_state = observed_facility_state(entity);
        }

        let facilities = self
            .facilities
            .iter()
            .filter(|(entity_id, _)| !currently_visible_facilities.contains(*entity_id))
            .map(|(_, facility)| LastKnownFacility {
                id: facility.id.clone(),
                state: "last_known".into(),
                kind: facility.kind.clone(),
                side: facility.side,
                site: facility.site.clone(),
                last_seen_tick: facility.last_seen_tick,
                facility_state: facility.facility_state.clone(),
            })
            .collect();

        FogReplayState {
            schema_version: FOG_REPLAY_SCHEMA_VERSION,
            tick,
            side,
            nodes,
            edges,
            facilities,
        }
    }

    fn facility_id(&mut self, entity_id: &EntityId) -> String {
        if let Some(known) = self.facilities.get(entity_id) {
            return known.id.clone();
        }
        self.next_facility += 1;
        let id = format!("facility-{}", self.next_facility);
        self.facilities.insert(
            entity_id.clone(),
            RememberedFacility {
                id: id.clone(),
                kind: String::new(),
                side: FacilitySide::Neutral,
                site: String::new(),
                last_seen_tick: 0,
                facility_state: BTreeMap::new(),
            },
        );
        id
    }
}

impl FogReplayState {
    /// Encodes the v1 public shape using the core Replay's tagged `DomainValue`
    /// representation so this field needs no parallel serialization dialect.
    pub fn as_domain_value(&self) -> DomainValue {
        let nodes = self
            .nodes
            .iter()
            .map(|(id, state)| {
                (
                    FieldId::from(id.as_str()),
                    DomainValue::String(state_name(*state).into()),
                )
            })
            .collect();
        let edges = self
            .edges
            .iter()
            .map(|(id, states)| {
                (
                    FieldId::from(id.as_str()),
                    DomainValue::List(
                        states
                            .iter()
                            .map(|state| DomainValue::String(state_name(*state).into()))
                            .collect(),
                    ),
                )
            })
            .collect();
        let facilities = self
            .facilities
            .iter()
            .map(|facility| {
                let facility_state: BTreeMap<FieldId, DomainValue> = facility
                    .facility_state
                    .iter()
                    .map(|(key, value)| {
                        let value = match value {
                            FacilityStateValue::Integer(value) => DomainValue::Integer(*value),
                            FacilityStateValue::String(value) => DomainValue::String(value.clone()),
                        };
                        (FieldId::from(key.as_str()), value)
                    })
                    .collect();
                let mut fields = BTreeMap::from([
                    ("id".into(), DomainValue::String(facility.id.clone())),
                    ("state".into(), DomainValue::String(facility.state.clone())),
                    ("kind".into(), DomainValue::String(facility.kind.clone())),
                    (
                        "side".into(),
                        DomainValue::String(facility_side_name(facility.side).into()),
                    ),
                    ("site".into(), DomainValue::String(facility.site.clone())),
                    (
                        "last_seen_tick".into(),
                        DomainValue::Integer(i64::from(facility.last_seen_tick)),
                    ),
                ]);
                if !facility_state.is_empty() {
                    fields.insert("facility_state".into(), DomainValue::Record(facility_state));
                }
                DomainValue::Record(fields)
            })
            .collect();
        DomainValue::Record(BTreeMap::from([
            ("schema_version".into(), DomainValue::Integer(i64::from(self.schema_version))),
            ("tick".into(), DomainValue::Integer(i64::from(self.tick))),
            ("side".into(), DomainValue::String(side_name(self.side).into())),
            ("nodes".into(), DomainValue::Record(nodes)),
            ("edges".into(), DomainValue::Record(edges)),
            ("facilities".into(), DomainValue::List(facilities)),
        ]))
    }
}

fn node_probe(node_id: &str, x: i64, y: i64) -> EntityState {
    EntityState {
        entity_type: TypeId::from("fog_probe"),
        owner: None,
        fields: BTreeMap::from([
            ("node".into(), DomainValue::String(node_id.into())),
            ("x".into(), DomainValue::Integer(x)),
            ("y".into(), DomainValue::Integer(y)),
        ]),
    }
}

fn edge_probe(from: &str, to: &str, progress: i64) -> EntityState {
    EntityState {
        entity_type: TypeId::from("fog_probe"),
        owner: None,
        fields: BTreeMap::from([
            ("node".into(), DomainValue::String(from.into())),
            ("edge_to".into(), DomainValue::String(to.into())),
            ("edge_progress".into(), DomainValue::Integer(progress)),
        ]),
    }
}

fn is_facility(entity_type: &TypeId) -> bool {
    matches!(entity_type.as_str(), "tower" | "base" | "bridge" | "observation")
}

fn facility_site(entity: &EntityState) -> Option<String> {
    let field = if entity.entity_type == TypeId::from("bridge") { "site" } else { "node" };
    let site = match entity.fields.get(&FieldId::from(field)) {
        Some(DomainValue::String(value)) => value.clone(),
        Some(DomainValue::Enum(value)) => value.to_string(),
        _ => return None,
    };
    (!site.is_empty()).then_some(site)
}

fn facility_side(side: Option<CombatantSide>) -> FacilitySide {
    match side {
        Some(CombatantSide::Attacker) => FacilitySide::Attacker,
        Some(CombatantSide::Defender) => FacilitySide::Defender,
        None => FacilitySide::Neutral,
    }
}

fn observed_facility_state(entity: &EntityState) -> BTreeMap<String, FacilityStateValue> {
    const INTEGER_FIELDS: &[&str] = &["hp", "max_hp", "build_remaining", "capture_progress"];
    const STRING_FIELDS: &[&str] = &[
        "bridge_state",
        "build_kind",
        "capture_owner",
        "capture_progress_side",
    ];

    let mut state = BTreeMap::new();
    for name in INTEGER_FIELDS {
        if let Some(DomainValue::Integer(value)) = entity.fields.get(&FieldId::from(*name)) {
            state.insert((*name).into(), FacilityStateValue::Integer(*value));
        }
    }
    for name in STRING_FIELDS {
        let value = match entity.fields.get(&FieldId::from(*name)) {
            Some(DomainValue::String(value)) => Some(value.clone()),
            Some(DomainValue::Enum(value)) => Some(value.to_string()),
            _ => None,
        };
        if let Some(value) = value {
            state.insert((*name).into(), FacilityStateValue::String(value));
        }
    }
    state
}

fn side_name(side: CombatantSide) -> &'static str {
    match side {
        CombatantSide::Attacker => "attacker",
        CombatantSide::Defender => "defender",
    }
}

fn facility_side_name(side: FacilitySide) -> &'static str {
    match side {
        FacilitySide::Attacker => "attacker",
        FacilitySide::Defender => "defender",
        FacilitySide::Neutral => "neutral",
    }
}

fn state_name(state: FogVisibility) -> &'static str {
    match state {
        FogVisibility::Unexplored => "unexplored",
        FogVisibility::Explored => "explored",
        FogVisibility::Visible => "visible",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{BattleMap, MapEdge, MapNode, Version};

    fn rules() -> NextRules {
        let node = |x| MapNode {
            allegiance: "N".into(),
            x,
            y: 0,
            presentation_x: x,
            presentation_y: 0,
            region: "lane".into(),
        };
        NextRules {
            projection_policy: None,
            mechanics_version: Version::new(1, 0, 0),
            world_identity: None,
            map: BattleMap {
                id: "fog-test".into(),
                world_identity: None,
                world_projection: None,
                nodes: BTreeMap::from([
                    ("a".into(), node(0)),
                    ("b".into(), node(80)),
                    ("c".into(), node(160)),
                ]),
                edges: vec![MapEdge {
                    id: "edge-ab".into(),
                    bridge_site: String::new(),
                    ford: false,
                    from: "a".into(),
                    to: "b".into(),
                    length: 80,
                    region: "lane".into(),
                    blocked: false,
                }],
                lanes: BTreeMap::new(),
                attacker_base: "a".into(),
                defender_base: "b".into(),
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
        }
    }

    fn unit(owner: CombatantSide, node: &str, x: i64, y: i64, vision: i64) -> EntityState {
        EntityState {
            entity_type: TypeId::from("hero"),
            owner: Some(owner),
            fields: BTreeMap::from([
                ("hp".into(), DomainValue::Integer(100)),
                ("x".into(), DomainValue::Integer(x)),
                ("y".into(), DomainValue::Integer(y)),
                ("vision".into(), DomainValue::Integer(vision)),
                ("node".into(), DomainValue::String(node.into())),
            ]),
        }
    }

    fn bridge(node: &str, site: &str, state: &str, hp: i64) -> EntityState {
        EntityState {
            entity_type: TypeId::from("bridge"),
            owner: None,
            fields: BTreeMap::from([
                ("site".into(), DomainValue::String(site.into())),
                ("node".into(), DomainValue::String(node.into())),
                ("bridge_state".into(), DomainValue::String(state.into())),
                ("hp".into(), DomainValue::Integer(hp)),
                ("max_hp".into(), DomainValue::Integer(100)),
            ]),
        }
    }

    fn move_to(entity: &mut EntityState, node: &str, x: i64, y: i64) {
        entity.fields.insert("node".into(), DomainValue::String(node.into()));
        entity.fields.insert("x".into(), DomainValue::Integer(x));
        entity.fields.insert("y".into(), DomainValue::Integer(y));
    }

    #[test]
    fn graph_node_and_edge_visibility_advances_to_explored_without_occlusion_rules() {
        let rules = rules();
        let mut world = WorldState::default();
        world.entities.insert(
            "friendly-private-key".into(),
            unit(CombatantSide::Attacker, "a", 0, 0, 20),
        );
        let mut history = FogHistory::default();

        let first = history.observe(&world, &rules, CombatantSide::Attacker, 0);
        assert_eq!(first.nodes["a"], FogVisibility::Visible);
        assert_eq!(first.nodes["b"], FogVisibility::Unexplored);
        assert_eq!(first.edges["edge-ab"].len(), EDGE_SAMPLE_COUNT);
        assert_eq!(first.edges["edge-ab"][0], FogVisibility::Visible);
        assert_eq!(first.edges["edge-ab"][8], FogVisibility::Unexplored);

        move_to(
            world
                .entities
                .get_mut(&EntityId::from("friendly-private-key"))
                .unwrap(),
            "b",
            80,
            0,
        );
        let second = history.observe(&world, &rules, CombatantSide::Attacker, 1);
        assert_eq!(second.nodes["a"], FogVisibility::Explored);
        assert_eq!(second.nodes["b"], FogVisibility::Visible);
        assert_eq!(second.edges["edge-ab"][0], FogVisibility::Explored);
        assert_eq!(second.edges["edge-ab"][8], FogVisibility::Visible);
        assert_eq!(second.nodes["c"], FogVisibility::Unexplored);
    }

    #[test]
    fn hidden_enemy_units_disappear_while_facilities_keep_only_timed_observations() {
        let rules = rules();
        let mut world = WorldState::default();
        world.entities.insert(
            "attacker-roster-secret".into(),
            unit(CombatantSide::Attacker, "a", 0, 0, 20),
        );
        world.entities.insert(
            "defender-roster-secret".into(),
            unit(CombatantSide::Defender, "a", 3, 4, 20),
        );
        world.entities.insert(
            "private-bridge-key".into(),
            bridge("a", "TOP", "normal", 100),
        );
        let mut history = FogHistory::default();

        let current = history.observe(&world, &rules, CombatantSide::Attacker, 7);
        assert!(
            current.facilities.is_empty(),
            "currently visible bridge remains in visible_state.entities"
        );
        move_to(
            world
                .entities
                .get_mut(&EntityId::from("attacker-roster-secret"))
                .unwrap(),
            "b",
            80,
            0,
        );
        let lost = history.observe(&world, &rules, CombatantSide::Attacker, 8);
        assert_eq!(lost.facilities.len(), 1);
        assert_eq!(lost.facilities[0].state, "last_known");
        assert_eq!(lost.facilities[0].kind, "bridge");
        assert_eq!(lost.facilities[0].side, FacilitySide::Neutral);
        assert_eq!(lost.facilities[0].site, "TOP");
        assert_eq!(lost.facilities[0].last_seen_tick, 7);
        assert_eq!(lost.facilities[0].id, "facility-1");
        assert_eq!(
            lost.facilities[0].facility_state["bridge_state"],
            FacilityStateValue::String("normal".into())
        );
        assert_eq!(lost.facilities[0].facility_state["hp"], FacilityStateValue::Integer(100));

        let lost_view = next_vision::team_view_with_fog(
            &world,
            &rules,
            CombatantSide::Attacker,
            8,
            &mut history,
        );
        assert!(!lost_view.entities.contains_key(&EntityId::from("defender-roster-secret")));

        move_to(
            world
                .entities
                .get_mut(&EntityId::from("defender-roster-secret"))
                .unwrap(),
            "c",
            8000,
            9000,
        );
        world.entities.insert(
            "private-bridge-key".into(),
            bridge("a", "TOP", "destroyed", 0),
        );
        let later = history.observe(&world, &rules, CombatantSide::Attacker, 9);
        assert_eq!(later.facilities[0].facility_state["bridge_state"], FacilityStateValue::String("normal".into()));
        assert_eq!(later.facilities[0].facility_state["hp"], FacilityStateValue::Integer(100));
        assert_eq!(later.facilities[0].last_seen_tick, 7);
        let wire = serde_json::to_string(&later.as_domain_value()).unwrap();
        assert!(!wire.contains("defender-roster-secret"));
        assert!(!wire.contains("attacker-roster-secret"));
        assert!(!wire.contains("9000"));

        move_to(
            world
                .entities
                .get_mut(&EntityId::from("defender-roster-secret"))
                .unwrap(),
            "a",
            44,
            55,
        );
        move_to(
            world
                .entities
                .get_mut(&EntityId::from("attacker-roster-secret"))
                .unwrap(),
            "a",
            0,
            0,
        );
        let rediscovered = history.observe(&world, &rules, CombatantSide::Attacker, 10);
        assert!(rediscovered.facilities.is_empty());
        let view = next_vision::team_view(&world, &rules, CombatantSide::Attacker);
        assert!(view.entities.contains_key(&EntityId::from("private-bridge-key")));
        assert!(view.entities.contains_key(&EntityId::from("defender-roster-secret")));
    }

    #[test]
    fn contest_is_not_remembered_and_facility_reveal_does_not_reveal_node_occupancy() {
        let rules = rules();
        let mut world = WorldState::default();
        world.entities.insert("viewer".into(), unit(CombatantSide::Attacker, "a", 0, 0, 20));
        let mut observation = bridge("b", "MID", "normal", 100);
        observation.entity_type = TypeId::from("observation");
        observation.fields.insert("capture_contested".into(), DomainValue::Bool(true));
        observation.fields.insert("reveal_attacker_until".into(), DomainValue::Integer(1));
        world.entities.insert("objective".into(), observation);
        assert!(next_vision::visible(&world, &rules, CombatantSide::Attacker, &world.entities[&EntityId::from("objective")]));
        assert!(!next_vision::visible_node(&world, &rules, CombatantSide::Attacker, "b"), "a facility-only reveal does not authorize its hidden occupants");

        let viewer = world.entities.get_mut(&EntityId::from("viewer")).unwrap();
        move_to(viewer, "b", 80, 0);
        assert!(next_vision::visible_node(&world, &rules, CombatantSide::Attacker, "b"));
        let mut history = FogHistory::default();
        history.observe(&world, &rules, CombatantSide::Attacker, 1);
        move_to(world.entities.get_mut(&EntityId::from("viewer")).unwrap(), "a", 0, 0);
        world.entities.get_mut(&EntityId::from("objective")).unwrap().fields.remove(&FieldId::from("reveal_attacker_until"));
        let fog = history.observe(&world, &rules, CombatantSide::Attacker, 2);
        assert_eq!(fog.facilities.len(), 1);
        assert!(!fog.facilities[0].facility_state.contains_key("capture_contested"));
        assert!(!serde_json::to_string(&fog.as_domain_value()).unwrap().contains("capture_contested"));
    }

    #[test]
    fn each_side_gets_its_own_logical_visibility_mask() {
        let rules = rules();
        let mut world = WorldState::default();
        world.entities.insert(
            "attacker-roster-secret".into(),
            unit(CombatantSide::Attacker, "a", 0, 0, 20),
        );
        world.entities.insert(
            "defender-roster-secret".into(),
            unit(CombatantSide::Defender, "b", 80, 0, 20),
        );
        let attacker = FogHistory::default().observe(&world, &rules, CombatantSide::Attacker, 0);
        let defender = FogHistory::default().observe(&world, &rules, CombatantSide::Defender, 0);

        assert_eq!(attacker.nodes["a"], FogVisibility::Visible);
        assert_eq!(attacker.nodes["b"], FogVisibility::Unexplored);
        assert_eq!(defender.nodes["b"], FogVisibility::Visible);
        assert_eq!(defender.nodes["a"], FogVisibility::Unexplored);
    }

    #[test]
    fn batched_source_filter_matches_authoritative_visibility_for_all_probe_kinds() {
        let mut rules = rules();
        rules.parameters.insert("mid_observation_radius_wu".into(), 30);
        rules.parameters.insert("minion_vision".into(), 30);
        let mut world = WorldState::default();
        world.entities.insert(
            "attacker-hero".into(),
            unit(CombatantSide::Attacker, "a", 0, 0, 20),
        );
        let mut matching_minion = unit(CombatantSide::Attacker, "a", 77, 99, 20);
        matching_minion.entity_type = TypeId::from("minion");
        world.entities.insert("matching-minion".into(), matching_minion);
        let mut matching_minion_two = unit(CombatantSide::Attacker, "a", -44, 10, 999);
        matching_minion_two.entity_type = TypeId::from("minion");
        world.entities.insert("matching-minion-two".into(), matching_minion_two);
        let mut dead_minion = unit(CombatantSide::Attacker, "a", 0, 0, 1_000);
        dead_minion.entity_type = TypeId::from("minion");
        dead_minion.fields.insert("hp".into(), DomainValue::Integer(0));
        world.entities.insert("dead-minion".into(), dead_minion);
        let mut tower = unit(CombatantSide::Attacker, "c", 160, 0, 1_000);
        tower.entity_type = TypeId::from("tower");
        world.entities.insert("tower".into(), tower);
        let mut observation = bridge("c", "TOP", "normal", 1);
        observation.entity_type = TypeId::from("observation");
        observation.owner = Some(CombatantSide::Attacker);
        world.entities.insert("observation".into(), observation);
        world.entities.insert(
            "defender-hero".into(),
            unit(CombatantSide::Defender, "b", 80, 0, 20),
        );

        let mut probes: Vec<_> = rules
            .map
            .nodes
            .iter()
            .map(|(id, node)| node_probe(id, node.x, node.y))
            .collect();
        probes.extend(rules.map.edges.iter().flat_map(|edge| {
            (0..EDGE_SAMPLE_COUNT).map(move |sample| {
                edge_probe(
                    &edge.from,
                    &edge.to,
                    edge.length * sample as i64 / (EDGE_SAMPLE_COUNT as i64 - 1),
                )
            })
        }));
        probes.extend(world.entities.values().cloned());

        for side in [CombatantSide::Attacker, CombatantSide::Defender] {
            let sources = next_vision::vision_sources(&world, &rules, side);
            if side == CombatantSide::Attacker {
                assert_eq!(
                    sources.len(),
                    3,
                    "same logical minion positions group using minion_vision; heroes retain their own radius; tower and dead minion are excluded"
                );
            }
            for probe in &probes {
                assert_eq!(
                    next_vision::visible(&world, &rules, side, probe),
                    next_vision::visible_from_sources(&sources, &rules, side, probe),
                    "batched and authoritative visibility differ for {side:?} at {probe:?}",
                );
            }
            for edge in rules
                .map
                .edges
                .iter()
                .filter(|edge| edge.length > 0 && edge.region != "lane")
            {
                for (node, progress) in [(&edge.from, 0), (&edge.to, edge.length)] {
                    let (node_id, node) = rules.map.nodes.get_key_value(node).unwrap();
                    let node_probe = node_probe(node_id, node.x, node.y);
                    let endpoint_probe = edge_probe(&edge.from, &edge.to, progress);
                    assert_eq!(
                        next_vision::visible(&world, &rules, side, &node_probe),
                        next_vision::visible(&world, &rules, side, &endpoint_probe),
                        "edge endpoint cache key must preserve authoritative visibility for {side:?} on {}",
                        edge.id,
                    );
                }
            }
        }
    }

    #[test]
    fn fog_probe_cache_preserves_lateral_lane_endpoint_visibility_in_both_directions() {
        let mut rules = rules();
        let mut reverse = rules.map.edges[0].clone();
        reverse.id = "edge-ba".into();
        reverse.from = "b".into();
        reverse.to = "a".into();
        rules.map.edges.push(reverse);

        for (from, to, track) in [("a", "b", "LEFT"), ("b", "a", "RIGHT")] {
            let mut source = unit(CombatantSide::Attacker, from, 0, 0, 20);
            source.entity_type = TypeId::from("hero");
            source.fields.insert("edge_to".into(), DomainValue::String(to.into()));
            source.fields.insert("edge_progress".into(), DomainValue::Integer(20));
            source.fields.insert("track".into(), DomainValue::String(track.into()));
            let mut world = WorldState::default();
            world.entities.insert("lateral-source".into(), source);

            let state = FogHistory::default().observe(&world, &rules, CombatantSide::Attacker, 0);
            for (node_id, node) in &rules.map.nodes {
                let probe = node_probe(node_id, node.x, node.y);
                let expected = next_vision::visible(&world, &rules, CombatantSide::Attacker, &probe);
                assert_eq!(state.nodes[node_id] == FogVisibility::Visible, expected);
            }
            for edge in &rules.map.edges {
                let edge_id = if edge.id.is_empty() {
                    format!("{}-{}", edge.from, edge.to)
                } else {
                    edge.id.clone()
                };
                for sample in 0..EDGE_SAMPLE_COUNT {
                    let progress =
                        edge.length.saturating_mul(sample as i64) / (EDGE_SAMPLE_COUNT as i64 - 1);
                    let probe = edge_probe(&edge.from, &edge.to, progress);
                    let expected = edge.length >= 0
                        && next_vision::visible(&world, &rules, CombatantSide::Attacker, &probe);
                    assert_eq!(
                        state.edges[&edge_id][sample] == FogVisibility::Visible,
                        expected,
                        "cached Fog state differs from authoritative visibility for {track} on {edge_id} sample {sample}",
                    );
                }
            }
        }
    }

    #[test]
    fn fog_replay_domain_value_is_versioned_and_side_scoped() {
        let rules = rules();
        let mut world = WorldState::default();
        world.entities.insert(
            "attacker-roster-secret".into(),
            unit(CombatantSide::Attacker, "a", 0, 0, 20),
        );
        let mut history = FogHistory::default();
        let view = next_vision::team_view_with_fog(
            &world,
            &rules,
            CombatantSide::Attacker,
            12,
            &mut history,
        );
        let DomainValue::Record(value) = &view.global_fields[&FieldId::from(FOG_GLOBAL_FIELD)] else {
            panic!("fog field is a record");
        };
        assert_eq!(value[&FieldId::from("schema_version")], DomainValue::Integer(1));
        assert_eq!(value[&FieldId::from("tick")], DomainValue::Integer(12));
        assert_eq!(
            value[&FieldId::from("side")],
            DomainValue::String("attacker".into())
        );
        assert!(value.contains_key(&FieldId::from("nodes")));
        assert!(value.contains_key(&FieldId::from("edges")));
        assert!(value.contains_key(&FieldId::from("facilities")));
    }
}
