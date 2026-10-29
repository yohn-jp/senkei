//! Cost-bounded combat-phase dispatcher, without changing canonical rules.
//!
//! A global Tick skip would omit Jinrei evaluation, owner observations and
//! replay. Instead, the first production path specializes *basic-attack work*
//! inside an otherwise fully materialized Tick. Unknown obligations fall back
//! to Reference. The checked Arithmetic solver is separate: its long-horizon
//! kernel is not dispatched until a causal certificate exists.
//!
//! All candidates are borrowed from the frozen same-phase snapshot; no
//! cross-Tick cache survives movement, spawn, death, skill or vision changes.

use crate::next_support as support;
use senkei_model::{EntityId, EntityState, WorldState};
use std::collections::btree_map;

const MAX_SPARSE_ACTORS: usize = 8;
const MIN_SPARSE_RATIO: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FallbackReason {
    OwnerDecisionTrace,
    DenseReadyActors,
    ShortOrDenseWorkload,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Strategy {
    Reference(FallbackReason),
    ArithmeticIdle,
    SparseReady,
}

/// Selection never changes world, attack clocks or any public output.
/// `ArithmeticIdle` certifies that zero basic attacks can be collected in
/// this one combat phase, not that the whole Tick can be skipped.
pub(crate) enum BasicAttackPlan<'a> {
    Reference(FallbackReason),
    ArithmeticIdle,
    SparseReady(Vec<(&'a EntityId, &'a EntityState)>),
}

impl BasicAttackPlan<'_> {
    #[cfg(test)]
    pub(crate) fn strategy(&self) -> Strategy {
        match self {
            Self::Reference(reason) => Strategy::Reference(*reason),
            Self::ArithmeticIdle => Strategy::ArithmeticIdle,
            Self::SparseReady(_) => Strategy::SparseReady,
        }
    }
}

fn combatant(entity: &EntityState) -> bool {
    matches!(entity.entity_type.as_str(), "hero" | "minion" | "monster" | "tower" | "base")
}

/// Cheap, fail-closed stage before building any queue, target groups or
/// speculative damage schedule. When traces are requested, every actor must
/// still be visited to preserve even the NoAttack reason precedence.
pub(crate) fn plan_basic_attacks(
    snapshot: &WorldState,
    tick: u32,
    owner_decision_trace: bool,
) -> BasicAttackPlan<'_> {
    if owner_decision_trace {
        return BasicAttackPlan::Reference(FallbackReason::OwnerDecisionTrace);
    }
    let mut ready = Vec::new();
    let mut live_combatants = 0_usize;
    for (id, actor) in &snapshot.entities {
        if !support::alive(actor) || !combatant(actor) {
            continue;
        }
        live_combatants += 1;
        // This is only an earliest-possible-attack guard. A blocked attack
        // can be delayed arbitrarily, so never interpret attack_ready as a
        // guaranteed periodic event (Arithmetic's full-window certificate).
        if support::int(actor, "attack_ready") > i64::from(tick)
            || support::int(actor, "attack") <= 0
            || support::int(actor, "range") < 0
        {
            continue;
        }
        ready.push((id, actor));
        if ready.len() > MAX_SPARSE_ACTORS {
            return BasicAttackPlan::Reference(FallbackReason::DenseReadyActors);
        }
    }
    if ready.is_empty() {
        return BasicAttackPlan::ArithmeticIdle;
    }
    // Selecting actors costs O(A) classification plus O(R) execution, versus
    // Reference's O(A) execution. Do not pay the classification cost unless
    // the source set is demonstrably sparse. No guessed wall-time speedup.
    if live_combatants >= ready.len().saturating_mul(MIN_SPARSE_RATIO) {
        BasicAttackPlan::SparseReady(ready)
    } else {
        BasicAttackPlan::Reference(FallbackReason::ShortOrDenseWorkload)
    }
}

/// A monomorphized stable-order iterator. No per-Tick boxed iterator.
pub(crate) enum BasicAttackSources<'a> {
    All(btree_map::Iter<'a, EntityId, EntityState>),
    Sparse(std::vec::IntoIter<(&'a EntityId, &'a EntityState)>),
}

