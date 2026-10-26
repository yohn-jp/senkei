use crate::{
    bytecode::{self, CostKind, CostedProgram},
    error::CompileError,
    parser,
    types::{
        comparison_units_bound, value_type, Collection, Predicate, TypeChecker, TypedAction, TypedProgram,
        TypedState, Value,
    },
    AST_SCHEMA_VERSION, BYTECODE_VERSION, LANGUAGE_VERSION, MAX_AST_DEPTH, MAX_BYTECODE_BYTES, MAX_STATE_REF_DEPTH, MAX_TOKENS, TYPED_IR_VERSION,
};
use senkei_model::{
    ActionId, ApiError, ApiErrorCode, CapabilityId, CompileResult,
    DomainType, LogicalCu, RulePlan, StructuredTacticsAst, TacticalCollection,
    TacticalDeclaration, TacticalPredicate, TacticalValue, VerifiedRulePlan,
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CompileOptions {
    /// Reserved for CU-preserving physical lowering. Both settings currently
    /// produce the same verified bytecode and logical operation schedule.
    pub optimize: bool,
}

pub fn compile(source: &str, rules: &VerifiedRulePlan) -> Result<CompileResult, ApiError> {
    compile_with_options(source, rules, CompileOptions::default())
}

pub fn compile_with_options(source: &str, rules: &VerifiedRulePlan, _options: CompileOptions) -> Result<CompileResult, ApiError> {
    if source.len() as u64 > rules.limits().max_input_bytes {
        return Err(ApiError::new(ApiErrorCode::ResourceLimit, "source exceeds the verified RulePlan input byte limit"));
    }
    let (ast, actions) = parser::parse_with_locations(source).map_err(CompileError::into_api)?;
    let mut result = compile_internal(&ast, rules).map_err(CompileError::into_api)?;
    result.source_map = Some(senkei_model::ActionSourceMap {
        schema_version: 1,
        source_digest: senkei_model::ContentDigest::new(bytecode::digest(source.as_bytes())),
        program_digest: result.program.content_digest.clone(),
        actions,
    });
    Ok(result)
}

pub fn compile_ast(ast: &StructuredTacticsAst, rules: &VerifiedRulePlan) -> Result<CompileResult, ApiError> {
    compile_ast_with_options(ast, rules, CompileOptions::default())
}

pub fn compile_ast_with_options(ast: &StructuredTacticsAst, rules: &VerifiedRulePlan, _options: CompileOptions) -> Result<CompileResult, ApiError> {
    crate::formatter::validate_ast(ast).map_err(CompileError::into_api)?;
    let ast_bytes = serde_json::to_vec(ast).map_err(|_| ApiError::new(ApiErrorCode::InvalidRequest, "structured AST cannot be serialized"))?;
    if ast_bytes.len() as u64 > rules.limits().max_input_bytes {
        return Err(ApiError::new(ApiErrorCode::ResourceLimit, "structured AST exceeds the verified RulePlan input byte limit"));
    }
    compile_internal(ast, rules).map_err(CompileError::into_api)
}

fn compile_internal(ast: &StructuredTacticsAst, rules: &VerifiedRulePlan) -> Result<CompileResult, CompileError> {
    let plan = rules.plan();
    verify_versions(plan)?;
    validate_ast(ast, plan)?;
    let ast = canonicalize_ast(ast);
    verify_state_cycles(&ast)?;
    let typed = type_program(&ast, plan)?;
    let required = required_cost_kinds(&typed);
    let costs = bytecode::required_costs(&plan.cost_schedule, &required)?;
    let estimate = estimate(&typed, &costs, plan);
    let costed = CostedProgram {
        source_ast: ast.clone(),
        typed,
        cost_schedule_id: plan.cost_schedule.id.clone(),
        cost_schedule_version: plan.cost_schedule.version,
        costs,
        static_estimate: estimate,
    };
    let bytecode = bytecode::encode(&costed)?;
    if bytecode.len() > MAX_BYTECODE_BYTES { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "compiled bytecode exceeds the host bytecode limit")); }
    let content_digest = bytecode::digest(&bytecode);
    let program = senkei_model::TacticalProgram {
        language_version: plan.jinrei_language_version,
        ir_version: plan.typed_ir_version,
        bytecode_version: plan.bytecode_version,
        cost_schedule_id: plan.cost_schedule.id.clone(),
        cost_schedule_version: plan.cost_schedule.version,
        ruleset: rules.ruleset().clone(),
        content_digest: senkei_model::ContentDigest::new(content_digest),
        bytecode,
    };
    Ok(CompileResult {
        ast,
        program,
        estimated_cu: LogicalCu(estimate.min(LogicalCu::MAX_SAFE_JSON_INTEGER)),
        diagnostics: Vec::new(),
        source_map: None,
    })
}

