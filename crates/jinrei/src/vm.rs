use crate::{
    bytecode::{self, CostKind, CostedProgram},
    compiler::{self},
    types::{Collection, Predicate, TypedPath, Value},
    BYTECODE_VERSION, LANGUAGE_VERSION, MAX_RUNTIME_COLLECTION_ITEMS, TYPED_IR_VERSION,
};
use senkei_model::{
    ApiErrorCode, CostOperationId, DomainType, DomainValue, EntityId, EntityObservation, ExecutionBudget,
    CollectionSource, EntityOwnerSelector, FieldId, Intent, LogicalCu, Observed, RulePlan,
    StateId, TacticalDiagnostic, TacticalExecutionError, TacticalExecutionStatus, TargetOwnerConstraint,
    TacticalExecutionOutput, TacticalExecutionPort, TacticalExecutionRequest,
    TacticalMemory, TacticalProgram, Truth, VerifiedRulePlan,
};
use std::collections::{BTreeMap, BTreeSet};

const MAX_EVALUATIONS: u64 = 1_000_000;
const MAX_TRACE_EVENTS: usize = 1_000_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct VmOptions {
    /// Physical optimization switch. Logical operations, CU, intents, and trace
    /// are invariant under this setting.
    pub optimize: bool,
}

/// Rust interpreter for Jinrei's verified dedicated bytecode.
pub struct Vm {
    plan: RulePlan,
    ruleset: senkei_model::RulesetRef,
    options: VmOptions,
}

impl Vm {
    pub fn new(rules: &VerifiedRulePlan) -> Self { Self::with_options(rules, VmOptions::default()) }
    pub fn with_options(rules: &VerifiedRulePlan, options: VmOptions) -> Self {
        Self { plan: rules.plan().clone(), ruleset: rules.ruleset().clone(), options }
    }
    pub fn set_optimization_enabled(&mut self, enabled: bool) { self.options.optimize = enabled; }
    pub fn optimization_enabled(&self) -> bool { self.options.optimize }

    fn execute_request(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
        self.verify_program(request.program)?;
        self.validate_request(&request)?;
        let module = bytecode::decode(&request.program.bytecode).map_err(|err| runtime_error(err.code, err.message))?;
        let mut eval = Eval::new(&self.plan, &module, request.observation, request.budget);
        let mut intents = Vec::new();
        for action in &module.typed.actions {
            let condition = eval.eval_predicate(&action.when, &mut BTreeMap::new())?;
            if condition == Truth::Unknown {
                eval.notice("when_unknown", [("action".to_owned(), action.id.to_string())].into())?;
                continue;
            }
            if condition != Truth::True { continue; }
            if !request.allowed_capabilities.contains(&action.capability) {
                eval.notice("capability_not_allowed", [("action".to_owned(), action.id.to_string()), ("capability".to_owned(), action.capability.to_string())].into())?;
                continue;
            }
            let capability = self.plan.domain.capabilities.get(&action.capability)
                .ok_or_else(|| runtime_error(ApiErrorCode::InvalidProgram, "bytecode refers to an unknown capability"))?;
            let mut values = Vec::with_capacity(action.arguments.len());
            let mut unresolved = false;
            for (index, argument) in action.arguments.iter().enumerate() {
                match eval.eval_value(argument, &mut BTreeMap::new())? {
                    RuntimeValue::Known(DomainValue::Null) if capability.arguments.get(index).is_some_and(|parameter| !matches!(parameter.value_type, DomainType::Optional(_))) => {
                        unresolved = true; values.push(DomainValue::Null);
                    }
                    RuntimeValue::Known(value) => values.push(value),
                    RuntimeValue::Truth(Truth::True) => values.push(DomainValue::Bool(true)),
                    RuntimeValue::Truth(Truth::False) => values.push(DomainValue::Bool(false)),
                    RuntimeValue::Truth(Truth::Unknown) | RuntimeValue::Unknown => { unresolved = true; values.push(DomainValue::Null); }
                }
            }
            if unresolved {
                eval.notice("unknown_capability_argument", [("action".to_owned(), action.id.to_string())].into())?;
                continue;
            }
            let actor = action.actor_argument.and_then(|index| values.get(index)).and_then(entity_id_argument);
            if action.actor_argument.is_some() && actor.is_none() {
                eval.notice("unknown_capability_actor", [("action".to_owned(), action.id.to_string())].into())?;
                continue;
            }
            if actor.as_ref().is_some_and(|id| !entity_owner_matches(&self.plan, request.observation, id, request.side, TargetOwnerConstraint::OwnSide)) {
                eval.notice("capability_actor_not_owned", [("action".to_owned(), action.id.to_string())].into())?;
                continue;
            }
            let target = action.target_argument.and_then(|index| values.get(index)).and_then(entity_id_argument);
            if action.target_argument.is_some() && target.is_none() {
                eval.notice("unknown_capability_target", [("action".to_owned(), action.id.to_string())].into())?;
                continue;
            }
            if target.as_ref().is_some_and(|id| !entity_owner_matches(&self.plan, request.observation, id, request.side, action.target_owner)) {
                eval.notice("capability_target_owner_mismatch", [("action".to_owned(), action.id.to_string())].into())?;
                continue;
            }
            eval.charge_named(&capability.issue_cost, 1)?;
            let intent = Intent {
                action_id: action.id.clone(),
                capability: action.capability.clone(),
                actor,
                target,
                arguments: values,
                priority: None,
            };
            eval.trace(TacticalDiagnostic::IntentProposed { intent: intent.clone() })?;
            intents.push(intent);
        }
        if intents.len() > request.budget.max_intents as usize {
            return Err(runtime_error(ApiErrorCode::BudgetExceeded, "intent budget exceeded"));
        }
        let over_budget = eval.required > request.budget.available_cu.0;
        if over_budget {
            intents.clear();
            eval.diagnostics.retain(|event| !matches!(event, TacticalDiagnostic::IntentProposed { .. }));
        }
        let status = if over_budget { TacticalExecutionStatus::BudgetExceeded } else { TacticalExecutionStatus::Completed };
        let charged_cu = LogicalCu(eval.charged);
        let required_cu = LogicalCu(eval.required);
        let diagnostics = eval.diagnostics;
        if diagnostics.len() as u64 > self.plan.limits.max_diagnostic_events {
            return Err(runtime_error(ApiErrorCode::ResourceLimit, "tactical diagnostic trace exceeds the verified RulePlan event limit"));
        }
        let output_bytes = serde_json::to_vec(&(status, &intents, request.memory, charged_cu, required_cu, &diagnostics))
            .map_err(|_| runtime_error(ApiErrorCode::InternalError, "tactical output could not be serialized"))?;
        if output_bytes.len() as u64 > self.plan.limits.max_output_bytes {
            return Err(runtime_error(ApiErrorCode::ResourceLimit, "tactical output exceeds the verified RulePlan byte limit"));
        }
        Ok(TacticalExecutionOutput {
            status,
            intents,
            // v0.1 state declarations are pure derived predicates, not memory
            // assignments. Preserve the supplied memory exactly.
            next_memory: request.memory.clone(),
            charged_cu,
            required_cu,
            diagnostics,
        })
    }

