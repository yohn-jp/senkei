//! Shared, game-rule-neutral contracts for Senkei, Jinrei, Senritsu, and Enbu.
//!
//! The model deliberately does not define lane names, unit classes, combat
//! numbers, or a particular CU schedule. Those belong to a versioned Senritsu
//! package. Maps exposed by this crate use `BTreeMap` so serialized data and
//! iteration order are stable across native and WASM builds.

mod api;
mod battle;
mod diagnostics;
mod domain;
mod execution;
mod ids;
mod next;
mod production_behavior;
mod match_projection;
mod jinrei_ast;
mod rules;
mod version;

pub use api::*;
pub use battle::*;
pub use diagnostics::*;
pub use domain::*;
pub use execution::*;
pub use ids::*;
pub use next::*;
pub use production_behavior::*;
pub use match_projection::*;
pub use jinrei_ast::*;
pub use rules::*;
pub use version::*;
