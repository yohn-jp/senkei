//! A bounded, owner-scoped view of one actual Next Behavior evaluation.
use super::*;
use senkei_model::{BehaviorCandidateKind, BehaviorSignal, Observed};
use serde::Serialize;

pub const NEXT_DECISION_INSPECTION_FORMAT_VERSION: u16 = 1;

#[derive(Clone, Serialize)]
pub struct NextInspectionSelector { pub tick: u32, pub slot_id: String }
#[derive(Clone, Serialize)]
pub struct NextInspectionIdentity {
    pub snapshot_digest: ContentDigest,
    pub result_digest: ContentDigest,
    pub authorized_side: CombatantSide,
    pub selector: NextInspectionSelector,
    pub inspection_digest: ContentDigest,
}
#[derive(Clone, Serialize)]
pub struct NextInspectionPolicy { pub id: String, pub digest: ContentDigest }
#[derive(Clone, Serialize)]
pub struct NextInspectionObservation {
    /// IDs are aliases local to this inspection, not Replay identities.
    pub identity_space: &'static str,
    /// Hash of the actual, unprojected side observation used by the evaluator.
    pub source_digest: Option<ContentDigest>,
    pub snapshot: Option<ObservationSnapshot>,
}
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NextInspectionStatus { Evaluated, SubjectUnavailable, ExecutionIncomplete, TickNotReached }
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NextCandidateOutcome { Ineligible, Unknown, Selected, Conflict }
#[derive(Clone, Serialize)]
pub struct NextInspectionTerm {
    pub domain: &'static str,
    pub kind: &'static str,
    pub signal: Option<BehaviorSignal>,
    pub weight: Option<i64>,
    pub value: Option<i64>,
    pub contribution: Option<i64>,
}
#[derive(Clone, Serialize)]
pub struct NextInspectionCandidate {
    pub index: usize,
    pub actor: EntityId,
    pub target: Option<EntityId>,
    pub kind: BehaviorCandidateKind,
    pub capability: senkei_model::CapabilityId,
    pub arguments: Vec<DomainValue>,
    pub outcome: NextCandidateOutcome,
    pub score: Option<i64>,
    pub rank: Option<usize>,
    pub terms: Vec<NextInspectionTerm>,
    #[serde(skip)]
    pub(crate) action_id: senkei_model::ActionId,
}
#[derive(Clone, Serialize)]
pub struct NextInspectionSelection {
    pub source: next_behavior::NextBehaviorSelectionSource,
    pub actor: EntityId,
    pub capability: Option<senkei_model::CapabilityId>,
    pub target: Option<EntityId>,
    pub arguments: Option<Vec<DomainValue>>,
    pub score: Option<i64>,
    pub candidate_index: Option<usize>,
    pub arbitration_accepted: bool,
    pub transition_completed: bool,
    pub committed_event: Option<next_behavior::NextBehaviorCommittedEventRef>,
}
#[derive(Clone, Serialize)]
pub struct NextInspectionDecision {
    pub status: NextInspectionStatus,
    pub subject: Option<EntityId>,
    pub composition: Option<next_behavior::NextBehaviorCompositionTrace>,
    pub candidates: Vec<NextInspectionCandidate>,
    pub selections: Vec<NextInspectionSelection>,
}
#[derive(Clone, Serialize)]
pub struct NextDecisionInspection {
    pub format_version: u16,
    pub identity: NextInspectionIdentity,
    pub policy: NextInspectionPolicy,
    pub observation: NextInspectionObservation,
    pub decision: NextInspectionDecision,
}

