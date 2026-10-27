# Issue #51: canonical Replay placement index

## Problem and authority

For the same authorized Replay and Tick, `NodeDisplayLayout.update` currently
depends on previously rendered frames. The issue records a 2.462 world-unit
difference for one actor at Tick 13 between direct seek and sequential playback.
REPLAY §§3–4 require the same confirmed display state at the same Tick; the
existing node and edge placement tests also require occupants to retain their
slots when peers enter or leave. The change is presentation-only: it must not
alter World coordinates, combat, results, logical CU, or visibility.

The user approved adding the canonical placement index on 2026-10-27. This
approval does not change ownership of Replay Player or Enbu state.

## Proposed renderer-owned index

At renderer creation, fold the immutable, authorized Replay forward once in
Tick/order sequence. At each relevant Tick apply the existing node and directed
edge/track slot allocator to that Tick's visible entities. Record changes in
per-entity placement histories, including removal when an actor disappears or
is no longer rendered. A query at Tick `t` uses the latest record at or before
`t`; direct seek, rewind, and stepping consequently consult the same history.
Only Replay-authorized facts enter the fold. A new Replay receives a fresh
index, and there is no interpolation through an unobserved visibility gap.

For `E` events, relevant Ticks `i`, active counts `N_i` and recorded changes
`D`, construction costs `O(E + Σ layout(N_i) + D)`, where grouping/sorting
is at least `O(N_i log N_i)` and existing node/edge slot geometry also has its
own cost. Storage is `O(D)` plus the current fold state; worst-case `D` can
still be large for dense, moving battles. Indexed lookup costs at most
`O(V log D_entity)` for `V` currently visible actors, plus output allocation.
No placement query replays all prior Ticks. Replay Player also advances its
existing projection incrementally during forward playback; a backward seek
rebuilds that Player projection, without transferring placement ownership.
This avoids an `O(T² × entities)` sequential-playback hot path. Startup time
and peak memory on dense and long real Replays must be
measured; the index is not a performance acceptance claim.

## Alternatives

- Sorting only the target frame makes direct seek deterministic but can shift
  existing actors when a newly arriving ID sorts earlier, violating slot
  stability. Fixed bounded hashes also collide; resolving collisions without
  history can move survivors, while unbounded unique positions violate the
  bounded node and track placement requirements.
- Replaying the allocator from Tick zero on every update can preserve slots but
  repeats work and violates the issue's hot-path constraint.
- Moving placement ownership into Replay Player is broader than needed for
  this change and was not part of the approved proposal.

## Required verification

Use a complete Replay fixture with multiple crowded nodes and overlapping
edge/track groups, including bridge/ford placement, joins, departures,
visibility loss, and a fresh Replay. Compare offset maps at multiple Ticks for
direct seek, progressive playback, rewind, and repeated seek; assert that
surviving occupants remain stable and source Replay/World coordinates do not
change. Exercise the production build with the same Replay and camera at
320, 390, 430, and 1440 px; confirm no seek-only jumps, record exact HEAD and
Tick, and measure startup/memory on a suitably dense Replay. Browser visuals,
physical GPU performance, and user art judgment remain independent checks.

This document records an approved approach and its validation requirements;
it is not a claim that Issue #51 is fixed or visually accepted.
