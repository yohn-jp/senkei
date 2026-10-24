use senkei_model::{FieldId, ObservationPath};
use senritsu::{canonical_digest, initial_engine_compatibility, initial_package, validate};

fn refresh_digest(package: &mut senkei_model::RulePackage) {
    package.ruleset.digest = canonical_digest(package).expect("package serialization");
}

fn issue_codes(result: Result<senkei_model::VerifiedRulePlan, Vec<senkei_model::ValidationIssue>>) -> Vec<String> {
    result
        .expect_err("modified package must be rejected")
        .into_iter()
        .map(|issue| issue.code)
        .collect()
}

#[test]
fn initial_package_validates_to_verified_plan() {
    let package = initial_package();
    let digest = package.ruleset.digest.clone();
    let plan = validate(package, &initial_engine_compatibility()).expect("initial package is valid");
    assert_eq!(plan.ruleset().digest, digest);
}

#[test]
fn digest_mismatch_is_rejected() {
    let mut package = initial_package();
    package.world_initialization.global_fields.insert(FieldId::new("tick"), senkei_model::DomainValue::Integer(1));
    let codes = issue_codes(validate(package, &initial_engine_compatibility()));
    assert!(codes.iter().any(|code| code == "digest_mismatch"));
}

#[test]
fn incomplete_cu_schedule_is_rejected_even_with_a_fresh_digest() {
    let mut package = initial_package();
    package.cost_schedule.operations.remove(&senkei_model::CostOperationId::new("jinrei.collection_iteration"));
    refresh_digest(&mut package);
    let codes = issue_codes(validate(package, &initial_engine_compatibility()));
    assert!(codes.iter().any(|code| code == "missing_cost_operation"));
}

#[test]
fn public_observation_cannot_expose_an_owning_side_field() {
    let mut package = initial_package();
    package
        .domain
        .observation_fields
        .get_mut(&ObservationPath::new("self.resources"))
        .expect("resource path")
        .visibility = senkei_model::Visibility::Public;
    refresh_digest(&mut package);
    let codes = issue_codes(validate(package, &initial_engine_compatibility()));
    assert!(codes.iter().any(|code| code == "hidden_observation_access"));
}

#[test]
fn phases_must_have_unique_order() {
    let mut package = initial_package();
    package.phases[1].order = package.phases[0].order;
    refresh_digest(&mut package);
    let codes = issue_codes(validate(package, &initial_engine_compatibility()));
    assert!(codes.iter().any(|code| code == "duplicate_order"));
}

#[test]
fn lane_domain_is_explicitly_three_lanes() {
    let package = initial_package();
    let lanes = package.domain.symbol_domains.get(&senkei_model::SymbolDomainId::new("lane")).expect("lane domain");
    assert_eq!(lanes.iter().map(|lane| lane.as_str()).collect::<Vec<_>>(), ["bot", "mid", "top"]);
}
