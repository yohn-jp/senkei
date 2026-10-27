use enbu::{BehaviorBinding, BehaviorCandidateTemplate, BehaviorExecutionInputs, new_match_context};
use senkei_model::*;
use senritsu::catalog::*;
use std::collections::{BTreeMap, BTreeSet};

// Test-only metadata. This is a fixture, not production Senritsu policy.
#[test]
fn native_behavior_dispatch_and_fixture() {
    let mut package = senritsu::initial_package();
    package.domain.capabilities.get_mut(&CapabilityId::new("shift_lane")).unwrap().preconditions.clear();
    if let ArbitrationResolution::SelectOrdered { max_accepted, .. } = &mut package.arbitration.get_mut(&CapabilityId::new("shift_lane")).unwrap().resolution { *max_accepted = 1; }
    let ty = package.domain.capabilities[&CapabilityId::new("shift_lane")].arguments[1].value_type.clone();
    let field = "navigation.lane";
    let actor_caps = package.domain.capabilities.iter().filter_map(|(id, capability)| {
        let arg = capability.actor_argument.and_then(|i| capability.arguments.get(i as usize))?;
        matches!(&arg.value_type, DomainType::Entity { entity_type: Some(ty) } if ty.as_str() == "unit").then(|| id.clone())
    }).collect();
    let mut extension = CatalogMetadataExtension {
        schema_version: DOMAIN_CATALOG_SCHEMA_VERSION,
        ruleset_id: package.ruleset.id.clone(), ruleset_version: package.ruleset.version, ruleset_digest: package.ruleset.digest.clone(),
        entity_scopes: BTreeMap::from([(TypeId::new("unit"), EntityControlScope::Army)]),
        capabilities: BTreeMap::from([(CapabilityId::new("shift_lane"), CapabilityContractMetadata {
            version: Version::new(1,0,0), effect_lifetime: CapabilityLifetime::IntentOnly, rejection_codes: BTreeSet::new(), description: None,
            behavior_override_arguments: BTreeMap::from([(field.into(), 1)]),
        })]),
        behavior_profiles: BehaviorProfileMetadata {
            cross_capability_order: Some(BehaviorOrderContract { intent_selection: vec![BehaviorOrderDeclaration {
                scope: BehaviorScope::Army, actor_type: TypeId::new("unit"), capabilities: actor_caps,
                arbitration: ArbitrationRule { conflict_keys: vec![IntentKey::Side, IntentKey::Actor], resolution: ArbitrationResolution::SelectOrdered { max_accepted: 1, sort_by: vec![IntentSortTerm { key: IntentKey::ActionId, direction: SortDirection::Ascending }] } },
            }], field_writers: BTreeMap::new() }),
            inheritance_order: vec![ProfileLayer::SenritsuDefault, ProfileLayer::ArmyPreference, ProfileLayer::JinreiConditionalPreference],
            fields: BTreeMap::from([(field.into(), BehaviorFieldDefinition { value_type: ty, scopes: BTreeSet::from([BehaviorScope::Army]), aggregation: None, override_policy: BehaviorOverridePolicy { conditional_tick_override: true, persistent_capability: None }, description: "fixture".into(), unit: None })]),
            senritsu_default: BTreeMap::from([(field.into(), DomainValue::Enum(SymbolId::new("mid")))]), hero_defaults: BTreeMap::new(), presets: BTreeMap::new(),
        },
    };
    package.catalog_semantics_digest = Some(catalog_semantics_digest(&extension).unwrap());
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    extension.ruleset_digest = package.ruleset.digest.clone();
    let rules = senritsu::validate_with_catalog_extension(package.clone(), &senritsu::initial_engine_compatibility(), extension.clone()).unwrap();
    let catalog = DomainCatalog::from_verified_plan_with_extension(&rules, extension.clone()).unwrap();
    let program = jinrei::compile("senkei idle { state inert { false, }, }", &rules).unwrap().program;
    let snapshot = |id: &str| SenkeiSnapshot { schema_version: rules.plan().model_version, id: ArtifactId::new(id), revision: RevisionId::new("1"), ruleset: rules.ruleset().clone(), configuration: BTreeMap::new(), program: program.clone(), initial_memory: TacticalMemory::new() };
    let actor_id = derive_projected_entity_id(rules.package_digest(), &ProjectionId::new("unit_roster"), &TypeId::new("unit"), Some(CombatantSide::Attacker), &DomainValue::String("unit-infantry-top".into())).unwrap();
    let binding = BehaviorBinding { actor: actor_id.clone(), army_id: "fixture".into(), preferences: BTreeMap::new(), field: field.into() };
    let good = Intent { action_id: ActionId::new("default"), capability: CapabilityId::new("shift_lane"), actor: Some(actor_id.clone()), target: None, arguments: vec![DomainValue::Entity(actor_id.clone()), DomainValue::Enum(SymbolId::new("top"))], priority: None };
    let template = BehaviorCandidateTemplate { intent: good, profile_argument: Some(1) };
    let inputs = BehaviorExecutionInputs { schema_version: 1, catalog_key: serde_json::to_value(catalog.compatibility_key()).unwrap(), bindings: BTreeMap::from([(CombatantSide::Attacker, binding)]), candidates: BTreeMap::from([(1, BTreeMap::from([(CombatantSide::Attacker, vec![template.clone()])]))]) };
    let mut context = new_match_context(&rules, MatchId::new("behavior")); context.max_ticks = 1;
    let request = serde_json::json!({ "api_version": {"major":1,"minor":0,"patch":0}, "request_id":"behavior-fixture", "operation":"simulate_behavior", "payload": {
        "format_version":1, "rule_package": package, "catalog_metadata_extension": extension,
        "snapshot": {"attacker": snapshot("a"), "defender": snapshot("b"), "context": context},
        "behavior_inputs": inputs, "include_diagnostics": true, "diagnostics_side":"attacker"
    }});
    let response: serde_json::Value = serde_json::from_str(&senkei_wasm::dispatch_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true, "{response:#}");
    assert_eq!(response["result"]["owner"]["authorized_side"], "attacker");
    assert_eq!(response["result"]["owner"]["diagnostics"]["identity"]["schema_version"], 2);
    assert!(response["result"]["owner"]["trace"].as_array().unwrap()[0]["arbitration_accepted"].as_bool().unwrap());
    if let Ok(path) = std::env::var("SENKEI_BEHAVIOR_FIXTURE_OUT") { std::fs::write(path, serde_json::to_vec_pretty(&request).unwrap()).unwrap(); }
}
