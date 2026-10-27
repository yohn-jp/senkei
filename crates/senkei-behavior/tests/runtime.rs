use jinrei::{compile, Vm};
use senkei_behavior::*;
use senkei_model::*;
use senritsu::catalog::*;
use std::collections::{BTreeMap, BTreeSet};

const FIELDS: [(&str, &str); 8] = [
    ("navigation.preference", "balanced"),
    ("engagement.mode", "defensive"),
    ("targeting.mode", "nearest"),
    ("pursuit.mode", "limited"),
    ("survival.mode", "retreat"),
    ("objective.kind", "lane.mid"),
    ("navigation.destination", "lane.mid"),
    ("navigation.minion_lane", "lane.center"),
];

// These are intentionally unresolved RulePackage producer decisions. Fixture
// values below exercise shape and composition contracts only; they are not
// defaults or balance recommendations for the shipped next behavior.
const DECISION_REQUIRED: [(&str, &str); 8] = [
    (
        "DEC-BEHAVIOR-NAVIGATION-001",
        "Preference vocabulary, scoring weights, and Unknown-risk policy",
    ),
    (
        "DEC-BEHAVIOR-ENGAGEMENT-001",
        "Preference vocabulary and the rule-owned meaning of each value",
    ),
    (
        "DEC-BEHAVIOR-TARGETING-001",
        "Target eligibility and stable tie-break contract",
    ),
    (
        "DEC-BEHAVIOR-PURSUIT-001",
        "Pursuit limits, visibility semantics, and path legality",
    ),
    (
        "DEC-BEHAVIOR-SURVIVAL-001",
        "Thresholds and their versioned unit/range",
    ),
    (
        "DEC-BEHAVIOR-OBJECTIVE-001",
        "Objective identifiers, ownership scope, and preference aggregation",
    ),
    (
        "DEC-BEHAVIOR-AGGREGATION-001",
        "Numeric Hero-to-Squad formulas and cross-scope preference precedence",
    ),
    (
        "DEC-BEHAVIOR-BINDING-001",
        "Physical representation of the exact-pinned Behavior extension",
    ),
];

struct Fixture {
    plan: VerifiedRulePlan,
    catalog: DomainCatalog,
    resolver: BehaviorResolver,
    hero_ids: [String; 2],
}

fn fixture() -> Fixture {
    let mut package = senritsu::next_package();
    let provisional = senritsu::validate(package.clone(), &senritsu::next_engine_compatibility())
        .unwrap_or_else(|issues| panic!("fixture RulePackage must validate: {issues:#?}"));
    let heroes = &provisional.plan().next.as_ref().unwrap().heroes;
    let hero_ids = [heroes[0].id.clone(), heroes[1].id.clone()];
    let extension = test_extension(&provisional, &hero_ids);
    package.catalog_semantics_digest = Some(catalog_semantics_digest(&extension).unwrap());
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    let mut extension = extension;
    extension.ruleset_digest = package.ruleset.digest.clone();
    let plan = senritsu::validate_with_catalog_extension(package, &senritsu::next_engine_compatibility(), extension)
        .unwrap_or_else(|issues| panic!("bound fixture RulePackage must validate: {issues:#?}"));
    let extension = test_extension(&plan, &hero_ids);
    let catalog = DomainCatalog::from_verified_plan_with_extension(&plan, extension)
        .unwrap_or_else(|error| panic!("fixture Catalog must validate: {error:#?}"));
    let resolver = BehaviorResolver::new(&catalog, &catalog.compatibility_key()).unwrap();
    Fixture { plan, catalog, resolver, hero_ids }
}

#[test]
fn package_rejects_missing_or_semantically_changed_behavior_extension_at_validation() {
    let fixture = fixture();
    let mut package = senritsu::next_package();
    let mut extension = test_extension(&fixture.plan, &fixture.hero_ids);
    package.catalog_semantics_digest = Some(catalog_semantics_digest(&extension).unwrap());
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    extension.ruleset_digest = package.ruleset.digest.clone();

    let missing = senritsu::validate(package.clone(), &senritsu::next_engine_compatibility())
        .expect_err("a package reference cannot stand in for the Behavior artifact");
    assert!(missing.iter().any(|issue| issue.code == "missing_catalog_semantics_extension"));

    extension.behavior_profiles.senritsu_default.insert(
        "engagement.mode".into(),
        DomainValue::String("aggressive".into()),
    );
    let mismatch = senritsu::validate_with_catalog_extension(
        package,
        &senritsu::next_engine_compatibility(),
        extension,
    )
    .expect_err("changed Behavior semantics must not produce an executable plan");
    assert!(mismatch.iter().any(|issue| issue.code == "catalog_semantics_digest_mismatch"), "unexpected validation issues: {mismatch:#?}");
}

fn bind_extension(mut extension: CatalogMetadataExtension) -> (VerifiedRulePlan, CatalogMetadataExtension) {
    let mut package = senritsu::next_package();
    package.catalog_semantics_digest = Some(catalog_semantics_digest(&extension).unwrap());
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    extension.ruleset_digest = package.ruleset.digest.clone();
    let plan = senritsu::validate_with_catalog_extension(package, &senritsu::next_engine_compatibility(), extension.clone())
        .expect("extension-bound RulePackage validates");
    extension.ruleset_id = plan.ruleset().id.clone();
    extension.ruleset_version = plan.ruleset().version;
    extension.ruleset_digest = plan.package_digest().clone();
    (plan, extension)
}

