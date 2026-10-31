//! Exact integer arithmetic for independent, immutable, periodic attack cohorts.
//!
//! This is a **solver**, not an authorization to skip Enbu Ticks. A future
//! Execution Planner must prove fixed targets, visibility, damage, independent
//! state and complete per-Tick output obligations before dispatching here.
//! In particular, Jinrei CU, Fog and Replay are NOT reconstructed here.

/// One actor's certified immutable attack clock and effective damage.
/// `first_tick` is inclusive; `interval` must be strictly positive.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct AttackClock {
    pub first_tick: u32,
    pub interval: u32,
    pub damage: u64,
}

/// Saturating count is deliberately NOT used: overflow must reject the
/// certificate, rather than silently alter the first lethal Tick.
pub(crate) fn hit_count(clock: AttackClock, at: u32) -> Option<u64> {
    if clock.interval == 0 { return None; }
    if at < clock.first_tick { return Some(0); }
    Some(u64::from((at - clock.first_tick) / clock.interval) + 1)
}

/// Number of attacks through `at`, and sum of their absolute Tick values.
/// Both are needed to reconstruct the synthetic oracle's ordered statistics;
/// neither alone reconstructs full Enbu Replay.
pub(crate) fn hit_stats(clock: AttackClock, at: u32) -> Option<(u64, u128)> {
    let count = hit_count(clock, at)?;
    if count == 0 { return Some((0, 0)); }
    let n = u128::from(count);
    let first = u128::from(clock.first_tick);
    let delta = u128::from(clock.interval);
    let sum = n.checked_mul(first)?
        .checked_add(delta.checked_mul(n.checked_mul(n - 1)?)? / 2)?;
    Some((count, sum))
}

/// Total positive monotone damage through an inclusive Tick, checked in u128.
/// `None` is a rejected plan (invalid interval or arithmetic overflow).
pub(crate) fn cumulative_damage(clocks: &[AttackClock], at: u32) -> Option<u128> {
    clocks.iter().try_fold(0_u128, |total, &clock| {
        let count = u128::from(hit_count(clock, at)?);
        total.checked_add(count.checked_mul(u128::from(clock.damage))?)
    })
}

/// First inclusive Tick whose cumulative damage **within [start,end]**
/// meets the target's HP at `start - 1`. Prior attacks are explicitly
/// subtracted; using an absolute prefix would falsely kill a target at the
/// beginning of any nonzero window. All simultaneous attackers at the lethal
/// Tick remain eligible for the same-Tick batch. Zero HP has no future lethal
/// event. The caller must separately certify unchanging damage and target.
pub(crate) fn first_lethal_tick(
    clocks: &[AttackClock], start: u32, end: u32, threshold: u128,
) -> Option<Option<u32>> {
    if start > end { return None; }
    // Validate clocks even if threshold is zero or no attacks are scheduled.
    if clocks.iter().any(|clock| clock.interval == 0) { return None; }
    if threshold == 0 { return Some(None); }
    let prefix = if start == 0 { 0 } else { cumulative_damage(clocks, start - 1)? };
    if cumulative_damage(clocks, end)?.checked_sub(prefix)? < threshold { return Some(None); }
    let mut low = start;
    let mut high = end;
    while low < high {
        let middle = low + (high - low) / 2;
        if cumulative_damage(clocks, middle)?.checked_sub(prefix)? >= threshold {
            high = middle;
        } else {
            low = middle + 1;
        }
    }
    Some(Some(low))
}

/// Due actors at a boundary are kept in original actor order. All of them
/// participate in the same-Tick batch even if one is already lethal.
pub(crate) fn due_actor_indices(clocks: &[AttackClock], at: u32) -> Option<Vec<usize>> {
    let mut due = Vec::new();
    for (index, clock) in clocks.iter().enumerate() {
        if clock.interval == 0 { return None; }
        if at >= clock.first_tick && (at - clock.first_tick) % clock.interval == 0 {
            due.push(index);
        }
    }
    Some(due)
}

