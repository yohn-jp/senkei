//! Bounded opt-in Behavior binding for generic declarative rules.
//! Decision traces are restricted match data; callers must protect them as such.
use super::*;
use senkei_behavior::{BehaviorResolver, CandidateSource, Decision, IntentCandidate, Legality, MovementAuthority, ProfileActor, ProfileComposition, ProfilePreferences};
use senritsu::catalog::{BehaviorFieldId, BehaviorScope, DomainCatalog, EntityControlScope, MetadataStatus};
use serde::{Serialize, Deserialize};

/// Restricted, serializable input for one owned Army subject.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BehaviorBinding {
    pub actor: EntityId,
    pub army_id: String,
    pub preferences: BTreeMap<String, DomainValue>,
    pub field: String,
}

/// A candidate may substitute the composed profile field into one declared
/// capability argument. No executable callback or external state is used.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BehaviorCandidateTemplate {
    pub intent: Intent,
    pub profile_argument: Option<u16>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BehaviorExecutionInputs {
    pub schema_version: u32,
    /// Exact serialized CatalogCompatibilityKey; checked against the catalog.
    pub catalog_key: serde_json::Value,
    pub bindings: BTreeMap<CombatantSide, BehaviorBinding>,
    pub candidates: BTreeMap<u32, BTreeMap<CombatantSide, Vec<BehaviorCandidateTemplate>>>,
}

