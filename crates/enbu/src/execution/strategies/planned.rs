//! Planned target-candidate kernel for a single immutable combat-phase snapshot.
//!
//! The first vertical slice of Hybrid execution has a deliberately narrow
//! certificate: the caller's frozen `WorldState` for exactly one basic-attack
//! selection phase. It does not claim that future Tick state is immutable.
//! Classification preserves the original BTreeMap iteration order; the
//! authoritative combat predicate, distance comparison and simultaneous-hit
//! commit remain owned by `next_combat`.

use crate::{next_combat, next_support, next_vision};
#[cfg(feature = "lab-opt-spatial")]
use std::collections::BTreeMap;
use senkei_model::{CombatantSide, EntityId, EntityState, NextRules, WorldState};

/// Structural combat position. In the canonical rules a basic attack can
/// connect only two actors at the same Node, or two actors on the same
/// undirected graph edge. The *authoritative* combat predicate still checks
/// valid position, range, track offset, ownership and visibility.
#[cfg(feature = "lab-opt-spatial")]
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
enum CombatLocation {
    Node(String),
    Edge(String, String),
}

#[cfg(feature = "lab-opt-spatial")]
impl CombatLocation {
    fn of(entity: &EntityState) -> Option<Self> {
        let node = next_support::string(entity, "node");
        if node.is_empty() {
            return None;
        }
        let other = next_support::string(entity, "edge_to");
        if other.is_empty() {
            Some(Self::Node(node))
        } else if node <= other {
            Some(Self::Edge(node, other))
        } else {
            Some(Self::Edge(other, node))
        }
    }
}

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
    #[cfg(feature = "lab-opt-spatial")]
    by_location: BTreeMap<CombatLocation, Vec<(&'a EntityId, &'a EntityState)>>,
    #[cfg(feature = "lab-opt-spatial")]
    spatial_admitted: bool,
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
            #[cfg(feature = "lab-opt-spatial")]
            by_location: BTreeMap::new(),
            #[cfg(feature = "lab-opt-spatial")]
            spatial_admitted: snapshot.entities.len() >= 24,
        };
        for (id, target) in &snapshot.entities {
            if !next_support::alive(target) || !next_combat::is_targetable(target) {
                continue;
            }
            result.all.push((id, target));
            // Group only living targetable entities. Each list is appended in
            // canonical EntityId order so ActorDecisionCollector candidate
            // traces and equal-distance tie breaks are unchanged.
            #[cfg(feature = "lab-opt-spatial")]
            if result.spatial_admitted {
                if let Some(location) = CombatLocation::of(target) {
                    result.by_location.entry(location).or_default().push((id, target));
                }
            }
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

    /// Only the canonical Node/Edge relation is used for pruning: the
    /// reference predicate must still accept or reject every survivor.
    /// Invalid graph coordinates may enter a bucket, but they cannot cause
    /// false positives because the reference predicate checks validity.
    pub(crate) fn candidates_for(&self, source: &EntityState)
        -> &[(&'a EntityId, &'a EntityState)]
    {
        #[cfg(feature = "lab-opt-spatial")]
        if self.spatial_admitted {
            return CombatLocation::of(source)
                .and_then(|location| self.by_location.get(&location))
                .map(Vec::as_slice)
                .unwrap_or(&[]);
        }
        self.candidates(source)
    }

    pub(crate) fn vision_sources(&self, side: CombatantSide) -> &[&'a EntityState] {
        match side {
            CombatantSide::Attacker => &self.attacker_vision,
            CombatantSide::Defender => &self.defender_vision,
        }
    }
}