    fn verify_program(&self, program: &TacticalProgram) -> Result<(), TacticalExecutionError> {
        if program.language_version != self.plan.jinrei_language_version || program.language_version != LANGUAGE_VERSION
            || program.ir_version != self.plan.typed_ir_version || program.ir_version != TYPED_IR_VERSION
            || program.bytecode_version != self.plan.bytecode_version || program.bytecode_version != BYTECODE_VERSION
            || program.cost_schedule_id != self.plan.cost_schedule.id || program.cost_schedule_version != self.plan.cost_schedule.version
            || program.ruleset != self.ruleset {
            return Err(runtime_error(ApiErrorCode::IncompatibleVersion, "tactical program does not match this verified RulePlan"));
        }
        if program.bytecode.len() > crate::MAX_BYTECODE_BYTES {
            return Err(runtime_error(ApiErrorCode::ResourceLimit, "tactical program exceeds the bytecode size limit"));
        }
        if !program.content_digest.has_sha256_shape() || program.content_digest.as_str() != bytecode::digest(&program.bytecode) {
            return Err(runtime_error(ApiErrorCode::InvalidProgram, "tactical program bytecode digest mismatch"));
        }
        let module = bytecode::decode(&program.bytecode).map_err(|err| runtime_error(err.code, err.message))?;
        if !bytecode::verify_cost_schedule(&module, &self.plan.cost_schedule) {
            return Err(runtime_error(ApiErrorCode::InvalidProgram, "bytecode cost table does not match the RulePlan"));
        }
        let expected_costs = bytecode::required_costs(&self.plan.cost_schedule, &compiler::required_cost_kinds(&module.typed))
            .map_err(|err| runtime_error(err.code, err.message))?;
        if expected_costs != module.costs {
            return Err(runtime_error(ApiErrorCode::InvalidProgram, "bytecode omits or changes a required cost operation"));
        }
        let verified_typed = compiler::verify_bytecode_ast(&module.source_ast, &self.plan)
            .map_err(|err| runtime_error(err.code, err.message))?;
        if verified_typed != module.typed {
            return Err(runtime_error(ApiErrorCode::InvalidProgram, "bytecode IR does not match its verified source AST"));
        }
        if module.static_estimate != compiler::estimate(&module.typed, &module.costs, &self.plan) {
            return Err(runtime_error(ApiErrorCode::InvalidProgram, "bytecode CU estimate is inconsistent"));
        }
        Ok(())
    }

    fn validate_request(&self, request: &TacticalExecutionRequest<'_>) -> Result<(), TacticalExecutionError> {
        if request.side != request.observation.side || request.tick != request.observation.tick {
            return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "execution tick or side does not match the observation snapshot"));
        }
        if request.budget.available_cu.0 > self.plan.cost_schedule.per_tick_budget.0
            || request.budget.available_cu.0 > LogicalCu::MAX_SAFE_JSON_INTEGER
            || request.budget.max_intents > self.plan.limits.max_intents_per_side_per_tick {
            return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "execution budget exceeds verified RulePlan limits"));
        }
        for capability in request.allowed_capabilities {
            if !self.plan.domain.capabilities.contains_key(capability) {
                return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "allowed capability set contains an unknown capability"));
            }
        }
        validate_observation(&self.plan, request.observation)?;
        validate_memory(&self.plan, request.memory)?;
        let request_bytes = serde_json::to_vec(&(request.observation, request.memory, request.allowed_capabilities, request.budget))
            .map_err(|_| runtime_error(ApiErrorCode::InvalidSnapshot, "execution request cannot be serialized within the host contract"))?;
        if request_bytes.len() as u64 > self.plan.limits.max_input_bytes {
            return Err(runtime_error(ApiErrorCode::ResourceLimit, "execution request exceeds the verified input byte limit"));
        }
        Ok(())
    }
}

impl TacticalExecutionPort for Vm {
    fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
        self.execute_request(request)
    }
}

/// Verify the program's bytecode digest without exposing bytecode semantics to
/// the shared model or Enbu.
pub fn verify_program_digest(program: &TacticalProgram) -> bool {
    program.content_digest.has_sha256_shape() && program.content_digest.as_str() == bytecode::digest(&program.bytecode)
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum RuntimeValue { Known(DomainValue), Unknown, Truth(Truth) }

struct Eval<'a> {
    plan: &'a RulePlan,
    module: &'a CostedProgram,
    observation: &'a senkei_model::ObservationSnapshot,
    budget: ExecutionBudget,
    charged: u64,
    required: u64,
    evaluations: u64,
    diagnostics: Vec<TacticalDiagnostic>,
    state_cache: BTreeMap<StateId, Truth>,
    evaluating_states: BTreeSet<StateId>,
    state_ref_charged: BTreeSet<StateId>,
}

