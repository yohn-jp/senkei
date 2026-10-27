//! Validation for the finite, test-only Minion lane-waypoint policy.
use senkei_model::*;
use sha2::{Digest, Sha256};

/// Opaque proof that the immutable policy was checked against one RulePlan.
#[derive(Clone, Debug)]
pub struct VerifiedNextMinionBehaviorPolicy {
    policy: NextMinionBehaviorPolicy,
    digest: ContentDigest,
}

impl VerifiedNextMinionBehaviorPolicy {
    pub fn policy(&self) -> &NextMinionBehaviorPolicy { &self.policy }
    pub fn digest(&self) -> &ContentDigest { &self.digest }
}

pub fn validate_next_minion_behavior_policy(
    policy: NextMinionBehaviorPolicy,
    rules: &VerifiedRulePlan,
) -> Result<VerifiedNextMinionBehaviorPolicy, String> {
    let Some(next) = rules.plan().next.as_ref() else {
        return Err("Minion policy requires a Next RulePlan".into());
    };
    if policy.schema_version != 1 || policy.policy_id.is_empty()
        || policy.policy_id.len() > 128 || policy.version.major == 0
        || &policy.ruleset_digest != rules.package_digest()
    {
        return Err("invalid Minion policy identity or incompatible RulePlan".into());
    }
    if !policy.test_only {
        return Err("production Minion policy is not authored by this RulePackage".into());
    }
    // This maps only to the pre-existing automatic lifecycle calculation. The
    // Hero-only `move` capability must never be reinterpreted as a Minion order.
    match policy.candidate {
        MinionBehaviorCandidate::LaneWaypoint => {
            for lane in [MinionLane::Top, MinionLane::Mid, MinionLane::Bot] {
                let Some(nodes) = next.map.lanes.get(lane.as_str()) else {
                    return Err("lane-waypoint candidate requires all three lanes".into());
                };
                if nodes.len() < 2 || nodes.first() != Some(&next.map.attacker_base)
                    || nodes.last() != Some(&next.map.defender_base)
                {
                    return Err("lane-waypoint candidate requires side-to-side lane routes".into());
                }
            }
        }
    }
    let bytes = serde_json::to_vec(&policy).map_err(|error| error.to_string())?;
    let digest = ContentDigest::new(format!("{:x}", Sha256::digest(bytes)));
    Ok(VerifiedNextMinionBehaviorPolicy { policy, digest })
}
