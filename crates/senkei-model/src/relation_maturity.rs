//! Optional, separately versioned relationship effects on existing Squad maturity.
//!
//! These types carry a rule-package decision; they do not define a production
//! coefficient or turn missing relationship values into zero.
use crate::{ContentDigest, RelationRounding, Version};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelationMaturityPolicy {
    pub version: Version,
    pub target: RelationMaturityTarget,
    pub aggregation: RelationMaturityAggregation,
    /// Additional maturity ticks per unit of pair-normalized relationship.
    pub add_per_level: i64,
    pub max_level: i64,
    /// Maximum additional maturity ticks per update, before the Squad cap.
    pub max_bonus: i64,
    pub rounding: RelationRounding,
}

impl RelationMaturityPolicy {
    /// Arithmetic bounds shared by the rule verifier and projection preflight.
    pub fn has_valid_limits(&self) -> bool {
        self.version.major > 0
            && (0..=1_000_000).contains(&self.max_level)
            && (0..=1_000_000).contains(&self.add_per_level)
            && (0..=1_000_000).contains(&self.max_bonus)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationMaturityTarget {
    SquadMaturityIncrement,
}

/// A bonus is defined only when all unordered Squad pairs have two defined
/// directed levels and exact policy references. Floor the mean of each pair,
/// then floor their mean before applying the policy's bounded coefficient.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationMaturityAggregation {
    CompletePairMean,
}

/// The exact effect definition selected when a directed relation was frozen.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelationMaturityPolicyRef {
    pub version: Version,
    pub digest: ContentDigest,
}
