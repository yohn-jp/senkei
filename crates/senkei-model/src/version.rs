use crate::{ContentDigest, PrimitiveSetId, RulesetId};
use std::collections::BTreeSet;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Version {
    pub major: u16,
    pub minor: u16,
    pub patch: u16,
}

impl Version {
    pub const fn new(major: u16, minor: u16, patch: u16) -> Self {
        Self { major, minor, patch }
    }
}

/// Semantic version of the shared cross-crate model contract.
pub const SHARED_MODEL_VERSION: Version = Version::new(1, 0, 0);

/// Semantic version of Enbu's deterministic simulation contract. This is
/// independent of the Rust crate's Cargo package version. Version 1.4.0 adds
/// Senritsu-compiled actor-local cross-capability intent arbitration.
pub const ENBU_ENGINE_VERSION: Version = Version::new(1, 4, 0);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RulesetRef {
    pub id: RulesetId,
    pub version: Version,
    pub digest: ContentDigest,
}

/// Versions that affect parsing, execution, serialization, or CU semantics.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComponentVersions {
    pub model: Version,
    pub engine: Version,
    pub ruleset: Version,
    pub jinrei_language: Version,
    pub structured_ast: Version,
    pub typed_ir: Version,
    pub bytecode: Version,
    pub cost_schedule: Version,
    pub replay_schema: Version,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineCompatibility {
    pub engine: Version,
    pub model: Version,
    pub primitive_set_id: PrimitiveSetId,
    pub primitive_set: Version,
    pub jinrei_language: Version,
    pub structured_ast: Version,
    pub typed_ir: Version,
    pub bytecode: Version,
    pub available_primitives: BTreeSet<crate::TransitionPrimitiveKind>,
}
