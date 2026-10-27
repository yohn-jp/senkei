//! Frozen player assets and finite effects authorized by a versioned rule package.
use crate::{CombatantSide, Version};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MatchProjection {
    pub schema_version: u32,
    pub sides: BTreeMap<CombatantSide, ProjectedSide>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectedSide {
    pub owner_id: String,
    pub heroes: Vec<ProjectedHero>,
    pub relations: Vec<ProjectedRelation>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectedHero {
    pub slot_id: String,
    pub owner_id: String,
    pub instance_id: String,
    pub catalog_id: String,
    pub equipment: Vec<ProjectedEquipment>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectedEquipment {
    pub instance_id: String,
    pub owner_id: String,
    pub definition_id: String,
    pub definition_version: Version,
    pub definition_digest: crate::ContentDigest,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectionPolicy {
    pub schema_version: u32,
    pub equipment: BTreeMap<String, EquipmentEffectDefinition>,
    pub relation: Option<RelationFormula>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EquipmentEffectDefinition {
    pub version: Version,
    pub effects: Vec<StatEffect>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatEffect { pub stat: ProjectedStat, pub add: i64 }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectedStat { Attack, Defense, Speed, Range, Vision, MaxHp }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectedRelation {
    pub from_instance_id: String,
    pub to_instance_id: String,
    pub level: i64,
    pub formula_version: Version,
    pub formula_digest: crate::ContentDigest,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelationFormula {
    pub version: Version,
    pub stat: ProjectedStat,
    pub add_per_level: i64,
    pub max_level: i64,
}
