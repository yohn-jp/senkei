use enbu::{simulate, ENGINE_VERSION};
use senkei_model::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

fn v() -> Version { Version::new(1, 0, 0) }
fn id<T: From<&'static str>>(value: &'static str) -> T { T::from(value) }
fn digest(value: &str) -> ContentDigest { ContentDigest::new(value.to_owned()) }
fn ruleset() -> RulesetRef {
    RulesetRef { id: id("test-rules"), version: v(), digest: digest(&"a".repeat(64)) }
}

fn program(ruleset: &RulesetRef) -> TacticalProgram {
    let bytecode = vec![0xde, 0xad, 0xbe, 0xef];
    let bytecode_digest = format!("{:x}", Sha256::digest(&bytecode));
    TacticalProgram {
        language_version: v(),
        ir_version: v(),
        bytecode_version: v(),
        cost_schedule_id: id("test-cost"),
        cost_schedule_version: v(),
        ruleset: ruleset.clone(),
        content_digest: digest(&bytecode_digest),
        bytecode,
    }
}

fn snapshot(ruleset: &RulesetRef, name: &'static str) -> SenkeiSnapshot {
    SenkeiSnapshot {
        schema_version: v(),
        id: id(name),
        revision: id("revision-1"),
        ruleset: ruleset.clone(),
        configuration: BTreeMap::new(),
        program: program(ruleset),
        initial_memory: BTreeMap::new(),
    }
}

fn entity(owner: CombatantSide) -> EntityState {
    EntityState {
        entity_type: id("core"),
        owner: Some(owner),
        fields: BTreeMap::from([(id("hp"), DomainValue::Integer(1))]),
    }
}

