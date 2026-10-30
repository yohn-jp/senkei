//! Certified, cross-Tick Active Set for the production Next movement phase.
//!
//! A Tick still materializes every authoritative observation, Jinrei evaluation,
//! CU and owner/public Replay. The window skips *only* mobile actors for which
//! the canonical movement executor would return before its first write.
//!
//! There is no guessed time-to-live. Every Tick compares the complete ordered
//! dependency read set, including nonmobile entities becoming mobile, against
//! the actual frozen P7 World. New goals, squads, spawns, deaths, edge states
//! and explicit movement intents therefore invalidate the window immediately.
//! Route-driven waypoints must bypass this cache; they can change without
//! writing a source goal.

use crate::next_support as support;
use senkei_model::{CombatantSide, EntityId, EntityState, WorldState};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Eq, PartialEq)]
struct MovementKey {
    id: EntityId,
    kind: String,
    owner: Option<CombatantSide>,
    hp: i64,
    squad: String,
    goal: String,
    edge_to: String,
    move_intent_tick: i64,
    track_intent_tick: i64,
}

impl MovementKey {
    fn from_entity(id: &EntityId, actor: &EntityState) -> Self {
        Self {
            id: id.clone(),
            kind: actor.entity_type.as_str().to_owned(),
            owner: actor.owner,
            hp: support::int(actor, "hp"),
            squad: support::string(actor, "squad"),
            goal: support::string(actor, "goal"),
            edge_to: support::string(actor, "edge_to"),
            move_intent_tick: support::int(actor, "move_intent_tick"),
            track_intent_tick: support::int(actor, "track_intent_tick"),
        }
    }

    fn matches(&self, id: &EntityId, actor: &EntityState) -> bool {
        self.id == *id
            && self.kind == actor.entity_type.as_str()
            && self.owner == actor.owner
            && self.hp == support::int(actor, "hp")
            && field_equals(actor, "squad", &self.squad)
            && field_equals(actor, "goal", &self.goal)
            && field_equals(actor, "edge_to", &self.edge_to)
            && self.move_intent_tick == support::int(actor, "move_intent_tick")
            && self.track_intent_tick == support::int(actor, "track_intent_tick")
    }
}

/// Compare a cached string/enum in place; validating a quiet window must not
/// clone or allocate a new copy of every field on every Tick.
fn field_equals(entity: &EntityState, key: &str, expected: &str) -> bool {
    use senkei_model::{DomainValue, FieldId};
    let actual = match entity.fields.get(&FieldId::from(key)) {
        Some(DomainValue::String(s)) => s.as_str(),
        Some(DomainValue::Enum(s)) => s.as_str(),
        _ => "",
    };
    actual == expected
}

#[derive(Default)]
pub(crate) struct MovementWindow {
    read_set: Vec<MovementKey>,
    active: Vec<EntityId>,
    mobile_count: usize,
    initialized: bool,
    pub(crate) skipped_sources: u64,
    pub(crate) reused: u64,
    pub(crate) rebuilt: u64,
}