fn test_extension(
    plan: &VerifiedRulePlan,
    hero_ids: &[String; 2],
) -> CatalogMetadataExtension {
    let intent_capabilities = plan.plan().domain.capabilities.iter().filter_map(|(id, capability)| {
        let actor = capability.actor_argument.and_then(|index| capability.arguments.get(index as usize))?;
        let DomainType::Entity { entity_type: Some(entity_type) } = &actor.value_type else { return None };
        (entity_type == &TypeId::new("hero") && !capability.phases.is_empty()).then(|| id.clone())
    }).collect::<BTreeSet<_>>();
    let mut fields = BTreeMap::new();
    let inherited_scopes = [BehaviorScope::Army, BehaviorScope::Squad, BehaviorScope::Hero]
        .into_iter()
        .collect::<BTreeSet<_>>();
    for (field, _) in FIELDS {
        let hero_only = field == "targeting.mode" || field == "navigation.destination";
        let army_only = field == "objective.kind";
        let minion_only = field == "navigation.minion_lane";
        let scopes = if minion_only {
            [BehaviorScope::LaneLimitedMinion].into_iter().collect()
        } else if hero_only {
            [BehaviorScope::Hero].into_iter().collect()
        } else if army_only {
            [BehaviorScope::Army].into_iter().collect()
        } else {
            inherited_scopes.clone()
        };
        fields.insert(
            field.to_owned(),
            BehaviorFieldDefinition {
                value_type: DomainType::String { max_bytes: 64 },
                scopes,
                aggregation: (!hero_only && !army_only && !minion_only)
                    .then_some(AggregationPolicy::FirstByStableSubjectId),
                override_policy: BehaviorOverridePolicy {
                    conditional_tick_override: true,
                    persistent_capability: None,
                },
                description: format!("Fixture {field} preference"),
                unit: None,
            },
        );
    }
    let default_values = FIELDS
        .iter()
        .map(|(field, value)| ((*field).to_owned(), DomainValue::String((*value).into())))
        .collect::<BTreeMap<_, _>>();
    let mut hero_defaults = BTreeMap::new();
    for (index, hero_id) in hero_ids.iter().enumerate() {
        let mut values = default_values
            .iter()
            .filter(|(field, _)| {
                field.as_str() != "objective.kind" && field.as_str() != "navigation.minion_lane"
            })
            .map(|(field, value)| (field.clone(), value.clone()))
            .collect::<BTreeMap<_, _>>();
        values.insert(
            "engagement.mode".into(),
            DomainValue::String(if index == 0 { "aggressive" } else { "defensive" }.into()),
        );
        values.insert(
            "navigation.destination".into(),
            DomainValue::String(format!("hero-{index}")),
        );
        hero_defaults.insert(hero_id.clone(), values);
    }
    let behavior_profiles = BehaviorProfileMetadata {
        cross_capability_order: Some(BehaviorOrderContract {
            intent_selection: vec![order_declaration(
                BehaviorScope::Hero,
                TypeId::new("hero"),
                intent_capabilities,
                SortDirection::Ascending,
            )],
            field_writers: BTreeMap::new(),
        }),
        inheritance_order: vec![
            ProfileLayer::SenritsuDefault,
            ProfileLayer::HeroCatalogDefault,
            ProfileLayer::ArmyPreference,
            ProfileLayer::SquadAggregate,
            ProfileLayer::JinreiConditionalPreference,
        ],
        fields,
        senritsu_default: default_values,
        hero_defaults,
        presets: BTreeMap::from([(
            "balanced.safe".into(),
            NamedBehaviorPreset {
                name: "Balanced safe".into(),
                scope: BehaviorScope::Hero,
                values: BTreeMap::from([(
                    "survival.mode".into(),
                    DomainValue::String("retreat".into()),
                )]),
                description: "Fixture named preset".into(),
            },
        )]),
    };
    let capabilities = BTreeMap::from([(
        CapabilityId::new("move"),
        CapabilityContractMetadata {
            version: Version::new(1, 0, 0),
            effect_lifetime: CapabilityLifetime::IntentOnly,
            rejection_codes: BTreeSet::new(),
            description: Some("Fixture Tick-local preference capability".into()),
            behavior_override_arguments: BTreeMap::from([(
                "navigation.destination".into(),
                1,
            )]),
        },
    )]);
    CatalogMetadataExtension {
        schema_version: DOMAIN_CATALOG_SCHEMA_VERSION,
        ruleset_id: plan.ruleset().id.clone(),
        ruleset_version: plan.ruleset().version,
        ruleset_digest: plan.package_digest().clone(),
        entity_scopes: BTreeMap::from([(TypeId::new("hero"), EntityControlScope::Hero)]),
        capabilities,
        behavior_profiles,
    }
}

fn order_declaration(
    scope: BehaviorScope,
    actor_type: TypeId,
    capabilities: BTreeSet<CapabilityId>,
    direction: SortDirection,
) -> BehaviorOrderDeclaration {
    BehaviorOrderDeclaration {
        scope,
        actor_type,
        capabilities,
        arbitration: ArbitrationRule {
            conflict_keys: vec![IntentKey::Side, IntentKey::Actor],
            resolution: ArbitrationResolution::SelectOrdered {
                max_accepted: 1,
                sort_by: vec![IntentSortTerm { key: IntentKey::ActionId, direction }],
            },
        },
    }
}

fn actor(hero_id: &str, entity: &str) -> ProfileActor {
    ProfileActor {
        subject_id: EntityId::new(entity),
        scope: BehaviorScope::Hero,
        movement_authority: MovementAuthority::SoloHero,
        hero_catalog_id: Some(hero_id.to_owned()),
        squad_members: Vec::new(),
    }
}

fn member(entity: &str, hero_id: &str) -> HeroMember {
    HeroMember {
        subject_id: EntityId::new(entity),
        hero_catalog_id: hero_id.to_owned(),
    }
}

fn execution(intents: Vec<Intent>, diagnostics: Vec<TacticalDiagnostic>) -> TacticalExecutionOutput {
    TacticalExecutionOutput {
        status: TacticalExecutionStatus::Completed,
        intents,
        next_memory: TacticalMemory::new(),
        charged_cu: LogicalCu::ZERO,
        required_cu: LogicalCu::ZERO,
        diagnostics,
    }
}

fn move_intent(action: &str, actor: &str, destination: &str) -> Intent {
    Intent {
        action_id: ActionId::new(action),
        capability: CapabilityId::new("move"),
        actor: Some(EntityId::new(actor)),
        target: None,
        arguments: vec![
            DomainValue::Entity(EntityId::new(actor)),
            DomainValue::String(destination.into()),
        ],
        priority: None,
    }
}

fn candidate(
    intent: Intent,
    source: CandidateSource,
    tick: u32,
    side: CombatantSide,
    profile_digest: Option<ContentDigest>,
    legality: Legality,
) -> IntentCandidate {
    IntentCandidate { intent, source, tick, side, profile_digest, legality }
}

fn empty_execution() -> TacticalExecutionOutput {
    execution(Vec::new(), Vec::new())
}

#[test]
fn profile_composes_all_six_domains_and_only_applicable_fields() {
    let fixture = fixture();
    let hero = actor(&fixture.hero_ids[0], "hero-z");
    let execution = empty_execution();
    let composed = fixture
        .resolver
        .compose(&hero, &ProfilePreferences::default(), 8, CombatantSide::Attacker, &execution, &BTreeMap::new())
        .unwrap();
    assert_eq!(composed.values["navigation.preference"], DomainValue::String("balanced".into()));
    assert_eq!(composed.values["engagement.mode"], DomainValue::String("aggressive".into()));
    assert_eq!(composed.values["targeting.mode"], DomainValue::String("nearest".into()));
    assert_eq!(composed.values["pursuit.mode"], DomainValue::String("limited".into()));
    assert_eq!(composed.values["survival.mode"], DomainValue::String("retreat".into()));
    assert_eq!(composed.values["objective.kind"], DomainValue::String("lane.mid".into()));
    assert_eq!(composed.values["navigation.destination"], DomainValue::String("hero-0".into()));
    assert!(!composed.values.contains_key("navigation.minion_lane"));
    assert_eq!(composed.provenance["engagement.mode"].layer, ProfileLayer::SquadAggregate);
    assert_eq!(composed.unknown_conditions, Vec::<UnknownCondition>::new());
    assert_eq!(composed.unknown_overrides, Vec::<UnknownOverride>::new());

    let squad = ProfileActor {
        subject_id: EntityId::new("squad-1"),
        scope: BehaviorScope::Squad,
        movement_authority: MovementAuthority::Squad,
        hero_catalog_id: None,
        squad_members: vec![
            member("hero-z", &fixture.hero_ids[0]),
            member("hero-a", &fixture.hero_ids[1]),
        ],
    };
    let squad_profile = fixture.resolver
        .compose(&squad, &ProfilePreferences::default(), 8, CombatantSide::Attacker, &execution, &BTreeMap::new())
        .unwrap();
    assert_eq!(squad_profile.values["engagement.mode"], DomainValue::String("defensive".into()));
    assert!(!squad_profile.values.contains_key("targeting.mode"));
    assert!(!squad_profile.values.contains_key("navigation.destination"));

    let minion = ProfileActor {
        subject_id: EntityId::new("lane-minions-mid"),
        scope: BehaviorScope::LaneLimitedMinion,
        movement_authority: MovementAuthority::LaneGroup,
        hero_catalog_id: None,
        squad_members: Vec::new(),
    };
    let minion_profile = fixture
        .resolver
        .compose(
            &minion,
            &ProfilePreferences::default(),
            8,
            CombatantSide::Attacker,
            &execution,
            &BTreeMap::new(),
        )
        .unwrap();
    assert_eq!(
        minion_profile.values,
        BTreeMap::from([(
            "navigation.minion_lane".into(),
            DomainValue::String("lane.center".into()),
        )])
    );
}

