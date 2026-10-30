//! Phase-scoped Execution Planner for authoritative Enbu workloads.
//!
//! The verified RulePlan, TacticalExecutionPort, Jinrei and the canonical
//! Replay pipeline remain external global barriers. The Planner may choose
//! faster physical kernels only for a phase whose read/write domain and
//! materialization obligations are already certified by its kernel.
//! Selecting Reference in one domain never forces unrelated domains to
//! Reference, and short workloads do not pay for unused indexes or queues.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CombatPhasePlan {
    pub planned: bool,
    pub arithmetic: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TickWorkPlan {
    pub attack_frontier: bool,
    pub reveal_frontier: bool,
}

const PLANNED_MIN_ENTITIES: usize = 48;
const ARITHMETIC_MIN_ENTITIES: usize = 64;
const TEMPORAL_MIN_ENTITIES: usize = 24;

pub(crate) fn combat_phase(
    entity_count: usize, owner_trace: bool, hybrid: bool,
) -> CombatPhasePlan {
    if !hybrid {
        return CombatPhasePlan {
            planned: cfg!(feature = "lab-opt-planned"),
            arithmetic: cfg!(feature = "lab-opt-arithmetic"),
        };
    }
    if owner_trace {
        // The owner trace must visit *all* actors in canonical order and
        // produce every NoAttack reason; a sparse selection is not proof.
        return CombatPhasePlan { planned: false, arithmetic: false };
    }
    CombatPhasePlan {
        planned: cfg!(feature = "lab-opt-planned") && entity_count >= PLANNED_MIN_ENTITIES,
        arithmetic: cfg!(feature = "lab-opt-arithmetic") && entity_count >= ARITHMETIC_MIN_ENTITIES,
    }
}

/// Runtime portfolio admission. The optimizer can use an exact temporal
/// certificate for isolated S measurements even on small worlds; when H+S
/// are combined, avoid building and rechecking an O(N) frontier unless the
/// minimum workload can amortize its read-set cost. Each domain is
/// independent; for example owner diagnostics prevent attack scheduling but
/// do not prevent reveal expiration scheduling.
pub(crate) fn tick_work(
    entity_count: usize, owner_trace: bool, hybrid: bool, scheduler: bool,
) -> TickWorkPlan {
    let workload = !hybrid || entity_count >= TEMPORAL_MIN_ENTITIES;
    TickWorkPlan {
        attack_frontier: scheduler && workload && !owner_trace,
        reveal_frontier: scheduler && workload,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn owner_trace_only_disables_combat_not_unrelated_reveal_domain() {
        let plan = tick_work(200, true, true, true);
        assert!(!plan.attack_frontier);
        assert!(plan.reveal_frontier);
        assert_eq!(combat_phase(200, true, true),
            CombatPhasePlan { planned: false, arithmetic: false });
    }
    #[test]
    fn independent_cost_gates_never_fallback_entire_hybrid() {
        let short = tick_work(4, false, true, true);
        assert_eq!(short, TickWorkPlan { attack_frontier: false, reveal_frontier: false });
        let large = tick_work(100, false, true, true);
        assert_eq!(large, TickWorkPlan { attack_frontier: true, reveal_frontier: true });
        assert_eq!(combat_phase(4, false, true),
            CombatPhasePlan { planned: false, arithmetic: false });
        let medium = combat_phase(52, false, true);
        assert_eq!(medium.planned, cfg!(feature = "lab-opt-planned"));
        assert!(!medium.arithmetic);
    }
}