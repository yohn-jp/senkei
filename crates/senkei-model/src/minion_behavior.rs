//! Versioned, finite inputs for the existing Next Minion lane march.
//!
//! The current RulePackage does not author a Minion command vocabulary.  The
//! only injectable candidate below refers to the already implemented automatic
//! next-lane-waypoint calculation; it cannot stop, redirect, or address a unit.
use crate::{CombatantSide, ContentDigest, Version};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MinionLane {
    Top,
    Mid,
    Bot,
}

impl MinionLane {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Top => "top",
            Self::Mid => "mid",
            Self::Bot => "bot",
        }
    }
}

/// The existing automatic next waypoint, not the Hero `move` capability.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MinionBehaviorCandidate {
    LaneWaypoint,
}

/// No production policy is currently authored; validation requires test_only.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextMinionBehaviorPolicy {
    pub schema_version: u32,
    pub policy_id: String,
    pub version: Version,
    pub ruleset_digest: ContentDigest,
    pub test_only: bool,
    pub candidate: MinionBehaviorCandidate,
}

/// Match-wide inputs have Army and Lane scope only. A Lane entry takes
/// precedence over its Army entry. There is intentionally no individual actor,
/// arbitrary destination, score, or user-authored command in this contract.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextMinionBehaviorExecutionInputs {
    pub schema_version: u32,
    pub army: BTreeMap<CombatantSide, MinionBehaviorCandidate>,
    pub lanes: BTreeMap<CombatantSide, BTreeMap<MinionLane, MinionBehaviorCandidate>>,
}

/// Frozen match inputs; the policy is always revalidated against the RulePlan.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextMinionBehaviorMatch {
    pub policy: NextMinionBehaviorPolicy,
    pub inputs: NextMinionBehaviorExecutionInputs,
}
