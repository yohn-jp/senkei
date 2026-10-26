//! Versioned finite battle-system data; values are owned by Senritsu.
use crate::Version;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NextRules {
    pub mechanics_version: Version,
    /// Exact paired World artifact used to compile this ruleset. Required for
    /// verified next packages; `None` is retained only for legacy wire data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_identity: Option<WorldIdentityRef>,
    pub map: BattleMap,
    pub heroes: Vec<HeroDefinition>,
    pub minions: Vec<UnitDefinition>,
    pub monsters: Vec<UnitDefinition>,
    pub camps: Vec<CampDefinition>,
    pub parameters: BTreeMap<String, i64>,
}

/// Paired content identity copied from the sealed World compiler artifact.
/// The presentation digest identifies the matching scene; it is never a
/// simulation input. Digests alone do not replace the remaining identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldIdentityRef {
    pub world_id: String,
    pub schema_version: Version,
    /// Exact implementation version that compiled this World artifact.
    /// Compatibility bounds remain separate and never substitute for it.
    pub compiler_version: Version,
    pub minimum_compiler: Version,
    pub maximum_compiler_exclusive: Option<Version>,
    pub validation_profile_id: Option<String>,
    pub validation_profile_version: Option<Version>,
    pub logic_digest: crate::ContentDigest,
    pub presentation_digest: crate::ContentDigest,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BattleMap {
    pub id: String,
    /// Identity of the paired source World for a projected map.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_identity: Option<WorldIdentityRef>,
    /// Lossless versioned source facts that cannot be represented by the
    /// legacy edge/node fields alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_projection: Option<BattleMapWorldProjection>,
    pub nodes: BTreeMap<String, MapNode>,
    pub edges: Vec<MapEdge>,
    /// Ordered attacker-to-defender node identifiers.
    pub lanes: BTreeMap<String, Vec<String>>,
    pub attacker_base: String,
    pub defender_base: String,
    pub towers: Vec<TowerPlacement>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BattleMapWorldProjection {
    pub schema_version: Version,
    pub source_identity: WorldIdentityRef,
    pub node_ids: std::collections::BTreeSet<String>,
    pub edge_facts: BTreeMap<String, WorldEdgeFacts>,
    pub bridge_sites: BTreeMap<String, Vec<String>>,
    /// Canonical render geometry and materials from the same sealed World.
    /// This payload is exact-validated through WorldResolver and excluded
    /// from the simulation RulePackage digest.
    pub presentation_artifact: CanonicalPresentationWorldArtifact,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanonicalPresentationWorldArtifact {
    pub schema_version: Version,
    pub content: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldEdgeFacts {
    pub directionality: String,
    pub class: String,
    pub tracks: Vec<WorldTrackRange>,
    pub river_crossing: Option<WorldRiverCrossing>,
    pub terrain_profile_id: String,
    pub terrain_kind: String,
    pub observation_semantics: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldTrackRange {
    pub id: String,
    pub kind: String,
    pub start_progress_wu: u64,
    pub end_progress_wu: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldRiverCrossing {
    pub river_id: String,
    pub kind: String,
    pub bridge_site_id: Option<String>,
    pub start_progress_wu: u64,
    pub end_progress_wu: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapNode {
    /// Static geography: A, B, or N; never changes on capture.
    #[serde(default = "neutral_allegiance")]
    pub allegiance: String,
    pub x: i64,
    pub y: i64,
    /// Paired World presentation-space coordinates used by renderers only.
    #[serde(default)]
    pub presentation_x: i64,
    #[serde(default)]
    pub presentation_y: i64,
    pub region: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapEdge {
    /// Stable, versioned logical edge identity.
    #[serde(default)]
    pub id: String,
    /// Fixed construction site TOP, MID, BOT; empty for non-bridge edges.
    #[serde(default)]
    pub bridge_site: String,
    /// Permanent river crossing without a bridge site.
    #[serde(default)]
    pub ford: bool,
    pub from: String,
    pub to: String,
    pub length: i64,
    pub region: String,
    pub blocked: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TowerPlacement {
    pub id: String,
    pub node: String,
    pub side: String,
    pub lane: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnitStats {
    pub hp: i64,
    pub attack: i64,
    pub defense: i64,
    pub speed: i64,
    pub range: i64,
    pub attack_interval: i64,
    pub vision: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeroDefinition {
    pub id: String,
    pub name: String,
    pub placement: String,
    pub role: String,
    pub trait_id: String,
    pub appearance_key: String,
    pub stats: UnitStats,
    pub growth: UnitStats,
    pub skills: Vec<SkillDefinition>,
    pub skill_paths: BTreeMap<String, Vec<String>>,
    pub synergy: BTreeMap<String, i64>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillDefinition {
    pub id: String,
    pub name: String,
    pub passive: bool,
    pub unlock_level: i64,
    pub prerequisites: Vec<String>,
    pub cooldown: i64,
    pub cost: i64,
    pub range: i64,
    pub target: String,
    pub effect: SkillEffect,
    pub power: i64,
    pub duration: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillEffect {
    AreaDamage,
    Damage,
    Heal,
    Shield,
    Haste,
    Slow,
    Reveal,
    Empower,
    Defense,
    /// Replaces base terrain speed for the member carrying the skill.
    TerrainAdaptation,
    /// Replaces Jungle terrain speed for the owner only.
    JungleSpecialist,
    /// Solo-only additional movement multiplier.
    SoloMobility,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnitDefinition {
    pub id: String,
    pub stats: UnitStats,
    pub xp: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CampDefinition {
    pub id: String,
    pub node: String,
    pub monster: String,
    pub respawn_ticks: i64,
}

fn neutral_allegiance() -> String { "N".into() }
impl Default for MapNode {
    fn default() -> Self { Self { allegiance: neutral_allegiance(), x: 0, y: 0, presentation_x: 0, presentation_y: 0, region: String::new() } }
}
impl Default for MapEdge {
    fn default() -> Self { Self { id: String::new(), bridge_site: String::new(), ford: false, from: String::new(), to: String::new(), length: 0, region: String::new(), blocked: false } }
}
