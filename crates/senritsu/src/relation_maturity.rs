//! Validation for the optional, explicit relationship maturity policy.
use senkei_model::RelationMaturityPolicy;

pub(crate) fn valid(policy: &RelationMaturityPolicy) -> bool {
    policy.has_valid_limits()
}