pub(crate) fn verify_bytecode_ast(ast: &StructuredTacticsAst, plan: &RulePlan) -> Result<TypedProgram, CompileError> {
    verify_versions(plan)?;
    validate_ast(ast, plan)?;
    verify_state_cycles(ast)?;
    type_program(ast, plan)
}

fn verify_versions(plan: &RulePlan) -> Result<(), CompileError> {
    if plan.jinrei_language_version != LANGUAGE_VERSION || plan.structured_ast_version != AST_SCHEMA_VERSION
        || plan.typed_ir_version != TYPED_IR_VERSION
        || plan.bytecode_version != BYTECODE_VERSION {
        return Err(CompileError::new(ApiErrorCode::IncompatibleVersion, "RulePlan requires an unsupported Jinrei language, IR, or bytecode version"));
    }
    if plan.cost_schedule.per_tick_budget.0 > LogicalCu::MAX_SAFE_JSON_INTEGER
        || plan.cost_schedule.per_match_budget.0 > LogicalCu::MAX_SAFE_JSON_INTEGER
        || plan.cost_schedule.operations.values().any(|cost| cost.base > LogicalCu::MAX_SAFE_JSON_INTEGER || cost.per_item > LogicalCu::MAX_SAFE_JSON_INTEGER) {
        return Err(CompileError::new(ApiErrorCode::ValidationFailed, "RulePlan contains a CU value outside the safe JSON integer range"));
    }
    bytecode::verify_core_cost_schedule(&plan.cost_schedule)?;
    Ok(())
}

