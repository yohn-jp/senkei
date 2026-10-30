//! Deterministic, game-rule-neutral simulation engine.
//!
//! Enbu interprets only the finite structures in `VerifiedRulePlan`; tactical
//! bytecode is opaque and is executed only through `TacticalExecutionPort`.

mod behavior;
mod actor_decisions;
mod next_behavior;
mod next_decision_inspection;
mod next_minion_behavior;
mod next_minion_control;
mod next_route;
pub use actor_decisions::{AutonomousActorKind, AutonomousCombatAction, AutonomousCombatTrace, AutonomousCommittedEventRef, AutonomousNoAttackReason, AutonomousTargetSelection};
pub use next_minion_behavior::{simulate_next_minion_behavior, NextMinionBehaviorExecutionInputs, NextMinionBehaviorSimulationArtifact, NextMinionBehaviorTrace, NextMinionPreferenceSource, NextMinionWaypoint};
pub use next_behavior::{simulate_next_behavior, NextBehaviorCommittedEventRef, NextBehaviorCompositionTrace, NextBehaviorExecutionInputs, NextBehaviorMemberComposition, NextBehaviorProfile, NextBehaviorProfileSource, NextBehaviorSelectionSource, NextBehaviorSimulationArtifact, NextBehaviorTrace};
pub use next_decision_inspection::{inspect_next_decision, NextDecisionInspection, NEXT_DECISION_INSPECTION_FORMAT_VERSION};
pub mod projected_assets;
pub use senkei_behavior::BEHAVIOR_RUNTIME_VERSION;
pub use behavior::{simulate_with_behavior, BehaviorBinding, BehaviorCandidateTemplate, BehaviorExecutionInputs, BehaviorSimulationArtifact, BehaviorOwnerDiagnostics, BehaviorTickTrace, BehaviorTraces};
mod validation;
mod world;
mod next_support;
mod next_squads;
mod next_navigation;
mod next_vision;
pub(crate) mod next_fog;
mod execution;
mod next_combat;
mod next_tactics;
mod next_battlefield;

pub use validation::ENGINE_VERSION;

/// Build the canonical empty-world context for a verified RulePlan. Senritsu
/// validates these host caps against the Enbu implementation limits.
pub fn new_match_context(rules: &VerifiedRulePlan, match_id: MatchId) -> MatchContext {
    let plan = rules.plan();
    MatchContext {
        schema_version: plan.model_version,
        match_id,
        ruleset: rules.ruleset().clone(),
        world_identity: rules.world_identity().cloned(),
        next_behavior: None,
        next_minion_behavior: None,
        next_minion_control: None,
        next_route: None,
        versions: ComponentVersions {
            model: plan.model_version,
            engine: validation::ENGINE_VERSION,
            ruleset: rules.ruleset().version,
            jinrei_language: plan.jinrei_language_version,
            structured_ast: plan.structured_ast_version,
            typed_ir: plan.typed_ir_version,
            bytecode: plan.bytecode_version,
            cost_schedule: plan.cost_schedule.version,
            replay_schema: validation::REPLAY_SCHEMA_VERSION,
        },
        match_projection: None,
        initial_world: WorldState::default(),
        max_ticks: plan.termination.max_ticks,
        host_limits: HostLimits::from(&plan.limits),
    }
}

/// Hash the complete immutable simulation input tuple using the same canonical
/// JSON bytes stored in restricted diagnostic lineage.
pub fn reproduction_snapshot_digest(
    attacker: &senkei_model::SenkeiSnapshot,
    defender: &senkei_model::SenkeiSnapshot,
    context: &MatchContext,
) -> Result<ContentDigest, ApiError> {
    digest_json(&serde_json::json!({
        "attacker": attacker,
        "context": context,
        "defender": defender,
    }))
}

use senkei_model::{
    ApiError, ApiErrorCode, CombatantSide, ComponentVersions, ContentDigest, DiagnosticEvent, EntityId,
    DiagnosticRecord, ExecutionBudget, HostLimits, Intent, LogicalCu, MatchContext, MatchId,
    DomainValue, MatchOutcome, MatchResult, ObservationSnapshot,
    PresentationReplay, ReplayFrame, ReproductionContext, RestrictedDiagnostics,
    RuleExpression, RulePlan, SimulationArtifact, SymbolId,
    TacticalDiagnostic, TacticalExecutionError, TacticalExecutionPort,
    TacticalExecutionRequest, TacticalMemory, Truth,
    VerifiedRulePlan, Version, WorldState,
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy)]
pub(crate) struct EvalContext<'a> {
    pub side: Option<CombatantSide>,
    pub intent: Option<&'a Intent>,
    pub observed_entity: Option<&'a senkei_model::EntityId>,
    pub projection_index: Option<&'a world::ProjectionIndex>,
    pub tick: u32,
}

impl<'a> EvalContext<'a> {
    fn intent(side: CombatantSide, intent: &'a Intent, projection_index: &'a world::ProjectionIndex, tick: u32) -> Self {
        Self { side: Some(side), intent: Some(intent), observed_entity: None, projection_index: Some(projection_index), tick }
    }
    fn global(projection_index: &'a world::ProjectionIndex, tick: u32) -> Self {
        Self { side: None, intent: None, observed_entity: None, projection_index: Some(projection_index), tick }
    }
}

/// Validate and construct the same initial world used by simulation, without
/// executing Jinrei or producing match output.
pub fn preflight(
    attacker: &senkei_model::SenkeiSnapshot,
    defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan,
    context: &MatchContext,
) -> Result<(), ApiError> {
    if let Some(binding) = &context.next_behavior {
        let policy = senritsu::validate_next_behavior_policy(binding.policy.clone(), rules)
            .map_err(|e| api_error(ApiErrorCode::ValidationFailed, e))?;
        next_behavior::validate_inputs(rules, context, &policy, &binding.inputs)?;
    }
    let (world, projection_index, _) = initialize_match(attacker, defender, rules, context)?;
    if let Some(binding) = &context.next_behavior { next_behavior::validate_bindings(&binding.inputs, &world)?; }
    evaluate_termination(rules.plan(), &world, 0, &projection_index).map(|_| ())
}

fn initialize_match(
    attacker: &senkei_model::SenkeiSnapshot,
    defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan,
    context: &MatchContext,
) -> Result<(WorldState, world::ProjectionIndex, Option<projected_assets::RelationRuntime>), ApiError> {
    validation::validate_inputs(attacker, defender, rules, context)?;
    next_minion_control::validate_context(rules, context)?;
    let plan = rules.plan();
    if let Some(binding) = &context.next_minion_behavior {
        let policy = senritsu::validate_next_minion_behavior_policy(binding.policy.clone(), rules)
            .map_err(|e| api_error(ApiErrorCode::ValidationFailed, e))?;
        next_minion_behavior::validate_inputs(rules, context, &policy, &binding.inputs)?;
    }
    if let Some(binding) = &context.next_route { next_route::validate_inputs(rules, context, binding)?; }
    if plan.domain.capabilities.contains_key(&"behavior_preference".into()) && context.next_behavior.is_none() {
        return Err(api_error(ApiErrorCode::ValidationFailed, "behavior_preference requires frozen Next Behavior inputs"));
    }
    let (mut world, projection_index) = world::initialize(
        &context.initial_world,
        attacker,
        defender,
        plan,
        rules.package_digest(),
        context.host_limits.max_entities.min(plan.world.max_entities),
    )?;
    if context.match_projection.is_some() && plan.next.is_none() {
        return Err(invalid_plan("asset projection requires Next rules"));
    }
    let mut relation_runtime = None;
    if let Some(next) = &plan.next {
        next_squads::initialize(&mut world, attacker, CombatantSide::Attacker, next)?;
        next_squads::initialize(&mut world, defender, CombatantSide::Defender, next)?;
        if let Some(projection) = &context.match_projection {
            if let Some(policy) = &next.projection_policy {
                if policy.hero_catalog_version != next.mechanics_version || policy.hero_catalog_digest != digest_json(&next.heroes)? {
                    return Err(invalid_plan("Hero catalog identity does not match the verified rules"));
                }
            }
            relation_runtime = Some(projected_assets::apply(&mut world, next.projection_policy.as_ref(), projection)?);
        }
        next_combat::initialize_objectives(&mut world, next);
        next_battlefield::initialize(&mut world, next);
        next_vision::lifecycle(&mut world, next, 0);
    }
    for collection in plan.world.collections.keys() { world.collections.entry(collection.clone()).or_default(); }
    validation::validate_world(&world, plan, context.host_limits.max_entities)?;
    validation::validate_configuration(&attacker.configuration, plan, &world)?;
    validation::validate_configuration(&defender.configuration, plan, &world)?;
    validation::validate_memory(&attacker.initial_memory, plan, &world)?;
    validation::validate_memory(&defender.initial_memory, plan, &world)?;
    if let Some(binding) = &context.next_route {
        next_route::validate_bindings(binding, &world, plan.next.as_ref().ok_or_else(|| invalid_plan("route binding requires Next rules"))?)?;
    }
    Ok((world, projection_index, relation_runtime))
}

/// Run a complete deterministic match using the shared tactical execution
/// port. Both sides see the same pre-transition world snapshot on every tick.
pub fn simulate<P: TacticalExecutionPort>(
    attacker: &senkei_model::SenkeiSnapshot,
    defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan,
    context: &MatchContext,
    executor: &mut P,
) -> Result<SimulationArtifact, ApiError> {
    simulate_configured(attacker, defender, rules, context, executor, None)
}

/// Optional bounded diagnostics for the existing autonomous combat selection.
/// Only explicitly authorized owner projections leave this wrapper.
#[derive(Clone)]
pub struct ActorDecisionSimulationArtifact {
    artifact: SimulationArtifact,
    owner_traces: BTreeMap<CombatantSide, Vec<AutonomousCombatTrace>>,
}
impl ActorDecisionSimulationArtifact {
    pub fn public_response(&self) -> senkei_model::PublicSimulationResponse { self.artifact.public_response() }
    pub fn response_for_owner(&self, side: CombatantSide) -> senkei_model::LocalSimulationResponse { self.artifact.diagnostic_response(side) }
    pub fn diagnostics_for_owner(&self, side: CombatantSide) -> BehaviorOwnerDiagnostics {
        BehaviorOwnerDiagnostics {
            behavior_run_digest: self.artifact.diagnostic_snapshot_digest.clone(),
            diagnostics: self.artifact.diagnostic_response(side).diagnostics.expect("owner diagnostics"),
        }
    }
    pub fn traces_for_owner(&self, side: CombatantSide) -> Vec<AutonomousCombatTrace> {
        self.owner_traces.get(&side).cloned().unwrap_or_default()
    }
    pub fn reproduction(&self) -> &ReproductionContext { &self.artifact.reproduction }
}

pub fn simulate_with_actor_decisions<P: TacticalExecutionPort>(
    attacker: &senkei_model::SenkeiSnapshot, defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan, context: &MatchContext, executor: &mut P,
) -> Result<ActorDecisionSimulationArtifact, ApiError> {
    if rules.plan().next.is_none() { return Err(api_error(ApiErrorCode::ValidationFailed, "autonomous actor diagnostics require Next rules")); }
    let limit = context.host_limits.max_diagnostic_events.min(rules.plan().limits.max_diagnostic_events).min(usize::MAX as u64) as usize;
    simulate_actor_decisions_with_collector(attacker, defender, rules, context, executor, actor_decisions::ActorDecisionCollector::new(limit))
}

/// Owner-scoped collection prevents inaccessible actors and candidates from
/// consuming the trace budget of a player-facing diagnostic request.
pub fn simulate_with_actor_decisions_for_owner<P: TacticalExecutionPort>(
    attacker: &senkei_model::SenkeiSnapshot, defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan, context: &MatchContext, side: CombatantSide, executor: &mut P,
) -> Result<ActorDecisionSimulationArtifact, ApiError> {
    if rules.plan().next.is_none() { return Err(api_error(ApiErrorCode::ValidationFailed, "autonomous actor diagnostics require Next rules")); }
    let limit = context.host_limits.max_diagnostic_events.min(rules.plan().limits.max_diagnostic_events).min(usize::MAX as u64) as usize;
    simulate_actor_decisions_with_collector(attacker, defender, rules, context, executor, actor_decisions::ActorDecisionCollector::new_for_owner(limit, side))
}

fn simulate_actor_decisions_with_collector<P: TacticalExecutionPort>(
    attacker: &senkei_model::SenkeiSnapshot, defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan, context: &MatchContext, executor: &mut P,
    mut collector: actor_decisions::ActorDecisionCollector,
) -> Result<ActorDecisionSimulationArtifact, ApiError> {
    let artifact = simulate_configured(attacker, defender, rules, context, executor, Some(&mut collector))?;
    let mut owner_traces: BTreeMap<CombatantSide, Vec<AutonomousCombatTrace>> = BTreeMap::new();
    for record in collector.records {
        if let Some(side) = record.owner { owner_traces.entry(side).or_default().push(record.trace); }
    }
    Ok(ActorDecisionSimulationArtifact { artifact, owner_traces })
}

fn simulate_configured<P: TacticalExecutionPort>(
    attacker: &senkei_model::SenkeiSnapshot, defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan, context: &MatchContext, executor: &mut P,
    actor_collector: Option<&mut actor_decisions::ActorDecisionCollector>,
) -> Result<SimulationArtifact, ApiError> {
    let hero_policy = context.next_behavior.as_ref().map(|binding| {
        senritsu::validate_next_behavior_policy(binding.policy.clone(), rules)
            .map_err(|e| api_error(ApiErrorCode::ValidationFailed, e))
    }).transpose()?;
    let minion_policy = context.next_minion_behavior.as_ref().map(|binding| {
        senritsu::validate_next_minion_behavior_policy(binding.policy.clone(), rules)
            .map_err(|e| api_error(ApiErrorCode::ValidationFailed, e))
    }).transpose()?;
    let mut hero_hook = if let (Some(binding), Some(policy)) = (&context.next_behavior, &hero_policy) {
        next_behavior::validate_inputs(rules, context, policy, &binding.inputs)?;
        Some(next_behavior::Hook { policy, inputs: &binding.inputs, traces: Vec::new(), accepted_preferences: Vec::new(), inspection: None })
    } else { None };
    let mut minion_hook = if let (Some(binding), Some(policy)) = (&context.next_minion_behavior, &minion_policy) {
        next_minion_behavior::validate_inputs(rules, context, policy, &binding.inputs)?;
        Some(next_minion_behavior::Hook { policy, inputs: &binding.inputs, traces: Vec::new() })
    } else { None };
    simulate_inner(attacker, defender, rules, context, executor, None, hero_hook.as_mut(), minion_hook.as_mut(), actor_collector)
}

