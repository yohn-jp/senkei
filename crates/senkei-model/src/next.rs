//! Versioned finite battle-system data; values are owned by Senritsu.
use crate::Version;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NextRules {
    pub mechanics_version: Version,
    pub map: BattleMap,
    pub heroes: Vec<HeroDefinition>,
    pub minions: Vec<UnitDefinition>,
    pub monsters: Vec<UnitDefinition>,
    pub camps: Vec<CampDefinition>,
    pub parameters: BTreeMap<String, i64>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BattleMap {
    pub id: String,
    pub nodes: BTreeMap<String, MapNode>,
    pub edges: Vec<MapEdge>,
    /// Ordered attacker-to-defender node identifiers.
    pub lanes: BTreeMap<String, Vec<String>>,
    pub attacker_base: String,
    pub defender_base: String,
    pub towers: Vec<TowerPlacement>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapNode {
    /// Static geography: A, B, or N; never changes on capture.
    #[serde(default = "neutral_allegiance")]
    pub allegiance: String,
    pub x: i64,
    pub y: i64,
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
    fn default() -> Self { Self { allegiance: neutral_allegiance(), x: 0, y: 0, region: String::new() } }
}
impl Default for MapEdge {
    fn default() -> Self { Self { id: String::new(), bridge_site: String::new(), ford: false, from: String::new(), to: String::new(), length: 0, region: String::new(), blocked: false } }
}