#[test]
fn squad_tie_break_and_composition_digest_are_stable_and_membership_sensitive() {
    let fixture = fixture();
    let first = member("hero-a", &fixture.hero_ids[1]);
    let second = member("hero-z", &fixture.hero_ids[0]);
    let squad = |members| ProfileActor {
        subject_id: EntityId::new("squad-1"),
        scope: BehaviorScope::Squad,
        movement_authority: MovementAuthority::Squad,
        hero_catalog_id: None,
        squad_members: members,
    };
    let empty = empty_execution();
    let left = fixture.resolver.compose(&squad(vec![first.clone(), second.clone()]), &ProfilePreferences::default(), 3, CombatantSide::Defender, &empty, &BTreeMap::new()).unwrap();
    let reordered = fixture.resolver.compose(&squad(vec![second.clone(), first.clone()]), &ProfilePreferences::default(), 3, CombatantSide::Defender, &empty, &BTreeMap::new()).unwrap();
    let changed = fixture.resolver.compose(&squad(vec![first]), &ProfilePreferences::default(), 3, CombatantSide::Defender, &empty, &BTreeMap::new()).unwrap();
    assert_eq!(left.values["engagement.mode"], DomainValue::String("defensive".into()));
    assert_eq!(left.digest, reordered.digest);
    assert_ne!(left.digest, changed.digest); // Same preference values, different roster identity.
    assert_eq!(
        fixture.resolver.resolve_candidates(&left, &squad(vec![member("hero-a", &fixture.hero_ids[1])]), 3, CombatantSide::Defender, &[], None),
        Err(BehaviorError::StaleComposition),
    );
}

#[test]
fn squad_aggregation_rejects_conflicting_hero_defaults_when_agreement_is_required() {
    let fixture = fixture();
    let mut extension = test_extension(&fixture.plan, &fixture.hero_ids);
    extension
        .behavior_profiles
        .fields
        .get_mut("engagement.mode")
        .expect("fixture engagement field")
        .aggregation = Some(AggregationPolicy::RequireAgreement);
    let (plan, extension) = bind_extension(extension);
    let catalog = DomainCatalog::from_verified_plan_with_extension(&plan, extension)
        .expect("explicit RequireAgreement policy is valid");
    let resolver = BehaviorResolver::new(&catalog, &catalog.compatibility_key()).unwrap();
    let squad = ProfileActor {
        subject_id: EntityId::new("squad-conflict"),
        scope: BehaviorScope::Squad,
        movement_authority: MovementAuthority::Squad,
        hero_catalog_id: None,
        squad_members: vec![
            member("hero-a", &fixture.hero_ids[0]),
            member("hero-b", &fixture.hero_ids[1]),
        ],
    };
    assert_eq!(
        resolver.compose(
            &squad,
            &ProfilePreferences::default(),
            3,
            CombatantSide::Attacker,
            &empty_execution(),
            &BTreeMap::new(),
        ),
        Err(BehaviorError::SquadAggregationConflict(
            "engagement.mode".into()
        ))
    );
}

#[test]
fn army_squad_and_jinrei_overrides_are_partial_and_unknown_is_preserved() {
    let fixture = fixture();
    let actor = actor(&fixture.hero_ids[0], "hero-one");
    let mut preferences = ProfilePreferences {
        army_id: "army-1".into(),
        squad_id: "squad-1".into(),
        ..ProfilePreferences::default()
    };
    preferences.army.insert("objective.kind".into(), DomainValue::String("lane.top".into()));
    preferences.squad.insert("engagement.mode".into(), DomainValue::String("aggressive".into()));
    let movement = move_intent("choose_lane", "hero-one", "lane.bot");
    let output = execution(vec![movement], Vec::new());
    let legality = BTreeMap::from([(ActionId::new("choose_lane"), Legality::KnownLegal)]);
    let composed = fixture.resolver.compose(&actor, &preferences, 7, CombatantSide::Attacker, &output, &legality).unwrap();
    assert_eq!(composed.values["objective.kind"], DomainValue::String("lane.top".into()));
    assert_eq!(composed.values["engagement.mode"], DomainValue::String("aggressive".into()));
    assert_eq!(composed.values["navigation.destination"], DomainValue::String("lane.bot".into()));
    assert_eq!(composed.provenance["navigation.destination"].layer, ProfileLayer::JinreiConditionalPreference);

    let unknown_output = execution(
        Vec::new(),
        vec![TacticalDiagnostic::RuntimeNotice {
            code: DiagnosticCode::new("when_unknown"),
            details: BTreeMap::from([("action".into(), "conditional_move".into())]),
        }],
    );
    let unknown = fixture.resolver.compose(&actor, &preferences, 8, CombatantSide::Attacker, &unknown_output, &BTreeMap::new()).unwrap();
    assert_eq!(unknown.unknown_conditions, vec![UnknownCondition { action_id: "conditional_move".into(), truth: Truth::Unknown }]);
    assert_eq!(unknown.values["navigation.destination"], DomainValue::String("hero-0".into()));

    let emitted = move_intent("uncertified", "hero-one", "lane.top");
    let uncertified = fixture.resolver.compose(
        &actor,
        &preferences,
        9,
        CombatantSide::Attacker,
        &execution(vec![emitted], Vec::new()),
        &BTreeMap::from([(ActionId::new("uncertified"), Legality::Unknown { reason: "world fact unavailable".into() })]),
    ).unwrap();
    assert_eq!(uncertified.values["navigation.destination"], DomainValue::String("hero-0".into()));
    assert_eq!(uncertified.unknown_overrides[0].reason, "world fact unavailable");
}

#[test]
fn real_next_catalog_and_jinrei_vm_feed_typed_profile_binding() {
    let fixture = fixture();
    let source = r#"senkei local_move {
        action choose_lane { when true, do move(argmin h in filter h in allies.heroes { h.slot_id == "hero-one", } by h.level then h.id, "lane.mid"), },
    }"#;
    let compiled = compile(source, &fixture.plan).unwrap();
    let observation = ObservationSnapshot {
        tick: 11,
        side: CombatantSide::Attacker,
        fields: BTreeMap::new(),
        collections: BTreeMap::from([(
            CollectionId::new("allies.heroes"),
            Observed::Known(vec![EntityObservation {
                id: EntityId::new("hero-one"),
                entity_type: TypeId::new("hero"),
                fields: BTreeMap::from([
                    (FieldId::new("slot_id"), Observed::Known(DomainValue::String("hero-one".into()))),
                    (FieldId::new("level"), Observed::Known(DomainValue::Integer(3))),
                ]),
            }]),
        )]),
    };
    let allowed = [CapabilityId::new("move")].into_iter().collect();
    let memory = TacticalMemory::new();
    let mut vm = Vm::new(&fixture.plan);
    let output = vm.execute(TacticalExecutionRequest {
        side: observation.side,
        tick: observation.tick,
        program: &compiled.program,
        observation: &observation,
        memory: &memory,
        allowed_capabilities: &allowed,
        budget: ExecutionBudget { available_cu: LogicalCu(10_000), max_intents: 8 },
    }).unwrap();
    assert_eq!(output.intents.len(), 1);
    assert_eq!(output.intents[0].arguments[1], DomainValue::String("lane.mid".into()));
    let actor = actor(&fixture.hero_ids[0], "hero-one");
    let composition = fixture.resolver.compose(
        &actor,
        &ProfilePreferences::default(),
        observation.tick,
        observation.side,
        &output,
        &BTreeMap::from([(ActionId::new("choose_lane"), Legality::KnownLegal)]),
    ).unwrap();
    assert_eq!(composition.values["navigation.destination"], DomainValue::String("lane.mid".into()));
}