fn simulate_inner<P: TacticalExecutionPort>(
    attacker: &senkei_model::SenkeiSnapshot, defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan, context: &MatchContext, executor: &mut P,
    mut behavior: Option<&mut behavior::Hook<'_>>,
    mut next_behavior: Option<&mut next_behavior::Hook<'_>>,
    mut minion_behavior: Option<&mut next_minion_behavior::Hook<'_>>,
    mut actor_collector: Option<&mut actor_decisions::ActorDecisionCollector>,
) -> Result<SimulationArtifact, ApiError> {
    let (mut world, projection_index, mut relation_runtime) = initialize_match(attacker, defender, rules, context)?;
    if let Some(hook) = next_behavior.as_deref() { next_behavior::validate_bindings(hook.inputs, &world)?; }
    if let Some(inspection) = next_behavior.as_deref().and_then(|hook| hook.inspection.as_ref()) { inspection.validate_subject(&world)?; }
    let plan = rules.plan();
    // The capability schema is fixed for this verified RulePlan. The former
    // call_executor built this BTreeSet twice per Tick; all intent/authority
    // checks still consume the exact same immutable set.
    let allowed_capabilities = plan.domain.capabilities.keys().cloned().collect::<BTreeSet<_>>();
    // Invariant hoisting: the verified plan is immutable for the whole match.
    // Keep the normal Tick path as the control build.
    #[cfg(feature = "lab-opt-termination")]
    let compact_cost_trace_precomputed = compact_cost_trace_for_plan(plan);
    #[cfg(feature = "lab-opt-termination")]
    let ordered_termination_indices = {
        let mut indices = (0..plan.termination.conditions.len()).collect::<Vec<_>>();
        // Stable sort matches evaluate_termination's existing tie semantics.
        indices.sort_by_key(|&index| plan.termination.conditions[index].order);
        indices
    };
    let mut route_runtime = context.next_route.as_ref().map(next_route::Runtime::new);
    let mut memories = BTreeMap::from([
        (CombatantSide::Attacker, attacker.initial_memory.clone()),
        (CombatantSide::Defender, defender.initial_memory.clone()),
    ]);
    let mut cu_spent = BTreeMap::from([
        (CombatantSide::Attacker, LogicalCu::ZERO),
        (CombatantSide::Defender, LogicalCu::ZERO),
    ]);
    let mut diagnostics = Vec::new();
    let mut diagnostic_sequence = 0_u64;
    let mut minion_diagnostics = BTreeMap::<(CombatantSide, u32, EntityId), usize>::new();
    if plan.next.is_some() {
        for (entity_id, entity) in &world.entities {
            let Some(side) = entity.owner else { continue };
            if entity.entity_type.as_str() != "hero" { continue; }
            let slot = next_support::string(entity, "slot_id");
            let catalog = next_support::string(entity, "catalog_id");
            if slot.is_empty() || catalog.is_empty() || *entity_id != next_squads::hero_entity_id(side, &slot) { continue; }
            if diagnostics.len() as u64 >= context.host_limits.max_diagnostic_events.min(plan.limits.max_diagnostic_events) {
                return Err(api_error(ApiErrorCode::ResourceLimit, "diagnostic event limit exceeded"));
            }
            push_diagnostic(&mut diagnostics, &mut diagnostic_sequence, 0, side, DiagnosticRecord::RuntimeNotice {
                code: "enbu.next_hero_identity".into(),
                details: BTreeMap::from([("slot_id".into(), slot), ("catalog_id".into(), catalog)]),
            })?;
            diagnostics.last_mut().unwrap().entity_id = Some(entity_id.clone());
        }
    }
    let mut replay_frames = Vec::new();
    let sides = [CombatantSide::Attacker, CombatantSide::Defender];
    let mut owner_frames: BTreeMap<CombatantSide, Vec<ReplayFrame>> =
        sides.into_iter().map(|side| (side, Vec::new())).collect();
    let mut fog_histories: BTreeMap<CombatantSide, next_vision::FogHistory> =
        sides.into_iter().map(|side| (side, next_vision::FogHistory::default())).collect();
    let mut event_count = 0_u64;

    replay_frames.push(ReplayFrame {
        tick: 0,
        events: Vec::new(),
        visible_state: Some(presentation_view(&world, plan)),
    });

    if let Some(next) = &plan.next {
        for side in sides {
            owner_frames.get_mut(&side).unwrap().push(ReplayFrame {
                tick: 0,
                events: Vec::new(),
                visible_state: Some(next_vision::team_view_with_fog(
                    &world, next, side, 0, fog_histories.get_mut(&side).unwrap(),
                )),
            });
        }
    }
    let mut final_outcome = None;
    #[cfg(feature = "lab-opt-termination")]
    let initial_termination = evaluate_termination_indexed(plan, &world, 0, &projection_index, &ordered_termination_indices)?;
    #[cfg(not(feature = "lab-opt-termination"))]
    let initial_termination = evaluate_termination(plan, &world, 0, &projection_index)?;
    if let Some((outcome, reason)) = initial_termination {
        final_outcome = Some((outcome, reason, 0));
    }

    let max_ticks = context.max_ticks.min(plan.termination.max_ticks);
    // Owned by exactly one match. Never reuse a certificate across plans,
    // matches or authority boundaries. Every external Tick remains canonical.
    let mut attack_frontier = execution::scheduler::BasicAttackFrontier::default();
    let mut reveal_frontier = execution::scheduler::RevealExpiryFrontier::default();
    let mut materialization = execution::materialize::FullCaptureLedger::default();
    for tick in 1..=max_ticks {
        if final_outcome.is_some() {
            break;
        }
        materialization.enter(tick).map_err(|_| api_error(
            ApiErrorCode::InternalError, "Hybrid output ledger rejected nonsequential Tick",
        ))?;

        let mut objective_events = Vec::new();
        if let Some(next) = &plan.next {
            objective_events = next_combat::objective_lifecycle(&mut world, next, tick);
            if cfg!(feature = "lab-opt-scheduler") {
                let plan = execution::planner::tick_work(
                    world.entities.len(), false, cfg!(feature = "lab-opt-hybrid"), true,
                );
                if plan.reveal_frontier {
                    next_vision::lifecycle_scheduled(&mut world, next, tick, &mut reveal_frontier);
                } else {
                    reveal_frontier.decline_tick(tick);
                    next_vision::lifecycle(&mut world, next, tick);
                }
            } else {
                next_vision::lifecycle(&mut world, next, tick);
            }
        }
        // Freeze observations before calling either side. Executor call order
        // cannot expose one side's proposed actions to the other.
        let observations = [
            observation(&world, plan, CombatantSide::Attacker, tick, &projection_index)?,
            observation(&world, plan, CombatantSide::Defender, tick, &projection_index)?,
        ];
        if let Some(inspection) = next_behavior.as_deref_mut().and_then(|hook| hook.inspection.as_mut()).filter(|inspection| inspection.selector.tick == tick) {
            let observation = observations.iter().find(|observation| observation.side == inspection.side).expect("both side observations");
            // Until this side completes and reaches selection, the observation
            // exists but no Behavior decision is claimed.
            inspection.observe(observation, false)?;
        }
        if let Some(collector) = actor_collector.as_deref_mut() {
            if let Some(side) = collector.owner_side() {
                let observation = observations.iter().find(|observation| observation.side == side).expect("both side observations");
                let known = observation.collections.values().filter_map(|collection| match collection {
                    senkei_model::Observed::Known(items) => Some(items.iter().map(|item| item.id.clone())),
                    senkei_model::Observed::Unknown => None,
                }).flatten().collect();
                collector.set_owner_observation(tick, known);
            }
        }
        if context.next_minion_control.is_none() {
            if let Some(hook) = minion_behavior.as_deref_mut() {
                record_minion_behavior(hook, &observations, plan.next.as_ref().ok_or_else(|| invalid_plan("Minion Behavior requires Next rules"))?, tick,
                    context.host_limits.max_diagnostic_events.min(plan.limits.max_diagnostic_events), None,
                    &mut diagnostics, &mut diagnostic_sequence, &mut minion_diagnostics)?;
            }
        }
        let output_attacker = call_executor(
            executor,
            attacker,
            plan,
            &allowed_capabilities,
            &memories[&CombatantSide::Attacker],
            &observations[0],
            CombatantSide::Attacker,
            tick,
            cu_spent[&CombatantSide::Attacker],
            &world,
        )?;
        let output_defender = call_executor(
            executor,
            defender,
            plan,
            &allowed_capabilities,
            &memories[&CombatantSide::Defender],
            &observations[1],
            CombatantSide::Defender,
            tick,
            cu_spent[&CombatantSide::Defender],
            &world,
        )?;

        let outputs = [
            (CombatantSide::Attacker, output_attacker),
            (CombatantSide::Defender, output_defender),
        ];
        let overrun = outputs.iter().any(|(_, output)| {
            output.status == senkei_model::TacticalExecutionStatus::BudgetExceeded
        });
        let diagnostic_bound = context.host_limits.max_diagnostic_events as usize;
        #[cfg(feature = "lab-opt-termination")]
        let compact_cost_trace = compact_cost_trace_precomputed;
        #[cfg(not(feature = "lab-opt-termination"))]
        let compact_cost_trace = compact_cost_trace_for_plan(plan);
        let proposed_output_trace_size = outputs.iter().try_fold(0_usize, |total, (_, output)| {
            let diagnostics = projected_tactical_diagnostic_count(&output.diagnostics, compact_cost_trace)?;
            let intent_events = output.intents.len().checked_mul(2)?;
            total.checked_add(diagnostics)?.checked_add(intent_events)
        });
        let proposed_trace_size = diagnostics.len()
            .checked_add(proposed_output_trace_size.ok_or_else(|| api_error(ApiErrorCode::ResourceLimit, "diagnostic event count overflowed"))?)
            .ok_or_else(|| api_error(ApiErrorCode::ResourceLimit, "diagnostic event count overflowed"))?;
        if proposed_trace_size > diagnostic_bound {
            return Err(api_error(ApiErrorCode::ResourceLimit, "diagnostic event limit exceeded"));
        }
        let abort_for_overrun = overrun
            && plan.cost_schedule.overrun_policy == senkei_model::BudgetOverrunPolicy::AbortMatch;
        let mut all_intents = Vec::new();
        let mut proposed_memory = BTreeMap::new();
        let mut charged_this_tick = BTreeMap::new();
        for (side, output) in &outputs {
            charge_tactical_diagnostics(
                &mut diagnostics,
                &mut diagnostic_sequence,
                tick,
                *side,
                &output.diagnostics,
                compact_cost_trace,
            )?;
            // CU charges are facts about work already performed. For an
            // AbortMatch overrun, retain those records while discarding both
            // sides' action and memory output.
            if !abort_for_overrun {
                for intent in &output.intents {
                    push_diagnostic(
                        &mut diagnostics,
                        &mut diagnostic_sequence,
                        tick,
                        *side,
                        DiagnosticRecord::IntentProposed { intent: intent.clone() },
                    )?;
                }
                all_intents.extend(output.intents.iter().cloned().map(|intent| (*side, intent)));
                proposed_memory.insert(*side, output.next_memory.clone());
            }
            charged_this_tick.insert(*side, output.charged_cu);
        }

        for (side, charge) in charged_this_tick {
            let prior = cu_spent[&side];
            cu_spent.insert(
                side,
                prior.checked_add(charge).ok_or_else(|| {
                    api_error(ApiErrorCode::BudgetExceeded, "logical CU total overflowed")
                })?,
            );
        }

        if abort_for_overrun {
            if (diagnostics.len() as u64).saturating_add(next_behavior.as_deref().and_then(|hook| hook.inspection.as_ref()).map_or(0, |inspection| inspection.used)) > context.host_limits.max_diagnostic_events.min(plan.limits.max_diagnostic_events) {
                return Err(api_error(ApiErrorCode::ResourceLimit, "diagnostic event limit exceeded"));
            }
            final_outcome = Some((
                MatchOutcome::Aborted,
                plan.cost_schedule.budget_overrun_reason.clone(),
                tick,
            ));
            replay_frames.push(ReplayFrame {
                tick,
                events: Vec::new(),
                visible_state: Some(presentation_view(&world, plan)),
            });
            if let Some(next) = &plan.next {
                for side in sides {
                    owner_frames.get_mut(&side).unwrap().push(ReplayFrame {
                        tick,
                        events: Vec::new(),
                        visible_state: Some(next_vision::team_view_with_fog(
                            &world, next, side, tick, fog_histories.get_mut(&side).unwrap(),
                        )),
                    });
                }
            }
            materialization.commit(tick, &replay_frames, &owner_frames, plan.next.is_some())
                .map_err(|_| api_error(ApiErrorCode::InternalError, "Hybrid output ledger rejected abort frames"))?;
            break;
        }

        // Validation is independent for each proposal; arbitration receives
        // both sides' valid intents so declared conflicts resolve together.
        let mut validated = Vec::new();
        for (side, intent) in all_intents {
            match validation::validate_intent(&intent, side, &world, plan, tick, &projection_index) {
                Ok(normalized) => validated.push((side, normalized)),
                Err(reason) => push_diagnostic(
                    &mut diagnostics,
                    &mut diagnostic_sequence,
                    tick,
                    side,
                    DiagnosticRecord::IntentRejected { intent, reason },
                )?,
            }
        }
        next_minion_control::prevalidate(plan.next.as_ref().and_then(|next| next.minion_control.as_ref()),
            context.next_minion_control.is_some(), &mut validated, &outputs, tick, &mut diagnostics, &mut diagnostic_sequence)?;
        if let Some(hook) = behavior.as_deref_mut() {
            hook.select(&mut validated, &outputs, &observations, &world, plan, tick, &projection_index, &mut diagnostics, &mut diagnostic_sequence)?;
        }
        if let Some(hook) = next_behavior.as_deref_mut() {
            hook.select(&mut validated, &outputs, &observations, &world, plan, tick, &projection_index, &mut diagnostics, &mut diagnostic_sequence)?;
        }
        let mut accepted = arbitrate(validated, plan, &world, tick, &mut diagnostics, &mut diagnostic_sequence)?;
        if next_behavior.is_some() {
            // Squad operations execute before goal orders; determine conflicts
            // from the same post-squad membership that goal application sees.
            let mut goal_world = world.clone();
            next_squads::intents(&mut goal_world, plan.next.as_ref().unwrap(), &accepted, tick);
            let scores = next_behavior.as_deref().unwrap().traces.iter().rev().take_while(|trace| trace.tick==tick).filter_map(|trace| Some(((trace.side,trace.selected.as_ref()?.action_id.clone()),trace.score?))).collect();
            let rejected = next_tactics::resolve_goal_conflicts(&goal_world, plan.next.as_ref().unwrap(), &mut accepted, &scores);
            for (side, intent) in rejected {
                let event = diagnostics.iter_mut().rev().find(|event| event.tick == tick && event.side == side && matches!(&event.record, DiagnosticRecord::IntentAccepted { intent: accepted } if *accepted == intent))
                    .ok_or_else(|| api_error(ApiErrorCode::InternalError, "missing goal arbitration diagnostic"))?;
                event.record = DiagnosticRecord::IntentRejected { intent, reason: "enbu.next_goal_conflict".into() };
            }
        }
        if let Some(hook) = next_behavior.as_deref_mut() { accepted.append(&mut hook.accepted_preferences); }
        if let Some(hook) = behavior.as_deref_mut() { hook.record_arbitration(tick, &accepted); }
        if let Some(hook) = next_behavior.as_deref_mut() { hook.record_arbitration(tick, &accepted); }
        if context.next_minion_control.is_some() {
            let next = plan.next.as_ref().ok_or_else(|| invalid_plan("Minion control requires Next rules"))?;
            let declaration = next.minion_control.as_ref().ok_or_else(|| invalid_plan("Minion control declaration missing"))?;
            let selections = next_minion_control::commit(declaration, &accepted, &mut world, next, tick, &mut diagnostics, &mut diagnostic_sequence)?;
            if let Some(hook) = minion_behavior.as_deref_mut() {
                record_minion_behavior(hook, &observations, next, tick,
                    context.host_limits.max_diagnostic_events.min(plan.limits.max_diagnostic_events), Some(&selections),
                    &mut diagnostics, &mut diagnostic_sequence, &mut minion_diagnostics)?;
            }
        }

        let accepted_sides = accepted.iter().map(|(side, _)| *side).collect::<BTreeSet<_>>();
        // Overrun output is discarded only for that side under the
        // keep-memory policy. Completed evaluations commit memory at the
        // RulePlan-selected point.
        for (side, memory) in proposed_memory {
            if outputs.iter().any(|(candidate_side, output)| {
                *candidate_side == side
                    && output.status == senkei_model::TacticalExecutionStatus::BudgetExceeded
            }) {
                continue;
            }
            if plan.cost_schedule.memory_commit_policy == senkei_model::MemoryCommitPolicy::OnAnyIntentAccepted
                && !accepted_sides.contains(&side)
            {
                continue;
            }
            validation::validate_memory(&memory, plan, &world)?;
            let previous = memories.get(&side).cloned().unwrap_or_default();
            memories.insert(side, memory.clone());
            for (state, value) in memory {
                if previous.get(&state) != Some(&value) {
                    push_diagnostic(
                        &mut diagnostics,
                        &mut diagnostic_sequence,
                        tick,
                        side,
                        DiagnosticRecord::MemoryWritten { state, value },
                    )?;
                }
            }
        }
        let accepted_by_side = accepted;
        let mut tick_events = Vec::new();
        let mut transition_outcome = apply_transitions(
            plan,
            &mut world,
            &accepted_by_side,
            tick,
            &mut tick_events,
            &mut event_count,
            context.host_limits.max_events.min(plan.limits.max_events),
            &context.match_id,
            &projection_index,
        )?;
        let before_next = presentation_view(&world, plan);
        let before_owner: BTreeMap<CombatantSide, senkei_model::WorldStateView> = plan.next.as_ref().map(|next| {
            sides.into_iter().map(|side| (side, next_vision::team_view(&world, next, side))).collect()
        }).unwrap_or_default();
        let mut next_events = Vec::new();
        let mut committed_orders = Vec::new();
        let mut capture_contest = None;
        let mut contest_observers = BTreeSet::new();
        let collector_start = actor_collector.as_deref().map_or(0, |collector| collector.records.len());
        let mut combat_event_count = 0usize;
        let combat_event_offset = objective_events.len();
        if let Some(next) = &plan.next {
            next_squads::intents(&mut world, next, &accepted_by_side, tick);
            if let Some(runtime) = relation_runtime.as_mut() { runtime.refresh(&mut world)?; }
            let orders = next_tactics::apply(&mut world, next, &accepted_by_side, tick);
            if let Some(runtime) = route_runtime.as_mut() { runtime.update_committed_orders(&orders, &accepted_by_side, &world); }
            if next_behavior.is_some() {
                for (side, event) in &orders {
                    let action_id = match event.payload.get(&"action_id".into()) { Some(DomainValue::String(id)) => id.clone(), _ => return Err(api_error(ApiErrorCode::InternalError, "committed order lacks action ID")) };
                    let order_sequence = match event.payload.get(&"sequence".into()) {
                        Some(DomainValue::Integer(value)) => u32::try_from(*value).map_err(|_| api_error(ApiErrorCode::InternalError, "committed order has invalid sequence"))?,
                        _ => return Err(api_error(ApiErrorCode::InternalError, "committed order lacks sequence")),
                    };
                    let mut details = BTreeMap::from([
                        ("owner_replay_tick".into(), tick.to_string()),
                        ("owner_replay_sequence".into(), order_sequence.to_string()),
                    ]);
                    if let Some(hook) = next_behavior.as_deref_mut() {
                        if let Some(trace) = hook.record_committed(tick, *side, &action_id, order_sequence) {
                            details.extend(hook.decision_details(&trace)?);
                        }
                    }
                    push_diagnostic(&mut diagnostics, &mut diagnostic_sequence, tick, *side, DiagnosticRecord::RuntimeNotice {
                        code: "enbu.behavior_order_committed".into(),
                        details,
                    })?;
                    let notice = diagnostics.last_mut().unwrap();
                    notice.action_id = Some(action_id.into());
                    notice.entity_id = event.entity.clone();
                }
                event_count = event_count.checked_add(orders.len() as u64).ok_or_else(|| api_error(ApiErrorCode::ResourceLimit, "event count overflow"))?;
                committed_orders = orders;
            }
            // Resolve legality and attacks from one committed position snapshot.
            // Preparation reserves an exclusive action without moving anyone.
            let action_start = world.clone();
            next_battlefield::prepare(&mut world, &action_start, next, &accepted_by_side, tick);
            #[cfg(feature = "lab-opt-frozen")]
            {
                // An accepted Skill activation is the only reason to clone a
                // reservation freeze. Preserve the unoptimized path when F
                // is disabled for exact Source/Fixture A/B measurement.
                if accepted_by_side.iter().any(|(_, intent)| {
                    let capability = intent.capability.as_str();
                    capability == "activate" || capability.ends_with(".activate")
                }) {
                    let skill_start = world.clone();
                    next_combat::prepare_actions(&mut world, &skill_start, next, &accepted_by_side, tick);
                }
            }
            #[cfg(not(feature = "lab-opt-frozen"))]
            {
                let skill_start = world.clone();
                next_combat::prepare_actions(&mut world, &skill_start, next, &accepted_by_side, tick);
            }
            // No code between action_start and adjudication_start can change
            // the world unless an accepted bridge_work or Skill activation
            // reserves a new action. Certify this by inspecting *all* accepted
            // capabilities, not by assuming the world is static.
            #[cfg(feature = "lab-opt-frozen")]
            let adjudication_start: std::borrow::Cow<'_, WorldState> =
                if accepted_by_side.iter().any(|(_, intent)| {
                    let cap = intent.capability.as_str();
                    cap == "bridge_work" || cap == "activate" || cap.ends_with(".activate")
                }) {
                    std::borrow::Cow::Owned(world.clone())
                } else {
                    std::borrow::Cow::Borrowed(&action_start)
                };
            #[cfg(not(feature = "lab-opt-frozen"))]
            let adjudication_start = world.clone();
            // The match runner has already frozen this exact pre-movement
            // World for combat adjudication. Passing it to navigation is
            // semantics-preserving and avoids a second whole-World clone
            // on every Tick, including Reference and production builds.
            // Public standalone navigation entrypoints still freeze internally.
            if let Some(runtime) = route_runtime.as_mut() {
                next_navigation::advance_with_routes_from_snapshot(&mut world, &adjudication_start, next, tick, runtime);
            } else {
                next_navigation::advance_from_snapshot(&mut world, &adjudication_start, next, tick);
            }
            next_events = if cfg!(feature = "lab-opt-scheduler") {
                next_combat::resolve_from_snapshot_scheduled(
                    &mut world, &adjudication_start, next, &accepted_by_side,
                    tick, &mut attack_frontier, actor_collector.as_deref_mut(),
                )
            } else if let Some(collector) = actor_collector.as_deref_mut() {
                next_combat::resolve_from_snapshot_with_actor_decisions(&mut world, &adjudication_start, next, &accepted_by_side, tick, collector)
            } else {
                next_combat::resolve_from_snapshot(&mut world, &adjudication_start, next, &accepted_by_side, tick)
            };
            combat_event_count = next_events.len();
            let (battlefield_events, contest) = next_battlefield::resolve(&mut world, &action_start, next, &accepted_by_side, tick);
            next_events.extend(battlefield_events);
            if let Some((id, _)) = &contest {
                if let Some(objective) = action_start.entities.get(id) {
                    let node = next_support::string(objective, "node");
                    contest_observers.extend(sides.into_iter().filter(|side| next_vision::visible_node(&action_start, next, *side, &node)));
                }
            }
            capture_contest = contest;
            next_events.splice(0..0, objective_events);
            next_squads::lifecycle_with_relationships(&mut world, next, tick, relation_runtime.as_ref())?;
            if let Some(runtime) = relation_runtime.as_mut() { runtime.refresh(&mut world)?; }
            if let Some(outcome) = next_combat::outcome(&world) { transition_outcome = Some((outcome, SymbolId::from("base_destroyed"))); }
            event_count = event_count.checked_add(next_events.len() as u64).ok_or_else(|| api_error(ApiErrorCode::ResourceLimit,"event count overflow"))?;
            if event_count > context.host_limits.max_events.min(plan.limits.max_events) { return Err(api_error(ApiErrorCode::ResourceLimit,"event limit exceeded")); }
        }
        validation::validate_world(&world, plan, context.host_limits.max_entities)?;
        if let Some(hook) = behavior.as_deref_mut() { hook.record_transition(tick); }
        if let Some(hook) = next_behavior.as_deref_mut() { hook.record_transition(tick); }
        if actor_collector.as_deref().is_some_and(|collector| collector.observation_missing()) {
            return Err(api_error(ApiErrorCode::InternalError, "actor diagnostics observation was not bound to this tick"));
        }
        if actor_collector.as_deref().is_some_and(|collector| collector.overflowed()) || (diagnostics.len() as u64).saturating_add(behavior.as_deref().map_or(0, |hook| hook.trace_records as u64)).saturating_add(next_behavior.as_deref().map_or(0, |hook| hook.traces.len() as u64)).saturating_add(next_behavior.as_deref().and_then(|hook| hook.inspection.as_ref()).map_or(0, |inspection| inspection.used)).saturating_add(minion_behavior.as_deref().map_or(0, |hook| hook.traces.len() as u64)).saturating_add(actor_collector.as_deref().map_or(0, |collector| collector.used() as u64)) > context.host_limits.max_diagnostic_events.min(plan.limits.max_diagnostic_events) {
            return Err(api_error(ApiErrorCode::ResourceLimit, "diagnostic event limit exceeded"));
        }

        let mut public_events: Vec<senkei_model::PresentationEvent> = tick_events
            .iter()
            .filter_map(|event| world::public_event(event, plan, &world))
            .collect();
        let mut replay_view = presentation_view(&world, plan);
        if plan.next.is_some() {
            if sides.into_iter().all(|side| contest_observers.contains(&side)) {
                add_contest_fact(&mut replay_view, plan, capture_contest.as_ref());
            }
            for side in sides {
                let mut owner_after = next_vision::team_view_with_fog(
                    &world,
                    plan.next.as_ref().unwrap(),
                    side,
                    tick,
                    fog_histories.get_mut(&side).unwrap(),
                );
                if contest_observers.contains(&side) { add_contest_fact(&mut owner_after, plan, capture_contest.as_ref()); }
                let owner_before = &before_owner[&side];
                let mut events = Vec::new();
                let mut combat_to_owner = BTreeMap::new();
                for (index, event) in next_events.iter().enumerate() {
                    if !event_references_known(event, owner_before, &owner_after) { continue; }
                    if index >= combat_event_offset && index - combat_event_offset < combat_event_count {
                        combat_to_owner.insert(index - combat_event_offset, events.len());
                    }
                    events.push(event.clone());
                }
                if let Some(collector) = actor_collector.as_deref_mut() {
                    let observation = observations.iter().find(|observation| observation.side == side).expect("both side observations");
                    for record in &mut collector.records[collector_start..] {
                        if record.owner != Some(side) { continue; }
                        let known = |id: &EntityId| observation.collections.values().any(|collection| {
                            matches!(collection, senkei_model::Observed::Known(items) if items.iter().any(|item| &item.id == id))
                        });
                        if record.trace.kind == AutonomousActorKind::Monster || !known(&record.trace.actor)
                            || record.trace.candidates.iter().any(|id| !known(id)) {
                            record.owner = None;
                            continue;
                        }
                        if let Some(combat_index) = record.combat_event_index {
                            if let Some(event_index) = combat_to_owner.get(&combat_index) {
                                record.trace.committed_event = Some(AutonomousCommittedEventRef { tick, event_index: *event_index });
                            } else {
                                // A hidden or filtered attack cannot be reconstructed as an owner fact.
                                record.owner = None;
                            }
                        } else if matches!(record.trace.action, AutonomousCombatAction::Attack { .. }) {
                            record.owner = None;
                        }
                    }
                }
                events.extend(committed_orders.iter().filter(|(owner,_)| *owner == side).map(|(_, event)| event.clone()));
                let frame = ReplayFrame {
                    tick,
                    events,
                    visible_state: Some(owner_after),
                };
                owner_frames.get_mut(&side).unwrap().push(frame);
            }
            public_events.extend(next_events.into_iter().filter_map(|event| {
                project_next_public_event(event, &plan.presentation, &before_next, &replay_view)
            }));
        }
        replay_frames.push(ReplayFrame {
            tick,
            events: public_events,
            visible_state: Some(replay_view),
        });

        let termination = if transition_outcome.is_some() {
            transition_outcome
        } else {
            {
                #[cfg(feature = "lab-opt-termination")]
                { evaluate_termination_indexed(plan, &world, tick, &projection_index, &ordered_termination_indices)? }
                #[cfg(not(feature = "lab-opt-termination"))]
                { evaluate_termination(plan, &world, tick, &projection_index)? }
            }
        };
        if let Some((outcome, reason)) = termination {
            final_outcome = Some((outcome, reason, tick));
        }
        materialization.commit(tick, &replay_frames, &owner_frames, plan.next.is_some())
            .map_err(|_| api_error(ApiErrorCode::InternalError, "Hybrid output ledger rejected canonical frames"))?;
    }

    let (outcome, termination_reason, final_tick) = final_outcome.unwrap_or_else(|| {
        (
            plan.termination.on_timeout,
            plan.termination.on_timeout_reason.clone(),
            max_ticks,
        )
    });
    materialization.finish(final_tick).map_err(|_| api_error(
        ApiErrorCode::InternalError, "Hybrid output ledger rejected final Tick",
    ))?;
    let final_state_digest = digest_json(&world)?;
    let result = MatchResult {
        match_id: context.match_id.clone(),
        outcome,
        termination_reason,
        final_tick,
        statistics: BTreeMap::new(),
        cu_spent: cu_spent.clone(),
        final_state_digest,
    };
    let result_digest = digest_json(&result)?;
    // serde_json::Value sorts object keys recursively, giving TypeScript the
    // same canonical JSON bytes for import-time lineage verification.
    let snapshot_digest = reproduction_snapshot_digest(attacker, defender, context)?;
    let replay = PresentationReplay {
        perspective: None,
        schema_version: validation::REPLAY_SCHEMA_VERSION,
        world_identity: context.world_identity.clone(),
        ruleset: Some(context.ruleset.clone()),
        match_id: context.match_id.clone(),
        result_digest: result_digest.clone(),
        frames: if plan.next.is_some() { project_replay_identities(replay_frames) } else { replay_frames },
    };
    let mut diagnostics = RestrictedDiagnostics {
        identity: senkei_model::RestrictedDiagnosticsIdentity {
            schema_version: 1,
            side: CombatantSide::Attacker,
            match_id: result.match_id.clone(),
            result_digest: result_digest.clone(),
            snapshot_digest: snapshot_digest.clone(),
            program_digest: attacker.program.content_digest.clone(),
        },
        events: diagnostics,
        cu_by_side: cu_spent,
        final_memory_by_side: memories,
    };
    // Keep the output creation explicit: neither private inputs nor restricted
    // diagnostics can leak through a blanket SimulationArtifact serializer.
    let reproduction = ReproductionContext {
        attacker: attacker.clone(),
        defender: defender.clone(),
        rule_package_digest: rules.package_digest().clone(),
        context: context.clone(),
    };
    let mut owner_replays = BTreeMap::new();
    let mut dropped_minion_traces = BTreeSet::new();
    let mut dropped_minion_diagnostics = BTreeSet::new();
    if plan.next.is_some() {
        for (side, frames) in owner_frames {
            let mut actor_by_tick: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
            if let Some(collector) = actor_collector.as_deref() {
                for (index, record) in collector.records.iter().enumerate() {
                    if record.owner == Some(side) { actor_by_tick.entry(record.trace.tick).or_default().push(index); }
                }
            }
            let mut minion_by_tick: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
            if let Some(hook) = minion_behavior.as_deref() {
                for (index, trace) in hook.traces.iter().enumerate() {
                    if trace.side == side { minion_by_tick.entry(trace.tick).or_default().push(index); }
                }
            }
            let frames = if actor_collector.is_some() || minion_behavior.is_some() {
                project_replay_identities_with(frames, |tick, active| {
                    let map = |id: &EntityId| active.get(id).map(|(projected, _)| projected.clone());
                    if let Some(collector) = actor_collector.as_deref_mut() {
                        for index in actor_by_tick.get(&tick).into_iter().flatten() {
                            let record = &mut collector.records[*index];
                            let Some(actor) = map(&record.trace.actor) else { record.owner = None; continue };
                            let Some(candidates) = record.trace.candidates.iter().map(map).collect::<Option<Vec<_>>>() else { record.owner = None; continue };
                            if let AutonomousCombatAction::Attack { target, .. } = &mut record.trace.action {
                                let Some(projected) = map(target) else { record.owner = None; continue };
                                *target = projected;
                            }
                            record.trace.actor = actor;
                            record.trace.candidates = candidates;
                        }
                    }
                    if let Some(hook) = minion_behavior.as_deref_mut() {
                        for index in minion_by_tick.get(&tick).into_iter().flatten() {
                            let trace = &mut hook.traces[*index];
                            let key = (side, tick, trace.actor.clone());
                            let Some(event_index) = minion_diagnostics.get(&key).copied() else { dropped_minion_traces.insert(*index); continue };
                            if let Some(actor) = map(&trace.actor) {
                                trace.actor = actor.clone();
                                diagnostics.events[event_index].entity_id = Some(actor);
                            } else {
                                dropped_minion_traces.insert(*index);
                                dropped_minion_diagnostics.insert(event_index);
                            }
                        }
                    }
                })
            } else {
                project_replay_identities(frames)
            };
            owner_replays.insert(side, PresentationReplay {
                perspective: Some(side), schema_version: validation::REPLAY_SCHEMA_VERSION,
                world_identity: context.world_identity.clone(), ruleset: Some(context.ruleset.clone()),
                match_id: context.match_id.clone(), result_digest: result_digest.clone(), frames,
            });
        }
    }
    if let Some(hook) = minion_behavior.as_deref_mut() {
        hook.traces = std::mem::take(&mut hook.traces).into_iter().enumerate().filter_map(|(index, trace)| (!dropped_minion_traces.contains(&index)).then_some(trace)).collect();
    }
    if !dropped_minion_diagnostics.is_empty() {
        diagnostics.events = std::mem::take(&mut diagnostics.events).into_iter().enumerate().filter_map(|(index, event)| (!dropped_minion_diagnostics.contains(&index)).then_some(event)).collect();
    }
    let owner_replay = owner_replays.get(&CombatantSide::Attacker).cloned();
    let diagnostic_program_digests_by_side = BTreeMap::from([
        (CombatantSide::Attacker, attacker.program.content_digest.clone()),
        (CombatantSide::Defender, defender.program.content_digest.clone()),
    ]);
    let artifact = SimulationArtifact {
        owner_replay,
        owner_replays,
        result,
        replay,
        diagnostics,
        diagnostic_snapshot_digest: snapshot_digest,
        diagnostic_program_digests_by_side,
        reproduction,
    };
    let response_size = serde_json::to_vec(&artifact.public_response())
        .map_err(|_| api_error(ApiErrorCode::InternalError, "public simulation response could not be measured"))?
        .len() as u64;
    if response_size > context.host_limits.max_output_bytes {
        return Err(api_error(ApiErrorCode::ResourceLimit, "public simulation response exceeds the host output byte limit"));
    }
    Ok(artifact)
}