impl<'a> Eval<'a> {
    fn new(plan: &'a RulePlan, module: &'a CostedProgram, observation: &'a senkei_model::ObservationSnapshot,
        budget: ExecutionBudget) -> Self {
        Self { plan, module, observation, budget, charged: 0, required: 0, evaluations: 0,
            diagnostics: Vec::new(), state_cache: BTreeMap::new(), evaluating_states: BTreeSet::new(), state_ref_charged: BTreeSet::new() }
    }

    fn eval_predicate(&mut self, predicate: &Predicate, bindings: &mut BTreeMap<String, EntityObservation>) -> Result<Truth, TacticalExecutionError> {
        self.step()?;
        Ok(match predicate {
            Predicate::Truth(value) => *value,
            Predicate::State(id) => {
                if self.state_ref_charged.insert(id.clone()) { self.charge_kind(CostKind::StateReference, 1)?; }
                self.eval_state(id)?
            }
            Predicate::Compare { left, operator, right } => {
                let left = self.eval_value(left, bindings)?;
                let right = self.eval_value(right, bindings)?;
                self.charge_repeated_kind(CostKind::Compare, comparison_units(&left, &right))?;
                compare_runtime(left, right, *operator)?
            }
            Predicate::Knownness { value, test } => {
                let value = self.eval_value(value, bindings)?;
                self.charge_kind(CostKind::Knownness, 1)?;
                let known = !matches!(value, RuntimeValue::Unknown | RuntimeValue::Truth(Truth::Unknown));
                let pass = match test { senkei_model::KnownnessTest::Known => known, senkei_model::KnownnessTest::Unknown => !known };
                if pass { Truth::True } else { Truth::False }
            }
            Predicate::And(children) => self.eval_logic(children, true, false, bindings)?,
            Predicate::Or(children) => self.eval_logic(children, false, false, bindings)?,
            Predicate::OrderedAnd(children) => self.eval_logic(children, true, true, bindings)?,
            Predicate::OrderedOr(children) => self.eval_logic(children, false, true, bindings)?,
            Predicate::Not(child) => { self.charge_kind(CostKind::Logic, 1)?; negate(self.eval_predicate(child, bindings)?) }
            Predicate::Quantified { quantifier, binding, collection, predicates } => {
                let members = self.eval_collection(collection, bindings)?;
                match members {
                    None => Truth::Unknown,
                    Some(members) => {
                        self.charge_base(CostKind::CollectionIteration)?;
                        let is_any = *quantifier == senkei_model::Quantifier::Any;
                        let mut aggregate = if is_any { Truth::False } else { Truth::True };
                        for member in members {
                            self.charge_item(CostKind::CollectionIteration)?;
                            bindings.insert(binding.clone(), member);
                            let result = self.eval_implicit_and(predicates, bindings)?;
                            bindings.remove(binding);
                            aggregate = if is_any { or3(aggregate, result) } else { and3(aggregate, result) };
                            // Ordinary any/all are deliberately eager. No
                            // logical short circuit is allowed here.
                        }
                        aggregate
                    }
                }
            }
        })
    }

    fn eval_logic(&mut self, children: &[Predicate], is_and: bool, ordered: bool, bindings: &mut BTreeMap<String, EntityObservation>) -> Result<Truth, TacticalExecutionError> {
        self.charge_base(CostKind::Logic)?;
        let mut result = if is_and { Truth::True } else { Truth::False };
        for child in children {
            self.charge_item(CostKind::Logic)?;
            let next = self.eval_predicate(child, bindings)?;
            result = if is_and { and3(result, next) } else { or3(result, next) };
            if ordered && ((is_and && result == Truth::False) || (!is_and && result == Truth::True)) { break; }
        }
        Ok(result)
    }

    fn eval_implicit_and(&mut self, children: &[Predicate], bindings: &mut BTreeMap<String, EntityObservation>) -> Result<Truth, TacticalExecutionError> {
        if children.len() == 1 { return self.eval_predicate(&children[0], bindings); }
        self.eval_logic(children, true, false, bindings)
    }

    fn eval_state(&mut self, id: &StateId) -> Result<Truth, TacticalExecutionError> {
        if let Some(value) = self.state_cache.get(id) { return Ok(*value); }
        if !self.evaluating_states.insert(id.clone()) { return Err(runtime_error(ApiErrorCode::InvalidProgram, "cyclic state reference detected in bytecode")); }
        let state = self.module.typed.states.iter().find(|state| &state.id == id)
            .ok_or_else(|| runtime_error(ApiErrorCode::InvalidProgram, "bytecode refers to an undeclared state"))?;
        let value = self.eval_predicate(&state.predicate, &mut BTreeMap::new())?;
        self.evaluating_states.remove(id);
        self.state_cache.insert(id.clone(), value);
        self.trace(TacticalDiagnostic::StateEvaluated { state: id.clone(), result: value })?;
        Ok(value)
    }