#[test]
fn unknown_jinrei_collection_does_not_fire_conditional_override() {
    let fixture = fixture();
    let source = r#"senkei unknown_move {
        action choose_lane { when any foe in enemies.visible_heroes { foe.hp > 0, }, do move(argmin h in filter h in allies.heroes { h.slot_id == "hero-one", } by h.level then h.id, "lane.mid"), },
    }"#;
    let compiled = compile(source, &fixture.plan).unwrap();
    let observation = ObservationSnapshot {
        tick: 12,
        side: CombatantSide::Attacker,
        fields: BTreeMap::new(),
        collections: BTreeMap::from([
            (CollectionId::new("allies.heroes"), Observed::Known(vec![EntityObservation {
                id: EntityId::new("hero-one"),
                entity_type: TypeId::new("hero"),
                fields: BTreeMap::from([
                    (FieldId::new("slot_id"), Observed::Known(DomainValue::String("hero-one".into()))),
                    (FieldId::new("level"), Observed::Known(DomainValue::Integer(3))),
                ]),
            }])),
            (CollectionId::new("enemies.visible_heroes"), Observed::Unknown),
        ]),
    };
    let allowed = [CapabilityId::new("move")].into_iter().collect();
    let memory = TacticalMemory::new();
    let mut vm = Vm::new(&fixture.plan);
    let output = vm.execute(TacticalExecutionRequest {
        side: observation.side,
        tick: observation.tick,
        program: &compiled.program,
        observation: &observation,
        memory: &memory,
        allowed_capabilities: &allowed,
        budget: ExecutionBudget { available_cu: LogicalCu(10_000), max_intents: 8 },
    }).unwrap();
    assert!(output.intents.is_empty());
    assert!(output.diagnostics.iter().any(|diagnostic| matches!(diagnostic,
        TacticalDiagnostic::RuntimeNotice { code, .. } if code.as_str() == "when_unknown")));
    let actor = actor(&fixture.hero_ids[0], "hero-one");
    let composition = fixture.resolver.compose(&actor, &ProfilePreferences::default(), 12, observation.side, &output, &BTreeMap::new()).unwrap();
    assert_eq!(composition.values["navigation.destination"], DomainValue::String("hero-0".into()));
    assert_eq!(composition.unknown_conditions.len(), 1);
}

#[test]
fn explicit_beats_default_unknown_falls_through_and_stale_profile_is_rejected() {
    let fixture = fixture();
    let actor = actor(&fixture.hero_ids[0], "hero-one");
    let empty = empty_execution();
    let composition = fixture.resolver.compose(&actor, &ProfilePreferences::default(), 5, CombatantSide::Attacker, &empty, &BTreeMap::new()).unwrap();
    let explicit = candidate(move_intent("explicit", "hero-one", "lane.top"), CandidateSource::Explicit, 5, CombatantSide::Attacker, None, Legality::KnownLegal);
    let default = candidate(move_intent("default", "hero-one", "lane.mid"), CandidateSource::Default, 5, CombatantSide::Attacker, Some(composition.digest.clone()), Legality::KnownLegal);
    let selected = fixture.resolver.resolve_candidates(&composition, &actor, 5, CombatantSide::Attacker, &[explicit.clone(), default.clone()], None).unwrap();
    assert_eq!(selected.selected.unwrap().action_id, ActionId::new("explicit"));

    let unknown = candidate(explicit.intent.clone(), CandidateSource::Explicit, 5, CombatantSide::Attacker, None, Legality::Unknown { reason: "not observed".into() });
    let fell_through = fixture.resolver.resolve_candidates(&composition, &actor, 5, CombatantSide::Attacker, &[unknown, default.clone()], None).unwrap();
    assert_eq!(fell_through.selected.unwrap().action_id, ActionId::new("default"));
    assert!(fell_through.trace.iter().any(|item| matches!(item, DecisionTrace::CandidateUnknown { .. })));

    let denied = candidate(
        explicit.intent.clone(),
        CandidateSource::Explicit,
        5,
        CombatantSide::Attacker,
        None,
        Legality::PermissionDenied { reason: "restricted actor".into() },
    );
    let permission_fallthrough = fixture.resolver.resolve_candidates(&composition, &actor, 5, CombatantSide::Attacker, &[denied, default.clone()], None).unwrap();
    assert_eq!(permission_fallthrough.selected.unwrap().action_id, ActionId::new("default"));
    assert!(permission_fallthrough.trace.iter().any(|item| matches!(item, DecisionTrace::CandidateRejected { reason: RejectionReason::PermissionDenied(_), .. })));

    let tie_b = candidate(Intent { priority: Some(0), ..move_intent("b", "hero-one", "lane.top") }, CandidateSource::Explicit, 5, CombatantSide::Attacker, None, Legality::KnownLegal);
    let tie_a = candidate(Intent { priority: Some(0), ..move_intent("a", "hero-one", "lane.bot") }, CandidateSource::Explicit, 5, CombatantSide::Attacker, None, Legality::KnownLegal);
    let stable_tie = fixture.resolver.resolve_candidates(&composition, &actor, 5, CombatantSide::Attacker, &[tie_b, tie_a], None).unwrap();
    assert_eq!(stable_tie.selected.unwrap().action_id, ActionId::new("a"));

    let stale = candidate(default.intent.clone(), CandidateSource::Default, 5, CombatantSide::Attacker, Some(ContentDigest::new("0".repeat(64))), Legality::KnownLegal);
    let rejected = fixture.resolver.resolve_candidates(&composition, &actor, 5, CombatantSide::Attacker, &[stale], None).unwrap();
    assert!(rejected.selected.is_none());
    assert!(rejected.trace.iter().any(|item| matches!(item, DecisionTrace::CandidateRejected { reason: RejectionReason::StaleProfile, .. })));
}