fn setup(max_ticks: u32) -> (SenkeiSnapshot, SenkeiSnapshot, VerifiedRulePlan, MatchContext) {
    let ruleset_ref = ruleset();
    let capability: CapabilityId = id("strike");
    let phase: PhaseId = id("transition");
    let core_type: TypeId = id("core");
    let hp: FieldId = id("hp");
    let core = EntityTypeSchema {
        fields: BTreeMap::from([(
            hp.clone(),
            FieldSchema {
                value_type: DomainType::Integer { min: Some(0), max: Some(1) },
                visibility: Visibility::Public,
                writable: true,
            },
        )]),
        default_owner: None,
    };
    let domain = DomainSchema {
        schema_version: v(),
        senkei_configuration: BTreeMap::new(),
        observation_fields: BTreeMap::new(),
        collections: BTreeMap::new(),
        capabilities: BTreeMap::from([(
            capability.clone(),
            CapabilitySchema {
                arguments: Vec::new(),
                target_type: Some(core_type.clone()),
                actor_argument: None,
                target_argument: None,
                target_owner: TargetOwnerConstraint::Any,
                phases: BTreeSet::from([phase.clone()]),
                preconditions: Vec::new(),
                issue_cost: id("issue"),
            },
        )]),
        tactical_memory: BTreeMap::new(),
        symbol_domains: BTreeMap::new(),
        max_expression_depth: 8,
        max_collection_items: 8,
    };
    let transition = TransitionRule {
        id: id("hit"),
        phase: phase.clone(),
        order: 1,
        capability: Some(capability.clone()),
        when: None,
        operations: vec![TransitionPrimitive::AddInteger {
            target: EntitySelector::IntentTarget,
            field: hp.clone(),
            amount: RuleExpression::Literal(DomainValue::Integer(-1)),
        }],
    };
    let zero = |entity| RuleExpression::Equal {
        left: Box::new(RuleExpression::Field { target: EntitySelector::Fixed(id(entity)), field: hp.clone() }),
        right: Box::new(RuleExpression::Literal(DomainValue::Integer(0))),
    };
    let plan = RulePlan {
        minimum_engine_version: ENGINE_VERSION,
        model_version: v(),
        primitive_set_id: id("generic-v1"),
        primitive_set_version: v(),
        jinrei_language_version: v(),
        structured_ast_version: v(),
        typed_ir_version: v(),
        bytecode_version: v(),
        domain,
        world_initialization: WorldInitialization {
            entities: Vec::new(),
            global_fields: BTreeMap::new(),
            collections: BTreeMap::new(),
        },
        world: WorldSchema {
            entity_types: BTreeMap::from([(core_type.clone(), core)]),
            global_fields: BTreeMap::new(),
            collections: BTreeMap::new(),
            max_entities: 4,
        },
        phases: vec![ExecutionPhase { id: phase, order: 1, kind: PhaseKind::Transition }],
        required_primitives: BTreeSet::from([TransitionPrimitiveKind::AddInteger]),
        transitions: vec![transition],
        arbitration: BTreeMap::from([(
            capability,
            ArbitrationRule { conflict_keys: Vec::new(), resolution: ArbitrationResolution::AllowAll { max_accepted: 8 } },
        )]),
        termination: TerminationPolicy {
            max_ticks,
            conditions: vec![
                TerminationCondition {
                    order: 1,
                    when: RuleExpression::And(vec![zero("attacker-core"), zero("defender-core")]),
                    outcome: MatchOutcome::Draw,
                    reason: id("both-destroyed"),
                },
                TerminationCondition {
                    order: 2,
                    when: zero("attacker-core"),
                    outcome: MatchOutcome::DefenderVictory,
                    reason: id("attacker-destroyed"),
                },
                TerminationCondition {
                    order: 3,
                    when: zero("defender-core"),
                    outcome: MatchOutcome::AttackerVictory,
                    reason: id("defender-destroyed"),
                },
            ],
            on_timeout: MatchOutcome::Draw,
            on_timeout_reason: id("timeout"),
        },
        cost_schedule: CostSchedule {
            id: id("test-cost"),
            version: v(),
            operations: BTreeMap::new(),
            per_tick_budget: LogicalCu(100),
            per_match_budget: LogicalCu(100),
            overrun_policy: BudgetOverrunPolicy::RejectTickAndKeepMemory,
            memory_commit_policy: MemoryCommitPolicy::OnCompletedEvaluation,
            budget_overrun_reason: id("budget-overrun"),
        },
        presentation: PresentationPolicy {
            visible_events: BTreeMap::new(),
            visible_entity_fields: BTreeMap::from([(core_type, BTreeSet::from([hp]))]),
            visible_global_fields: BTreeSet::new(),
        },
        limits: RuleLimits {
            max_input_bytes: 1_000_000,
            max_entities: 4,
            max_events: 32,
            max_diagnostic_events: 128,
            max_output_bytes: 1_000_000,
            max_intents_per_side_per_tick: 8,
            max_value_depth: 8,
        },
    };
    let verified = VerifiedRulePlan::from_validation(
        ruleset_ref.clone(),
        ruleset_ref.digest.clone(),
        plan,
    );
    let context = MatchContext {
        schema_version: v(),
        match_id: id("simultaneous-test"),
        ruleset: ruleset_ref.clone(),
        versions: ComponentVersions {
            model: v(), engine: ENGINE_VERSION, ruleset: v(),
            jinrei_language: v(), structured_ast: v(), typed_ir: v(), bytecode: v(), cost_schedule: v(), replay_schema: v(),
        },
        initial_world: WorldState {
            entities: BTreeMap::from([
                (id("attacker-core"), entity(CombatantSide::Attacker)),
                (id("defender-core"), entity(CombatantSide::Defender)),
            ]),
            global_fields: BTreeMap::new(), collections: BTreeMap::new(),
        },
        max_ticks,
        host_limits: HostLimits { max_input_bytes: 1_000_000, max_entities: 4, max_events: 32, max_diagnostic_events: 128, max_output_bytes: 1_000_000 },
    };
    (snapshot(&ruleset_ref, "attacker"), snapshot(&ruleset_ref, "defender"), verified, context)
}

fn reverify(ruleset: &RulesetRef, plan: RulePlan) -> VerifiedRulePlan {
    VerifiedRulePlan::from_validation(ruleset.clone(), ruleset.digest.clone(), plan)
}

