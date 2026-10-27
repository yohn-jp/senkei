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
/// Move uses Navigation and Objective; Pursue uses Engagement, Targeting and
/// Pursuit; Retreat uses Survival. Unknown
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

/// Additive offsets scoped to candidate domains. Move uses Navigation and
/// Objective; Pursue uses Engagement, Targeting and Pursuit; Retreat uses
/// Survival. Runtime combines Army, current Squad and Hero offsets.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NextBehaviorProfile {
    pub navigation: i64, pub engagement: i64, pub targeting: i64,
    pub pursuit: i64, pub survival: i64, pub objective: i64,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NextBehaviorExecutionInputs {
    pub schema_version: u32,
    pub army: std::collections::BTreeMap<crate::CombatantSide, NextBehaviorProfile>,
    pub squads: std::collections::BTreeMap<crate::CombatantSide, std::collections::BTreeMap<String, NextBehaviorProfile>>,
    pub heroes: std::collections::BTreeMap<crate::CombatantSide, std::collections::BTreeMap<crate::EntityId, NextBehaviorProfile>>,
}
/// Frozen reproduction inputs; policy must be revalidated against the RulePlan.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NextBehaviorMatch { pub policy: NextBehaviorPolicy, pub inputs: NextBehaviorExecutionInputs }
