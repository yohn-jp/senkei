//! Planned target-candidate kernel for a single immutable combat-phase snapshot.
//!
//! The first vertical slice of Hybrid execution has a deliberately narrow
//! certificate: the caller's frozen `WorldState` for exactly one basic-attack
//! selection phase. It does not claim that future Tick state is immutable.
//! Classification preserves the original BTreeMap iteration order; the
//! authoritative combat predicate, distance comparison and simultaneous-hit
//! commit remain owned by `next_combat`.

use crate::{next_combat, next_support, next_vision};
use senkei_model::{CombatantSide, EntityId, EntityState, NextRules, WorldState};

/// Insertion/iteration order of every vector is exactly WorldState.entities
/// BTreeMap order. A snapshot-scoped index is discarded after combat selection,
/// so movement, skill, deaths and respawns cannot reuse stale candidates.
pub(crate) struct PlannedCombatCandidates<'a> {
    all: Vec<(&'a EntityId, &'a EntityState)>,
    enemy_attacker: Vec<(&'a EntityId, &'a EntityState)>,
    enemy_defender: Vec<(&'a EntityId, &'a EntityState)>,
    owned_hero_minion: Vec<(&'a EntityId, &'a EntityState)>,
    enemy_hero_minion_attacker: Vec<(&'a EntityId, &'a EntityState)>,
    enemy_hero_minion_defender: Vec<(&'a EntityId, &'a EntityState)>,
    attacker_vision: Vec<&'a EntityState>,
    defender_vision: Vec<&'a EntityState>,
}

impl<'a> PlannedCombatCandidates<'a> {
    pub(crate) fn build(snapshot: &'a WorldState, rules: &NextRules) -> Self {
        let mut result = Self {
            all: Vec::new(), enemy_attacker: Vec::new(), enemy_defender: Vec::new(),
            owned_hero_minion: Vec::new(),
            enemy_hero_minion_attacker: Vec::new(),
            enemy_hero_minion_defender: Vec::new(),
            attacker_vision: next_vision::vision_sources(snapshot, rules, CombatantSide::Attacker),
            defender_vision: next_vision::vision_sources(snapshot, rules, CombatantSide::Defender),
        };
        for (id, target) in &snapshot.entities {
            if !next_support::alive(target) || !next_combat::is_targetable(target) {
                continue;
            }
            result.all.push((id, target));
            if target.owner != Some(CombatantSide::Attacker) {
                result.enemy_attacker.push((id, target));
            }
            if target.owner != Some(CombatantSide::Defender) {
                result.enemy_defender.push((id, target));
            }
            if matches!(target.entity_type.as_str(), "hero" | "minion") && target.owner.is_some() {
                result.owned_hero_minion.push((id, target));
                if target.owner != Some(CombatantSide::Attacker) {
                    result.enemy_hero_minion_attacker.push((id, target));
                }
                if target.owner != Some(CombatantSide::Defender) {
                    result.enemy_hero_minion_defender.push((id, target));
                }
            }
        }
        result
    }

    /// Structural pruning only. Full range, targetability, graph geometry,
    /// monster vision, reveal and owner visibility remain authoritative in
    /// `can_basic_attack_with_sources` for every surviving candidate.
    pub(crate) fn candidates(&self, source: &EntityState) -> &[(&'a EntityId, &'a EntityState)] {
        let restricted = matches!(source.entity_type.as_str(), "tower" | "base" | "monster");
        match (restricted, source.owner) {
            (true, Some(CombatantSide::Attacker)) => &self.enemy_hero_minion_attacker,
            (true, Some(CombatantSide::Defender)) => &self.enemy_hero_minion_defender,
            (true, None) => &self.owned_hero_minion,
            (false, Some(CombatantSide::Attacker)) => &self.enemy_attacker,
            (false, Some(CombatantSide::Defender)) => &self.enemy_defender,
            (false, None) => &self.all,
        }
    }

    pub(crate) fn vision_sources(&self, side: CombatantSide) -> &[&'a EntityState] {
        match side {
            CombatantSide::Attacker => &self.attacker_vision,
            CombatantSide::Defender => &self.defender_vision,
        }
    }
}