/// This private wrapper carries the complete reproducible Behavior inputs.
/// Public projections contain no bindings, candidates, or restricted traces.
#[derive(Clone)]
pub struct BehaviorSimulationArtifact {
    artifact: SimulationArtifact,
    inputs: BehaviorExecutionInputs,
    catalog: DomainCatalog,
    run_digest: ContentDigest,
    traces: BehaviorTraces,
}
impl BehaviorSimulationArtifact {
    pub fn public_response(&self) -> senkei_model::PublicSimulationResponse { self.artifact.public_response() }
    /// Behavior-specific diagnostics use schema 2 and cannot be mistaken for
    /// legacy schema-1 snapshot identity. The caller authorizes `side`.
    pub fn diagnostics_for_owner(&self, side: CombatantSide) -> BehaviorOwnerDiagnostics {
        let mut diagnostics = self.artifact.diagnostic_response(side).diagnostics.expect("owner diagnostics exist");
        diagnostics.identity.schema_version = 2;
        BehaviorOwnerDiagnostics { behavior_run_digest: self.run_digest.clone(), diagnostics }
    }
    pub fn traces_for_owner(&self, side: CombatantSide) -> Vec<BehaviorTickTrace> { self.traces.for_owner(side) }
    pub fn run_digest(&self) -> &ContentDigest { &self.run_digest }
    /// Re-run the retained immutable inputs with the exact catalog. The caller
    /// supplies a compatible verified plan and tactical execution port.
    pub fn reproduce<P: TacticalExecutionPort>(&self, rules: &VerifiedRulePlan, executor: &mut P) -> Result<Self, ApiError> {
        let source = &self.artifact.reproduction;
        simulate_with_behavior(&source.attacker, &source.defender, rules, &source.context, executor, &self.catalog, &self.inputs)
    }
    /// Authorized reproduction consumers must retain both values together,
    /// along with the exact Catalog artifact. `reproduce` retains the Catalog
    /// in memory; serialized persistence must store and restore it separately.
    pub fn reproduction(&self) -> (&ReproductionContext, &BehaviorExecutionInputs) { (&self.artifact.reproduction, &self.inputs) }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BehaviorOwnerDiagnostics {
    pub behavior_run_digest: ContentDigest,
    pub diagnostics: RestrictedDiagnostics,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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

pub(crate) struct Hook<'a> {
    resolver: BehaviorResolver,
    catalog: &'a DomainCatalog,
    inputs: &'a BehaviorExecutionInputs,
    pub traces: Vec<BehaviorTickTrace>,
    limit: usize,
    pub trace_records: usize,
}

/// Run the bounded generic RulePlan binding from immutable, versioned inputs.
/// Only owned Army actors and single-field targetless, precondition-free
/// capabilities are supported. Unsupported candidates fail closed.
pub fn simulate_with_behavior<P: TacticalExecutionPort>(
    attacker: &senkei_model::SenkeiSnapshot, defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan, context: &MatchContext, executor: &mut P,
    catalog: &DomainCatalog, inputs: &BehaviorExecutionInputs,
) -> Result<BehaviorSimulationArtifact, ApiError> {
    let identity = catalog.identity();
    let plan = rules.plan();
    if plan.next.is_some() || identity.ruleset_id != rules.ruleset().id
        || identity.ruleset_version != rules.ruleset().version || identity.ruleset_digest != *rules.package_digest()
        || identity.minimum_engine_version != plan.minimum_engine_version || identity.model_version != plan.model_version
        || identity.primitive_set_id != plan.primitive_set_id || identity.primitive_set_version != plan.primitive_set_version
        || identity.jinrei_language_version != plan.jinrei_language_version || identity.structured_ast_version != plan.structured_ast_version
        || identity.typed_ir_version != plan.typed_ir_version || identity.bytecode_version != plan.bytecode_version
        || inputs.schema_version != 1 || serde_json::to_value(catalog.compatibility_key()).ok().as_ref() != Some(&inputs.catalog_key) {
        return Err(api_error(ApiErrorCode::IncompatibleVersion, "Behavior catalog or input version does not match generic RulePlan"));
    }
    let input_bytes = serde_json::to_vec(inputs).map_err(|_| api_error(ApiErrorCode::InvalidRequest, "Behavior inputs cannot be serialized"))?;
    if input_bytes.len() as u64 > context.host_limits.max_input_bytes.min(plan.limits.max_input_bytes)
        || inputs.candidates.iter().any(|(tick, sides)| *tick == 0 || *tick > context.max_ticks.min(plan.termination.max_ticks)
            || sides.iter().any(|(side, candidates)| !inputs.bindings.contains_key(side) || candidates.len() > plan.limits.max_intents_per_side_per_tick as usize)) {
        return Err(api_error(ApiErrorCode::ResourceLimit, "Behavior input limit or context exceeded"));
    }
    let resolver = BehaviorResolver::new(catalog, &catalog.compatibility_key())
        .map_err(|e| api_error(ApiErrorCode::ValidationFailed, &e.to_string()))?;
    let mut hook = Hook { resolver, catalog, inputs, traces: Vec::new(), limit: context.host_limits.max_diagnostic_events.min(plan.limits.max_diagnostic_events) as usize, trace_records: 0 };
    let mut artifact = simulate_inner(attacker, defender, rules, context, executor, Some(&mut hook), None)?;
    let run_digest = digest_json(&serde_json::json!({
        "behavior_input_schema": 1,
        "behavior_runtime_version": senkei_behavior::BEHAVIOR_RUNTIME_VERSION,
        "simulation_snapshot_digest": artifact.diagnostic_snapshot_digest,
        "inputs": inputs,
    }))?;
    artifact.diagnostic_snapshot_digest = run_digest.clone();
    artifact.diagnostics.identity.snapshot_digest = run_digest.clone();
    Ok(BehaviorSimulationArtifact { artifact, inputs: inputs.clone(), catalog: catalog.clone(), run_digest, traces: BehaviorTraces { records: hook.traces } })
}

impl Hook<'_> {
    pub fn select(&mut self, validated: &mut Vec<(CombatantSide, Intent)>, outputs: &[(CombatantSide, senkei_model::TacticalExecutionOutput); 2], _observations: &[ObservationSnapshot; 2], world: &WorldState, plan: &RulePlan, tick: u32, index: &world::ProjectionIndex, diagnostics: &mut Vec<DiagnosticEvent>, sequence: &mut u64) -> Result<(), ApiError> {
        for (side, binding) in &self.inputs.bindings {
            let actor = ProfileActor { subject_id: binding.actor.clone(), scope: BehaviorScope::Army, movement_authority: MovementAuthority::Army, hero_catalog_id: None, squad_members: Vec::new() };
            let actor = &actor;
            let field_id = BehaviorFieldId::parse(&binding.field).map_err(|_| api_error(ApiErrorCode::ValidationFailed, "invalid Behavior field"))?;
            let preferences = ProfilePreferences { army_id: binding.army_id.clone(), army: binding.preferences.clone(), ..ProfilePreferences::default() };
            let own = world.entities.get(&actor.subject_id).filter(|e| e.owner == Some(*side));
            let scopes = match self.catalog.entity_scopes() { MetadataStatus::AuthoredExtension { metadata, .. } => metadata, _ => return Err(api_error(ApiErrorCode::ValidationFailed, "Behavior scopes missing")) };
            if actor.scope != BehaviorScope::Army || actor.movement_authority != MovementAuthority::Army || actor.hero_catalog_id.is_some() || !actor.squad_members.is_empty()
                || !own.is_some_and(|e| scopes.get(&e.entity_type) == Some(&EntityControlScope::Army)) {
                return Err(api_error(ApiErrorCode::ValidationFailed, "Behavior actor does not match current owned Army subject"));
            }
            let field = field_id.as_key();
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
            // Only these previously validated proposals still need a final
            // status here; validation already rejected all the others.
            let pending_explicit = validated.iter().filter(|(s, i)| s == side && relevant(i)).map(|(_, i)| i.clone()).collect::<Vec<_>>();
            validated.retain(|(s, i)| *s != *side || !relevant(i));
            let composition = self.resolver.compose(actor, &preferences, tick, *side, &execution, &legal).map_err(behavior_error)?;
            let templates = self.inputs.candidates.get(&tick).and_then(|sides| sides.get(side));
            let mut defaults = Vec::new();
            for template in templates.into_iter().flatten() {
                let mut intent = template.intent.clone();
                if let Some(argument) = template.profile_argument {
                    let declared = self.catalog.capabilities().get(&intent.capability)
                        .and_then(|capability| capability.behavior_override_arguments.get(&field)).copied();
                    if declared != Some(argument) || (argument as usize) >= intent.arguments.len() {
                        return Err(api_error(ApiErrorCode::ValidationFailed, "invalid Behavior profile argument"));
                    }
                    intent.arguments[argument as usize] = composition.values.get(&field).cloned()
                        .ok_or_else(|| api_error(ApiErrorCode::ValidationFailed, "missing composed Behavior field"))?;
                }
                defaults.push(intent);
            }
            if defaults.len() > plan.limits.max_intents_per_side_per_tick as usize { return Err(api_error(ApiErrorCode::ResourceLimit, "Behavior candidate limit exceeded")); }
            let mut candidate_ids = output.intents.iter().map(|intent| intent.action_id.clone()).collect::<BTreeSet<_>>();
            for intent in &defaults {
                if !candidate_ids.insert(intent.action_id.clone()) { return Err(api_error(ApiErrorCode::ValidationFailed, "duplicate Behavior action ID")); }
                push_diagnostic(diagnostics, sequence, tick, *side, DiagnosticRecord::IntentProposed { intent: intent.clone() })?;
            }
            let pending_defaults = defaults.clone();
            let mut candidates: Vec<_> = execution.intents.into_iter().map(|intent| IntentCandidate { legality: legal.get(&intent.action_id).cloned().unwrap(), intent, source: CandidateSource::Explicit, tick, side: *side, profile_digest: None }).collect();
            for intent in defaults {
                let legality = if validation::validate_intent(&intent, *side, world, plan, tick, index).is_ok() && safe_shape(&intent, actor, &field, self.catalog, plan) { Legality::KnownLegal } else { Legality::KnownRejected { reason: "unsupported or invalid candidate".into() } };
                candidates.push(IntentCandidate { intent, source: CandidateSource::Default, tick, side: *side, profile_digest: Some(composition.digest.clone()), legality });
            }
            let decisions = self.resolver.resolve_fields(&composition, actor, tick, *side, &BTreeMap::from([(field_id.clone(), candidates)]), &BTreeMap::new()).map_err(behavior_error)?;
            let decision = decisions.into_values().next().unwrap();
            for intent in pending_explicit.into_iter().chain(pending_defaults) {
                if decision.selected.as_ref() != Some(&intent) {
                    push_diagnostic(diagnostics, sequence, tick, *side, DiagnosticRecord::IntentRejected { intent, reason: SymbolId::from("enbu.behavior_not_selected") })?;
                }
            }
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