/// Complete physical schedule for a mathematically certified fixed domain.
/// The engine must still use its canonical resolvers to turn each due batch
/// into effects; this structure does not invent damage, CU or replay events.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DueBatch {
    pub tick: u32,
    pub actor_indices: Vec<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ArithmeticWindow {
    pub first_lethal_tick: Option<u32>,
    pub last_tick: u32,
    pub hit_counts: Vec<u64>,
    pub hit_tick_sums: Vec<u128>,
    pub total_hits: u128,
    /// None is valid only for aggregate-only internal use, never for a
    /// production call that owes per-Tick observable attack events.
    pub batches: Option<Vec<DueBatch>>,
}

/// Compute a *complete* closed-domain answer, optionally materializing the
/// exact ordered event obligations. The caller supplies HP as of start-1.
/// A stage exceeding `max_materialized_hits` is rejected before allocation;
/// the production caller must then use Reference to preserve canonical
/// ResourceLimit/error timing. K output hits still require O(K) writes.
pub(crate) fn execute_certified_window(
    clocks: &[AttackClock],
    start: u32,
    end: u32,
    initial_hp: u128,
    materialize: bool,
    max_materialized_hits: usize,
) -> Option<ArithmeticWindow> {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;

    let first_lethal_tick = first_lethal_tick(clocks, start, end, initial_hp)?;
    let last_tick = if initial_hp == 0 { start } else { first_lethal_tick.unwrap_or(end) };
    let mut hit_counts = Vec::with_capacity(clocks.len());
    let mut hit_tick_sums = Vec::with_capacity(clocks.len());
    let mut total_hits = 0_u128;
    for &clock in clocks {
        let (before_count, before_sum) =
            if start == 0 { (0, 0) } else { hit_stats(clock, start - 1)? };
        let (end_count, end_sum) =
            if initial_hp == 0 { (before_count, before_sum) }
            else { hit_stats(clock, last_tick)? };
        let count = end_count.checked_sub(before_count)?;
        let sum = end_sum.checked_sub(before_sum)?;
        total_hits = total_hits.checked_add(u128::from(count))?;
        hit_counts.push(count);
        hit_tick_sums.push(sum);
    }
    if total_hits > max_materialized_hits as u128 {
        return None;
    }
    let batches = if materialize {
        let mut heap = BinaryHeap::<Reverse<(u32, usize)>>::new();
        for (index, clock) in clocks.iter().enumerate() {
            if initial_hp == 0 { continue; }
            let first = if clock.first_tick >= start {
                Some(clock.first_tick)
            } else {
                let elapsed = start - clock.first_tick;
                let remainder = elapsed % clock.interval;
                if remainder == 0 { Some(start) }
                else { start.checked_add(clock.interval - remainder) }
            };
            if let Some(tick) = first.filter(|&tick| tick <= last_tick) {
                heap.push(Reverse((tick, index)));
            }
        }
        let mut materialized = Vec::new();
        while let Some(Reverse((tick, index))) = heap.pop() {
            let mut actor_indices = vec![index];
            while heap.peek().is_some_and(|entry| (entry.0).0 == tick) {
                let Reverse((_, other)) = heap.pop().expect("peeked element exists");
                actor_indices.push(other);
            }
            // Collect the entire equal-Tick batch before scheduling successor
            // clocks. ID order is stable, as in the reference frozen snapshot.
            actor_indices.sort_unstable();
            for &actor in &actor_indices {
                if let Some(next) = tick.checked_add(clocks[actor].interval)
                    .filter(|&next| next <= last_tick)
                {
                    heap.push(Reverse((next, actor)));
                }
            }
            materialized.push(DueBatch { tick, actor_indices });
        }
        Some(materialized)
    } else {
        None
    };
    Some(ArithmeticWindow {
        first_lethal_tick, last_tick, hit_counts, hit_tick_sums,
        total_hits, batches,
    })
}

