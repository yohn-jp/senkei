//! Bounded, generation-checked physical work scheduling.
//!
//! This module never owns canonical Tick time, Jinrei, Fog or Replay. Every
//! canonical Tick is still materialized by simulate_inner. A certificate
//! permits skipping only the *named* calculation domain, and is revalidated
//! from the current frozen input before consumption. Unknown writes fall back
//! to the authoritative Reference phase rather than replaying stale work.

use crate::next_support as support;
use senkei_model::{EntityId, WorldState};
use std::collections::{BTreeMap, BTreeSet};

/// Dependencies may be more conservative than the rule needs, never narrower.
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) enum Dependency {
    EntityField(EntityId, &'static str),
    EntitySet,
    WorldRules,
    GlobalOutput,
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) struct WorkKey {
    pub tick: u32,
    pub phase: u16,
    pub rule_priority: i32,
    pub entity_id: String,
    pub event_id: String,
    pub domain: String,
    pub generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ScheduleError {
    NonSequentialTick,
    PastEvent,
    GenerationOverflow,
    CapacityExceeded,
}

#[derive(Default)]
pub(crate) struct EventScheduler {
    current_tick: u32,
    due: BTreeSet<WorkKey>,
    generations: BTreeMap<String, u64>,
    reverse: BTreeMap<Dependency, BTreeSet<String>>,
    domains: BTreeMap<String, BTreeSet<Dependency>>,
}

impl EventScheduler {
    const MAX_PENDING: usize = 4096;
    const STALE_COMPACTION_THRESHOLD: usize = 512;

    fn compact_stale(&mut self) {
        self.due.retain(|entry| {
            self.generations.get(&entry.domain).copied().unwrap_or(0) == entry.generation
        });
    }

    /// Output frames are due on every Tick. Advancing over a Tick is rejected
    /// because this scheduler has no authority to reconstitute a missing frame.
    pub fn take_tick(&mut self, tick: u32) -> Result<Vec<WorkKey>, ScheduleError> {
        if self.current_tick.checked_add(1) != Some(tick) {
            return Err(ScheduleError::NonSequentialTick);
        }
        self.current_tick = tick;
        let mut ready = Vec::new();
        while let Some(first) = self.due.first().cloned() {
            if first.tick > tick {
                break;
            }
            self.due.take(&first);
            if first.tick < tick {
                return Err(ScheduleError::PastEvent);
            }
            if self.generations.get(&first.domain).copied().unwrap_or(0) == first.generation {
                ready.push(first);
            }
        }
        Ok(ready)
    }

    pub fn subscribe(&mut self, domain: &str, dependencies: BTreeSet<Dependency>) {
        let name = domain.to_owned();
        if let Some(prior) = self.domains.insert(name.clone(), dependencies.clone()) {
            for dependency in prior {
                if let Some(consumers) = self.reverse.get_mut(&dependency) {
                    consumers.remove(&name);
                }
            }
        }
        self.reverse.retain(|_, consumers| !consumers.is_empty());
        for dependency in dependencies {
            self.reverse.entry(dependency).or_default().insert(name.clone());
        }
    }

    pub fn schedule(
        &mut self, domain: &str, tick: u32, phase: u16, priority: i32,
        entity_id: &str, event_id: &str,
    ) -> Result<(), ScheduleError> {
        if tick <= self.current_tick {
            return Err(ScheduleError::PastEvent);
        }
        if self.due.len() >= Self::MAX_PENDING {
            self.compact_stale();
            if self.due.len() >= Self::MAX_PENDING {
                return Err(ScheduleError::CapacityExceeded);
            }
        }
        let generation = self.generations.get(domain).copied().unwrap_or(0);
        self.due.insert(WorkKey {
            tick, phase, rule_priority: priority,
            entity_id: entity_id.to_owned(), event_id: event_id.to_owned(),
            domain: domain.to_owned(), generation,
        });
        Ok(())
    }

    /// Stale entries are inert at pop. Repeated invalidation cannot wrap a
    /// generation into an apparently current reservation.
    pub fn invalidate(&mut self, writes: &BTreeSet<Dependency>) -> Result<usize, ScheduleError> {
        let mut dirty = BTreeSet::new();
        for dependency in writes {
            dirty.extend(self.reverse.get(dependency).into_iter().flatten().cloned());
        }
        // Check all counters before mutation, so overflow cannot partially
        // invalidate one domain and leave another generation live.
        if dirty.iter().any(|domain| self.generations.get(domain) == Some(&u64::MAX)) {
            return Err(ScheduleError::GenerationOverflow);
        }
        for domain in &dirty {
            *self.generations.entry(domain.clone()).or_default() += 1;
        }
        if self.due.len() >= Self::STALE_COMPACTION_THRESHOLD {
            self.compact_stale();
        }
        Ok(dirty.len())
    }

    pub fn invalidate_all(&mut self) -> Result<(), ScheduleError> {
        if self.generations.values().any(|generation| *generation == u64::MAX) {
            return Err(ScheduleError::GenerationOverflow);
        }
        for generation in self.generations.values_mut() {
            *generation += 1;
        }
        if self.due.len() >= Self::STALE_COMPACTION_THRESHOLD {
            self.compact_stale();
        }
        // Also invalidate subscribed domains which have not yet scheduled.
        for domain in self.domains.keys() {
            self.generations.entry(domain.clone()).or_insert(1);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AttackKey {
    id: EntityId,
    hp: i64,
    ready: i64,
    attack: i64,
    range: i64,
}

/// A certificate for the *basic attack collection phase only*, not a whole
/// Enbu Tick. A long no-attack interval can be planned once and subsequently
/// verified using a narrow, exact read-set rather than re-running target
/// selection, cohort locks, source tracing and per-attacker range/vision work.
///
/// Changes in the actor set, HP, readiness, attack or range invalidate the
/// certificate immediately. Target position/visibility do NOT need to be
/// pinned here: a target cannot enable a hit before a living combatant is
/// attack-ready. Once any attacker can attack, Reference is always invoked.
#[derive(Default)]
pub(crate) struct BasicAttackFrontier {
    read_set: Vec<AttackKey>,
    earliest_possible: i64,
    initialized: bool,
    last_tick: Option<u32>,
    scheduled: EventScheduler,
    active: Vec<EntityId>,
    pub(crate) hits: u64,
    pub(crate) misses: u64,
}

fn combatant(kind: &str) -> bool {
    matches!(kind, "hero" | "minion" | "monster" | "tower" | "base")
}

impl BasicAttackFrontier {
    pub(crate) fn decline_tick(&mut self, tick: u32) {
        // The work is intentionally executed by Reference this Tick. Even a
        // declined window must not make the scheduler's logical clock jump.
        let _ = self.scheduled.take_tick(tick);
        self.initialized = false;
        self.last_tick = Some(tick);
        self.read_set.clear();
        self.active.clear();
    }

    /// An exact, ordered active set derived from the same current-Tick source
    /// fingerprint that certified the clock frontier. The canonical attack
    /// predicate is still evaluated for every returned actor and candidate.
    /// On dense workloads or owner trace requests we provide no active set:
    /// the Reference iterator is used with no partial trace omissions.
    pub(crate) fn active_ids(&self, tick: u32) -> Option<&[EntityId]> {
        (self.initialized && self.last_tick == Some(tick) && !self.active.is_empty())
            .then_some(self.active.as_slice())
    }

    fn keys(world: &WorldState) -> impl Iterator<Item = AttackKey> + '_ {
        world.entities.iter().filter(|(_, actor)| combatant(actor.entity_type.as_str()))
            .map(|(id, actor)| AttackKey {
                id: id.clone(),
                hp: support::int(actor, "hp"),
                ready: support::int(actor, "attack_ready"),
                attack: support::int(actor, "attack"),
                range: support::int(actor, "range"),
            })
    }

    fn still_valid(&self, world: &WorldState) -> bool {
        let mut keys = Self::keys(world);
        self.read_set.iter().all(|prior| keys.next().is_some_and(|now| &now == prior))
            && keys.next().is_none()
    }

    /// Returns true only when the absence of all basic attacks has been
    /// proven for the current frozen snapshot and tick. Even on a cache hit,
    /// the complete relevant read set is compared (never a hash collision).
    /// Owner actor traces always call the canonical collector to preserve all
    /// NoAttack reason precedence and event-index accounting.
    pub fn certify_idle(&mut self, world: &WorldState, tick: u32, owner_trace: bool) -> bool {
        // Even when the combat domain is idle, the external Tick cannot be
        // skipped. The scheduler advances once, and a due clock obliges
        // canonical target/visibility evaluation at that very Tick.
        let due = match self.scheduled.take_tick(tick) {
            Ok(events) => events,
            Err(_) => {
                // Calls out of canonical order are not certification. In
                // particular, never restore an older window after an error.
                self.initialized = false;
                return false;
            }
        };
        if owner_trace {
            self.initialized = false;
            self.active.clear();
            self.last_tick = Some(tick);
            return false;
        }
        if self.initialized
            && self.last_tick.and_then(|at| at.checked_add(1)) == Some(tick)
            && due.is_empty()
            && i64::from(tick) < self.earliest_possible
            && self.still_valid(world)
        {
            self.hits += 1;
            self.last_tick = Some(tick);
            return true;
        }
        self.misses += 1;
        // Replacing a certificate revokes all previously scheduled attacks
        // before any new event is registered, including death/spawn changes.
        if self.initialized {
            if self.scheduled.invalidate(&BTreeSet::from([Dependency::EntitySet])).is_err() {
                self.initialized = false;
                return false;
            }
        }
        self.scheduled.subscribe("basic_attack", BTreeSet::from([Dependency::EntitySet]));
        self.active.clear();
        self.read_set = Self::keys(world).collect();
        self.earliest_possible = self.read_set.iter()
            .filter(|source| source.hp > 0 && source.attack > 0 && source.range >= 0)
            .map(|source| source.ready)
            .min().unwrap_or(i64::MAX);
        self.initialized = true;
        self.last_tick = Some(tick);
        if i64::from(tick) < self.earliest_possible {
            if let Ok(when) = u32::try_from(self.earliest_possible) {
                if self.scheduled.schedule(
                    "basic_attack", when, 7, 0, "", "ready_clock",
                ).is_err() {
                    self.initialized = false;
                    return false;
                }
            }
            return true;
        }
        // Active Set never changes semantics: a non-ready actor cannot emit
        // any basic-attack effect, and owner trace is already excluded.
        // The read-set has just been certified from the same frozen World.
        // The sparse cutoff avoids allocating a list for dense phases.
        let ready = self.read_set.iter()
            .filter(|source| source.hp > 0 && source.attack > 0
                && source.range >= 0 && source.ready <= i64::from(tick))
            .collect::<Vec<_>>();
        if self.read_set.len() >= 32 && ready.len() <= 8
            && ready.len().saturating_mul(4) <= self.read_set.len()
        {
            self.active.extend(ready.into_iter().map(|source| source.id.clone()));
        }
        false
    }
}

/// A second independent causal domain: reveal expiration. It does not
/// certify that vision/Fog or owner observations may be skipped; it only
/// certifies that the mutating expiration scan has no due field before the
/// earliest positive deadline. All three authority-defined reveal timers
/// are compared exactly on every current-Tick pre-lifecycle World.
#[derive(Clone, Debug, Eq, PartialEq)]
struct RevealKey {
    id: EntityId,
    attacker_until: i64,
    defender_until: i64,
    general_until: i64,
}

#[derive(Default)]
pub(crate) struct RevealExpiryFrontier {
    previous: Vec<RevealKey>,
    earliest_possible: i64,
    initialized: bool,
    last_tick: Option<u32>,
    scheduled: EventScheduler,
    pub(crate) hits: u64,
}

impl RevealExpiryFrontier {
    pub(crate) fn decline_tick(&mut self, tick: u32) {
        let _ = self.scheduled.take_tick(tick);
        self.initialized = false;
        self.last_tick = Some(tick);
        self.previous.clear();
    }

    fn keys(world: &WorldState) -> impl Iterator<Item = RevealKey> + '_ {
        world.entities.iter().map(|(id, actor)| RevealKey {
            id: id.clone(),
            attacker_until: support::int(actor, "reveal_attacker_until"),
            defender_until: support::int(actor, "reveal_defender_until"),
            general_until: support::int(actor, "reveal_until"),
        })
    }

    fn valid(&self, world: &WorldState) -> bool {
        let mut keys = Self::keys(world);
        self.previous.iter().all(|prior| keys.next().is_some_and(|now| &now == prior))
            && keys.next().is_none()
    }

    pub fn certify_no_expiration(&mut self, world: &WorldState, tick: u32) -> bool {
        let due = match self.scheduled.take_tick(tick) {
            Ok(due) => due,
            Err(_) => { self.initialized = false; return false; }
        };
        if self.initialized
            && self.last_tick.and_then(|t| t.checked_add(1)) == Some(tick)
            && due.is_empty()
            && i64::from(tick) < self.earliest_possible
            && self.valid(world)
        {
            self.hits += 1;
            self.last_tick = Some(tick);
            return true;
        }
        if self.initialized && self.scheduled.invalidate(&BTreeSet::from([Dependency::EntitySet])).is_err() {
            self.initialized = false;
            return false;
        }
        self.scheduled.subscribe("reveal", BTreeSet::from([Dependency::EntitySet]));
        self.previous = Self::keys(world).collect();
        self.earliest_possible = self.previous.iter()
            .flat_map(|key| [key.attacker_until, key.defender_until, key.general_until])
            .filter(|deadline| *deadline > 0)
            .min().unwrap_or(i64::MAX);
        self.last_tick = Some(tick);
        self.initialized = true;
        if i64::from(tick) < self.earliest_possible {
            if let Ok(due_tick) = u32::try_from(self.earliest_possible) {
                if self.scheduled.schedule("reveal", due_tick, 1, 0, "", "expiration").is_err() {
                    self.initialized = false;
                    return false;
                }
            }
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{CombatantSide, DomainValue, EntityState, FieldId};

    fn actor(ready: i64) -> EntityState {
        EntityState {
            entity_type: "hero".into(), owner: Some(CombatantSide::Attacker),
            fields: [
                (FieldId::from("hp"), DomainValue::Integer(100)),
                (FieldId::from("attack_ready"), DomainValue::Integer(ready)),
                (FieldId::from("attack"), DomainValue::Integer(12)),
                (FieldId::from("range"), DomainValue::Integer(55)),
            ].into_iter().collect(),
        }
    }

    #[test]
    fn scheduler_preserves_order_and_stale_generations() {
        let mut q = EventScheduler::default();
        let dep = Dependency::EntitySet;
        q.subscribe("attack", BTreeSet::from([dep.clone()]));
        q.schedule("attack", 3, 7, 0, "z", "first").unwrap();
        q.schedule("attack", 3, 7, 0, "a", "second").unwrap();
        q.schedule("attack", 4, 7, 0, "a", "stale").unwrap();
        assert!(q.take_tick(1).unwrap().is_empty());
        assert!(q.take_tick(2).unwrap().is_empty());
        let due = q.take_tick(3).unwrap();
        assert_eq!(due.iter().map(|x| x.entity_id.as_str()).collect::<Vec<_>>(), vec!["a", "z"]);
        q.invalidate(&BTreeSet::from([dep])).unwrap();
        assert!(q.take_tick(4).unwrap().is_empty());
        assert_eq!(q.take_tick(6), Err(ScheduleError::NonSequentialTick));
        assert_eq!(q.schedule("attack", 4, 7, 0, "", ""), Err(ScheduleError::PastEvent));
    }

    #[test]
    fn dependency_changes_are_local_and_unknown_global_invalidates_all() {
        let mut q = EventScheduler::default();
        q.subscribe("combat", BTreeSet::from([Dependency::EntitySet]));
        q.subscribe("movement", BTreeSet::from([Dependency::WorldRules]));
        q.schedule("combat", 2, 3, 0, "a", "attack").unwrap();
        q.schedule("movement", 2, 2, 0, "b", "move").unwrap();
        assert_eq!(q.invalidate(&BTreeSet::from([Dependency::EntitySet])).unwrap(), 1);
        q.take_tick(1).unwrap();
        assert_eq!(q.take_tick(2).unwrap().iter().map(|key| key.domain.as_str()).collect::<Vec<_>>(), vec!["movement"]);
        q.schedule("movement", 3, 2, 0, "b", "move").unwrap();
        q.invalidate_all().unwrap();
        assert!(q.take_tick(3).unwrap().is_empty());
    }

    #[test]
    fn repeated_invalidations_do_not_accumulate_unbounded_stale_events() {
        let mut q = EventScheduler::default();
        q.subscribe("domain", BTreeSet::from([Dependency::WorldRules]));
        for index in 0..5_000 {
            q.schedule("domain", 10_000 + index, 2, 0, "actor", "future").unwrap();
            q.invalidate(&BTreeSet::from([Dependency::WorldRules])).unwrap();
        }
        assert!(q.due.len() <= EventScheduler::MAX_PENDING);
        for tick in 1..=16 {
            assert!(q.take_tick(tick).unwrap().is_empty());
        }
        // Any overflow is a rejected certificate, never a stale execution.
        q.generations.insert("domain".into(), u64::MAX);
        assert_eq!(q.invalidate(&BTreeSet::from([Dependency::WorldRules])),
            Err(ScheduleError::GenerationOverflow));
    }

    #[test]
    fn attack_frontier_respects_future_clock_and_all_invalidation_barriers() {
        let mut state = WorldState::default();
        state.entities.insert("hero".into(), actor(12));
        let mut f = BasicAttackFrontier::default();
        for tick in 1..12 {
            assert!(f.certify_idle(&state, tick, false));
        }
        assert_eq!(f.hits, 10);
        assert!(!f.certify_idle(&state, 12, false));
        assert!(!f.certify_idle(&state, 13, false));
        support::set_int(state.entities.get_mut(&EntityId::from("hero")).unwrap(), "attack_ready", 20);
        assert!(f.certify_idle(&state, 14, false));
        assert!(!f.certify_idle(&state, 15, true), "owner trace cannot be skipped");
        support::set_int(state.entities.get_mut(&EntityId::from("hero")).unwrap(), "attack_ready", 15);
        assert!(!f.certify_idle(&state, 15, false), "same-Tick cooldown reset invalidates");
        support::set_int(state.entities.get_mut(&EntityId::from("hero")).unwrap(), "hp", 0);
        assert!(f.certify_idle(&state, 16, false), "dead actor cannot attack");
        state.entities.insert("new".into(), actor(16));
        assert!(!f.certify_idle(&state, 16, false), "new ready actor invalidates");
    }

    #[test]
    fn active_set_is_exact_and_sorted_at_frontier_and_updates_on_clock_change() {
        let mut world = WorldState::default();
        for n in 0..64 {
            world.entities.insert(format!("hero-{n:02}").into(),
                actor(if n % 31 == 0 { 4 } else { 20 }));
        }
        let mut frontier = BasicAttackFrontier::default();
        for tick in 1..4 {
            assert!(frontier.certify_idle(&world, tick, false));
        }
        assert!(!frontier.certify_idle(&world, 4, false));
        assert_eq!(
            frontier.active_ids(4).unwrap().iter().map(EntityId::as_str).collect::<Vec<_>>(),
            vec!["hero-00", "hero-31", "hero-62"],
        );
        support::set_int(world.entities.get_mut(&EntityId::from("hero-01")).unwrap(), "attack_ready", 5);
        assert!(!frontier.certify_idle(&world, 5, false));
        assert_eq!(
            frontier.active_ids(5).unwrap().iter().map(EntityId::as_str).collect::<Vec<_>>(),
            vec!["hero-00", "hero-01", "hero-31", "hero-62"],
        );
        assert!(!frontier.certify_idle(&world, 6, true));
        assert_eq!(frontier.active_ids(6), None);
    }

    #[test]
    fn reveal_frontier_invalidates_on_reapplication_earlier_deadline_and_new_actor() {
        let mut world = WorldState::default();
        let mut first = actor(12);
        support::set_int(&mut first, "reveal_attacker_until", 9);
        world.entities.insert("a".into(), first);
        let mut q = RevealExpiryFrontier::default();
        for tick in 1..9 {
            assert!(q.certify_no_expiration(&world, tick));
        }
        assert_eq!(q.hits, 7);
        assert!(!q.certify_no_expiration(&world, 9));
        // The canonical phase cleared the expired field.
        support::set_int(world.entities.get_mut(&EntityId::from("a")).unwrap(), "reveal_attacker_until", 0);
        assert!(q.certify_no_expiration(&world, 10));
        // Re-application creates a new earlier deadline: do not use the old empty schedule.
        support::set_int(world.entities.get_mut(&EntityId::from("a")).unwrap(), "reveal_defender_until", 11);
        assert!(!q.certify_no_expiration(&world, 11));
        let mut newcomer = actor(100);
        support::set_int(&mut newcomer, "reveal_until", 12);
        world.entities.insert("b".into(), newcomer);
        assert!(!q.certify_no_expiration(&world, 12));
    }

    #[test]
    fn world_cannot_skip_obligatory_canonical_ticks() {
        let mut q = EventScheduler::default();
        assert_eq!(q.take_tick(2), Err(ScheduleError::NonSequentialTick));
        assert!(q.take_tick(1).is_ok());
        assert_eq!(q.take_tick(1), Err(ScheduleError::NonSequentialTick));
        assert!(q.take_tick(2).is_ok());
    }
}