#[test]
fn conflicts_missing_roster_and_squad_hero_movement_are_explicitly_rejected() {
    let fixture = fixture();
    let hero = actor(&fixture.hero_ids[0], "hero-one");
    let wrong_roster = ProfileActor {
        movement_authority: MovementAuthority::HeroInSquad,
        squad_members: vec![member("someone-else", &fixture.hero_ids[1]), member("hero-two", &fixture.hero_ids[0])],
        ..hero.clone()
    };
    assert_eq!(fixture.resolver.compose(&wrong_roster, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &empty_execution(), &BTreeMap::new()), Err(BehaviorError::HeroNotInRoster));

    let squad_hero = ProfileActor {
        movement_authority: MovementAuthority::HeroInSquad,
        squad_members: vec![member("hero-one", &fixture.hero_ids[0]), member("hero-two", &fixture.hero_ids[1])],
        ..hero.clone()
    };
    let composition = fixture.resolver.compose(&squad_hero, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &empty_execution(), &BTreeMap::new()).unwrap();
    let movement = candidate(move_intent("move", "hero-one", "lane.mid"), CandidateSource::Explicit, 1, CombatantSide::Attacker, None, Legality::KnownLegal);
    let movement = IntentCandidate {
        legality: Legality::KnownRejected { reason: "Enbu requires Squad movement authority".into() },
        ..movement
    };
    let denied = fixture.resolver.resolve_candidates(&composition, &squad_hero, 1, CombatantSide::Attacker, &[movement], None).unwrap();
    assert!(denied.selected.is_none());
    assert!(denied.trace.iter().any(|item| matches!(item, DecisionTrace::CandidateRejected { reason: RejectionReason::CallerRejected(message), .. } if message.contains("Squad movement authority"))));

    let hero_skill = Intent {
        action_id: ActionId::new("hero_skill"),
        capability: CapabilityId::new("activate"),
        actor: Some(EntityId::new("hero-one")),
        target: Some(EntityId::new("hero-one")),
        arguments: vec![
            DomainValue::Entity(EntityId::new("hero-one")),
            DomainValue::String("fixture.skill".into()),
            DomainValue::Entity(EntityId::new("hero-one")),
        ],
        priority: None,
    };
    let certified_skill = candidate(hero_skill, CandidateSource::Explicit, 1, CombatantSide::Attacker, None, Legality::KnownLegal);
    let allowed = fixture.resolver.resolve_candidates(&composition, &squad_hero, 1, CombatantSide::Attacker, &[certified_skill], None).unwrap();
    assert_eq!(allowed.selected.unwrap().capability, CapabilityId::new("activate"));

    let a = move_intent("a", "hero-one", "lane.top");
    let b = Intent { action_id: ActionId::new("b"), capability: CapabilityId::new("retreat"), actor: Some(EntityId::new("hero-one")), target: None, arguments: vec![DomainValue::Entity(EntityId::new("hero-one"))], priority: None };
    let one = candidate(a, CandidateSource::Explicit, 1, CombatantSide::Attacker, None, Legality::KnownLegal);
    let two = candidate(b, CandidateSource::Explicit, 1, CombatantSide::Attacker, None, Legality::KnownLegal);
    assert_eq!(fixture.resolver.resolve_candidates(&composition, &squad_hero, 1, CombatantSide::Attacker, &[one, two], None)
        .unwrap().selected.unwrap().action_id, ActionId::new("a"));
}

#[test]
fn current_next_catalog_uses_a_caller_certified_noop_without_fabricating_a_capability() {
    let fixture = fixture();
    let actor = actor(&fixture.hero_ids[0], "hero-one");
    let composition = fixture.resolver.compose(&actor, &ProfilePreferences::default(), 4, CombatantSide::Defender, &empty_execution(), &BTreeMap::new()).unwrap();
    let fallback = NoOpFallbackCandidate {
        kind: NoOpFallbackKind::Wait,
        tick: 4,
        side: CombatantSide::Defender,
        legality: Legality::KnownLegal,
    };
    let decision = fixture.resolver.resolve_candidates(&composition, &actor, 4, CombatantSide::Defender, &[], Some(&fallback)).unwrap();
    assert!(decision.selected.is_none());
    assert_eq!(decision.fallback_kind, Some(NoOpFallbackKind::Wait));
    assert!(decision.trace.iter().any(|item| matches!(item, DecisionTrace::FallbackSelected { kind: NoOpFallbackKind::Wait, legality: LegalityEvidence::CallerCertified })));

    let uncertified = NoOpFallbackCandidate {
        legality: Legality::Unknown { reason: "no-op policy not authorized".into() },
        ..fallback
    };
    let decision = fixture.resolver.resolve_candidates(&composition, &actor, 4, CombatantSide::Defender, &[], Some(&uncertified)).unwrap();
    assert_eq!(decision.fallback_kind, None);
    assert!(decision.trace.iter().any(|item| matches!(item, DecisionTrace::FallbackRejected { reason: RejectionReason::LegalityUnknown(_), .. })));
}

#[test]
fn package_identity_and_rule_plan_canonical_arbitration_are_consumed() {
    let fixture = fixture();
    assert!(fixture.catalog.is_compatible_with(&fixture.catalog.compatibility_key()));
    let other = CatalogCompatibilityKey {
        identity: fixture.catalog.identity().clone(),
        catalog_digest: ContentDigest::new("f".repeat(64)),
        metadata_extension_digest: fixture.catalog.metadata_extension_digest().cloned(),
    };
    assert_eq!(BehaviorResolver::new(&fixture.catalog, &other).err(), Some(BehaviorError::CatalogIdentityMismatch));
    assert_eq!(fixture.catalog.ordering().arbitration, fixture.plan.plan().arbitration);
}

#[test]
fn producer_contract_keeps_six_domain_schemas_typed_and_values_unresolved() {
    let fixture = fixture();
    let (metadata_digest, metadata) = match fixture.catalog.behavior_profiles() {
        MetadataStatus::AuthoredExtension { digest, metadata } => (digest, metadata),
        MetadataStatus::NotDeclaredByRulePackage => panic!("fixture extension must be authored"),
    };
    let schemas = metadata.typed_schemas().expect("typed fixture profile schema");
    assert_eq!(
        BehaviorDomain::ALL.map(BehaviorDomain::as_str),
        ["navigation", "engagement", "targeting", "pursuit", "survival", "objective"]
    );
    assert!(schemas.navigation.fields.contains_key("preference"));
    assert!(schemas.engagement.fields.contains_key("mode"));
    assert!(schemas.targeting.fields.contains_key("mode"));
    assert!(schemas.pursuit.fields.contains_key("mode"));
    assert!(schemas.survival.fields.contains_key("mode"));
    assert!(schemas.objective.fields.contains_key("kind"));
    assert!(metadata.presets["balanced.safe"].values.contains_key("survival.mode"));
    assert_eq!(
        fixture.catalog.compatibility_key().metadata_extension_digest.as_ref(),
        Some(metadata_digest)
    );
    assert_eq!(DECISION_REQUIRED.len(), BehaviorDomain::ALL.len() + 2);
    assert!(DECISION_REQUIRED
        .iter()
        .all(|(id, decision)| id.starts_with("DEC-BEHAVIOR-") && !decision.trim().is_empty()));

    // The package digest declares the extension as required. Dropping it is
    // rejected instead of silently producing a catalog with weaker semantics.
    assert!(DomainCatalog::from_verified_plan(&fixture.plan).is_err(),
        "a package that commits Behavior semantics must reject a missing extension");

    // Both metadata and catalog digest materials must reproduce exactly for
    // identical producer input, including their complete compatibility key.
    let first = DomainCatalog::from_verified_plan_with_extension(
        &fixture.plan,
        test_extension(&fixture.plan, &fixture.hero_ids),
    )
    .unwrap();
    let second = DomainCatalog::from_verified_plan_with_extension(
        &fixture.plan,
        test_extension(&fixture.plan, &fixture.hero_ids),
    )
    .unwrap();
    assert_eq!(first.metadata_extension_digest(), Some(metadata_digest));
    assert_eq!(first.metadata_extension_digest(), second.metadata_extension_digest());
    assert_eq!(first.catalog_digest(), second.catalog_digest());
    assert_eq!(first.compatibility_key(), second.compatibility_key());
}

