//! Declarative World Definition validation and deterministic compilation.
//!
//! Authored values are kept in four explicit layers. The compiler emits a
//! sealed [`VerifiedWorld`] whose simulation and presentation artifacts share
//! one identity while retaining independently computed content digests.

mod compile;
mod definition;
mod digest;
mod validation;
mod resolver;

pub use compile::{
    canonical_artifact_bytes, canonical_presentation_bytes, canonical_simulation_bytes, compile,
    compile_json, VerifiedWorld, WorldCompileError,
};
pub use definition::*;
pub use digest::{WorldIdentity, WorldLogicDigest, WorldPresentationDigest};
pub use validation::WorldIssue;
pub use resolver::{WorldResolver, WorldResolveError};

/// The compiler version implemented by this crate.
pub const COMPILER_VERSION: Version = Version::new(1, 0, 0);

/// Canonical profile for the authored Battlefield in `docs/BATTLEFIELD.md`.
pub const INITIAL_BATTLEFIELD_PROFILE_ID: &str = "senkei.battlefield.initial";
pub const INITIAL_BATTLEFIELD_PROFILE_VERSION: Version = Version::new(1, 0, 0);