fn record_minion_behavior(
    hook: &mut next_minion_behavior::Hook<'_>, observations: &[ObservationSnapshot; 2],
    rules: &senkei_model::NextRules, tick: u32, limit: u64,
    selections: Option<&next_minion_control::MinionControlSelections>,
    diagnostics: &mut Vec<DiagnosticEvent>, sequence: &mut u64,
    indexes: &mut BTreeMap<(CombatantSide, u32, EntityId), usize>,
) -> Result<(), ApiError> {
    let first_trace = hook.traces.len();
    hook.evaluate(observations, rules, tick, limit, selections)?;
    for trace in &hook.traces[first_trace..] {
        if (diagnostics.len() as u64).saturating_add(hook.traces.len() as u64) >= limit {
            return Err(api_error(ApiErrorCode::ResourceLimit, "diagnostic event limit exceeded"));
        }
        let source = match trace.source { NextMinionPreferenceSource::Army => "army", NextMinionPreferenceSource::Lane => "lane", NextMinionPreferenceSource::Jinrei => "jinrei" };
        let (status, waypoint) = match &trace.waypoint {
            NextMinionWaypoint::Ready { node } => ("ready", Some(node.clone())),
            NextMinionWaypoint::InTransit => ("in_transit", None),
            NextMinionWaypoint::EndOfLane => ("end_of_lane", None),
            NextMinionWaypoint::Unknown => ("unknown", None),
        };
        let mut details = BTreeMap::from([
            ("identity_space".into(), "owner_replay".into()),
            ("next_policy_id".into(), hook.policy.policy().policy_id.clone()),
            ("next_policy_digest".into(), hook.policy.digest().to_string()),
            ("lane".into(), trace.lane.as_str().to_owned()),
            ("source".into(), source.into()),
            ("candidate".into(), "lane_waypoint".into()),
            ("status".into(), status.into()),
        ]);
        if let Some(node) = waypoint { details.insert("waypoint".into(), node); }
        if !trace.action_ids.is_empty() {
            details.insert("action_ids".into(), serde_json::to_string(&trace.action_ids).map_err(|_| api_error(ApiErrorCode::InternalError, "could not serialize Minion control action IDs"))?);
        }
        let index = diagnostics.len();
        push_diagnostic(diagnostics, sequence, tick, trace.side, DiagnosticRecord::RuntimeNotice { code: "enbu.minion_lane_decision".into(), details })?;
        diagnostics.last_mut().unwrap().entity_id = Some(trace.actor.clone());
        indexes.insert((trace.side, tick, trace.actor.clone()), index);
    }
    Ok(())
}

