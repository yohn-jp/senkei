//! Restricted records from the existing autonomous basic-attack selection.
//!
//! These are combat-phase records, not a complete account of movement or of
//! the actor's behavior profile. The collector records only candidates which
//! the real selection evaluated as eligible; it does not infer candidates from
//! the resulting world. Neutral actors have no player owner.

use senkei_model::{CombatantSide, EntityId};
use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AutonomousActorKind {
    Minion,
    Monster,
    Tower,
    Base,
}

impl AutonomousActorKind {
    pub(crate) fn from_type(kind: &str) -> Option<Self> {
        match kind {
            "minion" => Some(Self::Minion),
            "monster" => Some(Self::Monster),
            "tower" => Some(Self::Tower),
            "base" => Some(Self::Base),
            _ => None,
        }
    }
}

/// The branch of the existing target selection that chose the attack.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AutonomousTargetSelection {
    RequestedTarget,
    NearestThenEntityId,
}

/// Why this actor did not select a basic attack in this combat phase.
/// This does not claim that the actor took no action elsewhere in the tick.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AutonomousNoAttackReason {
    Moved,
    ActionLocked,
    AttackNotReady,
    AttackUnavailable,
    NoEligibleTarget,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutonomousCombatAction {
    Attack { target: EntityId, selection: AutonomousTargetSelection },
    NoAttack { reason: AutonomousNoAttackReason },
}

/// Index in the authorized owner's replay frame for this tick. The index is
/// assigned only if the actual event survives that owner's projection.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AutonomousCommittedEventRef {
    pub tick: u32,
    pub event_index: usize,
}

/// A limited trace of an autonomous actor's basic-attack decision.
/// `candidates` contains only legally eligible targets that this particular
/// branch actually evaluated, in stable entity-ID traversal order. A legal
/// requested target short-circuits the search and is the sole candidate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AutonomousCombatTrace {
    pub tick: u32,
    pub actor: EntityId,
    pub kind: AutonomousActorKind,
    pub candidates: Vec<EntityId>,
    pub action: AutonomousCombatAction,
    pub committed_event: Option<AutonomousCommittedEventRef>,
}

/// Internal record: `combat_event_index` points into the direct combat
/// resolver output, *not* into a public or owner replay frame.
pub(crate) struct CollectedDecision {
    pub owner: Option<CombatantSide>,
    pub trace: AutonomousCombatTrace,
    pub combat_event_index: Option<usize>,
}

enum CollectorScope {
    All,
    Owner { side: CombatantSide, tick: Option<u32>, known: BTreeSet<EntityId> },
}

struct PendingDecision {
    record: CollectedDecision,
    units: usize,
    overflowed: bool,
    suppressed: bool,
}

/// Bounds trace storage before allocation. One actor and each eligible target
/// consume one diagnostic record. Owner records are charged only after the
/// complete candidate set is known to that owner. Once exhausted, gameplay
/// still resolves but the caller must fail rather than return partial traces.
pub(crate) struct ActorDecisionCollector {
    pub records: Vec<CollectedDecision>,
    limit: usize,
    used: usize,
    overflowed: bool,
    observation_missing: bool,
    scope: CollectorScope,
    pending: Option<PendingDecision>,
}

impl ActorDecisionCollector {
    pub fn new(limit: usize) -> Self {
        Self { records: Vec::new(), limit, used: 0, overflowed: false, observation_missing: false, scope: CollectorScope::All, pending: None }
    }

    pub fn new_for_owner(limit: usize, side: CombatantSide) -> Self {
        Self {
            records: Vec::new(), limit, used: 0, overflowed: false, observation_missing: false,
            scope: CollectorScope::Owner { side, tick: None, known: BTreeSet::new() }, pending: None,
        }
    }

    /// Set the IDs in Known collections of the owner's frozen observation.
    /// Unknown collections contribute no IDs. Install this before combat on
    /// every tick; this method does not authorize the caller by itself.
    pub fn set_owner_observation(&mut self, tick: u32, known: BTreeSet<EntityId>) {
        if let CollectorScope::Owner { tick: current, known: current_known, .. } = &mut self.scope {
            *current = Some(tick);
            *current_known = known;
        }
    }

    pub fn used(&self) -> usize { self.used }
    pub fn overflowed(&self) -> bool { self.overflowed }
    pub fn observation_missing(&self) -> bool { self.observation_missing }
    pub fn owner_side(&self) -> Option<CombatantSide> {
        match &self.scope {
            CollectorScope::All => None,
            CollectorScope::Owner { side, .. } => Some(*side),
        }
    }

    pub fn begin(&mut self, tick: u32, actor: &EntityId, kind: AutonomousActorKind, owner: Option<CombatantSide>) -> Option<usize> {
        if self.overflowed || self.observation_missing { return None; }
        if let CollectorScope::Owner { side, tick: observation_tick, known } = &self.scope {
            if owner != Some(*side) || kind == AutonomousActorKind::Monster { return None; }
            if *observation_tick != Some(tick) {
                self.observation_missing = true;
                return None;
            }
            if !known.contains(actor) { return None; }
        }
        // Combat evaluates one actor at a time and finalizes it before the
        // next one. The draft is never published until all candidates pass.
        assert!(self.pending.is_none(), "autonomous decision not finalized");
        let index = self.records.len();
        let has_room = self.used < self.limit;
        self.pending = Some(PendingDecision {
            record: CollectedDecision {
                owner,
                trace: AutonomousCombatTrace {
                    tick,
                    actor: actor.clone(),
                    kind,
                    candidates: Vec::new(),
                    // Set at every exit from the selection branch.
                    action: AutonomousCombatAction::NoAttack { reason: AutonomousNoAttackReason::NoEligibleTarget },
                    committed_event: None,
                },
                combat_event_index: None,
            },
            units: usize::from(has_room),
            overflowed: !has_room,
            suppressed: false,
        });
        Some(index)
    }