fn validate_ast(ast: &StructuredTacticsAst, plan: &RulePlan) -> Result<(), CompileError> {
    if ast.schema_version != AST_SCHEMA_VERSION {
        return Err(CompileError::new(ApiErrorCode::IncompatibleVersion, "unsupported StructuredTacticsAst schema version"));
    }
    if ast.declarations.len() > MAX_TOKENS { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "structured AST contains too many declarations")); }
    let max_depth = (plan.domain.max_expression_depth as usize)
        .min(plan.limits.max_value_depth as usize)
        .min(MAX_AST_DEPTH);
    let mut nodes = 0usize;
    let mut stack = Vec::new();
    for declaration in &ast.declarations {
        match declaration {
            TacticalDeclaration::State { predicates, .. } => for predicate in predicates { stack.push(ShapeNode::Predicate(predicate, 1)); },
            TacticalDeclaration::Action { when, do_call, .. } => {
                stack.push(ShapeNode::Predicate(when, 1));
                for argument in &do_call.arguments { stack.push(ShapeNode::Value(argument, 1)); }
            }
        }
    }
    while let Some(node) = stack.pop() {
        nodes += 1;
        if nodes > MAX_TOKENS { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "structured AST contains too many nodes")); }
        let depth = node.depth();
        if depth > max_depth { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "structured AST exceeds the RulePlan expression depth limit")); }
        match node {
            ShapeNode::Predicate(p, d) => match p {
                TacticalPredicate::LiteralTruth(_) | TacticalPredicate::StateReference(_) => {}
                TacticalPredicate::Compare { left, right, .. } => { stack.push(ShapeNode::Value(left, d + 1)); stack.push(ShapeNode::Value(right, d + 1)); }
                TacticalPredicate::Knownness { value, .. } => stack.push(ShapeNode::Value(value, d + 1)),
                TacticalPredicate::And(v) | TacticalPredicate::Or(v) | TacticalPredicate::OrderedAnd(v) | TacticalPredicate::OrderedOr(v) => for p in v { stack.push(ShapeNode::Predicate(p, d + 1)); },
                TacticalPredicate::Not(p) => stack.push(ShapeNode::Predicate(p, d + 1)),
                TacticalPredicate::Quantified { collection, predicates, .. } => {
                    stack.push(ShapeNode::Collection(collection, d + 1));
                    for p in predicates { stack.push(ShapeNode::Predicate(p, d + 1)); }
                }
            },
            ShapeNode::Value(v, d) => match v {
                TacticalValue::Literal(_) | TacticalValue::Path(_) => {}
                TacticalValue::FilteredCollection { collection, predicates, .. } => {
                    stack.push(ShapeNode::Collection(collection, d + 1));
                    for p in predicates { stack.push(ShapeNode::Predicate(p, d + 1)); }
                }
                TacticalValue::Count { collection, predicates, .. } => {
                    stack.push(ShapeNode::Collection(collection, d + 1));
                    for p in predicates { stack.push(ShapeNode::Predicate(p, d + 1)); }
                }
                TacticalValue::Sum { collection, expression, .. } | TacticalValue::Min { collection, expression, .. } | TacticalValue::Max { collection, expression, .. } => {
                    stack.push(ShapeNode::Collection(collection, d + 1)); stack.push(ShapeNode::Value(expression, d + 1));
                }
                TacticalValue::ArgMin { collection, expression, .. } | TacticalValue::ArgMax { collection, expression, .. } => {
                    stack.push(ShapeNode::Collection(collection, d + 1)); stack.push(ShapeNode::Value(expression, d + 1));
                }
            },
            ShapeNode::Collection(c, d) => match c {
                TacticalCollection::Path(_) => {}
                TacticalCollection::Filter { collection, predicates, .. } => {
                    stack.push(ShapeNode::Collection(collection, d + 1));
                    for p in predicates { stack.push(ShapeNode::Predicate(p, d + 1)); }
                }
            },
        }
    }
    crate::formatter::validate_ast(ast)?;
    if ast.declarations.is_empty() { return Err(CompileError::new(ApiErrorCode::ValidationFailed, "a program must declare at least one state or action")); }
    if !valid_identifier(&ast.program_name) { return Err(CompileError::new(ApiErrorCode::ValidationFailed, "program name is invalid or reserved")); }
    let mut names = BTreeSet::new();
    for decl in &ast.declarations {
        let name = match decl { TacticalDeclaration::State { name, .. } | TacticalDeclaration::Action { name, .. } => name };
        if !valid_identifier(name) { return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("declaration name '{name}' is invalid or reserved"))); }
        if !names.insert(name.clone()) { return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("duplicate declaration '{name}'"))); }
        match decl {
            TacticalDeclaration::State { predicates, .. } if predicates.is_empty() => return Err(CompileError::new(ApiErrorCode::ValidationFailed, "state conditions cannot be empty")),
            TacticalDeclaration::Action { do_call, .. } => {
                if do_call.capability.0.is_empty() || do_call.capability.0.iter().any(|v| !valid_identifier(v)) {
                    return Err(CompileError::new(ApiErrorCode::ValidationFailed, "capability path is invalid or reserved"));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

enum ShapeNode<'a> { Predicate(&'a TacticalPredicate, usize), Value(&'a TacticalValue, usize), Collection(&'a TacticalCollection, usize) }
impl ShapeNode<'_> { fn depth(&self) -> usize { match self { Self::Predicate(_, d) | Self::Value(_, d) | Self::Collection(_, d) => *d } } }

fn valid_identifier(value: &str) -> bool {
    const RESERVED: &[&str] = &["senkei", "state", "action", "when", "do", "and", "or", "not", "ordered", "any", "all", "count", "filter", "sum", "min", "max", "argmin", "argmax", "in", "by", "then", "is", "known", "unknown", "true", "false"];
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(b'A'..=b'Z' | b'a'..=b'z' | b'_')) && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_') && !RESERVED.contains(&value)
}

fn verify_state_cycles(ast: &StructuredTacticsAst) -> Result<(), CompileError> {
    let state_names: BTreeSet<_> = ast.declarations.iter().filter_map(|d| if let TacticalDeclaration::State { name, .. } = d { Some(name.clone()) } else { None }).collect();
    let mut graph: BTreeMap<String, BTreeSet<String>> = state_names.iter().map(|n| (n.clone(), BTreeSet::new())).collect();
    for declaration in &ast.declarations {
        if let TacticalDeclaration::State { name, predicates } = declaration {
            let edges = graph.get_mut(name).expect("state was inserted above");
            for predicate in predicates { collect_state_refs_predicate(predicate, &state_names, edges); }
        }
    }
    let mut colors: BTreeMap<String, u8> = graph.keys().map(|node| (node.clone(), 0)).collect();
    for start in graph.keys() {
        if colors.get(start) == Some(&2) { continue; }
        let mut stack = vec![(start.clone(), false, 1usize)];
        while let Some((node, exiting, depth)) = stack.pop() {
            if exiting { colors.insert(node, 2); continue; }
            match colors.get(&node).copied().unwrap_or(0) {
                2 => continue,
                1 => return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("cyclic state reference involving '{node}'"))),
                _ => {}
            }
            if depth > MAX_STATE_REF_DEPTH { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "state reference chain exceeds the host limit")); }
            colors.insert(node.clone(), 1);
            stack.push((node.clone(), true, depth));
            if let Some(edges) = graph.get(&node) {
                for child in edges.iter().rev() { stack.push((child.clone(), false, depth + 1)); }
            }
        }
    }
    Ok(())
}

