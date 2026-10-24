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
fn derived_observation_cannot_read_hidden_world_fields() {
    let mut package = initial_package();
    let field = package
        .domain
        .observation_fields
        .get_mut(&ObservationPath::new("self.resources"))
        .expect("resource path");
    field.visibility = senkei_model::Visibility::Public;
    field.source = senkei_model::ObservationSource::Derived(senkei_model::RuleExpression::Field {
        target: senkei_model::EntitySelector::ByProjectionKey {
            projection_id: senkei_model::ProjectionId::new("barracks"),
            entity_type: senkei_model::TypeId::new("barracks"),
            owner: senkei_model::EntityOwnerSelector::Attacker,
            key: senkei_model::DomainValue::String("barracks".to_owned()),
        },
        field: FieldId::new("resources"),
    });
    refresh_digest(&mut package);
    let codes = issue_codes(validate(package, &initial_engine_compatibility()));
    assert!(codes.iter().any(|code| code == "hidden_observation_access"));
}

#[test]
fn numeric_schema_requires_both_finite_bounds() {
    let mut package = initial_package();
    package.world.entity_types
        .get_mut(&senkei_model::TypeId::new("unit"))
        .expect("unit schema")
        .fields
        .get_mut(&FieldId::new("hp"))
        .expect("HP field")
        .value_type = senkei_model::DomainType::Integer { min: None, max: Some(100) };
    refresh_digest(&mut package);
    let codes = issue_codes(validate(package, &initial_engine_compatibility()));
    assert!(codes.iter().any(|code| code == "unbounded_numeric_type"));
}

#[test]
fn arbitration_keys_must_fit_the_capability_signature() {
    let mut package = initial_package();
    package.arbitration
        .get_mut(&senkei_model::CapabilityId::new("deploy"))
        .expect("deploy arbitration")
        .resolution = senkei_model::ArbitrationResolution::SelectOrdered {
            sort_by: vec![senkei_model::IntentSortTerm {
                key: senkei_model::IntentKey::Argument(3),
                direction: senkei_model::SortDirection::Ascending,
            }],
            max_accepted: 32,
        };
    refresh_digest(&mut package);
    let codes = issue_codes(validate(package, &initial_engine_compatibility()));
    assert!(codes.iter().any(|code| code == "invalid_intent_key"));
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

#[test]
fn slot_id_is_a_unique_tactical_key_but_not_a_public_replay_field() {
    let package = initial_package();
    let slot_id = FieldId::new("slot_id");
    for collection_id in ["allies.units", "allies.reserves", "enemies.visible_units"] {
        let collection = package.domain.collections.get(&senkei_model::CollectionId::new(collection_id)).expect("unit collection");
        assert!(collection.visible_fields.contains_key(&slot_id));
        assert!(collection.unique_keys.contains(&senkei_model::CollectionUniqueKey::Fields(vec![slot_id.clone()])));
    }
    assert!(!package.presentation.visible_entity_fields[&senkei_model::TypeId::new("unit")].contains(&slot_id));
}

#[test]
fn duplicate_default_slot_id_across_rosters_is_rejected() {
    let mut package = initial_package();
    let reinforcements = package
        .domain
        .senkei_configuration
        .get_mut(&FieldId::new("reinforcements"))
        .expect("reinforcement configuration");
    let Some(senkei_model::DomainValue::List(items)) = &mut reinforcements.default else { panic!("reinforcement defaults"); };
    let Some(senkei_model::DomainValue::Record(fields)) = items.first_mut() else { panic!("reinforcement default record"); };
    fields.insert(FieldId::new("slot_id"), senkei_model::DomainValue::String("unit-infantry-top".to_owned()));
    refresh_digest(&mut package);
    let codes = issue_codes(validate(package, &initial_engine_compatibility()));
    assert!(codes.iter().any(|code| code == "duplicate_roster_slot_id"));
}

#[test]
fn initial_and_reinforcement_rosters_must_share_the_slot_id_namespace() {
    let mut package = initial_package();
    let projection = package
        .world_initialization
        .entities
        .iter_mut()
        .find(|projection| {
            projection.source == senkei_model::EntityProjectionSource::EachConfigurationItem {
                field: FieldId::new("reinforcements"),
            }
        })
        .expect("reinforcement projection");
    projection.projection_id = senkei_model::ProjectionId::new("other_unit_namespace");
    refresh_digest(&mut package);
    let codes = issue_codes(validate(package, &initial_engine_compatibility()));
    assert!(codes.iter().any(|code| code == "invalid_roster_projection"));
}
