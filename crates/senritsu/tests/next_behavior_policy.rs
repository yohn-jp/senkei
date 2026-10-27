use senkei_model::*;
use senritsu::{next_package, next_engine_compatibility, validate, validate_next_behavior_policy};

fn policy(rules: &VerifiedRulePlan) -> NextBehaviorPolicy {
    let term = BehaviorScoreTerm { signal: BehaviorSignal::Constant, weight: 1 };
    NextBehaviorPolicy {
        schema_version: 1, policy_id: "test-policy".into(), version: Version::new(1, 0, 0),
        ruleset_digest: rules.package_digest().clone(), test_only: true,
        composition: BehaviorComposition { hero_aggregation: BehaviorHeroAggregation::MeanFloor, override_order: BehaviorOverrideOrder::ArmyThenSquad, action_order: BehaviorActionOrder::ScoreDescThenActionIdAsc },
        hero_defaults: rules.plan().next.as_ref().unwrap().heroes.iter().map(|hero| (hero.id.clone(), NextBehaviorProfile::default())).collect(),
        domains: BehaviorDomains { navigation: vec![term.clone()], engagement: vec![term.clone()], targeting: vec![term.clone()], pursuit: vec![term.clone()], survival: vec![term.clone()], objective: vec![term] },
        candidates: vec![BehaviorCandidateDefinition { kind: BehaviorCandidateKind::Retreat, capability: "retreat".into(), arguments: vec![BehaviorArgument::Actor] }],
    }
}
#[test]
fn validates_bound_test_policy_and_rejects_malformed_policies() {
    let rules = validate(next_package(), &next_engine_compatibility()).unwrap();
    let mut p = policy(&rules);
    p.domains.navigation.push(BehaviorScoreTerm { signal: BehaviorSignal::CandidateMove, weight: 2 });
    p.domains.pursuit.push(BehaviorScoreTerm { signal: BehaviorSignal::CandidatePursue, weight: 3 });
    p.domains.survival.push(BehaviorScoreTerm { signal: BehaviorSignal::CandidateRetreat, weight: 4 });
    let verified = validate_next_behavior_policy(p.clone(), &rules).unwrap();
    assert_eq!(verified.policy(), &p);
    assert!(verified.policy().test_only);
    let mut invalid = p.clone(); invalid.ruleset_digest = ContentDigest::new("wrong");
    assert!(validate_next_behavior_policy(invalid, &rules).is_err());
    let mut invalid = p.clone(); invalid.domains.navigation.clear();
    assert!(validate_next_behavior_policy(invalid, &rules).is_err());
    let mut target = p.clone(); target.candidates.push(BehaviorCandidateDefinition { kind: BehaviorCandidateKind::Target, capability: "select_target".into(), arguments: vec![BehaviorArgument::Actor, BehaviorArgument::ObservedTarget] });
    // Target exists in the explicit trial package, not the ordinary Next package.
    assert!(validate_next_behavior_policy(target, &rules).is_err());
    let mut invalid = p.clone(); invalid.candidates.push(invalid.candidates[0].clone());
    assert!(validate_next_behavior_policy(invalid, &rules).is_err());
    let mut invalid = p.clone(); invalid.candidates[0].capability = "move".into();
    assert!(validate_next_behavior_policy(invalid, &rules).is_err());
    let mut invalid = p.clone(); invalid.domains.navigation[0].signal = BehaviorSignal::TargetHealthPercent;
    assert!(validate_next_behavior_policy(invalid, &rules).is_err());
    let mut invalid = p.clone(); invalid.hero_defaults.insert("unknown".into(), NextBehaviorProfile::default());
    assert!(validate_next_behavior_policy(invalid, &rules).is_err());
    let mut invalid = p; invalid.domains.survival[0].weight = i64::MAX;
    assert!(validate_next_behavior_policy(invalid, &rules).is_err());
}

#[test]
fn behavior_match_round_trips_policy_and_profiles() {
    let rules = validate(next_package(), &next_engine_compatibility()).unwrap();
    let value = NextBehaviorMatch { policy: policy(&rules), inputs: NextBehaviorExecutionInputs { schema_version: 1, ..Default::default() } };
    let json = serde_json::to_vec(&value).unwrap();
    assert_eq!(serde_json::from_slice::<NextBehaviorMatch>(&json).unwrap(), value);
}
