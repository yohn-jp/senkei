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
    CandidateMove, CandidatePursue, CandidateRetreat, CandidateTarget,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorScoreTerm { pub signal: BehaviorSignal, pub weight: i64 }
/// Move uses Navigation and Objective; Target uses Engagement and Targeting;
/// Pursue uses Pursuit; Retreat uses Survival. Unknown
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
pub enum BehaviorCandidateKind { Move, Pursue, Retreat, Target }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorArgument { Actor, ObservedTarget, ObjectiveNode }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorCandidateDefinition {
    pub kind: BehaviorCandidateKind, pub capability: CapabilityId,
    pub arguments: Vec<BehaviorArgument>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorHeroAggregation { MeanFloor }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorOverrideOrder { ArmyThenSquad }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorComposition { pub hero_aggregation: BehaviorHeroAggregation, pub override_order: BehaviorOverrideOrder, pub action_order: BehaviorActionOrder }
/// Descending score, then ascending stable action ID. Shared movement orders
/// write the squad goal, target and retreating state and conflict with every
/// Target in the squad; Target writes only its Hero target and conflicts only
/// with that Hero’s Target.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorActionOrder { ScoreDescThenActionIdAsc }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextBehaviorPolicy {
    pub schema_version: u32, pub policy_id: String, pub version: Version,
    pub ruleset_digest: ContentDigest, pub test_only: bool,
    pub composition: BehaviorComposition,
    pub hero_defaults: std::collections::BTreeMap<String, NextBehaviorProfile>,
    pub domains: BehaviorDomains, pub candidates: Vec<BehaviorCandidateDefinition>,
}

/// Optional offsets scoped to candidate domains. None inherits its previous value. Move uses Navigation and Objective; Target uses Engagement and Targeting;
/// Pursue uses Pursuit; Retreat uses Survival. Runtime composes current Hero defaults, Army, then Squad overrides.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextBehaviorProfile {
    pub navigation: Option<i64>, pub engagement: Option<i64>, pub targeting: Option<i64>,
    pub pursuit: Option<i64>, pub survival: Option<i64>, pub objective: Option<i64>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextBehaviorExecutionInputs {
    pub schema_version: u32,
    pub army: std::collections::BTreeMap<crate::CombatantSide, NextBehaviorProfile>,
    pub squads: std::collections::BTreeMap<crate::CombatantSide, std::collections::BTreeMap<String, NextBehaviorProfile>>,
    pub heroes: std::collections::BTreeMap<crate::CombatantSide, std::collections::BTreeMap<crate::EntityId, NextBehaviorProfile>>,
}
/// Frozen reproduction inputs; policy must be revalidated against the RulePlan.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextBehaviorMatch { pub policy: NextBehaviorPolicy, pub inputs: NextBehaviorExecutionInputs }
