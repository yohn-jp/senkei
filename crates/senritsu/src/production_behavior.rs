use senkei_model::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

/// An immutable policy validated against one verified Next RulePlan. Construct
/// only through `validate_next_behavior_policy`; callers cannot deserialize it.
#[derive(Clone, Debug)]
pub struct VerifiedNextBehaviorPolicy { policy: NextBehaviorPolicy, digest: ContentDigest }
impl VerifiedNextBehaviorPolicy {
    pub fn policy(&self) -> &NextBehaviorPolicy { &self.policy }
    pub fn digest(&self) -> &ContentDigest { &self.digest }
}

pub fn validate_next_behavior_policy(policy: NextBehaviorPolicy, rules: &VerifiedRulePlan) -> Result<VerifiedNextBehaviorPolicy, String> {
    if rules.plan().next.is_none() || policy.schema_version != 1 || policy.policy_id.is_empty()
        || policy.policy_id.len() > 128 || policy.version.major == 0
        || &policy.ruleset_digest != rules.package_digest() {
        return Err("invalid policy identity or incompatible Next RulePlan".into());
    }
    // No production policy is authored by the current package. A caller cannot
    // promote arbitrary weights into approved production semantics.
    if !policy.test_only { return Err("production policy is not authored by this RulePackage".into()); }
    let next = rules.plan().next.as_ref().expect("checked above");
    let ids: BTreeSet<_> = next.heroes.iter().map(|h| h.id.as_str()).collect();
    if policy.hero_defaults.len() != ids.len() || policy.hero_defaults.keys().any(|id| !ids.contains(id.as_str())) {
        return Err("hero defaults must cover exactly the Next Hero Catalog".into());
    }
    for profile in policy.hero_defaults.values() {
        for value in [profile.navigation, profile.engagement, profile.targeting, profile.pursuit, profile.survival, profile.objective].into_iter().flatten() {
            if !(-1_000_000..=1_000_000).contains(&value) { return Err("hero default out of range".into()); }
        }
    }
    let d = &policy.domains;
    let domains = [&d.navigation, &d.engagement, &d.targeting, &d.pursuit, &d.survival, &d.objective];
    let mut bound = 0i64;
    for (index, terms) in domains.into_iter().enumerate() {
        if terms.is_empty() || terms.len() > 8 { return Err("each domain needs 1..=8 terms".into()); }
        let mut seen = BTreeSet::new();
        for term in terms {
            if matches!(index, 0 | 4 | 5) && matches!(term.signal, BehaviorSignal::TargetHealthPercent | BehaviorSignal::TargetProximity) {
                return Err("target-dependent signal is not available in this domain".into());
            }
            if !seen.insert(term.signal) { return Err("duplicate signal in domain".into()); }
            let contribution = term.weight.checked_abs().and_then(|v| v.checked_mul(100))
                .ok_or("score overflow")?;
            bound = bound.checked_add(contribution).ok_or("score overflow")?;
        }
    }
    // One bounded targeting coefficient can contribute 100 * 1_000_000.
    // Reserve room for the remaining five bounded profile fields as well.
    bound.checked_add(105_000_000).ok_or("score overflow")?;
    if policy.candidates.is_empty() || policy.candidates.len() > 4 { return Err("invalid candidate count".into()); }
    let mut kinds = BTreeSet::new();
    for candidate in &policy.candidates {
        if !kinds.insert(candidate.kind) { return Err("duplicate candidate kind".into()); }
        let (name, args): (&str, &[BehaviorArgument]) = match candidate.kind {
            BehaviorCandidateKind::Move => ("move", &[BehaviorArgument::Actor, BehaviorArgument::ObjectiveNode]),
            BehaviorCandidateKind::Pursue => ("pursue", &[BehaviorArgument::Actor, BehaviorArgument::ObservedTarget]),
            BehaviorCandidateKind::Retreat => ("retreat", &[BehaviorArgument::Actor]),
            BehaviorCandidateKind::Target => ("select_target", &[BehaviorArgument::Actor, BehaviorArgument::ObservedTarget]),
        };
        let schema = rules.domain_schema().capabilities.get(&candidate.capability).ok_or("unknown capability")?;
        if candidate.capability.as_str() != name || candidate.arguments != args || schema.arguments.len() != args.len()
            || schema.actor_argument != Some(0) || schema.target_argument != if matches!(candidate.kind, BehaviorCandidateKind::Pursue | BehaviorCandidateKind::Target) { Some(1) } else { None }
            || !matches!(&schema.arguments[0].value_type, DomainType::Entity { entity_type: Some(id) } if id.as_str() == "hero")
            || (candidate.kind == BehaviorCandidateKind::Move && !matches!(&schema.arguments[1].value_type, DomainType::String { .. }))
            || (matches!(candidate.kind, BehaviorCandidateKind::Pursue | BehaviorCandidateKind::Target) && !matches!(&schema.arguments[1].value_type, DomainType::Entity { .. }))
            || (candidate.kind == BehaviorCandidateKind::Target && schema.target_owner != TargetOwnerConstraint::OtherSide) {
            return Err("candidate template does not match capability metadata".into());
        }
    }
    // Hash recursively sorted JSON object keys, matching the immutable-input
    // canonical JSON used by the Web consumer independently of key order.
    let canonical = serde_json::to_value(&policy).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(&canonical).map_err(|e| e.to_string())?;
    let digest = ContentDigest::new(format!("{:x}", Sha256::digest(bytes)));
    Ok(VerifiedNextBehaviorPolicy { policy, digest })
}
