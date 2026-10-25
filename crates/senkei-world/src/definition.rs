use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Explicit semantic and compiler version, encoded as a finite triple.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Version {
    pub major: u16,
    pub minor: u16,
    pub patch: u16,
}

impl Version {
    pub const fn new(major: u16, minor: u16, patch: u16) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }

    pub const fn is_zero(self) -> bool {
        self.major == 0 && self.minor == 0 && self.patch == 0
    }
}

/// Compatibility bounds use a half-open interval: min is inclusive, max is exclusive.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Compatibility {
    pub minimum_compiler: Version,
    pub maximum_compiler_exclusive: Option<Version>,
}

/// An optional, versioned validation profile selected by the author.
///
/// Omission opts into generic World validation. Unknown profiles are rejected;
/// a named profile cannot be accepted without running its checks.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ValidationProfileRef {
    pub id: String,
    pub version: Version,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldDefinition {
    pub schema_version: Version,
    pub id: String,
    pub compatibility: Compatibility,
    pub validation_profile: Option<ValidationProfileRef>,
    pub topology: TopologyDefinition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_layout: Option<RuntimeLayoutDefinition>,
    pub metric: MetricDefinition,
    pub terrain: TerrainDefinition,
    pub presentation: PresentationDefinition,
}

/// Logical bases, named lane routes, and tower placements needed by the
/// finite BattleMap runtime. These are gameplay topology, not presentation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeLayoutDefinition {
    pub attacker_base: String,
    pub defender_base: String,
    pub lanes: BTreeMap<String, Vec<String>>,
    pub towers: Vec<WorldTowerPlacement>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldTowerPlacement {
    pub id: String,
    pub node: String,
    pub side: String,
    pub lane: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyDefinition {
    /// Stable roots from which every node must be reachable through authored edge directionality.
    pub entry_nodes: Vec<String>,
    pub nodes: Vec<NodeDefinition>,
    pub edges: Vec<EdgeDefinition>,
    pub bridge_sites: Vec<BridgeSiteDefinition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeDefinition {
    pub id: String,
    pub allegiance: Allegiance,
    pub kind: NodeKind,
    /// Simulation-space coordinates, independent of the presentation view.
    pub logical_position: Point2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Allegiance {
    A,
    B,
    Neutral,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Base,
    Lane,
    Junction,
    Bank,
    JungleJunction,
    Camp,
    ObservationBase,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EdgeDefinition {
    pub id: String,
    pub from: String,
    pub to: String,
    pub directionality: Directionality,
    pub class: EdgeClass,
    pub river_crossing: Option<RiverCrossingDefinition>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Directionality {
    Bidirectional,
    FromTo,
    ToFrom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeClass {
    Lane,
    Jungle,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RiverCrossingDefinition {
    pub river_id: String,
    pub kind: RiverCrossingKind,
    pub bridge_site_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiverCrossingKind {
    FixedBridge,
    FixedFacilityBridge,
    FootFord,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BridgeSiteDefinition {
    pub id: String,
    pub kind: BridgeSiteKind,
    /// Crossing edges belonging to this fixed construction site.
    pub edge_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BridgeSiteKind {
    LaneBridge,
    FacilityBridge,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricDefinition {
    pub edge_lengths_wu: Vec<EdgeLengthDefinition>,
    pub edge_tracks: Vec<EdgeTracksDefinition>,
    pub river_crossing_ranges: Vec<RiverCrossingRangeDefinition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EdgeLengthDefinition {
    pub edge_id: String,
    /// Integer world units avoid float-dependent legality and identity.
    pub length_wu: u64,
}

/// Metric track set and the progress interval in which each path is usable.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EdgeTracksDefinition {
    pub edge_id: String,
    pub tracks: Vec<TrackRangeDefinition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrackRangeDefinition {
    pub id: String,
    pub kind: TrackKind,
    pub start_progress_wu: u64,
    pub end_progress_wu: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Left,
    Center,
    Right,
    Single,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RiverCrossingRangeDefinition {
    pub edge_id: String,
    pub river_id: String,
    pub start_progress_wu: u64,
    pub end_progress_wu: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerrainDefinition {
    pub profiles: Vec<TerrainProfileDefinition>,
    pub edge_profiles: Vec<EdgeTerrainDefinition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerrainProfileDefinition {
    pub id: String,
    pub kind: TerrainKind,
    /// Logical visibility semantics only; numeric effects belong to Senritsu.
    pub observation: ObservationSemantics,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerrainKind {
    Lane,
    Jungle,
    Riverbank,
    Camp,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservationSemantics {
    Open,
    Concealing,
    BlocksLineOfSight,
    ElevatedObservation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EdgeTerrainDefinition {
    pub edge_id: String,
    pub profile_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationDefinition {
    pub view_box: ViewBox,
    pub node_positions: Vec<NodeViewDefinition>,
    pub edge_paths: Vec<EdgePathDefinition>,
    pub rivers: Vec<RiverViewDefinition>,
    pub visual_regions: Vec<VisualRegionDefinition>,
    pub materials: Vec<MaterialDefinition>,
    pub lighting: LightingDefinition,
    pub foliage: Vec<FoliageDefinition>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewBox {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeViewDefinition {
    pub node_id: String,
    pub position: Point2,
    pub material_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EdgePathDefinition {
    pub edge_id: String,
    /// Ordered presentation-space centerline. It has no effect on WU distance.
    pub points: Vec<Point2>,
    pub visual_width: u32,
    pub material_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RiverViewDefinition {
    pub id: String,
    pub points: Vec<Point2>,
    pub visual_width: u32,
    pub material_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VisualRegionDefinition {
    pub id: String,
    pub terrain_profile_id: String,
    /// Polygon vertices; closure is implicit.
    pub outline: Vec<Point2>,
    pub material_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point2 {
    pub x: u32,
    pub y: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialDefinition {
    pub id: String,
    /// Lowercase or uppercase `#RRGGBB` sRGB literal.
    pub color: String,
    pub opacity_percent: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LightingDefinition {
    pub ambient_percent: u8,
    pub key_percent: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FoliageDefinition {
    pub id: String,
    pub region_id: String,
    pub species: String,
    /// Integer visual density in parts per thousand.
    pub density_per_mille: u16,
}

/// Compiler output's logic-only canonical simulation artifact.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalSimulationWorld {
    pub topology: CanonicalTopology,
    pub metric: CanonicalMetric,
    pub terrain: CanonicalTerrain,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalTopology {
    pub entry_nodes: std::collections::BTreeSet<String>,
    pub nodes: BTreeMap<String, NodeDefinition>,
    pub edges: BTreeMap<String, EdgeDefinition>,
    pub bridge_sites: BTreeMap<String, CanonicalBridgeSite>,
    pub runtime_layout: Option<RuntimeLayoutDefinition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalBridgeSite {
    pub id: String,
    pub kind: BridgeSiteKind,
    pub edge_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalMetric {
    pub edge_lengths_wu: BTreeMap<String, u64>,
    pub edge_tracks: BTreeMap<String, Vec<TrackRangeDefinition>>,
    pub river_crossing_ranges: BTreeMap<String, CanonicalRiverCrossingRange>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalRiverCrossingRange {
    pub river_id: String,
    pub start_progress_wu: u64,
    pub end_progress_wu: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalTerrain {
    pub profiles: BTreeMap<String, TerrainProfileDefinition>,
    pub edge_profiles: BTreeMap<String, String>,
}

/// Presentation-only output, separately canonicalized and hashed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalPresentationWorld {
    pub view_box: ViewBox,
    pub node_positions: BTreeMap<String, CanonicalNodeView>,
    pub edge_paths: BTreeMap<String, CanonicalEdgePath>,
    pub rivers: BTreeMap<String, CanonicalRiverView>,
    pub visual_regions: BTreeMap<String, CanonicalVisualRegion>,
    pub materials: BTreeMap<String, MaterialDefinition>,
    pub lighting: LightingDefinition,
    pub foliage: BTreeMap<String, FoliageDefinition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalNodeView {
    pub position: Point2,
    pub material_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalEdgePath {
    pub points: Vec<Point2>,
    pub visual_width: u32,
    pub material_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalRiverView {
    pub points: Vec<Point2>,
    pub visual_width: u32,
    pub material_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalVisualRegion {
    pub terrain_profile_id: String,
    pub outline: Vec<Point2>,
    pub material_id: String,
}
