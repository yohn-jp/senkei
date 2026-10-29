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

/// First Tick whose cumulative damage meets the threshold, including every
/// simultaneous attacker at that Tick. Never returns a Tick before the
/// provided window. A zero threshold means no lethal event is necessary.
/// Callers must prove no earlier lethal transition outside this window.
pub(crate) fn first_lethal_tick(
    clocks: &[AttackClock], start: u32, end: u32, threshold: u128,
) -> Option<Option<u32>> {
    if start > end { return None; }
    // Validate clocks even if threshold is zero or no attacks are scheduled.
    if clocks.iter().any(|clock| clock.interval == 0) { return None; }
    if threshold == 0 { return Some(None); }
    if cumulative_damage(clocks, end)? < threshold { return Some(None); }
    let mut low = start;
    let mut high = end;
    while low < high {
        let middle = low + (high - low) / 2;
        if cumulative_damage(clocks, middle)? >= threshold {
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