fn call_executor<P: TacticalExecutionPort>(
    executor: &mut P,
    snapshot: &senkei_model::SenkeiSnapshot,
    plan: &RulePlan,
    allowed_capabilities: &BTreeSet<senkei_model::CapabilityId>,
    memory: &TacticalMemory,
    observation: &ObservationSnapshot,
    side: CombatantSide,
    tick: u32,
    spent: LogicalCu,
    world: &WorldState,
) -> Result<senkei_model::TacticalExecutionOutput, ApiError> {
    let remaining = plan.cost_schedule.per_match_budget.0.checked_sub(spent.0).ok_or_else(|| {
        api_error(ApiErrorCode::BudgetExceeded, "side exceeded the match CU budget")
    })?;
    let available_cu = LogicalCu(remaining.min(plan.cost_schedule.per_tick_budget.0));
    let output = executor
        .execute(TacticalExecutionRequest {
            side,
            tick,
            program: &snapshot.program,
            observation,
            memory,
            allowed_capabilities,
            budget: ExecutionBudget {
                available_cu,
                max_intents: plan.limits.max_intents_per_side_per_tick,
            },
        })
        .map_err(map_execution_error)?;

    if !output.charged_cu.is_json_safe() || !output.required_cu.is_json_safe() {
        return Err(api_error(ApiErrorCode::BudgetExceeded, "tactical executor returned a CU value outside the JSON-safe range"));
    }
    match output.status {
        senkei_model::TacticalExecutionStatus::Completed
            if output.required_cu.0 <= available_cu.0
                && output.charged_cu == output.required_cu => {}
        senkei_model::TacticalExecutionStatus::BudgetExceeded
            if output.required_cu.0 > available_cu.0
                && output.charged_cu == available_cu
                && output.intents.is_empty()
                && output.next_memory == *memory => {}
        senkei_model::TacticalExecutionStatus::Completed => {
            return Err(api_error(ApiErrorCode::BudgetExceeded, "completed tactical output violates CU status invariants"));
        }
        senkei_model::TacticalExecutionStatus::BudgetExceeded => {
            return Err(api_error(ApiErrorCode::BudgetExceeded, "over-budget tactical output violates CU status invariants"));
        }
    }
    if output.intents.len() > plan.limits.max_intents_per_side_per_tick as usize {
        return Err(api_error(ApiErrorCode::ResourceLimit, "tactical executor exceeded the intent limit"));
    }
    validate_cu_diagnostics(&output, plan)?;
    validation::validate_memory(&output.next_memory, plan, world)?;
    Ok(output)
}

fn map_execution_error(error: TacticalExecutionError) -> ApiError {
    let _ = error;
    ApiError::new(ApiErrorCode::RuntimeFailure, "tactical execution port failed")
}

fn validate_cu_diagnostics(
    output: &senkei_model::TacticalExecutionOutput,
    plan: &RulePlan,
) -> Result<(), ApiError> {
    let mut total = LogicalCu::ZERO;
    for diagnostic in &output.diagnostics {
        let TacticalDiagnostic::CostCharged { operation, amount } = diagnostic else { continue; };
        if !amount.is_json_safe() { return Err(api_error(ApiErrorCode::BudgetExceeded, "CU event exceeds the JSON-safe range")); }
        if !plan.cost_schedule.operations.contains_key(operation) {
            return Err(api_error(ApiErrorCode::InvalidProgram, "tactical executor reported an unknown CU operation"));
        }
        total = total.checked_add(*amount).ok_or_else(|| api_error(ApiErrorCode::BudgetExceeded, "CU diagnostic total overflowed"))?;
    }
    if total != output.charged_cu {
        return Err(api_error(ApiErrorCode::InvalidProgram, "reported CU total does not match the tactical execution output"));
    }
    Ok(())
}

fn push_diagnostic(
    events: &mut Vec<DiagnosticEvent>,
    sequence: &mut u64,
    tick: u32,
    side: CombatantSide,
    record: DiagnosticRecord,
) -> Result<(), ApiError> {
    let (action_id, entity_id) = match &record {
        DiagnosticRecord::IntentProposed { intent }
        | DiagnosticRecord::IntentAccepted { intent }
        | DiagnosticRecord::IntentRejected { intent, .. } => (
            Some(intent.action_id.clone()),
            intent.target.clone().or_else(|| intent.actor.clone()),
        ),
        _ => (None, None),
    };
    let current = *sequence;
    *sequence = sequence.checked_add(1).ok_or_else(|| {
        api_error(ApiErrorCode::ResourceLimit, "diagnostic sequence overflowed")
    })?;
    events.push(DiagnosticEvent { tick, side, sequence: current, action_id, entity_id, record });
    Ok(())
}