    fn eval_value(&mut self, value: &Value, bindings: &mut BTreeMap<String, EntityObservation>) -> Result<RuntimeValue, TacticalExecutionError> {
        self.step()?;
        match value {
            Value::Literal { value, .. } => Ok(RuntimeValue::Known(value.clone())),
            Value::FilteredCollection { binding, collection, predicates, .. } => {
                let filtered = Collection::Filter { binding: binding.clone(), collection: Box::new(collection.clone()),
                    predicates: predicates.clone(), element_type: collection.element_type().clone() };
                match self.eval_collection(&filtered, bindings)? {
                    None => Ok(RuntimeValue::Unknown),
                    Some(items) => Ok(RuntimeValue::Known(DomainValue::List(items.into_iter().map(|item| DomainValue::Entity(item.id)).collect()))),
                }
            }
            Value::Path(path) => self.eval_path(path, bindings),
            Value::State(id) => {
                if self.state_ref_charged.insert(id.clone()) { self.charge_kind(CostKind::StateReference, 1)?; }
                Ok(RuntimeValue::Truth(self.eval_state(id)?))
            }
            Value::Count { binding, collection, predicates } => {
                let members = match self.eval_collection(collection, bindings)? { Some(members) => members, None => return Ok(RuntimeValue::Unknown) };
                self.charge_base(CostKind::Aggregate)?;
                self.charge_base(CostKind::CollectionIteration)?;
                let mut count = 0i64;
                let mut unknown = false;
                for member in members {
                    self.charge_item(CostKind::CollectionIteration)?;
                    self.charge_item(CostKind::Aggregate)?;
                    bindings.insert(binding.clone(), member);
                    let result = self.eval_implicit_and(predicates, bindings)?;
                    bindings.remove(binding);
                    match result { Truth::True => count = count.checked_add(1).ok_or_else(|| runtime_error(ApiErrorCode::RuntimeFailure, "count overflow"))?, Truth::False => {}, Truth::Unknown => unknown = true }
                }
                if unknown { return Ok(RuntimeValue::Unknown); }
                Ok(RuntimeValue::Known(DomainValue::Integer(count)))
            }
            Value::Sum { binding, collection, expression, value_type } => self.eval_numeric_aggregate(binding, collection, expression, value_type, AggregateOp::Sum, bindings),
            Value::Min { binding, collection, expression, value_type } => self.eval_numeric_aggregate(binding, collection, expression, value_type, AggregateOp::Min, bindings),
            Value::Max { binding, collection, expression, value_type } => self.eval_numeric_aggregate(binding, collection, expression, value_type, AggregateOp::Max, bindings),
            Value::ArgMin { binding, collection, expression, unique_key, .. } => self.eval_arg_aggregate(binding, collection, expression, unique_key, true, bindings),
            Value::ArgMax { binding, collection, expression, unique_key, .. } => self.eval_arg_aggregate(binding, collection, expression, unique_key, false, bindings),
        }
    }

    fn eval_numeric_aggregate(&mut self, binding: &str, collection: &Collection, expression: &Value, value_type: &DomainType, op: AggregateOp,
        bindings: &mut BTreeMap<String, EntityObservation>) -> Result<RuntimeValue, TacticalExecutionError> {
        let members = match self.eval_collection(collection, bindings)? { Some(members) => members, None => return Ok(RuntimeValue::Unknown) };
        self.charge_base(CostKind::Aggregate)?;
        self.charge_base(CostKind::CollectionIteration)?;
        if op == AggregateOp::Sum { self.charge_base(CostKind::Arithmetic)?; }
        let mut values = Vec::with_capacity(members.len());
        let mut unknown = false;
        for member in members {
            self.charge_item(CostKind::CollectionIteration)?;
            self.charge_item(CostKind::Aggregate)?;
            if op == AggregateOp::Sum { self.charge_item(CostKind::Arithmetic)?; }
            bindings.insert(binding.to_owned(), member);
            let value = self.eval_value(expression, bindings)?;
            bindings.remove(binding);
            match value { RuntimeValue::Known(value) => values.push(value), _ => unknown = true }
        }
        if unknown { return Ok(RuntimeValue::Unknown); }
        if op == AggregateOp::Sum && values.is_empty() {
            return Ok(RuntimeValue::Known(match value_type { DomainType::Integer { .. } => DomainValue::Integer(0), DomainType::Fixed { scale, .. } => DomainValue::Fixed { coefficient: 0, scale: *scale }, _ => return Err(runtime_error(ApiErrorCode::InvalidProgram, "invalid aggregate result type")) }));
        }
        if values.is_empty() { return Ok(RuntimeValue::Known(DomainValue::Null)); }
        let selected = match op {
            AggregateOp::Sum => {
                let mut total = 0i128;
                for value in &values { total = total.checked_add(numeric_coefficient(value).ok_or_else(|| runtime_error(ApiErrorCode::InvalidProgram, "non-numeric aggregate value"))?).ok_or_else(|| runtime_error(ApiErrorCode::RuntimeFailure, "sum overflow"))?; }
                let coefficient = i64::try_from(total).map_err(|_| runtime_error(ApiErrorCode::RuntimeFailure, "sum exceeds fixed integer range"))?;
                let result = match value_type { DomainType::Integer { .. } => DomainValue::Integer(coefficient), DomainType::Fixed { scale, .. } => DomainValue::Fixed { coefficient, scale: *scale }, _ => return Err(runtime_error(ApiErrorCode::InvalidProgram, "invalid sum type")) };
                if !domain_value_matches(&result, value_type) { return Err(runtime_error(ApiErrorCode::RuntimeFailure, "sum result is outside the declared numeric range")); }
                return Ok(RuntimeValue::Known(result));
            }
            AggregateOp::Min => values.into_iter().min_by(|a,b| compare_numeric(a,b).unwrap_or(std::cmp::Ordering::Equal)),
            AggregateOp::Max => values.into_iter().max_by(|a,b| compare_numeric(a,b).unwrap_or(std::cmp::Ordering::Equal)),
        }.ok_or_else(|| runtime_error(ApiErrorCode::InternalError, "aggregate unexpectedly had no value"))?;
        Ok(RuntimeValue::Known(selected))
    }

