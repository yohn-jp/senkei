use jinrei::{compile, compile_ast, compile_with_options, parse, Vm, VmOptions};
use senkei_model::*;
use std::collections::{BTreeMap, BTreeSet};

fn version() -> Version { Version::new(1, 0, 0) }

fn rules(with_units: bool, actor_argument: bool) -> VerifiedRulePlan {
    let int = DomainType::Integer { min: Some(0), max: Some(100) };
    let integer_vector = DomainType::Vector { element: Box::new(int.clone()), max_items: 8 };
    let integer_list = DomainType::List { element: Box::new(int.clone()), max_items: 8 };
    let integer_matrix = DomainType::Matrix { element: Box::new(int.clone()), max_rows: 4, max_columns: 4 };
    let nested_record = DomainType::Record { fields: [(FieldId::new("rank"), int.clone())].into_iter().collect() };
    let deep_record = DomainType::Record { fields: [
        (FieldId::new("samples"), integer_vector.clone()),
        (FieldId::new("metadata"), nested_record),
    ].into_iter().collect() };
    let unit_type = TypeId::new("unit");
    let mut observations = BTreeMap::new();
    observations.insert(ObservationPath::new("flag"), ObservationFieldSchema {
        value_type: DomainType::Bool, visibility: Visibility::Public, source: ObservationSource::Tick,
    });
    observations.insert(ObservationPath::new("score"), ObservationFieldSchema {
        value_type: int.clone(), visibility: Visibility::Public, source: ObservationSource::Tick,
    });
    for (path, value_type) in [
        ("vector_left", integer_vector.clone()), ("vector_right", integer_vector),
        ("list_left", integer_list.clone()), ("list_right", integer_list),
        ("matrix_left", integer_matrix.clone()), ("matrix_right", integer_matrix),
        ("record_left", deep_record.clone()), ("record_right", deep_record),
    ] {
        observations.insert(ObservationPath::new(path), ObservationFieldSchema {
            value_type, visibility: Visibility::Public, source: ObservationSource::Tick,
        });
    }
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
        let quote = match key {
            COST_COLLECTION_ITERATION => LogicalCuCost { base: 0, per_item: 1 },
            COST_AGGREGATE => LogicalCuCost { base: 1, per_item: 1 },
            COST_CAPABILITY_ISSUE => LogicalCuCost { base: 3, per_item: 0 },
            _ => LogicalCuCost { base: 1, per_item: 0 },
        };
        operations.insert(CostOperationId::new(key), quote);
    }
    let cost_schedule = CostSchedule {
        id: CostScheduleId::new("test-costs"), version: version(), operations,
        per_tick_budget: LogicalCu(100_000), per_match_budget: LogicalCu(100_000),
        overrun_policy: BudgetOverrunPolicy::RejectTickAndKeepMemory,
        memory_commit_policy: MemoryCommitPolicy::OnCompletedEvaluation,
        budget_overrun_reason: SymbolId::new("cu_overrun"),
    };
    let plan = RulePlan {
        next: None,
        catalog_semantics_digest: None,
        minimum_engine_version: version(), model_version: version(),
        primitive_set_id: PrimitiveSetId::new("test-primitives"), primitive_set_version: version(),
        jinrei_language_version: jinrei::LANGUAGE_VERSION,
        structured_ast_version: AST_SCHEMA_VERSION,
        typed_ir_version: jinrei::TYPED_IR_VERSION, bytecode_version: jinrei::BYTECODE_VERSION,
        domain,
        world_initialization: WorldInitialization { entities: Vec::new(), global_fields: BTreeMap::new(), collections: BTreeMap::new() },
        world: WorldSchema { entity_types: BTreeMap::new(), global_fields: BTreeMap::new(), collections: BTreeMap::new(), max_entities: 32 },
        phases: Vec::new(), required_primitives: BTreeSet::new(), transitions: Vec::new(), arbitration: BTreeMap::new(), actor_intent_orders: Vec::new(),
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

fn rules_with_comparison_tariff(per_item: u64) -> VerifiedRulePlan {
    with_comparison_tariff(rules(false, false), per_item)
}

fn with_comparison_tariff(base: VerifiedRulePlan, per_item: u64) -> VerifiedRulePlan {
    let mut plan = base.plan().clone();
    plan.cost_schedule.operations.get_mut(&CostOperationId::new(COST_COMPARISON)).unwrap().per_item = per_item;
    VerifiedRulePlan::from_validation(base.ruleset().clone(), base.package_digest().clone(), plan)
}

fn execute_result(rules: &VerifiedRulePlan, program: &TacticalProgram, observation: &ObservationSnapshot, budget: u64, optimize: bool)
    -> Result<TacticalExecutionOutput, TacticalExecutionError> {
    let allowed = [CapabilityId::new("act"), CapabilityId::new("inspect"), CapabilityId::new("attack")].into_iter().collect();
    let memory = TacticalMemory::new();
    let mut vm = Vm::with_options(rules, VmOptions { optimize });
    vm.execute(TacticalExecutionRequest { side: observation.side, tick: observation.tick,
        program, observation, memory: &memory, allowed_capabilities: &allowed,
        budget: ExecutionBudget { available_cu: LogicalCu(budget), max_intents: 32 },
    })
}

fn execute(rules: &VerifiedRulePlan, program: &TacticalProgram, observation: &ObservationSnapshot, budget: u64, optimize: bool) -> TacticalExecutionOutput {
    execute_result(rules, program, observation, budget, optimize).expect("VM execution succeeds")
}

fn number_list(count: usize) -> DomainValue {
    DomainValue::List((0..count).map(|value| DomainValue::Integer(value as i64)).collect())
}

fn number_matrix(rows: usize, columns: usize) -> DomainValue {
    DomainValue::List((0..rows).map(|_| number_list(columns)).collect())
}

fn shaped_record(sample_count: usize) -> DomainValue {
    DomainValue::Record([
        (FieldId::new("samples"), number_list(sample_count)),
        (FieldId::new("metadata"), DomainValue::Record([
            (FieldId::new("rank"), DomainValue::Integer(7)),
        ].into_iter().collect())),
    ].into_iter().collect())
}

fn container_observation(vector_len: usize, matrix_rows: usize, matrix_columns: usize, list_len: usize, record_samples: usize) -> ObservationSnapshot {
    let mut snapshot = observation(false, false);
    for (path, value) in [
        ("vector_left", number_list(vector_len)), ("vector_right", number_list(vector_len)),
        ("matrix_left", number_matrix(matrix_rows, matrix_columns)), ("matrix_right", number_matrix(matrix_rows, matrix_columns)),
        ("list_left", number_list(list_len)), ("list_right", number_list(list_len)),
        ("record_left", shaped_record(record_samples)), ("record_right", shaped_record(record_samples)),
    ] {
        snapshot.fields.insert(ObservationPath::new(path), Observed::Known(value));
    }
    snapshot
}

fn charged_for(output: &TacticalExecutionOutput, operation: &str) -> u64 {
    charged_amounts_for(output, operation).into_iter().sum()
}

fn charged_amounts_for(output: &TacticalExecutionOutput, operation: &str) -> Vec<u64> {
    output.diagnostics.iter().filter_map(|event| match event {
        TacticalDiagnostic::CostCharged { operation: id, amount } if id.as_str() == operation => Some(amount.0),
        _ => None,
    }).collect()
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
fn deep_container_comparisons_are_tariffed_per_element() {
    let rules = rules_with_comparison_tariff(0);
    let source = r#"senkei containers {
        action equal { when and {
            vector_left == vector_right,
            matrix_left == matrix_right,
            list_left == list_right,
            record_left == record_right,
        }, do act(), },
    }"#;
    for comparison in [
        "vector_left == vector_right",
        "matrix_left == matrix_right",
        "list_left == list_right",
        "record_left == record_right",
    ] {
        let source = format!("senkei t {{ action a {{ when {comparison}, do act(), }}, }}");
        assert!(compile(&source, &rules).is_ok(), "base-only comparison tariff must support {comparison}");
    }
    assert!(compile("senkei t { action scalar { when score == 7, do act(), }, }", &rules).is_ok());

    let compiled = compile(source, &rules).unwrap();
    let small = execute(&rules, &compiled.program, &container_observation(2, 1, 1, 2, 1), 100_000, false);
    let large_observation = container_observation(5, 3, 2, 4, 4);
    let large = execute(&rules, &compiled.program, &large_observation, 100_000, false);
    let large_optimized = execute(&rules, &compiled.program, &large_observation, 100_000, true);

    assert_eq!(small.intents.iter().map(|intent| intent.action_id.as_str()).collect::<Vec<_>>(), vec!["equal"]);
    assert_eq!(large.intents, small.intents);
    assert_eq!(large, large_optimized);
    assert_eq!(charged_for(&small, COST_COMPARISON), 14);
    assert_eq!(charged_for(&large, COST_COMPARISON), 29);
    assert_eq!(large.required_cu.0 - small.required_cu.0, 15);
    assert_eq!(large.required_cu, large.charged_cu);

    let positive_tariff = rules_with_comparison_tariff(2);
    let with_surcharge = compile(source, &positive_tariff).unwrap();
    let positive_output = execute(&positive_tariff, &with_surcharge.program, &large_observation, 100_000, false);
    assert_eq!(charged_for(&positive_output, COST_COMPARISON), 87);
}

#[test]
fn empty_and_unknown_vector_values_remain_distinct() {
    let rules = rules_with_comparison_tariff(2);
    let compiled = compile(r#"senkei containers {
        action equal { when vector_left == vector_right, do act(), },
        action left_unknown { when vector_left is unknown, do act(), },
    }"#, &rules).unwrap();

    let mut empty = observation(false, false);
    empty.fields.insert(ObservationPath::new("vector_left"), Observed::Known(DomainValue::List(Vec::new())));
    empty.fields.insert(ObservationPath::new("vector_right"), Observed::Known(DomainValue::List(Vec::new())));
    let empty_output = execute(&rules, &compiled.program, &empty, 100_000, false);
    assert_eq!(empty_output.intents.iter().map(|intent| intent.action_id.as_str()).collect::<Vec<_>>(), vec!["equal"]);
    assert_eq!(charged_amounts_for(&empty_output, COST_COMPARISON), vec![3, 3]);

    let mut unknown = observation(false, false);
    unknown.fields.insert(ObservationPath::new("vector_left"), Observed::Unknown);
    unknown.fields.insert(ObservationPath::new("vector_right"), Observed::Known(DomainValue::List(Vec::new())));
    let unknown_output = execute(&rules, &compiled.program, &unknown, 100_000, false);
    assert_eq!(unknown_output.intents.iter().map(|intent| intent.action_id.as_str()).collect::<Vec<_>>(), vec!["left_unknown"]);
    assert_eq!(charged_amounts_for(&unknown_output, COST_COMPARISON), vec![3, 3]);
    assert!(unknown_output.diagnostics.iter().any(|event| matches!(event,
        TacticalDiagnostic::RuntimeNotice { code, .. } if code.as_str() == "when_unknown")));
}

#[test]
fn vector_matrix_and_record_observations_obey_schema_bounds() {
    let rules = rules_with_comparison_tariff(1);
    let compiled = compile("senkei t { action idle { when true, do act(), }, }", &rules).unwrap();
    let invalid_values = [
        ("vector_left", number_list(9)),
        ("vector_left", DomainValue::List(vec![DomainValue::Integer(101)])),
        ("matrix_left", number_matrix(5, 1)),
        ("matrix_left", number_matrix(1, 5)),
        ("matrix_left", DomainValue::List(vec![DomainValue::Integer(1)])),
        ("matrix_left", DomainValue::List(vec![DomainValue::List(vec![DomainValue::Integer(101)])])),
        ("record_left", DomainValue::Record([
            (FieldId::new("samples"), number_list(1)),
        ].into_iter().collect())),
        ("record_right", DomainValue::Record([
            (FieldId::new("samples"), number_list(1)),
            (FieldId::new("metadata"), DomainValue::Record([
                (FieldId::new("rank"), DomainValue::Integer(101)),
            ].into_iter().collect())),
        ].into_iter().collect())),
    ];
    for (path, value) in invalid_values {
        let mut snapshot = observation(false, false);
        snapshot.fields.insert(ObservationPath::new(path), Observed::Known(value));
        let error = execute_result(&rules, &compiled.program, &snapshot, 100_000, false).unwrap_err();
        assert_eq!(error.code, ApiErrorCode::InvalidSnapshot, "invalid value for {path}");
    }
}

#[test]
fn finite_collection_results_and_cu_ignore_input_item_order() {
    let rules = with_comparison_tariff(rules(true, false), 0);
    let compiled = compile(r#"senkei collections {
        action some_positive { when any unit in allies.units { unit.health > 0, }, do act(), },
        action all_positive { when all unit in allies.units { unit.health > 0, }, do act(), },
        action same_positive_set { when filter left in allies.units { left.health > 0, }
            == filter right in allies.units { right.health > 0, }, do act(), },
    }"#, &rules).unwrap();
    let make_unit = |id: &str, health: i64| EntityObservation {
        id: EntityId::new(id), entity_type: TypeId::new("unit"),
        fields: [(FieldId::new("health"), Observed::Known(DomainValue::Integer(health)))].into_iter().collect(),
    };
    let mut forward = observation(false, false);
    forward.collections.insert(CollectionId::new("allies.units"), Observed::Known(vec![make_unit("a", 2), make_unit("b", 4)]));
    let mut reverse = observation(false, false);
    reverse.collections.insert(CollectionId::new("allies.units"), Observed::Known(vec![make_unit("b", 4), make_unit("a", 2)]));
    let first = execute(&rules, &compiled.program, &forward, 100_000, false);
    let second = execute(&rules, &compiled.program, &reverse, 100_000, true);
    assert_eq!(first, second);
    assert_eq!(first.intents.iter().map(|intent| intent.action_id.as_str()).collect::<Vec<_>>(),
        vec!["all_positive", "same_positive_set", "some_positive"]);
    let comparison_amounts = charged_amounts_for(&first, COST_COMPARISON);
    assert_eq!(comparison_amounts.len(), 9);
    assert_eq!(comparison_amounts.iter().filter(|&&amount| amount == 3).count(), 1);
    assert_eq!(comparison_amounts.into_iter().sum::<u64>(), 11);

    let mut empty = observation(false, false);
    empty.collections.insert(CollectionId::new("allies.units"), Observed::Known(Vec::new()));
    let empty_output = execute(&rules, &compiled.program, &empty, 100_000, false);
    assert_eq!(empty_output.intents.iter().map(|intent| intent.action_id.as_str()).collect::<Vec<_>>(),
        vec!["all_positive", "same_positive_set"]);

    let mut unknown = observation(false, false);
    unknown.collections.insert(CollectionId::new("allies.units"), Observed::Unknown);
    let unknown_output = execute(&rules, &compiled.program, &unknown, 100_000, false);
    assert!(unknown_output.intents.is_empty());
    assert_eq!(unknown_output.diagnostics.iter().filter(|event| matches!(event,
        TacticalDiagnostic::RuntimeNotice { code, .. } if code.as_str() == "when_unknown")).count(), 3);
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

#[test]
fn nested_quantifier_shadowing_restores_outer_binding() {
    let rules = rules(true, false);
    let source = r#"senkei shadowed {
        action check {
            when any u in allies.units {
                u.health == 2,
                any u in enemies.units { u.health == 3, },
                u.health == 2,
            },
            do act(),
        },
    }"#;
    let compiled = compile(source, &rules).unwrap();
    for optimize in [false, true] {
        let output = execute(&rules, &compiled.program, &observation(true, false), 100_000, optimize);
        assert_eq!(output.status, TacticalExecutionStatus::Completed);
        assert_eq!(output.intents.len(), 1, "outer u must survive nested u");
        assert_eq!(output.intents[0].action_id.as_str(), "check");
    }
}

#[test]
fn sum_accepts_total_above_individual_numeric_field_bound() {
    let rules = rules(true, false);
    let mut obs = observation(true, false);
    let Some(Observed::Known(units)) = obs.collections.get_mut(&CollectionId::new("allies.units")) else {
        panic!("expected allies");
    };
    for unit in units {
        unit.fields.insert(FieldId::new("health"), Observed::Known(DomainValue::Integer(90)));
    }
    // health is individually capped at 100, but two legal 90s sum to 180.
    let source = "senkei sums { action check { when sum u in allies.units by u.health >= 180, do act(), }, }";
    let program = compile(source, &rules).expect("sum result range must not inherit element bound").program;
    for optimize in [false, true] {
        let output = execute(&rules, &program, &obs, 100_000, optimize);
        assert_eq!(output.status, TacticalExecutionStatus::Completed);
        assert_eq!(output.intents.len(), 1);
    }
}

#[test]
fn implicit_collection_conjunctions_have_all_runtime_cost_operations() {
    let rules = rules(true, false);
    let obs = observation(true, false);
    let cases = [
        "senkei one_filter { action a { when true, do inspect(filter u in allies.units { u.health > 0, }), }, }",
        "senkei two_filter { action a { when true, do inspect(filter u in allies.units { u.health > 0, u.health < 10, }), }, }",
        "senkei quantifier { action a { when any u in allies.units { u.health > 0, u.health < 10, }, do act(), }, }",
        "senkei all_quantifier { action a { when all u in allies.units { u.health > 0, u.health < 10, }, do act(), }, }",
        "senkei count_ops { action a { when count u in allies.units { u.health > 0, u.health < 10, } >= 2, do act(), }, }",
        "senkei nested_filter { action a { when true, do attack(argmin u in filter u in allies.units { u.health > 0, u.health < 10, } by u.health then u.id, argmin foe in enemies.units by foe.health then foe.id), }, }",
    ];
    for source in cases {
        let compiled = compile(source, &rules).unwrap();
        let output = execute(&rules, &compiled.program, &obs, 100_000, false);
        assert_eq!(output.status, TacticalExecutionStatus::Completed, "{source}");
        assert!(output.required_cu.0 > 0, "{source}");
    }
}

#[test]
fn action_source_locations_come_from_parser_and_bind_exact_text_revision() {
    let rules = rules(false, false);
    let source = "// 日本語 😀 action phantom { }\r\nsenkei action_map {\n state guard { true },\n action zeta { // 日本語 😀 } action phantom {\n when guard, do act(),\n },\n // action zeta {}\n action hold { when true, do act(), },\n}";
    let compiled = compile(source, &rules).unwrap();
    let map = compiled.source_map.as_ref().unwrap();
    assert_eq!(map.schema_version, 1);
    assert_eq!(map.program_digest, compiled.program.content_digest);
    assert_eq!(map.source_digest.as_str().len(), 64);
    assert_eq!(map.actions.len(), 2);
    for (location, expected, index) in [
        (&map.actions[0], "action zeta { // 日本語 😀 } action phantom {\n when guard, do act(),\n }", 1),
        (&map.actions[1], "action hold { when true, do act(), }", 2),
    ] {
        assert_eq!(location.declaration_index, index);
        assert!(source.is_char_boundary(location.start_utf8));
        assert!(source.is_char_boundary(location.end_utf8));
        assert_eq!(&source[location.start_utf8..location.end_utf8], expected);
    }
    assert_eq!(map.actions[0].action_id.as_str(), "zeta");
    assert_eq!(map.actions[1].action_id.as_str(), "hold");
    // Formatting/comments change source identity, but never semantic identity or CU.
    let revised = compile(&format!("// another revision\n{source}"), &rules).unwrap();
    assert_ne!(map.source_digest, revised.source_map.unwrap().source_digest);
    assert_eq!(compiled.program, revised.program);
    assert_eq!(compiled.estimated_cu, revised.estimated_cu);
    let from_ast = compile_ast(&parse(source).unwrap(), &rules).unwrap();
    assert_eq!(compiled.ast, from_ast.ast);
    assert_eq!(compiled.program, from_ast.program);
    assert!(from_ast.source_map.is_none());
    assert!(serde_json::to_value(from_ast).unwrap().get("source_map").is_none());
    // Closing braces and declaration-like text inside string tokens cannot end a range.
    let literal_source = r#"senkei strings { action quoted { when "日本語 😀 } action quoted {" == "日本語 😀 } action quoted {", do act(), } }"#;
    let literal_result = compile(literal_source, &rules).unwrap();
    let literal_location = &literal_result.source_map.unwrap().actions[0];
    assert_eq!(&literal_source[literal_location.start_utf8..literal_location.end_utf8],
        &literal_source[17..literal_source.len() - 2]);
    // Actual duplicate declarations are rejected, rather than yielding ambiguous mappings.
    assert!(compile("senkei p { action a { when true, do act() }, action a { when true, do act() } }", &rules).is_err());
}