fn damage_fixture(
    max_ticks: u32,
    initial_hp: i64,
    max_hp: i64,
    damage: i64,
) -> (SenkeiSnapshot, SenkeiSnapshot, VerifiedRulePlan, MatchContext) {
    let (attacker, defender, base_rules, mut context) = setup(max_ticks);
    let mut plan = base_rules.plan().clone();
    let core_type: TypeId = id("core");
    let hp: FieldId = id("hp");
    plan.world.entity_types.get_mut(&core_type).unwrap().fields.insert(
        hp.clone(),
        FieldSchema {
            value_type: DomainType::Integer { min: Some(0), max: Some(max_hp) },
            visibility: Visibility::Public,
            writable: true,
        },
    );
    for entity in context.initial_world.entities.values_mut() {
        entity.fields.insert(hp.clone(), DomainValue::Integer(initial_hp));
    }
    plan.transitions[0].operations = vec![
        TransitionPrimitive::AddInteger {
            target: EntitySelector::IntentTarget,
            field: hp.clone(),
            amount: RuleExpression::Literal(DomainValue::Integer(-damage)),
        },
        TransitionPrimitive::EmitEvent {
            event: id("core_attacked"),
            payload: BTreeMap::from([(
                id("damage"),
                RuleExpression::Literal(DomainValue::Integer(damage)),
            )]),
        },
    ];
    plan.required_primitives.insert(TransitionPrimitiveKind::EmitEvent);
    plan.presentation.visible_events.insert(
        id("core_attacked"),
        EventSchema {
            payload: BTreeMap::from([(
                id("damage"),
                DomainType::Integer { min: Some(0), max: Some(20) },
            )]),
        },
    );
    (attacker, defender, reverify(&ruleset(), plan), context)
}

#[derive(Default)]
struct AutoStrike { observations: Vec<ObservationSnapshot> }

impl TacticalExecutionPort for AutoStrike {
    fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
        self.observations.push(request.observation.clone());
        let target = match request.side {
            CombatantSide::Attacker => "defender-core",
            CombatantSide::Defender => "attacker-core",
        };
        Ok(TacticalExecutionOutput {
            status: TacticalExecutionStatus::Completed,
            intents: vec![Intent {
                action_id: id(match request.side { CombatantSide::Attacker => "attack-a", CombatantSide::Defender => "attack-d" }),
                capability: id("strike"), actor: None, target: Some(id(target)), arguments: Vec::new(), priority: None,
            }],
            next_memory: request.memory.clone(),
            charged_cu: LogicalCu::ZERO,
            required_cu: LogicalCu::ZERO,
            diagnostics: Vec::new(),
        })
    }
}

#[test]
fn reciprocal_attacks_resolve_from_the_same_pre_tick_and_are_reproducible() {
    let (attacker, defender, plan, context) = damage_fixture(4, 15, 15, 20);
    let mut first_port = AutoStrike::default();
    let first = simulate(&attacker, &defender, &plan, &context, &mut first_port).unwrap();
    let mut second_port = AutoStrike::default();
    let second = simulate(&attacker, &defender, &plan, &context, &mut second_port).unwrap();

    assert_eq!(first.result.outcome, MatchOutcome::Draw);
    assert_eq!(first.result.final_tick, 1);
    assert_eq!(first.result, second.result);
    assert_eq!(first.replay, second.replay);
    assert_eq!(first.diagnostics, second.diagnostics);
    let frame = &first.replay.frames[1];
    let visible = frame.visible_state.as_ref().unwrap();
    assert_eq!(visible.entities[&id("attacker-core")].fields[&id("hp")], DomainValue::Integer(0));
    assert_eq!(visible.entities[&id("defender-core")].fields[&id("hp")], DomainValue::Integer(0));
    let damage_events = frame.events.iter().filter(|event| event.event == id("core_attacked")).collect::<Vec<_>>();
    assert_eq!(damage_events.len(), 2);
    assert!(damage_events.iter().all(|event| event.payload[&id("damage")] == DomainValue::Integer(20)));
    let public_json = serde_json::to_string(&first.public_response()).unwrap();
    assert!(!public_json.contains("bytecode"));
    assert!(!public_json.contains("deadbeef"));
    assert_eq!(first_port.observations.len(), 2);
    assert_eq!(first_port.observations[0].tick, first_port.observations[1].tick);
}

