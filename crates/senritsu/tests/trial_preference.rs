use senkei_model::*;
use senritsu::{add_trial_behavior_preferences, next_local_trial_package, next_engine_compatibility, canonical_digest, validate};

#[test]
fn trial_preference_is_typed_valid_and_charged() {
    let mut package = next_local_trial_package();
    add_trial_behavior_preferences(&mut package);
    package.ruleset.digest = canonical_digest(&package).unwrap();
    let rules = validate(package, &next_engine_compatibility()).unwrap();
    let cap = &rules.domain_schema().capabilities[&CapabilityId::new("behavior_preference")];
    assert_eq!(cap.actor_argument, Some(0));
    assert_eq!(cap.issue_cost.as_str(), "jinrei.capability_issue");
    let source = r#"senkei trial { action choose { when match.tick == 1, do behavior_preference(argmin hero in allies.heroes by hero.hp then hero.id, navigation, 20), }, }"#;
    jinrei::compile(source, &rules).unwrap();
    assert!(matches!(&cap.arguments[1].value_type, DomainType::Enum { values, .. } if values.len() == 6));
    assert!(matches!(&cap.arguments[2].value_type, DomainType::Integer { min: Some(-1_000_000), max: Some(1_000_000) }));
}

#[test]
fn capability_is_rejected_without_explicit_trial_policy() {
    let mut package = senritsu::next_package();
    add_trial_behavior_preferences(&mut package);
    package.ruleset.digest = canonical_digest(&package).unwrap();
    assert!(validate(package, &next_engine_compatibility()).is_err());
}
