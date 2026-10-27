//! Test-only inspection of the existing Minion lane-waypoint candidate.
//!
//! These scoped preferences do not issue individual orders or change the
//! automatic lifecycle. Candidate inputs and traces use only the owning side's
//! frozen observation and the public, verified lane routes.
use super::*;
use senkei_model::{MinionBehaviorCandidate, MinionLane, Observed};
use senritsu::VerifiedNextMinionBehaviorPolicy;
use serde::Serialize;

pub use senkei_model::NextMinionBehaviorExecutionInputs;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NextMinionPreferenceSource { Army, Lane }

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum NextMinionWaypoint {
    /// The existing lifecycle's next lane waypoint can be determined from the
    /// current observation. This is a candidate, not a committed order.
    Ready { node: String },
    /// Existing movement continues; the owning observation does not expose the
    /// internal goal, so this trace never guesses the current destination.
    InTransit,
    EndOfLane,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NextMinionBehaviorTrace {
    pub tick: u32,
    pub side: CombatantSide,
    pub lane: MinionLane,
    pub source: NextMinionPreferenceSource,
    pub candidate: MinionBehaviorCandidate,
    pub actor: EntityId,
    pub waypoint: NextMinionWaypoint,
}

#[derive(Clone)]
pub struct NextMinionBehaviorSimulationArtifact {
    artifact: SimulationArtifact,
    policy: VerifiedNextMinionBehaviorPolicy,
    inputs: NextMinionBehaviorExecutionInputs,
    traces: Vec<NextMinionBehaviorTrace>,
}

impl NextMinionBehaviorSimulationArtifact {
    pub fn public_response(&self) -> senkei_model::PublicSimulationResponse {
        self.artifact.public_response()
    }
    pub fn diagnostics_for_owner(&self, side: CombatantSide) -> BehaviorOwnerDiagnostics {
        let diagnostics = self.artifact.diagnostic_response(side).diagnostics.expect("owner diagnostics");
        BehaviorOwnerDiagnostics { behavior_run_digest: self.artifact.diagnostic_snapshot_digest.clone(), diagnostics }
    }
    pub fn traces_for_owner(&self, side: CombatantSide) -> Vec<NextMinionBehaviorTrace> {
        self.traces.iter().filter(|trace| trace.side == side).cloned().collect()
    }
    pub fn run_digest(&self) -> &ContentDigest { &self.artifact.diagnostic_snapshot_digest }
    pub fn reproduction(&self) -> (&ReproductionContext, &NextMinionBehaviorExecutionInputs, &VerifiedNextMinionBehaviorPolicy) {
        (&self.artifact.reproduction, &self.inputs, &self.policy)
    }
    pub fn reproduce<P: TacticalExecutionPort>(&self, rules: &VerifiedRulePlan, executor: &mut P) -> Result<Self, ApiError> {
        let reproduction = &self.artifact.reproduction;
        simulate_next_minion_behavior(&reproduction.attacker, &reproduction.defender, rules, &reproduction.context, executor, &self.policy, &self.inputs)
    }
}

pub fn simulate_next_minion_behavior<P: TacticalExecutionPort>(
    attacker: &senkei_model::SenkeiSnapshot,
    defender: &senkei_model::SenkeiSnapshot,
    rules: &VerifiedRulePlan,
    context: &MatchContext,
    executor: &mut P,
    policy: &VerifiedNextMinionBehaviorPolicy,
    inputs: &NextMinionBehaviorExecutionInputs,
) -> Result<NextMinionBehaviorSimulationArtifact, ApiError> {
    validate_inputs(rules, context, policy, inputs)?;
    let mut frozen = context.clone();
    let binding = senkei_model::NextMinionBehaviorMatch { policy: policy.policy().clone(), inputs: inputs.clone() };
    if frozen.next_minion_behavior.as_ref().is_some_and(|existing| existing != &binding) {
        return Err(api_error(ApiErrorCode::ValidationFailed, "Next Minion Behavior context mismatch"));
    }
    frozen.next_minion_behavior = Some(binding);
    let mut hook = Hook { policy, inputs, traces: Vec::new() };
    // Preserve an independently frozen Hero Behavior policy when both are present.
    let hero_policy = frozen.next_behavior.as_ref().map(|binding| {
        senritsu::validate_next_behavior_policy(binding.policy.clone(), rules)
            .map_err(|error| api_error(ApiErrorCode::ValidationFailed, error))
    }).transpose()?;
    let mut hero_hook = if let (Some(binding), Some(hero_policy)) = (&frozen.next_behavior, &hero_policy) {
        next_behavior::validate_inputs(rules, &frozen, hero_policy, &binding.inputs)?;
        Some(next_behavior::Hook { policy: hero_policy, inputs: &binding.inputs, traces: Vec::new(), accepted_preferences: Vec::new() })
    } else { None };
    let artifact = simulate_inner(attacker, defender, rules, &frozen, executor, None, hero_hook.as_mut(), Some(&mut hook), None)?;
    Ok(NextMinionBehaviorSimulationArtifact { artifact, policy: policy.clone(), inputs: inputs.clone(), traces: hook.traces })
}

pub(crate) fn validate_inputs(
    rules: &VerifiedRulePlan,
    context: &MatchContext,
    policy: &VerifiedNextMinionBehaviorPolicy,
    inputs: &NextMinionBehaviorExecutionInputs,
) -> Result<(), ApiError> {
    let Some(next) = rules.plan().next.as_ref() else {
        return Err(api_error(ApiErrorCode::IncompatibleVersion, "Minion Behavior requires Next rules"));
    };
    if policy.policy().ruleset_digest != *rules.package_digest() || inputs.schema_version != 1 {
        return Err(api_error(ApiErrorCode::IncompatibleVersion, "Minion Behavior policy or input incompatible"));
    }
    let size = serde_json::to_vec(inputs)
        .map_err(|_| api_error(ApiErrorCode::InvalidRequest, "invalid Minion Behavior inputs"))?.len() as u64;
    if size > context.host_limits.max_input_bytes.min(rules.plan().limits.max_input_bytes) {
        return Err(api_error(ApiErrorCode::ResourceLimit, "Minion Behavior input limit exceeded"));
    }
    for (lane, candidate) in inputs.lanes.values().flat_map(|lanes| lanes.iter()) {
        if !next.map.lanes.contains_key(lane.as_str()) || *candidate != policy.policy().candidate {
            return Err(api_error(ApiErrorCode::ValidationFailed, "invalid Minion lane or candidate"));
        }
    }
    if inputs.army.values().any(|candidate| *candidate != policy.policy().candidate) {
        return Err(api_error(ApiErrorCode::ValidationFailed, "invalid Minion Army candidate"));
    }
    Ok(())
}

pub(crate) struct Hook<'a> {
    pub policy: &'a VerifiedNextMinionBehaviorPolicy,
    pub inputs: &'a NextMinionBehaviorExecutionInputs,
    pub traces: Vec<NextMinionBehaviorTrace>,
}

