use jinrei::{compile, compile_ast, compile_with_options, parse, Vm, VmOptions};
use senkei_model::*;
use std::collections::{BTreeMap, BTreeSet};

fn version() -> Version { Version::new(1, 0, 0) }

fn rules(with_units: bool, actor_argument: bool) -> VerifiedRulePlan {
    let int = DomainType::Integer { min: Some(0), max: Some(100) };
    let unit_type = TypeId::new("unit");
    let mut observations = BTreeMap::new();
    observations.insert(ObservationPath::new("flag"), ObservationFieldSchema {
        value_type: DomainType::Bool, visibility: Visibility::Public, source: ObservationSource::Tick,
    });
    observations.insert(ObservationPath::new("score"), ObservationFieldSchema {
        value_type: int.clone(), visibility: Visibility::Public, source: ObservationSource::Tick,
    });
    let mut collections = BTreeMap::new();
    if with_units {
        for (name, owner) in [("allies.units", EntityOwnerSelector::OwnSide), ("enemies.units", EntityOwnerSelector::OtherSide)] {
            collections.insert(CollectionId::new(name), CollectionSchema {
                element_type: unit_type.clone(), max_items: 32, visibility: Visibility::Public,
                source: CollectionSource::WorldEntities {
                    entity_types: [unit_type.clone()].into_iter().collect(), owner, filter: None,
                },
                visible_fields: [(FieldId::new("health"), ObservationFieldSchema {
                    value_type: int.clone(), visibility: Visibility::Public,
                    source: ObservationSource::CurrentEntityField { field: FieldId::new("health") },
                })].into_iter().collect(),
                order_by: vec![FieldId::new("health")],
                unique_keys: [CollectionUniqueKey::EntityId].into_iter().collect(),
            });
        }
    }
    let arguments = if actor_argument {
        vec![ParameterSchema { id: ParameterId::new("actor"),
            value_type: DomainType::Entity { entity_type: Some(unit_type.clone()) }, optional: false }]
    } else { Vec::new() };
    let capabilities = [
        (CapabilityId::new("act"), CapabilitySchema {
            arguments, target_type: None,
            actor_argument: actor_argument.then_some(0), target_argument: None,
            target_owner: TargetOwnerConstraint::Any, phases: BTreeSet::new(),
            preconditions: Vec::new(), issue_cost: CostOperationId::new("jinrei.capability_issue"),
        }),
        (CapabilityId::new("inspect"), CapabilitySchema {
            arguments: vec![ParameterSchema { id: ParameterId::new("units"),
                value_type: DomainType::Vector { element: Box::new(DomainType::Entity { entity_type: Some(unit_type.clone()) }), max_items: 32 },
                optional: false }],
            target_type: None, actor_argument: None, target_argument: None,
            target_owner: TargetOwnerConstraint::Any, phases: BTreeSet::new(),
            preconditions: Vec::new(), issue_cost: CostOperationId::new("jinrei.capability_issue"),
        }),
        (CapabilityId::new("attack"), CapabilitySchema {
            arguments: vec![
                ParameterSchema { id: ParameterId::new("actor"), value_type: DomainType::Entity { entity_type: Some(unit_type.clone()) }, optional: false },
                ParameterSchema { id: ParameterId::new("target"), value_type: DomainType::Entity { entity_type: Some(unit_type.clone()) }, optional: false },
            ],
            target_type: Some(unit_type), actor_argument: Some(0), target_argument: Some(1),
            target_owner: TargetOwnerConstraint::OtherSide, phases: BTreeSet::new(),
            preconditions: Vec::new(), issue_cost: CostOperationId::new("jinrei.capability_issue"),
        }),
    ].into_iter().collect();
    let domain = DomainSchema {
        schema_version: version(), senkei_configuration: BTreeMap::new(),
        observation_fields: observations, collections, capabilities,
        tactical_memory: [(StateId::new("remember"), int.clone())].into_iter().collect(), symbol_domains: BTreeMap::new(),
        max_expression_depth: 24, max_collection_items: 32,
    };
    let mut operations = BTreeMap::new();
    for key in REQUIRED_JINREI_COST_OPERATIONS {
        operations.insert(CostOperationId::new(key), LogicalCuCost { base: 2, per_item: 1 });
    }
    let cost_schedule = CostSchedule {
        id: CostScheduleId::new("test-costs"), version: version(), operations,
        per_tick_budget: LogicalCu(100_000), per_match_budget: LogicalCu(100_000),
        overrun_policy: BudgetOverrunPolicy::RejectTickAndKeepMemory,
        memory_commit_policy: MemoryCommitPolicy::OnCompletedEvaluation,
        budget_overrun_reason: SymbolId::new("cu_overrun"),
    };
    let plan = RulePlan {
        minimum_engine_version: version(), model_version: version(),
        primitive_set_id: PrimitiveSetId::new("test-primitives"), primitive_set_version: version(),
        jinrei_language_version: jinrei::LANGUAGE_VERSION,
        structured_ast_version: AST_SCHEMA_VERSION,
        typed_ir_version: jinrei::TYPED_IR_VERSION, bytecode_version: jinrei::BYTECODE_VERSION,
        domain,
        world_initialization: WorldInitialization { entities: Vec::new(), global_fields: BTreeMap::new(), collections: BTreeMap::new() },
        world: WorldSchema { entity_types: BTreeMap::new(), global_fields: BTreeMap::new(), collections: BTreeMap::new(), max_entities: 32 },
        phases: Vec::new(), required_primitives: BTreeSet::new(), transitions: Vec::new(), arbitration: BTreeMap::new(),
        termination: TerminationPolicy { max_ticks: 1, conditions: Vec::new(), on_timeout: MatchOutcome::Draw,
            on_timeout_reason: SymbolId::new("timeout") },
        cost_schedule,
        presentation: PresentationPolicy { visible_events: BTreeMap::new(), visible_entity_fields: BTreeMap::new(), visible_global_fields: BTreeSet::new() },
        limits: RuleLimits { max_input_bytes: 2_000_000, max_entities: 32, max_events: 100,
            max_diagnostic_events: 10_000, max_output_bytes: 2_000_000, max_intents_per_side_per_tick: 32, max_value_depth: 24 },
    };
    let ruleset = RulesetRef { id: RulesetId::new("test"), version: version(), digest: ContentDigest::new("a".repeat(64)) };
    VerifiedRulePlan::from_validation(ruleset, ContentDigest::new("b".repeat(64)), plan)
}

