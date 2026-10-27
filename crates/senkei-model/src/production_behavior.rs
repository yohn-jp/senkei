//! Versioned, finite data for the Next Behavior evaluator.
use crate::{CapabilityId, ContentDigest, Version};
use serde::{Deserialize, Serialize};

/// Signals are derived only from the current side's observation. Each has an
/// integer range 0..=100; unavailable observations stay unknown and must not
/// be substituted with hidden World data.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorSignal {
    Constant, ActorHealthPercent, TargetHealthPercent, TargetProximity,
    ObservedDanger, ObjectiveValue, RouteCost, SquadHealthPercent,
    /// 100 when the evaluated candidate has the corresponding kind, otherwise 0.
    CandidateMove, CandidatePursue, CandidateRetreat,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorScoreTerm { pub signal: BehaviorSignal, pub weight: i64 }
/// Each domain contributes its declared terms to an action's score. Unknown
/// signals make the candidate ineligible; arithmetic is checked integer math.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorDomains {
    pub navigation: Vec<BehaviorScoreTerm>, pub engagement: Vec<BehaviorScoreTerm>,
    pub targeting: Vec<BehaviorScoreTerm>, pub pursuit: Vec<BehaviorScoreTerm>,
    pub survival: Vec<BehaviorScoreTerm>, pub objective: Vec<BehaviorScoreTerm>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorCandidateKind { Move, Pursue, Retreat }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorArgument { Actor, ObservedTarget, ObjectiveNode }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorCandidateDefinition {
    pub kind: BehaviorCandidateKind, pub capability: CapabilityId,
    pub arguments: Vec<BehaviorArgument>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextBehaviorPolicy {
    pub schema_version: u32, pub policy_id: String, pub version: Version,
    pub ruleset_digest: ContentDigest, pub test_only: bool,
    pub domains: BehaviorDomains, pub candidates: Vec<BehaviorCandidateDefinition>,
}