fn charge_tactical_diagnostics(
    events: &mut Vec<DiagnosticEvent>,
    sequence: &mut u64,
    tick: u32,
    side: CombatantSide,
    records: &[TacticalDiagnostic],
    compact_cost_trace: bool,
) -> Result<(), ApiError> {
    let mut cost_by_operation = BTreeMap::<senkei_model::CostOperationId, LogicalCu>::new();
    for record in records {
        if matches!(record, TacticalDiagnostic::IntentProposed { .. } | TacticalDiagnostic::MemoryWritten { .. }) {
            // Enbu records actions from the output list and committed memory
            // only after it has applied execution policy.
            continue;
        }
        if compact_cost_trace {
            if let TacticalDiagnostic::CostCharged { operation, amount } = record {
                let total = cost_by_operation.entry(operation.clone()).or_default();
                *total = total.checked_add(*amount).ok_or_else(|| {
                    api_error(ApiErrorCode::BudgetExceeded, "CU diagnostic total overflowed")
                })?;
                continue;
            }
        }
        let record = match record {
            TacticalDiagnostic::StateEvaluated { state, result } => DiagnosticRecord::StateEvaluated { state: state.clone(), result: *result },
            TacticalDiagnostic::IntentProposed { intent } => DiagnosticRecord::IntentProposed { intent: intent.clone() },
            TacticalDiagnostic::CostCharged { operation, amount } => DiagnosticRecord::CostCharged { operation: operation.clone(), amount: *amount },
            TacticalDiagnostic::MemoryRead { state, value } => DiagnosticRecord::MemoryRead { state: state.clone(), value: value.clone() },
            TacticalDiagnostic::MemoryWritten { state, value } => DiagnosticRecord::MemoryWritten { state: state.clone(), value: value.clone() },
            TacticalDiagnostic::RuntimeNotice { code, details } => DiagnosticRecord::RuntimeNotice { code: code.clone(), details: details.clone() },
        };
        push_diagnostic(events, sequence, tick, side, record)?;
    }
    for (operation, amount) in cost_by_operation {
        push_diagnostic(
            events,
            sequence,
            tick,
            side,
            DiagnosticRecord::CostCharged { operation, amount },
        )?;
    }
    Ok(())
}

fn compact_cost_trace_for_plan(plan: &RulePlan) -> bool {
    compact_cost_trace_for_versions(
        plan.minimum_engine_version,
        plan.next.as_ref().map(|next| next.mechanics_version),
    )
}

fn compact_cost_trace_for_versions(minimum_engine: Version, mechanics: Option<Version>) -> bool {
    minimum_engine >= Version::new(1, 2, 0)
        && mechanics == Some(Version::new(2, 0, 0))
}

fn projected_tactical_diagnostic_count(records: &[TacticalDiagnostic], compact_cost_trace: bool) -> Option<usize> {
    if !compact_cost_trace {
        return Some(records.len());
    }
    let cost_record_count = records.iter()
        .filter(|record| matches!(record, TacticalDiagnostic::CostCharged { .. }))
        .count();
    let distinct_cost_operation_count = records.iter().filter_map(|record| match record {
        TacticalDiagnostic::CostCharged { operation, .. } => Some(operation),
        _ => None,
    }).collect::<BTreeSet<_>>().len();
    records.len().checked_sub(cost_record_count)?.checked_add(distinct_cost_operation_count)
}

#[derive(Clone)]
struct InternalEvent {
    event: senkei_model::EventId,
    entity: Option<senkei_model::EntityId>,
    payload: BTreeMap<senkei_model::FieldId, senkei_model::DomainValue>,
}

fn apply_transitions(
    plan: &RulePlan,
    world: &mut WorldState,
    accepted: &[(CombatantSide, Intent)],
    tick: u32,
    events: &mut Vec<InternalEvent>,
    event_count: &mut u64,
    event_limit: u64,
    match_id: &MatchId,
    projection_index: &world::ProjectionIndex,
) -> Result<Option<(MatchOutcome, SymbolId)>, ApiError> {
    let mut phases = plan.phases.clone();
    phases.sort_by_key(|phase| (phase.order, phase.id.clone()));
    let mut transitions = plan.transitions.iter().collect::<Vec<_>>();
    transitions.sort_by_key(|rule| (rule.order, rule.id.clone()));
    let mut forced_outcome = None;

    for phase in phases.into_iter().filter(|phase| phase.kind == senkei_model::PhaseKind::Transition) {
        // A phase observes the world at its beginning. All rules and intents
        // in that phase evaluate from this frozen view before writes commit.
        let phase_world = world.clone();
        let mut effects = Vec::new();
        let mut numeric_deltas = BTreeMap::new();
        let mut write_kinds = BTreeMap::new();
        let mut removed_entities = BTreeSet::new();
        let mut structural_entities = BTreeSet::new();
        let mut next_ordinal = BTreeMap::from([
            (CombatantSide::Attacker, 0_u32),
            (CombatantSide::Defender, 0_u32),
        ]);
        let mut accepted_ordinals = Vec::with_capacity(accepted.len());
        for (side, _) in accepted {
            let ordinal = next_ordinal.get_mut(side).expect("both sides have an ordinal counter");
            accepted_ordinals.push(*ordinal);
            *ordinal = ordinal.checked_add(1).ok_or_else(|| {
                api_error(ApiErrorCode::ResourceLimit, "accepted intent ordinal overflowed")
            })?;
        }
        for rule in transitions.iter().copied().filter(|rule| rule.phase == phase.id) {
            if let Some(capability) = &rule.capability {
                for (index, (side, intent)) in accepted.iter().enumerate().filter(|(_, (_, intent))| &intent.capability == capability) {
                    let context = EvalContext {
                        side: Some(*side), intent: Some(intent), observed_entity: None,
                        projection_index: Some(projection_index), tick,
                    };
                    let condition = rule.when.as_ref()
                        .map(|expr| eval_truth(expr, &phase_world, context))
                        .transpose()?.unwrap_or(Truth::True);
                    if condition == Truth::True {
                        effects.push((rule.order, rule.id.clone(), *side, accepted_ordinals[index], Some(intent.clone()), rule.operations.clone()));
                    }
                }
            } else {
                let condition = rule.when.as_ref()
                    .map(|expr| eval_truth(expr, &phase_world, EvalContext::global(projection_index, tick)))
                    .transpose()?.unwrap_or(Truth::True);
                if condition == Truth::True {
                    effects.push((rule.order, rule.id.clone(), CombatantSide::Attacker, 0, None, rule.operations.clone()));
                }
            }
        }
        effects.sort_by_key(|(order, id, side, ordinal, _, _)| (*order, id.clone(), *side, *ordinal));
        for (_, rule_id, side, ordinal, intent, operations) in effects {
            for (index, operation) in operations.iter().enumerate() {
                let operation_index = u32::try_from(index).map_err(|_| {
                    api_error(ApiErrorCode::ResourceLimit, "transition operation index overflowed")
                })?;
                apply_primitive(
                    plan, world, &phase_world, side, &rule_id, ordinal, operation_index,
                    intent.as_ref(), operation, events, event_count, event_limit, match_id,
                    tick, projection_index, &mut forced_outcome, &mut numeric_deltas,
                    &mut write_kinds, &mut removed_entities, &mut structural_entities,
                )?;
            }
        }
        flush_numeric_deltas(plan, world, &mut numeric_deltas)?;
    }
    Ok(forced_outcome)
}

