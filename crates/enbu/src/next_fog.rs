//! Side-authorized, renderer-facing Fog of War replay projection.
//!
//! Version 1 is stored at `ReplayFrame.visible_state.global_fields.fog` as a
//! `DomainValue::Record`. Node and edge masks are computed from Enbu's existing
//! logical visibility check. They describe graph samples only; visual terrain
//! does not add sight blockers. Contacts contain only last-seen public identity
//! class and position, never current hidden entity state or internal IDs.

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LastKnownContact {
    /// Replay-local pseudonym, independent from Enbu's private EntityId.
    pub id: String,
    /// Always `last_known`; the position is historical, never extrapolated.
    pub state: String,
    pub kind: String,
    pub side: CombatantSide,
    /// Logical World Units, not renderer coordinates.
    pub x: i64,
    pub y: i64,
    pub last_seen_tick: u32,
}

/// A single tick's side-specific visibility mask and remembered contacts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FogReplayState {
    pub schema_version: u32,
    pub tick: u32,
    pub side: CombatantSide,
    pub nodes: BTreeMap<String, FogVisibility>,
    /// Nine samples in `MapEdge.from` → `MapEdge.to` logical progress order.
    pub edges: BTreeMap<String, Vec<FogVisibility>>,
    /// Enemies which were seen before and are not currently visible.
    pub contacts: Vec<LastKnownContact>,
}

#[derive(Clone, Debug, Default)]
pub struct FogHistory {
    explored_nodes: BTreeSet<String>,
    explored_edges: BTreeSet<(String, usize)>,
    /// Private keys remain inside Enbu. Only the generated contact serial exits.
    contacts: BTreeMap<EntityId, RememberedContact>,
    next_contact: u64,
}