impl Hook<'_> {
    /// Called after both same-tick observation snapshots are frozen. The only
    /// available candidate is a read-only account of the automatic lifecycle.
    pub fn evaluate(
        &mut self,
        observations: &[ObservationSnapshot; 2],
        rules: &senkei_model::NextRules,
        tick: u32,
        max_traces: u64,
    ) -> Result<(), ApiError> {
        for observation in observations {
            let side = observation.side;
            let Some(Observed::Known(minions)) = observation.collections.get(&"allies.minions".into()) else { continue };
            let mut minions: Vec<_> = minions.iter().filter(|entity| entity.entity_type.as_str() == "minion").collect();
            minions.sort_by(|a, b| a.id.cmp(&b.id));
            for minion in minions {
                // Only living, known allied entities from the authorized collection.
                if !matches!(minion.fields.get(&"hp".into()), Some(Observed::Known(DomainValue::Integer(hp))) if *hp > 0) { continue; }
                let Some(Observed::Known(DomainValue::String(lane))) = minion.fields.get(&"lane".into()) else { continue };
                let lane = match lane.as_str() {
                    "top" => MinionLane::Top, "mid" => MinionLane::Mid, "bot" => MinionLane::Bot,
                    _ => continue,
                };
                let (source, candidate) = if let Some(candidate) = self.inputs.lanes.get(&side).and_then(|lanes| lanes.get(&lane)) {
                    (NextMinionPreferenceSource::Lane, *candidate)
                } else if let Some(candidate) = self.inputs.army.get(&side) {
                    (NextMinionPreferenceSource::Army, *candidate)
                } else { continue };
                if candidate != self.policy.policy().candidate { return Err(api_error(ApiErrorCode::ValidationFailed, "unverified Minion candidate")); }
                let waypoint = match (minion.fields.get(&"node".into()), minion.fields.get(&"edge_to".into())) {
                    (Some(Observed::Known(DomainValue::String(node))), Some(Observed::Known(DomainValue::String(edge_to)))) => {
                        if !edge_to.is_empty() { NextMinionWaypoint::InTransit }
                        else if !rules.map.lanes.get(lane.as_str()).is_some_and(|nodes| nodes.contains(node)) {
                            NextMinionWaypoint::Unknown
                        } else {
                            match next_vision::lane_waypoint(&rules.map, side, lane.as_str(), node) {
                                Some(node) => NextMinionWaypoint::Ready { node },
                                None => NextMinionWaypoint::EndOfLane,
                            }
                        }
                    }
                    _ => NextMinionWaypoint::Unknown,
                };
                if (self.traces.len() as u64) >= max_traces {
                    return Err(api_error(ApiErrorCode::ResourceLimit, "Minion Behavior trace limit exceeded"));
                }
                self.traces.push(NextMinionBehaviorTrace { tick, side, lane, source, candidate, actor: minion.id.clone(), waypoint });
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{EntityObservation, NextMinionBehaviorPolicy};

    fn entity(id: &str, kind: &str, lane: &str, hp: i64, node: Option<&str>, edge: Option<&str>) -> EntityObservation {
        let mut fields = BTreeMap::from([
            ("lane".into(), Observed::Known(DomainValue::String(lane.into()))),
            ("hp".into(), Observed::Known(DomainValue::Integer(hp))),
        ]);
        if let Some(node) = node { fields.insert("node".into(), Observed::Known(DomainValue::String(node.into()))); }
        if let Some(edge) = edge { fields.insert("edge_to".into(), Observed::Known(DomainValue::String(edge.into()))); }
        EntityObservation { id: id.into(), entity_type: kind.into(), fields }
    }

    #[test]
    fn observation_only_filters_hero_dead_and_invalid_lane_and_preserves_unknown() {
        let rules = senritsu::validate(senritsu::next_package(), &senritsu::next_engine_compatibility()).unwrap();
        let policy = senritsu::validate_next_minion_behavior_policy(NextMinionBehaviorPolicy {
            schema_version: 1, policy_id: "test".into(), version: Version::new(1, 0, 0),
            ruleset_digest: rules.package_digest().clone(), test_only: true,
            candidate: MinionBehaviorCandidate::LaneWaypoint,
        }, &rules).unwrap();
        let inputs = NextMinionBehaviorExecutionInputs {
            schema_version: 1,
            army: BTreeMap::from([(CombatantSide::Attacker, MinionBehaviorCandidate::LaneWaypoint)]),
            lanes: BTreeMap::new(),
        };
        let observation = ObservationSnapshot {
            tick: 1, side: CombatantSide::Attacker, fields: BTreeMap::new(),
            collections: BTreeMap::from([("allies.minions".into(), Observed::Known(vec![
                entity("hero", "hero", "mid", 1, Some("A.BASE"), Some("")),
                entity("bad-lane", "minion", "jungle", 1, Some("A.BASE"), Some("")),
                entity("dead", "minion", "mid", 0, Some("A.BASE"), Some("")),
                entity("unknown", "minion", "mid", 1, None, Some("")),
                entity("outside", "minion", "mid", 1, Some("A.TOP.T1"), Some("")),
                entity("ready", "minion", "mid", 1, Some("A.BASE"), Some("")),
            ]))]),
        };
        let unknown_enemy_collection = ObservationSnapshot {
            tick: 1, side: CombatantSide::Defender, fields: BTreeMap::new(),
            collections: BTreeMap::from([("allies.minions".into(), Observed::Unknown)]),
        };
        let mut hook = Hook { policy: &policy, inputs: &inputs, traces: Vec::new() };
        hook.evaluate(&[observation, unknown_enemy_collection], rules.plan().next.as_ref().unwrap(), 1, 10).unwrap();
        assert_eq!(hook.traces.len(), 3);
        assert_eq!(hook.traces.iter().map(|trace| trace.actor.as_str()).collect::<Vec<_>>(), vec!["outside", "ready", "unknown"]);
        assert_eq!(hook.traces[0].waypoint, NextMinionWaypoint::Unknown);
        assert_eq!(hook.traces[1].waypoint, NextMinionWaypoint::Ready { node: "A.MID.T1".into() });
        assert_eq!(hook.traces[2].waypoint, NextMinionWaypoint::Unknown);
    }
}
