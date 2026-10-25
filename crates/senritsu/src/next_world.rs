//! Versioned logical Battlefield topology for `senkei.next`.
//!
//! Coordinates only arrange the authored battlefield. Edge identities,
//! endpoint membership, length, terrain and fixed bridge site are the rules.

// The adapter is intentionally staged without changing `next_package` until
// World identities and runtime semantics are proven compatible.
#![allow(dead_code)]

use senkei_model::{BattleMap, BattleMapWorldProjection, MapEdge, MapNode, TowerPlacement, WorldEdgeFacts, WorldRiverCrossing, WorldTrackRange};
use senkei_world::{
    CanonicalPresentationWorld, CanonicalSimulationWorld, EdgeClass, NodeKind,
    ObservationSemantics, RiverCrossingKind, TrackKind, TerrainKind, VerifiedWorld,
    WorldIdentity, INITIAL_BATTLEFIELD_PROFILE_ID, INITIAL_BATTLEFIELD_PROFILE_VERSION,
};
use std::collections::{BTreeMap, BTreeSet};

pub const BATTLEFIELD_MAP_ID: &str = "senkei-battlefield-v2";
pub const RUNTIME_BATTLE_MAP_PROJECTION_SCHEMA: senkei_model::Version =
    senkei_model::Version::new(1, 0, 0);

/// The immutable authored World used by the v2 Battlefield package.
pub fn compiled_authored_world() -> VerifiedWorld {
    senkei_world::compile_json(include_bytes!(
        "../../senkei-world/fixtures/initial-battlefield.json"
    ))
    .expect("checked-in World Definition compiles")
}

/// Optional explicitly supplied layout assertion. The canonical layout is
/// authored by World Definition; supplemental metadata must match it exactly.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExplicitBattleMapMetadata {
    pub attacker_base: String,
    pub defender_base: String,
    pub lanes: BTreeMap<String, Vec<String>>,
    pub towers: Vec<TowerPlacement>,
}