    pub fn candidate(&mut self, index: Option<usize>, target: &EntityId) {
        let Some(_) = index else { return };
        let known = match &self.scope {
            CollectorScope::All => true,
            CollectorScope::Owner { known, .. } => known.contains(target),
        };
        let Some(pending) = self.pending.as_mut() else { return };
        if !known {
            // Discard even a provisional overflow. Otherwise the presence of
            // a hidden candidate later in traversal could change the error.
            pending.suppressed = true;
            pending.record.trace.candidates.clear();
        } else if !pending.suppressed && !pending.overflowed {
            if self.used.saturating_add(pending.units) < self.limit {
                pending.units += 1;
                pending.record.trace.candidates.push(target.clone());
            } else {
                pending.overflowed = true;
            }
        }
    }

    pub fn action(&mut self, index: Option<usize>, action: AutonomousCombatAction) -> Option<usize> {
        let index = index?;
        let mut pending = self.pending.take().expect("autonomous decision draft exists");
        if pending.suppressed { return None; }
        if pending.overflowed {
            self.overflowed = true;
            return None;
        }
        pending.record.trace.action = action;
        self.used += pending.units;
        self.records.push(pending.record);
        Some(index)
    }

    pub fn committed(&mut self, index: Option<usize>, combat_event_index: usize) {
        if let Some(index) = index { self.records[index].combat_event_index = Some(combat_event_index); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wait() -> AutonomousCombatAction {
        AutonomousCombatAction::NoAttack { reason: AutonomousNoAttackReason::NoEligibleTarget }
    }

    #[test]
    fn owner_scope_excludes_other_neutral_and_unknown_actors_before_counting() {
        let side = CombatantSide::Attacker;
        let actor = EntityId::from("known");
        let mut collector = ActorDecisionCollector::new_for_owner(1, side);
        collector.set_owner_observation(1, BTreeSet::from([actor.clone()]));
        assert_eq!(collector.begin(1, &actor, AutonomousActorKind::Tower, Some(CombatantSide::Defender)), None);
        assert_eq!(collector.begin(1, &actor, AutonomousActorKind::Monster, None), None);
        assert_eq!(collector.begin(1, &"unknown".into(), AutonomousActorKind::Minion, Some(side)), None);
        assert_eq!(collector.used(), 0);
        assert!(!collector.overflowed());
        let index = collector.begin(1, &actor, AutonomousActorKind::Minion, Some(side));
        assert_eq!(collector.action(index, wait()), Some(0));
        assert_eq!(collector.used(), 1);
        for i in 0..100 {
            let inaccessible = EntityId::from(format!("hidden-{i}"));
            assert_eq!(collector.begin(1, &inaccessible, AutonomousActorKind::Minion, Some(CombatantSide::Defender)), None);
            assert_eq!(collector.begin(1, &inaccessible, AutonomousActorKind::Monster, None), None);
            assert_eq!(collector.begin(1, &inaccessible, AutonomousActorKind::Minion, Some(side)), None);
        }
        assert_eq!(collector.used(), 1);
        assert!(!collector.overflowed());
    }

    #[test]
    fn late_unknown_candidate_discards_provisional_overflow_and_charge() {
        let side = CombatantSide::Attacker;
        let actor = EntityId::from("actor");
        let known_target = EntityId::from("known-target");
        let mut collector = ActorDecisionCollector::new_for_owner(1, side);
        collector.set_owner_observation(1, BTreeSet::from([actor.clone(), known_target.clone()]));
        let index = collector.begin(1, &actor, AutonomousActorKind::Minion, Some(side));
        collector.candidate(index, &known_target); // would exceed the limit
        collector.candidate(index, &"unknown-target".into());
        assert_eq!(collector.action(index, wait()), None);
        assert!(!collector.overflowed());
        assert_eq!(collector.used(), 0);
        assert!(collector.records.is_empty());

        let next = collector.begin(1, &actor, AutonomousActorKind::Minion, Some(side));
        assert_eq!(collector.action(next, wait()), Some(0));
        assert_eq!(collector.used(), 1);
    }

    #[test]
    fn owner_scope_fails_closed_for_missing_observation_and_known_overflow() {
        let side = CombatantSide::Attacker;
        let actor = EntityId::from("actor");
        let target = EntityId::from("target");
        let mut missing = ActorDecisionCollector::new_for_owner(2, side);
        assert_eq!(missing.begin(1, &actor, AutonomousActorKind::Minion, Some(side)), None);
        assert!(missing.observation_missing());
        let mut stale = ActorDecisionCollector::new_for_owner(2, side);
        stale.set_owner_observation(1, BTreeSet::from([actor.clone()]));
        assert_eq!(stale.begin(2, &actor, AutonomousActorKind::Minion, Some(side)), None);
        assert!(stale.observation_missing());

        let mut limited = ActorDecisionCollector::new_for_owner(1, side);
        limited.set_owner_observation(1, BTreeSet::from([actor.clone(), target.clone()]));
        let index = limited.begin(1, &actor, AutonomousActorKind::Minion, Some(side));
        limited.candidate(index, &target);
        assert_eq!(limited.action(index, wait()), None);
        assert!(limited.overflowed());
        assert!(limited.records.is_empty());
    }
}
