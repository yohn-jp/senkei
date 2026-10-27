//! Frozen route bindings and per-entity waypoint progress.
use crate::{api_error, next_navigation, next_support as support};
use senkei_model::{
    ActionId, ApiError, ApiErrorCode, CombatantSide, DomainValue, EntityId,
    EntityState, Intent, MatchContext, NextRouteCommand, NextRouteMatch,
    NextRules, PresentationEvent, VerifiedRulePlan, WorldState,
};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn validate_inputs(
    rules: &VerifiedRulePlan,
    context: &MatchContext,
    binding: &NextRouteMatch,
) -> Result<(), ApiError> {
    senritsu::validate_next_route_policy(binding.policy.clone(), rules)
        .map_err(|message| api_error(ApiErrorCode::ValidationFailed, message))?;
    if context.world_identity.as_ref() != Some(&binding.policy.world_identity) {
        return Err(api_error(ApiErrorCode::ValidationFailed, "route policy does not match the match World"));
    }
    let encoded = serde_json::to_vec(binding)
        .map_err(|_| api_error(ApiErrorCode::InvalidRequest, "invalid route inputs"))?;
    if encoded.len() as u64 > context.host_limits.max_input_bytes.min(rules.plan().limits.max_input_bytes) {
        return Err(api_error(ApiErrorCode::ResourceLimit, "route input limit exceeded"));
    }
    let map = &rules.plan().next.as_ref().expect("policy validation checks Next rules").map;
    let mut actions = BTreeSet::new();
    for command in &binding.commands {
        if command.action_id.as_str().is_empty() || command.actor.as_str().is_empty()
            || !actions.insert((command.side, command.action_id.clone()))
            || !binding.policy.preferences.contains(&command.preference)
        {
            return Err(api_error(ApiErrorCode::ValidationFailed, "invalid or duplicate route action, actor, or preference"));
        }
        if !map.nodes.contains_key(&command.destination.0)
            || command.waypoints.iter().any(|node| !map.nodes.contains_key(&node.0))
        {
            return Err(api_error(ApiErrorCode::ValidationFailed, "route destination or waypoint is absent from the paired World"));
        }
    }
    Ok(())
}

/// Check static connectivity from the initial actor and every current squad
/// member. Dynamic blocking and bridge occupancy are checked by navigation at
/// the time of movement; hidden enemy state is not used here.
pub(crate) fn validate_bindings(
    binding: &NextRouteMatch,
    world: &WorldState,
    rules: &NextRules,
) -> Result<(), ApiError> {
    for command in &binding.commands {
        let actor = world.entities.get(&command.actor)
            .filter(|entity| entity.entity_type.as_str() == "hero"
                && entity.owner == Some(command.side) && support::alive(entity))
            .ok_or_else(|| api_error(ApiErrorCode::ValidationFailed, "route actor is missing, unowned, or not a living Hero"))?;
        let squad = support::string(actor, "squad");
        for (id, member) in &world.entities {
            if member.entity_type.as_str() != "hero" || member.owner != Some(command.side)
                || !support::alive(member)
                || if squad.is_empty() { id != &command.actor } else { support::string(member, "squad") != squad }
            {
                continue;
            }
            // An incumbent edge must be completed by existing movement rules;
            // plan subsequent segments from its endpoint without teleporting.
            let edge_to = support::string(member, "edge_to");
            let from = if edge_to.is_empty() { support::string(member, "node") } else { edge_to };
            let mut checked = BTreeSet::new();
            for node in command.waypoints.iter().chain(std::iter::once(&command.destination)) {
                // The validated Next graph is undirected, so every segment is
                // connected exactly when all its endpoints are in the start's
                // component. Repeated waypoints need only one graph search.
                if checked.insert(&node.0) && next_navigation::path(&rules.map, &from, &node.0).is_none() {
                    return Err(api_error(ApiErrorCode::ValidationFailed, "route waypoint sequence is not connected to its actor"));
                }
            }
        }
    }
    Ok(())
}

#[derive(Clone)]
struct ActiveRoute {
    command: NextRouteCommand,
    next_waypoint: usize,
}

/// Match-local private state, rebuilt deterministically from the frozen input
/// and actually committed orders. It is not part of a public replay.
pub(crate) struct Runtime {
    commands: BTreeMap<(CombatantSide, ActionId), NextRouteCommand>,
    active: BTreeMap<EntityId, ActiveRoute>,
    memberships: BTreeMap<EntityId, (CombatantSide, String)>,
}

impl Runtime {
    pub(crate) fn new(binding: &NextRouteMatch) -> Self {
        Self {
            commands: binding.commands.iter().map(|command| ((command.side, command.action_id.clone()), command.clone())).collect(),
            active: BTreeMap::new(),
            memberships: BTreeMap::new(),
        }
    }