    fn eval_arg_aggregate(&mut self, binding: &str, collection: &Collection, expression: &Value, unique_key: &TypedPath, minimum: bool,
        bindings: &mut BTreeMap<String, EntityObservation>) -> Result<RuntimeValue, TacticalExecutionError> {
        let members = match self.eval_collection(collection, bindings)? { Some(members) => members, None => return Ok(RuntimeValue::Unknown) };
        self.charge_base(CostKind::Aggregate)?;
        self.charge_base(CostKind::CollectionIteration)?;
        self.charge_base(CostKind::Compare)?;
        let mut candidates: Vec<(DomainValue, DomainValue, EntityId)> = Vec::with_capacity(members.len());
        let mut unknown = false;
        for member in members {
            self.charge_item(CostKind::CollectionIteration)?;
            self.charge_item(CostKind::Aggregate)?;
            self.charge_item(CostKind::Compare)?;
            bindings.insert(binding.to_owned(), member.clone());
            let value = self.eval_value(expression, bindings)?;
            let key = self.eval_path(unique_key, bindings)?;
            bindings.remove(binding);
            let (RuntimeValue::Known(value), RuntimeValue::Known(key)) = (value, key) else { unknown = true; continue; };
            if !matches!(value, DomainValue::Integer(_) | DomainValue::Fixed { .. }) { return Err(runtime_error(ApiErrorCode::InvalidProgram, "arg selection value is not numeric")); }
            candidates.push((value, key, member.id));
        }
        if unknown { return Ok(RuntimeValue::Unknown); }
        if candidates.is_empty() { return Ok(RuntimeValue::Known(DomainValue::Null)); }
        let mut seen = BTreeSet::new();
        for (_, key, _) in &candidates { if !seen.insert(key.clone()) { return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "argmin/argmax tie-break key is not unique in the observed collection")); } }
        candidates.sort_by(|a,b| {
            let value_order = compare_numeric(&a.0, &b.0).unwrap_or(std::cmp::Ordering::Equal);
            let value_order = if minimum { value_order } else { value_order.reverse() };
            value_order.then_with(|| compare_domain_total(&a.1, &b.1)).then_with(|| a.2.cmp(&b.2))
        });
        Ok(RuntimeValue::Known(DomainValue::Entity(candidates[0].2.clone())))
    }

    fn eval_path(&mut self, path: &TypedPath, bindings: &BTreeMap<String, EntityObservation>) -> Result<RuntimeValue, TacticalExecutionError> {
        self.charge_kind(CostKind::PathRead, 1)?;
        Ok(match path {
            TypedPath::Observation { path, .. } => match self.observation.fields.get(path) {
                Some(Observed::Known(value)) => RuntimeValue::Known(value.clone()),
                Some(Observed::Unknown) | None => RuntimeValue::Unknown,
            },
            TypedPath::Binding { name, fields, synthetic_entity_id, .. } => {
                let Some(entity) = bindings.get(name) else { return Err(runtime_error(ApiErrorCode::InvalidProgram, "compiled binding is not in scope")); };
                if fields.is_empty() { RuntimeValue::Known(DomainValue::Entity(entity.id.clone())) }
                else if *synthetic_entity_id {
                    RuntimeValue::Known(DomainValue::Entity(entity.id.clone()))
                }
                else {
                    let first = match entity.fields.get(&fields[0]) {
                        Some(Observed::Known(value)) => value,
                        Some(Observed::Unknown) | None => return Ok(RuntimeValue::Unknown),
                    };
                    match follow_record_path(first, &fields[1..]) { Some(value) => RuntimeValue::Known(value.clone()), None => RuntimeValue::Unknown }
                }
            }
        })
    }

    fn eval_collection(&mut self, collection: &Collection, bindings: &mut BTreeMap<String, EntityObservation>) -> Result<Option<Vec<EntityObservation>>, TacticalExecutionError> {
        match collection {
            Collection::Path { id, .. } => {
                let Some(schema) = self.plan.domain.collections.get(id) else { return Err(runtime_error(ApiErrorCode::InvalidProgram, "bytecode references an unknown collection")); };
                match self.observation.collections.get(id) {
                    None | Some(Observed::Unknown) => Ok(None),
                    Some(Observed::Known(items)) => {
                        if items.len() > schema.max_items as usize || items.len() > self.plan.domain.max_collection_items as usize || items.len() > MAX_RUNTIME_COLLECTION_ITEMS {
                            return Err(runtime_error(ApiErrorCode::ResourceLimit, "observed collection exceeds its verified bound"));
                        }
                        let mut items = items.clone();
                        sort_collection(&mut items, &schema.order_by);
                        Ok(Some(items))
                    }
                }
            }
            Collection::Filter { binding, collection, predicates, .. } => {
                let Some(items) = self.eval_collection(collection, bindings)? else { return Ok(None); };
                self.charge_base(CostKind::CollectionIteration)?;
                let mut filtered = Vec::new();
                let mut unknown = false;
                for item in items {
                    self.charge_item(CostKind::CollectionIteration)?;
                    bindings.insert(binding.clone(), item.clone());
                    let result = self.eval_implicit_and(predicates, bindings)?;
                    bindings.remove(binding);
                    match result { Truth::True => filtered.push(item), Truth::False => {}, Truth::Unknown => unknown = true }
                }
                if unknown { Ok(None) } else { Ok(Some(filtered)) }
            }
        }
    }

    fn step(&mut self) -> Result<(), TacticalExecutionError> {
        self.evaluations += 1;
        if self.evaluations > MAX_EVALUATIONS { return Err(runtime_error(ApiErrorCode::ResourceLimit, "tactical evaluation exceeds the host evaluation limit")); }
        Ok(())
    }
    fn charge_kind(&mut self, kind: CostKind, units: u64) -> Result<(), TacticalExecutionError> {
        let quote = self.module.costs.get(&kind).ok_or_else(|| runtime_error(ApiErrorCode::InvalidProgram, "bytecode lacks a logical cost operation"))?;
        let amount = quote.amount.base.checked_add(quote.amount.per_item.checked_mul(units).ok_or_else(|| runtime_error(ApiErrorCode::ResourceLimit, "CU arithmetic overflow"))?)
            .ok_or_else(|| runtime_error(ApiErrorCode::ResourceLimit, "CU arithmetic overflow"))?;
        self.charge_amount(&quote.operation, amount)
    }
    fn charge_repeated_kind(&mut self, kind: CostKind, units: u64) -> Result<(), TacticalExecutionError> {
        let quote = self.module.costs.get(&kind).ok_or_else(|| runtime_error(ApiErrorCode::InvalidProgram, "bytecode lacks a logical cost operation"))?;
        let unit_amount = quote.amount.base.checked_add(quote.amount.per_item)
            .ok_or_else(|| runtime_error(ApiErrorCode::ResourceLimit, "CU arithmetic overflow"))?;
        let amount = unit_amount.checked_mul(units)
            .ok_or_else(|| runtime_error(ApiErrorCode::ResourceLimit, "CU arithmetic overflow"))?;
        self.charge_amount(&quote.operation, amount)
    }
    fn charge_base(&mut self, kind: CostKind) -> Result<(), TacticalExecutionError> {
        let quote = self.module.costs.get(&kind).ok_or_else(|| runtime_error(ApiErrorCode::InvalidProgram, "bytecode lacks a logical cost operation"))?;
        self.charge_amount(&quote.operation, quote.amount.base)
    }
    fn charge_item(&mut self, kind: CostKind) -> Result<(), TacticalExecutionError> {
        let quote = self.module.costs.get(&kind).ok_or_else(|| runtime_error(ApiErrorCode::InvalidProgram, "bytecode lacks a logical cost operation"))?;
        self.charge_amount(&quote.operation, quote.amount.per_item)
    }
    fn charge_named(&mut self, operation: &CostOperationId, items: u64) -> Result<(), TacticalExecutionError> {
        let quote = self.plan.cost_schedule.operations.get(operation).ok_or_else(|| runtime_error(ApiErrorCode::InvalidProgram, "capability cost operation is missing from the RulePlan"))?;
        let amount = quote.base.checked_add(quote.per_item.checked_mul(items).ok_or_else(|| runtime_error(ApiErrorCode::ResourceLimit, "CU arithmetic overflow"))?)
            .ok_or_else(|| runtime_error(ApiErrorCode::ResourceLimit, "CU arithmetic overflow"))?;
        self.charge_amount(operation, amount)
    }
    fn charge_amount(&mut self, operation: &CostOperationId, amount: u64) -> Result<(), TacticalExecutionError> {
        if amount > LogicalCu::MAX_SAFE_JSON_INTEGER { return Err(runtime_error(ApiErrorCode::ResourceLimit, "logical CU operation exceeds the safe JSON integer limit")); }
        self.required = self.required.checked_add(amount).ok_or_else(|| runtime_error(ApiErrorCode::ResourceLimit, "logical CU total overflow"))?;
        if self.required > LogicalCu::MAX_SAFE_JSON_INTEGER { return Err(runtime_error(ApiErrorCode::ResourceLimit, "logical CU total exceeds the safe JSON integer limit")); }
        let remaining = self.budget.available_cu.0.saturating_sub(self.charged);
        let billed = amount.min(remaining);
        self.charged += billed;
        if billed == 0 { return Ok(()); }
        self.trace(TacticalDiagnostic::CostCharged { operation: operation.clone(), amount: LogicalCu(billed) })
    }
    fn trace(&mut self, diagnostic: TacticalDiagnostic) -> Result<(), TacticalExecutionError> {
        if self.diagnostics.len() >= MAX_TRACE_EVENTS { return Err(runtime_error(ApiErrorCode::ResourceLimit, "tactical diagnostic trace exceeds the host limit")); }
        self.diagnostics.push(diagnostic);
        Ok(())
    }
    fn notice(&mut self, code: &str, details: BTreeMap<String, String>) -> Result<(), TacticalExecutionError> {
        self.trace(TacticalDiagnostic::RuntimeNotice { code: senkei_model::DiagnosticCode::new(code), details })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AggregateOp { Sum, Min, Max }

fn and3(left: Truth, right: Truth) -> Truth {
    match (left, right) { (Truth::False, _) | (_, Truth::False) => Truth::False, (Truth::True, Truth::True) => Truth::True, _ => Truth::Unknown }
}
fn or3(left: Truth, right: Truth) -> Truth {
    match (left, right) { (Truth::True, _) | (_, Truth::True) => Truth::True, (Truth::False, Truth::False) => Truth::False, _ => Truth::Unknown }
}
fn negate(value: Truth) -> Truth { match value { Truth::True => Truth::False, Truth::False => Truth::True, Truth::Unknown => Truth::Unknown } }

fn compare_runtime(left: RuntimeValue, right: RuntimeValue, operator: senkei_model::ComparisonOperator) -> Result<Truth, TacticalExecutionError> {
    use senkei_model::ComparisonOperator as Op;
    let (left, right) = match (left, right) {
        (RuntimeValue::Unknown, _) | (_, RuntimeValue::Unknown) | (RuntimeValue::Truth(Truth::Unknown), _) | (_, RuntimeValue::Truth(Truth::Unknown)) => return Ok(Truth::Unknown),
        (RuntimeValue::Truth(a), RuntimeValue::Truth(b)) => (DomainValue::Bool(a == Truth::True), DomainValue::Bool(b == Truth::True)),
        (RuntimeValue::Truth(a), RuntimeValue::Known(DomainValue::Bool(b))) => (DomainValue::Bool(a == Truth::True), DomainValue::Bool(b)),
        (RuntimeValue::Known(DomainValue::Bool(a)), RuntimeValue::Truth(b)) => (DomainValue::Bool(a), DomainValue::Bool(b == Truth::True)),
        (RuntimeValue::Known(a), RuntimeValue::Known(b)) => (a,b),
        _ => return Err(runtime_error(ApiErrorCode::InvalidProgram, "invalid comparison operands")),
    };
    let order = match (&left, &right) {
        (a,b) if a == b => std::cmp::Ordering::Equal,
        (DomainValue::Integer(a), DomainValue::Integer(b)) => a.cmp(b),
        (DomainValue::Fixed { coefficient:a, scale:sa }, DomainValue::Fixed { coefficient:b, scale:sb }) if sa == sb => a.cmp(b),
        (DomainValue::String(a), DomainValue::String(b)) => a.cmp(b),
        _ => match operator { Op::Equal => return Ok(Truth::False), Op::NotEqual => return Ok(Truth::True), _ => return Err(runtime_error(ApiErrorCode::InvalidProgram, "ordered comparison received incompatible values")) },
    };
    let pass = match operator { Op::Equal => order.is_eq(), Op::NotEqual => !order.is_eq(), Op::LessThan => order.is_lt(), Op::LessThanOrEqual => !order.is_gt(), Op::GreaterThan => order.is_gt(), Op::GreaterThanOrEqual => !order.is_lt() };
    Ok(if pass { Truth::True } else { Truth::False })
}

/// Charge for every element/field that a deep equality comparison can visit.
/// Use the larger known operand so unequal shapes and early host-level
/// inequality checks cannot make the logical work free. Unknown comparisons
/// do not traverse either value and still pay for the comparison operation.
fn comparison_units(left: &RuntimeValue, right: &RuntimeValue) -> u64 {
    let contained_work = match (left, right) {
        (RuntimeValue::Known(left), RuntimeValue::Known(right)) => {
            container_work(left).max(container_work(right))
        }
        _ => 0,
    };
    1u64.saturating_add(contained_work)
}

fn container_work(value: &DomainValue) -> u64 {
    match value {
        DomainValue::List(values) => values.iter().fold(values.len() as u64, |work, value| {
            work.saturating_add(container_work(value))
        }),
        DomainValue::Record(fields) => fields.values().fold(fields.len() as u64, |work, value| {
            work.saturating_add(container_work(value))
        }),
        _ => 0,
    }
}

fn numeric_coefficient(value: &DomainValue) -> Option<i128> { match value { DomainValue::Integer(v) => Some(*v as i128), DomainValue::Fixed { coefficient, .. } => Some(*coefficient as i128), _ => None } }
fn compare_numeric(left: &DomainValue, right: &DomainValue) -> Option<std::cmp::Ordering> {
    match (left,right) {
        (DomainValue::Integer(a), DomainValue::Integer(b)) => Some(a.cmp(b)),
        (DomainValue::Fixed { coefficient:a,scale:sa }, DomainValue::Fixed { coefficient:b,scale:sb }) if sa == sb => Some(a.cmp(b)),
        _ => None,
    }
}
fn compare_domain_total(left: &DomainValue, right: &DomainValue) -> std::cmp::Ordering {
    match (left,right) {
        (DomainValue::Null,DomainValue::Null) => std::cmp::Ordering::Equal,
        (DomainValue::Null,_) => std::cmp::Ordering::Less,
        (_,DomainValue::Null) => std::cmp::Ordering::Greater,
        (DomainValue::Bool(a),DomainValue::Bool(b)) => a.cmp(b),
        (DomainValue::Integer(a),DomainValue::Integer(b)) => a.cmp(b),
        (DomainValue::Fixed{coefficient:a,scale:sa},DomainValue::Fixed{coefficient:b,scale:sb}) => sa.cmp(sb).then_with(|| a.cmp(b)),
        (DomainValue::String(a),DomainValue::String(b)) => a.cmp(b),
        (DomainValue::Enum(a),DomainValue::Enum(b)) => a.cmp(b),
        (DomainValue::Entity(a),DomainValue::Entity(b)) => a.cmp(b),
        (a,b) => variant_rank(a).cmp(&variant_rank(b)),
    }
}
fn variant_rank(value: &DomainValue) -> u8 { match value { DomainValue::Null=>0,DomainValue::Bool(_)=>1,DomainValue::Integer(_)=>2,DomainValue::Fixed{..}=>3,DomainValue::String(_)=>4,DomainValue::Enum(_)=>5,DomainValue::Entity(_)=>6,DomainValue::List(_)=>7,DomainValue::Record(_)=>8 } }

fn follow_record_path<'a>(value: &'a DomainValue, fields: &[FieldId]) -> Option<&'a DomainValue> {
    let mut current = value;
    for field in fields {
        current = match current { DomainValue::Record(map) => map.get(field)?, _ => return None };
    }
    Some(current)
}
fn sort_collection(items: &mut [EntityObservation], order_by: &[FieldId]) {
    items.sort_by(|a,b| {
        for key in order_by {
            let order = compare_observed(&observation_key(a, key), &observation_key(b, key));
            if !order.is_eq() { return order; }
        }
        a.id.cmp(&b.id)
    });
}
fn observation_key(entity: &EntityObservation, path: &FieldId) -> Observed<DomainValue> {
    match entity.fields.get(path) {
        Some(Observed::Known(value)) => Observed::Known(value.clone()),
        Some(Observed::Unknown) | None => Observed::Unknown,
    }
}
fn compare_observed(left: &Observed<DomainValue>, right: &Observed<DomainValue>) -> std::cmp::Ordering {
    match (left, right) {
        (Observed::Known(a), Observed::Known(b)) => compare_domain_total(a,b),
        (Observed::Known(_), Observed::Unknown) => std::cmp::Ordering::Less,
        (Observed::Unknown, Observed::Known(_)) => std::cmp::Ordering::Greater,
        (Observed::Unknown, Observed::Unknown) => std::cmp::Ordering::Equal,
    }
}

