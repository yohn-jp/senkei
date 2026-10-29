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

#[cfg(test)]
mod tests {
    use super::*;

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