fn observation(with_units: bool, with_score: bool) -> ObservationSnapshot {
    let mut fields = BTreeMap::new();
    fields.insert(ObservationPath::new("flag"), Observed::Known(DomainValue::Bool(true)));
    if with_score { fields.insert(ObservationPath::new("score"), Observed::Known(DomainValue::Integer(7))); }
    let mut collections = BTreeMap::new();
    if with_units {
        let unit = |id: &str, health: i64| EntityObservation {
            id: EntityId::new(id), entity_type: TypeId::new("unit"),
            fields: [(FieldId::new("health"), Observed::Known(DomainValue::Integer(health)))].into_iter().collect(),
        };
        collections.insert(CollectionId::new("allies.units"), Observed::Known(vec![unit("u-b", 6), unit("u-a", 2)]));
        collections.insert(CollectionId::new("enemies.units"), Observed::Known(vec![unit("enemy-1", 3)]));
    }
    ObservationSnapshot { tick: 4, side: CombatantSide::Attacker, fields, collections }
}

fn execute(rules: &VerifiedRulePlan, program: &TacticalProgram, observation: &ObservationSnapshot, budget: u64, optimize: bool) -> TacticalExecutionOutput {
    let allowed = [CapabilityId::new("act"), CapabilityId::new("inspect"), CapabilityId::new("attack")].into_iter().collect();
    let memory = TacticalMemory::new();
    let mut vm = Vm::with_options(rules, VmOptions { optimize });
    vm.execute(TacticalExecutionRequest { side: observation.side, tick: observation.tick,
        program, observation, memory: &memory, allowed_capabilities: &allowed,
        budget: ExecutionBudget { available_cu: LogicalCu(budget), max_intents: 32 },
    }).expect("VM execution succeeds")
}

