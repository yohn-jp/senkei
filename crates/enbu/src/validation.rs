use crate::{api_error, RulePlan};
use senkei_model::{
    ApiError, ApiErrorCode, CombatantSide, DomainType, DomainValue,
    Intent, LogicalCu, MatchContext, RulesetRef, SenkeiSnapshot, TacticalProgram,
    VerifiedRulePlan, Version, WorldState,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// Semantic version of this implementation. Input context versions are
/// compared to this value rather than trusted as a caller assertion.
pub const ENGINE_VERSION: Version = senkei_model::ENBU_ENGINE_VERSION;
pub const MODEL_VERSION: Version = Version::new(1, 0, 0);
pub const REPLAY_SCHEMA_VERSION: Version = Version::new(1, 0, 0);

pub(crate) fn validate_inputs(
    attacker: &SenkeiSnapshot,
    defender: &SenkeiSnapshot,
    rules: &VerifiedRulePlan,
    context: &MatchContext,
) -> Result<(), ApiError> {
    let plan = rules.plan();
    if rules.package_digest() != &rules.ruleset().digest || !rules.package_digest().has_sha256_shape() {
        return Err(invalid("verified rule plan has an invalid package digest"));
    }
    if plan.minimum_engine_version > ENGINE_VERSION {
        return Err(version_error("rules require a newer Enbu engine"));
    }
    if plan.model_version != MODEL_VERSION || context.schema_version != MODEL_VERSION {
        return Err(version_error("unsupported shared model version"));
    }
    if context.versions.model != plan.model_version {
        return Err(version_error("context model version does not match the rule plan"));
    }
    if context.versions.engine != ENGINE_VERSION {
        return Err(version_error("context engine version does not match this Enbu build"));
    }
    if context.versions.ruleset != rules.ruleset().version {
        return Err(version_error("context ruleset version does not match the verified plan"));
    }
    if context.versions.jinrei_language != plan.jinrei_language_version
        || context.versions.structured_ast != plan.structured_ast_version
        || context.versions.typed_ir != plan.typed_ir_version
        || context.versions.bytecode != plan.bytecode_version
    {
        return Err(version_error("context Jinrei versions do not match the rule plan"));
    }
    if context.versions.cost_schedule != plan.cost_schedule.version {
        return Err(version_error("context CU schedule version does not match the rule plan"));
    }
    if context.versions.replay_schema != REPLAY_SCHEMA_VERSION {
        return Err(version_error("unsupported presentation replay schema version"));
    }
    validate_ruleset_ref(&context.ruleset, rules.ruleset())?;
    validate_ruleset_ref(&attacker.ruleset, rules.ruleset())?;
    validate_ruleset_ref(&defender.ruleset, rules.ruleset())?;
    if attacker.schema_version != MODEL_VERSION || defender.schema_version != MODEL_VERSION {
        return Err(version_error("snapshot model schema version is unsupported"));
    }
    validate_program(&attacker.program, rules)?;
    validate_program(&defender.program, rules)?;

    if context.max_ticks == 0 || context.max_ticks > plan.termination.max_ticks {
        return Err(invalid("context maximum ticks must be positive and no greater than the rule maximum"));
    }
    validate_cu_limits(plan)?;
    validate_host_limits(context, plan)?;
    let input_bytes = serde_json::to_vec(&(attacker, defender, context))
        .map_err(|_| api_error(ApiErrorCode::InvalidSnapshot, "simulation input could not be measured"))?;
    if input_bytes.len() as u64 > context.host_limits.max_input_bytes {
        return Err(api_error(ApiErrorCode::ResourceLimit, "simulation input exceeds the host byte limit"));
    }
    if input_bytes.len() as u64 > LogicalCu::MAX_SAFE_JSON_INTEGER {
        return Err(api_error(ApiErrorCode::ResourceLimit, "simulation input exceeds the deterministic host size bound"));
    }
    if attacker.configuration.keys().any(|field| !plan.domain.senkei_configuration.contains_key(field))
        || defender.configuration.keys().any(|field| !plan.domain.senkei_configuration.contains_key(field))
    {
        return Err(api_error(ApiErrorCode::InvalidSnapshot, "snapshot configuration contains an unknown field"));
    }
    // These values may refer to deterministic entities created by the
    // RulePlan's configuration projection. Validate them after projection has
    // been applied to the base world in `simulate`.
    Ok(())
}

fn validate_ruleset_ref(actual: &RulesetRef, expected: &RulesetRef) -> Result<(), ApiError> {
    if actual != expected {
        return Err(api_error(ApiErrorCode::InvalidRuleset, "input ruleset identity, version, or digest does not match the verified rule plan"));
    }
    if !actual.digest.has_sha256_shape() {
        return Err(api_error(ApiErrorCode::InvalidRuleset, "ruleset digest is not lowercase SHA-256 hex"));
    }
    Ok(())
}

fn validate_program(program: &TacticalProgram, rules: &VerifiedRulePlan) -> Result<(), ApiError> {
    let plan = rules.plan();
    validate_ruleset_ref(&program.ruleset, rules.ruleset())?;
    if program.language_version != plan.jinrei_language_version
        || program.ir_version != plan.typed_ir_version
        || program.bytecode_version != plan.bytecode_version
        || program.cost_schedule_id != plan.cost_schedule.id
        || program.cost_schedule_version != plan.cost_schedule.version
    {
        return Err(version_error("tactical program metadata does not match the verified rule plan"));
    }
    if !program.content_digest.has_sha256_shape() {
        return Err(api_error(ApiErrorCode::InvalidProgram, "tactical program digest must be lowercase SHA-256 hex"));
    }
    let digest = format!("{:x}", Sha256::digest(&program.bytecode));
    if program.content_digest.as_str() != digest {
        return Err(api_error(ApiErrorCode::InvalidProgram, "tactical program bytecode digest does not match its content"));
    }
    Ok(())
}

fn validate_cu_limits(plan: &RulePlan) -> Result<(), ApiError> {
    for value in [plan.cost_schedule.per_tick_budget, plan.cost_schedule.per_match_budget] {
        if !value.is_json_safe() { return Err(api_error(ApiErrorCode::BudgetExceeded, "rule CU budget is outside the JSON-safe range")); }
    }
    if plan.cost_schedule.per_tick_budget.0 > plan.cost_schedule.per_match_budget.0 {
        return Err(invalid("per-tick CU budget exceeds the per-match budget"));
    }
    for cost in plan.cost_schedule.operations.values() {
        if cost.base > LogicalCu::MAX_SAFE_JSON_INTEGER || cost.per_item > LogicalCu::MAX_SAFE_JSON_INTEGER {
            return Err(api_error(ApiErrorCode::BudgetExceeded, "CU operation cost is outside the JSON-safe range"));
        }
    }
    Ok(())
}

pub(crate) fn validate_configuration(
    configuration: &BTreeMap<senkei_model::FieldId, DomainValue>,
    plan: &RulePlan,
    world: &WorldState,
) -> Result<(), ApiError> {
    for (field, schema) in &plan.domain.senkei_configuration {
        match configuration.get(field).or(schema.default.as_ref()) {
            Some(value) => validate_value(value, &schema.value_type, world, 0, plan.limits.max_value_depth)?,
            None if schema.required => return Err(api_error(ApiErrorCode::InvalidSnapshot, format!("required configuration field `{field}` is missing"))),
            None => {}
        }
    }
    Ok(())
}

pub(crate) fn validate_memory(
    memory: &senkei_model::TacticalMemory,
    plan: &RulePlan,
    world: &WorldState,
) -> Result<(), ApiError> {
    for (state, value) in memory {
        let Some(value_type) = plan.domain.tactical_memory.get(state) else {
            return Err(api_error(ApiErrorCode::InvalidSnapshot, format!("tactical memory contains unknown state `{state}`")));
        };
        validate_value(value, value_type, world, 0, plan.limits.max_value_depth)?;
    }
    Ok(())
}

pub(crate) fn validate_world(
    world: &WorldState,
    plan: &RulePlan,
    host_entity_limit: u32,
) -> Result<(), ApiError> {
    let max_entities = plan.world.max_entities.min(plan.limits.max_entities).min(host_entity_limit);
    if world.entities.len() > max_entities as usize {
        return Err(api_error(ApiErrorCode::ResourceLimit, "initial world exceeds the entity limit"));
    }
    for (id, entity) in &world.entities {
        let Some(schema) = plan.world.entity_types.get(&entity.entity_type) else {
            return Err(api_error(ApiErrorCode::InvalidSnapshot, format!("entity `{id}` has an unknown type")));
        };
        if entity.fields.keys().any(|field| !schema.fields.contains_key(field)) {
            return Err(api_error(ApiErrorCode::InvalidSnapshot, format!("entity `{id}` contains an unknown field")));
        }
        for (field, value) in &entity.fields {
            validate_value(value, &schema.fields[field].value_type, world, 0, plan.limits.max_value_depth)?;
        }
    }
    if world.global_fields.keys().any(|field| !plan.world.global_fields.contains_key(field)) {
        return Err(api_error(ApiErrorCode::InvalidSnapshot, "initial world contains an unknown global field"));
    }
    for (field, value) in &world.global_fields {
        validate_value(value, &plan.world.global_fields[field].value_type, world, 0, plan.limits.max_value_depth)?;
    }
    if world.collections.keys().any(|collection| !plan.world.collections.contains_key(collection)) {
        return Err(api_error(ApiErrorCode::InvalidSnapshot, "initial world contains an unknown collection"));
    }
    for (id, values) in &world.collections {
        let schema = &plan.world.collections[id];
        if values.len() > schema.max_items as usize {
            return Err(api_error(ApiErrorCode::ResourceLimit, format!("world collection `{id}` exceeds its item limit")));
        }
        for value in values {
            validate_value(value, &schema.element_type, world, 0, plan.limits.max_value_depth)?;
        }
    }
    Ok(())
}

pub(crate) fn validate_intent(
    intent: &Intent,
    side: CombatantSide,
    world: &WorldState,
    plan: &RulePlan,
    tick: u32,
    projection_index: &crate::world::ProjectionIndex,
) -> Result<Intent, senkei_model::SymbolId> {
    let rejected = |reason: &str| senkei_model::SymbolId::from(reason);
    let Some(capability) = plan.domain.capabilities.get(&intent.capability) else { return Err(rejected("enbu.unknown_capability")); };
    let mut normalized = intent.clone();
    if let Some(index) = capability.actor_argument {
        let Some(DomainValue::Entity(actor_id)) = intent.arguments.get(index as usize) else { return Err(rejected("enbu.invalid_actor_argument")); };
        if normalized.actor.as_ref().is_some_and(|provided| provided != actor_id) { return Err(rejected("enbu.actor_argument_mismatch")); }
        normalized.actor = Some(actor_id.clone());
    }
    if let Some(index) = capability.target_argument {
        let Some(DomainValue::Entity(target_id)) = intent.arguments.get(index as usize) else { return Err(rejected("enbu.invalid_target_argument")); };
        if normalized.target.as_ref().is_some_and(|provided| provided != target_id) { return Err(rejected("enbu.target_argument_mismatch")); }
        normalized.target = Some(target_id.clone());
    }
    if let Some(actor_id) = &normalized.actor {
        let Some(actor) = world.entities.get(actor_id) else { return Err(rejected("enbu.invalid_actor")); };
        if actor.owner != Some(side) { return Err(rejected("enbu.actor_not_owned")); }
    }
    match (&capability.target_type, &normalized.target) {
        (Some(required), Some(target_id)) => match world.entities.get(target_id) {
            Some(target) if &target.entity_type == required && owner_allowed(capability.target_owner, target.owner, side) => {},
            _ => return Err(rejected("enbu.invalid_target")),
        },
        (Some(_), None) => return Err(rejected("enbu.missing_target")),
        _ => {}
    }
    if intent.arguments.len() > capability.arguments.len()
        || capability.arguments.iter().enumerate().skip(intent.arguments.len()).any(|(_, argument)| !argument.optional)
    {
        return Err(rejected("enbu.invalid_argument_count"));
    }
    for (index, value) in intent.arguments.iter().enumerate() {
        if validate_value(value, &capability.arguments[index].value_type, world, 0, plan.limits.max_value_depth).is_err() {
            return Err(rejected("enbu.invalid_argument"));
        }
    }
    if let Some(next) = &plan.next {
        if let Some(actor) = normalized.actor.as_ref().and_then(|id|world.entities.get(id)) {
            if actor.entity_type.as_str() != "hero" || !crate::next_support::alive(actor) { return Err(rejected("enbu.dead_or_invalid_hero")); }
        }
        if let Some(target) = normalized.target.as_ref().and_then(|id|world.entities.get(id)) {
            // A destroyed fixed bridge remains a legal, visible construction
            // target. Its zero durability must not make rebuilding impossible.
            let available = crate::next_support::alive(target)
                || (normalized.capability.as_str() == "bridge_work" && target.entity_type.as_str() == "bridge");
            if !available || !crate::next_vision::visible(world,next,side,target) || !owner_allowed(capability.target_owner,target.owner,side) { return Err(rejected("enbu.target_unavailable")); }
        }
    }
    let allowed_phase = plan.phases.iter().any(|phase| capability.phases.contains(&phase.id) && phase.kind == senkei_model::PhaseKind::Transition);
    if !allowed_phase { return Err(rejected("enbu.capability_unavailable")); }
    for precondition in &capability.preconditions {
        match crate::eval_truth(precondition, world, crate::EvalContext::intent(side, &normalized, projection_index, tick)) {
            Ok(senkei_model::Truth::True) => {},
            _ => return Err(rejected("enbu.precondition_failed")),
        }
    }
    Ok(normalized)
}

fn owner_allowed(rule: senkei_model::TargetOwnerConstraint, owner: Option<CombatantSide>, side: CombatantSide) -> bool {
    use senkei_model::TargetOwnerConstraint as O;
    match rule {
        O::Any => true,
        O::OwnSide => owner == Some(side),
        O::OtherSide => owner == Some(match side { CombatantSide::Attacker => CombatantSide::Defender, CombatantSide::Defender => CombatantSide::Attacker }),
        O::Unowned => owner.is_none(),
    }
}

fn validate_host_limits(context: &MatchContext, plan: &RulePlan) -> Result<(), ApiError> {
    let host = &context.host_limits;
    if host.max_input_bytes == 0 || host.max_output_bytes == 0 || host.max_entities == 0 {
        return Err(invalid("host input, output, and entity limits must be positive"));
    }
    if host.max_input_bytes > plan.limits.max_input_bytes
        || host.max_entities > plan.limits.max_entities.min(plan.world.max_entities)
        || host.max_events > plan.limits.max_events
        || host.max_diagnostic_events > plan.limits.max_diagnostic_events
        || host.max_output_bytes > plan.limits.max_output_bytes
    {
        return Err(api_error(ApiErrorCode::ResourceLimit, "context host limits exceed the verified RulePlan limits"));
    }
    Ok(())
}

fn validate_value(
    value: &DomainValue,
    value_type: &DomainType,
    world: &WorldState,
    depth: u32,
    max_depth: u32,
) -> Result<(), ApiError> {
    if depth > max_depth { return Err(api_error(ApiErrorCode::ResourceLimit, "domain value exceeds the maximum nesting depth")); }
    use DomainType as T; use DomainValue as V;
    match (value, value_type) {
        (V::Null, T::Optional(_)) => Ok(()),
        (value, T::Optional(inner)) => validate_value(value, inner, world, depth + 1, max_depth),
        (V::Bool(_), T::Bool) => Ok(()),
        (V::Integer(v), T::Integer { min, max }) if min.map_or(true, |m| *v >= m) && max.map_or(true, |m| *v <= m) => Ok(()),
        (V::Fixed { coefficient, scale }, T::Fixed { scale: expected, min, max }) if scale == expected && min.map_or(true, |m| *coefficient >= m) && max.map_or(true, |m| *coefficient <= m) => Ok(()),
        (V::String(v), T::String { max_bytes }) if v.len() <= *max_bytes as usize => Ok(()),
        (V::Enum(v), T::Enum { values, .. }) if values.contains(v) => Ok(()),
        (V::Entity(id), T::Entity { entity_type }) => match world.entities.get(id) {
            Some(entity) if entity_type.as_ref().map_or(true, |required| required == &entity.entity_type) => Ok(()),
            _ => Err(invalid("entity value has a missing or mismatched reference")),
        },
        (V::List(values), T::List { element, max_items }) | (V::List(values), T::Vector { element, max_items }) if values.len() <= *max_items as usize => {
            for value in values { validate_value(value, element, world, depth + 1, max_depth)?; } Ok(())
        }
        (V::List(rows), T::Matrix { element, max_rows, max_columns }) if rows.len() <= *max_rows as usize => {
            for row in rows {
                let V::List(values) = row else { return Err(invalid("matrix row is not a list")); };
                if values.len() > *max_columns as usize { return Err(invalid("matrix row exceeds its item limit")); }
                for value in values { validate_value(value, element, world, depth + 2, max_depth)?; }
            } Ok(())
        }
        (V::Record(values), T::Record { fields }) if values.keys().all(|field| fields.contains_key(field)) && values.len() == fields.len() => {
            for (field, value) in values { validate_value(value, &fields[field], world, depth + 1, max_depth)?; } Ok(())
        }
        _ => Err(invalid("domain value does not match its declared type")),
    }
}

fn version_error(message: impl Into<String>) -> ApiError { api_error(ApiErrorCode::IncompatibleVersion, message) }
fn invalid(message: impl Into<String>) -> ApiError { api_error(ApiErrorCode::InvalidSnapshot, message) }
