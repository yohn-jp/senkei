//! Restricted records from the existing autonomous basic-attack selection.
//!
//! These are combat-phase records, not a complete account of movement or of
//! the actor's behavior profile. The collector records only candidates which
//! the real selection evaluated as eligible; it does not infer candidates from
//! the resulting world. Neutral actors have no player owner.

use senkei_model::{CombatantSide, EntityId};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
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
pub enum AutonomousTargetSelection {
    RequestedTarget,
    NearestThenEntityId,
}

/// Why this actor did not select a basic attack in this combat phase.
/// This does not claim that the actor took no action elsewhere in the tick.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum AutonomousNoAttackReason {
    Moved,
    ActionLocked,
    AttackNotReady,
    AttackUnavailable,
    NoEligibleTarget,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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

/// Bounds trace storage before allocation. One actor and each eligible target
/// consume one diagnostic record. Once exhausted, gameplay still resolves but
/// the caller must fail the diagnostic run rather than return partial traces.
pub(crate) struct ActorDecisionCollector {
    pub records: Vec<CollectedDecision>,
    limit: usize,
    used: usize,
    overflowed: bool,
}

impl ActorDecisionCollector {
    pub fn new(limit: usize) -> Self {
        Self { records: Vec::new(), limit, used: 0, overflowed: false }
    }

    pub fn used(&self) -> usize { self.used }
    pub fn overflowed(&self) -> bool { self.overflowed }

    fn reserve(&mut self) -> bool {
        if self.overflowed || self.used >= self.limit {
            self.overflowed = true;
            return false;
        }
        self.used += 1;
        true
    }

    pub fn begin(&mut self, tick: u32, actor: &EntityId, kind: AutonomousActorKind, owner: Option<CombatantSide>) -> Option<usize> {
        if !self.reserve() { return None; }
        let index = self.records.len();
        self.records.push(CollectedDecision {
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
        });
        Some(index)
    }

    pub fn candidate(&mut self, index: Option<usize>, target: &EntityId) {
        let Some(index) = index else { return };
        if self.reserve() { self.records[index].trace.candidates.push(target.clone()); }
    }

    pub fn action(&mut self, index: Option<usize>, action: AutonomousCombatAction) {
        if let Some(index) = index { self.records[index].trace.action = action; }
    }

    pub fn committed(&mut self, index: Option<usize>, combat_event_index: usize) {
        if let Some(index) = index { self.records[index].combat_event_index = Some(combat_event_index); }
    }
}
