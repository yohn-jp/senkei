use enbu::{BehaviorBinding, new_match_context, simulate_with_behavior};
use senkei_behavior::{MovementAuthority, ProfileActor, ProfilePreferences};
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
    let actor = ProfileActor { subject_id: actor_id.clone(), scope: BehaviorScope::Army, movement_authority: MovementAuthority::Army, hero_catalog_id: None, squad_members: vec![] };
    let bindings = BTreeMap::from([(CombatantSide::Attacker, BehaviorBinding { actor, preferences: ProfilePreferences::default(), field: BehaviorFieldId::parse(field).unwrap() })]);
    let mut producer = |_: &ObservationSnapshot, profile: &senkei_behavior::ProfileComposition| vec![Intent { action_id: ActionId::new("default"), capability: CapabilityId::new("shift_lane"), actor: Some(actor_id.clone()), target: None, arguments: vec![DomainValue::Entity(actor_id.clone()), profile.values[field].clone()], priority: None }];
    let mut context = new_match_context(&rules, MatchId::new("behavior")); context.max_ticks = 1;
    let mut vm = jinrei::Vm::new(&rules);
    let (artifact, trace) = simulate_with_behavior(&snapshot("a"), &snapshot("b"), &rules, &context, &mut vm, &catalog, &catalog.compatibility_key(), &bindings, &mut producer).unwrap();
    assert!(trace.for_owner(CombatantSide::Defender).is_empty());
    let mut bad_key = catalog.compatibility_key();
    bad_key.catalog_digest = ContentDigest::new("f".repeat(64));
    assert!(simulate_with_behavior(&snapshot("a"), &snapshot("b"), &rules, &context, &mut vm, &catalog, &bad_key, &bindings, &mut producer).is_err());
    let mut wrong_owner = bindings.clone();
    let wrong_binding = wrong_owner.remove(&CombatantSide::Attacker).unwrap();
    wrong_owner.insert(CombatantSide::Defender, wrong_binding);
    assert!(simulate_with_behavior(&snapshot("a"), &snapshot("b"), &rules, &context, &mut vm, &catalog, &catalog.compatibility_key(), &wrong_owner, &mut producer).is_err());
    let mut bad = |_: &ObservationSnapshot, profile: &senkei_behavior::ProfileComposition| vec![Intent { action_id: ActionId::new("bad"), capability: CapabilityId::new("shift_lane"), actor: Some(actor_id.clone()), target: Some(EntityId::new("hidden-enemy")), arguments: vec![DomainValue::Entity(actor_id.clone()), profile.values[field].clone()], priority: None }];
    let (rejected_artifact, rejected_trace) = simulate_with_behavior(&snapshot("a"), &snapshot("b"), &rules, &context, &mut vm, &catalog, &catalog.compatibility_key(), &bindings, &mut bad).unwrap();
    assert!(rejected_trace.for_owner(CombatantSide::Attacker)[0].decision.selected.is_none());
    assert!(!rejected_artifact.diagnostics.events.iter().any(|event| matches!(&event.record, DiagnosticRecord::IntentAccepted { intent } if intent.action_id.as_str() == "bad")));
    let mix_actor = actor_id.clone();
    let mix = |reverse: bool| { let actor_id = mix_actor.clone(); move |_: &ObservationSnapshot, profile: &senkei_behavior::ProfileComposition| {
        let good = Intent { action_id: ActionId::new("good"), capability: CapabilityId::new("shift_lane"), actor: Some(actor_id.clone()), target: None, arguments: vec![DomainValue::Entity(actor_id.clone()), profile.values[field].clone()], priority: None };
        let mut invalid = good.clone(); invalid.action_id = ActionId::new("invalid"); invalid.target = Some(EntityId::new("hidden"));
        if reverse { vec![invalid, good] } else { vec![good, invalid] }
    }};
    let (forward, _) = simulate_with_behavior(&snapshot("a"), &snapshot("b"), &rules, &context, &mut vm, &catalog, &catalog.compatibility_key(), &bindings, &mut mix(false)).unwrap();
    let (reverse, _) = simulate_with_behavior(&snapshot("a"), &snapshot("b"), &rules, &context, &mut vm, &catalog, &catalog.compatibility_key(), &bindings, &mut mix(true)).unwrap();
    assert_eq!(forward.result.final_state_digest, reverse.result.final_state_digest);
    let trace = trace.for_owner(CombatantSide::Attacker);
    assert!(trace[0].arbitration_accepted && trace[0].transition_completed);
    assert!(artifact.diagnostics.events.iter().any(|event| matches!(&event.record, DiagnosticRecord::IntentAccepted { intent } if intent.action_id.as_str() == "default")));
    assert!(artifact.replay.frames.last().unwrap().events.iter().any(|event| event.event.as_str() == "lane_shifted"));
}
