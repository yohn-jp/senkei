//! Versioned, explicitly injected route choices for the Next movement engine.
use crate::{ActionId, CombatantSide, ContentDigest, EntityId, Version, WorldIdentityRef};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// A node identifier in the exact World named by the containing route policy.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct NextRouteNodeId(pub String);

/// The currently implemented travel-time route algorithm. Other route
/// preferences require authored risk and Unknown-handling rules.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NextRoutePreference {
    Fastest,
}

/// A route policy is injected and revalidated against the exact rules and
/// World. No production policy or risk weights are supplied by this module.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextRoutePolicy {
    pub schema_version: u32,
    pub policy_id: String,
    pub version: Version,
    pub ruleset_digest: ContentDigest,
    pub world_identity: WorldIdentityRef,
    pub test_only: bool,
    pub preferences: BTreeSet<NextRoutePreference>,
}

/// Binds a route choice to one actual `move` action. It has no effect until a
/// matching, validated action is committed by the regular order machinery.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextRouteCommand {
    pub side: CombatantSide,
    pub action_id: ActionId,
    pub actor: EntityId,
    pub destination: NextRouteNodeId,
    pub preference: NextRoutePreference,
    pub waypoints: Vec<NextRouteNodeId>,
}

/// Frozen inputs included in match reproduction and its input identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextRouteMatch {
    pub policy: NextRoutePolicy,
    pub commands: Vec<NextRouteCommand>,
}