/// An exact, match-owned candidate-readiness recurrence, distinct from a
/// fixed-target damage proof. Only source readiness is predicted; target
/// visibility, locks, movement, damage, event ordering and rewards are *never*
/// inferred. The canonical resolver still handles every Tick that could hit.
///
/// The recurrence assumes each due source successfully attacks, which writes
/// attack_ready = tick + max(1, interval). The very next canonical Tick checks
/// the actual complete source read set. A miss, skill, spawn, death, cooldown
/// rewrite, owner change or newly eligible actor invalidates the plan *before*
/// any source is skipped. This also bounds speculation: no staged World writes.
#[derive(Clone, Debug)]
struct PeriodicSource {
    id: senkei_model::EntityId,
    kind: String,
    owner: Option<senkei_model::CombatantSide>,
    hp: i64,
    ready: i64,
    attack: i64,
    range: i64,
    interval: i64,
    clock: Option<AttackClock>,
}

fn is_combat_source(kind: &str) -> bool {
    matches!(kind, "hero" | "minion" | "monster" | "tower" | "base")
}

/// The engine still advances every canonical Tick. This persistent solver
/// avoids full basic-attack selection on a mathematically certified no-due
/// Tick and supplies exact candidate IDs on a due Tick. If the recurrence is
/// stale the caller must run the Reference attack-selection kernel.
pub(crate) struct CertifiedAttackTimeline {
    initial_tick: u32,
    last_tick: Option<u32>,
    sources: Vec<PeriodicSource>,
    clocks: Vec<AttackClock>,
    clock_ids: Vec<senkei_model::EntityId>,
}

impl CertifiedAttackTimeline {
    pub(crate) fn from_snapshot(world: &senkei_model::WorldState, tick: u32) -> Option<Self> {
        use crate::next_support as support;
        let mut sources = Vec::new();
        let mut clocks = Vec::new();
        let mut clock_ids = Vec::new();
        for (id, entity) in &world.entities {
            if !is_combat_source(entity.entity_type.as_str()) { continue; }
            let hp = support::int(entity, "hp");
            let ready = support::int(entity, "attack_ready");
            let attack = support::int(entity, "attack");
            let range = support::int(entity, "range");
            let interval = support::int(entity, "attack_interval").max(1);
            let clock = if hp > 0 && attack > 0 && range >= 0 {
                let first = if ready <= i64::from(tick) {
                    tick
                } else {
                    // Unrepresentable future deadlines are not a proof of
                    // periodicity and are left to the canonical executor.
                    u32::try_from(ready).ok()?
                };
                let interval = u32::try_from(interval).ok()?;
                let clock = AttackClock { first_tick: first, interval, damage: 1 };
                clocks.push(clock);
                clock_ids.push(id.clone());
                Some(clock)
            } else {
                None
            };
            sources.push(PeriodicSource {
                id: id.clone(), kind: entity.entity_type.as_str().to_owned(),
                owner: entity.owner, hp, ready, attack, range, interval,
                clock,
            });
        }
        Some(Self { initial_tick: tick, last_tick: None, sources, clocks, clock_ids })
    }

    fn expected_ready(source: &PeriodicSource, tick: u32) -> Option<i64> {
        let Some(clock) = source.clock else { return Some(source.ready) };
        if tick <= clock.first_tick { return Some(source.ready); }
        let prior_hits = hit_count(clock, tick - 1)?;
        if prior_hits == 0 { return Some(source.ready); }
        // The timestamp of the most recent guaranteed hit is well-defined;
        // the canonical attack-ready write uses saturating i64 addition.
        let prior_due = u128::from(clock.first_tick)
            .checked_add(u128::from(prior_hits - 1)
                .checked_mul(u128::from(clock.interval))?)?;
        let prior_due = i64::try_from(prior_due).ok()?;
        Some(prior_due.saturating_add(source.interval))
    }

    /// None denotes an invalid certificate and requires Reference on this
    /// very Tick. Some(empty) certifies no basic attack is ready anywhere.
    /// Some(ids) is a stable-ordered *candidate* set only; canonical combat
    /// predicates, same-Tick simultaneous damage and all Replay remain active.
    pub(crate) fn due(&mut self, world: &senkei_model::WorldState, tick: u32)
        -> Option<Vec<senkei_model::EntityId>>
    {
        use crate::next_support as support;
        if self.last_tick.map_or(tick != self.initial_tick,
            |last| last.checked_add(1) != Some(tick))
        {
            return None;
        }
        let mut current = world.entities.iter()
            .filter(|(_, entity)| is_combat_source(entity.entity_type.as_str()));
        for prior in &self.sources {
            let (id, entity) = current.next()?;
            if *id != prior.id
                || entity.entity_type.as_str() != prior.kind
                || entity.owner != prior.owner
                || support::int(entity, "hp") != prior.hp
                || support::int(entity, "attack") != prior.attack
                || support::int(entity, "range") != prior.range
                || support::int(entity, "attack_interval").max(1) != prior.interval
                || support::int(entity, "attack_ready") != Self::expected_ready(prior, tick)?
            {
                return None;
            }
        }
        if current.next().is_some() { return None; }
        let ids = due_actor_indices(&self.clocks, tick)?.into_iter()
            .map(|index| self.clock_ids[index].clone()).collect();
        self.last_tick = Some(tick);
        Some(ids)
    }