fn authored_order_fixture() -> Fixture { authored_order_fixture_edit(|_| {}) }

fn authored_order_fixture_edit(edit: impl FnOnce(&mut CatalogMetadataExtension)) -> Fixture {
    authored_order_fixture_config(|_, extension| edit(extension))
}

fn authored_order_fixture_config(edit: impl FnOnce(&mut RulePackage, &mut CatalogMetadataExtension)) -> Fixture {
    let mut package = senritsu::next_package();
    let provisional = senritsu::validate(package.clone(), &senritsu::next_engine_compatibility()).unwrap();
    let heroes = &provisional.plan().next.as_ref().unwrap().heroes;
    let hero_ids = [heroes[0].id.clone(), heroes[1].id.clone()];
    let mut extension = test_extension(&provisional, &hero_ids);
    let mut skill = extension.capabilities[&CapabilityId::new("move")].clone();
    skill.behavior_override_arguments.insert("targeting.mode".into(), 1);
    extension.capabilities.insert(CapabilityId::new("activate"), skill);
    let intent_capabilities = package.domain.capabilities.iter().filter_map(|(id, capability)| {
        let actor = capability.actor_argument.and_then(|index| capability.arguments.get(index as usize))?;
        let DomainType::Entity { entity_type: Some(entity_type) } = &actor.value_type else { return None };
        (entity_type == &TypeId::new("hero") && !capability.phases.is_empty()).then(|| id.clone())
    }).collect::<BTreeSet<_>>();
    let declaration = |capabilities, direction| order_declaration(BehaviorScope::Hero, TypeId::new("hero"), capabilities, direction);
    // Deliberately different fixture orders. These are not production policy.
    extension.behavior_profiles.cross_capability_order = Some(BehaviorOrderContract {
        intent_selection: vec![declaration(intent_capabilities, SortDirection::Ascending)],
        field_writers: BTreeMap::from([("navigation.destination".into(), vec![declaration(
            [CapabilityId::new("move"), CapabilityId::new("activate")].into_iter().collect(),
            SortDirection::Descending,
        )])]),
    });
    edit(&mut package, &mut extension);
    package.catalog_semantics_digest = Some(catalog_semantics_digest(&extension).unwrap());
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    extension.ruleset_digest = package.ruleset.digest.clone();
    let plan = senritsu::validate_with_catalog_extension(package, &senritsu::next_engine_compatibility(), extension.clone()).unwrap();
    let catalog = DomainCatalog::from_verified_plan_with_extension(&plan, extension).unwrap();
    let resolver = BehaviorResolver::new(&catalog, &catalog.compatibility_key()).unwrap();
    Fixture { plan, catalog, resolver, hero_ids }
}

// Also called by a test-only native/WASM harness. Every fact here is fixture
// data; caller-certified legality does not claim an actual Enbu match.
pub fn authored_order_parity_fixture() -> serde_json::Value {
    assert_order_failures();
    assert_compatible_field_cases();
    assert_local_order_strictness(None, false);
    assert_local_order_strictness(Some(7), false);
    assert_local_order_strictness(Some(7), true);
    assert_disjoint_local_order();
    assert_unordered_local_capacity();
    let fixture = authored_order_fixture();
    let source = r#"senkei authored_rules {
        action z_move { when true, do move(argmin h in allies.heroes by h.level then h.id, "A.TOP.J"), },
        action a_skill { when true, do activate(argmin h in allies.heroes by h.level then h.id, "f01_a_active", argmin h in allies.heroes by h.level then h.id), },
    }"#;
    let compiled = compile(source, &fixture.plan).unwrap();
    let observation = ObservationSnapshot {
        tick: 11, side: CombatantSide::Attacker, fields: BTreeMap::new(),
        collections: BTreeMap::from([(CollectionId::new("allies.heroes"), Observed::Known(vec![EntityObservation {
            id: EntityId::new("hero-one"), entity_type: TypeId::new("hero"),
            fields: BTreeMap::from([(FieldId::new("level"), Observed::Known(DomainValue::Integer(3)))]),
        }]))]),
    };
    let allowed = [CapabilityId::new("move"), CapabilityId::new("activate")].into_iter().collect();
    let memory = TacticalMemory::new();
    let output = Vm::new(&fixture.plan).execute(TacticalExecutionRequest {
        side: observation.side, tick: observation.tick, program: &compiled.program,
        observation: &observation, memory: &memory, allowed_capabilities: &allowed,
        budget: ExecutionBudget { available_cu: LogicalCu(10_000), max_intents: 8 },
    }).unwrap();
    assert_eq!(output.intents.len(), 2);
    let hero = actor(&fixture.hero_ids[0], "hero-one");
    let legal = output.intents.iter().map(|intent| (intent.action_id.clone(), Legality::KnownLegal)).collect();
    let composition = fixture.resolver.compose(&hero, &ProfilePreferences::default(), 11, observation.side, &output, &legal).unwrap();
    assert_eq!(composition.values["navigation.destination"], DomainValue::String("A.TOP.J".into()));
    // Losing the navigation field does not erase this action's other field.
    assert_eq!(composition.values["targeting.mode"], DomainValue::String("f01_a_active".into()));
    assert!(composition.rejected_overrides.iter().any(|item| matches!(&item.reason, RejectionReason::FieldOrderRejected(field) if field == "navigation.destination")));
    let mut reversed = output.clone(); reversed.intents.reverse();
    assert_eq!(composition, fixture.resolver.compose(&hero, &ProfilePreferences::default(), 11, observation.side, &reversed, &legal).unwrap());
    let candidates = output.intents.iter().cloned().map(|intent| candidate(intent, CandidateSource::Explicit, 11, observation.side, None, Legality::KnownLegal)).collect::<Vec<_>>();
    let decision = fixture.resolver.resolve_candidates(&composition, &hero, 11, observation.side, &candidates, None).unwrap();
    assert_eq!(decision.selected.as_ref().unwrap().action_id.as_str(), "a_skill");
    let mut reversed_candidates = candidates.clone(); reversed_candidates.reverse();
    let reversed_decision = fixture.resolver.resolve_candidates(&composition, &hero, 11, observation.side, &reversed_candidates, None).unwrap();
    assert_eq!(decision.selected, reversed_decision.selected);
    serde_json::json!({ "catalog": String::from_utf8(fixture.catalog.canonical_json().unwrap()).unwrap(),
        "program_digest": compiled.program.content_digest, "cu": output.charged_cu,
        "intents": output.intents, "composition": composition, "decision": decision })
}

#[test]
fn authored_orders_select_actions_and_fields_independently_with_real_vm() {
    authored_order_parity_fixture();
}

#[test]
fn authored_orders_select_complete_candidate_groups_and_reject_missing_keys_or_duplicate_ids() { assert_order_failures(); }