#[derive(Clone, Debug)]
struct RememberedContact {
    id: String,
    kind: String,
    side: CombatantSide,
    x: i64,
    y: i64,
    last_seen_tick: u32,
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
        let mut nodes = BTreeMap::new();
        for (node_id, node) in &rules.map.nodes {
            let probe = node_probe(node_id, node.x, node.y);
            let state = if next_vision::visible(world, rules, side, &probe) {
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
                let state = if edge.length >= 0
                    && next_vision::visible(world, rules, side, &probe)
                {
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

        let mut currently_visible_enemies = BTreeSet::new();
        for (entity_id, entity) in &world.entities {
            if entity.owner.is_none()
                || entity.owner == Some(side)
                || !is_unit(&entity.entity_type)
            {
                continue;
            }
            if !next_vision::visible(world, rules, side, entity) {
                continue;
            }
            currently_visible_enemies.insert(entity_id.clone());
            if value_int(entity, "hp").unwrap_or(1) <= 0 {
                self.contacts.remove(entity_id);
                continue;
            }

            let id = self.contact_id(entity_id);
            let position = (
                value_int(entity, "x").unwrap_or(0),
                value_int(entity, "y").unwrap_or(0),
            );
            let remembered = self
                .contacts
                .get_mut(entity_id)
                .expect("contact_id inserts contact");
            remembered.id = id;
            remembered.kind = entity.entity_type.to_string();
            remembered.side = entity.owner.expect("filtered above");
            remembered.x = position.0;
            remembered.y = position.1;
            remembered.last_seen_tick = tick;
        }

        let contacts = self
            .contacts
            .iter()
            .filter(|(entity_id, _)| !currently_visible_enemies.contains(*entity_id))
            .map(|(_, contact)| LastKnownContact {
                id: contact.id.clone(),
                state: "last_known".into(),
                kind: contact.kind.clone(),
                side: contact.side,
                x: contact.x,
                y: contact.y,
                last_seen_tick: contact.last_seen_tick,
            })
            .collect();

        FogReplayState {
            schema_version: FOG_REPLAY_SCHEMA_VERSION,
            tick,
            side,
            nodes,
            edges,
            contacts,
        }
    }

    fn contact_id(&mut self, entity_id: &EntityId) -> String {
        if let Some(known) = self.contacts.get(entity_id) {
            return known.id.clone();
        }
        self.next_contact += 1;
        let id = format!("contact-{}", self.next_contact);
        self.contacts.insert(
            entity_id.clone(),
            RememberedContact {
                id: id.clone(),
                kind: String::new(),
                side: CombatantSide::Attacker,
                x: 0,
                y: 0,
                last_seen_tick: 0,
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
        let contacts = self
            .contacts
            .iter()
            .map(|contact| {
                DomainValue::Record(BTreeMap::from([
                    ("id".into(), DomainValue::String(contact.id.clone())),
                    ("state".into(), DomainValue::String(contact.state.clone())),
                    ("kind".into(), DomainValue::String(contact.kind.clone())),
                    (
                        "side".into(),
                        DomainValue::String(side_name(contact.side).into()),
                    ),
                    ("x".into(), DomainValue::Integer(contact.x)),
                    ("y".into(), DomainValue::Integer(contact.y)),
                    (
                        "last_seen_tick".into(),
                        DomainValue::Integer(i64::from(contact.last_seen_tick)),
                    ),
                ]))
            })
            .collect();
        DomainValue::Record(BTreeMap::from([
            ("schema_version".into(), DomainValue::Integer(i64::from(self.schema_version))),
            ("tick".into(), DomainValue::Integer(i64::from(self.tick))),
            ("side".into(), DomainValue::String(side_name(self.side).into())),
            ("nodes".into(), DomainValue::Record(nodes)),
            ("edges".into(), DomainValue::Record(edges)),
            ("contacts".into(), DomainValue::List(contacts)),
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

fn value_int(entity: &EntityState, key: &str) -> Option<i64> {
    match entity.fields.get(&FieldId::from(key)) {
        Some(DomainValue::Integer(value)) => Some(*value),
        _ => None,
    }
}

fn is_unit(entity_type: &TypeId) -> bool {
    matches!(entity_type.as_str(), "hero" | "minion" | "monster")
}

fn side_name(side: CombatantSide) -> &'static str {
    match side {
        CombatantSide::Attacker => "attacker",
        CombatantSide::Defender => "defender",
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
            region: "lane".into(),
        };
        NextRules {
            mechanics_version: Version::new(1, 0, 0),
            map: BattleMap {
                id: "fog-test".into(),
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
    fn hidden_enemy_contact_stays_at_last_observed_position_and_has_no_private_key() {
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
        let mut history = FogHistory::default();

        let current = history.observe(&world, &rules, CombatantSide::Attacker, 7);
        assert!(
            current.contacts.is_empty(),
            "currently visible enemy belongs in visible_state.entities"
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
        assert_eq!(lost.contacts.len(), 1);
        assert_eq!(lost.contacts[0].state, "last_known");
        assert_eq!((lost.contacts[0].x, lost.contacts[0].y), (3, 4));
        assert_eq!(lost.contacts[0].last_seen_tick, 7);
        assert_eq!(lost.contacts[0].id, "contact-1");

        move_to(
            world
                .entities
                .get_mut(&EntityId::from("defender-roster-secret"))
                .unwrap(),
            "c",
            8000,
            9000,
        );
        let later = history.observe(&world, &rules, CombatantSide::Attacker, 9);
        assert_eq!((later.contacts[0].x, later.contacts[0].y), (3, 4));
        assert_eq!(later.contacts[0].last_seen_tick, 7);
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
        assert!(rediscovered.contacts.is_empty());
        let view = next_vision::team_view(&world, &rules, CombatantSide::Attacker);
        assert!(view.entities.contains_key(&EntityId::from("defender-roster-secret")));
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
        assert_eq!(value[&FieldId::from("side")], DomainValue::String("attacker".into()));
        assert!(value.contains_key(&FieldId::from("nodes")));
        assert!(value.contains_key(&FieldId::from("edges")));
        assert!(value.contains_key(&FieldId::from("contacts")));
    }
}