fn entity_id_argument(value: &DomainValue) -> Option<EntityId> {
    match value { DomainValue::Entity(id) => Some(id.clone()), _ => None }
}

fn entity_owner_matches(plan: &RulePlan, observation: &senkei_model::ObservationSnapshot, id: &EntityId,
    side: senkei_model::CombatantSide, constraint: TargetOwnerConstraint) -> bool {
    if constraint == TargetOwnerConstraint::Any { return true; }
    plan.domain.collections.iter().any(|(collection_id, schema)| {
        let CollectionSource::WorldEntities { entity_types, owner, .. } = &schema.source;
        if !entity_types.contains(&schema.element_type) || !owner_selector_matches(*owner, side, constraint) { return false; }
        matches!(observation.collections.get(collection_id), Some(Observed::Known(items))
            if items.iter().any(|entity| entity.entity_type == schema.element_type && &entity.id == id))
    })
}

fn owner_selector_matches(selector: EntityOwnerSelector, side: senkei_model::CombatantSide,
    constraint: TargetOwnerConstraint) -> bool {
    use senkei_model::CombatantSide::{Attacker, Defender};
    match constraint {
        TargetOwnerConstraint::Any => true,
        TargetOwnerConstraint::OwnSide => selector == EntityOwnerSelector::OwnSide
            || matches!((side, selector), (Attacker, EntityOwnerSelector::Attacker) | (Defender, EntityOwnerSelector::Defender)),
        TargetOwnerConstraint::OtherSide => selector == EntityOwnerSelector::OtherSide
            || matches!((side, selector), (Attacker, EntityOwnerSelector::Defender) | (Defender, EntityOwnerSelector::Attacker)),
        TargetOwnerConstraint::Unowned => selector == EntityOwnerSelector::Unowned,
    }
}

