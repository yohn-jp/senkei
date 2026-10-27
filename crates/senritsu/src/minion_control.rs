//! Registration of finite test-only Minion control declarations.
use senkei_model::*;
use std::collections::BTreeSet;

/// Validate the authored declaration and add only its proven capability and
/// enum schemas to the canonical Next domain used by `validate_next`.
/// The package itself, including this declaration, is covered by its digest.
pub(crate) fn validate_next_minion_control_declaration(
    package: &RulePackage,
    supported: &mut RulePackage,
) -> Result<(), String> {
    let Some(next) = package.next.as_ref() else { return Ok(()) };
    let Some(declaration) = next.minion_control.as_ref() else { return Ok(()) };
    if declaration.schema_version != 1 || declaration.version.major == 0 || !declaration.test_only
        || declaration.capabilities.is_empty()
        || declaration.capabilities.len() > package.limits.max_intents_per_side_per_tick as usize
    {
        return Err("invalid or unapproved Minion control declaration".into());
    }
    let reference = supported.domain.capabilities.get(&CapabilityId::new("move"))
        .ok_or("Next move capability missing")?.clone();
    // Reserve optional runtime-owned vocabularies even if this package does
    // not enable them; otherwise a provider could collide with an Enbu hook.
    let mut reserved = supported.clone();
    crate::production_preferences::add_trial_behavior_preferences(&mut reserved);
    for (id, binding) in &declaration.capabilities {
        if id.as_str().is_empty() || reserved.domain.capabilities.contains_key(id) {
            return Err("Minion control capability is empty or collides with existing capability".into());
        }
        let capability = package.domain.capabilities.get(id).ok_or("Minion control capability is not declared")?;
        if capability.actor_argument.is_some() || capability.target_argument.is_some()
            || capability.target_type.is_some() || capability.target_owner != TargetOwnerConstraint::Any
            || capability.phases != reference.phases || !capability.preconditions.is_empty()
            || capability.issue_cost != reference.issue_cost
        {
            return Err("Minion control must be actorless, targetless, and use the declared transition cost".into());
        }
        match binding.candidate {
            MinionBehaviorCandidate::LaneWaypoint => {}
        }
        let keys: BTreeSet<IntentKey> = match &binding.scope {
            MinionControlScope::Army => {
                if !capability.arguments.is_empty() { return Err("Army control accepts no arguments".into()); }
                [IntentKey::Side].into_iter().collect()
            }
            MinionControlScope::Lane { values } => {
                if capability.arguments.len() != 1 || capability.arguments[0].optional {
                    return Err("Lane control requires one non-optional enum argument".into());
                }
                let DomainType::Enum { domain, values: variants } = &capability.arguments[0].value_type else {
                    return Err("Lane control requires an enum lane argument".into());
                };
                let mapped_values: BTreeSet<_> = values.keys().cloned().collect();
                let mapped_lanes: BTreeSet<_> = values.values().copied().collect();
                let all_lanes: BTreeSet<_> = [MinionLane::Top, MinionLane::Mid, MinionLane::Bot].into_iter().collect();
                if values.len() != all_lanes.len() || mapped_lanes != all_lanes || &mapped_values != variants
                    || package.domain.symbol_domains.get(domain) != Some(variants)
                {
                    return Err("Lane symbols must bijectively map the complete enum to three lanes".into());
                }
                if let Some(existing) = supported.domain.symbol_domains.get(domain) {
                    if existing != variants { return Err("Lane enum alters an existing symbol domain".into()); }
                } else {
                    supported.domain.symbol_domains.insert(domain.clone(), variants.clone());
                }
                [IntentKey::Side, IntentKey::Argument(0)].into_iter().collect()
            }
        };
        let arbitration = package.arbitration.get(id).ok_or("Minion control requires arbitration")?;
        if arbitration.conflict_keys.iter().cloned().collect::<BTreeSet<_>>() != keys
            || arbitration.conflict_keys.len() != keys.len()
        {
            return Err("Minion arbitration must group by side and, for Lane, the lane argument".into());
        }
        match &arbitration.resolution {
            ArbitrationResolution::RejectConflicts => {}
            ArbitrationResolution::SelectOrdered { sort_by, max_accepted } => {
                let required_groups = if matches!(&binding.scope, MinionControlScope::Army) { 2 } else { 6 };
                if *max_accepted < required_groups || !sort_by.iter().any(|term| term.key == IntentKey::ActionId) {
                    return Err("Minion arbitration must order by action ID and accommodate all side/lane groups".into());
                }
            }
            ArbitrationResolution::AllowAll { .. } => return Err("Minion control cannot allow conflicting intents".into()),
        }
        supported.domain.capabilities.insert(id.clone(), capability.clone());
    }
    Ok(())
}

/// Revalidate the frozen opt-in against the exact already verified RulePlan.
pub fn validate_next_minion_control_match(
    binding: &NextMinionControlMatch,
    rules: &VerifiedRulePlan,
) -> Result<(), String> {
    let Some(declaration) = rules.plan().next.as_ref().and_then(|next| next.minion_control.as_ref()) else {
        return Err("RulePlan has no Minion control declaration".into());
    };
    if binding.schema_version != 1 || binding.ruleset_digest != *rules.package_digest()
        || declaration.schema_version != 1 || declaration.version.major == 0 || !declaration.test_only
    {
        return Err("invalid Minion control match identity".into());
    }
    Ok(())
}
