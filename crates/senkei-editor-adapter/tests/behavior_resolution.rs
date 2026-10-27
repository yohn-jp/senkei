#[path = "support/profile_catalog.rs"]
mod profile_catalog;

use senkei_editor_adapter::{resolve_behavior, AdapterError, BehaviorResolveRequest};
use serde_json::{json, Value};

fn request() -> Value {
    let (package, extension) = profile_catalog::authored_profile_package();
    let catalog: Value = serde_json::from_str(&profile_catalog::authored_profile_catalog_json()).unwrap();
    json!({
        "revision": 7,
        "stamp": { "identity": catalog["identity"], "catalogDigest": catalog["catalogDigest"],
            "metadataExtensionDigest": catalog["metadataExtensionDigest"] },
        "rulePackage": package,
        "catalogMetadataExtension": extension,
        "actor": { "subjectId": "slot-01", "scope": "hero", "heroCatalogId": "F01", "squadMembers": [] },
        "preferences": { "armyId": "attacker", "army": {}, "squadId": "front", "squad": {} },
        "tick": 0, "side": "attacker", "evaluation": { "kind": "defaults_only" },
    })
}

fn resolve(value: Value) -> Result<Value, AdapterError> {
    let input: BehaviorResolveRequest = serde_json::from_value(value).unwrap();
    resolve_behavior(input).map(|reply| serde_json::to_value(reply).unwrap())
}

#[test]
fn authored_catalog_composes_real_defaults_and_labels_the_evidence() {
    let response = resolve(request()).unwrap();
    assert_eq!(response["revision"], 7);
    assert_eq!(response["evaluationKind"], "defaults_only");
    assert_eq!(response["status"], "resolved");
    assert_eq!(response["composition"]["values"]["navigation.mode"], json!({ "kind": "string", "value": "safest" }));
    assert_eq!(response["composition"]["provenance"]["navigation.mode"]["layer"], "senritsu_default");
    assert_eq!(response["composition"]["catalog_identity"], response["stamp"]);
}

#[test]
fn rejects_stale_catalog_and_invalid_extension_without_inferring_a_result() {
    let mut stale = request();
    stale["stamp"]["catalogDigest"] = json!("0".repeat(64));
    assert!(matches!(resolve(stale), Err(AdapterError::CatalogMismatch)));
    let mut tampered = request();
    tampered["catalogMetadataExtension"]["behaviorProfiles"]["senritsuDefault"]["navigation.mode"]["value"] = json!("changed");
    assert!(matches!(resolve(tampered), Err(AdapterError::PackageInvalid(_))));
}

#[test]
fn does_not_treat_provided_unknown_as_a_default_proof() {
    let mut input = request();
    input["evaluation"] = json!({ "kind": "provided", "intents": [], "legality": {}, "diagnostics": [
        { "kind": "runtime_notice", "value": { "code": "when_unknown", "details": { "action": "uncertain" } } }
    ] });
    let response = resolve(input).unwrap();
    assert_eq!(response["evaluationKind"], "provided");
    assert_eq!(response["composition"]["unknown_conditions"], json!([{ "action_id": "uncertain", "truth": "unknown" }]));
}

#[test]
fn composes_actual_hero_and_army_layers_using_the_authored_order() {
    use senkei_model::DomainValue;
    use senritsu::{catalog::catalog_semantics_digest, BehaviorScope};
    use std::collections::BTreeMap;
    let (mut package, mut extension) = profile_catalog::authored_profile_package();
    extension.behavior_profiles.fields.get_mut("navigation.mode").unwrap().scopes.insert(BehaviorScope::Army);
    extension.behavior_profiles.hero_defaults.insert("F01".into(), BTreeMap::from([(
        "navigation.mode".into(), DomainValue::String("fastest".into()),
    )]));
    package.catalog_semantics_digest = Some(catalog_semantics_digest(&extension).unwrap());
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    extension.ruleset_digest = package.ruleset.digest.clone();
    let plan = senritsu::validate_with_catalog_extension(package.clone(), &senritsu::next_engine_compatibility(), extension.clone()).unwrap();
    let catalog = senritsu::DomainCatalog::from_verified_plan_with_extension(&plan, extension.clone()).unwrap();
    let mut input = request();
    input["rulePackage"] = serde_json::to_value(package).unwrap();
    input["catalogMetadataExtension"] = serde_json::to_value(extension).unwrap();
    input["stamp"] = serde_json::to_value(catalog.compatibility_key()).unwrap();
    let baseline = resolve(input.clone()).unwrap();
    assert_eq!(baseline["composition"]["values"]["navigation.mode"]["value"], "fastest");
    assert_eq!(baseline["composition"]["provenance"]["navigation.mode"]["layer"], "hero_catalog_default");
    input["preferences"]["army"]["navigation.mode"] = json!({ "kind": "string", "value": "safest" });
    let army = resolve(input).unwrap();
    assert_eq!(army["composition"]["values"]["navigation.mode"]["value"], "safest");
    assert_eq!(army["composition"]["provenance"]["navigation.mode"]["layer"], "army_preference");
}

