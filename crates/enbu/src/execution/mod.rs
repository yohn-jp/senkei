//! Hybrid execution kernels. These do not change Enbu's authoritative rules.
//! Until a certified scheduler exists, the reference Tick executor remains
//! the only production executor; arithmetic provides a verified bounded solver.
pub(crate) mod arithmetic;
#[cfg(feature = "lab-opt-arithmetic")]
pub(crate) mod dispatcher;
