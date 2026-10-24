//! Initial, finite Senkei battle rules and the validator that turns an
//! untrusted [`RulePackage`](senkei_model::RulePackage) into a verified plan.

mod initial;
mod validate;

pub use initial::{initial_engine_compatibility, initial_package};
pub use validate::{canonical_digest, validate};