fn collect_state_refs_predicate(p: &TacticalPredicate, names: &BTreeSet<String>, out: &mut BTreeSet<String>) {
    match p {
        TacticalPredicate::StateReference(name) => if names.contains(name) { out.insert(name.clone()); },
        TacticalPredicate::Compare { left, right, .. } => { collect_state_refs_value(left, names, out); collect_state_refs_value(right, names, out); }
        TacticalPredicate::Knownness { value, .. } => collect_state_refs_value(value, names, out),
        TacticalPredicate::And(v) | TacticalPredicate::Or(v) | TacticalPredicate::OrderedAnd(v) | TacticalPredicate::OrderedOr(v) => for x in v { collect_state_refs_predicate(x, names, out); },
        TacticalPredicate::Not(x) => collect_state_refs_predicate(x, names, out),
        TacticalPredicate::Quantified { collection, predicates, .. } => { collect_state_refs_collection(collection, names, out); for x in predicates { collect_state_refs_predicate(x, names, out); } }
        TacticalPredicate::LiteralTruth(_) => {}
    }
}
fn collect_state_refs_value(v: &TacticalValue, names: &BTreeSet<String>, out: &mut BTreeSet<String>) {
    match v {
        TacticalValue::Path(path) if path.0.len() == 1 && names.contains(&path.0[0]) => { out.insert(path.0[0].clone()); }
        TacticalValue::FilteredCollection { collection, predicates, .. } => { collect_state_refs_collection(collection, names, out); for p in predicates { collect_state_refs_predicate(p, names, out); } }
        TacticalValue::Count { collection, predicates, .. } => { collect_state_refs_collection(collection, names, out); for p in predicates { collect_state_refs_predicate(p, names, out); } }
        TacticalValue::Sum { collection, expression, .. } | TacticalValue::Min { collection, expression, .. } | TacticalValue::Max { collection, expression, .. } => { collect_state_refs_collection(collection, names, out); collect_state_refs_value(expression, names, out); }
        TacticalValue::ArgMin { collection, expression, .. } | TacticalValue::ArgMax { collection, expression, .. } => { collect_state_refs_collection(collection, names, out); collect_state_refs_value(expression, names, out); }
        _ => {}
    }
}
fn collect_state_refs_collection(c: &TacticalCollection, names: &BTreeSet<String>, out: &mut BTreeSet<String>) {
    if let TacticalCollection::Filter { collection, predicates, .. } = c { collect_state_refs_collection(collection, names, out); for p in predicates { collect_state_refs_predicate(p, names, out); } }
}

