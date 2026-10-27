use enbu::{BehaviorBinding, BehaviorCandidateTemplate, BehaviorExecutionInputs, new_match_context, simulate_with_behavior};
use senkei_model::*;
use senritsu::catalog::*;
use std::collections::{BTreeMap, BTreeSet};

#[test]
fn default_profile_changes_world_through_real_tick() {
    let mut package = senritsu::initial_package();
    package.domain.capabilities.get_mut(&CapabilityId::new("shift_lane")).unwrap().preconditions.clear();
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
    let rules = senritsu::validate_with_catalog_extension(package, &senritsu::initial_engine_compatibility(), extension.clone()).unwrap();
    let catalog = DomainCatalog::from_verified_plan_with_extension(&rules, extension).unwrap();
    let program = jinrei::compile("senkei idle { state inert { false, }, }", &rules).unwrap().program;
    let snapshot = |id: &str| SenkeiSnapshot { schema_version: rules.plan().model_version, id: ArtifactId::new(id), revision: RevisionId::new("1"), ruleset: rules.ruleset().clone(), configuration: BTreeMap::new(), program: program.clone(), initial_memory: TacticalMemory::new() };
    let actor_id = derive_projected_entity_id(rules.package_digest(), &ProjectionId::new("unit_roster"), &TypeId::new("unit"), Some(CombatantSide::Attacker), &DomainValue::String("unit-infantry-top".into())).unwrap();
    let binding = BehaviorBinding { actor: actor_id.clone(), army_id: "fixture".into(), preferences: BTreeMap::new(), field: field.into() };
    let good = Intent { action_id: ActionId::new("default"), capability: CapabilityId::new("shift_lane"), actor: Some(actor_id.clone()), target: None, arguments: vec![DomainValue::Entity(actor_id.clone()), DomainValue::Enum(SymbolId::new("top"))], priority: None };
    let template = BehaviorCandidateTemplate { intent: good, profile_argument: Some(1) };
    let inputs = BehaviorExecutionInputs { schema_version: 1, catalog_key: serde_json::to_value(catalog.compatibility_key()).unwrap(), bindings: BTreeMap::from([(CombatantSide::Attacker, binding)]), candidates: BTreeMap::from([(1, BTreeMap::from([(CombatantSide::Attacker, vec![template.clone()])]))]) };
    let mut context = new_match_context(&rules, MatchId::new("behavior")); context.max_ticks = 1;
    let mut vm = jinrei::Vm::new(&rules);
    let run = |vm: &mut jinrei::Vm, inputs: &BehaviorExecutionInputs| simulate_with_behavior(&snapshot("a"), &snapshot("b"), &rules, &context, vm, &catalog, inputs);
    let artifact = run(&mut vm, &inputs).unwrap();
    assert!(artifact.traces_for_owner(CombatantSide::Defender).is_empty());
    let mut bad_key = inputs.clone(); bad_key.catalog_key["catalogDigest"] = serde_json::json!("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    assert!(run(&mut vm, &bad_key).is_err());
    let mut wrong_owner = inputs.clone();
    let wrong_binding = wrong_owner.bindings.remove(&CombatantSide::Attacker).unwrap();
    wrong_owner.bindings.insert(CombatantSide::Defender, wrong_binding);
    wrong_owner.candidates.get_mut(&1).unwrap().clear();
    assert!(run(&mut vm, &wrong_owner).is_err());
    let mut rejected = inputs.clone();
    rejected.candidates.get_mut(&1).unwrap().get_mut(&CombatantSide::Attacker).unwrap()[0].intent.target = Some(EntityId::new("hidden-enemy"));
    let rejected_artifact = run(&mut vm, &rejected).unwrap();
    assert!(rejected_artifact.traces_for_owner(CombatantSide::Attacker)[0].decision.selected.is_none());
    let mut mixed = inputs.clone();
    let mut bad_template = template.clone(); bad_template.intent.action_id = ActionId::new("bad"); bad_template.intent.target = Some(EntityId::new("hidden"));
    mixed.candidates.get_mut(&1).unwrap().get_mut(&CombatantSide::Attacker).unwrap().push(bad_template);
    let forward = run(&mut vm, &mixed).unwrap();
    mixed.candidates.get_mut(&1).unwrap().get_mut(&CombatantSide::Attacker).unwrap().reverse();
    let reverse = run(&mut vm, &mixed).unwrap();
    assert_eq!(forward.public_response().result.final_state_digest, reverse.public_response().result.final_state_digest);
    let mut alternate = inputs.clone(); alternate.bindings.get_mut(&CombatantSide::Attacker).unwrap().preferences.insert(field.into(), DomainValue::Enum(SymbolId::new("bot")));
    let different = run(&mut vm, &alternate).unwrap();
    assert_ne!(artifact.run_digest(), different.run_digest(), "preferences must affect diagnostic lineage");
    assert_ne!(artifact.run_digest(), rejected_artifact.run_digest(), "candidate plan must affect diagnostic lineage");
    let serialized = serde_json::to_vec(&inputs).unwrap();
    let restored: BehaviorExecutionInputs = serde_json::from_slice(&serialized).unwrap();
    let reproduced = artifact.reproduce(&rules, &mut vm).unwrap();
    assert_eq!(restored, *artifact.reproduction().1);
    assert_eq!(artifact.run_digest(), reproduced.run_digest());
    assert_eq!(artifact.public_response(), reproduced.public_response());
    assert_eq!(artifact.diagnostics_for_owner(CombatantSide::Attacker), reproduced.diagnostics_for_owner(CombatantSide::Attacker));
    assert_eq!(artifact.traces_for_owner(CombatantSide::Attacker), reproduced.traces_for_owner(CombatantSide::Attacker));
    assert_eq!(artifact.diagnostics_for_owner(CombatantSide::Attacker).diagnostics.identity.schema_version, 2);
    assert_eq!(&artifact.diagnostics_for_owner(CombatantSide::Defender).diagnostics.identity.snapshot_digest, artifact.run_digest());
    assert_eq!(artifact.reproduction().1, &restored);
    let trace = artifact.traces_for_owner(CombatantSide::Attacker);
    assert!(trace[0].arbitration_accepted && trace[0].transition_completed);
    assert!(artifact.diagnostics_for_owner(CombatantSide::Attacker).diagnostics.events.iter().any(|event| matches!(&event.record, DiagnosticRecord::IntentAccepted { intent } if intent.action_id.as_str() == "default")));
    assert!(artifact.public_response().replay.frames.last().unwrap().events.iter().any(|event| event.event.as_str() == "lane_shifted"));
}
