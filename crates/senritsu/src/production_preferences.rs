//! Optional local-trial vocabulary; callers must bind the resulting package digest.
use senkei_model::*;
use std::collections::BTreeSet;

/// Add a finite Tick-local preference command to an explicitly opted-in trial
/// package before its canonical digest is computed. The Enbu Behavior hook
/// consumes this command; no World transition is registered.
pub fn add_trial_behavior_preferences(package: &mut RulePackage) {
    let values: BTreeSet<SymbolId> = ["navigation", "engagement", "targeting", "pursuit", "survival", "objective"].into_iter().map(Into::into).collect();
    package.domain.symbol_domains.insert("behavior_domain".into(), values.clone());
    let param = |name: &str, value_type: DomainType| ParameterSchema { id: name.into(), value_type, optional: false };
    package.domain.capabilities.insert("behavior_preference".into(), CapabilitySchema {
        arguments: vec![param("hero", DomainType::Entity { entity_type: Some("hero".into()) }), param("domain", DomainType::Enum { domain: "behavior_domain".into(), values }), param("value", DomainType::Integer { min: Some(-1_000_000), max: Some(1_000_000) })],
        actor_argument: Some(0), target_argument: None, target_type: None, target_owner: TargetOwnerConstraint::Any,
        phases: ["transition".into()].into_iter().collect(), preconditions: vec![], issue_cost: "jinrei.capability_issue".into(),
    });
    package.domain.capabilities.insert("select_target".into(), CapabilitySchema {
        arguments: vec![param("hero", DomainType::Entity { entity_type: Some("hero".into()) }), param("target", DomainType::Entity { entity_type: None })],
        actor_argument: Some(0), target_argument: Some(1), target_type: None, target_owner: TargetOwnerConstraint::OtherSide,
        phases: ["transition".into()].into_iter().collect(), preconditions: vec![], issue_cost: "jinrei.capability_issue".into(),
    });
    package.arbitration.insert("select_target".into(), ArbitrationRule {
        conflict_keys: vec![IntentKey::Side, IntentKey::Actor],
        resolution: ArbitrationResolution::SelectOrdered { sort_by: vec![IntentSortTerm { key: IntentKey::ActionId, direction: SortDirection::Ascending }], max_accepted: 1 },
    });
    package.arbitration.insert("behavior_preference".into(), ArbitrationRule {
        conflict_keys: vec![IntentKey::Side, IntentKey::Actor, IntentKey::Argument(1)],
        resolution: ArbitrationResolution::SelectOrdered { sort_by: vec![IntentSortTerm { key: IntentKey::ActionId, direction: SortDirection::Ascending }], max_accepted: package.limits.max_intents_per_side_per_tick },
    });
}