#[test]
fn declaration_and_commutative_order_are_canonical() {
    let rules = rules(false, false);
    let first = r#"senkei tactics {
        state ready { flag == true, score >= 4, },
        state unused { false, },
        action alpha { when and { ready, score >= 1, }, do act(), },
        action beta { when or { flag == false, ready, }, do act(), },
    }"#;
    let reordered = r#"senkei tactics {
        action beta { when or { ready, flag == false, }, do act(), },
        state unused { false, },
        action alpha { when and { score >= 1, ready, }, do act(), },
        state ready { score >= 4, flag == true, },
    }"#;
    let one = compile(first, &rules).unwrap();
    let two = compile(reordered, &rules).unwrap();
    assert_eq!(one.ast, two.ast);
    assert_eq!(one.program.bytecode, two.program.bytecode);
    let obs = observation(false, true);
    let out_one = execute(&rules, &one.program, &obs, 100_000, false);
    let out_two = execute(&rules, &two.program, &obs, 100_000, true);
    assert_eq!(out_one, out_two);
    assert_eq!(out_one.intents.iter().map(|i| i.action_id.as_str()).collect::<Vec<_>>(), vec!["alpha", "beta"]);
    assert!(!out_one.diagnostics.iter().any(|event| matches!(event, TacticalDiagnostic::StateEvaluated { state, .. } if state.as_str() == "unused")));
}

#[test]
fn ordered_logic_changes_cost_only_by_short_circuiting() {
    let rules = rules(false, false);
    let score = observation(false, true);
    let first = compile("senkei t { action a { when ordered and { false, score == 7, }, do act(), }, }", &rules).unwrap();
    let second = compile("senkei t { action a { when ordered and { score == 7, false, }, do act(), }, }", &rules).unwrap();
    let a = execute(&rules, &first.program, &score, 100_000, false);
    let b = execute(&rules, &second.program, &score, 100_000, false);
    assert_eq!(a.intents, b.intents);
    assert_eq!(a.required_cu, a.charged_cu);
    assert_eq!(b.required_cu, b.charged_cu);
    assert!(b.required_cu.0 > a.required_cu.0);
}

#[test]
fn state_knownness_is_distinct_from_unknown_comparison() {
    let rules = rules(false, false);
    let source = r#"senkei t {
        state uncertain { score == 7, },
        action on_state { when uncertain is unknown, do act(), },
        action on_unknown_value { when score != 7, do act(), },
    }"#;
    let compiled = compile(source, &rules).unwrap();
    let output = execute(&rules, &compiled.program, &observation(false, false), 100_000, false);
    assert_eq!(output.intents.iter().map(|i| i.action_id.as_str()).collect::<Vec<_>>(), vec!["on_state"]);
    assert!(output.diagnostics.iter().any(|event| matches!(event, TacticalDiagnostic::RuntimeNotice { code, .. } if code.as_str() == "when_unknown")));
    assert!(compile("senkei t { action a { when score == unknown, do act(), }, }", &rules).is_err());
    let mut ast = parse("senkei t { action a { when score == 7, do act(), }, }").unwrap();
    let TacticalDeclaration::Action { when: TacticalPredicate::Compare { left, .. }, .. } = &mut ast.declarations[0] else { panic!("expected comparison"); };
    *left = TacticalValue::Literal(DomainValue::Null);
    assert!(compile_ast(&ast, &rules).is_err());
}

#[test]
fn text_ast_and_optimizer_modes_share_semantics_and_entity_binding() {
    let rules = rules(true, true);
    let source = "senkei t { action select { when true, do act(argmin unit in allies.units by unit.health then unit.id), }, }";
    let parsed = parse(source).unwrap();
    let from_text = compile(source, &rules).unwrap();
    let from_ast = compile_ast(&parsed, &rules).unwrap();
    let optimized = compile_with_options(source, &rules, jinrei::CompileOptions { optimize: true }).unwrap();
    assert_eq!(from_text.ast, from_ast.ast);
    assert_eq!(from_text.program.bytecode, from_ast.program.bytecode);
    assert_eq!(from_text.program.bytecode, optimized.program.bytecode);
    let obs = observation(true, false);
    let plain = execute(&rules, &from_text.program, &obs, 100_000, false);
    let fast = execute(&rules, &from_text.program, &obs, 100_000, true);
    assert_eq!(plain, fast);
    assert_eq!(plain.intents[0].actor, Some(EntityId::new("u-a")));
    assert_eq!(plain.intents[0].arguments, vec![DomainValue::Entity(EntityId::new("u-a"))]);
}