impl ExplicitBattleMapMetadata {
    /// Explicitly copy the runtime-only layout fields from an existing map.
    /// This does not infer routes or sites from the compiled World.
    #[cfg(test)]
    pub fn from_runtime_map(map: &BattleMap) -> Self {
        Self {
            attacker_base: map.attacker_base.clone(),
            defender_base: map.defender_base.clone(),
            lanes: map.lanes.clone(),
            towers: map.towers.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorldMapAdapterError {
    pub code: &'static str,
    pub detail: String,
}

impl std::fmt::Display for WorldMapAdapterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for WorldMapAdapterError {}

/// A guarded projection into the legacy BattleMap data shape.
///
/// The canonical simulation and presentation artifacts remain attached, and
/// the projected map is only exposed when an explicit compatibility check
/// against the target runtime succeeds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeBattleMapProjection {
    projection_schema_version: senkei_model::Version,
    identity: WorldIdentity,
    simulation: CanonicalSimulationWorld,
    presentation: CanonicalPresentationWorld,
    candidate_map: BattleMap,
}

impl RuntimeBattleMapProjection {
    pub fn projection_schema_version(&self) -> senkei_model::Version {
        self.projection_schema_version
    }

    pub fn identity(&self) -> &WorldIdentity {
        &self.identity
    }

    pub fn simulation_world(&self) -> &CanonicalSimulationWorld {
        &self.simulation
    }

    pub fn presentation_world(&self) -> &CanonicalPresentationWorld {
        &self.presentation
    }

    /// Legacy-shaped runtime projection. Keep this value paired with this
    /// wrapper, which retains the complete canonical World and identity.
    pub fn runtime_map(&self) -> &BattleMap {
        &self.candidate_map
    }

    /// The candidate cannot enter the current runtime until every representable
    /// field, stable identity, and runtime-only metadata item matches.
    pub fn battle_map_if_compatible(
        &self,
        runtime_map: &BattleMap,
    ) -> Result<&BattleMap, WorldMapCompatibilityReport> {
        let report = self.compatibility_report(runtime_map);
        if report.is_compatible() {
            Ok(&self.candidate_map)
        } else {
            Err(report)
        }
    }

    pub fn compatibility_report(
        &self,
        runtime_map: &BattleMap,
    ) -> WorldMapCompatibilityReport {
        compare_world_map(self, runtime_map)
    }
}

/// Classification separates graph/distance agreement from full runtime
/// compatibility, which also requires stable IDs and representable details.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorldMapCompatibilityClass {
    Exact,
    GraphAndLengthsMatch,
    Incompatible,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorldMapCompatibilityReport {
    pub class: WorldMapCompatibilityClass,
    pub world_id_matches: bool,
    pub node_ids_match: bool,
    pub node_semantics_match: bool,
    pub edge_ids_match: bool,
    pub endpoint_pairs_match: bool,
    pub endpoint_order_matches: bool,
    pub logical_distances_match: bool,
    pub edge_semantics_match: bool,
    pub lane_routes_match: bool,
    pub tower_sites_match: bool,
    pub tracks_representable: bool,
    pub terrain_representable: bool,
    pub crossing_ranges_representable: bool,
    pub missing_node_ids: Vec<String>,
    pub unexpected_node_ids: Vec<String>,
    pub missing_edge_ids: Vec<String>,
    pub unexpected_edge_ids: Vec<String>,
    pub missing_endpoint_pairs: Vec<String>,
    pub unexpected_endpoint_pairs: Vec<String>,
    pub edge_length_mismatches: Vec<String>,
    pub bridge_site_mismatches: Vec<String>,
    pub non_full_crossing_ranges: Vec<String>,
    pub track_mismatches: Vec<String>,
    pub terrain_mismatches: Vec<String>,
}

impl WorldMapCompatibilityReport {
    pub fn is_compatible(&self) -> bool {
        self.class == WorldMapCompatibilityClass::Exact
    }
}

/// Compile a validated World projection for comparison with `BattleMap`.
///
/// The initial Battlefield profile is the only supported profile because the
/// legacy adapter has finite node/edge and terrain conventions. Route and tower
/// declarations must be provided explicitly; no path is derived from the
/// presentation graph or synthesized from missing nodes.
pub fn project_verified_world(
    world: &VerifiedWorld,
    metadata: Option<&ExplicitBattleMapMetadata>,
) -> Result<RuntimeBattleMapProjection, WorldMapAdapterError> {
    let identity = world.identity();
    let profile = identity.validation_profile.as_ref().ok_or_else(|| {
        adapter_error(
            "missing_validation_profile",
            "BattleMap projection requires an explicit supported validation profile",
        )
    })?;
    if profile.id != INITIAL_BATTLEFIELD_PROFILE_ID
        || profile.version != INITIAL_BATTLEFIELD_PROFILE_VERSION
    {
        return Err(adapter_error(
            "unsupported_validation_profile",
            format!(
                "unsupported World profile {}@{}.{}.{}",
                profile.id,
                profile.version.major,
                profile.version.minor,
                profile.version.patch
            ),
        ));
    }
    let simulation = world.simulation_world();
    let presentation = world.presentation_world();
    let authored_layout = simulation.topology.runtime_layout.as_ref().ok_or_else(|| {
        adapter_error("missing_runtime_layout", "World Definition does not declare bases, lane routes, and tower placements")
    })?;
    let authored_metadata = ExplicitBattleMapMetadata {
        attacker_base: authored_layout.attacker_base.clone(),
        defender_base: authored_layout.defender_base.clone(),
        lanes: authored_layout.lanes.clone(),
        towers: authored_layout.towers.iter().map(|tower| TowerPlacement {
            id: tower.id.clone(), node: tower.node.clone(), side: tower.side.clone(), lane: tower.lane.clone(),
        }).collect(),
    };
    if let Some(supplied) = metadata {
        let mut supplied_towers = supplied.towers.clone();
        let mut authored_towers = authored_metadata.towers.clone();
        supplied_towers.sort_by(|a, b| a.id.cmp(&b.id));
        authored_towers.sort_by(|a, b| a.id.cmp(&b.id));
        if supplied.attacker_base != authored_metadata.attacker_base
            || supplied.defender_base != authored_metadata.defender_base
            || supplied.lanes != authored_metadata.lanes
            || supplied_towers != authored_towers
        {
            return Err(adapter_error("runtime_layout_mismatch", "supplemental routes/towers do not match the compiled World layout"));
        }
    }
    let metadata = &authored_metadata;
    validate_explicit_metadata(metadata, simulation)?;

    let mut nodes = BTreeMap::new();
    for (id, node) in &simulation.topology.nodes {
        let view = presentation.node_positions.get(id).ok_or_else(|| {
            adapter_error(
                "missing_node_presentation",
                format!("World presentation has no position for node '{id}'"),
            )
        })?;
        nodes.insert(
            id.clone(),
            MapNode {
                x: i64::from(node.logical_position.x),
                y: i64::from(node.logical_position.y),
                presentation_x: i64::from(view.position.x),
                presentation_y: i64::from(view.position.y),
                region: runtime_node_region(id, node.kind)?,
                allegiance: match node.allegiance {
                    senkei_world::Allegiance::A => "A",
                    senkei_world::Allegiance::B => "B",
                    senkei_world::Allegiance::Neutral => "N",
                }
                .into(),
            },
        );
    }

    let mut edges = Vec::with_capacity(simulation.topology.edges.len());
    for (id, edge) in &simulation.topology.edges {
        if edge.directionality != senkei_world::Directionality::Bidirectional {
            return Err(adapter_error(
                "unsupported_edge_directionality",
                format!("BattleMap cannot represent one-way edge '{id}'"),
            ));
        }
        let length = *simulation.metric.edge_lengths_wu.get(id).ok_or_else(|| {
            adapter_error(
                "missing_edge_length",
                format!("World metric has no length for edge '{id}'"),
            )
        })?;
        let length = i64::try_from(length).map_err(|_| {
            adapter_error(
                "edge_length_out_of_range",
                format!("edge '{id}' length exceeds BattleMap's signed range"),
            )
        })?;
        let tracks = simulation.metric.edge_tracks.get(id).ok_or_else(|| {
            adapter_error(
                "missing_edge_tracks",
                format!("World metric has no track set for edge '{id}'"),
            )
        })?;
        if !battle_map_track_semantics(edge.class, edge.river_crossing.as_ref(), tracks, length) {
            return Err(adapter_error(
                "unrepresentable_edge_tracks",
                format!("edge '{id}' tracks do not match the finite BattleMap track contract"),
            ));
        }
        validate_edge_terrain(simulation, id, edge.class)?;

        let region = runtime_edge_region(
            simulation,
            edge.class,
            edge.river_crossing.as_ref(),
            edge.from.as_str(),
            edge.to.as_str(),
        )?;
        let (bridge_site, ford) = match &edge.river_crossing {
            Some(crossing) => match crossing.kind {
                RiverCrossingKind::FixedBridge | RiverCrossingKind::FixedFacilityBridge => (
                    crossing.bridge_site_id.clone().ok_or_else(|| {
                        adapter_error(
                            "bridge_without_site",
                            format!("fixed crossing edge '{id}' has no bridge site"),
                        )
                    })?,
                    false,
                ),
                RiverCrossingKind::FootFord => (String::new(), true),
            },
            None => (String::new(), false),
        };
        edges.push(MapEdge {
            id: id.clone(),
            bridge_site,
            ford,
            from: edge.from.clone(),
            to: edge.to.clone(),
            length,
            region,
            // World Definition has no static blocked flag. Runtime blockage is
            // state, so a canonical authored edge starts unblocked.
            blocked: false,
        });
    }

    Ok(RuntimeBattleMapProjection {
        projection_schema_version: RUNTIME_BATTLE_MAP_PROJECTION_SCHEMA,
        identity: identity.clone(),
        simulation: simulation.clone(),
        presentation: presentation.clone(),
        candidate_map: BattleMap {
            // Runtime map ID is a versioned projection alias. The source World
            // identity remains separately preserved in the binding below.
            id: BATTLEFIELD_MAP_ID.into(),
            world_identity: Some(identity.to_model_ref()),
            world_projection: Some(world_projection(identity, simulation)?),
            nodes,
            edges,
            lanes: metadata.lanes.clone(),
            attacker_base: metadata.attacker_base.clone(),
            defender_base: metadata.defender_base.clone(),
            towers: metadata.towers.clone(),
        },
    })
}

fn world_projection(
    identity: &WorldIdentity,
    simulation: &CanonicalSimulationWorld,
) -> Result<BattleMapWorldProjection, WorldMapAdapterError> {
    let mut edge_facts = BTreeMap::new();
    for (id, edge) in &simulation.topology.edges {
        let profile_id = simulation.terrain.edge_profiles.get(id).ok_or_else(|| {
            adapter_error("missing_edge_terrain", format!("World edge '{id}' has no terrain profile"))
        })?;
        let profile = simulation.terrain.profiles.get(profile_id).ok_or_else(|| {
            adapter_error("missing_terrain_profile", format!("World terrain profile '{profile_id}' is missing"))
        })?;
        let tracks = simulation.metric.edge_tracks.get(id).ok_or_else(|| {
            adapter_error("missing_edge_tracks", format!("World edge '{id}' has no tracks"))
        })?;
        let crossing = edge.river_crossing.as_ref().map(|crossing| {
            let range = simulation.metric.river_crossing_ranges.get(id).ok_or_else(|| {
                adapter_error("missing_crossing_range", format!("World crossing '{id}' has no progress range"))
            })?;
            if crossing.river_id != range.river_id {
                return Err(adapter_error("crossing_river_mismatch", format!("World crossing '{id}' river IDs disagree")));
            }
            Ok(WorldRiverCrossing {
                river_id: crossing.river_id.clone(),
                kind: match crossing.kind { RiverCrossingKind::FixedBridge => "fixed_bridge", RiverCrossingKind::FixedFacilityBridge => "fixed_facility_bridge", RiverCrossingKind::FootFord => "foot_ford" }.into(),
                bridge_site_id: crossing.bridge_site_id.clone(),
                start_progress_wu: range.start_progress_wu,
                end_progress_wu: range.end_progress_wu,
            })
        }).transpose()?;
        edge_facts.insert(id.clone(), WorldEdgeFacts {
            directionality: match edge.directionality { senkei_world::Directionality::Bidirectional => "bidirectional", senkei_world::Directionality::FromTo => "from_to", senkei_world::Directionality::ToFrom => "to_from" }.into(),
            class: match edge.class { EdgeClass::Lane => "lane", EdgeClass::Jungle => "jungle", EdgeClass::Other => "other" }.into(),
            tracks: tracks.iter().map(|track| WorldTrackRange {
                id: track.id.clone(),
                kind: match track.kind { TrackKind::Left => "left", TrackKind::Center => "center", TrackKind::Right => "right", TrackKind::Single => "single", TrackKind::Other => "other" }.into(),
                start_progress_wu: track.start_progress_wu,
                end_progress_wu: track.end_progress_wu,
            }).collect(),
            river_crossing: crossing,
            terrain_profile_id: profile_id.clone(),
            terrain_kind: match profile.kind { TerrainKind::Lane => "lane", TerrainKind::Jungle => "jungle", TerrainKind::Riverbank => "riverbank", TerrainKind::Camp => "camp", TerrainKind::Other => "other" }.into(),
            observation_semantics: match profile.observation { ObservationSemantics::Open => "open", ObservationSemantics::Concealing => "concealing", ObservationSemantics::BlocksLineOfSight => "blocks_line_of_sight", ObservationSemantics::ElevatedObservation => "elevated_observation" }.into(),
        });
    }
    Ok(BattleMapWorldProjection {
        schema_version: RUNTIME_BATTLE_MAP_PROJECTION_SCHEMA,
        source_identity: identity.to_model_ref(),
        node_ids: simulation.topology.nodes.keys().cloned().collect(),
        edge_facts,
        bridge_sites: simulation.topology.bridge_sites.iter().map(|(id, site)| (id.clone(), site.edge_ids.clone())).collect(),
    })
}

fn adapter_error(code: &'static str, detail: impl Into<String>) -> WorldMapAdapterError {
    WorldMapAdapterError {
        code,
        detail: detail.into(),
    }
}

fn validate_explicit_metadata(
    metadata: &ExplicitBattleMapMetadata,
    simulation: &CanonicalSimulationWorld,
) -> Result<(), WorldMapAdapterError> {
    let node_ids: BTreeSet<_> = simulation.topology.nodes.keys().map(String::as_str).collect();
    if !node_ids.contains(metadata.attacker_base.as_str())
        || !node_ids.contains(metadata.defender_base.as_str())
    {
        return Err(adapter_error(
            "invalid_explicit_bases",
            "explicit attacker and defender bases must reference World nodes",
        ));
    }
    let expected_lanes: BTreeSet<_> = ["top", "mid", "bot"].into_iter().collect();
    let actual_lanes: BTreeSet<_> = metadata.lanes.keys().map(String::as_str).collect();
    if actual_lanes != expected_lanes {
        return Err(adapter_error(
            "invalid_explicit_lanes",
            "explicit route metadata must declare exactly top, mid, and bot",
        ));
    }
    for (lane, route) in &metadata.lanes {
        if route.len() < 2
            || route.first() != Some(&metadata.attacker_base)
            || route.last() != Some(&metadata.defender_base)
            || route.iter().any(|node| !node_ids.contains(node.as_str()))
        {
            return Err(adapter_error(
                "invalid_explicit_lane_route",
                format!(
                    "lane '{lane}' must explicitly connect both declared bases using World nodes"
                ),
            ));
        }
        let mut unique = BTreeSet::new();
        if route.iter().any(|node| !unique.insert(node)) {
            return Err(adapter_error(
                "invalid_explicit_lane_route",
                format!("lane '{lane}' repeats a node"),
            ));
        }
        for pair in route.windows(2) {
            if !simulation.topology.edges.values().any(|edge| {
                (edge.from == pair[0] && edge.to == pair[1])
                    || (edge.from == pair[1] && edge.to == pair[0])
            }) {
                return Err(adapter_error(
                    "invalid_explicit_lane_route",
                    format!("lane '{lane}' contains undeclared edge '{}'-'{}'", pair[0], pair[1]),
                ));
            }
        }
    }

    let mut tower_ids = BTreeSet::new();
    if metadata.towers.len() != 12
        || metadata.towers.iter().any(|tower| {
            !tower_ids.insert(tower.id.as_str())
                || !node_ids.contains(tower.node.as_str())
                || !expected_lanes.contains(tower.lane.as_str())
                || !matches!(tower.side.as_str(), "attacker" | "defender")
        })
    {
        return Err(adapter_error(
            "invalid_explicit_towers",
            concat!(
                "exactly twelve unique tower placements on World nodes, with explicit side ",
                "and lane, are required"
            ),
        ));
    }
    Ok(())
}

fn runtime_node_region(id: &str, kind: NodeKind) -> Result<String, WorldMapAdapterError> {
    let region = match kind {
        NodeKind::Base => "base",
        NodeKind::Bank => "riverbank",
        NodeKind::JungleJunction => "jungle",
        NodeKind::Camp => "camp",
        NodeKind::ObservationBase => "observation",
        NodeKind::Lane | NodeKind::Junction => {
            match id.split('.').nth(1) {
                Some("TOP") => "top",
                Some("MID") => "mid",
                Some("BOT") => "bot",
                _ => {
                    return Err(adapter_error(
                        "unmapped_node_region",
                        format!("node '{id}' has a lane or junction kind without a stable lane ID"),
                    ));
                }
            }
        }
        NodeKind::Other => {
            return Err(adapter_error(
                "unsupported_node_kind",
                format!("BattleMap has no typed projection for node '{id}'"),
            ));
        }
    };
    Ok(region.into())
}

fn runtime_edge_region(
    simulation: &CanonicalSimulationWorld,
    class: EdgeClass,
    crossing: Option<&senkei_world::RiverCrossingDefinition>,
    from: &str,
    to: &str,
) -> Result<String, WorldMapAdapterError> {
    if let Some(crossing) = crossing {
        match crossing.kind {
            RiverCrossingKind::FixedBridge | RiverCrossingKind::FixedFacilityBridge => {
                return Ok("bridge".into());
            }
            RiverCrossingKind::FootFord => return Ok("river_ford".into()),
        }
    }
    match class {
        EdgeClass::Lane => Ok("lane".into()),
        EdgeClass::Jungle => {
            let camp_endpoint = [from, to].into_iter().any(|node_id| {
                simulation
                    .topology
                    .nodes
                    .get(node_id)
                    .is_some_and(|node| node.kind == NodeKind::Camp)
            });
            Ok(if camp_endpoint { "jungle_camp" } else { "jungle" }.into())
        }
        EdgeClass::Other => Err(adapter_error(
            "unsupported_edge_class",
            format!("BattleMap has no typed region projection for edge '{from}'-'{to}'"),
        )),
    }
}

fn validate_edge_terrain(
    simulation: &CanonicalSimulationWorld,
    edge_id: &str,
    class: EdgeClass,
) -> Result<(), WorldMapAdapterError> {
    let profile_id = simulation
        .terrain
        .edge_profiles
        .get(edge_id)
        .ok_or_else(|| {
            adapter_error(
                "missing_edge_terrain",
                format!("edge '{edge_id}' has no terrain profile"),
            )
        })?;
    let profile = simulation.terrain.profiles.get(profile_id).ok_or_else(|| {
        adapter_error(
            "missing_terrain_profile",
            format!("edge '{edge_id}' references missing terrain profile '{profile_id}'"),
        )
    })?;
    let expected_kind = match class {
        EdgeClass::Lane => TerrainKind::Lane,
        EdgeClass::Jungle => TerrainKind::Jungle,
        EdgeClass::Other => {
            return Err(adapter_error(
                "unsupported_edge_class",
                format!("BattleMap cannot express terrain for edge '{edge_id}'"),
            ));
        }
    };
    if profile.kind != expected_kind {
        return Err(adapter_error(
            "unrepresentable_edge_terrain",
            format!(
                "edge '{edge_id}' terrain kind is not representable by the current BattleMap rules"
            ),
        ));
    }
    Ok(())
}

fn battle_map_track_semantics(
    class: EdgeClass,
    crossing: Option<&senkei_world::RiverCrossingDefinition>,
    tracks: &[senkei_world::TrackRangeDefinition],
    length: i64,
) -> bool {
    let expected: BTreeSet<_> = match (class, crossing.map(|value| value.kind)) {
        (
            EdgeClass::Lane,
            Some(RiverCrossingKind::FixedBridge | RiverCrossingKind::FixedFacilityBridge),
        ) => {
            [TrackKind::Center].into_iter().collect()
        }
        (EdgeClass::Lane, None) => [TrackKind::Left, TrackKind::Center, TrackKind::Right]
            .into_iter()
            .collect(),
        (EdgeClass::Jungle, _) => [TrackKind::Single].into_iter().collect(),
        (EdgeClass::Other, _) => return false,
        (EdgeClass::Lane, Some(RiverCrossingKind::FootFord)) => return false,
    };
    let actual: BTreeSet<_> = tracks.iter().map(|track| track.kind).collect();
    actual == expected
        && tracks.iter().all(|track| {
            track.start_progress_wu == 0
                && i64::try_from(track.end_progress_wu).ok() == Some(length)
                && match track.kind {
                    TrackKind::Left => track.id == "left",
                    TrackKind::Center => track.id == "center",
                    TrackKind::Right => track.id == "right",
                    TrackKind::Single => track.id == "single",
                    TrackKind::Other => false,
                }
        })
}

fn compare_world_map(
    adapter: &RuntimeBattleMapProjection,
    runtime_map: &BattleMap,
) -> WorldMapCompatibilityReport {
    let source = &adapter.candidate_map;
    let source_nodes: BTreeSet<_> = source.nodes.keys().cloned().collect();
    let runtime_nodes: BTreeSet<_> = runtime_map.nodes.keys().cloned().collect();
    let source_edges: BTreeSet<_> = source.edges.iter().map(|edge| edge.id.clone()).collect();
    let runtime_edges: BTreeSet<_> = runtime_map.edges.iter().map(|edge| edge.id.clone()).collect();
    let missing_node_ids = runtime_nodes.difference(&source_nodes).cloned().collect();
    let unexpected_node_ids = source_nodes.difference(&runtime_nodes).cloned().collect();
    let missing_edge_ids = runtime_edges.difference(&source_edges).cloned().collect();
    let unexpected_edge_ids = source_edges.difference(&runtime_edges).cloned().collect();

    let source_pairs = edge_pair_map(&source.edges);
    let runtime_pairs = edge_pair_map(&runtime_map.edges);
    let source_pair_ids: BTreeSet<_> = source_pairs.keys().cloned().collect();
    let runtime_pair_ids: BTreeSet<_> = runtime_pairs.keys().cloned().collect();
    let missing_endpoint_pairs = runtime_pair_ids
        .difference(&source_pair_ids)
        .map(|pair| format!("{}--{}", pair.0, pair.1))
        .collect();
    let unexpected_endpoint_pairs = source_pair_ids
        .difference(&runtime_pair_ids)
        .map(|pair| format!("{}--{}", pair.0, pair.1))
        .collect();

    let mut edge_length_mismatches = Vec::new();
    let mut bridge_site_mismatches = Vec::new();
    let mut edge_semantics_match = true;
    let mut endpoint_order_matches = true;
    for (pair, source_edge) in &source_pairs {
        let Some(runtime_edge) = runtime_pairs.get(pair) else {
            continue;
        };
        if source_edge.length != runtime_edge.length {
            edge_length_mismatches.push(format!(
                "{}--{}: World {} WU, runtime {} WU",
                pair.0, pair.1, source_edge.length, runtime_edge.length
            ));
        }
        if source_edge.from != runtime_edge.from || source_edge.to != runtime_edge.to {
            endpoint_order_matches = false;
        }
        if source_edge.bridge_site != runtime_edge.bridge_site {
            bridge_site_mismatches.push(format!(
                "{}--{}: World '{}', runtime '{}'",
                pair.0, pair.1, source_edge.bridge_site, runtime_edge.bridge_site
            ));
        }
        edge_semantics_match &= source_edge.region == runtime_edge.region
            && source_edge.bridge_site == runtime_edge.bridge_site
            && source_edge.ford == runtime_edge.ford
            && source_edge.blocked == runtime_edge.blocked;
    }

    let mut node_semantics_match = true;
    for id in source_nodes.intersection(&runtime_nodes) {
        let source_node = &source.nodes[id];
        let runtime_node = &runtime_map.nodes[id];
        node_semantics_match &= source_node.allegiance == runtime_node.allegiance
            && source_node.region == runtime_node.region;
    }
    let track_mismatches = nonrepresentable_tracks(&adapter.simulation);
    let terrain_mismatches = nonrepresentable_terrain(&adapter.simulation);
    let non_full_crossing_ranges = non_full_crossings(&adapter.simulation);

    let world_id_matches = adapter.identity.world_id == runtime_map.id;
    let node_ids_match = source_nodes == runtime_nodes;
    let edge_ids_match = source_edges == runtime_edges;
    let endpoint_pairs_match = source_pair_ids == runtime_pair_ids;
    let logical_distances_match = endpoint_pairs_match && edge_length_mismatches.is_empty();
    let lane_routes_match = source.lanes == runtime_map.lanes
        && source.attacker_base == runtime_map.attacker_base
        && source.defender_base == runtime_map.defender_base;
    let tower_sites_match = tower_map(&source.towers) == tower_map(&runtime_map.towers);
    let tracks_representable = track_mismatches.is_empty();
    let terrain_representable = terrain_mismatches.is_empty();
    let crossing_ranges_representable = non_full_crossing_ranges.is_empty();
    let node_exact = node_ids_match && node_semantics_match;
    let edge_exact = edge_ids_match
        && endpoint_pairs_match
        && endpoint_order_matches
        && logical_distances_match
        && edge_semantics_match;
    let exact = world_id_matches
        && node_exact
        && edge_exact
        && lane_routes_match
        && tower_sites_match
        && tracks_representable
        && terrain_representable
        && crossing_ranges_representable;
    let graph_and_lengths = node_ids_match
        && endpoint_pairs_match
        && logical_distances_match
        && node_semantics_match;
    let class = if exact {
        WorldMapCompatibilityClass::Exact
    } else if graph_and_lengths {
        WorldMapCompatibilityClass::GraphAndLengthsMatch
    } else {
        WorldMapCompatibilityClass::Incompatible
    };

    WorldMapCompatibilityReport {
        class,
        world_id_matches,
        node_ids_match,
        node_semantics_match,
        edge_ids_match,
        endpoint_pairs_match,
        endpoint_order_matches,
        logical_distances_match,
        edge_semantics_match,
        lane_routes_match,
        tower_sites_match,
        tracks_representable,
        terrain_representable,
        crossing_ranges_representable,
        missing_node_ids,
        unexpected_node_ids,
        missing_edge_ids,
        unexpected_edge_ids,
        missing_endpoint_pairs,
        unexpected_endpoint_pairs,
        edge_length_mismatches,
        bridge_site_mismatches,
        non_full_crossing_ranges,
        track_mismatches,
        terrain_mismatches,
    }
}

fn edge_pair_map(edges: &[MapEdge]) -> BTreeMap<(String, String), &MapEdge> {
    edges
        .iter()
        .map(|edge| {
            let pair = if edge.from <= edge.to {
                (edge.from.clone(), edge.to.clone())
            } else {
                (edge.to.clone(), edge.from.clone())
            };
            (pair, edge)
        })
        .collect()
}

fn tower_map(towers: &[TowerPlacement]) -> BTreeMap<&str, &TowerPlacement> {
    towers.iter().map(|tower| (tower.id.as_str(), tower)).collect()
}

fn non_full_crossings(simulation: &CanonicalSimulationWorld) -> Vec<String> {
    simulation
        .metric
        .river_crossing_ranges
        .iter()
        .filter_map(|(edge_id, crossing)| {
            let length = simulation.metric.edge_lengths_wu.get(edge_id)?;
            (crossing.start_progress_wu != 0 || crossing.end_progress_wu != *length).then(|| {
                format!(
                    "{edge_id}: [{}, {}] of [0, {length}] WU",
                    crossing.start_progress_wu, crossing.end_progress_wu
                )
            })
        })
        .collect()
}

fn nonrepresentable_tracks(simulation: &CanonicalSimulationWorld) -> Vec<String> {
    simulation
        .topology
        .edges
        .iter()
        .filter_map(|(edge_id, edge)| {
            let length = i64::try_from(*simulation.metric.edge_lengths_wu.get(edge_id)?).ok()?;
            let tracks = simulation.metric.edge_tracks.get(edge_id)?;
            (!battle_map_track_semantics(
                edge.class,
                edge.river_crossing.as_ref(),
                tracks,
                length,
            ))
            .then(|| edge_id.clone())
        })
        .collect()
}

fn nonrepresentable_terrain(simulation: &CanonicalSimulationWorld) -> Vec<String> {
    simulation
        .topology
        .edges
        .iter()
        .filter_map(|(edge_id, edge)| {
            let profile_id = simulation.terrain.edge_profiles.get(edge_id)?;
            let profile = simulation.terrain.profiles.get(profile_id)?;
            (validate_edge_terrain(simulation, edge_id, edge.class).is_err()
                || profile.observation != ObservationSemantics::Open)
                .then(|| edge_id.clone())
        })
        .collect()
}

/// Previous runtime topology, retained only as an adapter comparison fixture.
#[cfg(test)]
pub fn legacy_battle_map() -> BattleMap {
    let mut nodes = BTreeMap::new();
    let mut add_node = |id: &str, x: i64, y: i64, region: &str, allegiance: &str| {
        nodes.insert(
            id.into(),
            MapNode {
                x,
                y,
                presentation_x: 0,
                presentation_y: 0,
                region: region.into(),
                allegiance: allegiance.into(),
            },
        );
    };
    add_node("A.BASE", 80, 1520, "base", "A");
    add_node("B.BASE", 1520, 80, "base", "B");
    for (id, x, y, region, allegiance) in [
        // TOP forms the upper outer arc. B-side coordinates are the exact
        // diagonal mirror of A, and BOT is the opposing-side 180° rotation.
        ("A.TOP.T1", 220, 1200, "top", "A"),
        ("A.TOP.T2", 220, 850, "top", "A"),
        ("A.TOP.J", 260, 520, "top", "A"),
        ("A.TOP.BANK", 350, 430, "riverbank", "A"),
        ("B.TOP.BANK", 430, 350, "riverbank", "B"),
        ("B.TOP.J", 520, 260, "top", "B"),
        ("B.TOP.T2", 850, 220, "top", "B"),
        ("B.TOP.T1", 1200, 220, "top", "B"),
        // MID remains on x + y = 1600 and frames the river-island objective.
        ("A.MID.T1", 330, 1270, "mid", "A"),
        ("A.MID.T2", 510, 1090, "mid", "A"),
        ("A.MID.J", 650, 950, "mid", "A"),
        ("A.MID.BANK", 735, 865, "riverbank", "A"),
        ("B.MID.BANK", 865, 735, "riverbank", "B"),
        ("B.MID.J", 950, 650, "mid", "B"),
        ("B.MID.T2", 1090, 510, "mid", "B"),
        ("B.MID.T1", 1270, 330, "mid", "B"),
        // BOT is exactly the 180° rotation of the opposite TOP side.
        ("A.BOT.T1", 400, 1380, "bot", "A"),
        ("A.BOT.T2", 750, 1380, "bot", "A"),
        ("A.BOT.J", 1080, 1340, "bot", "A"),
        ("A.BOT.BANK", 1170, 1250, "riverbank", "A"),
        ("B.BOT.BANK", 1250, 1170, "riverbank", "B"),
        ("B.BOT.J", 1340, 1080, "bot", "B"),
        ("B.BOT.T2", 1380, 750, "bot", "B"),
        ("B.BOT.T1", 1380, 400, "bot", "B"),
        ("N.MID.OBS", 800, 800, "observation", "N"),
        // Upper/lower jungle crossings meet the diagonal river between fixed
        // bridge sites. Camp terminals sit off the jungle trunk paths.
        ("N.A.UJ", 450, 700, "jungle", "N"),
        ("N.B.UJ", 700, 450, "jungle", "N"),
        ("N.A.LJ", 900, 1150, "jungle", "N"),
        ("N.B.LJ", 1150, 900, "jungle", "N"),
        ("N.A.UC", 350, 780, "camp", "N"),
        ("N.B.UC", 780, 350, "camp", "N"),
        ("N.A.LC", 820, 1250, "camp", "N"),
        ("N.B.LC", 1250, 820, "camp", "N"),
    ] {
        add_node(id, x, y, region, allegiance);
    }

    let mut edges = Vec::with_capacity(42);
    let mut add_edge = |id: &str,
                        from: &str,
                        to: &str,
                        length: i64,
                        region: &str,
                        bridge_site: &str,
                        ford: bool| {
        edges.push(MapEdge {
            id: id.into(),
            from: from.into(),
            to: to.into(),
            length,
            region: region.into(),
            blocked: false,
            bridge_site: bridge_site.into(),
            ford,
        });
    };
    for lane in ["TOP", "MID", "BOT"] {
        let a = format!("A.{lane}");
        let b = format!("B.{lane}");
        add_edge(
            &format!("lane.{lane}.a-base-t1"),
            "A.BASE",
            &format!("{a}.T1"),
            150,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.a-t1-t2"),
            &format!("{a}.T1"),
            &format!("{a}.T2"),
            150,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.a-t2-j"),
            &format!("{a}.T2"),
            &format!("{a}.J"),
            100,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.a-j-bank"),
            &format!("{a}.J"),
            &format!("{a}.BANK"),
            50,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.b-bank-j"),
            &format!("{b}.BANK"),
            &format!("{b}.J"),
            50,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.b-j-t2"),
            &format!("{b}.J"),
            &format!("{b}.T2"),
            100,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.b-t2-t1"),
            &format!("{b}.T2"),
            &format!("{b}.T1"),
            150,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.b-t1-base"),
            &format!("{b}.T1"),
            "B.BASE",
            150,
            "lane",
            "",
            false,
        );
    }
    add_edge(
        "bridge.TOP",
        "A.TOP.BANK",
        "B.TOP.BANK",
        100,
        "bridge",
        "TOP",
        false,
    );
    add_edge(
        "bridge.BOT",
        "A.BOT.BANK",
        "B.BOT.BANK",
        100,
        "bridge",
        "BOT",
        false,
    );
    add_edge(
        "bridge.MID.A",
        "A.MID.BANK",
        "N.MID.OBS",
        50,
        "bridge",
        "MID",
        false,
    );
    add_edge(
        "bridge.MID.B",
        "N.MID.OBS",
        "B.MID.BANK",
        50,
        "bridge",
        "MID",
        false,
    );
    for (side, upper, middle, lower) in [("A", "TOP", "MID", "BOT"), ("B", "TOP", "MID", "BOT")] {
        add_edge(
            &format!("jungle.{side}.upper-1"),
            &format!("{side}.{upper}.J"),
            &format!("N.{side}.UJ"),
            325,
            "jungle",
            "",
            false,
        );
        add_edge(
            &format!("jungle.{side}.upper-2"),
            &format!("N.{side}.UJ"),
            &format!("{side}.{middle}.J"),
            325,
            "jungle",
            "",
            false,
        );
        add_edge(
            &format!("jungle.{side}.lower-1"),
            &format!("{side}.{middle}.J"),
            &format!("N.{side}.LJ"),
            325,
            "jungle",
            "",
            false,
        );
        add_edge(
            &format!("jungle.{side}.lower-2"),
            &format!("N.{side}.LJ"),
            &format!("{side}.{lower}.J"),
            325,
            "jungle",
            "",
            false,
        );
        add_edge(
            &format!("jungle.{side}.upper-camp"),
            &format!("N.{side}.UJ"),
            &format!("N.{side}.UC"),
            45,
            "jungle_camp",
            "",
            false,
        );
        add_edge(
            &format!("jungle.{side}.lower-camp"),
            &format!("N.{side}.LJ"),
            &format!("N.{side}.LC"),
            45,
            "jungle_camp",
            "",
            false,
        );
    }
    add_edge(
        "ford.jungle.upper",
        "N.A.UJ",
        "N.B.UJ",
        620,
        "river_ford",
        "",
        true,
    );
    add_edge(
        "ford.jungle.lower",
        "N.A.LJ",
        "N.B.LJ",
        620,
        "river_ford",
        "",
        true,
    );

    let lanes = BTreeMap::from([
        (
            "top".into(),
            [
                "A.BASE",
                "A.TOP.T1",
                "A.TOP.T2",
                "A.TOP.J",
                "A.TOP.BANK",
                "B.TOP.BANK",
                "B.TOP.J",
                "B.TOP.T2",
                "B.TOP.T1",
                "B.BASE",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        ),
        (
            "mid".into(),
            [
                "A.BASE",
                "A.MID.T1",
                "A.MID.T2",
                "A.MID.J",
                "A.MID.BANK",
                "N.MID.OBS",
                "B.MID.BANK",
                "B.MID.J",
                "B.MID.T2",
                "B.MID.T1",
                "B.BASE",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        ),
        (
            "bot".into(),
            [
                "A.BASE",
                "A.BOT.T1",
                "A.BOT.T2",
                "A.BOT.J",
                "A.BOT.BANK",
                "B.BOT.BANK",
                "B.BOT.J",
                "B.BOT.T2",
                "B.BOT.T1",
                "B.BASE",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        ),
    ]);
    let towers = ["TOP", "MID", "BOT"]
        .into_iter()
        .flat_map(|lane| {
            [
                TowerPlacement {
                    id: format!("tower_a_{lane}_t1"),
                    node: format!("A.{lane}.T1"),
                    side: "attacker".into(),
                    lane: lane.to_lowercase(),
                },
                TowerPlacement {
                    id: format!("tower_a_{lane}_t2"),
                    node: format!("A.{lane}.T2"),
                    side: "attacker".into(),
                    lane: lane.to_lowercase(),
                },
                TowerPlacement {
                    id: format!("tower_b_{lane}_t1"),
                    node: format!("B.{lane}.T1"),
                    side: "defender".into(),
                    lane: lane.to_lowercase(),
                },
                TowerPlacement {
                    id: format!("tower_b_{lane}_t2"),
                    node: format!("B.{lane}.T2"),
                    side: "defender".into(),
                    lane: lane.to_lowercase(),
                },
            ]
        })
        .collect();
    BattleMap {
        id: BATTLEFIELD_MAP_ID.into(),
        world_identity: None,
        world_projection: None,
        nodes,
        edges,
        lanes,
        attacker_base: "A.BASE".into(),
        defender_base: "B.BASE".into(),
        towers,
    }
}

/// Compile the authored World and produce its versioned runtime projection.
/// Route and tower metadata is supplied explicitly to the projector because
/// the current World Definition schema does not author those items yet.
pub fn battle_map() -> BattleMap {
    let world = compiled_authored_world();
    project_verified_world(&world, None)
        .expect("checked-in World and explicit route/tower projection are compatible")
        .runtime_map()
        .clone()
}

/// Exact arithmetic time over a route, using distance and terrain millirates.
#[cfg(test)]
pub fn normalized_route_time_milli(distance: i64, terrain_speed_milli: i64) -> Option<i64> {
    if distance < 0 || terrain_speed_milli <= 0 {
        return None;
    }
    i64::try_from(i128::from(distance).checked_mul(1_000_000)? / i128::from(terrain_speed_milli))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    fn authored_world_definition() -> senkei_world::WorldDefinition {
        serde_json::from_str(include_str!(
            "../../senkei-world/fixtures/initial-battlefield.json"
        ))
        .expect("checked-in World Definition parses")
    }

    fn rules_projection(map: &BattleMap) -> BattleMap {
        let mut projection = map.clone();
        // Identity includes the paired presentation digest, so strip it when
        // comparing simulation-only map semantics.
        projection.world_identity = None;
        if let Some(source) = projection.world_projection.as_mut() {
            source.source_identity.presentation_digest =
                senkei_model::ContentDigest::new("0".repeat(64));
        }
        for node in projection.nodes.values_mut() {
            node.presentation_x = 0;
            node.presentation_y = 0;
        }
        projection
    }

    #[test]
    fn authored_world_adapter_preserves_ids_and_reports_v2_non_equivalence() {
        let world = compiled_authored_world();
        let runtime = legacy_battle_map();
        assert_eq!(world.simulation_world().topology.nodes.len(), 35);
        assert_eq!(world.simulation_world().topology.edges.len(), 42);
        assert_eq!(
            world
                .simulation_world()
                .metric
                .edge_lengths_wu
                .values()
                .sum::<u64>(),
            7_020
        );

        let metadata = ExplicitBattleMapMetadata::from_runtime_map(&runtime);
        let adapted = project_verified_world(&world, None)
            .expect("World Definition directly authors its versioned lane and tower layout");
        let confirmed = project_verified_world(&world, Some(&metadata))
            .expect("matching supplemental metadata confirms the canonical authored layout");
        assert_eq!(adapted.runtime_map(), confirmed.runtime_map());
        assert_eq!(adapted.identity().world_id, "senkei-battlefield");
        assert_ne!(adapted.identity().world_id, BATTLEFIELD_MAP_ID);
        assert_eq!(adapted.simulation_world(), world.simulation_world());
        assert_eq!(
            adapted
                .candidate_map
                .edges
                .iter()
                .map(|edge| edge.id.as_str())
                .collect::<BTreeSet<_>>(),
            world
                .simulation_world()
                .topology
                .edges
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            "the adapter preserves stable World edge IDs instead of renaming them"
        );

        let report = adapted.compatibility_report(&runtime);
        assert_eq!(report.class, WorldMapCompatibilityClass::GraphAndLengthsMatch);
        assert!(!report.is_compatible());
        assert!(!report.world_id_matches);
        assert!(report.node_ids_match);
        assert!(report.node_semantics_match);
        assert!(!report.edge_ids_match);
        assert_eq!(report.missing_edge_ids.len(), 42);
        assert_eq!(report.unexpected_edge_ids.len(), 42);
        assert!(report
            .missing_edge_ids
            .contains(&"lane.TOP.a-base-t1".to_owned()));
        assert!(report
            .unexpected_edge_ids
            .contains(&"edge-a-base-a-top-t1".to_owned()));
        assert!(report.endpoint_pairs_match);
        assert!(report.logical_distances_match);
        assert!(report.edge_length_mismatches.is_empty());
        assert_eq!(report.bridge_site_mismatches.len(), 4);
        assert_eq!(report.non_full_crossing_ranges.len(), 4);
        assert!(report
            .non_full_crossing_ranges
            .iter()
            .any(|range| range.starts_with("edge-a-mid-bank-n-mid-obs: [40, 50]")));
        assert!(report
            .non_full_crossing_ranges
            .iter()
            .any(|range| range.starts_with("edge-n-a-uj-n-b-uj: [260, 360]")));
        assert!(!report.crossing_ranges_representable);
        assert!(report.tracks_representable);
        assert!(!report.terrain_representable);
        assert_eq!(report.terrain_mismatches.len(), 14);
        assert!(report.lane_routes_match);
        assert!(report.tower_sites_match);
        assert!(adapted.battle_map_if_compatible(&runtime).is_err());
    }

    #[test]
    fn presentation_only_world_edit_changes_digest_not_runtime_rules() {
        let first = compiled_authored_world();
        let mut changed_definition = authored_world_definition();
        changed_definition.presentation.lighting.key_percent += 1;
        changed_definition
            .presentation
            .materials
            .iter_mut()
            .find(|material| material.id == "mat.node")
            .expect("authored presentation includes node material")
            .color = "#123456".into();
        let changed = senkei_world::compile(changed_definition)
            .expect("presentation-only edits remain a valid World");

        assert_eq!(
            first.identity().logic_digest,
            changed.identity().logic_digest,
            "presentation edits cannot alter the simulation digest"
        );
        assert_ne!(
            first.identity().presentation_digest,
            changed.identity().presentation_digest
        );
        assert_eq!(first.simulation_world(), changed.simulation_world());

        let runtime = legacy_battle_map();
        let metadata = ExplicitBattleMapMetadata::from_runtime_map(&runtime);
        let first_adapter = project_verified_world(&first, Some(&metadata)).unwrap();
        let changed_adapter = project_verified_world(&changed, Some(&metadata)).unwrap();
        assert_ne!(
            first_adapter.presentation_world().materials["mat.node"].color,
            changed_adapter.presentation_world().materials["mat.node"].color
        );
        assert_eq!(
            rules_projection(&first_adapter.candidate_map),
            rules_projection(&changed_adapter.candidate_map),
            "the BattleMap rule projection excludes presentation identity and coordinates"
        );
        assert_eq!(
            first_adapter.compatibility_report(&runtime),
            changed_adapter.compatibility_report(&runtime),
            "presentation edits cannot change runtime compatibility classification"
        );
    }

    fn edge_exists(map: &BattleMap, a: &str, b: &str) -> bool {
        map.edges
            .iter()
            .any(|e| (e.from == a && e.to == b) || (e.from == b && e.to == a))
    }
    fn path_distance(map: &BattleMap, route: &[String]) -> i64 {
        route
            .windows(2)
            .map(|w| {
                map.edges
                    .iter()
                    .find(|e| (e.from == w[0] && e.to == w[1]) || (e.from == w[1] && e.to == w[0]))
                    .expect("connected consecutive nodes")
                    .length
            })
            .sum()
    }
    fn route_distance(map: &BattleMap, lane: &str) -> i64 {
        path_distance(map, &map.lanes[lane])
    }

    #[test]
    fn canonical_topology_has_exact_ids_edges_sites_and_no_hidden_shortcuts() {
        let map = battle_map();
        assert_eq!(map.id, BATTLEFIELD_MAP_ID);
        assert!(map.world_projection.is_some());
        assert_eq!(map.nodes.len(), 35);
        assert_eq!(map.edges.len(), 42);
        assert_eq!(map.towers.len(), 12);
        assert_eq!(
            map.nodes.values().filter(|n| n.allegiance == "A").count(),
            13
        );
        assert_eq!(
            map.nodes.values().filter(|n| n.allegiance == "B").count(),
            13
        );
        assert_eq!(
            map.nodes.values().filter(|n| n.allegiance == "N").count(),
            9
        );
        let ids: BTreeSet<_> = map.nodes.keys().collect();
        assert_eq!(ids.len(), 35);
        let edge_ids: BTreeSet<_> = map.edges.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(edge_ids.len(), 42);
        let pairs: BTreeSet<_> = map
            .edges
            .iter()
            .map(|e| {
                let (a, b) = if e.from < e.to {
                    (&e.from, &e.to)
                } else {
                    (&e.to, &e.from)
                };
                (a.clone(), b.clone())
            })
            .collect();
        assert_eq!(pairs.len(), 42);
        for e in &map.edges {
            assert!(map.nodes.contains_key(&e.from) && map.nodes.contains_key(&e.to));
            assert!(e.length > 0 && !e.blocked);
        }
        let bridge_sites: BTreeMap<_, Vec<_>> = ["bridge.top", "bridge.mid", "bridge.bot"]
            .into_iter()
            .map(|site| {
                (
                    site,
                    map.edges.iter().filter(|e| e.bridge_site == site).collect(),
                )
            })
            .collect();
        assert_eq!(bridge_sites["bridge.top"].len(), 1);
        assert_eq!(bridge_sites["bridge.bot"].len(), 1);
        assert_eq!(bridge_sites["bridge.mid"].len(), 2);
        assert!(map.edges.iter().filter(|e| !e.bridge_site.is_empty()).all(|e| !e.ford), "a bridge-site edge is not a permanent ford; breakage enables ford traversal dynamically");
        assert_eq!(
            map.edges.iter().filter(|e| e.ford).count(),
            2,
            "only Jungle river crossings are permanent fords"
        );
        assert_eq!(
            map.edges
                .iter()
                .filter(|e| e.region == "jungle" || e.region == "jungle_camp")
                .filter(|e| !e.bridge_site.is_empty())
                .count(),
            0
        );
        assert!(map
            .edges
            .iter()
            .filter(|e| e.region == "river_ford")
            .all(|e| e.bridge_site.is_empty() && e.ford));
        for lane in ["top", "mid", "bot"] {
            let route = &map.lanes[lane];
            assert_eq!(route.first().map(String::as_str), Some("A.BASE"));
            assert_eq!(route.last().map(String::as_str), Some("B.BASE"));
            assert!(route.windows(2).all(|p| edge_exists(&map, &p[0], &p[1])));
            assert_eq!(route_distance(&map, lane), 1000, "{lane}");
        }
        for lane in ["bridge.top", "bridge.bot"] {
            assert_eq!(
                map.edges
                    .iter()
                    .find(|e| e.bridge_site == lane)
                    .unwrap()
                    .length,
                100
            );
        }
        assert_eq!(
            map.edges
                .iter()
                .filter(|e| e.bridge_site == "bridge.mid")
                .map(|e| e.length)
                .sum::<i64>(),
            100
        );
        assert!(
            map.nodes["A.BASE"].x < map.nodes["B.BASE"].x
                && map.nodes["A.BASE"].y > map.nodes["B.BASE"].y
        );
        assert!(map.nodes["N.MID.OBS"].allegiance == "N");
    }

    #[test]
    fn visual_embedding_keeps_lane_arcs_river_crossings_and_side_symmetry() {
        let map = battle_map();
        let mut rotation_pairs = vec![
            ("A.BASE".to_owned(), "B.BASE".to_owned()),
            ("N.MID.OBS".to_owned(), "N.MID.OBS".to_owned()),
        ];
        for segment in ["T1", "T2", "J", "BANK"] {
            for (a_lane, b_lane) in [("TOP", "BOT"), ("MID", "MID"), ("BOT", "TOP")] {
                rotation_pairs.push((
                    format!("A.{a_lane}.{segment}"),
                    format!("B.{b_lane}.{segment}"),
                ));
            }
        }
        rotation_pairs.extend([
            ("N.A.UJ".to_owned(), "N.B.LJ".to_owned()),
            ("N.B.UJ".to_owned(), "N.A.LJ".to_owned()),
            ("N.A.UC".to_owned(), "N.B.LC".to_owned()),
            ("N.B.UC".to_owned(), "N.A.LC".to_owned()),
        ]);
        for (a, b) in rotation_pairs {
            assert_eq!(
                (map.nodes[&b].presentation_x, map.nodes[&b].presentation_y),
                (1200 - map.nodes[&a].presentation_x, 900 - map.nodes[&a].presentation_y),
                "{a} ↔ {b} 180° rotation symmetry"
            );
        }

        let point = |id: &str| (map.nodes[id].presentation_x, map.nodes[id].presentation_y);
        for id in [
            "A.TOP.BANK",
            "B.TOP.BANK",
            "A.MID.BANK",
            "B.MID.BANK",
            "A.BOT.BANK",
            "B.BOT.BANK",
        ] {
            let (x, y) = point(id);
            // 75 WU is just over 2.1 render units perpendicular to x = y.
            assert!(
                (x - y).abs() >= 75,
                "{id} must stay dry outside the 4.05-unit river ribbon"
            );
        }
        let edge_midpoint = |id: &str| {
            let edge = map.edges.iter().find(|edge| edge.id == id).unwrap();
            let (x1, y1) = point(&edge.from);
            let (x2, y2) = point(&edge.to);
            ((x1 + x2) / 2, (y1 + y2) / 2)
        };
        let river_crossings = [
            edge_midpoint("edge-a-top-bank-b-top-bank"),
            edge_midpoint("edge-n-a-uj-n-b-uj"),
            point("N.MID.OBS"),
            edge_midpoint("edge-n-a-lj-n-b-lj"),
            edge_midpoint("edge-a-bot-bank-b-bot-bank"),
        ];
        assert_eq!(
            river_crossings,
            [
                (600, 120),
                (600, 285),
                (600, 450),
                (600, 615),
                (600, 780)
            ]
        );
        assert!(river_crossings
            .windows(2)
            .all(|pair| pair[0].0 == pair[1].0 && pair[0].1 < pair[1].1));
        assert!(map.nodes.values().all(|node| {
            (0..=1200).contains(&node.presentation_x)
                && (0..=900).contains(&node.presentation_y)
        }));
    }

    #[test]
    fn jungle_camps_fords_are_real_reachable_branches_and_rotation_is_symmetric() {
        let map = battle_map();
        let adjacency = |start: &str| {
            let mut seen = BTreeSet::from([start.to_owned()]);
            let mut queue = vec![start.to_owned()];
            while let Some(n) = queue.pop() {
                for e in &map.edges {
                    let next = if e.from == n {
                        Some(e.to.as_str())
                    } else if e.to == n {
                        Some(e.from.as_str())
                    } else {
                        None
                    };
                    if let Some(next) = next {
                        if seen.insert(next.to_owned()) {
                            queue.push(next.to_owned());
                        }
                    }
                }
            }
            seen
        };
        let all = adjacency("A.BASE");
        assert_eq!(
            all.len(),
            35,
            "unexpected reachable ids: {:?}",
            all.difference(&map.nodes.keys().cloned().collect())
                .collect::<Vec<_>>()
        );
        for camp in ["N.A.UC", "N.B.UC", "N.A.LC", "N.B.LC"] {
            assert!(all.contains(camp));
            assert_eq!(
                map.edges
                    .iter()
                    .filter(|e| e.from == camp || e.to == camp)
                    .count(),
                1,
                "camp is a terminal branch"
            );
        }
        for lane in ["TOP", "MID", "BOT"] {
            let a = format!("A.{lane}.T1");
            let b = format!("B.{lane}.T1");
            assert_eq!(map.nodes[&a].allegiance, "A");
            assert_eq!(map.nodes[&b].allegiance, "B");
        }
        let lane_side = [
            "A.TOP.J", "A.TOP.T2", "A.TOP.T1", "A.BASE", "A.MID.T1", "A.MID.T2", "A.MID.J",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
        let jungle = ["A.TOP.J", "N.A.UJ", "A.MID.J"]
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(path_distance(&map, &lane_side), 800);
        assert_eq!(path_distance(&map, &jungle), 650);
        assert_eq!(
            normalized_route_time_milli(path_distance(&map, &lane_side), 1_000),
            Some(800_000)
        );
        assert_eq!(
            normalized_route_time_milli(path_distance(&map, &jungle), 800),
            Some(812_500)
        );
        assert_eq!(
            normalized_route_time_milli(path_distance(&map, &jungle), 1_000),
            Some(650_000)
        );
        for lane in ["TOP", "MID", "BOT"] {
            let a: Vec<_> = map
                .edges
                .iter()
                .filter(|e| e.id.starts_with(&format!("lane.{lane}.a-")))
                .map(|e| e.length)
                .collect();
            let b: Vec<_> = map
                .edges
                .iter()
                .filter(|e| e.id.starts_with(&format!("lane.{lane}.b-")))
                .map(|e| e.length)
                .collect();
            assert_eq!(
                a.into_iter().rev().collect::<Vec<_>>(),
                b,
                "rotated lane segment lengths on {lane}"
            );
        }
        assert_eq!(
            map.edges
                .iter()
                .filter(|e| e.region == "river_ford")
                .count(),
            2
        );
    }
}