#[test]
fn one_attack_changes_hp_by_exactly_its_public_damage_event() {
    let (attacker, defender, plan, context) = damage_fixture(2, 100, 100, 20);
    struct OneAttack;
    impl TacticalExecutionPort for OneAttack {
        fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
            let intents = if request.side == CombatantSide::Attacker && request.tick == 1 {
                vec![Intent {
                    action_id: id("single-attack"),
                    capability: id("strike"),
                    actor: None,
                    target: Some(id("defender-core")),
                    arguments: Vec::new(),
                    priority: None,
                }]
            } else {
                Vec::new()
            };
            Ok(TacticalExecutionOutput {
                status: TacticalExecutionStatus::Completed,
                intents,
                next_memory: request.memory.clone(),
                charged_cu: LogicalCu::ZERO,
                required_cu: LogicalCu::ZERO,
                diagnostics: Vec::new(),
            })
        }
    }

    let mut port = OneAttack;
    let artifact = simulate(&attacker, &defender, &plan, &context, &mut port).unwrap();
    let frame = &artifact.replay.frames[1];
    let event = frame.events.iter().find(|event| event.event == id("core_attacked")).unwrap();
    let damage = match event.payload[&id("damage")] {
        DomainValue::Integer(value) => value,
        _ => panic!("damage event must carry an integer"),
    };
    let visible = frame.visible_state.as_ref().unwrap();
    let before = 100_i64;
    let after = match visible.entities[&id("defender-core")].fields[&id("hp")] {
        DomainValue::Integer(value) => value,
        _ => panic!("HP must be an integer"),
    };
    assert_eq!(before - after, damage);
    assert_eq!(damage, 20);
    assert_eq!(after, 80);
}

#[test]
fn concurrent_attacks_against_one_target_sum_once_per_intent() {
    let (attacker, defender, plan, context) = damage_fixture(2, 100, 100, 20);
    struct TwoAttacks;
    impl TacticalExecutionPort for TwoAttacks {
        fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
            let intents = if request.side == CombatantSide::Attacker && request.tick == 1 {
                ["attack-1", "attack-2"].into_iter().map(|action_id| Intent {
                    action_id: id(action_id),
                    capability: id("strike"),
                    actor: None,
                    target: Some(id("defender-core")),
                    arguments: Vec::new(),
                    priority: None,
                }).collect()
            } else {
                Vec::new()
            };
            Ok(TacticalExecutionOutput {
                status: TacticalExecutionStatus::Completed,
                intents,
                next_memory: request.memory.clone(),
                charged_cu: LogicalCu::ZERO,
                required_cu: LogicalCu::ZERO,
                diagnostics: Vec::new(),
            })
        }
    }

    let mut port = TwoAttacks;
    let artifact = simulate(&attacker, &defender, &plan, &context, &mut port).unwrap();
    let frame = &artifact.replay.frames[1];
    let events = frame.events.iter().filter(|event| event.event == id("core_attacked")).collect::<Vec<_>>();
    assert_eq!(events.len(), 2);
    let total_reported_damage = events.iter().map(|event| match event.payload[&id("damage")] {
        DomainValue::Integer(value) => value,
        _ => panic!("damage event must carry an integer"),
    }).sum::<i64>();
    let visible = frame.visible_state.as_ref().unwrap();
    let after = match visible.entities[&id("defender-core")].fields[&id("hp")] {
        DomainValue::Integer(value) => value,
        _ => panic!("HP must be an integer"),
    };
    assert_eq!(100 - after, total_reported_damage);
    assert_eq!(after, 60);
}

