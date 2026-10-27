//! Bounded opt-in Behavior binding for generic declarative rules.
//! Decision traces are restricted match data; callers must protect them as such.
use super::*;
use senkei_behavior::{BehaviorResolver, CandidateSource, Decision, IntentCandidate, Legality, MovementAuthority, ProfileActor, ProfileComposition, ProfilePreferences};
use senritsu::catalog::{BehaviorFieldId, BehaviorScope, CatalogCompatibilityKey, DomainCatalog, EntityControlScope, MetadataStatus};

#[derive(Clone, Debug)]
pub struct BehaviorBinding {
    pub actor: ProfileActor,
    pub preferences: ProfilePreferences,
    pub field: BehaviorFieldId,
}

#[derive(Clone, Debug)]
pub struct BehaviorTickTrace {
    pub tick: u32,
    pub side: CombatantSide,
    pub composition: ProfileComposition,
    pub decision: Decision,
    /// Whether Enbu's final RulePlan arbitration accepted the selected intent.
    /// This is not a claim that a particular effect occurred.
    pub arbitration_accepted: bool,
    /// True only after the complete tick transition succeeded.
    pub transition_completed: bool,
}

/// Private decision traces. Only project them for an authorized owner.
#[derive(Clone)]
pub struct BehaviorTraces { records: Vec<BehaviorTickTrace> }
impl BehaviorTraces {
    pub fn for_owner(&self, side: CombatantSide) -> Vec<BehaviorTickTrace> {
        self.records.iter().filter(|record| record.side == side).cloned().collect()
    }
}

type Producer<'a> = dyn FnMut(&ObservationSnapshot, &ProfileComposition) -> Vec<Intent> + 'a;
pub(crate) struct Hook<'a> {
    resolver: BehaviorResolver,
    catalog: &'a DomainCatalog,
    bindings: &'a BTreeMap<CombatantSide, BehaviorBinding>,
    producer: &'a mut Producer<'a>,
    pub traces: Vec<BehaviorTickTrace>,
    limit: usize,
    pub trace_records: usize,
}

/// Run an opt-in bounded generic RulePlan Behavior integration. Bindings are
/// limited to Army subjects and a single field; candidates may reference only
/// their own actor and have no target or world-dependent preconditions. Next
/// actions and all unsupported candidates fail closed. The producer sees only
/// the side's observation and composed profile, and cannot certify legality.
/// Returned traces are restricted diagnostics, not public replay data. The
/// caller must bind and retain its candidate producer for reproduction; this
/// experimental hook does not persist producer code or external preferences.
pub fn simulate_with_behavior<P: TacticalExecutionPort>(
    attacker: &senkei_model::SenkeiSnapshot, defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan, context: &MatchContext, executor: &mut P,
    catalog: &DomainCatalog, expected: &CatalogCompatibilityKey,
    bindings: &BTreeMap<CombatantSide, BehaviorBinding>, producer: &mut Producer<'_>,
) -> Result<(SimulationArtifact, BehaviorTraces), ApiError> {
    let identity = catalog.identity();
    let plan = rules.plan();
    if plan.next.is_some() || identity.ruleset_id != rules.ruleset().id
        || identity.ruleset_version != rules.ruleset().version || identity.ruleset_digest != *rules.package_digest()
        || identity.minimum_engine_version != plan.minimum_engine_version || identity.model_version != plan.model_version
        || identity.primitive_set_id != plan.primitive_set_id || identity.primitive_set_version != plan.primitive_set_version
        || identity.jinrei_language_version != plan.jinrei_language_version || identity.structured_ast_version != plan.structured_ast_version
        || identity.typed_ir_version != plan.typed_ir_version || identity.bytecode_version != plan.bytecode_version {
        return Err(api_error(ApiErrorCode::IncompatibleVersion, "Behavior catalog does not match generic RulePlan"));
    }
    let resolver = BehaviorResolver::new(catalog, expected)
        .map_err(|e| api_error(ApiErrorCode::ValidationFailed, &e.to_string()))?;
    let mut hook = Hook { resolver, catalog, bindings, producer, traces: Vec::new(), limit: context.host_limits.max_diagnostic_events.min(plan.limits.max_diagnostic_events) as usize, trace_records: 0 };
    let artifact = simulate_inner(attacker, defender, rules, context, executor, Some(&mut hook))?;
    Ok((artifact, BehaviorTraces { records: hook.traces }))
}

