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
    pub authority: AssetAuthority,
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
    pub definition_catalog_id: String,
    pub definition_version: Version,
    pub definition_digest: crate::ContentDigest,
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
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectionPolicy {
    pub schema_version: u32,
    pub test_only: bool,
    pub hero_catalog_id: String,
    pub hero_catalog_version: Version,
    pub hero_catalog_digest: crate::ContentDigest,
    pub equipment: BTreeMap<String, EquipmentEffectDefinition>,
    pub relation: Option<RelationFormula>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maturity: Option<crate::RelationMaturityPolicy>,
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
    pub level: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula_version: Option<Version>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula_digest: Option<crate::ContentDigest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maturity_policy: Option<crate::RelationMaturityPolicyRef>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelationFormula {
    pub version: Version,
    pub stat: ProjectedStat,
    pub add_per_level: i64,
    pub max_level: i64,
    pub max_bonus: i64,
    pub rounding: RelationRounding,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetAuthority { Local, Official }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationRounding { Floor }