    pub(crate) fn combatant_count(&self) -> usize { self.sources.len() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{CombatantSide, DomainValue, EntityState, EntityId, FieldId, WorldState};

    fn timeline_actor(ready: i64, interval: i64, attack: i64) -> EntityState {
        EntityState {
            entity_type: "hero".into(),
            owner: Some(CombatantSide::Attacker),
            fields: [
                (FieldId::from("hp"), DomainValue::Integer(100)),
                (FieldId::from("attack_ready"), DomainValue::Integer(ready)),
                (FieldId::from("attack_interval"), DomainValue::Integer(interval)),
                (FieldId::from("attack"), DomainValue::Integer(attack)),
                (FieldId::from("range"), DomainValue::Integer(40)),
            ].into_iter().collect(),
        }
    }

    fn set_ready(world: &mut WorldState, id: &str, value: i64) {
        world.entities.get_mut(&EntityId::from(id)).unwrap()
            .fields.insert("attack_ready".into(), DomainValue::Integer(value));
    }

    #[test]
    fn periodic_timeline_reconstructs_due_boundaries_and_rejects_missed_hit() {
        let mut world = WorldState::default();
        world.entities.insert("source".into(), timeline_actor(3, 4, 11));
        for n in 0..24 {
            world.entities.insert(format!("idle-{n:02}").into(),
                timeline_actor(0, 5, 0));
        }
        let mut plan = CertifiedAttackTimeline::from_snapshot(&world, 1).unwrap();
        assert!(plan.due(&world, 1).unwrap().is_empty());
        assert!(plan.due(&world, 2).unwrap().is_empty());
        assert_eq!(plan.due(&world, 3).unwrap(),
            vec![EntityId::from("source")]);
        set_ready(&mut world, "source", 7);
        for tick in 4..7 {
            assert!(plan.due(&world, tick).unwrap().is_empty());
        }
        assert_eq!(plan.due(&world, 7).unwrap(),
            vec![EntityId::from("source")]);
        // A blocked attack at Tick 7 leaves attack_ready at 7. The
        // speculative periodic interval is invalid on Tick 8, so the
        // canonical resolver must inspect that ready actor again.
        assert_eq!(plan.due(&world, 8), None);
    }

    #[test]
    fn periodic_timeline_fails_closed_for_spawn_owner_and_interval_changes() {
        for change in 0..5 {
            let mut world = WorldState::default();
            world.entities.insert("source".into(), timeline_actor(6, 4, 12));
            let mut plan = CertifiedAttackTimeline::from_snapshot(&world, 1).unwrap();
            assert!(plan.due(&world, 1).unwrap().is_empty());
            match change {
                0 => { world.entities.insert("spawn".into(),
                    timeline_actor(2, 1, 15)); }
                1 => { world.entities.get_mut(&EntityId::from("source")).unwrap()
                    .owner = Some(CombatantSide::Defender); }
                2 => { world.entities.get_mut(&EntityId::from("source")).unwrap()
                    .fields.insert("attack_interval".into(), DomainValue::Integer(2)); }
                3 => { world.entities.get_mut(&EntityId::from("source")).unwrap()
                    .fields.insert("attack_ready".into(), DomainValue::Integer(2)); }
                _ => { world.entities.get_mut(&EntityId::from("source")).unwrap()
                    .fields.insert("hp".into(), DomainValue::Integer(0)); }
            }
            assert_eq!(plan.due(&world, 2), None, "change={change}");
        }
    }

    #[test]
    fn periodic_timeline_clamps_existing_ready_clock_and_requires_sequential_ticks() {
        let mut world = WorldState::default();
        world.entities.insert("source".into(), timeline_actor(-50, 3, 20));
        let mut plan = CertifiedAttackTimeline::from_snapshot(&world, 10).unwrap();
        assert_eq!(plan.due(&world, 10).unwrap(), vec![EntityId::from("source")]);
        set_ready(&mut world, "source", 13);
        assert_eq!(plan.due(&world, 12), None, "jumping over Tick 11 is not eligible");
        assert!(plan.due(&world, 11).unwrap().is_empty());
        assert!(plan.due(&world, 12).unwrap().is_empty());
        assert_eq!(plan.due(&world, 13).unwrap(), vec![EntityId::from("source")]);
        // A valid but too-long interval is not coerced into a shorter one.
        let mut invalid = WorldState::default();
        invalid.entities.insert("source".into(),
            timeline_actor(0, i64::from(u32::MAX) + 1, 20));
        assert!(CertifiedAttackTimeline::from_snapshot(&invalid, 1).is_none());
    }


    #[test]
    fn arithmetic_matches_reference_tick_enumeration_across_seeded_clocks() {
        for seed in 0_u32..256 {
            let clocks = (0..(seed % 13)).map(|i| AttackClock {
                first_tick: (seed.wrapping_mul(17).wrapping_add(i * 7)) % 51,
                interval: 1 + (seed.wrapping_add(i * 11)) % 19,
                damage: u64::from(1 + (seed.wrapping_mul(3).wrapping_add(i)) % 27),
            }).collect::<Vec<_>>();
            let mut damage = 0_u128;
            let mut count = vec![0_u64; clocks.len()];
            let mut tick_sum = vec![0_u128; clocks.len()];
            for t in 0_u32..128 {
                let due = due_actor_indices(&clocks, t).unwrap();
                for i in due {
                    damage += u128::from(clocks[i].damage);
                    count[i] += 1;
                    tick_sum[i] += u128::from(t);
                }
                assert_eq!(cumulative_damage(&clocks, t), Some(damage), "seed={seed}, tick={t}");
                for (i, &clock) in clocks.iter().enumerate() {
                    assert_eq!(hit_stats(clock, t), Some((count[i], tick_sum[i])), "seed={seed}, actor={i}, tick={t}");
                }
            }
            for threshold in [1, 5, 37, 100, 1000, 10000] {
                let expected = (0..128).find(|&t| {
                    cumulative_damage(&clocks, t).unwrap() >= threshold
                });
                assert_eq!(first_lethal_tick(&clocks, 0, 127, threshold), Some(expected), "seed={seed}, threshold={threshold}");
            }
        }
    }

    #[test]
    fn complete_windows_match_tick_oracle_with_nonzero_start_and_full_batches() {
        for seed in 0_u32..128 {
            let clocks = (0..seed % 11).map(|i| AttackClock {
                first_tick: (seed.wrapping_mul(7).wrapping_add(i * 13)) % 47,
                interval: 1 + (seed.wrapping_add(i * 3)) % 17,
                damage: u64::from(1 + (seed.wrapping_add(i * 7)) % 19),
            }).collect::<Vec<_>>();
            for start in [0_u32, 4, 17, 49] {
                for end in [63_u32, 127] {
                    for hp in [1_u128, 4, 50, 100, 1000] {
                        let mut ref_counts = vec![0_u64; clocks.len()];
                        let mut ref_sums = vec![0_u128; clocks.len()];
                        let mut ref_batches = Vec::new();
                        let mut remaining = hp;
                        let mut lethal = None;
                        for tick in start..=end {
                            let actors = due_actor_indices(&clocks, tick).unwrap();
                            if actors.is_empty() { continue; }
                            let mut damage = 0_u128;
                            for &i in &actors {
                                damage += u128::from(clocks[i].damage);
                                ref_counts[i] += 1;
                                ref_sums[i] += u128::from(tick);
                            }
                            ref_batches.push(DueBatch { tick, actor_indices: actors });
                            if damage >= remaining {
                                lethal = Some(tick);
                                break;
                            }
                            remaining -= damage;
                        }
                        let expected_hits = ref_counts.iter().map(|&n| u128::from(n)).sum::<u128>();
                        let actual = execute_certified_window(
                            &clocks, start, end, hp, true, 100_000,
                        ).unwrap();
                        assert_eq!(actual.first_lethal_tick, lethal,
                            "lethal seed={seed} range={start}..{end} hp={hp}");
                        assert_eq!(actual.last_tick, lethal.unwrap_or(end));
                        assert_eq!(actual.hit_counts, ref_counts);
                        assert_eq!(actual.hit_tick_sums, ref_sums);
                        assert_eq!(actual.total_hits, expected_hits);
                        assert_eq!(actual.batches, Some(ref_batches));
                        let aggregate = execute_certified_window(
                            &clocks, start, end, hp, false, 100_000,
                        ).unwrap();
                        assert_eq!(aggregate.batches, None);
                        assert_eq!(aggregate.hit_counts, actual.hit_counts);
                        assert_eq!(aggregate.hit_tick_sums, actual.hit_tick_sums);
                    }
                }
            }
        }
    }

    #[test]
    fn nonzero_window_does_not_count_prior_hits_and_caps_materialization() {
        let clocks = [AttackClock { first_tick: 0, interval: 3, damage: 4 }];
        assert_eq!(first_lethal_tick(&clocks, 10, 20, 5), Some(Some(15)));
        assert_eq!(execute_certified_window(&clocks, 10, 20, 5, true, 1), None);
        let result = execute_certified_window(&clocks, 10, 20, 5, true, 2).unwrap();
        assert_eq!(result.hit_counts, vec![2]);
        assert_eq!(result.hit_tick_sums, vec![12 + 15]);
        assert_eq!(result.batches, Some(vec![
            DueBatch { tick: 12, actor_indices: vec![0] },
            DueBatch { tick: 15, actor_indices: vec![0] },
        ]));
        assert_eq!(execute_certified_window(&clocks, 10, 20, 0, true, 0).unwrap().total_hits, 0);
        assert_eq!(execute_certified_window(&clocks, 10, 20, 1, false, 0), None);
    }

    #[test]
    fn lethal_tick_preserves_all_simultaneous_attacks() {
        let clocks = [
            AttackClock { first_tick: 3, interval: 4, damage: 5 },
            AttackClock { first_tick: 3, interval: 7, damage: 10 },
            AttackClock { first_tick: 3, interval: 3, damage: 1 },
        ];
        assert_eq!(first_lethal_tick(&clocks, 0, 20, 6), Some(Some(3)));
        assert_eq!(due_actor_indices(&clocks, 3), Some(vec![0, 1, 2]));
        assert_eq!(cumulative_damage(&clocks, 3), Some(16));
    }

    #[test]
    fn invalid_clocks_and_empty_windows_are_rejected() {
        let bad = [AttackClock { first_tick: 0, interval: 0, damage: 1 }];
        assert_eq!(hit_count(bad[0], 0), None);
        assert_eq!(cumulative_damage(&bad, 3), None);
        assert_eq!(first_lethal_tick(&bad, 0, 3, 0), None);
        assert_eq!(due_actor_indices(&bad, 1), None);
        assert_eq!(first_lethal_tick(&[], 4, 3, 1), None);
        assert_eq!(first_lethal_tick(&[], 0, 3, 1), Some(None));
        assert_eq!(first_lethal_tick(&[], 0, 3, 0), Some(None));
    }

    #[test]
    fn inclusive_boundary_and_u32_max_are_exact() {
        let clocks = [AttackClock { first_tick: u32::MAX - 1, interval: 1, damage: u64::MAX }];
        assert_eq!(hit_count(clocks[0], u32::MAX), Some(2));
        assert_eq!(hit_stats(clocks[0], u32::MAX), Some((2, u128::from(u32::MAX - 1) + u128::from(u32::MAX))));
        assert_eq!(first_lethal_tick(&clocks, u32::MAX - 1, u32::MAX, u128::from(u64::MAX) + 1), Some(Some(u32::MAX)));
    }
}
