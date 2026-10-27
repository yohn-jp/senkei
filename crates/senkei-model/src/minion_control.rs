//! Versioned declaration of test-only Army/Lane Minion preference bindings.
//!
//! Capability names and enum values are supplied by the RulePackage author;
//! the binding does not introduce individual Minion or Hero-style commands.
use crate::{CapabilityId, ContentDigest, MinionBehaviorCandidate, MinionLane, SymbolId, Version};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MinionControlScope {
    Army,
    /// Argument zero is an enum. Its complete, bijective mapping to the
    /// canonical lanes is supplied by the package, not inferred from strings.
    Lane { values: BTreeMap<SymbolId, MinionLane> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MinionControlCapability {
    pub scope: MinionControlScope,
    pub candidate: MinionBehaviorCandidate,
}

/// The author explicitly chooses how overlapping Army and Lane preferences
/// compose. Additional policy orders require an authored, supported contract.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MinionControlScopeResolution {
    LaneOverridesArmy,
}

/// Part of the ruleset's canonical digest. Only test-only declarations are
/// currently supported; no production Minion vocabulary has been authored.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextMinionControlDeclaration {
    pub schema_version: u32,
    pub version: Version,
    pub test_only: bool,
    pub scope_resolution: MinionControlScopeResolution,
    pub capabilities: BTreeMap<CapabilityId, MinionControlCapability>,
}

/// Opt-in is frozen with the match and revalidated against its RulePackage.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NextMinionControlMatch {
    pub schema_version: u32,
    pub ruleset_digest: ContentDigest,
}