fn apply_primitive(
    plan: &RulePlan,
    world: &mut WorldState,
    phase_world: &WorldState,
    side: CombatantSide,
    rule_id: &senkei_model::RuleId,
    accepted_intent_ordinal: u32,
    operation_index: u32,
    intent: Option<&Intent>,
    operation: &senkei_model::TransitionPrimitive,
    events: &mut Vec<InternalEvent>,
    event_count: &mut u64,
    event_limit: u64,
    match_id: &MatchId,
    tick: u32,
    projection_index: &world::ProjectionIndex,
    forced_outcome: &mut Option<(MatchOutcome, SymbolId)>,
    numeric_deltas: &mut BTreeMap<NumericWriteTarget, NumericDelta>,
    write_kinds: &mut BTreeMap<NumericWriteTarget, NumericWriteKind>,
    removed_entities: &mut BTreeSet<senkei_model::EntityId>,
    structural_entities: &mut BTreeSet<senkei_model::EntityId>,
) -> Result<(), ApiError> {
    use senkei_model::TransitionPrimitive as P;
    let eval_context = EvalContext {
        side: intent.map(|_| side), intent, observed_entity: None,
        projection_index: Some(projection_index), tick,
    };
    match operation {
        P::SetField { target, field, value } => {
            let entity = select_entity(target, eval_context, phase_world)?;
            let target_key = NumericWriteTarget::Entity(entity.clone(), field.clone());
            register_write(write_kinds, &target_key, NumericWriteKind::Set)?;
            ensure_not_structural(removed_entities, structural_entities, &entity)?;
            let value = required_value(eval_value(value, phase_world, eval_context)?)?;
            let state = world.entities.get_mut(&entity).ok_or_else(|| invalid_plan("transition targets a missing entity"))?;
            if !plan.world.entity_types.get(&state.entity_type).and_then(|schema| schema.fields.get(field)).is_some_and(|schema| schema.writable) {
                return Err(invalid_plan("transition writes an undeclared or read-only entity field"));
            }
            state.fields.insert(field.clone(), value);
        }
        P::AddInteger { target, field, amount } => {
            let entity = select_entity(target, eval_context, phase_world)?;
            let target_key = NumericWriteTarget::Entity(entity.clone(), field.clone());
            register_write(write_kinds, &target_key, NumericWriteKind::IntegerAdd)?;
            ensure_not_structural(removed_entities, structural_entities, &entity)?;
            let amount = required_value(eval_value(amount, phase_world, eval_context)?)?;
            let DomainValue::Integer(amount) = amount else { return Err(invalid_plan("integer addition received a non-integer")); };
            let state = world.entities.get(&entity).ok_or_else(|| invalid_plan("integer transition targets a missing entity"))?;
            if !plan.world.entity_types.get(&state.entity_type).and_then(|schema| schema.fields.get(field)).is_some_and(|schema| schema.writable) {
                return Err(invalid_plan("transition writes an undeclared or read-only entity field"));
            }
            add_delta(numeric_deltas, target_key, NumericDelta::Integer(i128::from(amount)))?;
        }
        P::AddFixed { target, field, amount } => {
            let entity = select_entity(target, eval_context, phase_world)?;
            let target_key = NumericWriteTarget::Entity(entity.clone(), field.clone());
            register_write(write_kinds, &target_key, NumericWriteKind::FixedAdd)?;
            ensure_not_structural(removed_entities, structural_entities, &entity)?;
            let amount = required_value(eval_value(amount, phase_world, eval_context)?)?;
            let DomainValue::Fixed { coefficient, scale } = amount else { return Err(invalid_plan("fixed addition received a non-fixed value")); };
            let state = world.entities.get(&entity).ok_or_else(|| invalid_plan("fixed transition targets a missing entity"))?;
            if !plan.world.entity_types.get(&state.entity_type).and_then(|schema| schema.fields.get(field)).is_some_and(|schema| schema.writable) {
                return Err(invalid_plan("transition writes an undeclared or read-only entity field"));
            }
            add_delta(numeric_deltas, target_key, NumericDelta::Fixed { coefficient: i128::from(coefficient), scale })?;
        }
        P::SetGlobalField { field, value } => {
            let target = NumericWriteTarget::Global(field.clone());
            register_write(write_kinds, &target, NumericWriteKind::Set)?;
            if !plan.world.global_fields.get(field).is_some_and(|schema| schema.writable) {
                return Err(invalid_plan("transition writes an undeclared or read-only global field"));
            }
            world.global_fields.insert(field.clone(), required_value(eval_value(value, phase_world, eval_context)?)?);
        }
        P::AddGlobalInteger { field, amount } => {
            let target = NumericWriteTarget::Global(field.clone());
            register_write(write_kinds, &target, NumericWriteKind::IntegerAdd)?;
            if !plan.world.global_fields.get(field).is_some_and(|schema| schema.writable) {
                return Err(invalid_plan("transition writes an undeclared or read-only global field"));
            }
            let amount = required_value(eval_value(amount, phase_world, eval_context)?)?;
            let DomainValue::Integer(amount) = amount else { return Err(invalid_plan("integer global addition received a non-integer")); };
            if !world.global_fields.contains_key(field) { return Err(invalid_plan("integer global field is missing")); }
            add_delta(numeric_deltas, target, NumericDelta::Integer(i128::from(amount)))?;
        }
        P::CreateEntity { id: id_source, entity_type, owner, fields } => {
            if *id_source != senkei_model::EntityIdSource::DeterministicInvocation {
                return Err(api_error(ApiErrorCode::UnsupportedPrimitive, "unsupported runtime entity ID source"));
            }
            let mut values = BTreeMap::new();
            for (field, value) in fields { values.insert(field.clone(), required_value(eval_value(value, phase_world, eval_context)?)?); }
            let id = senkei_model::derive_invocation_entity_id(match_id, tick, side, rule_id, accepted_intent_ordinal, operation_index);
            let resolved_owner = match owner {
                senkei_model::EntityOwnerSource::Unowned => None,
                senkei_model::EntityOwnerSource::Fixed(owner) => Some(*owner),
                senkei_model::EntityOwnerSource::IntentSide => Some(intent.map(|_| side)
                    .ok_or_else(|| invalid_plan("IntentSide owner requires an accepted intent"))?),
            };
            if world.entities.contains_key(&id) || !structural_entities.insert(id.clone()) {
                return Err(conflict_error("runtime entity ID collides with an existing or same-phase entity"));
            }
            if write_kinds.keys().any(|key| matches!(key, NumericWriteTarget::Entity(existing, _) if existing == &id)) {
                return Err(conflict_error("entity creation conflicts with a same-phase field mutation"));
            }
            let schema = plan.world.entity_types.get(entity_type).ok_or_else(|| invalid_plan("created entity type is undeclared"))?;
            if fields.keys().any(|field| !schema.fields.contains_key(field)) {
                return Err(invalid_plan("created entity contains an undeclared field"));
            }
            world.entities.insert(id, senkei_model::EntityState { entity_type: entity_type.clone(), owner: resolved_owner, fields: values });
        }
        P::RemoveEntity { target } => {
            let entity = select_entity(target, eval_context, phase_world)?;
            if !removed_entities.insert(entity.clone())
                || !structural_entities.insert(entity.clone())
                || write_kinds.keys().any(|key| matches!(key, NumericWriteTarget::Entity(id, _) if id == &entity))
            {
                return Err(conflict_error("entity removal conflicts with another same-phase entity mutation"));
            }
            world.entities.remove(&entity);
        }
        P::AppendCollection { collection, value } => {
            let value = required_value(eval_value(value, phase_world, eval_context)?)?;
            world.collections.get_mut(collection).ok_or_else(|| invalid_plan("transition targets a missing collection"))?.push(value);
        }
        P::RemoveCollectionValue { collection, value } => {
            let value = required_value(eval_value(value, phase_world, eval_context)?)?;
            if let Some(values) = world.collections.get_mut(collection) { values.retain(|candidate| candidate != &value); }
        }
        P::EmitEvent { event, payload } => {
            *event_count = event_count.checked_add(1).ok_or_else(|| api_error(ApiErrorCode::ResourceLimit, "event count overflowed"))?;
            if *event_count > event_limit { return Err(api_error(ApiErrorCode::ResourceLimit, "event limit exceeded")); }
            let mut values = BTreeMap::new();
            for (field, value) in payload { values.insert(field.clone(), required_value(eval_value(value, phase_world, eval_context)?)?); }
            events.push(InternalEvent { event: event.clone(), entity: intent.and_then(|i| i.target.clone().or_else(|| i.actor.clone())), payload: values });
        }
        P::SetOutcome { outcome, reason } => {
            let value = required_value(eval_value(outcome, phase_world, eval_context)?)?;
            let outcome = match &value {
                DomainValue::Enum(value) => match value.as_str() {
                    "attacker_victory" => MatchOutcome::AttackerVictory,
                    "defender_victory" => MatchOutcome::DefenderVictory,
                    "draw" => MatchOutcome::Draw,
                    "aborted" => MatchOutcome::Aborted,
                    _ => return Err(invalid_plan("set_outcome expression produced an unknown outcome tag")),
                },
                _ => return Err(invalid_plan("set_outcome expression must produce a match outcome enum")),
            };
            *forced_outcome = Some((outcome, reason.clone()));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum NumericWriteTarget {
    Entity(senkei_model::EntityId, senkei_model::FieldId),
    Global(senkei_model::FieldId),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NumericWriteKind {
    Set,
    IntegerAdd,
    FixedAdd,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NumericDelta {
    Integer(i128),
    Fixed { coefficient: i128, scale: u8 },
}

fn add_delta(
    pending: &mut BTreeMap<NumericWriteTarget, NumericDelta>,
    target: NumericWriteTarget,
    amount: NumericDelta,
) -> Result<(), ApiError> {
    match pending.entry(target) {
        std::collections::btree_map::Entry::Vacant(entry) => {
            entry.insert(amount);
        }
        std::collections::btree_map::Entry::Occupied(mut entry) => match (entry.get_mut(), amount) {
            (NumericDelta::Integer(current), NumericDelta::Integer(add)) => {
                *current = current.checked_add(add).ok_or_else(|| arithmetic_error("integer delta aggregate overflowed"))?;
            }
            (NumericDelta::Fixed { coefficient, scale }, NumericDelta::Fixed { coefficient: add, scale: add_scale }) if *scale == add_scale => {
                *coefficient = coefficient.checked_add(add).ok_or_else(|| arithmetic_error("fixed delta aggregate overflowed"))?;
            }
            _ => return Err(conflict_error("incompatible additive writes target the same field in one transition phase")),
        },
    }
    Ok(())
}

fn register_write(
    writes: &mut BTreeMap<NumericWriteTarget, NumericWriteKind>,
    target: &NumericWriteTarget,
    kind: NumericWriteKind,
) -> Result<(), ApiError> {
    match writes.get(target) {
        None => { writes.insert(target.clone(), kind); Ok(()) }
        Some(NumericWriteKind::IntegerAdd) if kind == NumericWriteKind::IntegerAdd => Ok(()),
        Some(NumericWriteKind::FixedAdd) if kind == NumericWriteKind::FixedAdd => Ok(()),
        _ => Err(conflict_error("transition writes conflict on the same field within one phase")),
    }
}

fn ensure_not_structural(
    removed: &BTreeSet<senkei_model::EntityId>,
    structural: &BTreeSet<senkei_model::EntityId>,
    entity: &senkei_model::EntityId,
) -> Result<(), ApiError> {
    if removed.contains(entity) || structural.contains(entity) {
        Err(conflict_error("entity mutation conflicts with same-phase creation or removal"))
    } else {
        Ok(())
    }
}

fn flush_numeric_deltas(
    plan: &RulePlan,
    world: &mut WorldState,
    pending: &mut BTreeMap<NumericWriteTarget, NumericDelta>,
) -> Result<(), ApiError> {
    let targets = pending.keys().cloned().collect::<Vec<_>>();
    for target in targets { flush_numeric_delta(plan, world, pending, &target)?; }
    Ok(())
}

fn flush_numeric_delta(
    plan: &RulePlan,
    world: &mut WorldState,
    pending: &mut BTreeMap<NumericWriteTarget, NumericDelta>,
    target: &NumericWriteTarget,
) -> Result<(), ApiError> {
    let Some(delta) = pending.remove(target) else { return Ok(()); };
    let (current, value_type) = match target {
        NumericWriteTarget::Entity(id, field) => {
            let entity = world.entities.get(id).ok_or_else(|| invalid_plan("numeric transition targets a missing entity"))?;
            let current = entity.fields.get(field).ok_or_else(|| invalid_plan("integer field is missing"))?;
            let value_type = &plan.world.entity_types.get(&entity.entity_type)
                .and_then(|schema| schema.fields.get(field)).ok_or_else(|| invalid_plan("numeric transition targets an undeclared field"))?.value_type;
            (current.clone(), value_type)
        }
        NumericWriteTarget::Global(field) => {
            let current = world.global_fields.get(field).ok_or_else(|| invalid_plan("integer global field is missing"))?;
            let field_schema = plan.world.global_fields.get(field)
                .ok_or_else(|| invalid_plan("numeric transition targets an undeclared global field"))?;
            (current.clone(), &field_schema.value_type)
        }
    };
    let result = match (current, value_type, delta) {
        (DomainValue::Integer(current), senkei_model::DomainType::Integer { min, max }, NumericDelta::Integer(delta)) => {
            DomainValue::Integer(clamp_integer(i128::from(current), delta, *min, *max)?)
        }
        (DomainValue::Fixed { coefficient: current, scale }, senkei_model::DomainType::Fixed { scale: expected, min, max }, NumericDelta::Fixed { coefficient, scale: delta_scale }) if scale == *expected && scale == delta_scale => {
            DomainValue::Fixed { coefficient: clamp_integer(i128::from(current), coefficient, *min, *max)?, scale }
        }
        _ => return Err(invalid_plan("numeric transition does not match the target field schema")),
    };
    match target {
        NumericWriteTarget::Entity(id, field) => {
            world.entities.get_mut(id).ok_or_else(|| invalid_plan("numeric transition target disappeared"))?.fields.insert(field.clone(), result);
        }
        NumericWriteTarget::Global(field) => { world.global_fields.insert(field.clone(), result); }
    }
    Ok(())
}

fn clamp_integer(base: i128, delta: i128, min: Option<i64>, max: Option<i64>) -> Result<i64, ApiError> {
    let raw = base.checked_add(delta).ok_or_else(|| arithmetic_error("numeric transition arithmetic overflowed"))?;
    let lower = min.map(i128::from).unwrap_or(i128::from(i64::MIN));
    let upper = max.map(i128::from).unwrap_or(i128::from(i64::MAX));
    if lower > upper { return Err(invalid_plan("numeric field schema has an invalid range")); }
    let value = i64::try_from(raw.max(lower).min(upper)).map_err(|_| invalid_plan("numeric transition result is outside the representable range"))?;
    Ok(value)
}

#[cfg(feature = "lab-opt-termination")]
fn evaluate_termination_indexed(
    plan: &RulePlan,
    world: &WorldState,
    tick: u32,
    projection_index: &world::ProjectionIndex,
    ordered_indices: &[usize],
) -> Result<Option<(MatchOutcome, SymbolId)>, ApiError> {
    for &index in ordered_indices {
        let condition = &plan.termination.conditions[index];
        if eval_truth(&condition.when, world, EvalContext::global(projection_index, tick))? == Truth::True {
            return Ok(Some((condition.outcome, condition.reason.clone())));
        }
    }
    Ok(None)
}

fn evaluate_termination(
    plan: &RulePlan,
    world: &WorldState,
    tick: u32,
    projection_index: &world::ProjectionIndex,
) -> Result<Option<(MatchOutcome, SymbolId)>, ApiError> {
    let mut conditions = plan.termination.conditions.iter().collect::<Vec<_>>();
    conditions.sort_by_key(|condition| condition.order);
    for condition in conditions {
        if eval_truth(&condition.when, world, EvalContext::global(projection_index, tick))? == Truth::True {
            return Ok(Some((condition.outcome, condition.reason.clone())));
        }
    }
    Ok(None)
}

fn arbitrate(
    candidates: Vec<(CombatantSide, Intent)>,
    plan: &RulePlan,
    world: &WorldState,
    tick: u32,
    diagnostics: &mut Vec<DiagnosticEvent>,
    sequence: &mut u64,
) -> Result<Vec<(CombatantSide, Intent)>, ApiError> {
    let mut by_capability: BTreeMap<senkei_model::CapabilityId, Vec<(CombatantSide, Intent)>> = BTreeMap::new();
    for candidate in candidates { by_capability.entry(candidate.1.capability.clone()).or_default().push(candidate); }
    let mut accepted_all = Vec::new();
    let use_actor_orders = !plan.actor_intent_orders.is_empty();
    let mut per_capability_decisions = Vec::new();
    for (capability, group) in by_capability {
        let Some(rule) = plan.arbitration.get(&capability) else {
            return Err(invalid_plan("validated capability has no arbitration rule"));
        };
        for (side, intent, accepted) in arbitrate_group(group, rule) {
            if use_actor_orders {
                let index = per_capability_decisions.len();
                per_capability_decisions.push((index, side, intent, accepted));
            } else {
                // Keep the pre-extension diagnostic order exactly as it was:
                // each per-capability group records accepted/rejected outcomes
                // before the next capability is processed.
                if accepted {
                    push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::IntentAccepted { intent: intent.clone() })?;
                    accepted_all.push((side, intent));
                } else {
                    push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::IntentRejected { intent, reason: SymbolId::from("enbu.arbitration_rejected") })?;
                }
            }
        }
    }

    if use_actor_orders {
        let actor_candidates = per_capability_decisions.iter()
            .filter(|(_, _, _, accepted)| *accepted)
            .map(|(index, side, intent, _)| (*index, *side, intent.clone()))
            .collect();
        let actor_results = arbitrate_actor_orders(actor_candidates, plan, world)?;
        let mut actor_acceptance = vec![None; per_capability_decisions.len()];
        for (index, _, _, accepted) in actor_results {
            let Some(slot) = actor_acceptance.get_mut(index) else {
                return Err(invalid_plan("actor arbitration returned an unknown candidate"));
            };
            if slot.replace(accepted).is_some() {
                return Err(invalid_plan("actor arbitration returned a candidate more than once"));
            }
        }
        let mut accepted = Vec::new();
        for (index, side, intent, package_accepted) in per_capability_decisions {
            let is_accepted = if package_accepted {
                actor_acceptance.get(index).and_then(|value| *value)
                    .ok_or_else(|| invalid_plan("actor arbitration omitted an accepted candidate"))?
            } else {
                false
            };
            if is_accepted {
                push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::IntentAccepted { intent: intent.clone() })?;
                accepted.push((side, intent));
            } else {
                push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::IntentRejected { intent, reason: SymbolId::from("enbu.arbitration_rejected") })?;
            }
        }
        accepted.sort_by(|(a_side, a), (b_side, b)| canonical_intent_order(a, *a_side, b, *b_side));
        return Ok(accepted);
    }

    accepted_all.sort_by(|(a_side, a), (b_side, b)| canonical_intent_order(a, *a_side, b, *b_side));
    Ok(accepted_all)
}

/// Apply the same RulePlan arbitration primitive to either a per-capability
/// group or an authored cross-capability actor group. The returned order is
/// the decision order; callers own only how final status is recorded.
fn arbitrate_group(
    group: Vec<(CombatantSide, Intent)>,
    rule: &senkei_model::ArbitrationRule,
) -> Vec<(CombatantSide, Intent, bool)> {
    arbitrate_indexed_group(
        group.into_iter().enumerate().map(|(index, (side, intent))| (index, side, intent)).collect(),
        rule,
    ).into_iter().map(|(_, side, intent, accepted)| (side, intent, accepted)).collect()
}

fn arbitrate_indexed_group(
    mut group: Vec<(usize, CombatantSide, Intent)>,
    rule: &senkei_model::ArbitrationRule,
) -> Vec<(usize, CombatantSide, Intent, bool)> {
    group.sort_by(|(_, a_side, a), (_, b_side, b)| canonical_intent_order(a, *a_side, b, *b_side));
    let mut rejected = BTreeSet::new();
    match &rule.resolution {
        senkei_model::ArbitrationResolution::AllowAll { max_accepted } => {
            for index in *max_accepted as usize..group.len() { rejected.insert(index); }
        }
        senkei_model::ArbitrationResolution::RejectConflicts => {
            for left in 0..group.len() { for right in left + 1..group.len() {
                if keys_conflict_indexed(&group[left], &group[right], &rule.conflict_keys) { rejected.insert(left); rejected.insert(right); }
            }}
        }
        senkei_model::ArbitrationResolution::SelectOrdered { sort_by, max_accepted } => {
            group.sort_by(|(_, a_side, a), (_, b_side, b)| compare_intents(a, *a_side, b, *b_side, sort_by));
            let mut chosen: Vec<usize> = Vec::new();
            for index in 0..group.len() {
                if chosen.len() >= *max_accepted as usize || chosen.iter().any(|&prior| keys_conflict_indexed(&group[prior], &group[index], &rule.conflict_keys)) {
                    rejected.insert(index);
                } else { chosen.push(index); }
            }
        }
    }
    group.into_iter().enumerate().map(|(position, (index, side, intent))| {
        let accepted = !rejected.contains(&position);
        (index, side, intent, accepted)
    }).collect()
}

fn arbitrate_actor_orders(
    candidates: Vec<(usize, CombatantSide, Intent)>,
    plan: &RulePlan,
    world: &WorldState,
) -> Result<Vec<(usize, CombatantSide, Intent, bool)>, ApiError> {
    let mut groups = BTreeMap::<(CombatantSide, EntityId, Option<senkei_model::ActorControlScope>, senkei_model::TypeId), Vec<(usize, CombatantSide, Intent)>>::new();
    let mut untyped = Vec::new();
    for candidate in candidates {
        let Some(capability) = plan.domain.capabilities.get(&candidate.2.capability) else {
            return Err(invalid_plan("accepted capability disappeared from the verified schema"));
        };
        let Some(actor_index) = capability.actor_argument else {
            untyped.push(candidate);
            continue;
        };
        let Some(actor_argument) = capability.arguments.get(actor_index as usize) else {
            return Err(invalid_plan("verified capability actor argument is out of range"));
        };
        let senkei_model::DomainType::Entity { entity_type: Some(actor_type) } = &actor_argument.value_type else {
            untyped.push(candidate);
            continue;
        };
        if actor_argument.optional {
            untyped.push(candidate);
            continue;
        }
        let Some(actor_id) = candidate.2.actor.clone() else {
            return Err(invalid_plan("legal typed-actor intent has no normalized actor"));
        };
        let Some(actor) = world.entities.get(&actor_id) else {
            return Err(invalid_plan("legal typed-actor intent references no current actor"));
        };
        if &actor.entity_type != actor_type {
            return Err(invalid_plan("legal typed-actor intent does not match the current actor type"));
        }
        if plan.actor_intent_orders.iter().any(|order| {
            order.capabilities.contains(&candidate.2.capability) && order.actor_type != *actor_type
        }) {
            return Err(invalid_plan("compiled actor order capability has a different typed actor"));
        }
        let scopes = plan.actor_intent_orders.iter()
            .filter(|order| order.actor_type == *actor_type)
            .map(|order| order.scope)
            .collect::<BTreeSet<_>>();
        if scopes.len() > 1 {
            return Err(invalid_plan("compiled actor type has contradictory actor scopes"));
        }
        let scope = scopes.iter().next().copied();
        groups.entry((candidate.1, actor_id, scope, actor_type.clone())).or_default().push(candidate);
    }

    let mut results = untyped.into_iter().map(|(index, side, intent)| (index, side, intent, true)).collect::<Vec<_>>();
    for ((side, _actor_id, scope, actor_type), group) in groups {
        if group.len() == 1 {
            let (index, side, intent) = group.into_iter().next().expect("singleton group");
            results.push((index, side, intent, true));
            continue;
        }
        let capabilities = group.iter().map(|(_, _, intent)| intent.capability.clone()).collect::<BTreeSet<_>>();
        if capabilities.len() == 1 {
            // Existing per-capability arbitration owns same-capability
            // candidates. Cross-capability metadata never reselects them.
            results.extend(group.into_iter().map(|(index, side, intent)| (index, side, intent, true)));
            continue;
        }
        let domain_orders = plan.actor_intent_orders.iter().filter(|order| {
            Some(order.scope) == scope && order.actor_type == actor_type
        }).collect::<Vec<_>>();
        if domain_orders.is_empty() {
            // This actor domain has no authored cross-capability policy. Keep
            // the already accepted per-capability candidates unchanged.
            results.extend(group.into_iter().map(|(index, side, intent)| (index, side, intent, true)));
            continue;
        }
        let applicable = domain_orders.iter().copied().filter(|order| {
            capabilities.is_subset(&order.capabilities)
        }).collect::<Vec<_>>();
        if applicable.len() != 1 {
            return Err(invalid_plan("legal actor-local capability conflict has no unique complete authored order"));
        }
        let order = applicable[0];
        let senkei_model::ArbitrationResolution::SelectOrdered { sort_by, max_accepted: 1 } = &order.arbitration.resolution else {
            return Err(invalid_plan("authored actor order must select exactly one candidate"));
        };
        if order.arbitration.conflict_keys != [senkei_model::IntentKey::Actor]
            && order.arbitration.conflict_keys != [senkei_model::IntentKey::Side, senkei_model::IntentKey::Actor]
        {
            return Err(invalid_plan("authored actor order has invalid actor-local conflict keys"));
        }
        for (_, _, intent) in &group {
            if sort_by.iter().any(|term| key_value(intent, side, &term.key).is_none()) {
                return Err(invalid_plan("authored actor order is missing a required sort key"));
            }
        }
        let mut ordered = group.clone();
        ordered.sort_by(|(_, left_side, left), (_, right_side, right)| compare_intent_terms(left, *left_side, right, *right_side, sort_by));
        if ordered.windows(2).any(|pair| {
            compare_intent_terms(&pair[0].2, pair[0].1, &pair[1].2, pair[1].1, sort_by) == std::cmp::Ordering::Equal
        }) {
            return Err(invalid_plan("authored actor order does not distinguish all legal candidates"));
        }
        let group_results = arbitrate_indexed_group(group, &order.arbitration);
        if group_results.iter().filter(|(_, _, _, accepted)| *accepted).count() != 1 {
            return Err(invalid_plan("authored actor order failed to select exactly one legal candidate"));
        }
        results.extend(group_results);
    }
    Ok(results)
}

fn keys_conflict_indexed(
    a: &(usize, CombatantSide, Intent),
    b: &(usize, CombatantSide, Intent),
    keys: &[senkei_model::IntentKey],
) -> bool {
    !keys.is_empty() && keys.iter().all(|key| key_value(&a.2, a.1, key) == key_value(&b.2, b.1, key))
}

fn key_value(intent: &Intent, side: CombatantSide, key: &senkei_model::IntentKey) -> Option<senkei_model::DomainValue> {
    use senkei_model::IntentKey as K;
    match key {
        K::Priority => intent.priority.map(|v| senkei_model::DomainValue::Integer(v)),
        K::Side => Some(senkei_model::DomainValue::Enum(SymbolId::from(match side { CombatantSide::Attacker => "attacker", CombatantSide::Defender => "defender" }))),
        K::Actor => intent.actor.clone().map(senkei_model::DomainValue::Entity),
        K::Target => intent.target.clone().map(senkei_model::DomainValue::Entity),
        K::ActionId => Some(senkei_model::DomainValue::String(intent.action_id.to_string())),
        K::Capability => Some(senkei_model::DomainValue::String(intent.capability.to_string())),
        K::Argument(index) => intent.arguments.get(*index as usize).cloned(),
    }
}

fn compare_intents(
    a: &Intent,
    a_side: CombatantSide,
    b: &Intent,
    b_side: CombatantSide,
    terms: &[senkei_model::IntentSortTerm],
) -> std::cmp::Ordering {
    let order = compare_intent_terms(a, a_side, b, b_side, terms);
    if order != std::cmp::Ordering::Equal {
        return order;
    }
    canonical_intent_order(a, a_side, b, b_side)
}

fn compare_intent_terms(
    a: &Intent,
    a_side: CombatantSide,
    b: &Intent,
    b_side: CombatantSide,
    terms: &[senkei_model::IntentSortTerm],
) -> std::cmp::Ordering {
    for term in terms {
        let left = key_value(a, a_side, &term.key);
        let right = key_value(b, b_side, &term.key);
        let mut order = compare_optional_values(&left, &right);
        if term.direction == senkei_model::SortDirection::Descending { order = order.reverse(); }
        if order != std::cmp::Ordering::Equal { return order; }
    }
    std::cmp::Ordering::Equal
}

fn canonical_intent_order(
    a: &Intent,
    a_side: CombatantSide,
    b: &Intent,
    b_side: CombatantSide,
) -> std::cmp::Ordering {
    (a_side, &a.action_id, &a.actor, &a.target, &a.capability, &a.arguments)
        .cmp(&(b_side, &b.action_id, &b.actor, &b.target, &b.capability, &b.arguments))
}

fn compare_optional_values(a: &Option<DomainValue>, b: &Option<DomainValue>) -> std::cmp::Ordering {
    match (a, b) {
        (None, None) => std::cmp::Ordering::Equal,
        (Some(_), None) => std::cmp::Ordering::Greater,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (Some(a), Some(b)) => a.cmp(b),
    }
}

pub(crate) fn eval_truth(expression: &RuleExpression, world: &WorldState, context: EvalContext<'_>) -> Result<Truth, ApiError> {
    use RuleExpression as E;
    match expression {
        E::And(items) => {
            let values = items.iter().map(|item| eval_truth(item, world, context)).collect::<Result<Vec<_>, _>>()?;
            if values.contains(&Truth::False) { Ok(Truth::False) }
            else if values.contains(&Truth::Unknown) { Ok(Truth::Unknown) }
            else { Ok(Truth::True) }
        }
        E::Or(items) => {
            let values = items.iter().map(|item| eval_truth(item, world, context)).collect::<Result<Vec<_>, _>>()?;
            if values.contains(&Truth::True) { Ok(Truth::True) }
            else if values.contains(&Truth::Unknown) { Ok(Truth::Unknown) }
            else { Ok(Truth::False) }
        }
        E::Not(inner) => Ok(match eval_truth(inner, world, context)? { Truth::True => Truth::False, Truth::False => Truth::True, Truth::Unknown => Truth::Unknown }),
        E::Equal { left, right } => Ok(match (eval_value(left, world, context)?, eval_value(right, world, context)?) { (Some(a), Some(b)) if a == b => Truth::True, (Some(_), Some(_)) => Truth::False, _ => Truth::Unknown }),
        E::LessThan { left, right } => {
            let (Some(a), Some(b)) = (eval_value(left, world, context)?, eval_value(right, world, context)?) else { return Ok(Truth::Unknown); };
            Ok(match compare_values(&a, &b) { Some(std::cmp::Ordering::Less) => Truth::True, Some(_) => Truth::False, None => return Err(invalid_plan("less_than compared incompatible or non-orderable values")) })
        }
        _ => Ok(match eval_value(expression, world, context)? { Some(senkei_model::DomainValue::Bool(true)) => Truth::True, Some(senkei_model::DomainValue::Bool(false)) => Truth::False, Some(DomainValue::Null) | None => Truth::Unknown, _ => return Err(invalid_plan("condition expression did not produce a boolean")) }),
    }
}

pub(crate) fn eval_value(expression: &RuleExpression, world: &WorldState, context: EvalContext<'_>) -> Result<Option<senkei_model::DomainValue>, ApiError> {
    use RuleExpression as E;
    Ok(match expression {
        E::Literal(value) => Some(value.clone()),
        E::CurrentTick => Some(DomainValue::Integer(i64::from(context.tick))),
        E::IntentArgument(index) => context.intent.and_then(|intent| intent.arguments.get(*index as usize).cloned()),
        E::Field { target, field } => {
            let entity = select_entity(target, context, world)?;
            world.entities.get(&entity).and_then(|state| state.fields.get(field)).cloned()
        }
        E::GlobalField(field) => world.global_fields.get(field).cloned(),
        E::AddInteger { left, right } => match (eval_value(left, world, context)?, eval_value(right, world, context)?) {
            (Some(senkei_model::DomainValue::Integer(a)), Some(senkei_model::DomainValue::Integer(b))) => Some(senkei_model::DomainValue::Integer(a.checked_add(b).ok_or_else(|| arithmetic_error("integer expression overflowed"))?)),
            _ => return Ok(None),
        },
        E::SubtractInteger { left, right } => match (eval_value(left, world, context)?, eval_value(right, world, context)?) {
            (Some(senkei_model::DomainValue::Integer(a)), Some(senkei_model::DomainValue::Integer(b))) => Some(senkei_model::DomainValue::Integer(a.checked_sub(b).ok_or_else(|| arithmetic_error("integer expression overflowed"))?)),
            _ => return Ok(None),
        },
        E::AddFixed { left, right } => match (eval_value(left, world, context)?, eval_value(right, world, context)?) {
            (Some(senkei_model::DomainValue::Fixed { coefficient: a, scale: a_scale }), Some(senkei_model::DomainValue::Fixed { coefficient: b, scale: b_scale })) if a_scale == b_scale => Some(senkei_model::DomainValue::Fixed { coefficient: a.checked_add(b).ok_or_else(|| arithmetic_error("fixed expression overflowed"))?, scale: a_scale }),
            (None, _) | (_, None) => None,
            _ => return Err(invalid_plan("fixed expression operands have incompatible types")),
        },
        E::Equal { .. } | E::LessThan { .. } | E::And(_) | E::Or(_) | E::Not(_) => match eval_truth(expression, world, context)? {
            Truth::True => Some(senkei_model::DomainValue::Bool(true)),
            Truth::False => Some(senkei_model::DomainValue::Bool(false)),
            Truth::Unknown => None,
        },
    })
}

fn select_entity(
    selector: &senkei_model::EntitySelector,
    context: EvalContext<'_>,
    world: &WorldState,
) -> Result<senkei_model::EntityId, ApiError> {
    let Some(projection_index) = context.projection_index else {
        return Err(invalid_plan("entity resolution requires the match projection index"));
    };
    world::resolve_entity_selector(selector, context, projection_index, world)
}

fn compare_values(a: &senkei_model::DomainValue, b: &senkei_model::DomainValue) -> Option<std::cmp::Ordering> {
    use senkei_model::DomainValue as V;
    match (a, b) {
        (V::Null, V::Null) => Some(std::cmp::Ordering::Equal),
        (V::Bool(a), V::Bool(b)) => Some(a.cmp(b)),
        (V::Integer(a), V::Integer(b)) => Some(a.cmp(b)),
        (V::Fixed { coefficient: a, scale: sa }, V::Fixed { coefficient: b, scale: sb }) if sa == sb => Some(a.cmp(b)),
        (V::String(a), V::String(b)) => Some(a.cmp(b)),
        (V::Enum(a), V::Enum(b)) => Some(a.cmp(b)),
        (V::Entity(a), V::Entity(b)) => Some(a.cmp(b)),
        _ => None,
    }
}

fn required_value(value: Option<DomainValue>) -> Result<DomainValue, ApiError> {
    value.ok_or_else(|| invalid_plan("transition expression resolved to an unknown value"))
}

fn digest_json(value: &impl serde::Serialize) -> Result<ContentDigest, ApiError> {
    use sha2::{Digest, Sha256};
    let bytes = serde_json::to_vec(value).map_err(|_| api_error(ApiErrorCode::InternalError, "could not serialize deterministic digest input"))?;
    Ok(ContentDigest::new(format!("{:x}", Sha256::digest(bytes))))
}

fn invalid_plan(message: impl Into<String>) -> ApiError { api_error(ApiErrorCode::ValidationFailed, message) }
fn conflict_error(message: impl Into<String>) -> ApiError { api_error(ApiErrorCode::TransitionConflict, message) }
fn arithmetic_error(message: impl Into<String>) -> ApiError { api_error(ApiErrorCode::ArithmeticOverflow, message) }
fn api_error(code: ApiErrorCode, message: impl Into<String>) -> ApiError { ApiError::new(code, message) }

fn presentation_view(world: &WorldState, plan: &RulePlan) -> senkei_model::WorldStateView {
    match &plan.next { Some(next) => next_vision::public_view_with_policy(world,next,&plan.presentation), None => world::public_view(world,plan) }
}

/// Project the resolved capture decision only into a frame where the objective
/// is already visible. Older packages do not declare this field and retain
/// their exact previous replay behavior. Fog history and WorldState never see
/// the ephemeral fact.
fn add_contest_fact(view: &mut senkei_model::WorldStateView, plan: &RulePlan, contest: Option<&(EntityId, bool)>) {
    let Some((id, contested)) = contest else { return };
    if !plan.presentation.visible_entity_fields.get(&"observation".into()).is_some_and(|fields| fields.contains(&"capture_contested".into())) { return; }
    if let Some(objective) = view.entities.get_mut(id).filter(|entity| entity.entity_type.as_str() == "observation") {
        objective.fields.insert("capture_contested".into(), DomainValue::Bool(*contested));
    }
}
fn observation(world: &WorldState, plan: &RulePlan, side: CombatantSide, tick:u32, index: &world::ProjectionIndex) -> Result<ObservationSnapshot,ApiError> {
    if plan.next.is_some() { Ok(next_vision::observation(world,plan,side,tick)) } else { world::observation(world,plan,side,tick,index) }
}

/// The Next-specific event producer must obey the same RulePlan allowlist as
/// the generic Enbu producer, after the existing public visibility check.
fn project_next_public_event(
    mut event: senkei_model::PresentationEvent,
    policy: &senkei_model::PresentationPolicy,
    before: &senkei_model::WorldStateView,
    after: &senkei_model::WorldStateView,
) -> Option<senkei_model::PresentationEvent> {
    let schema = policy.visible_events.get(&event.event)?;
    let known = |id: &senkei_model::EntityId| {
        before.entities.contains_key(id) && after.entities.contains_key(id)
    };
    if !event.entity.as_ref().is_some_and(known)
        || !event.payload.values().all(|value| match value {
            DomainValue::Entity(id) => known(id),
            DomainValue::List(_) | DomainValue::Record(_) => false,
            _ => true,
        })
    {
        return None;
    }
    event.payload.retain(|field, _| schema.payload.contains_key(field));
    Some(event)
}

fn event_references_known(event:&senkei_model::PresentationEvent,before:&senkei_model::WorldStateView,after:&senkei_model::WorldStateView)->bool {
    let known=|id:&senkei_model::EntityId|before.entities.contains_key(id)&&after.entities.contains_key(id);
    event.entity.as_ref().is_some_and(known) && event.payload.values().all(|v|match v { DomainValue::Entity(id)=>known(id),DomainValue::List(_)|DomainValue::Record(_)=>false,_=>true })
}

/// Strip internal roster keys before either presentation channel leaves Enbu.
/// Visibility re-entry and a confirmed respawn allocate a new incarnation.
fn project_replay_identities(frames:Vec<ReplayFrame>)->Vec<ReplayFrame> {
    project_replay_identities_with(frames, |_, _| {})
}

fn project_replay_identities_with(
    mut frames: Vec<ReplayFrame>,
    mut on_frame: impl FnMut(u32, &BTreeMap<EntityId, (EntityId, i64)>),
) -> Vec<ReplayFrame> {
    use senkei_model::{EntityId,EntityStateView};
    let mut active:BTreeMap<EntityId,(EntityId,i64)>=BTreeMap::new();
    let mut serial=0_u64;
    for frame in &mut frames {
        let Some(view)=&mut frame.visible_state else { continue };
        active.retain(|raw,_|view.entities.contains_key(raw));
        for (raw,entity) in &view.entities {
            let hp=match entity.fields.get(&"hp".into()) { Some(DomainValue::Integer(hp))=>*hp,_=>0 };
            let respawn=active.get(raw).is_some_and(|(_,old_hp)| *old_hp<=0 && hp>0);
            if !active.contains_key(raw)||respawn { serial+=1;active.insert(raw.clone(),(EntityId::new(format!("visible-{serial}")),hp)); }
            else if let Some((_,old_hp))=active.get_mut(raw) { *old_hp=hp; }
        }
        on_frame(frame.tick, &active);
        for event in &mut frame.events {
            event.entity=event.entity.as_ref().and_then(|raw|active.get(raw).map(|(id,_)|id.clone()));
            fn project_value(value: &mut DomainValue, active: &BTreeMap<EntityId,(EntityId,i64)>) {
                match value {
                    DomainValue::Entity(raw) => *value = active.get(raw).map(|(id,_)| DomainValue::Entity(id.clone())).unwrap_or(DomainValue::Null),
                    DomainValue::List(values) => for value in values { project_value(value, active); },
                    DomainValue::Record(values) => for value in values.values_mut() { project_value(value, active); },
                    _ => {},
                }
            }
            for value in event.payload.values_mut() { project_value(value, &active); }
        }
        let entities=std::mem::take(&mut view.entities);
        view.entities=entities.into_iter().filter_map(|(raw,entity)|active.get(&raw).map(|(id,_)|(id.clone(),EntityStateView { ..entity }))).collect();
    }
    frames
}

#[cfg(test)]
mod next_projection_tests {
    use super::*;
    #[test]
    fn presentation_keys_hide_private_slots_and_rotate_on_visibility_or_respawn() {
        let raw=senkei_model::EntityId::from("hero:defender:PRIVATE-SLOT");
        let frame=|tick,hp:Option<i64>| ReplayFrame { tick,events:Vec::new(),visible_state:Some(senkei_model::WorldStateView { entities:hp.map(|hp|BTreeMap::from([(raw.clone(),senkei_model::EntityStateView { entity_type:"hero".into(),owner:Some(CombatantSide::Defender),fields:BTreeMap::from([("hp".into(),DomainValue::Integer(hp))]) })])).unwrap_or_default(),global_fields:BTreeMap::new() }) };
        let frames=project_replay_identities(vec![frame(0,Some(10)),frame(1,None),frame(2,Some(10)),frame(3,Some(0)),frame(4,Some(10))]);
        let id=|n:usize|frames[n].visible_state.as_ref().unwrap().entities.keys().next().unwrap().clone();
        assert_ne!(id(0),id(2));assert_ne!(id(2),id(4));
        assert!(!serde_json::to_string(&frames).unwrap().contains("PRIVATE-SLOT"));
    }
}

#[cfg(test)]
mod tactical_diagnostic_tests {
    use super::*;

    #[test]
    fn battlefield_v2_compacts_cost_charges_by_tick_side_and_operation_only() {
        assert!(!compact_cost_trace_for_versions(Version::new(1, 1, 0), Some(Version::new(2, 0, 0))));
        assert!(!compact_cost_trace_for_versions(Version::new(1, 2, 0), Some(Version::new(1, 0, 0))));
        assert!(!compact_cost_trace_for_versions(Version::new(1, 2, 0), None));
        assert!(compact_cost_trace_for_versions(Version::new(1, 2, 0), Some(Version::new(2, 0, 0))));

        let operation_a = senkei_model::CostOperationId::from("cost.alpha");
        let operation_z = senkei_model::CostOperationId::from("cost.zeta");
        let mut records = vec![
            TacticalDiagnostic::RuntimeNotice {
                code: "when_unknown".into(),
                details: BTreeMap::new(),
            },
            TacticalDiagnostic::StateEvaluated { state: "knownness".into(), result: Truth::Unknown },
        ];
        // A realistic high-volume raw trace exceeds the Battlefield host cap,
        // while its compact per-operation projection remains bounded.
        for index in 0..300_000 {
            let operation = if index % 2 == 0 { &operation_z } else { &operation_a };
            records.push(TacticalDiagnostic::CostCharged {
                operation: operation.clone(),
                amount: LogicalCu(1),
            });
        }
        assert_eq!(projected_tactical_diagnostic_count(&records, true), Some(4));
        assert_eq!(projected_tactical_diagnostic_count(&records, false), Some(300_002));

        let mut compacted = Vec::new();
        let mut sequence = 0;
        charge_tactical_diagnostics(
            &mut compacted,
            &mut sequence,
            17,
            CombatantSide::Attacker,
            &records,
            true,
        ).unwrap();
        assert_eq!(compacted.len(), 4);
        assert!(matches!(&compacted[0].record, DiagnosticRecord::RuntimeNotice { code, .. } if code.as_str() == "when_unknown"));
        assert!(matches!(&compacted[1].record, DiagnosticRecord::StateEvaluated { state, result }
            if state.as_str() == "knownness" && *result == Truth::Unknown));
        assert!(matches!(&compacted[2].record, DiagnosticRecord::CostCharged { operation, amount }
            if operation == &operation_a && *amount == LogicalCu(150_000)));
        assert!(matches!(&compacted[3].record, DiagnosticRecord::CostCharged { operation, amount }
            if operation == &operation_z && *amount == LogicalCu(150_000)));
        assert!(compacted.iter().all(|event| event.tick == 17 && event.side == CombatantSide::Attacker));

        let raw_cu = records.iter().map(|record| match record {
            TacticalDiagnostic::CostCharged { amount, .. } => amount.0,
            _ => 0,
        }).sum::<u64>();
        let compacted_cu = compacted.iter().map(|event| match &event.record {
            DiagnosticRecord::CostCharged { amount, .. } => amount.0,
            _ => 0,
        }).sum::<u64>();
        assert_eq!(compacted_cu, raw_cu);

        // Non-Battlefield-v2 traces retain their original per-charge events.
        let mut legacy = Vec::new();
        let mut legacy_sequence = 0;
        charge_tactical_diagnostics(
            &mut legacy,
            &mut legacy_sequence,
            17,
            CombatantSide::Attacker,
            &records,
            false,
        ).unwrap();
        assert_eq!(legacy.len(), records.len());
        assert_eq!(legacy.iter().filter(|event| matches!(event.record, DiagnosticRecord::CostCharged { .. })).count(), 300_000);
    }
}

#[cfg(test)]
mod actor_order_domain_tests {
    use super::*;

    fn actor_order(scope: senkei_model::ActorControlScope, actor_type: &str, capabilities: &[&str]) -> senkei_model::ActorIntentOrder {
        senkei_model::ActorIntentOrder {
            scope,
            actor_type: senkei_model::TypeId::new(actor_type),
            capabilities: capabilities.iter().map(|id| senkei_model::CapabilityId::new(*id)).collect(),
            arbitration: senkei_model::ArbitrationRule {
                conflict_keys: vec![senkei_model::IntentKey::Actor],
                resolution: senkei_model::ArbitrationResolution::SelectOrdered {
                    sort_by: vec![senkei_model::IntentSortTerm {
                        key: senkei_model::IntentKey::ActionId,
                        direction: senkei_model::SortDirection::Ascending,
                    }],
                    max_accepted: 1,
                },
            },
        }
    }

    fn intent(index: usize, capability: &str, actor: &str) -> (usize, CombatantSide, Intent) {
        (index, CombatantSide::Attacker, Intent {
            action_id: senkei_model::ActionId::new(format!("action-{index}")),
            capability: senkei_model::CapabilityId::new(capability),
            actor: Some(EntityId::new(actor)),
            target: None,
            arguments: Vec::new(),
            priority: None,
        })
    }

    fn world_actor(actor: &str, actor_type: &str) -> WorldState {
        WorldState {
            entities: BTreeMap::from([(EntityId::new(actor), senkei_model::EntityState {
                entity_type: senkei_model::TypeId::new(actor_type),
                owner: Some(CombatantSide::Attacker),
                fields: BTreeMap::new(),
            })]),
            ..WorldState::default()
        }
    }

    fn next_plan_with_order(order: senkei_model::ActorIntentOrder) -> RulePlan {
        let mut plan = RulePlan::from(&senritsu::next_package());
        plan.actor_intent_orders = vec![order];
        plan
    }

    #[test]
    fn unscoped_typed_actor_domain_without_a_declaration_passes_per_capability_accepts() {
        let mut plan = next_plan_with_order(actor_order(
            senkei_model::ActorControlScope::Hero,
            "hero",
            &["retreat"],
        ));
        for capability in ["move", "activate"] {
            let schema = plan.domain.capabilities.get_mut(&senkei_model::CapabilityId::new(capability)).unwrap();
            let actor_argument = schema.actor_argument.unwrap() as usize;
            schema.arguments[actor_argument].value_type = senkei_model::DomainType::Entity {
                entity_type: Some(senkei_model::TypeId::new("minion")),
            };
        }
        let results = arbitrate_actor_orders(
            vec![intent(0, "move", "minion-one"), intent(1, "activate", "minion-one")],
            &plan,
            &world_actor("minion-one", "minion"),
        ).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|(_, _, _, accepted)| *accepted),
            "actor domains with no authored scope declaration keep per-capability accepts");
    }

    #[test]
    fn same_capability_candidates_keep_per_capability_accepts_despite_actor_order_metadata() {
        let plan = next_plan_with_order(actor_order(
            senkei_model::ActorControlScope::Hero,
            "hero",
            &["move"],
        ));
        let results = arbitrate_actor_orders(
            vec![intent(0, "move", "hero-one"), intent(1, "move", "hero-one")],
            &plan,
            &world_actor("hero-one", "hero"),
        ).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|(_, _, _, accepted)| *accepted),
            "cross-capability actor orders do not reselect same-capability candidates");
    }

    #[test]
    fn declared_actor_domain_with_incomplete_capability_coverage_still_fails_closed() {
        let plan = next_plan_with_order(actor_order(
            senkei_model::ActorControlScope::Hero,
            "hero",
            &["move"],
        ));
        let error = arbitrate_actor_orders(
            vec![intent(0, "move", "hero-one"), intent(1, "activate", "hero-one")],
            &plan,
            &world_actor("hero-one", "hero"),
        ).expect_err("declared but incomplete compiled order must fail closed");
        assert_eq!(error.code, ApiErrorCode::ValidationFailed);
        assert!(error.message.contains("unique complete authored order"));
    }
}

