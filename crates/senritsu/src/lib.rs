//! Initial, finite Senkei battle rules and the validator that turns an
//! untrusted [`RulePackage`](senkei_model::RulePackage) into a verified plan.

mod initial;
mod validate;
mod next_validate;

pub use initial::{initial_engine_compatibility, initial_package};
pub use validate::{canonical_digest, validate};

mod next_content;
mod next_world;
mod next_domain;
mod next_package;
pub use next_package::{next_package,next_engine_compatibility};