    /// Observe the results of `next_tactics::apply`, not merely accepted
    /// candidates: a lost squad conflict must never activate a route. Existing
    /// move/pursue/retreat winners replace any previous route for their members.
    pub(crate) fn update_committed_orders(
        &mut self,
        orders: &[(CombatantSide, PresentationEvent)],
        accepted: &[(CombatantSide, Intent)],
        world: &WorldState,
    ) {
        self.reconcile_squads(world);
        for (side, event) in orders {
            let (Some(DomainValue::String(action)), Some(DomainValue::List(members)), Some(actor)) =
                (event.payload.get(&"action_id".into()), event.payload.get(&"members".into()), event.entity.as_ref()) else { continue };
            let Some((_, intent)) = accepted.iter().find(|(owner, intent)| *owner == *side && intent.action_id.as_str() == action && intent.actor.as_ref() == Some(actor)) else { continue };
            if !matches!(intent.capability.as_str(), "move" | "pursue" | "retreat") { continue; }
            let Some(actor_state) = world.entities.get(actor).filter(|entity| entity.owner == Some(*side) && entity.entity_type.as_str() == "hero" && support::alive(entity)) else { continue };
            let squad = support::string(actor_state, "squad");
            let command = self.commands.get(&(*side, intent.action_id.clone())).filter(|command| {
                command.actor == *actor && intent.capability.as_str() == "move"
                    && matches!(intent.arguments.get(1), Some(DomainValue::String(goal)) if goal == &command.destination.0)
            });
            for member in members {
                let DomainValue::Record(fields) = member else { continue };
                let Some(DomainValue::Entity(id)) = fields.get(&"entity".into()) else { continue };
                let Some(entity) = world.entities.get(id).filter(|entity| entity.owner == Some(*side) && entity.entity_type.as_str() == "hero" && support::alive(entity)) else { continue };
                if if squad.is_empty() { id != actor } else { support::string(entity, "squad") != squad } { continue; }
                match command {
                    Some(command) => {
                        // Repeated identical orders must not restart a route or
                        // force a completed actor back through its waypoints.
                        if !self.active.get(id).is_some_and(|active| active.command == *command) {
                            self.active.insert(id.clone(), ActiveRoute { command: command.clone(), next_waypoint: 0 });
                        }
                    }
                    None => { self.active.remove(id); }
                }
            }
        }
    }

    /// A merge adopts the target squad's goal in `next_squads`; its route
    /// choice must follow the same anchor even when both squads previously
    /// happened to have the same destination. A split keeps its own route.
    fn reconcile_squads(&mut self, world: &WorldState) {
        let mut current = BTreeMap::new();
        let mut groups = BTreeMap::<(CombatantSide, String), Vec<EntityId>>::new();
        for (id, entity) in &world.entities {
            let Some(side) = entity.owner else { continue };
            if entity.entity_type.as_str() != "hero" || !support::alive(entity) { continue; }
            let squad = support::string(entity, "squad");
            current.insert(id.clone(), (side, squad.clone()));
            if !squad.is_empty() { groups.entry((side, squad)).or_default().push(id.clone()); }
        }
        self.active.retain(|id, _| current.contains_key(id));
        for (group, members) in groups {
            let anchor = members.iter().find(|id| self.memberships.get(*id) == Some(&group));
            let Some(anchor) = anchor else { continue };
            let inherited = self.active.get(anchor).filter(|active| {
                world.entities.get(anchor).is_some_and(|entity| support::string(entity, "goal") == active.command.destination.0)
            }).cloned();
            for id in members.iter().filter(|id| self.memberships.get(*id).is_some_and(|old| old != &group)) {
                match &inherited {
                    Some(route) => { self.active.insert(id.clone(), route.clone()); }
                    None => { self.active.remove(id); }
                }
            }
        }
        self.memberships = current;
    }

    /// Return the next unmet waypoint. Progress is made only upon arriving at
    /// a node, never merely because it was an endpoint of an occupied edge.
    pub(crate) fn waypoint_for(&mut self, id: &EntityId, entity: &EntityState) -> Option<String> {
        let active = self.active.get_mut(id)?;
        if entity.owner != Some(active.command.side)
            || entity.entity_type.as_str() != "hero"
            || support::string(entity, "goal") != active.command.destination.0
        {
            self.active.remove(id);
            return None;
        }
        if support::string(entity, "edge_to").is_empty() {
            let node = support::string(entity, "node");
            while active.command.waypoints.get(active.next_waypoint).is_some_and(|point| point.0 == node) {
                active.next_waypoint += 1;
            }
        }
        active.command.waypoints.get(active.next_waypoint).map(|point| point.0.clone())
    }
}