/// Captures only the requested side, tick and current squad. The budget is
/// shared with the engine's diagnostic limit and is never truncated.
pub(crate) struct Collector {
    pub side: CombatantSide,
    pub selector: NextInspectionSelector,
    pub actor: EntityId,
    pub status: NextInspectionStatus,
    pub observation: Option<ObservationSnapshot>,
    pub composition: Option<next_behavior::NextBehaviorCompositionTrace>,
    pub members: BTreeSet<EntityId>,
    pub candidates: Vec<NextInspectionCandidate>,
    pub limit: u64,
    pub used: u64,
    pub max_output_bytes: u64,
}
impl Collector {
    pub fn new(side: CombatantSide, tick: u32, slot_id: &str, limit: u64, max_output_bytes: u64) -> Self {
        Self { side, selector: NextInspectionSelector { tick, slot_id: slot_id.to_owned() },
            actor: next_squads::hero_entity_id(side, slot_id), status: NextInspectionStatus::TickNotReached,
            observation: None, composition: None, members: BTreeSet::new(), candidates: Vec::new(),
            limit, used: 0, max_output_bytes }
    }
    pub fn validate_subject(&self, world: &WorldState) -> Result<(), ApiError> {
        if !world.entities.get(&self.actor).is_some_and(|entity| entity.owner == Some(self.side)
            && entity.entity_type.as_str() == "hero"
            && next_support::string(entity, "slot_id") == self.selector.slot_id) {
            return Err(api_error(ApiErrorCode::InvalidRequest, "inspection slot is not an owned initial Hero"));
        }
        Ok(())
    }
    pub fn matches(&self, side: CombatantSide, tick: u32) -> bool { self.side == side && self.selector.tick == tick }
    pub fn charge(&mut self, count: u64) -> Result<(), ApiError> {
        self.used = self.used.checked_add(count).ok_or_else(|| api_error(ApiErrorCode::ResourceLimit, "inspection diagnostic limit exceeded"))?;
        if self.used > self.limit { return Err(api_error(ApiErrorCode::ResourceLimit, "inspection diagnostic limit exceeded")); }
        Ok(())
    }
    pub fn observe(&mut self, observation: &ObservationSnapshot, completed: bool) -> Result<(), ApiError> {
        let size = serde_json::to_vec(observation).map_err(|_| api_error(ApiErrorCode::InternalError, "inspection observation serialization failed"))?.len() as u64;
        if size > self.max_output_bytes { return Err(api_error(ApiErrorCode::ResourceLimit, "inspection observation byte limit exceeded")); }
        let count = observation.fields.len() as u64 + observation.collections.values().map(|collection| match collection {
            Observed::Known(items) => items.iter().map(|item| 1 + item.fields.len() as u64).sum::<u64>(),
            Observed::Unknown => 1,
        }).sum::<u64>();
        self.charge(count.saturating_add(1))?;
        self.observation = Some(observation.clone());
        self.status = if completed { NextInspectionStatus::SubjectUnavailable } else { NextInspectionStatus::ExecutionIncomplete };
        Ok(())
    }
    pub fn start_group(&mut self, members: &[EntityId], composition: next_behavior::NextBehaviorCompositionTrace) {
        self.members = members.iter().cloned().collect();
        self.composition = Some(composition);
        self.status = NextInspectionStatus::Evaluated;
    }
    pub fn add_candidate(&mut self, mut candidate: NextInspectionCandidate) -> Result<(), ApiError> {
        self.charge(1_u64.saturating_add(candidate.terms.len() as u64))?;
        candidate.index = self.candidates.len();
        self.candidates.push(candidate);
        Ok(())
    }
    pub fn mark_rank(&mut self, action_id: &senkei_model::ActionId, rank: usize, selected: bool) {
        if let Some(candidate) = self.candidates.iter_mut().find(|candidate| &candidate.action_id == action_id) {
            candidate.rank = Some(rank);
            candidate.outcome = if selected { NextCandidateOutcome::Selected } else { NextCandidateOutcome::Conflict };
        }
    }
}