impl<'a> Iterator for BasicAttackSources<'a> {
    type Item = (&'a EntityId, &'a EntityState);

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::All(items) => items.next(),
            Self::Sparse(items) => items.next(),
        }
    }
}

impl<'a> BasicAttackPlan<'a> {
    pub(crate) fn sources(self, snapshot: &'a WorldState) -> BasicAttackSources<'a> {
        match self {
            Self::Reference(_) => BasicAttackSources::All(snapshot.entities.iter()),
            Self::SparseReady(items) => BasicAttackSources::Sparse(items.into_iter()),
            Self::ArithmeticIdle => BasicAttackSources::Sparse(Vec::new().into_iter()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{CombatantSide, DomainValue, EntityState, FieldId};

    fn actor(kind: &str, hp: i64, ready: i64, attack: i64) -> EntityState {
        EntityState {
            entity_type: kind.into(),
            owner: Some(CombatantSide::Attacker),
            fields: [
                (FieldId::from("hp"), DomainValue::Integer(hp)),
                (FieldId::from("attack_ready"), DomainValue::Integer(ready)),
                (FieldId::from("attack"), DomainValue::Integer(attack)),
                (FieldId::from("range"), DomainValue::Integer(100)),
            ].into_iter().collect(),
        }
    }

    #[test]
    fn dispatches_idle_and_preserves_trace_fallback() {
        let mut world = WorldState::default();
        for n in 0..32 {
            world.entities.insert(format!("hero-{n:02}").into(), actor("hero", 100, 12, 10));
        }
        assert_eq!(plan_basic_attacks(&world, 4, false).strategy(), Strategy::ArithmeticIdle);
        assert_eq!(plan_basic_attacks(&world, 4, true).strategy(),
            Strategy::Reference(FallbackReason::OwnerDecisionTrace));
        assert_eq!(plan_basic_attacks(&world, 12, false).strategy(),
            Strategy::Reference(FallbackReason::DenseReadyActors));
    }

    #[test]
    fn dispatches_sparse_in_stable_order_and_invalidates_every_phase() {
        let mut world = WorldState::default();
        for n in 0..32 {
            world.entities.insert(format!("hero-{n:02}").into(),
                actor("hero", 100, if n % 13 == 0 { 2 } else { 20 }, 10));
        }
        assert_eq!(plan_basic_attacks(&world, 3, false).strategy(), Strategy::SparseReady);
        let due = plan_basic_attacks(&world, 3, false).sources(&world)
            .map(|(id, _)| id.as_str().to_owned()).collect::<Vec<_>>();
        assert_eq!(due, vec!["hero-00", "hero-13", "hero-26"]);
        world.entities.get_mut(&"hero-01".into()).unwrap()
            .fields.insert(FieldId::from("attack_ready"), DomainValue::Integer(1));
        let updated = plan_basic_attacks(&world, 3, false).sources(&world)
            .map(|(id, _)| id.as_str().to_owned()).collect::<Vec<_>>();
        assert_eq!(updated, vec!["hero-00", "hero-01", "hero-13", "hero-26"]);
    }

    #[test]
    fn no_target_cannot_be_inferred_from_empty_attack_power() {
        let mut world = WorldState::default();
        world.entities.insert("a".into(), actor("hero", 100, 0, 0));
        world.entities.insert("b".into(), actor("monster", 0, 0, 100));
        world.entities.insert("c".into(), actor("observation", 100, 0, 100));
        assert_eq!(plan_basic_attacks(&world, 3, false).strategy(), Strategy::ArithmeticIdle);
        // Attack power or readiness can be altered by the next canonical
        // Tick; rebuilding the plan sees the change immediately.
        world.entities.get_mut(&"a".into()).unwrap()
            .fields.insert(FieldId::from("attack"), DomainValue::Integer(1));
        assert_eq!(plan_basic_attacks(&world, 3, false).strategy(),
            Strategy::Reference(FallbackReason::ShortOrDenseWorkload));
    }
}