fn assert_order_failures() {
    let fixture = authored_order_fixture();
    let hero = actor(&fixture.hero_ids[0], "hero-one");
    let composition = fixture.resolver.compose(&hero, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &empty_execution(), &BTreeMap::new()).unwrap();
    let first = candidate(move_intent("same", "hero-one", "A.TOP.J"), CandidateSource::Explicit, 1, CombatantSide::Attacker, None, Legality::KnownLegal);
    let second = candidate(Intent { capability: CapabilityId::new("retreat"), arguments: vec![DomainValue::Entity(EntityId::new("hero-one"))], action_id: ActionId::new("other"), ..first.intent.clone() }, CandidateSource::Explicit, 1, CombatantSide::Attacker, None, Legality::KnownLegal);
    assert_eq!(fixture.resolver.resolve_candidates(&composition, &hero, 1, CombatantSide::Attacker, &[first.clone(), second], None)
        .unwrap().selected.unwrap().action_id.as_str(), "other");
    assert_eq!(fixture.resolver.resolve_candidates(&composition, &hero, 1, CombatantSide::Attacker, &[first.clone(), first], None), Err(BehaviorError::UnresolvedCandidateConflict));
    let missing_priority = authored_order_fixture_edit(|extension| {
        let order = &mut extension.behavior_profiles.cross_capability_order.as_mut().unwrap()
            .field_writers.get_mut("navigation.destination").unwrap()[0];
        if let ArbitrationResolution::SelectOrdered { sort_by, .. } = &mut order.arbitration.resolution {
            sort_by.insert(0, IntentSortTerm { key: IntentKey::Priority, direction: SortDirection::Descending });
        }
    });
    let resolver = &missing_priority.resolver;
    let movement = move_intent("move", "hero-one", "A.TOP.J");
    let movement = Intent { priority: None, ..movement };
    let skill = Intent { action_id: ActionId::new("skill"), capability: CapabilityId::new("activate"), target: Some(EntityId::new("hero-one")),
        arguments: vec![DomainValue::Entity(EntityId::new("hero-one")), DomainValue::String("f01_a_active".into()), DomainValue::Entity(EntityId::new("hero-one"))], ..movement.clone() };
    let legal = [(movement.action_id.clone(), Legality::KnownLegal), (skill.action_id.clone(), Legality::KnownLegal)].into_iter().collect();
    assert_eq!(resolver.compose(&hero, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &execution(vec![movement, skill], vec![]), &legal), Err(BehaviorError::UnresolvedCandidateConflict));
}

#[test]
fn absent_field_orders_accept_disjoint_fields_and_equal_values_but_reject_actual_collision() { assert_compatible_field_cases(); }

fn assert_compatible_field_cases() {
    let disjoint = authored_order_fixture_edit(|extension| {
        extension.capabilities.get_mut(&CapabilityId::new("activate")).unwrap()
            .behavior_override_arguments.remove("navigation.destination");
        extension.behavior_profiles.cross_capability_order.as_mut().unwrap()
            .field_writers.remove("navigation.destination");
    });
    let hero = actor(&disjoint.hero_ids[0], "hero-one");
    let movement = move_intent("move", "hero-one", "A.TOP.J");
    let skill = Intent { action_id: ActionId::new("skill"), capability: CapabilityId::new("activate"), target: Some(EntityId::new("hero-one")),
        arguments: vec![DomainValue::Entity(EntityId::new("hero-one")), DomainValue::String("f01_a_active".into()), DomainValue::Entity(EntityId::new("hero-one"))], ..movement.clone() };
    let legal = [(movement.action_id.clone(), Legality::KnownLegal), (skill.action_id.clone(), Legality::KnownLegal)].into_iter().collect();
    let output = execution(vec![movement.clone(), skill.clone()], vec![]);
    let composition = disjoint.resolver.compose(&hero, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &output, &legal).unwrap();
    assert_eq!(composition.values["navigation.destination"], movement.arguments[1]);
    assert_eq!(composition.values["targeting.mode"], skill.arguments[1]);
    let ordered = authored_order_fixture();
    let mut equal_output = output;
    equal_output.intents[1].arguments[1] = movement.arguments[1].clone();
    let equal = ordered.resolver.compose(&hero, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &equal_output, &legal).unwrap();
    assert_eq!(equal.values["navigation.destination"], movement.arguments[1]);
    assert_eq!(equal.provenance["navigation.destination"].source, "jinrei:move + jinrei:skill");
    equal_output.intents.reverse();
    assert_eq!(equal, ordered.resolver.compose(&hero, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &equal_output, &legal).unwrap());
}


#[test]
fn authored_orders_reject_local_missing_priority_before_reduction() { assert_local_order_strictness(None, false); }

#[test]
fn authored_orders_reject_local_known_priority_ties_before_reduction() { assert_local_order_strictness(Some(7), false); }

#[test]
fn authored_orders_accept_complete_local_order_before_cross_capability_selection() { assert_local_order_strictness(Some(7), true); }

fn assert_local_order_strictness(priority: Option<i64>, complete: bool) {
    let fixture = authored_order_fixture_config(|package, extension| {
        let mut sort_by = vec![IntentSortTerm { key: IntentKey::Priority, direction: SortDirection::Descending }];
        if complete { sort_by.push(IntentSortTerm { key: IntentKey::ActionId, direction: SortDirection::Ascending }); }
        package.arbitration.get_mut(&CapabilityId::new("move")).unwrap().resolution =
            ArbitrationResolution::SelectOrdered { sort_by, max_accepted: 1 };
        if let ArbitrationResolution::SelectOrdered { sort_by, .. } = &mut extension.behavior_profiles.cross_capability_order
            .as_mut().unwrap().intent_selection[0].arbitration.resolution { sort_by[0].direction = SortDirection::Descending; }
    });
    let hero = actor(&fixture.hero_ids[0], "hero-one");
    let composition = fixture.resolver.compose(&hero, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &empty_execution(), &BTreeMap::new()).unwrap();
    let mut first = move_intent("a_move", "hero-one", "A.TOP.J"); first.priority = priority;
    let mut second = move_intent("z_move", "hero-one", "A.MID.J"); second.priority = priority;
    let skill = Intent { action_id: ActionId::new("m_skill"), capability: CapabilityId::new("activate"), target: Some(EntityId::new("hero-one")),
        arguments: vec![DomainValue::Entity(EntityId::new("hero-one")), DomainValue::String("f01_a_active".into()), DomainValue::Entity(EntityId::new("hero-one"))], ..first.clone() };
    let mut intents = vec![first, second, skill];
    let legal = intents.iter().map(|intent| (intent.action_id.clone(), Legality::KnownLegal)).collect();
    for _ in 0..2 {
        let composed = fixture.resolver.compose(&hero, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &execution(intents.clone(), vec![]), &legal);
        let candidates = intents.iter().cloned().map(|intent| candidate(intent, CandidateSource::Explicit, 1, CombatantSide::Attacker, None, Legality::KnownLegal)).collect::<Vec<_>>();
        let selected = fixture.resolver.resolve_candidates(&composition, &hero, 1, CombatantSide::Attacker, &candidates, None);
        if complete {
            assert_eq!(composed.unwrap().values["navigation.destination"], DomainValue::String("f01_a_active".into()));
            assert_eq!(selected.unwrap().selected.unwrap().action_id.as_str(), "m_skill");
        } else {
            assert_eq!(composed, Err(BehaviorError::UnresolvedCandidateConflict));
            assert_eq!(selected, Err(BehaviorError::UnresolvedCandidateConflict));
        }
        intents.reverse();
    }
}

#[test]
fn authored_orders_keep_disjoint_local_candidates_for_declared_global_selection() { assert_disjoint_local_order(); }