/// Run the same simulation against the unchanged frozen inputs and capture a
/// single owner-authorized decision. No opposing diagnostics are returned.
pub fn inspect_next_decision<P: TacticalExecutionPort>(
    attacker: &senkei_model::SenkeiSnapshot, defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan, context: &MatchContext, side: CombatantSide,
    tick: u32, slot_id: &str, executor: &mut P,
) -> Result<NextDecisionInspection, ApiError> {
    if tick == 0 || tick > context.max_ticks.min(rules.plan().termination.max_ticks) || slot_id.is_empty() || slot_id.len() > 48 {
        return Err(api_error(ApiErrorCode::InvalidRequest, "invalid inspection tick or slot"));
    }
    let binding = context.next_behavior.as_ref().ok_or_else(|| api_error(ApiErrorCode::InvalidRequest, "Next Behavior policy is required"))?;
    let policy = senritsu::validate_next_behavior_policy(binding.policy.clone(), rules)
        .map_err(|error| api_error(ApiErrorCode::ValidationFailed, error))?;
    next_behavior::validate_inputs(rules, context, &policy, &binding.inputs)?;
    let limit = context.host_limits.max_diagnostic_events.min(rules.plan().limits.max_diagnostic_events);
    let max_output_bytes = context.host_limits.max_output_bytes.min(rules.plan().limits.max_output_bytes);
    let collector = Collector::new(side, tick, slot_id, limit, max_output_bytes);
    let mut hero_hook = next_behavior::Hook { policy: &policy, inputs: &binding.inputs, traces: Vec::new(), accepted_preferences: Vec::new(), inspection: Some(collector) };
    let minion_policy = context.next_minion_behavior.as_ref().map(|binding| {
        senritsu::validate_next_minion_behavior_policy(binding.policy.clone(), rules)
            .map_err(|error| api_error(ApiErrorCode::ValidationFailed, error))
    }).transpose()?;
    let mut minion_hook = if let (Some(binding), Some(policy)) = (&context.next_minion_behavior, &minion_policy) {
        next_minion_behavior::validate_inputs(rules, context, policy, &binding.inputs)?;
        Some(next_minion_behavior::Hook { policy, inputs: &binding.inputs, traces: Vec::new() })
    } else { None };
    let artifact = simulate_inner(attacker, defender, rules, context, executor, None, Some(&mut hero_hook), minion_hook.as_mut(), None)?;
    let collector = hero_hook.inspection.take().expect("inspection collector remains present");
    finish(collector, &hero_hook.traces, &artifact, &policy)
}