#[test]
fn caller_supplied_jinrei_override_requires_explicit_legality() {
    use senkei_model::{ArbitrationResolution, ArbitrationRule, CapabilityId, DomainType, IntentKey, IntentSortTerm, SortDirection, TypeId, Version};
    use senritsu::{catalog::catalog_semantics_digest, BehaviorOrderContract, BehaviorOrderDeclaration, BehaviorScope, CapabilityContractMetadata, CapabilityLifetime, EntityControlScope};
    use std::collections::{BTreeMap, BTreeSet};
    let (mut package, mut extension) = profile_catalog::authored_profile_package();
    let provisional = senritsu::validate(senritsu::next_package(), &senritsu::next_engine_compatibility()).unwrap();
    let capabilities = provisional.plan().domain.capabilities.iter().filter_map(|(id, capability)| {
        let actor = capability.actor_argument.and_then(|index| capability.arguments.get(index as usize))?;
        let DomainType::Entity { entity_type: Some(entity_type) } = &actor.value_type else { return None };
        (entity_type == &TypeId::new("hero") && !capability.phases.is_empty()).then(|| id.clone())
    }).collect();
    extension.behavior_profiles.cross_capability_order = Some(BehaviorOrderContract {
        intent_selection: vec![BehaviorOrderDeclaration { scope: BehaviorScope::Hero, actor_type: TypeId::new("hero"), capabilities,
            arbitration: ArbitrationRule { conflict_keys: vec![IntentKey::Side, IntentKey::Actor], resolution: ArbitrationResolution::SelectOrdered {
                max_accepted: 1, sort_by: vec![IntentSortTerm { key: IntentKey::ActionId, direction: SortDirection::Ascending }],
            } } }], field_writers: BTreeMap::new(),
    });
    extension.entity_scopes.insert(TypeId::new("hero"), EntityControlScope::Hero);
    extension.capabilities.insert(CapabilityId::new("move"), CapabilityContractMetadata {
        version: Version::new(1, 0, 0), effect_lifetime: CapabilityLifetime::IntentOnly,
        rejection_codes: BTreeSet::new(), description: None,
        behavior_override_arguments: BTreeMap::from([("navigation.mode".into(), 1)]),
    });
    package.catalog_semantics_digest = Some(catalog_semantics_digest(&extension).unwrap());
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    extension.ruleset_digest = package.ruleset.digest.clone();
    let plan = senritsu::validate_with_catalog_extension(package.clone(), &senritsu::next_engine_compatibility(), extension.clone()).unwrap();
    let catalog = senritsu::DomainCatalog::from_verified_plan_with_extension(&plan, extension.clone()).unwrap();
    let mut input = request();
    input["rulePackage"] = serde_json::to_value(package).unwrap();
    input["catalogMetadataExtension"] = serde_json::to_value(extension).unwrap();
    input["stamp"] = serde_json::to_value(catalog.compatibility_key()).unwrap();
    input["evaluation"] = json!({ "kind": "provided", "intents": [{ "action_id": "order", "capability": "move",
        "actor": "slot-01", "target": null, "priority": null, "arguments": [
            { "kind": "entity", "value": "slot-01" }, { "kind": "string", "value": "fastest" }
        ] }], "diagnostics": [], "legality": {} });
    let uncertain = resolve(input.clone()).unwrap();
    assert_eq!(uncertain["composition"]["values"]["navigation.mode"]["value"], "safest");
    assert_eq!(uncertain["composition"]["unknown_overrides"][0]["action_id"], "order");
    input["evaluation"]["legality"]["order"] = json!({ "kind": "known_legal" });
    let legal = resolve(input).unwrap();
    assert_eq!(legal["evaluationKind"], "provided");
    assert_eq!(legal["composition"]["values"]["navigation.mode"]["value"], "fastest");
    assert_eq!(legal["composition"]["provenance"]["navigation.mode"]["layer"], "jinrei_conditional_preference");
}

#[test]
fn distinguishes_undeclared_profile_and_rejected_input() {
    let mut undeclared = request();
    let package = senritsu::next_package();
    let plan = senritsu::validate(package.clone(), &senritsu::next_engine_compatibility()).unwrap();
    let catalog = senritsu::DomainCatalog::from_verified_plan(&plan).unwrap();
    undeclared["rulePackage"] = serde_json::to_value(package).unwrap();
    undeclared["catalogMetadataExtension"] = Value::Null;
    undeclared["stamp"] = serde_json::to_value(catalog.compatibility_key()).unwrap();
    assert_eq!(resolve(undeclared).unwrap()["status"], "not_declared");

    let mut invalid = request();
    invalid["preferences"]["army"]["not_declared"] = json!({ "kind": "bool", "value": false });
    let response = resolve(invalid).unwrap();
    assert_eq!(response["status"], "rejected");
    assert!(response["reason"].as_str().unwrap().contains("UnknownProfileField"));
}