impl MovementWindow {
    /// Returns a stable, minion-first ordering equivalent to the canonical
    /// full-source iteration. A cached window does *not* reuse any dynamic
    /// movement budget, route, visibility, bridge or target predicate: the
    /// original Next movement kernel computes those for each active source.
    pub(crate) fn eligible<'a>(&'a mut self, world: &WorldState) -> &'a [EntityId] {
        if self.initialized && self.valid(world) {
            self.reused += 1;
            self.skipped_sources += self.mobile_count.saturating_sub(self.active.len()) as u64;
            return &self.active;
        }
        self.rebuilt += 1;
        self.initialized = true;
        self.read_set = world.entities.iter()
            .map(|(id, actor)| MovementKey::from_entity(id, actor))
            .collect();

        // The hero cohort leader is the first *living* same-owner/squad Hero
        // in WorldState BTreeMap order; only its goal controls members.
        // An active leader may move a member whose personal goal is empty.
        let mut leader_has_goal = BTreeMap::<(CombatantSide, String), bool>::new();
        for (_, actor) in &world.entities {
            if actor.entity_type.as_str() != "hero" || !support::alive(actor) {
                continue;
            }
            let squad = support::string(actor, "squad");
            if let Some(side) = actor.owner.filter(|_| !squad.is_empty()) {
                leader_has_goal.entry((side, squad))
                    .or_insert_with(|| !support::string(actor, "goal").is_empty());
            }
        }

        self.mobile_count = world.entities.values()
            .filter(|entity| matches!(entity.entity_type.as_str(), "hero" | "minion" | "monster")
                && support::alive(entity)).count();
        let mut active = Vec::<(u8, EntityId)>::new();
        for (id, actor) in &world.entities {
            let kind = actor.entity_type.as_str();
            if !matches!(kind, "hero" | "minion" | "monster") || !support::alive(actor) {
                continue;
            }
            let squad = support::string(actor, "squad");
            let shared_goal = kind == "hero" && actor.owner
                .and_then(|side| leader_has_goal.get(&(side, squad)))
                .copied().unwrap_or(false);
            // Any nonzero explicit intent marker is admitted conservatively
            // regardless of its Tick. A previously expired marker is extra
            // work, never a lost future activation.
            if shared_goal
                || !support::string(actor, "goal").is_empty()
                || !support::string(actor, "edge_to").is_empty()
                || support::int(actor, "move_intent_tick") != 0
                || support::int(actor, "track_intent_tick") != 0
            {
                active.push((if kind == "minion" { 0 } else { 1 }, id.clone()));
            }
        }
        active.sort();
        self.active = active.into_iter().map(|(_, id)| id).collect();
        self.skipped_sources += self.mobile_count.saturating_sub(self.active.len()) as u64;
        &self.active
    }

    fn valid(&self, world: &WorldState) -> bool {
        let mut current = world.entities.iter();
        self.read_set.iter().all(|previous| current.next()
            .is_some_and(|(id, entity)| previous.matches(id, entity)))
            && current.next().is_none()
    }

    #[cfg(test)]
    pub(crate) fn stats(&self) -> (u64, u64) {
        (self.reused, self.rebuilt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{DomainValue, EntityState, FieldId};

    fn entity(kind: &str, side: Option<CombatantSide>, hp: i64, squad: &str, goal: &str) -> EntityState {
        EntityState { entity_type: kind.into(), owner: side, fields: [
            (FieldId::from("hp"), DomainValue::Integer(hp)),
            (FieldId::from("squad"), DomainValue::String(squad.to_owned())),
            (FieldId::from("goal"), DomainValue::String(goal.to_owned())),
        ].into_iter().collect() }
    }
    fn ids(window: &mut MovementWindow, world: &WorldState) -> Vec<String> {
        window.eligible(world).iter().map(|id| id.as_str().to_owned()).collect()
    }

    #[test]
    fn persistent_idle_window_detects_new_goal_and_new_minion() {
        let mut world = WorldState::default();
        world.entities.insert("hero-a".into(), entity("hero", Some(CombatantSide::Attacker), 10, "", ""));
        world.entities.insert("structure".into(), entity("base", Some(CombatantSide::Defender), 100, "", ""));
        let mut window = MovementWindow::default();
        assert!(ids(&mut window, &world).is_empty());
        assert!(ids(&mut window, &world).is_empty());
        assert_eq!(window.stats(), (1, 1));
        assert_eq!(window.skipped_sources, 2, "both idle world Ticks must skip the Hero");

        world.entities.get_mut(&EntityId::from("hero-a")).unwrap()
            .fields.insert(FieldId::from("goal"), DomainValue::String("node-2".into()));
        assert_eq!(ids(&mut window, &world), vec!["hero-a"]);
        assert_eq!(window.stats(), (1, 2));

        world.entities.insert("minion-z".into(), entity("minion", Some(CombatantSide::Attacker), 5, "", "lane"));
        assert_eq!(ids(&mut window, &world), vec!["minion-z", "hero-a"]);
        assert_eq!(window.stats(), (1, 3));
    }

    #[test]
    fn leader_goals_and_new_member_invalidate_exact_idle_certificate() {
        let mut world = WorldState::default();
        world.entities.insert("hero-a".into(), entity("hero", Some(CombatantSide::Attacker), 10, "squad", ""));
        world.entities.insert("hero-b".into(), entity("hero", Some(CombatantSide::Attacker), 10, "squad", ""));
        let mut window = MovementWindow::default();
        assert!(ids(&mut window, &world).is_empty());
        world.entities.get_mut(&EntityId::from("hero-b")).unwrap()
            .fields.insert(FieldId::from("goal"), DomainValue::String("ignored-personal".into()));
        // The follower is admitted conservatively, even though its leader
        // has no goal and therefore might not actually move.
        assert_eq!(ids(&mut window, &world), vec!["hero-b"]);
        world.entities.get_mut(&EntityId::from("hero-a")).unwrap()
            .fields.insert(FieldId::from("goal"), DomainValue::String("shared".into()));
        assert_eq!(ids(&mut window, &world), vec!["hero-a", "hero-b"]);
        world.entities.get_mut(&EntityId::from("hero-a")).unwrap()
            .fields.insert(FieldId::from("hp"), DomainValue::Integer(0));
        // Death changes the cohort leader; still conservative and exact.
        assert_eq!(ids(&mut window, &world), vec!["hero-b"]);
    }

    #[test]
    fn dormant_actor_becomes_active_on_marker_owner_or_type_change() {
        let mut world = WorldState::default();
        world.entities.insert("a".into(), entity("observation", None, 1, "", ""));
        let mut window = MovementWindow::default();
        assert!(ids(&mut window, &world).is_empty());
        world.entities.get_mut(&EntityId::from("a")).unwrap().entity_type = "monster".into();
        assert!(ids(&mut window, &world).is_empty());
        world.entities.get_mut(&EntityId::from("a")).unwrap().fields
            .insert(FieldId::from("move_intent_tick"), DomainValue::Integer(99));
        assert_eq!(ids(&mut window, &world), vec!["a"]);
        world.entities.get_mut(&EntityId::from("a")).unwrap().fields
            .insert(FieldId::from("move_intent_tick"), DomainValue::Integer(0));
        assert!(ids(&mut window, &world).is_empty());
    }
}