fn validate_observation(plan: &RulePlan, observation: &senkei_model::ObservationSnapshot) -> Result<(), TacticalExecutionError> {
    if observation.fields.len() > plan.domain.observation_fields.len() || observation.collections.len() > plan.domain.collections.len() {
        return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "observation snapshot contains more paths or collections than the verified schema"));
    }
    for (path, value) in &observation.fields {
        let schema = plan.domain.observation_fields.get(path).ok_or_else(|| runtime_error(ApiErrorCode::InvalidSnapshot, "observation contains an undeclared path"))?;
        if schema.visibility == senkei_model::Visibility::Internal { return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "observation contains an internal-only path")); }
        if let Observed::Known(value) = value {
            if !domain_value_matches(value, &schema.value_type) { return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "observation value does not match its schema")); }
        }
    }
    let mut entity_ids = BTreeSet::new();
    for (id, value) in &observation.collections {
        let schema = plan.domain.collections.get(id).ok_or_else(|| runtime_error(ApiErrorCode::InvalidSnapshot, "observation contains an undeclared collection"))?;
        if schema.visibility == senkei_model::Visibility::Internal { return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "observation contains an internal-only collection")); }
        if let Observed::Known(items) = value {
            if items.len() > schema.max_items as usize || items.len() > plan.domain.max_collection_items as usize || items.len() > MAX_RUNTIME_COLLECTION_ITEMS {
                return Err(runtime_error(ApiErrorCode::ResourceLimit, "observation collection exceeds its schema bound"));
            }
            let CollectionSource::WorldEntities { entity_types, .. } = &schema.source;
            if !entity_types.contains(&schema.element_type) {
                return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "collection element type is not permitted by its source"));
            }
            let mut ids = BTreeSet::new();
            for entity in items {
                if entity.id.as_str().len() > 512 {
                    return Err(runtime_error(ApiErrorCode::ResourceLimit, "observed entity identifier exceeds the host limit"));
                }
                if entity.entity_type != schema.element_type || !ids.insert(entity.id.clone()) { return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "collection contains a duplicate entity or wrong element type")); }
                entity_ids.insert(entity.id.clone());
                if entity_ids.len() > plan.limits.max_entities as usize {
                    return Err(runtime_error(ApiErrorCode::ResourceLimit, "observation snapshot exceeds the verified entity limit"));
                }
                if entity.fields.len() > schema.visible_fields.len() {
                    return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "entity observation contains more fields than its schema"));
                }
                for (field, observed) in &entity.fields {
                    let field_schema = schema.visible_fields.get(field).ok_or_else(|| runtime_error(ApiErrorCode::InvalidSnapshot, "entity observation contains an undeclared field"))?;
                    if field_schema.visibility == senkei_model::Visibility::Internal { return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "entity observation contains an internal-only field")); }
                    if let Observed::Known(value) = observed {
                        if !domain_value_matches(value, &field_schema.value_type) { return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "entity observation field does not match its schema")); }
                    }
                }
            }
        }
    }
    Ok(())
}
fn validate_memory(plan: &RulePlan, memory: &TacticalMemory) -> Result<(), TacticalExecutionError> {
    if memory.len() > plan.domain.tactical_memory.len() {
        return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "tactical memory contains more keys than the verified schema"));
    }
    for (id, value) in memory {
        let ty = plan.domain.tactical_memory.get(id).ok_or_else(|| runtime_error(ApiErrorCode::InvalidSnapshot, "tactical memory contains an undeclared state"))?;
        if !domain_value_matches(value, ty) { return Err(runtime_error(ApiErrorCode::InvalidSnapshot, "tactical memory value does not match its schema")); }
    }
    Ok(())
}

