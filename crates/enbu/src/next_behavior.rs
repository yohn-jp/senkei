//! Versioned test-policy driven defaults for Next. All traces are owner restricted.
use super::*;
use senkei_model::{BehaviorCandidateKind, BehaviorSignal};
use senritsu::VerifiedNextBehaviorPolicy;
use serde::Serialize;

pub use senkei_model::{NextBehaviorExecutionInputs, NextBehaviorProfile};
/// Indices in the following six-element arrays are Navigation, Engagement,
/// Targeting, Pursuit, Survival and Objective, in that order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NextBehaviorProfileSource { TestFallbackZero, HeroCatalog, HeroInstance, Army, Squad, JinreiConditional }
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NextBehaviorMemberComposition {
    pub actor: EntityId,
    pub catalog_id: String,
    pub values: [i64; 6],
    pub sources: [NextBehaviorProfileSource; 6],
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NextBehaviorCompositionTrace {
    pub squad_id: String,
    pub members: Vec<NextBehaviorMemberComposition>,
    pub shared: [i64; 6],
    /// Same roster and inherited preferences before tick-local Jinrei overrides.
    pub baseline_effective: [i64; 6],
    /// The selected actor's individual engagement and targeting replace the
    /// respective shared values. Other fields remain shared movement values.
    pub effective: [i64; 6],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NextBehaviorSelectionSource { Explicit, Default, Wait }
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NextBehaviorCommittedEventRef {
    /// Tick in the owner's replay. The side comes from the containing trace.
    pub tick: u32,
    /// Sequence of `next.behavior_order_committed` within that side and tick.
    pub sequence: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NextBehaviorTrace {
    pub tick: u32,
    pub side: CombatantSide,
    pub actor: EntityId,
    pub source: NextBehaviorSelectionSource,
    pub policy_digest: ContentDigest,
    /// Digest of the side-authorized frozen observation used for this tick.
    pub observation_digest: ContentDigest,
    pub composition: NextBehaviorCompositionTrace,
    pub eligible_candidates: usize,
    pub unknown_candidates: usize,
    pub selected: Option<Intent>,
    /// A policy score for generated candidates; explicit Jinrei actions have no score.
    pub score: Option<i64>,
    pub arbitration_accepted: bool,
    pub transition_completed: bool,
    /// Present only when the selected action actually produced an owner event.
    pub committed_event: Option<NextBehaviorCommittedEventRef>,
}
#[derive(Clone)]
pub struct NextBehaviorSimulationArtifact { artifact: SimulationArtifact, policy: VerifiedNextBehaviorPolicy, inputs: NextBehaviorExecutionInputs, digest: ContentDigest, traces: Vec<NextBehaviorTrace> }
impl NextBehaviorSimulationArtifact {
    pub fn public_response(&self) -> senkei_model::PublicSimulationResponse { self.artifact.public_response() }
    pub fn diagnostics_for_owner(&self, side: CombatantSide) -> BehaviorOwnerDiagnostics { let diagnostics = self.artifact.diagnostic_response(side).diagnostics.expect("owner diagnostics"); BehaviorOwnerDiagnostics { behavior_run_digest: self.digest.clone(), diagnostics } }
    pub fn traces_for_owner(&self, side: CombatantSide) -> Vec<NextBehaviorTrace> { self.traces.iter().filter(|t| t.side == side).cloned().collect() }
    pub fn run_digest(&self) -> &ContentDigest { &self.digest }
    pub fn reproduction(&self) -> (&ReproductionContext, &NextBehaviorExecutionInputs, &VerifiedNextBehaviorPolicy) { (&self.artifact.reproduction, &self.inputs, &self.policy) }
    pub fn reproduce<P: TacticalExecutionPort>(&self, rules: &VerifiedRulePlan, executor: &mut P) -> Result<Self, ApiError> { let r = &self.artifact.reproduction; simulate_next_behavior(&r.attacker, &r.defender, rules, &r.context, executor, &self.policy, &self.inputs) }
}
pub fn simulate_next_behavior<P: TacticalExecutionPort>(attacker: &senkei_model::SenkeiSnapshot, defender: &senkei_model::SenkeiSnapshot, rules: &VerifiedRulePlan, context: &MatchContext, executor: &mut P, policy: &VerifiedNextBehaviorPolicy, inputs: &NextBehaviorExecutionInputs) -> Result<NextBehaviorSimulationArtifact, ApiError> {
    validate_inputs(rules, context, policy, inputs)?;
    let mut frozen = context.clone();
    let binding = senkei_model::NextBehaviorMatch { policy: policy.policy().clone(), inputs: inputs.clone() };
    if frozen.next_behavior.as_ref().is_some_and(|existing| existing != &binding) { return Err(api_error(ApiErrorCode::ValidationFailed, "Next Behavior context mismatch")); }
    frozen.next_behavior = Some(binding);
    let mut hook = Hook { policy, inputs, traces: Vec::new(), accepted_preferences: Vec::new(), inspection: None };
    let minion_policy = frozen.next_minion_behavior.as_ref().map(|binding| {
        senritsu::validate_next_minion_behavior_policy(binding.policy.clone(), rules)
            .map_err(|e| api_error(ApiErrorCode::ValidationFailed, e))
    }).transpose()?;
    let mut minion_hook = if let (Some(binding), Some(policy)) = (&frozen.next_minion_behavior, &minion_policy) {
        next_minion_behavior::validate_inputs(rules, &frozen, policy, &binding.inputs)?;
        Some(next_minion_behavior::Hook { policy, inputs: &binding.inputs, traces: Vec::new() })
    } else { None };
    let artifact = simulate_inner(attacker, defender, rules, &frozen, executor, None, Some(&mut hook), minion_hook.as_mut(), None)?;
    let digest = artifact.diagnostic_snapshot_digest.clone();
    Ok(NextBehaviorSimulationArtifact { artifact, policy: policy.clone(), inputs: inputs.clone(), digest, traces: hook.traces })
}
pub(crate) fn validate_inputs(rules: &VerifiedRulePlan, context: &MatchContext, policy: &VerifiedNextBehaviorPolicy, inputs: &NextBehaviorExecutionInputs) -> Result<(), ApiError> {
    if rules.plan().next.is_none() || policy.policy().ruleset_digest != *rules.package_digest() || inputs.schema_version != 1 { return Err(api_error(ApiErrorCode::IncompatibleVersion, "Next Behavior policy or input incompatible")); }
    let size = serde_json::to_vec(inputs).map_err(|_| api_error(ApiErrorCode::InvalidRequest, "invalid Behavior inputs"))?.len() as u64;
    if size > context.host_limits.max_input_bytes.min(rules.plan().limits.max_input_bytes) { return Err(api_error(ApiErrorCode::ResourceLimit, "Behavior input limit exceeded")); }
    let d = &policy.policy().domains;
    let terms = [&d.navigation, &d.engagement, &d.targeting, &d.pursuit, &d.survival, &d.objective];
    let bound = terms.into_iter().flatten().try_fold(200_000_000i64, |sum, term| term.weight.checked_abs()?.checked_mul(100).and_then(|v| sum.checked_add(v)));
    if bound.is_none() { return Err(api_error(ApiErrorCode::ValidationFailed, "Behavior score and profile bounds overflow")); }
    let profiles = inputs.army.values().chain(inputs.squads.values().flat_map(|m| m.values())).chain(inputs.heroes.values().flat_map(|m| m.values()));
    if profiles.flat_map(profile_values).flatten().any(|x| !(-1_000_000..=1_000_000).contains(&x)) { return Err(api_error(ApiErrorCode::ValidationFailed, "Behavior profile offset out of range")); }
    Ok(())
}
pub(crate) fn validate_bindings(inputs: &NextBehaviorExecutionInputs, world: &WorldState) -> Result<(), ApiError> {
    for (side, heroes) in &inputs.heroes {
        for id in heroes.keys() {
            if !world.entities.get(id).is_some_and(|entity| entity.owner == Some(*side) && entity.entity_type.as_str() == "hero") {
                return Err(api_error(ApiErrorCode::ValidationFailed, "Behavior Hero profile references a missing or unowned Hero"));
            }
        }
    }
    for (side, squads) in &inputs.squads {
        for squad in squads.keys() {
            if !world.entities.values().any(|entity| entity.owner == Some(*side) && entity.entity_type.as_str() == "hero" && next_support::string(entity, "squad") == *squad) {
                return Err(api_error(ApiErrorCode::ValidationFailed, "Behavior Squad profile references a missing or unowned Squad"));
            }
        }
    }
    Ok(())
}
fn profile_values(p: &NextBehaviorProfile) -> [Option<i64>; 6] { [p.navigation,p.engagement,p.targeting,p.pursuit,p.survival,p.objective] }
pub(crate) struct Hook<'a> { pub policy: &'a VerifiedNextBehaviorPolicy, pub inputs: &'a NextBehaviorExecutionInputs, pub traces: Vec<NextBehaviorTrace>, pub accepted_preferences: Vec<(CombatantSide, Intent)>, pub inspection: Option<next_decision_inspection::Collector> }
impl Hook<'_> {
    pub fn select(&mut self, validated: &mut Vec<(CombatantSide, Intent)>, outputs: &[(CombatantSide, senkei_model::TacticalExecutionOutput); 2], observations: &[ObservationSnapshot; 2], world: &WorldState, plan: &RulePlan, tick: u32, index: &world::ProjectionIndex, diagnostics: &mut Vec<DiagnosticEvent>, sequence: &mut u64) -> Result<(), ApiError> {
        let next = plan.next.as_ref().unwrap();
        let mut ineligible = Vec::new();
        validated.retain(|(side,intent)| {
            if next_tactics::behavior_order_legal(world, next, *side, intent) { true }
            else { ineligible.push((*side,intent.clone())); false }
        });
        for (side,intent) in ineligible {
            push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::IntentRejected { intent, reason:"enbu.next_order_ineligible".into() })?;
        }
        let (overrides, accepted_preferences) = consume_preferences(validated, outputs, tick, diagnostics, sequence)?;
        self.accepted_preferences = accepted_preferences;
        for side in [CombatantSide::Attacker, CombatantSide::Defender] {
            // Only values in the already frozen RulePlan observation are eligible.
            let observation = observations.iter().find(|o| o.side == side).unwrap();
            let completed = outputs.iter().find(|(s,_)| *s == side).unwrap().1.status == senkei_model::TacticalExecutionStatus::Completed;
            if let Some(inspection) = self.inspection.as_mut().filter(|inspection| inspection.matches(side, tick)) {
                inspection.status = if completed { next_decision_inspection::NextInspectionStatus::SubjectUnavailable } else { next_decision_inspection::NextInspectionStatus::ExecutionIncomplete };
            }
            if !completed { continue; }
            let observation_digest = digest_json(observation)?;
            let view = observed_view(observation);
            let mut groups = BTreeMap::<String, Vec<EntityId>>::new();
            for (id, entity) in &view.entities { if entity.owner == Some(side) && entity.entity_type.as_str() == "hero" && world.entities.get(id).is_some_and(next_support::alive) { let squad = next_support::string(&world.entities[id], "squad"); let group = if squad.is_empty() { format!("solo:{id}") } else { format!("squad:{squad}") }; groups.entry(group).or_default().push(id.clone()); } }
            for (_, members) in groups {
                // Keep explicit, validated orders in the same restricted trace
                // as defaults, including orders later rejected by arbitration.
                // Sort by stable action ID instead of program declaration order.
                let mut explicit: Vec<_> = validated.iter().filter(|(s, intent)| {
                    *s == side && intent.actor.as_ref().is_some_and(|id| members.contains(id))
                        && matches!(intent.capability.as_str(), "move" | "pursue" | "retreat" | "select_target")
                }).map(|(_, intent)| intent.clone()).collect();
                explicit.sort_by(|a, b| a.action_id.cmp(&b.action_id));
                let explicit_targets: BTreeSet<_> = explicit.iter().filter_map(|i| (i.capability.as_str() == "select_target").then(|| i.actor.clone()).flatten()).collect();
                let mut choices = Vec::new();
                let mut unknown_candidates = 0usize;
                let squad = next_support::string(&world.entities[&members[0]], "squad");
                // Hero instance preferences override catalog defaults per field.
                // Movement authority is shared by the current living squad, so
                // aggregate every member before applying Army and Squad overrides.
                let mut member_profiles = BTreeMap::new();
                let mut baseline_profiles = BTreeMap::new();
                let mut member_sources = BTreeMap::new();
                let mut member_catalogs = BTreeMap::new();
                for member in &members {
                    let catalog = next_support::string(&world.entities[member], "catalog_id");
                    let defaults = self.policy.policy().hero_defaults.get(&catalog).ok_or_else(|| api_error(ApiErrorCode::ValidationFailed, "missing Hero catalog profile"))?;
                    let defaults = profile_values(defaults);
                    let mut values = defaults.map(|value| value.unwrap_or(0));
                    let mut sources = defaults.map(|value| if value.is_some() { NextBehaviorProfileSource::HeroCatalog } else { NextBehaviorProfileSource::TestFallbackZero });
                    if let Some(profile) = self.inputs.heroes.get(&side).and_then(|m| m.get(member)) {
                        for (field, override_value) in profile_values(profile).into_iter().enumerate() { if let Some(v) = override_value { values[field] = v; sources[field] = NextBehaviorProfileSource::HeroInstance; } }
                    }
                    member_profiles.insert(member.clone(), values);
                    member_sources.insert(member.clone(), sources);
                    member_catalogs.insert(member.clone(), catalog);
                }
                // Army and Squad are field replacements, then the conditional
                // preference overrides that member for this tick only.
                for (member, values) in &mut member_profiles {
                    for (profile, source) in [(self.inputs.army.get(&side), NextBehaviorProfileSource::Army), (self.inputs.squads.get(&side).and_then(|m| m.get(&squad)), NextBehaviorProfileSource::Squad)] {
                        if let Some(profile) = profile {
                            for (field, override_value) in profile_values(profile).into_iter().enumerate() { if let Some(v) = override_value { values[field] = v; member_sources.get_mut(member).unwrap()[field] = source; } }
                        }
                    }
                    baseline_profiles.insert(member.clone(), *values);
                    for (field, value) in values.iter_mut().enumerate() {
                        if let Some(conditional) = overrides.get(&(side, member.clone(), field)) { *value = *conditional; member_sources.get_mut(member).unwrap()[field] = NextBehaviorProfileSource::JinreiConditional; }
                    }
                }
                let mut shared = [0i64;6];
                let mut baseline_shared = [0i64;6];
                for values in member_profiles.values() { for (sum,value) in shared.iter_mut().zip(values) { *sum += value; } }
                for values in baseline_profiles.values() { for (sum,value) in baseline_shared.iter_mut().zip(values) { *sum += value; } }
                for value in &mut shared { *value = value.div_euclid(members.len() as i64); }
                for value in &mut baseline_shared { *value = value.div_euclid(members.len() as i64); }
                let composition = |actor: &EntityId| {
                    let mut effective = shared;
                    effective[1] = member_profiles[actor][1];
                    effective[2] = member_profiles[actor][2];
                    let mut baseline_effective = baseline_shared;
                    baseline_effective[1] = baseline_profiles[actor][1];
                    baseline_effective[2] = baseline_profiles[actor][2];
                    NextBehaviorCompositionTrace {
                        squad_id: squad.clone(), shared, effective, baseline_effective,
                        members: members.iter().map(|member| NextBehaviorMemberComposition {
                            actor: member.clone(), catalog_id: member_catalogs[member].clone(),
                            values: member_profiles[member], sources: member_sources[member],
                        }).collect(),
                    }
                };
                let inspect_group = self.inspection.as_ref().is_some_and(|inspection| inspection.matches(side, tick) && members.contains(&inspection.actor));
                if inspect_group {
                    let inspection = self.inspection.as_mut().unwrap();
                    let actor = inspection.actor.clone();
                    inspection.start_group(&members, composition(&actor));
                }
                for intent in &explicit {
                    let actor = intent.actor.clone().unwrap();
                    self.traces.push(NextBehaviorTrace { tick, side, actor: actor.clone(), source: NextBehaviorSelectionSource::Explicit, policy_digest:self.policy.digest().clone(), observation_digest: observation_digest.clone(), composition: composition(&actor), eligible_candidates: explicit.len(), unknown_candidates: 0, selected: Some(intent.clone()), score: None, arbitration_accepted: false, transition_completed: false, committed_event: None });
                }
                // Explicit Jinrei goal orders take precedence for the entire current squad.
                if explicit.iter().any(|i| matches!(i.capability.as_str(), "move"|"pursue"|"retreat")) { continue; }
                for actor in &members {
                let mut offsets = shared;
                offsets[1] = member_profiles[actor][1];
                offsets[2] = member_profiles[actor][2];
                let own = &view.entities[actor];
                let target_ids: Vec<_> = view.entities.iter().filter(|(_,e)| e.owner != Some(side) && matches!(e.entity_type.as_str(), "hero"|"minion"|"monster"|"tower"|"base")).map(|(id,_)| id.clone()).collect();
                for definition in &self.policy.policy().candidates {
                    if (definition.kind == BehaviorCandidateKind::Target && explicit_targets.contains(actor)) || (definition.kind != BehaviorCandidateKind::Target && !explicit_targets.is_empty()) { continue; }
                    let targets: Vec<Option<EntityId>> = if matches!(definition.kind, BehaviorCandidateKind::Pursue | BehaviorCandidateKind::Target) { target_ids.iter().cloned().map(Some).collect() } else { vec![None] };
                    for target in targets {
                        let mut args = vec![DomainValue::Entity(actor.clone())];
                        if definition.kind == BehaviorCandidateKind::Move { args.push(DomainValue::String(match side { CombatantSide::Attacker => next.map.defender_base.clone(), CombatantSide::Defender => next.map.attacker_base.clone() })); }
                        if let Some(id) = &target { args.push(DomainValue::Entity(id.clone())); }
                        let action_id = format!("behavior:{tick}:{actor}:{:?}:{}", definition.kind, target.as_ref().map_or("", |id| id.as_str()));
                        let intent = Intent { action_id: action_id.into(), capability: definition.capability.clone(), actor: Some(actor.clone()), target: target.clone(), arguments: args, priority: None };
                        if validation::validate_intent(&intent, side, world, plan, tick, index).is_err() || !next_tactics::behavior_order_legal(world, next, side, &intent) {
                            if inspect_group { self.inspection.as_mut().unwrap().add_candidate(next_decision_inspection::NextInspectionCandidate {
                                index: 0, actor: actor.clone(), target: target.clone(), kind: definition.kind,
                                capability: definition.capability.clone(), arguments: intent.arguments.clone(), outcome: next_decision_inspection::NextCandidateOutcome::Ineligible,
                                score: None, rank: None, terms: Vec::new(), action_id: intent.action_id.clone(),
                            })?; }
                            continue;
                        }
                        let target_view = target.as_ref().and_then(|id| view.entities.get(id));
                        let mut terms = Vec::new();
                        let remaining = self.inspection.as_ref().filter(|_| inspect_group).map_or(0, |inspection| inspection.limit.saturating_sub(inspection.used).saturating_sub(1));
                        let value = score(self.policy, definition.kind, own, target_view, &view, &members, offsets, matches!(observation.collections.get(&"enemies.visible_heroes".into()), Some(senkei_model::Observed::Known(_))), if inspect_group { Some(&mut terms) } else { None }, remaining)?;
                        if inspect_group { self.inspection.as_mut().unwrap().add_candidate(next_decision_inspection::NextInspectionCandidate {
                            index: 0, actor: actor.clone(), target: target.clone(), kind: definition.kind,
                            capability: definition.capability.clone(), arguments: intent.arguments.clone(), outcome: if value.is_some() { next_decision_inspection::NextCandidateOutcome::Conflict } else { next_decision_inspection::NextCandidateOutcome::Unknown },
                            score: value, rank: None, terms, action_id: intent.action_id.clone(),
                        })?; }
                        if let Some(score) = value { choices.push((score, definition.kind, intent)); } else { unknown_candidates += 1; }
                    }
                }
                }
                let eligible_candidates = choices.len();
                choices.sort_by(|a,b| b.0.cmp(&a.0).then_with(|| a.2.action_id.cmp(&b.2.action_id)));
                let mut occupied = explicit_targets.clone();
                let mut selected_shared = false;
                let mut selected = Vec::new();
                for (rank,(score,kind,intent)) in choices.into_iter().enumerate() {
                    let actor = intent.actor.as_ref().unwrap();
                    let selected_candidate = if kind == BehaviorCandidateKind::Target {
                        !selected_shared && occupied.insert(actor.clone())
                    } else {
                        if selected_shared || !occupied.is_empty() { false } else { selected_shared = true; true }
                    };
                    if inspect_group { self.inspection.as_mut().unwrap().mark_rank(&intent.action_id, rank + 1, selected_candidate); }
                    if !selected_candidate { continue; }
                    selected.push((score,intent));
                }
                if selected.is_empty() && unknown_candidates > 0 {
                    push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::RuntimeNotice { code: "enbu.behavior_unknown_observation".into(), details: BTreeMap::from([("actor".into(), members[0].to_string()), ("candidates".into(), unknown_candidates.to_string())]) })?;
                }
                if selected.is_empty() && explicit_targets.is_empty() {
                    let trace = NextBehaviorTrace { tick, side, actor:members[0].clone(), source:NextBehaviorSelectionSource::Wait, policy_digest:self.policy.digest().clone(), observation_digest:observation_digest.clone(), composition:composition(&members[0]), eligible_candidates, unknown_candidates, selected:None, score:None, arbitration_accepted:false, transition_completed:false, committed_event:None };
                    push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::RuntimeNotice { code: "enbu.behavior_wait".into(), details: self.decision_details(&trace)? })?;
                    diagnostics.last_mut().unwrap().entity_id = Some(trace.actor.clone());
                    self.traces.push(trace);
                }
                for (value,intent) in selected {
                    if outputs.iter().flat_map(|(_,o)| &o.intents).any(|existing| existing.action_id == intent.action_id) || validated.iter().any(|(_,existing)| existing.action_id == intent.action_id) { return Err(api_error(ApiErrorCode::ValidationFailed, "duplicate Behavior action ID")); }
                    push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::IntentProposed { intent:intent.clone() })?;
                    validated.push((side,intent.clone()));
                    let actor = intent.actor.clone().unwrap();
                    self.traces.push(NextBehaviorTrace { tick, side, actor:actor.clone(), source:NextBehaviorSelectionSource::Default, policy_digest:self.policy.digest().clone(), observation_digest:observation_digest.clone(), composition:composition(&actor), eligible_candidates, unknown_candidates, selected:Some(intent), score:Some(value), arbitration_accepted:false, transition_completed:false, committed_event:None });
                }
                if validated.iter().filter(|(s,_)| *s == side).count() + self.accepted_preferences.iter().filter(|(s,_)| *s == side).count() > plan.limits.max_intents_per_side_per_tick as usize { return Err(api_error(ApiErrorCode::ResourceLimit,"Behavior intent limit exceeded")); }
            }
        }
        Ok(())
    }
    pub fn record_arbitration(&mut self,tick:u32,accepted:&[(CombatantSide,Intent)]) { for t in self.traces.iter_mut().rev().take_while(|t| t.tick == tick) { t.arbitration_accepted = t.selected.as_ref().is_some_and(|i| accepted.iter().any(|(s,a)| *s == t.side && a == i)); } }
    pub fn record_committed(&mut self, tick: u32, side: CombatantSide, action_id: &str, sequence: u32) -> Option<NextBehaviorTrace> {
        let mut committed = None;
        for trace in self.traces.iter_mut().rev().take_while(|trace| trace.tick == tick).filter(|trace| {
            trace.side == side && trace.arbitration_accepted
                && trace.selected.as_ref().is_some_and(|intent| intent.action_id.as_str() == action_id)
        }) {
            trace.committed_event = Some(NextBehaviorCommittedEventRef { tick, sequence });
            committed = Some(trace.clone());
        }
        committed
    }
    pub fn decision_details(&self, trace: &NextBehaviorTrace) -> Result<BTreeMap<String, String>, ApiError> {
        let composition = serde_json::to_string(&trace.composition).map_err(|_| api_error(ApiErrorCode::InternalError, "could not serialize Behavior composition"))?;
        let source = match trace.source { NextBehaviorSelectionSource::Explicit => "explicit", NextBehaviorSelectionSource::Default => "default", NextBehaviorSelectionSource::Wait => "wait" };
        let mut details = BTreeMap::from([
            ("next_policy_id".into(), self.policy.policy().policy_id.clone()),
            ("next_policy_digest".into(), trace.policy_digest.to_string()),
            ("observation_digest".into(), trace.observation_digest.to_string()),
            ("decision_source".into(), source.into()),
            ("profile_composition_json".into(), composition),
            ("eligible_candidates".into(), trace.eligible_candidates.to_string()),
            ("unknown_candidates".into(), trace.unknown_candidates.to_string()),
        ]);
        if let Some(score) = trace.score { details.insert("selected_score".into(), score.to_string()); }
        Ok(details)
    }
    pub fn record_transition(&mut self,tick:u32) { for t in self.traces.iter_mut().rev().take_while(|t| t.tick == tick) { t.transition_completed = true; } }
}
/// Consume validated preference intents once. Different values for the same
/// subject and field are ambiguous and all are rejected; identical values
/// retain each originating accepted action in owner diagnostics.
fn consume_preferences(validated: &mut Vec<(CombatantSide, Intent)>, outputs: &[(CombatantSide, senkei_model::TacticalExecutionOutput); 2], tick: u32, diagnostics: &mut Vec<DiagnosticEvent>, sequence: &mut u64) -> Result<(BTreeMap<(CombatantSide, EntityId, usize), i64>, Vec<(CombatantSide, Intent)>), ApiError> {
    let mut groups: BTreeMap<(CombatantSide, EntityId, usize), Vec<(Intent,i64)>> = BTreeMap::new();
    let mut extracted = Vec::new();
    validated.retain(|(side, intent)| {
        if intent.capability.as_str() == "behavior_preference" { extracted.push((*side,intent.clone())); false } else { true }
    });
    for (side,intent) in extracted {
        if !outputs.iter().any(|(candidate_side, output)| *candidate_side == side && output.status == senkei_model::TacticalExecutionStatus::Completed) {
            push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::IntentRejected { intent, reason: "enbu.behavior_incomplete_execution".into() })?;
            continue;
        }
        let (Some(actor), Some(DomainValue::Enum(field)), Some(DomainValue::Integer(value))) = (&intent.actor,intent.arguments.get(1),intent.arguments.get(2)) else { return Err(api_error(ApiErrorCode::InternalError, "invalid validated behavior preference")); };
        let index = match field.as_str() { "navigation"=>0, "engagement"=>1, "targeting"=>2, "pursuit"=>3, "survival"=>4, "objective"=>5, _=>return Err(api_error(ApiErrorCode::InternalError, "invalid behavior field")) };
        let key = (side, actor.clone(), index); let value = *value;
        groups.entry(key).or_default().push((intent,value));
    }
    let mut result = BTreeMap::new();
    let mut accepted = Vec::new();
    for (key, proposals) in groups {
        let consistent = proposals.iter().all(|(_,value)| *value == proposals[0].1);
        if consistent { result.insert(key.clone(),proposals[0].1); }
        for (intent,_) in proposals {
            if consistent { accepted.push((key.0, intent.clone())); }
            let record = if consistent { DiagnosticRecord::IntentAccepted { intent } } else { DiagnosticRecord::IntentRejected { intent, reason: "enbu.behavior_preference_conflict".into() } };
            push_diagnostic(diagnostics, sequence, tick, key.0, record)?;
        }
    }
    Ok((result, accepted))
}
fn observed_view(observation: &ObservationSnapshot) -> senkei_model::WorldStateView {
    let mut entities = BTreeMap::new();
    for (collection, values) in &observation.collections {
        let name = collection.as_str();
        let owner = if name.starts_with("allies.") { Some(observation.side) } else if name.starts_with("enemies.visible_") { Some(match observation.side { CombatantSide::Attacker => CombatantSide::Defender, CombatantSide::Defender => CombatantSide::Attacker }) } else if name == "neutrals.visible_monsters" { None } else { continue };
        let senkei_model::Observed::Known(values) = values else { continue };
        for value in values {
            let fields = value.fields.iter().filter_map(|(key,value)| match value { senkei_model::Observed::Known(value) => Some((key.clone(),value.clone())), senkei_model::Observed::Unknown => None }).collect();
            entities.insert(value.id.clone(), senkei_model::EntityStateView { entity_type:value.entity_type.clone(), owner, fields });
        }
    }
    senkei_model::WorldStateView { entities, global_fields:BTreeMap::new() }
}
fn score(policy: &VerifiedNextBehaviorPolicy, kind: BehaviorCandidateKind, actor: &senkei_model::EntityStateView, target: Option<&senkei_model::EntityStateView>, view: &senkei_model::WorldStateView, members: &[EntityId], offsets: [i64;6], danger_known: bool, mut captured: Option<&mut Vec<next_decision_inspection::NextInspectionTerm>>, limit: u64) -> Result<Option<i64>, ApiError> {
    use next_decision_inspection::NextInspectionTerm;
    let mut record = |term: NextInspectionTerm| -> Result<(), ApiError> {
        if let Some(terms) = captured.as_deref_mut() {
            if terms.len() as u64 >= limit { return Err(api_error(ApiErrorCode::ResourceLimit, "inspection diagnostic limit exceeded")); }
            terms.push(term);
        }
        Ok(())
    };
    let d = &policy.policy().domains;
    let domains = [&d.navigation,&d.engagement,&d.targeting,&d.pursuit,&d.survival,&d.objective];
    let names = ["navigation", "engagement", "targeting", "pursuit", "survival", "objective"];
    let mut result = 0i64;
    for (index,(terms,offset)) in domains.into_iter().zip(offsets).enumerate() {
        let applicable = match kind { BehaviorCandidateKind::Move => matches!(index, 0 | 5), BehaviorCandidateKind::Pursue => index == 3, BehaviorCandidateKind::Target => matches!(index, 1 | 2), BehaviorCandidateKind::Retreat => index == 4 };
        if !applicable { continue; }
        let (component, weight, value, contribution) = if kind == BehaviorCandidateKind::Target && index == 2 && offset != 0 {
            let value = target.and_then(health);
            ("target_health_offset", Some(offset), value, value.and_then(|value| value.checked_mul(offset)))
        } else {
            ("offset", None, Some(offset), Some(offset))
        };
        record(NextInspectionTerm { domain: names[index], kind: component, signal: None, weight, value, contribution })?;
        let Some(total) = contribution.and_then(|value| result.checked_add(value)) else { return Ok(None) };
        result = total;
        for term in terms {
            let signal = match term.signal {
                BehaviorSignal::Constant => Some(100),
                BehaviorSignal::CandidateMove => Some(if kind == BehaviorCandidateKind::Move { 100 } else { 0 }),
                BehaviorSignal::CandidatePursue => Some(if kind == BehaviorCandidateKind::Pursue { 100 } else { 0 }),
                BehaviorSignal::CandidateRetreat => Some(if kind == BehaviorCandidateKind::Retreat { 100 } else { 0 }),
                BehaviorSignal::CandidateTarget => Some(if kind == BehaviorCandidateKind::Target { 100 } else { 0 }),
                BehaviorSignal::ActorHealthPercent => health(actor),
                BehaviorSignal::TargetHealthPercent => target.and_then(health),
                BehaviorSignal::SquadHealthPercent => members.iter().map(|id| view.entities.get(id).and_then(health)).collect::<Option<Vec<_>>>().map(|values| values.iter().sum::<i64>() / values.len() as i64),
                BehaviorSignal::TargetProximity => target.and_then(|target| proximity(actor,target)),
                BehaviorSignal::ObservedDanger => danger_known.then(|| view.entities.values().filter(|entity| entity.owner != actor.owner && entity.entity_type.as_str() == "hero").count().min(100) as i64),
                BehaviorSignal::ObjectiveValue => Some(100),
                BehaviorSignal::RouteCost => None,
            };
            let contribution = signal.and_then(|value| value.checked_mul(term.weight));
            record(NextInspectionTerm { domain: names[index], kind: "signal", signal: Some(term.signal), weight: Some(term.weight), value: signal, contribution })?;
            let Some(total) = contribution.and_then(|value| result.checked_add(value)) else { return Ok(None) };
            result = total;
        }
    }
    Ok(Some(result))
}
fn health(entity: &senkei_model::EntityStateView) -> Option<i64> { let (DomainValue::Integer(hp),DomainValue::Integer(max)) = (entity.fields.get(&"hp".into())?,entity.fields.get(&"max_hp".into())?) else { return None }; if *max <= 0 { return None } Some((i128::from(*hp).clamp(0,i128::from(*max))*100/i128::from(*max)) as i64) }
fn proximity(a: &senkei_model::EntityStateView,b: &senkei_model::EntityStateView) -> Option<i64> { let read = |e: &senkei_model::EntityStateView, k: &str| match e.fields.get(&k.into()) { Some(DomainValue::Integer(v)) => Some(*v), _ => None }; let dist = (i128::from(read(a,"x")?) - i128::from(read(b,"x")?)).abs() + (i128::from(read(a,"y")?) - i128::from(read(b,"y")?)).abs(); Some(100 - dist.min(100) as i64) }