#[test]
fn current_tick_is_shared_by_observations_preconditions_transitions_and_termination() {
    let (attacker, defender, base_rules, context) = damage_fixture(3, 100, 100, 20);
    let mut plan = base_rules.plan().clone();
    let tick_expr = RuleExpression::CurrentTick;
    let at_two = || RuleExpression::Equal {
        left: Box::new(tick_expr.clone()),
        right: Box::new(RuleExpression::Literal(DomainValue::Integer(2))),
    };
    plan.domain.capabilities.get_mut(&id("strike")).unwrap().preconditions = vec![at_two()];
    plan.transitions[0].when = Some(at_two());
    plan.termination.conditions = vec![TerminationCondition {
        order: 1,
        when: RuleExpression::Not(Box::new(RuleExpression::LessThan {
            left: Box::new(tick_expr.clone()),
            right: Box::new(RuleExpression::Literal(DomainValue::Integer(2))),
        })),
        outcome: MatchOutcome::Draw,
        reason: id("at-tick-two"),
    }];
    let observation_tick: ObservationPath = ObservationPath::new("current_tick");
    plan.domain.observation_fields.insert(
        observation_tick.clone(),
        ObservationFieldSchema {
            value_type: DomainType::Integer { min: Some(0), max: Some(3) },
            visibility: Visibility::Public,
            source: ObservationSource::Derived(tick_expr),
        },
    );
    let plan = reverify(&ruleset(), plan);

    struct TickStrike(Vec<ObservationSnapshot>);
    impl TacticalExecutionPort for TickStrike {
        fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
            self.0.push(request.observation.clone());
            let intents = if request.side == CombatantSide::Attacker {
                vec![Intent {
                    action_id: ActionId::new(format!("strike-{}", request.tick)),
                    capability: id("strike"),
                    actor: None,
                    target: Some(id("defender-core")),
                    arguments: Vec::new(),
                    priority: None,
                }]
            } else {
                Vec::new()
            };
            Ok(TacticalExecutionOutput {
                status: TacticalExecutionStatus::Completed,
                intents,
                next_memory: request.memory.clone(),
                charged_cu: LogicalCu::ZERO,
                required_cu: LogicalCu::ZERO,
                diagnostics: Vec::new(),
            })
        }
    }

    let mut port = TickStrike(Vec::new());
    let artifact = simulate(&attacker, &defender, &plan, &context, &mut port).unwrap();
    assert_eq!(artifact.result.final_tick, 2);
    assert_eq!(artifact.result.termination_reason, id("at-tick-two"));
    assert_eq!(port.0.len(), 4);
    for observation in &port.0[..2] {
        assert_eq!(observation.fields[&observation_tick], Observed::Known(DomainValue::Integer(1)));
    }
    for observation in &port.0[2..] {
        assert_eq!(observation.fields[&observation_tick], Observed::Known(DomainValue::Integer(2)));
    }
    assert!(artifact.replay.frames[1].events.is_empty());
    assert_eq!(artifact.replay.frames[2].events.len(), 1);
    assert!(artifact.diagnostics.events.iter().any(|event| event.tick == 1
        && matches!(&event.record, DiagnosticRecord::IntentRejected { reason, .. } if reason == &id("enbu.precondition_failed"))));
    assert!(artifact.diagnostics.events.iter().any(|event| event.tick == 2
        && matches!(&event.record, DiagnosticRecord::IntentAccepted { .. })));
}

#[test]
fn initial_termination_evaluates_current_tick_as_zero() {
    let (attacker, defender, base_rules, context) = setup(3);
    let mut plan = base_rules.plan().clone();
    plan.termination.conditions = vec![TerminationCondition {
        order: 1,
        when: RuleExpression::Equal {
            left: Box::new(RuleExpression::CurrentTick),
            right: Box::new(RuleExpression::Literal(DomainValue::Integer(0))),
        },
        outcome: MatchOutcome::Draw,
        reason: id("tick-zero"),
    }];
    let plan = reverify(&ruleset(), plan);
    struct NeverCalled;
    impl TacticalExecutionPort for NeverCalled {
        fn execute(&mut self, _: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
            panic!("tick-zero termination must finish before calling the execution port")
        }
    }

    let mut port = NeverCalled;
    let artifact = simulate(&attacker, &defender, &plan, &context, &mut port).unwrap();
    assert_eq!(artifact.result.final_tick, 0);
    assert_eq!(artifact.result.termination_reason, id("tick-zero"));
    assert_eq!(artifact.replay.frames.len(), 1);
}

#[test]
fn a_silent_port_reaches_the_ruleset_timeout() {
    struct Wait;
    impl TacticalExecutionPort for Wait {
        fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
            Ok(TacticalExecutionOutput { status: TacticalExecutionStatus::Completed, intents: Vec::new(), next_memory: request.memory.clone(), charged_cu: LogicalCu::ZERO, required_cu: LogicalCu::ZERO, diagnostics: Vec::new() })
        }
    }
    let (attacker, defender, plan, context) = setup(2);
    let mut port = Wait;
    let result = simulate(&attacker, &defender, &plan, &context, &mut port).unwrap();
    assert_eq!(result.result.outcome, MatchOutcome::Draw);
    assert_eq!(result.result.final_tick, 2);
    assert_eq!(result.replay.frames.len(), 3);
}