fn assert_disjoint_local_order() {
    let fixture = authored_order_fixture_config(|package, _| {
        let rule = package.arbitration.get_mut(&CapabilityId::new("move")).unwrap();
        rule.conflict_keys = vec![IntentKey::ActionId];
        rule.resolution = ArbitrationResolution::SelectOrdered { max_accepted: 8,
            sort_by: vec![IntentSortTerm { key: IntentKey::Priority, direction: SortDirection::Descending }] };
    });
    let hero = actor(&fixture.hero_ids[0], "hero-one");
    let intents = vec![move_intent("a_move", "hero-one", "A.TOP.J"), move_intent("z_move", "hero-one", "A.MID.J")];
    let legal = intents.iter().map(|intent| (intent.action_id.clone(), Legality::KnownLegal)).collect();
    let composition = fixture.resolver.compose(&hero, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &execution(intents, vec![]), &legal).unwrap();
    assert_eq!(composition.values["navigation.destination"], DomainValue::String("A.MID.J".into()));
}

#[test]
fn authored_orders_reject_unordered_local_truncation_and_accept_allow_all_that_fits() { assert_unordered_local_capacity(); }

fn assert_unordered_local_capacity() {
    for max_accepted in [1, 8] {
        let fixture = authored_order_fixture_config(|package, _| {
            package.arbitration.get_mut(&CapabilityId::new("move")).unwrap().resolution = ArbitrationResolution::AllowAll { max_accepted };
        });
        let hero = actor(&fixture.hero_ids[0], "hero-one");
        let intents = vec![move_intent("a_move", "hero-one", "A.TOP.J"), move_intent("z_move", "hero-one", "A.MID.J")];
        let legal = intents.iter().map(|intent| (intent.action_id.clone(), Legality::KnownLegal)).collect();
        let composition = fixture.resolver.compose(&hero, &ProfilePreferences::default(), 1, CombatantSide::Attacker, &execution(intents, vec![]), &legal);
        if max_accepted == 1 { assert_eq!(composition, Err(BehaviorError::UnresolvedCandidateConflict)); }
        else { assert_eq!(composition.unwrap().values["navigation.destination"], DomainValue::String("A.MID.J".into())); }
    }
}

#[test]
fn field_decisions_keep_independent_writes_and_use_field_order() {
    let fixture = authored_order_fixture();
    let hero = actor(&fixture.hero_ids[0], "hero-one");
    let side = CombatantSide::Attacker;
    let composition = fixture.resolver.compose(&hero, &ProfilePreferences::default(), 5, side, &empty_execution(), &BTreeMap::new()).unwrap();
    let movement = candidate(move_intent("z_move", "hero-one", "A.TOP.J"), CandidateSource::Explicit, 5, side, None, Legality::KnownLegal);
    let skill = candidate(Intent { action_id: ActionId::new("a_skill"), capability: CapabilityId::new("activate"), actor: Some(EntityId::new("hero-one")), target: Some(EntityId::new("hero-one")), arguments: vec![DomainValue::Entity(EntityId::new("hero-one")), DomainValue::String("f01_a_active".into()), DomainValue::Entity(EntityId::new("hero-one"))], priority: None }, CandidateSource::Explicit, 5, side, None, Legality::KnownLegal);
    let fields = BTreeMap::from([
        (BehaviorFieldId::parse("navigation.destination").unwrap(), vec![movement, skill.clone()]),
        (BehaviorFieldId::parse("targeting.mode").unwrap(), vec![skill]),
    ]);
    let decisions = fixture.resolver.resolve_fields(&composition, &hero, 5, side, &fields, &BTreeMap::new()).unwrap();
    assert_eq!(decisions[&BehaviorFieldId::parse("navigation.destination").unwrap()].selected.as_ref().unwrap().action_id.as_str(), "z_move");
    assert_eq!(decisions[&BehaviorFieldId::parse("targeting.mode").unwrap()].selected.as_ref().unwrap().action_id.as_str(), "a_skill");
}

#[test]
fn field_decisions_preserve_unknown_fallback_and_reject_unbound_capabilities() {
    let fixture = fixture();
    let hero = actor(&fixture.hero_ids[0], "hero-one");
    let side = CombatantSide::Attacker;
    let composition = fixture.resolver.compose(&hero, &ProfilePreferences::default(), 5, side, &empty_execution(), &BTreeMap::new()).unwrap();
    let unknown = candidate(move_intent("unknown", "hero-one", "A.TOP.J"), CandidateSource::Explicit, 5, side, None, Legality::Unknown { reason: "unobserved".into() });
    let fallback = candidate(move_intent("default", "hero-one", "A.MID.J"), CandidateSource::Default, 5, side, Some(composition.digest.clone()), Legality::KnownLegal);
    let field = BehaviorFieldId::parse("navigation.destination").unwrap();
    let fields = BTreeMap::from([(field.clone(), vec![unknown.clone(), fallback])]);
    let decisions = fixture.resolver.resolve_fields(&composition, &hero, 5, side, &fields, &BTreeMap::new()).unwrap();
    assert_eq!(decisions[&field].selected.as_ref().unwrap().action_id.as_str(), "default");
    assert!(decisions[&field].trace.iter().any(|entry| matches!(entry, DecisionTrace::CandidateUnknown { .. })));
    let invalid = BTreeMap::from([(BehaviorFieldId::parse("targeting.mode").unwrap(), vec![unknown])]);
    assert_eq!(fixture.resolver.resolve_fields(&composition, &hero, 5, side, &invalid, &BTreeMap::new()), Err(BehaviorError::InvalidCandidateSet));
}

#[test]
fn empty_field_decisions_still_reject_stale_composition() {
    let fixture = fixture();
    let hero = actor(&fixture.hero_ids[0], "hero-one");
    let side = CombatantSide::Attacker;
    let composition = fixture.resolver.compose(&hero, &ProfilePreferences::default(), 5, side, &empty_execution(), &BTreeMap::new()).unwrap();
    assert_eq!(fixture.resolver.resolve_fields(&composition, &hero, 6, side, &BTreeMap::new(), &BTreeMap::new()), Err(BehaviorError::StaleComposition));
}

#[test]
fn field_decisions_reject_same_action_id_with_different_payloads() {
    let fixture = authored_order_fixture();
    let hero = actor(&fixture.hero_ids[0], "hero-one");
    let side = CombatantSide::Attacker;
    let composition = fixture.resolver.compose(&hero, &ProfilePreferences::default(), 5, side, &empty_execution(), &BTreeMap::new()).unwrap();
    let first = candidate(Intent { action_id: ActionId::new("same"), capability: CapabilityId::new("activate"), actor: Some(EntityId::new("hero-one")), target: Some(EntityId::new("hero-one")), arguments: vec![DomainValue::Entity(EntityId::new("hero-one")), DomainValue::String("f01_a_active".into()), DomainValue::Entity(EntityId::new("hero-one"))], priority: None }, CandidateSource::Explicit, 5, side, None, Legality::KnownLegal);
    let mut second = first.clone();
    second.intent.arguments[1] = DomainValue::String("different".into());
    let fields = BTreeMap::from([
        (BehaviorFieldId::parse("navigation.destination").unwrap(), vec![first]),
        (BehaviorFieldId::parse("targeting.mode").unwrap(), vec![second]),
    ]);
    assert_eq!(fixture.resolver.resolve_fields(&composition, &hero, 5, side, &fields, &BTreeMap::new()), Err(BehaviorError::InvalidCandidateSet));
}
