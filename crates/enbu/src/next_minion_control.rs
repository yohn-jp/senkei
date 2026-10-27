//! Consume RulePackage-authored, actorless Army/Lane Minion preferences.
//! The currently supported candidate reapplies the existing automatic lane
//! waypoint; the runtime does not invent individual orders or new movement.
use super::*;
use senkei_model::{MinionBehaviorCandidate, MinionControlScope, MinionLane, NextMinionControlDeclaration};

pub(crate) fn validate_context(rules: &VerifiedRulePlan, context: &MatchContext) -> Result<(), ApiError> {
    if let Some(binding) = &context.next_minion_control {
        senritsu::validate_next_minion_control_match(binding, rules)
            .map_err(|message| api_error(ApiErrorCode::ValidationFailed, message))?;
        if context.next_minion_behavior.is_none() {
            return Err(api_error(ApiErrorCode::ValidationFailed, "Minion control requires a frozen Minion policy"));
        }
    }
    Ok(())
}

/// Reject forged actor/target fields, unbound capabilities, or outputs that did
/// not complete. Remaining proposals go through normal RulePlan arbitration.
pub(crate) fn prevalidate(
    declaration: Option<&NextMinionControlDeclaration>,
    enabled: bool,
    validated: &mut Vec<(CombatantSide, Intent)>,
    outputs: &[(CombatantSide, senkei_model::TacticalExecutionOutput); 2],
    tick: u32,
    diagnostics: &mut Vec<DiagnosticEvent>,
    sequence: &mut u64,
) -> Result<(), ApiError> {
    let Some(declaration) = declaration else { return Ok(()) };
    let mut counts = BTreeMap::new();
    for (side, intent) in validated.iter() {
        *counts.entry((*side, intent.action_id.clone())).or_insert(0usize) += 1;
    }
    let mut rejected = Vec::new();
    validated.retain(|(side, intent)| {
        let Some(binding) = declaration.capabilities.get(&intent.capability) else { return true };
        let reason = if !enabled { Some("enbu.minion_control_not_bound") }
        else if intent.actor.is_some() || intent.target.is_some() { Some("enbu.minion_control_individual_actor") }
        else if counts.get(&(*side, intent.action_id.clone())).copied().unwrap_or_default() > 1 {
            Some("enbu.minion_control_duplicate_action")
        }
        else if !outputs.iter().any(|(owner, output)| *owner == *side && output.status == senkei_model::TacticalExecutionStatus::Completed) {
            Some("enbu.minion_control_incomplete_execution")
        } else if selected_lane(binding, intent).is_none() { Some("enbu.minion_control_invalid_scope") }
        else { None };
        if let Some(reason) = reason { rejected.push((*side, intent.clone(), reason)); false } else { true }
    });
    for (side, intent, reason) in rejected {
        push_diagnostic(diagnostics, sequence, tick, side, DiagnosticRecord::IntentRejected { intent, reason: reason.into() })?;
    }
    Ok(())
}

/// `Some(None)` means Army scope, `Some(Some(lane))` means Lane scope.
fn selected_lane(binding: &senkei_model::MinionControlCapability, intent: &Intent) -> Option<Option<MinionLane>> {
    match &binding.scope {
        MinionControlScope::Army if intent.arguments.is_empty() => Some(None),
        MinionControlScope::Lane { values } if intent.arguments.len() == 1 => match &intent.arguments[0] {
            DomainValue::Enum(value) => values.get(value).copied().map(Some),
            _ => None,
        },
        _ => None,
    }
}

pub(crate) struct MinionControlSelections {
    scope_resolution: senkei_model::MinionControlScopeResolution,
    army: BTreeMap<CombatantSide, Vec<Intent>>,
    lanes: BTreeMap<(CombatantSide, MinionLane), Vec<Intent>>,
}

impl MinionControlSelections {
    /// Conditional Jinrei preferences supersede static Army/Lane preferences;
    /// an explicit Lane preference narrows an Army preference for that lane.
    pub fn actions_for(&self, side: CombatantSide, lane: MinionLane) -> &[Intent] {
        match self.scope_resolution {
            senkei_model::MinionControlScopeResolution::LaneOverridesArmy =>
                self.lanes.get(&(side, lane)).or_else(|| self.army.get(&side)).map(Vec::as_slice).unwrap_or(&[]),
        }
    }
}

/// Consume only intents that passed the ordinary RulePlan arbitration. Equal
/// candidates from distinct capabilities remain attributed to every accepted
/// action; there are currently no unequal Minion candidates to rank.
pub(crate) fn commit(
    declaration: &NextMinionControlDeclaration,
    accepted: &[(CombatantSide, Intent)],
    world: &mut WorldState,
    rules: &senkei_model::NextRules,
    tick: u32,
    diagnostics: &mut Vec<DiagnosticEvent>,
    sequence: &mut u64,
) -> Result<MinionControlSelections, ApiError> {
    let mut selected = MinionControlSelections {
        scope_resolution: declaration.scope_resolution,
        army: BTreeMap::new(), lanes: BTreeMap::new(),
    };
    for (side, intent) in accepted {
        let Some(binding) = declaration.capabilities.get(&intent.capability) else { continue };
        if intent.actor.is_some() || intent.target.is_some() {
            return Err(api_error(ApiErrorCode::InternalError, "accepted Minion control has an actor or target"));
        }
        let lane = selected_lane(binding, intent).ok_or_else(|| api_error(ApiErrorCode::InternalError, "accepted Minion control has invalid scope"))?;
        match binding.candidate { MinionBehaviorCandidate::LaneWaypoint => {} }
        if let Some(lane) = lane { selected.lanes.entry((*side, lane)).or_default().push(intent.clone()); }
        else { selected.army.entry(*side).or_default().push(intent.clone()); }
        let mut details = BTreeMap::from([
            ("candidate".into(), "lane_waypoint".into()),
            ("scope".into(), if lane.is_some() { "lane".into() } else { "army".into() }),
            ("capability".into(), intent.capability.to_string()),
        ]);
        if let Some(lane) = lane { details.insert("lane".into(), lane.as_str().into()); }
        push_diagnostic(diagnostics, sequence, tick, *side, DiagnosticRecord::RuntimeNotice { code: "enbu.minion_control_committed".into(), details })?;
        diagnostics.last_mut().expect("pushed diagnostic").action_id = Some(intent.action_id.clone());
    }
    for actions in selected.army.values_mut().chain(selected.lanes.values_mut()) {
        actions.sort_by(|a, b| a.action_id.cmp(&b.action_id).then_with(|| a.capability.cmp(&b.capability)));
    }
    for entity in world.entities.values_mut() {
        if entity.entity_type.as_str() != "minion" || !next_support::alive(entity) { continue; }
        let Some(side) = entity.owner else { continue };
        let lane_name = next_support::string(entity, "lane");
        let lane = match lane_name.as_str() {
            "top" => MinionLane::Top, "mid" => MinionLane::Mid, "bot" => MinionLane::Bot,
            _ => continue,
        };
        if selected.actions_for(side, lane).is_empty() { continue; }
        // Match the existing lifecycle, including its in-transit protection.
        let edge_to = next_support::string(entity, "edge_to");
        if !edge_to.is_empty() && !next_support::string(entity, "goal").is_empty() { continue; }
        let node = if edge_to.is_empty() { next_support::string(entity, "node") } else { edge_to };
        if let Some(goal) = next_vision::lane_waypoint(&rules.map, side, lane.as_str(), &node) {
            next_support::set_string(entity, "goal", goal);
        }
    }
    Ok(selected)
}
