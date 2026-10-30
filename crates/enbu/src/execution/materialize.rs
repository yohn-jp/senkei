//! Canonical FullCapture output-obligation ledger.
//!
//! Physical work may be omitted within a certified domain; it may not omit a
//! visible Tick, either owner projection, Jinrei billing, or Replay state.
//! The existing Enbu projection and event machinery is the *only* materializer.
//! This ledger is a constant-time commit gate, not a second serializer.

use senkei_model::{CombatantSide, ReplayFrame};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MaterializationError {
    NonSequentialTick,
    PendingTick,
    MissingPublicFrame,
    MissingOwnerFrame,
    UncommittedTick,
    TerminationTickMismatch,
}

#[derive(Default)]
pub(crate) struct FullCaptureLedger {
    last_committed: u32,
    pending: Option<u32>,
}

impl FullCaptureLedger {
    /// A new canonical Tick is admitted only if every earlier required Tick
    /// was committed and materialized. The scheduler cannot jump ahead.
    pub fn enter(&mut self, tick: u32) -> Result<(), MaterializationError> {
        if self.pending.is_some() {
            return Err(MaterializationError::PendingTick);
        }
        if self.last_committed.checked_add(1) != Some(tick) {
            return Err(MaterializationError::NonSequentialTick);
        }
        self.pending = Some(tick);
        Ok(())
    }

    /// Called after the original Enbu creates the public and owner frames.
    /// Never synthesizes or retrospectively repairs missing/private output.
    pub fn commit(
        &mut self,
        tick: u32,
        public_frames: &[ReplayFrame],
        owner_frames: &BTreeMap<CombatantSide, Vec<ReplayFrame>>,
        requires_owners: bool,
    ) -> Result<(), MaterializationError> {
        if self.pending != Some(tick) {
            return Err(MaterializationError::UncommittedTick);
        }
        if public_frames.last().map(|frame| frame.tick) != Some(tick) {
            return Err(MaterializationError::MissingPublicFrame);
        }
        if requires_owners {
            for side in [CombatantSide::Attacker, CombatantSide::Defender] {
                if owner_frames.get(&side).and_then(|frames| frames.last())
                    .map(|frame| frame.tick) != Some(tick)
                {
                    return Err(MaterializationError::MissingOwnerFrame);
                }
            }
        }
        self.pending = None;
        self.last_committed = tick;
        Ok(())
    }

    pub fn finish(&self, final_tick: u32) -> Result<(), MaterializationError> {
        if self.pending.is_some() {
            return Err(MaterializationError::UncommittedTick);
        }
        if self.last_committed != final_tick {
            return Err(MaterializationError::TerminationTickMismatch);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(tick: u32) -> ReplayFrame {
        ReplayFrame { tick, events: Vec::new(), visible_state: None }
    }

    #[test]
    fn full_capture_must_materialize_every_tick_and_each_owner() {
        let mut ledger = FullCaptureLedger::default();
        let mut public = vec![frame(0)];
        let mut owners = BTreeMap::from([
            (CombatantSide::Attacker, vec![frame(0)]),
            (CombatantSide::Defender, vec![frame(0)]),
        ]);
        assert_eq!(ledger.enter(2), Err(MaterializationError::NonSequentialTick));
        ledger.enter(1).unwrap();
        assert_eq!(ledger.enter(1), Err(MaterializationError::PendingTick));
        assert_eq!(ledger.commit(1, &public, &owners, true),
            Err(MaterializationError::MissingPublicFrame));
        public.push(frame(1));
        assert_eq!(ledger.commit(1, &public, &owners, true),
            Err(MaterializationError::MissingOwnerFrame));
        for frames in owners.values_mut() { frames.push(frame(1)); }
        ledger.commit(1, &public, &owners, true).unwrap();
        assert_eq!(ledger.enter(3), Err(MaterializationError::NonSequentialTick));
        ledger.enter(2).unwrap();
        assert_eq!(ledger.finish(1), Err(MaterializationError::UncommittedTick));
        public.push(frame(2));
        for frames in owners.values_mut() { frames.push(frame(2)); }
        ledger.commit(2, &public, &owners, true).unwrap();
        assert_eq!(ledger.finish(3), Err(MaterializationError::TerminationTickMismatch));
        ledger.finish(2).unwrap();
    }

    #[test]
    fn generic_non_next_plan_has_no_private_owner_frame_requirement() {
        let mut ledger = FullCaptureLedger::default();
        ledger.enter(1).unwrap();
        ledger.commit(1, &[frame(0), frame(1)], &BTreeMap::new(), false).unwrap();
        ledger.finish(1).unwrap();
        assert!(FullCaptureLedger::default().finish(0).is_ok());
    }
}