#[test]
fn canonical_context_advertises_the_shared_engine_version() {
    let (_, _, plan, _) = setup(3);
    let context = enbu::new_match_context(&plan, id("version-check"));
    assert_eq!(ENGINE_VERSION, senkei_model::ENBU_ENGINE_VERSION);
    assert_eq!(context.versions.engine, senkei_model::ENBU_ENGINE_VERSION);
    assert_eq!(context.max_ticks, plan.plan().termination.max_ticks);
    assert_eq!(context.host_limits, HostLimits::from(&plan.plan().limits));
}

#[test]
fn configuration_projection_builds_the_observed_world_from_both_snapshots() {
    use enbu::new_match_context;

    let (mut attacker, mut defender, base_rules, _) = setup(1);
    let mut plan = base_rules.plan().clone();
    let slot_id: FieldId = id("slot_id");
    let hp: FieldId = id("hp");
    let army: FieldId = id("army");
    let core_type: TypeId = id("core");
    let item_fields = BTreeMap::from([
        (slot_id.clone(), DomainType::String { max_bytes: 16 }),
        (hp.clone(), DomainType::Integer { min: Some(0), max: Some(10) }),
    ]);
    plan.domain.senkei_configuration.insert(
        army.clone(),
        ConfigurationFieldSchema {
            value_type: DomainType::List {
                element: Box::new(DomainType::Record { fields: item_fields }),
                max_items: 4,
            },
            required: true,
            default: None,
        },
    );
    let cores: CollectionId = id("cores");
    plan.domain.collections.insert(
        cores.clone(),
        CollectionSchema {
            element_type: core_type.clone(),
            max_items: 4,
            visibility: Visibility::Public,
            source: CollectionSource::WorldEntities {
                entity_types: BTreeSet::from([core_type.clone()]),
                owner: EntityOwnerSelector::Any,
                filter: None,
            },
            visible_fields: BTreeMap::from([(
                hp.clone(),
                ObservationFieldSchema {
                    value_type: DomainType::Integer { min: Some(0), max: Some(10) },
                    visibility: Visibility::Public,
                    source: ObservationSource::CurrentEntityField { field: hp.clone() },
                },
            )]),
            order_by: vec![hp.clone()],
            unique_keys: BTreeSet::from([CollectionUniqueKey::EntityId]),
        },
    );
    plan.world.entity_types.get_mut(&core_type).unwrap().fields.insert(
        hp.clone(),
        FieldSchema {
            value_type: DomainType::Integer { min: Some(0), max: Some(10) },
            visibility: Visibility::Public,
            writable: true,
        },
    );
    plan.termination.conditions.clear();
    plan.world_initialization.entities.push(EntityProjection {
        projection_id: id("army-core"),
        applies_to: ProjectionSides::Both,
        source: EntityProjectionSource::EachConfigurationItem { field: army.clone() },
        entity_type: core_type,
        entity_id: EntityIdProjection::ConfigurationItemKey { path: vec![slot_id.clone()] },
        owner: EntityOwnerProjection::SnapshotSide,
        fields: BTreeMap::from([(
            hp.clone(),
            ProjectionValue::ConfigurationItemPath { path: vec![hp.clone()] },
        )]),
    });
    attacker.configuration.insert(
        army.clone(),
        DomainValue::List(vec![DomainValue::Record(BTreeMap::from([
            (slot_id.clone(), DomainValue::String("a-core".into())),
            (hp.clone(), DomainValue::Integer(2)),
        ]))]),
    );
    defender.configuration.insert(
        army.clone(),
        DomainValue::List(vec![DomainValue::Record(BTreeMap::from([
            (slot_id, DomainValue::String("d-core".into())),
            (hp.clone(), DomainValue::Integer(7)),
        ]))]),
    );
    let verified = reverify(&ruleset(), plan);
    let context = new_match_context(&verified, id("projected-world"));
    assert!(context.initial_world.entities.is_empty());

    #[derive(Default)]
    struct Observe(Vec<ObservationSnapshot>);
    impl TacticalExecutionPort for Observe {
        fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
            self.0.push(request.observation.clone());
            Ok(TacticalExecutionOutput {
                status: TacticalExecutionStatus::Completed,
                intents: Vec::new(),
                next_memory: request.memory.clone(),
                charged_cu: LogicalCu::ZERO,
                required_cu: LogicalCu::ZERO,
                diagnostics: Vec::new(),
            })
        }
    }

    let mut observe = Observe::default();
    let result = simulate(&attacker, &defender, &verified, &context, &mut observe).unwrap();
    assert_eq!(result.result.final_tick, 1);
    assert_eq!(observe.0.len(), 2);
    for observation in observe.0 {
        let Observed::Known(cores) = &observation.collections[&cores] else { panic!("projected core collection must be visible"); };
        assert_eq!(cores.len(), 2);
        assert_eq!(cores[0].fields[&hp], Observed::Known(DomainValue::Integer(2)));
        assert_eq!(cores[1].fields[&hp], Observed::Known(DomainValue::Integer(7)));
    }
    let visible = result.replay.frames[1].visible_state.as_ref().unwrap();
    assert_eq!(visible.entities.len(), 2);
    assert!(visible.entities.values().any(|entity| entity.owner == Some(CombatantSide::Attacker)
        && entity.fields[&hp] == DomainValue::Integer(2)));
    assert!(visible.entities.values().any(|entity| entity.owner == Some(CombatantSide::Defender)
        && entity.fields[&hp] == DomainValue::Integer(7)));
}

