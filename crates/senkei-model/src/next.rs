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
pub struct MapNode { pub x: i64, pub y: i64, pub region: String }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapEdge { pub from: String, pub to: String, pub length: i64, pub region: String, pub blocked: bool }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TowerPlacement { pub id: String, pub node: String, pub side: String, pub lane: String }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnitStats {
    pub hp: i64, pub attack: i64, pub defense: i64, pub speed: i64,
    pub range: i64, pub attack_interval: i64, pub vision: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeroDefinition {
    pub id: String, pub name: String, pub placement: String, pub role: String, pub trait_id: String,
    pub appearance_key: String, pub stats: UnitStats, pub growth: UnitStats,
    pub skills: Vec<SkillDefinition>,
    pub skill_paths: BTreeMap<String, Vec<String>>,
    pub synergy: BTreeMap<String, i64>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillDefinition {
    pub id: String, pub name: String, pub passive: bool, pub unlock_level: i64,
    pub prerequisites: Vec<String>, pub cooldown: i64, pub cost: i64,
    pub range: i64, pub target: String, pub effect: SkillEffect, pub power: i64, pub duration: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillEffect { Damage, Heal, Shield, Haste, Slow, Reveal, Empower, Defense }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnitDefinition { pub id: String, pub stats: UnitStats, pub xp: i64 }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CampDefinition { pub id: String, pub node: String, pub monster: String, pub respawn_ticks: i64 }