#[test]
fn capability_actor_target_indexes_and_owner_constraints_are_applied() {
    let rules = rules(true, true);
    let source = r#"senkei combat {
        action valid { when true, do attack(
            argmin unit in allies.units by unit.health then unit.id,
            argmin foe in enemies.units by foe.health then foe.id,
        ), },
        action invalid_actor { when true, do attack(
            argmin foe in enemies.units by foe.health then foe.id,
            argmin unit in allies.units by unit.health then unit.id,
        ), },
    }"#;
    let compiled = compile(source, &rules).unwrap();
    let output = execute(&rules, &compiled.program, &observation(true, false), 100_000, false);
    assert_eq!(output.intents.len(), 1);
    assert_eq!(output.intents[0].action_id.as_str(), "valid");
    assert_eq!(output.intents[0].actor, Some(EntityId::new("u-a")));
    assert_eq!(output.intents[0].target, Some(EntityId::new("enemy-1")));
    assert_eq!(output.intents[0].arguments, vec![
        DomainValue::Entity(EntityId::new("u-a")),
        DomainValue::Entity(EntityId::new("enemy-1")),
    ]);
    assert!(output.diagnostics.iter().any(|event| matches!(event, TacticalDiagnostic::RuntimeNotice { code, .. } if code.as_str() == "capability_actor_not_owned")));
}

#[test]
fn budget_overrun_returns_full_required_cu_and_no_partial_intents() {
    let rules = rules(false, false);
    let compiled = compile("senkei t { action a { when true, do act(), }, }", &rules).unwrap();
    let memory = [(StateId::new("remember"), DomainValue::Integer(5))].into_iter().collect();
    let allowed = [CapabilityId::new("act")].into_iter().collect();
    let obs = observation(false, false);
    let mut vm = Vm::new(&rules);
    let output = vm.execute(TacticalExecutionRequest { side: obs.side, tick: obs.tick, program: &compiled.program,
        observation: &obs, memory: &memory, allowed_capabilities: &allowed,
        budget: ExecutionBudget { available_cu: LogicalCu(1), max_intents: 32 },
    }).unwrap();
    assert_eq!(output.status, TacticalExecutionStatus::BudgetExceeded);
    assert!(output.required_cu.0 > 1);
    assert_eq!(output.charged_cu, LogicalCu(1));
    assert!(output.intents.is_empty());
    assert_eq!(output.next_memory, memory);
    let traced: u64 = output.diagnostics.iter().map(|event| match event {
        TacticalDiagnostic::CostCharged { amount, .. } => amount.0,
        _ => 0,
    }).sum();
    assert_eq!(traced, output.charged_cu.0);
}

#[test]
fn collection_grammar_including_standalone_filter_formats_losslessly() {
    let source = r#"senkei aggregates {
        state values {
            any u in allies.units { u.health > 0, },
            all u in allies.units { u.health >= 0, },
            count u in allies.units { u.health > 0, } >= 1,
            sum u in allies.units by u.health >= 1,
            min u in allies.units by u.health is known,
            max u in allies.units by u.health is known,
        },
        action choose { when values, do act(argmin u in allies.units by u.health then u.id), },
        action choose_max { when true, do act(argmax u in allies.units by u.health then u.id), },
        action inspect_filtered { when true, do inspect(filter u in allies.units { u.health > 0, }), },
    }"#;
    let ast = parse(source).unwrap();
    assert_eq!(ast, parse(&jinrei::format(&ast).unwrap()).unwrap());
    let rules = rules(true, true);
    let compiled = compile(source, &rules).unwrap();
    let output = execute(&rules, &compiled.program, &observation(true, false), 100_000, false);
    let selected = output.intents.iter().find(|intent| intent.action_id.as_str() == "choose").unwrap();
    assert_eq!(selected.actor, Some(EntityId::new("u-a")));
    let selected_max = output.intents.iter().find(|intent| intent.action_id.as_str() == "choose_max").unwrap();
    assert_eq!(selected_max.actor, Some(EntityId::new("u-b")));
    let filtered = output.intents.iter().find(|intent| intent.action_id.as_str() == "inspect_filtered").unwrap();
    assert_eq!(filtered.arguments, vec![DomainValue::List(vec![DomainValue::Entity(EntityId::new("u-a")), DomainValue::Entity(EntityId::new("u-b"))])]);
}