fn type_program(ast: &StructuredTacticsAst, plan: &RulePlan) -> Result<TypedProgram, CompileError> {
    let state_names: BTreeSet<_> = ast.declarations.iter().filter_map(|d| if let TacticalDeclaration::State { name, .. } = d { Some(name.clone()) } else { None }).collect();
    let mut checker = TypeChecker::new(plan, state_names.clone());
    let mut states = Vec::new();
    let mut actions = Vec::new();
    for declaration in &ast.declarations {
        match declaration {
            TacticalDeclaration::State { name, predicates } => {
                let mut children: Vec<_> = predicates.iter().map(|p| checker.type_predicate(p)).collect::<Result<_, _>>()?;
                sort_commutative_predicates(&mut children);
                let predicate = if children.len() == 1 { children.remove(0) } else { Predicate::And(children) };
                states.push(TypedState { id: senkei_model::StateId::new(name.clone()), predicate });
            }
            TacticalDeclaration::Action { name, when, do_call } => {
                let capability_name = do_call.capability.0.join(".");
                let capability = CapabilityId::new(capability_name.clone());
                let schema = plan.domain.capabilities.get(&capability).ok_or_else(|| CompileError::new(ApiErrorCode::ValidationFailed, format!("unknown capability '{capability_name}'")))?;
                let required = schema.arguments.iter().filter(|arg| !arg.optional).count();
                if do_call.arguments.len() > schema.arguments.len() || do_call.arguments.len() < required
                    || schema.arguments.iter().skip(do_call.arguments.len()).any(|arg| !arg.optional) {
                    return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("wrong number of arguments for capability '{capability_name}'")));
                }
                let issue_cost = plan.cost_schedule.operations.get(&schema.issue_cost)
                    .ok_or_else(|| CompileError::new(ApiErrorCode::ValidationFailed, format!("cost schedule is missing capability issue cost '{}'", schema.issue_cost)))?;
                if issue_cost.base == 0 && issue_cost.per_item == 0 {
                    return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("capability issue cost '{}' must define a nonzero total charge", schema.issue_cost)));
                }
                let mut arguments = Vec::new();
                for (index, argument) in do_call.arguments.iter().enumerate() {
                    let expected = schema.arguments[index].value_type.clone();
                    arguments.push(checker.type_capability_argument(argument, expected)?);
                }
                let actor_argument = schema.actor_argument.map(usize::from);
                let target_argument = schema.target_argument.map(usize::from);
                if let Some(index) = actor_argument {
                    if index >= arguments.len() || !is_entity_type(value_type(&arguments[index])) {
                        return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("capability '{capability_name}' actor_argument must select an Entity argument")));
                    }
                }
                if let Some(index) = target_argument {
                    if index >= arguments.len() || !is_entity_type(value_type(&arguments[index])) {
                        return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("capability '{capability_name}' target_argument must select an Entity argument")));
                    }
                }
                if let Some(target_type) = &schema.target_type {
                    let Some(index) = target_argument else {
                        return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("capability '{capability_name}' declares target_type without target_argument")));
                    };
                    if !entity_type_matches(value_type(&arguments[index]), target_type) {
                        return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("capability '{capability_name}' target argument must be an Entity of type '{target_type}'")));
                    }
                }
                if target_argument.is_none() && schema.target_owner != senkei_model::TargetOwnerConstraint::Any {
                    return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("capability '{capability_name}' constrains a target owner without target_argument")));
                }
                let mut when = checker.type_predicate(when)?;
                normalize_predicate(&mut when);
                actions.push(TypedAction { id: ActionId::new(name.clone()), when, capability, arguments,
                    actor_argument, target_argument, target_owner: schema.target_owner });
            }
        }
    }
    for state in &mut states { normalize_predicate(&mut state.predicate); }
    states.sort_by(|a,b| a.id.cmp(&b.id));
    actions.sort_by(|a,b| a.id.cmp(&b.id));
    Ok(TypedProgram { name: ast.program_name.clone(), states, actions, static_cu: 0 })
}

fn is_entity_type(value: &DomainType) -> bool {
    match value { DomainType::Entity { .. } => true, DomainType::Optional(inner) => matches!(inner.as_ref(), DomainType::Entity { .. }), _ => false }
}

fn entity_type_matches(value: &DomainType, expected: &senkei_model::TypeId) -> bool {
    match value {
        DomainType::Entity { entity_type } => entity_type.as_ref() == Some(expected),
        DomainType::Optional(inner) => matches!(inner.as_ref(), DomainType::Entity { entity_type: Some(found) } if found == expected),
        _ => false,
    }
}

fn canonicalize_ast(ast: &StructuredTacticsAst) -> StructuredTacticsAst {
    let mut canonical = ast.clone();
    for declaration in &mut canonical.declarations {
        match declaration {
            TacticalDeclaration::State { predicates, .. } => {
                for predicate in predicates.iter_mut() { canonicalize_predicate(predicate); }
                predicates.sort_by_key(|predicate| serde_json::to_vec(predicate).unwrap_or_default());
            }
            TacticalDeclaration::Action { when, do_call, .. } => {
                canonicalize_predicate(when);
                for argument in &mut do_call.arguments { canonicalize_value(argument); }
            }
        }
    }
    canonical.declarations.sort_by(|left, right| declaration_key(left).cmp(&declaration_key(right)));
    canonical
}

