//! Versioned test-policy driven defaults for Next. All traces are owner restricted.
use super::*;
use senkei_model::{BehaviorCandidateKind, BehaviorSignal};
use senritsu::VerifiedNextBehaviorPolicy;
use serde::Serialize;

pub use senkei_model::{NextBehaviorExecutionInputs, NextBehaviorProfile};
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NextBehaviorTrace { pub tick: u32, pub side: CombatantSide, pub actor: EntityId, pub selected: Option<Intent>, pub score: Option<i64>, pub arbitration_accepted: bool, pub transition_completed: bool }
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
    let mut hook = Hook { policy, inputs, traces: Vec::new() };
    let artifact = simulate_inner(attacker, defender, rules, &frozen, executor, None, Some(&mut hook))?;
    let digest = artifact.diagnostic_snapshot_digest.clone();
    Ok(NextBehaviorSimulationArtifact { artifact, policy: policy.clone(), inputs: inputs.clone(), digest, traces: hook.traces })
}
pub(crate) fn validate_inputs(rules: &VerifiedRulePlan, context: &MatchContext, policy: &VerifiedNextBehaviorPolicy, inputs: &NextBehaviorExecutionInputs) -> Result<(), ApiError> {
    if rules.plan().next.is_none() || policy.policy().ruleset_digest != *rules.package_digest() || inputs.schema_version != 1 { return Err(api_error(ApiErrorCode::IncompatibleVersion, "Next Behavior policy or input incompatible")); }
    let size = serde_json::to_vec(inputs).map_err(|_| api_error(ApiErrorCode::InvalidRequest, "invalid Behavior inputs"))?.len() as u64;
    if size > context.host_limits.max_input_bytes.min(rules.plan().limits.max_input_bytes) { return Err(api_error(ApiErrorCode::ResourceLimit, "Behavior input limit exceeded")); }
    let profiles = inputs.army.values().chain(inputs.squads.values().flat_map(|m| m.values())).chain(inputs.heroes.values().flat_map(|m| m.values()));
    if profiles.flat_map(profile_values).any(|x| !(-1_000_000..=1_000_000).contains(&x)) { return Err(api_error(ApiErrorCode::ValidationFailed, "Behavior profile offset out of range")); }
    Ok(())
}
fn profile_values(p: &NextBehaviorProfile) -> [i64; 6] { [p.navigation,p.engagement,p.targeting,p.pursuit,p.survival,p.objective] }
pub(crate) struct Hook<'a> { pub policy: &'a VerifiedNextBehaviorPolicy, pub inputs: &'a NextBehaviorExecutionInputs, pub traces: Vec<NextBehaviorTrace> }
impl Hook<'_> {
    pub fn select(&mut self, validated: &mut Vec<(CombatantSide, Intent)>, outputs: &[(CombatantSide, senkei_model::TacticalExecutionOutput); 2], world: &WorldState, plan: &RulePlan, tick: u32, index: &world::ProjectionIndex, diagnostics: &mut Vec<DiagnosticEvent>, sequence: &mut u64) -> Result<(), ApiError> {
        let next = plan.next.as_ref().unwrap();
        for side in [CombatantSide::Attacker, CombatantSide::Defender] {
            if outputs.iter().find(|(s,_)| *s == side).unwrap().1.status != senkei_model::TacticalExecutionStatus::Completed { continue; }
            // This view freezes the side's current visibility. It contains no unseen targets.
            let view = next_vision::team_view(world, next, side);
            let mut groups = BTreeMap::<String, Vec<EntityId>>::new();
            for (id, entity) in &view.entities { if entity.owner == Some(side) && entity.entity_type.as_str() == "hero" && world.entities.get(id).is_some_and(next_support::alive) { let squad = next_support::string(&world.entities[id], "squad"); let group = if squad.is_empty() { format!("solo:{id}") } else { format!("squad:{squad}") }; groups.entry(group).or_default().push(id.clone()); } }
            for (_, members) in groups {
                // Explicit Jinrei goal orders take precedence for the entire current squad.
                if validated.iter().any(|(s,i)| *s == side && i.actor.as_ref().is_some_and(|id| members.contains(id)) && matches!(i.capability.as_str(), "move"|"pursue"|"retreat")) { continue; }
                let mut choices = Vec::new();
                for actor in &members {
                let squad = next_support::string(&world.entities[actor], "squad");
                let mut offsets = [0i64;6];
                for p in [self.inputs.army.get(&side), self.inputs.squads.get(&side).and_then(|m| m.get(&squad)), self.inputs.heroes.get(&side).and_then(|m| m.get(actor))].into_iter().flatten() { for (sum,v) in offsets.iter_mut().zip(profile_values(p)) { *sum += v; } }
                let own = &view.entities[actor];
                let target_ids: Vec<_> = view.entities.iter().filter(|(_,e)| e.owner != Some(side) && matches!(e.entity_type.as_str(), "hero"|"minion"|"monster"|"tower"|"base")).map(|(id,_)| id.clone()).collect();
                for definition in &self.policy.policy().candidates {
                    let targets: Vec<Option<EntityId>> = if definition.kind == BehaviorCandidateKind::Pursue { target_ids.iter().cloned().map(Some).collect() } else { vec![None] };
                    for target in targets {
                        let mut args = vec![DomainValue::Entity(actor.clone())];
                        if definition.kind == BehaviorCandidateKind::Move { args.push(DomainValue::String(match side { CombatantSide::Attacker => next.map.defender_base.clone(), CombatantSide::Defender => next.map.attacker_base.clone() })); }
                        if let Some(id) = &target { args.push(DomainValue::Entity(id.clone())); }
                        let action_id = format!("behavior:{tick}:{actor}:{:?}:{}", definition.kind, target.as_ref().map_or("", |id| id.as_str()));
                        let intent = Intent { action_id: action_id.into(), capability: definition.capability.clone(), actor: Some(actor.clone()), target: target.clone(), arguments: args, priority: None };
                        if validation::validate_intent(&intent, side, world, plan, tick, index).is_err() { continue; }
                        let target_view = target.as_ref().and_then(|id| view.entities.get(id));
                        if let Some(score) = score(self.policy, definition.kind, own, target_view, &view, &members, offsets) { choices.push((score, intent)); }
                    }
                }
                }
                choices.sort_by(|a,b| b.0.cmp(&a.0).then_with(|| a.1.action_id.cmp(&b.1.action_id)));
                let selected = choices.into_iter().next();
                let (value, intent) = match selected { Some((v,i)) => { push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::IntentProposed { intent:i.clone() })?; validated.push((side,i.clone())); (Some(v),Some(i)) }, None => (None,None) };
                let trace_actor = intent.as_ref().and_then(|i| i.actor.clone()).unwrap_or_else(|| members[0].clone());
                self.traces.push(NextBehaviorTrace { tick, side, actor: trace_actor, selected:intent, score:value, arbitration_accepted:false, transition_completed:false });
                if validated.iter().filter(|(s,_)| *s == side).count() > plan.limits.max_intents_per_side_per_tick as usize { return Err(api_error(ApiErrorCode::ResourceLimit,"Behavior intent limit exceeded")); }
            }
        }
        Ok(())
    }
    pub fn record_arbitration(&mut self,tick:u32,accepted:&[(CombatantSide,Intent)]) { for t in self.traces.iter_mut().filter(|t| t.tick == tick) { t.arbitration_accepted = t.selected.as_ref().is_some_and(|i| accepted.iter().any(|(s,a)| *s == t.side && a == i)); } }
    pub fn record_transition(&mut self,tick:u32) { for t in self.traces.iter_mut().filter(|t| t.tick == tick) { t.transition_completed = true; } }
}
fn score(policy: &VerifiedNextBehaviorPolicy, kind: BehaviorCandidateKind, actor: &senkei_model::EntityStateView, target: Option<&senkei_model::EntityStateView>, view: &senkei_model::WorldStateView, members: &[EntityId], offsets: [i64;6]) -> Option<i64> {
    let d = &policy.policy().domains; let domains = [&d.navigation,&d.engagement,&d.targeting,&d.pursuit,&d.survival,&d.objective]; let mut result = 0i64;
    for (index,(terms,offset)) in domains.into_iter().zip(offsets).enumerate() {
        let applicable = match kind { BehaviorCandidateKind::Move => matches!(index, 0 | 5), BehaviorCandidateKind::Pursue => matches!(index, 1 | 2 | 3), BehaviorCandidateKind::Retreat => index == 4 };
        if !applicable { continue; }
        result = result.checked_add(offset)?; for term in terms { let signal = match term.signal { BehaviorSignal::Constant => Some(100), BehaviorSignal::CandidateMove => Some(if kind == BehaviorCandidateKind::Move { 100 } else { 0 }), BehaviorSignal::CandidatePursue => Some(if kind == BehaviorCandidateKind::Pursue { 100 } else { 0 }), BehaviorSignal::CandidateRetreat => Some(if kind == BehaviorCandidateKind::Retreat { 100 } else { 0 }), BehaviorSignal::ActorHealthPercent => health(actor), BehaviorSignal::TargetHealthPercent => target.and_then(health), BehaviorSignal::SquadHealthPercent => { let values: Option<Vec<_>> = members.iter().map(|id| view.entities.get(id).and_then(health)).collect(); let values = values?; Some(values.iter().sum::<i64>() / values.len() as i64) }, BehaviorSignal::TargetProximity => target.and_then(|t| proximity(actor,t)), BehaviorSignal::ObservedDanger => Some(view.entities.values().filter(|e| e.owner != actor.owner && e.entity_type.as_str() == "hero").count().min(100) as i64), BehaviorSignal::ObjectiveValue => Some(100), BehaviorSignal::RouteCost => None }; result = result.checked_add(signal?.checked_mul(term.weight)?)?; } }
    Some(result)
}
fn health(entity: &senkei_model::EntityStateView) -> Option<i64> { let (DomainValue::Integer(hp),DomainValue::Integer(max)) = (entity.fields.get(&"hp".into())?,entity.fields.get(&"max_hp".into())?) else { return None }; if *max <= 0 { return None } Some((i128::from(*hp).clamp(0,i128::from(*max))*100/i128::from(*max)) as i64) }
fn proximity(a: &senkei_model::EntityStateView,b: &senkei_model::EntityStateView) -> Option<i64> { let read = |e: &senkei_model::EntityStateView, k: &str| match e.fields.get(&k.into()) { Some(DomainValue::Integer(v)) => Some(*v), _ => None }; let dist = (i128::from(read(a,"x")?) - i128::from(read(b,"x")?)).abs() + (i128::from(read(a,"y")?) - i128::from(read(b,"y")?)).abs(); Some(100 - dist.min(100) as i64) }