#[cfg(test)]
mod next_public_projection_tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    #[test]
    fn next_public_event_respects_authored_allowlist() {
        use senkei_model::{DomainType, EntityStateView, EventId, EventSchema, FieldId, PresentationPolicy, PresentationEvent, TypeId, WorldStateView};
        let entity_id = EntityId::from("shared");
        let view = WorldStateView {
            entities: BTreeMap::from([(entity_id.clone(), EntityStateView {
                entity_type: TypeId::from("hero"),
                owner: Some(CombatantSide::Attacker),
                fields: BTreeMap::new(),
            })]),
            global_fields: BTreeMap::new(),
        };
        let permitted = PresentationPolicy {
            visible_entity_fields: BTreeMap::from([(
                TypeId::from("hero"),
                BTreeSet::from([FieldId::from("hp")]),
            )]),
            visible_global_fields: BTreeSet::new(),
            visible_events: BTreeMap::from([(
                EventId::from("next.attack"),
                EventSchema { payload: BTreeMap::from([(
                    FieldId::from("source"),
                    DomainType::Entity { entity_type: None },
                )]) },
            )]),
        };
        let event = PresentationEvent {
            event: EventId::from("next.attack"),
            entity: Some(entity_id.clone()),
            payload: BTreeMap::from([
                (FieldId::from("source"), DomainValue::Entity(entity_id.clone())),
                (FieldId::from("private_detail"), DomainValue::String("secret".into())),
            ]),
        };
        let allowed = project_next_public_event(event.clone(), &permitted, &view, &view).unwrap();
        assert_eq!(allowed.payload.len(), 1);
        assert!(allowed.payload.contains_key(&FieldId::from("source")));
        let denied = PresentationPolicy { visible_events: BTreeMap::new(), ..permitted.clone() };
        assert!(project_next_public_event(event.clone(), &denied, &view, &view).is_none());
        let unknown = WorldStateView { entities: BTreeMap::new(), global_fields: BTreeMap::new() };
        assert!(project_next_public_event(event, &permitted, &unknown, &view).is_none());
    }
}