fn declaration_key(declaration: &TacticalDeclaration) -> (u8, &str) {
    match declaration { TacticalDeclaration::State { name, .. } => (0, name), TacticalDeclaration::Action { name, .. } => (1, name) }
}
fn canonicalize_predicate(predicate: &mut TacticalPredicate) {
    match predicate {
        TacticalPredicate::Compare { left, right, .. } => { canonicalize_value(left); canonicalize_value(right); }
        TacticalPredicate::Knownness { value, .. } => canonicalize_value(value),
        TacticalPredicate::And(children) | TacticalPredicate::Or(children) => {
            for child in children.iter_mut() { canonicalize_predicate(child); }
            children.sort_by_key(|child| serde_json::to_vec(child).unwrap_or_default());
        }
        TacticalPredicate::OrderedAnd(children) | TacticalPredicate::OrderedOr(children) => for child in children { canonicalize_predicate(child); },
        TacticalPredicate::Not(child) => canonicalize_predicate(child),
        TacticalPredicate::Quantified { collection, predicates, .. } => {
            canonicalize_collection(collection);
            for child in predicates.iter_mut() { canonicalize_predicate(child); }
            predicates.sort_by_key(|child| serde_json::to_vec(child).unwrap_or_default());
        }
        TacticalPredicate::LiteralTruth(_) | TacticalPredicate::StateReference(_) => {}
    }
}
fn canonicalize_value(value: &mut TacticalValue) {
    match value {
        TacticalValue::FilteredCollection { collection, predicates, .. } => {
            canonicalize_collection(collection);
            for predicate in predicates.iter_mut() { canonicalize_predicate(predicate); }
            predicates.sort_by_key(|predicate| serde_json::to_vec(predicate).unwrap_or_default());
        }
        TacticalValue::Count { collection, predicates, .. } => {
            canonicalize_collection(collection);
            for predicate in predicates.iter_mut() { canonicalize_predicate(predicate); }
            predicates.sort_by_key(|predicate| serde_json::to_vec(predicate).unwrap_or_default());
        }
        TacticalValue::Sum { collection, expression, .. } | TacticalValue::Min { collection, expression, .. } | TacticalValue::Max { collection, expression, .. }
        | TacticalValue::ArgMin { collection, expression, .. } | TacticalValue::ArgMax { collection, expression, .. } => {
            canonicalize_collection(collection); canonicalize_value(expression);
        }
        TacticalValue::Literal(_) | TacticalValue::Path(_) => {}
    }
}
fn canonicalize_collection(collection: &mut TacticalCollection) {
    if let TacticalCollection::Filter { collection, predicates, .. } = collection {
        canonicalize_collection(collection);
        for predicate in predicates.iter_mut() { canonicalize_predicate(predicate); }
        predicates.sort_by_key(|predicate| serde_json::to_vec(predicate).unwrap_or_default());
    }
}

fn sort_commutative_predicates(children: &mut [Predicate]) {
    children.sort_by_key(|value| serde_json::to_vec(value).unwrap_or_default());
}
fn normalize_predicate(p: &mut Predicate) {
    match p {
        Predicate::And(children) | Predicate::Or(children) => { for child in children.iter_mut() { normalize_predicate(child); } sort_commutative_predicates(children); }
        Predicate::OrderedAnd(children) | Predicate::OrderedOr(children) => for child in children { normalize_predicate(child); },
        Predicate::Not(child) => normalize_predicate(child),
        Predicate::Quantified { predicates, .. } => { for child in predicates.iter_mut() { normalize_predicate(child); } sort_commutative_predicates(predicates); }
        _ => {}
    }
}