#[test]
fn budget_overrun_rejects_tick_or_aborts_according_to_the_plan() {
    let (attacker, defender, base_rules, context) = setup(2);
    let mut plan = base_rules.plan().clone();
    let operation: CostOperationId = id("metered-op");
    plan.cost_schedule.operations.insert(operation.clone(), LogicalCuCost { base: 100, per_item: 0 });

    struct Overrun(CostOperationId);
    impl TacticalExecutionPort for Overrun {
        fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
            let available = request.budget.available_cu;
            let required = LogicalCu(available.0 + 1);
            let diagnostics = if available.0 == 0 {
                Vec::new()
            } else {
                vec![TacticalDiagnostic::CostCharged { operation: self.0.clone(), amount: available }]
            };
            Ok(TacticalExecutionOutput {
                status: TacticalExecutionStatus::BudgetExceeded,
                intents: Vec::new(),
                next_memory: request.memory.clone(),
                charged_cu: available,
                required_cu: required,
                diagnostics,
            })
        }
    }

    let mut reject_plan = plan.clone();
    reject_plan.cost_schedule.overrun_policy = BudgetOverrunPolicy::RejectTickAndKeepMemory;
    let reject_rules = reverify(&ruleset(), reject_plan);
    let mut reject_port = Overrun(operation.clone());
    let rejected = simulate(&attacker, &defender, &reject_rules, &context, &mut reject_port).unwrap();
    assert_eq!(rejected.result.final_tick, 2);
    assert_eq!(rejected.result.outcome, MatchOutcome::Draw);
    assert_eq!(rejected.result.cu_spent[&CombatantSide::Attacker], LogicalCu(100));
    assert_eq!(rejected.result.cu_spent[&CombatantSide::Defender], LogicalCu(100));

    let mut abort_plan = plan;
    abort_plan.cost_schedule.overrun_policy = BudgetOverrunPolicy::AbortMatch;
    abort_plan.cost_schedule.budget_overrun_reason = id("budget-stop");
    let abort_rules = reverify(&ruleset(), abort_plan);
    let mut abort_port = Overrun(operation);
    let aborted = simulate(&attacker, &defender, &abort_rules, &context, &mut abort_port).unwrap();
    assert_eq!(aborted.result.final_tick, 1);
    assert_eq!(aborted.result.outcome, MatchOutcome::Aborted);
    assert_eq!(aborted.result.termination_reason, id("budget-stop"));
    assert_eq!(aborted.result.cu_spent[&CombatantSide::Attacker], LogicalCu(100));
    assert_eq!(aborted.result.cu_spent[&CombatantSide::Defender], LogicalCu(100));
    assert_eq!(aborted.replay.frames.len(), 2);
}
