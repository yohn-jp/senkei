//! Validation of injected, versioned route policies.
use senkei_model::{
    ContentDigest, DomainType, NextRoutePolicy, NextRoutePreference, VerifiedRulePlan,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

/// Immutable route policy validated against one verified Next RulePlan.
#[derive(Clone, Debug)]
pub struct VerifiedNextRoutePolicy {
    policy: NextRoutePolicy,
    digest: ContentDigest,
}

impl VerifiedNextRoutePolicy {
    pub fn policy(&self) -> &NextRoutePolicy { &self.policy }
    pub fn digest(&self) -> &ContentDigest { &self.digest }
}

pub fn validate_next_route_policy(
    policy: NextRoutePolicy,
    rules: &VerifiedRulePlan,
) -> Result<VerifiedNextRoutePolicy, String> {
    let next = rules.plan().next.as_ref().ok_or("route policy requires Next rules")?;
    if policy.schema_version != 1
        || policy.policy_id.trim().is_empty()
        || policy.policy_id.len() > 128
        || policy.version.major == 0
        || &policy.ruleset_digest != rules.package_digest()
        || next.world_identity.as_ref() != Some(&policy.world_identity)
        || next.map.world_identity.as_ref() != Some(&policy.world_identity)
    {
        return Err("route policy identity or paired World does not match the verified RulePlan".into());
    }
    // The current RulePackage authors no named production policy. Fastest uses
    // the existing travel-time calculation only in explicitly injected trials.
    if !policy.test_only {
        return Err("production route policy is not authored by this RulePackage".into());
    }
    if policy.preferences != BTreeSet::from([NextRoutePreference::Fastest]) {
        return Err("route policy must explicitly authorize the supported fastest preference".into());
    }
    let schema = rules.domain_schema().capabilities.get(&"move".into()).ok_or("route policy requires move capability")?;
    if schema.actor_argument != Some(0)
        || schema.target_argument.is_some()
        || schema.arguments.len() != 2
        || !matches!(&schema.arguments[0].value_type, DomainType::Entity { entity_type: Some(id) } if id.as_str() == "hero")
        || !matches!(&schema.arguments[1].value_type, DomainType::String { .. })
    {
        return Err("move capability does not have the required Hero and node arguments".into());
    }
    let bytes = serde_json::to_vec(&policy).map_err(|e| e.to_string())?;
    let digest = ContentDigest::new(format!("{:x}", Sha256::digest(bytes)));
    Ok(VerifiedNextRoutePolicy { policy, digest })
}