pub(crate) fn required_cost_kinds(program: &TypedProgram) -> BTreeSet<CostKind> {
    let mut kinds = BTreeSet::new();
    for state in &program.states { collect_costs_predicate(&state.predicate, &mut kinds); }
    for action in &program.actions { collect_costs_predicate(&action.when, &mut kinds); for value in &action.arguments { collect_costs_value(value, &mut kinds); } }
    kinds
}
fn collect_costs_predicate(p: &Predicate, out: &mut BTreeSet<CostKind>) {
    match p {
        Predicate::State(_) => { out.insert(CostKind::StateReference); }
        Predicate::Compare { left, right, .. } => { out.insert(CostKind::Compare); collect_costs_value(left, out); collect_costs_value(right, out); }
        Predicate::Knownness { value, .. } => { out.insert(CostKind::Knownness); collect_costs_value(value, out); }
        Predicate::And(v) | Predicate::Or(v) | Predicate::OrderedAnd(v) | Predicate::OrderedOr(v) => { out.insert(CostKind::Logic); for p in v { collect_costs_predicate(p, out); } }
        Predicate::Not(v) => { out.insert(CostKind::Logic); collect_costs_predicate(v, out); }
        Predicate::Quantified { collection, predicates, .. } => {
            out.insert(CostKind::CollectionIteration);
            if predicates.len() > 1 { out.insert(CostKind::Logic); }
            collect_costs_collection(collection, out);
            for p in predicates { collect_costs_predicate(p, out); }
        }
        Predicate::Truth(_) => {}
    }
}
fn collect_costs_value(v: &Value, out: &mut BTreeSet<CostKind>) {
    match v {
        Value::FilteredCollection { collection, predicates, .. } => {
            out.insert(CostKind::CollectionIteration);
            if predicates.len() > 1 { out.insert(CostKind::Logic); }
            collect_costs_collection(collection, out);
            for predicate in predicates { collect_costs_predicate(predicate, out); }
        }
        Value::Path(_) => { out.insert(CostKind::PathRead); }
        Value::State(_) => { out.insert(CostKind::StateReference); }
        Value::Count { collection, predicates, .. } => {
            out.insert(CostKind::CollectionIteration);
            out.insert(CostKind::Aggregate);
            if predicates.len() > 1 { out.insert(CostKind::Logic); }
            collect_costs_collection(collection, out);
            for p in predicates { collect_costs_predicate(p, out); }
        }
        Value::Sum { collection, expression, .. } | Value::Min { collection, expression, .. } | Value::Max { collection, expression, .. } => {
            out.insert(CostKind::CollectionIteration); out.insert(CostKind::Aggregate); collect_costs_collection(collection, out); collect_costs_value(expression, out);
            if matches!(v, Value::Sum { .. }) { out.insert(CostKind::Arithmetic); }
        }
        Value::ArgMin { collection, expression, unique_key, .. } | Value::ArgMax { collection, expression, unique_key, .. } => {
            out.insert(CostKind::CollectionIteration); out.insert(CostKind::Aggregate); out.insert(CostKind::Compare);
            collect_costs_collection(collection, out); collect_costs_value(expression, out); let _ = unique_key; out.insert(CostKind::PathRead);
        }
        Value::Literal { .. } => {}
    }
}
fn collect_costs_collection(c: &Collection, out: &mut BTreeSet<CostKind>) {
    match c {
        Collection::Path { .. } => {}
        Collection::Filter { collection, predicates, .. } => {
            out.insert(CostKind::CollectionIteration);
            if predicates.len() > 1 { out.insert(CostKind::Logic); }
            collect_costs_collection(collection, out);
            for p in predicates { collect_costs_predicate(p, out); }
        }
    }
}

