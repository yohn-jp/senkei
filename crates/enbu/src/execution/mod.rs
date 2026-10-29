//! Proof-gated physical execution kernels. Semantic authority remains in Enbu's
//! canonical phase transitions; strategies only narrow redundant physical work.
pub(crate) mod strategies;
pub(crate) mod arithmetic;
#[cfg(feature = "lab-opt-arithmetic")]
pub(crate) mod dispatcher;