impl Hook<'_> {
    pub fn select(&mut self, validated: &mut Vec<(CombatantSide, Intent)>, outputs: &[(CombatantSide, senkei_model::TacticalExecutionOutput); 2], observations: &[ObservationSnapshot; 2], world: &WorldState, plan: &RulePlan, tick: u32, index: &world::ProjectionIndex) -> Result<(), ApiError> {
        for (side, binding) in self.bindings {
            let actor = &binding.actor;
            let own = world.entities.get(&actor.subject_id).filter(|e| e.owner == Some(*side));
            let scopes = match self.catalog.entity_scopes() { MetadataStatus::AuthoredExtension { metadata, .. } => metadata, _ => return Err(api_error(ApiErrorCode::ValidationFailed, "Behavior scopes missing")) };
            if actor.scope != BehaviorScope::Army || actor.movement_authority != MovementAuthority::Army || actor.hero_catalog_id.is_some() || !actor.squad_members.is_empty()
                || !own.is_some_and(|e| scopes.get(&e.entity_type) == Some(&EntityControlScope::Army)) {
                return Err(api_error(ApiErrorCode::ValidationFailed, "Behavior actor does not match current owned Army subject"));
            }
            let field = binding.field.as_key();
            let relevant = |intent: &Intent| intent.actor.as_ref() == Some(&actor.subject_id) && self.catalog.capabilities().get(&intent.capability).is_some_and(|c| c.behavior_override_arguments.contains_key(&field));
            let output = &outputs.iter().find(|(s, _)| s == side).unwrap().1;
            if output.status != senkei_model::TacticalExecutionStatus::Completed { continue; }
            let mut execution = output.clone();
            execution.intents = execution.intents.into_iter().map(|intent| {
                validation::validate_intent(&intent, *side, world, plan, tick, index).unwrap_or(intent)
            }).filter(|intent| relevant(intent)).collect();
            let mut legal = BTreeMap::new();
            for intent in &execution.intents {
                if legal.contains_key(&intent.action_id) { return Err(api_error(ApiErrorCode::ValidationFailed, "duplicate Behavior action ID")); }
                let accepted = validated.iter().any(|(s, i)| s == side && i == intent);
                legal.insert(intent.action_id.clone(), if accepted && safe_shape(intent, actor, &field, self.catalog, plan) { Legality::KnownLegal } else { Legality::KnownRejected { reason: "unsupported or invalid candidate".into() } });
            }
            validated.retain(|(s, i)| *s != *side || !relevant(i));
            let composition = self.resolver.compose(actor, &binding.preferences, tick, *side, &execution, &legal).map_err(behavior_error)?;
            let observation = observations.iter().find(|o| o.side == *side).unwrap();
            let defaults = (self.producer)(observation, &composition);
            if defaults.len() > plan.limits.max_intents_per_side_per_tick as usize { return Err(api_error(ApiErrorCode::ResourceLimit, "Behavior candidate limit exceeded")); }
            let mut candidates: Vec<_> = execution.intents.into_iter().map(|intent| IntentCandidate { legality: legal.get(&intent.action_id).cloned().unwrap(), intent, source: CandidateSource::Explicit, tick, side: *side, profile_digest: None }).collect();
            for intent in defaults {
                let legality = if validation::validate_intent(&intent, *side, world, plan, tick, index).is_ok() && safe_shape(&intent, actor, &field, self.catalog, plan) { Legality::KnownLegal } else { Legality::KnownRejected { reason: "unsupported or invalid candidate".into() } };
                candidates.push(IntentCandidate { intent, source: CandidateSource::Default, tick, side: *side, profile_digest: Some(composition.digest.clone()), legality });
            }
            let decisions = self.resolver.resolve_fields(&composition, actor, tick, *side, &BTreeMap::from([(binding.field.clone(), candidates)]), &BTreeMap::new()).map_err(behavior_error)?;
            let decision = decisions.into_values().next().unwrap();
            if let Some(intent) = &decision.selected { validated.push((*side, intent.clone())); }
            self.trace_records = self.trace_records.checked_add(1 + decision.trace.len() + composition.unknown_conditions.len() + composition.unknown_overrides.len() + composition.rejected_overrides.len()).ok_or_else(|| api_error(ApiErrorCode::ResourceLimit, "Behavior trace count overflow"))?;
            if self.trace_records > self.limit || validated.iter().filter(|(s, _)| s == side).count() > plan.limits.max_intents_per_side_per_tick as usize { return Err(api_error(ApiErrorCode::ResourceLimit, "Behavior trace or intent limit exceeded")); }
            self.traces.push(BehaviorTickTrace { tick, side: *side, composition, decision, arbitration_accepted: false, transition_completed: false });
        }
        Ok(())
    }
    pub fn record_arbitration(&mut self, tick: u32, accepted: &[(CombatantSide, Intent)]) {
        for trace in self.traces.iter_mut().filter(|t| t.tick == tick) {
            trace.arbitration_accepted = trace.decision.selected.as_ref().is_some_and(|i| accepted.iter().any(|(s, a)| *s == trace.side && a == i));
        }
    }
    pub fn record_transition(&mut self, tick: u32) { for trace in self.traces.iter_mut().filter(|t| t.tick == tick) { trace.transition_completed = true; } }
}
fn behavior_error(e: senkei_behavior::BehaviorError) -> ApiError { api_error(ApiErrorCode::ValidationFailed, &e.to_string()) }
fn safe_shape(intent: &Intent, actor: &ProfileActor, field: &str, catalog: &DomainCatalog, plan: &RulePlan) -> bool {
    let Some(schema) = plan.domain.capabilities.get(&intent.capability) else { return false };
    let Some(meta) = catalog.capabilities().get(&intent.capability) else { return false };
    schema.actor_argument.is_some() && schema.target_argument.is_none() && schema.target_type.is_none() && schema.preconditions.is_empty()
        && intent.actor.as_ref() == Some(&actor.subject_id) && intent.target.is_none()
        && meta.behavior_override_arguments.len() == 1 && meta.behavior_override_arguments.contains_key(field)
        && intent.arguments.iter().enumerate().all(|(i, value)| if Some(i as u16) == schema.actor_argument { matches!(value, DomainValue::Entity(id) if id == &actor.subject_id) } else { no_entity(value) })
}

fn no_entity(value: &DomainValue) -> bool {
    match value {
        DomainValue::Entity(_) => false,
        DomainValue::List(values) => values.iter().all(no_entity),
        DomainValue::Record(values) => values.values().all(no_entity),
        _ => true,
    }
}