pub(crate) fn estimate(program: &TypedProgram, costs: &BTreeMap<CostKind, bytecode::CostQuote>, plan: &RulePlan) -> u64 {
    struct Estimate<'a> {
        costs: &'a BTreeMap<CostKind, bytecode::CostQuote>,
        states: BTreeMap<senkei_model::StateId, &'a Predicate>,
        state_refs: BTreeSet<senkei_model::StateId>,
        state_evaluated: BTreeSet<senkei_model::StateId>,
    }
    impl Estimate<'_> {
        fn charge(&self, kind: CostKind, items: u64) -> u128 {
            self.costs.get(&kind).map(|q| {
                (q.amount.base as u128 + q.amount.per_item as u128 * items as u128).min(u64::MAX as u128)
            }).unwrap_or(0)
        }
        fn charge_repeated(&self, kind: CostKind, units: u64) -> u128 {
            self.costs.get(&kind).map(|q| {
                ((q.amount.base as u128 + q.amount.per_item as u128) * units as u128).min(u64::MAX as u128)
            }).unwrap_or(0)
        }
        fn predicate(&mut self, predicate: &Predicate) -> u128 {
            match predicate {
                Predicate::Truth(_) => 0,
                Predicate::State(id) => {
                    let mut total = 0;
                    if self.state_refs.insert(id.clone()) { total += self.charge(CostKind::StateReference, 1); }
                    if self.state_evaluated.insert(id.clone()) {
                        if let Some(predicate) = self.states.get(id).copied() { total += self.predicate(predicate); }
                    }
                    total
                }
                Predicate::Compare { left, right, .. } => {
                    let units = comparison_units_bound(value_type(left))
                        .max(comparison_units_bound(value_type(right)))
                        .min(u64::MAX as u128) as u64;
                    self.charge_repeated(CostKind::Compare, units) + self.value(left) + self.value(right)
                }
                Predicate::Knownness { value, .. } => self.charge(CostKind::Knownness, 1) + self.value(value),
                Predicate::And(children) | Predicate::Or(children) | Predicate::OrderedAnd(children) | Predicate::OrderedOr(children) => {
                    self.charge(CostKind::Logic, children.len() as u64) + children.iter().map(|p| self.predicate(p)).sum::<u128>()
                }
                Predicate::Not(child) => self.charge(CostKind::Logic, 1) + self.predicate(child),
                Predicate::Quantified { collection, predicates, .. } => {
                    self.collection(collection) + self.charge(CostKind::CollectionIteration, 1)
                        + if predicates.len() > 1 { self.charge(CostKind::Logic, predicates.len() as u64) } else { 0 }
                        + predicates.iter().map(|p| self.predicate(p)).sum::<u128>()
                }
            }
        }
        fn value(&mut self, value: &Value) -> u128 {
            match value {
                Value::Path(_) => self.charge(CostKind::PathRead, 1),
                Value::State(id) => {
                    let mut total = 0;
                    if self.state_refs.insert(id.clone()) { total += self.charge(CostKind::StateReference, 1); }
                    if self.state_evaluated.insert(id.clone()) {
                        if let Some(predicate) = self.states.get(id).copied() { total += self.predicate(predicate); }
                    }
                    total
                }
                Value::Literal { .. } => 0,
                Value::FilteredCollection { collection, predicates, .. } => self.collection(collection)
                    + self.charge(CostKind::CollectionIteration, 1)
                    + if predicates.len() > 1 { self.charge(CostKind::Logic, predicates.len() as u64) } else { 0 }
                    + predicates.iter().map(|p| self.predicate(p)).sum::<u128>(),
                Value::Count { collection, predicates, .. } => self.collection(collection) + self.charge(CostKind::CollectionIteration, 1)
                    + self.charge(CostKind::Aggregate, 1)
                    + if predicates.len() > 1 { self.charge(CostKind::Logic, predicates.len() as u64) } else { 0 }
                    + predicates.iter().map(|p| self.predicate(p)).sum::<u128>(),
                Value::Sum { collection, expression, .. } => self.collection(collection) + self.charge(CostKind::CollectionIteration, 1)
                    + self.charge(CostKind::Aggregate, 1) + self.charge(CostKind::Arithmetic, 1) + self.value(expression),
                Value::Min { collection, expression, .. } | Value::Max { collection, expression, .. } => self.collection(collection)
                    + self.charge(CostKind::CollectionIteration, 1) + self.charge(CostKind::Aggregate, 1) + self.value(expression),
                Value::ArgMin { collection, expression, .. } | Value::ArgMax { collection, expression, .. } => self.collection(collection)
                    + self.charge(CostKind::CollectionIteration, 1) + self.charge(CostKind::Aggregate, 1) + self.charge(CostKind::Compare, 1)
                    + self.value(expression) + self.charge(CostKind::PathRead, 1),
            }
        }
        fn collection(&mut self, collection: &Collection) -> u128 {
            match collection {
                Collection::Path { .. } => 0,
                Collection::Filter { collection, predicates, .. } => self.collection(collection)
                    + self.charge(CostKind::CollectionIteration, 1)
                    + if predicates.len() > 1 { self.charge(CostKind::Logic, predicates.len() as u64) } else { 0 }
                    + predicates.iter().map(|p| self.predicate(p)).sum::<u128>(),
            }
        }
    }
    // One item per collection is the stable compiler estimate. The VM bills
    // the actual package-bounded count, and unreachable states remain free.
    let states = program.states.iter().map(|state| (state.id.clone(), &state.predicate)).collect();
    let mut estimator = Estimate { costs, states, state_refs: BTreeSet::new(), state_evaluated: BTreeSet::new() };
    let mut total = 0u128;
    for action in &program.actions {
        total += estimator.predicate(&action.when);
        total += action.arguments.iter().map(|value| estimator.value(value)).sum::<u128>();
        if let Some(schema) = plan.domain.capabilities.get(&action.capability) {
            if let Some(cost) = plan.cost_schedule.operations.get(&schema.issue_cost) {
                total += cost.base as u128 + cost.per_item as u128;
            }
        }
    }
    total.min(u64::MAX as u128) as u64
}