fn domain_value_matches(value: &DomainValue, ty: &DomainType) -> bool {
    domain_value_matches_depth(value, ty, 0)
}

fn domain_value_matches_depth(value: &DomainValue, ty: &DomainType, depth: usize) -> bool {
    if depth > crate::MAX_AST_DEPTH { return false; }
    match (value, ty) {
        (DomainValue::Null, DomainType::Optional(_)) => true,
        (value, DomainType::Optional(inner)) => domain_value_matches_depth(value, inner, depth + 1),
        (DomainValue::Bool(_), DomainType::Bool) => true,
        (DomainValue::Integer(value), DomainType::Integer { min,max }) => min.map_or(true,|v| *value>=v) && max.map_or(true,|v| *value<=v),
        (DomainValue::Fixed { coefficient, scale }, DomainType::Fixed { scale: expected,min,max }) => scale==expected && min.map_or(true,|v| *coefficient>=v) && max.map_or(true,|v| *coefficient<=v),
        (DomainValue::String(value), DomainType::String { max_bytes }) => value.len()<=*max_bytes as usize,
        (DomainValue::Enum(value), DomainType::Enum { values,.. }) => values.contains(value),
        (DomainValue::Entity(_), DomainType::Entity { .. }) => true,
        (DomainValue::List(values), DomainType::List { element,max_items }) | (DomainValue::List(values), DomainType::Vector { element,max_items }) => values.len()<=*max_items as usize && values.iter().all(|v| domain_value_matches_depth(v,element,depth+1)),
        (DomainValue::List(rows), DomainType::Matrix { element,max_rows,max_columns }) => rows.len()<=*max_rows as usize && rows.iter().all(|row| matches!(row,DomainValue::List(cols) if cols.len()<=*max_columns as usize && cols.iter().all(|v|domain_value_matches_depth(v,element,depth+2)))),
        (DomainValue::Record(values), DomainType::Record { fields }) => values.len()==fields.len() && fields.iter().all(|(field,ty)| values.get(field).is_some_and(|v|domain_value_matches_depth(v,ty,depth+1))),
        _ => false,
    }
}

fn runtime_error(code: ApiErrorCode, message: impl Into<String>) -> TacticalExecutionError {
    TacticalExecutionError { code, message: message.into(), details: BTreeMap::new() }
}