fn gather_value(value: &DomainValue, ids: &mut BTreeSet<EntityId>) {
    match value {
        DomainValue::Entity(id) => { ids.insert(id.clone()); },
        DomainValue::List(items) => for item in items { gather_value(item, ids); },
        DomainValue::Record(fields) => for value in fields.values() { gather_value(value, ids); },
        _ => {},
    }
}
fn project_value(value: &mut DomainValue, ids: &BTreeMap<EntityId, EntityId>) {
    match value {
        DomainValue::Entity(id) => *id = ids[id].clone(),
        DomainValue::List(items) => for item in items { project_value(item, ids); },
        DomainValue::Record(fields) => for value in fields.values_mut() { project_value(value, ids); },
        _ => {},
    }
}
fn value_is_observed(value: &DomainValue, ids: &BTreeMap<EntityId, EntityId>) -> bool {
    match value {
        DomainValue::Entity(id) => ids.contains_key(id),
        DomainValue::List(items) => items.iter().all(|item| value_is_observed(item, ids)),
        DomainValue::Record(fields) => fields.values().all(|value| value_is_observed(value, ids)),
        _ => true,
    }
}
fn observation_aliases(observation: &ObservationSnapshot) -> BTreeMap<EntityId, EntityId> {
    let mut ids = BTreeSet::new();
    for value in observation.fields.values() { if let Observed::Known(value) = value { gather_value(value, &mut ids); } }
    for collection in observation.collections.values() {
        if let Observed::Known(items) = collection { for item in items {
            ids.insert(item.id.clone());
            for value in item.fields.values() { if let Observed::Known(value) = value { gather_value(value, &mut ids); } }
        } }
    }
    ids.into_iter().enumerate().map(|(index, id)| (id, EntityId::new(format!("observed-{}", index + 1)))).collect()
}
fn project_observation(observation: &mut ObservationSnapshot, aliases: &BTreeMap<EntityId, EntityId>) {
    for value in observation.fields.values_mut() { if let Observed::Known(value) = value { project_value(value, aliases); } }
    for collection in observation.collections.values_mut() {
        if let Observed::Known(items) = collection { for item in items {
            item.id = aliases[&item.id].clone();
            for value in item.fields.values_mut() { if let Observed::Known(value) = value { project_value(value, aliases); } }
        } }
    }
}
fn finish(mut collector: Collector, traces: &[next_behavior::NextBehaviorTrace], artifact: &SimulationArtifact, policy: &senritsu::VerifiedNextBehaviorPolicy) -> Result<NextDecisionInspection, ApiError> {
    let source_digest = collector.observation.as_ref().map(digest_json).transpose()?;
    let aliases = collector.observation.as_ref().map(observation_aliases).unwrap_or_default();
    let map = |id: &EntityId| aliases.get(id).cloned();
    let subject = map(&collector.actor);
    let mut selections = Vec::new();
    for trace in traces.iter().filter(|trace| trace.tick == collector.selector.tick && trace.side == collector.side && collector.members.contains(&trace.actor)) {
        let Some(actor) = map(&trace.actor) else { continue };
        let selected = trace.selected.as_ref();
        let candidate_index = selected.and_then(|intent| collector.candidates.iter().find(|candidate| candidate.action_id == intent.action_id).map(|candidate| candidate.index));
        let arguments = selected.and_then(|intent| {
            if !intent.arguments.iter().all(|value| value_is_observed(value, &aliases)) { return None; }
            let mut values = intent.arguments.clone();
            for value in &mut values { project_value(value, &aliases); }
            Some(values)
        });
        selections.push(NextInspectionSelection { source: trace.source, actor,
            capability: selected.map(|intent| intent.capability.clone()),
            target: selected.and_then(|intent| intent.target.as_ref()).and_then(map),
            arguments, score: trace.score, candidate_index, arbitration_accepted: trace.arbitration_accepted,
            transition_completed: trace.transition_completed, committed_event: trace.committed_event.clone() });
    }
    if let Some(composition) = collector.composition.as_mut() {
        for member in &mut composition.members { member.actor = map(&member.actor).ok_or_else(|| api_error(ApiErrorCode::InternalError, "inspection member was not observed"))?; }
    }
    for candidate in &mut collector.candidates {
        candidate.actor = map(&candidate.actor).ok_or_else(|| api_error(ApiErrorCode::InternalError, "inspection actor was not observed"))?;
        if let Some(target) = &mut candidate.target { *target = map(target).ok_or_else(|| api_error(ApiErrorCode::InternalError, "inspection target was not observed"))?; }
        if !candidate.arguments.iter().all(|value| value_is_observed(value, &aliases)) { return Err(api_error(ApiErrorCode::InternalError, "inspection candidate argument was not observed")); }
        for value in &mut candidate.arguments { project_value(value, &aliases); }
    }
    if let Some(observation) = collector.observation.as_mut() { project_observation(observation, &aliases); }
    let snapshot_digest = artifact.diagnostic_snapshot_digest.clone();
    let inspection_digest = digest_json(&serde_json::json!({ "format_version": 1, "snapshot_digest": snapshot_digest,
        "authorized_side": collector.side, "selector": collector.selector }))?;
    let result = NextDecisionInspection {
        format_version: NEXT_DECISION_INSPECTION_FORMAT_VERSION,
        identity: NextInspectionIdentity { snapshot_digest, result_digest: artifact.replay.result_digest.clone(), authorized_side: collector.side, selector: collector.selector, inspection_digest },
        policy: NextInspectionPolicy { id: policy.policy().policy_id.clone(), digest: policy.digest().clone() },
        observation: NextInspectionObservation { identity_space: "inspection_observed", source_digest, snapshot: collector.observation },
        decision: NextInspectionDecision { status: collector.status, subject, composition: collector.composition, candidates: collector.candidates, selections },
    };
    let size = serde_json::to_vec(&result).map_err(|_| api_error(ApiErrorCode::InternalError, "inspection serialization failed"))?.len() as u64;
    if size > collector.max_output_bytes { return Err(api_error(ApiErrorCode::ResourceLimit, "inspection output byte limit exceeded")); }
    Ok(result)
}
