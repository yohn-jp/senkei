//! Next-rules minion lifecycle and fog-of-war projection.
//!
//! Observation names and exposed fields come from the validated RulePlan. This
//! module supplies the current visibility calculation used by those schemas.

use crate::{next_support as support, EvalContext};
use senkei_model::*;
use std::collections::BTreeMap;

pub use crate::next_fog::FogHistory;

/// Projects a side-authorized view and its replay-safe exploration history.
/// Hidden units leave no history. Previously observed facilities may retain
/// only their site, allowlisted state, and last-observed tick.
pub fn team_view_with_fog(
    world: &WorldState,
    rules: &NextRules,
    side: CombatantSide,
    tick: u32,
    history: &mut FogHistory,
) -> WorldStateView {
    #[cfg(feature = "lab-opt-visibility")]
    {
        // Both owner projection and Fog use the *same* S[t] visibility
        // sources. Rebuilding them or rescanning each target is unnecessary.
        let sources = vision_sources(world, rules, side);
        let mut view = team_view_indexed(world, rules, side, &sources);
        view.global_fields.insert(
            crate::next_fog::FOG_GLOBAL_FIELD.into(),
            history.observe_with_sources(world, rules, side, tick, &sources).as_domain_value(),
        );
        view
    }
    #[cfg(not(feature = "lab-opt-visibility"))]
    {
        let mut view = team_view(world, rules, side);
        view.global_fields.insert(
            crate::next_fog::FOG_GLOBAL_FIELD.into(),
            history.observe(world, rules, side, tick).as_domain_value(),
        );
        view
    }
}

const HERO: &str = "hero";
const MINION: &str = "minion";
const PUBLIC_FIELDS: &[&str] = &[
    "hp",
    "max_hp",
    "attack",
    "defense",
    "speed",
    "range",
    "attack_interval",
    "vision",
    "x",
    "y",
    "edge_to",
    "edge_progress",
    "track",
    "cross_remaining",
    "ford_remaining",
    "ford_active",
    "node",
    "lane",
    "catalog_id",
    "level",
    "formation",
    "maturity",
    "energy",
    "skills",
    "shield",
    "haste",
    "haste_until",
    "slow",
    "slow_until",
    "empower_until",
    "defense_bonus",
    "defense_until",
    "camp",
];
const MINION_PUBLIC_FIELDS: &[&str] = &["hp", "max_hp", "x", "y", "catalog_id", "lane", "node", "edge_to", "edge_progress", "track", "cross_remaining", "ford_remaining", "ford_active"];
const BRIDGE_PUBLIC_FIELDS: &[&str] = &["site", "bridge_state", "hp", "max_hp", "build_remaining", "build_kind", "x", "y", "node", "edge_to", "edge_progress"];
const OBSERVATION_PUBLIC_FIELDS: &[&str] = &["node", "capture_progress", "capture_owner", "capture_progress_side", "x", "y"];
const OWNER_ONLY_FIELDS: &[&str] = &[
    "xp",
    "cooldowns",
    "squad",
    "respawn_at",
    "slot_id",
    "skill_path",
    "attack_ready",
];

/// Advances minion waves and prepares their lane waypoint goals before the
/// same-tick observation snapshot.
pub fn lifecycle(world: &mut WorldState, rules: &NextRules, tick: u32) {
    expire_reveals(world, tick);
    remove_dead_minions(world, tick);

    let interval = support::param(rules, "minion_spawn_interval", 30).max(1) as u32;
    if tick % interval == 0 {
        spawn_wave(world, rules, tick);
    }

    let ids: Vec<_> = world
        .entities
        .iter()
        .filter(|(_, entity)| entity.entity_type == TypeId::from(MINION) && support::alive(entity))
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        let Some(entity) = world.entities.get(&id) else {
            continue;
        };
        let Some(side) = entity.owner else {
            continue;
        };
        let lane = support::string(entity, "lane");
        let current_goal = support::string(entity, "goal");
        let edge_to = support::string(entity, "edge_to");
        if !edge_to.is_empty() && !current_goal.is_empty() {
            continue;
        }
        let node = if edge_to.is_empty() {
            support::string(entity, "node")
        } else {
            edge_to
        };
        let Some(goal) = lane_waypoint(&rules.map, side, &lane, &node) else {
            continue;
        };
        if let Some(entity) = world.entities.get_mut(&id) {
            support::set_string(entity, "goal", goal);
        }
    }
}

/// Returns whether an entity is currently observable by `side`.
///
/// Friendly entities are always known to their owner. Enemy and neutral
/// entities require a living allied hero/minion vision source, or a
/// side-specific reveal effect whose expiration has been cleared by lifecycle.
pub fn visible(
    world: &WorldState,
    rules: &NextRules,
    side: CombatantSide,
    entity: &EntityState,
) -> bool {
    if entity.owner == Some(side) {
        return true;
    }
    let reveal_expiry = match side {
        CombatantSide::Attacker => support::int(entity, "reveal_attacker_until"),
        CombatantSide::Defender => support::int(entity, "reveal_defender_until"),
    };
    if reveal_expiry > 0 {
        return true;
    }
    world
        .entities
        .values()
        .any(|source| is_vision_source(source, side) && within_vision(source, entity, rules))
}

/// Whether a side can observe the whole logical node, without relying on a
/// facility-only reveal. Capture occupancy is defined at node granularity.
pub(crate) fn visible_node(world: &WorldState, rules: &NextRules, side: CombatantSide, node: &str) -> bool {
    let probe = EntityState {
        entity_type: "observation".into(),
        owner: None,
        fields: BTreeMap::from([
            ("node".into(), DomainValue::String(node.to_owned())),
            ("edge_to".into(), DomainValue::String(String::new())),
        ]),
    };
    visible(world, rules, side, &probe)
}

/// Builds exactly the allied vision-source set used by `visible`. Batch
/// presentation queries can reuse it without rescanning every world entity.
pub(crate) fn vision_sources<'a>(
    world: &'a WorldState,
    rules: &NextRules,
    side: CombatantSide,
) -> Vec<&'a EntityState> {
    let mut unique = BTreeMap::new();
    for source in world
        .entities
        .values()
        .filter(|source| is_vision_source(source, side))
    {
        let radius = vision_radius(source, rules);
        if radius < 0 {
            continue;
        }
        let track = if support::int(source, "cross_remaining") > 0 {
            "CENTER".into()
        } else {
            support::string(source, "track")
        };
        let key = (
            support::string(source, "node"),
            support::string(source, "edge_to"),
            support::int(source, "edge_progress"),
            track,
            radius,
        );
        unique.entry(key).or_insert(source);
    }
    unique.into_values().collect()
}

/// Applies the same owner/reveal/source test as `visible` using a previously
/// built source set. This is a presentation optimization, not another rule.
pub(crate) fn visible_from_sources(
    sources: &[&EntityState],
    rules: &NextRules,
    side: CombatantSide,
    entity: &EntityState,
) -> bool {
    if entity.owner == Some(side) {
        return true;
    }
    let reveal_expiry = match side {
        CombatantSide::Attacker => support::int(entity, "reveal_attacker_until"),
        CombatantSide::Defender => support::int(entity, "reveal_defender_until"),
    };
    reveal_expiry > 0 || sources.iter().any(|source| within_vision(source, entity, rules))
}

fn is_vision_source(entity: &EntityState, side: CombatantSide) -> bool {
    entity.owner == Some(side)
        && matches!(entity.entity_type.as_str(), HERO | MINION | "observation")
        && (entity.entity_type.as_str() == "observation" || support::alive(entity))
}

/// Whether a hero is inside any living friendly minion's vision. The result is
/// a boolean so overlapping minions apply the movement modifier only once.
pub fn minion_vision(world: &WorldState, rules: &NextRules, side: CombatantSide, entity: &EntityState) -> bool {
    if entity.entity_type != TypeId::from(HERO) {
        return false;
    }
    world.entities.values().any(|source| {
        source.entity_type == TypeId::from(MINION)
            && source.owner == Some(side)
            && support::alive(source)
            && within_radius(source, entity, support::int(source, "vision"), rules)
    })
}

/// Builds one side's same-tick observation strictly from the plan schema.
/// Hidden current enemy entities never enter an EnemyVisible collection, and
/// direct reads of hidden enemy entities return Unknown.
pub fn observation(
    world: &WorldState,
    plan: &RulePlan,
    side: CombatantSide,
    tick: u32,
) -> ObservationSnapshot {
    let projection_index = crate::world::ProjectionIndex::new();
    let mut fields = BTreeMap::new();
    for (path, schema) in &plan.domain.observation_fields {
        fields.insert(
            path.clone(),
            observation_field(schema, world, plan, side, tick, None, &projection_index),
        );
    }
    let mut collections = BTreeMap::new();
    for (id, schema) in &plan.domain.collections {
        collections.insert(
            id.clone(),
            collection_observation(schema, world, plan, side, tick, &projection_index),
        );
    }
    ObservationSnapshot {
        tick,
        side,
        fields,
        collections,
    }
}

/// Projects the public replay view visible to both teams at once. Owner-only
/// setup and tactical state such as XP and cooldowns is never projected.
pub fn public_view(world: &WorldState, rules: &NextRules) -> WorldStateView {
    #[cfg(feature = "lab-opt-visibility")]
    let attacker_sources = vision_sources(world, rules, CombatantSide::Attacker);
    #[cfg(feature = "lab-opt-visibility")]
    let defender_sources = vision_sources(world, rules, CombatantSide::Defender);
    let entities = world
        .entities
        .iter()
        .filter_map(|(id, entity)| {
            ({
                #[cfg(feature = "lab-opt-visibility")]
                { visible_from_sources(&attacker_sources, rules, CombatantSide::Attacker, entity)
                    && visible_from_sources(&defender_sources, rules, CombatantSide::Defender, entity) }
                #[cfg(not(feature = "lab-opt-visibility"))]
                { visible(world, rules, CombatantSide::Attacker, entity)
                    && visible(world, rules, CombatantSide::Defender, entity) }
            })
            .then(|| {
                let fields = projected_fields(entity, false, rules);
                (
                    id.clone(),
                    EntityStateView {
                        entity_type: entity.entity_type.clone(),
                        owner: entity.owner,
                        fields,
                    },
                )
            })
        })
        .collect();

    WorldStateView {
        entities,
        global_fields: BTreeMap::new(),
    }
}

/// Restrict the already visibility-filtered public Next view to the
/// exact allowlist authored by the verified RulePlan. This only narrows
/// exposure; it cannot make a hidden entity or field visible.
pub(crate) fn public_view_with_policy(
    world: &WorldState,
    rules: &NextRules,
    policy: &PresentationPolicy,
) -> WorldStateView {
    let mut view = public_view(world, rules);
    view.entities.retain(|_, entity| {
        let Some(allowed) = policy.visible_entity_fields.get(&entity.entity_type) else {
            return false;
        };
        entity.fields.retain(|field, _| allowed.contains(field));
        true
    });
    view.global_fields.retain(|field, _| policy.visible_global_fields.contains(field));
    view
}

/// Projects the current battlefield from one player's perspective. Owner-only
/// fields are added only for that side's own entities; hidden enemies remain
/// absent from the view.
pub fn team_view(world: &WorldState, rules: &NextRules, side: CombatantSide) -> WorldStateView {
    #[cfg(feature = "lab-opt-visibility")]
    {
        let sources = vision_sources(world, rules, side);
        team_view_indexed(world, rules, side, &sources)
    }
    #[cfg(not(feature = "lab-opt-visibility"))]
    {
        let entities = world
            .entities
            .iter()
            .filter_map(|(id, entity)| {
                visible(world, rules, side, entity).then(|| {
                    let fields = projected_fields(entity, entity.owner == Some(side), rules);
                    (
                        id.clone(),
                        EntityStateView {
                            entity_type: entity.entity_type.clone(),
                            owner: entity.owner,
                            fields,
                        },
                    )
                })
            })
            .collect();
        WorldStateView { entities, global_fields: BTreeMap::new() }
    }
}

#[cfg(feature = "lab-opt-visibility")]
fn team_view_indexed(
    world: &WorldState,
    rules: &NextRules,
    side: CombatantSide,
    sources: &[&EntityState],
) -> WorldStateView {
    let entities = world.entities.iter()
        .filter_map(|(id, entity)| {
            visible_from_sources(sources, rules, side, entity).then(|| {
                let fields = projected_fields(entity, entity.owner == Some(side), rules);
                (id.clone(), EntityStateView {
                    entity_type: entity.entity_type.clone(),
                    owner: entity.owner, fields,
                })
            })
        }).collect();
    WorldStateView { entities, global_fields: BTreeMap::new() }
}

fn projected_fields(
    entity: &EntityState,
    include_owner_only: bool,
    rules: &NextRules,
) -> BTreeMap<FieldId, DomainValue> {
    let public_fields = match entity.entity_type.as_str() {
        MINION => MINION_PUBLIC_FIELDS,
        "bridge" => BRIDGE_PUBLIC_FIELDS,
        "observation" => OBSERVATION_PUBLIC_FIELDS,
        _ => PUBLIC_FIELDS,
    };
    let mut fields: BTreeMap<_, _> = public_fields
        .iter()
        .filter_map(|name| {
            let field = FieldId::from(*name);
            entity
                .fields
                .get(&field)
                .cloned()
                .map(|value| (field, value))
        })
        .collect();
    if include_owner_only && entity.entity_type == TypeId::from(HERO) {
        fields.extend(OWNER_ONLY_FIELDS.iter().filter_map(|name| {
            let field = FieldId::from(*name);
            let value = if *name == "cooldowns" {
                project_cooldowns(entity, rules)
            } else {
                entity.fields.get(&field).cloned()
            };
            value.map(|value| (field, value))
        }));
    }
    fields
}

fn project_cooldowns(entity: &EntityState, rules: &NextRules) -> Option<DomainValue> {
    let catalog_id = support::string(entity, "catalog_id");
    let hero = rules.heroes.iter().find(|hero| hero.id == catalog_id)?;
    let DomainValue::Record(cooldowns) = entity.fields.get(&FieldId::from("cooldowns"))? else {
        return None;
    };
    let projected = hero
        .skills
        .iter()
        .take(4)
        .filter_map(|skill| {
            let id = FieldId::from(skill.id.as_str());
            cooldowns
                .get(&id)
                .cloned()
                .map(|ready_tick| (id, ready_tick))
        })
        .collect();
    Some(DomainValue::Record(projected))
}

fn remove_dead_minions(world: &mut WorldState, tick: u32) {
    let removed: std::collections::BTreeSet<_> = world
        .entities
        .iter()
        .filter_map(|(id, entity)| {
            let death_tick = match entity.fields.get(&FieldId::from("death_tick")) {
                Some(DomainValue::Integer(death_tick)) => *death_tick,
                _ => return None,
            };
            (entity.entity_type == TypeId::from(MINION)
                && support::int(entity, "hp") <= 0
                && death_tick < i64::from(tick))
            .then(|| id.clone())
        })
        .collect();
    if removed.is_empty() {
        return;
    }

    world.entities.retain(|id, _| !removed.contains(id));
    let target_field = FieldId::from("target");
    for entity in world.entities.values_mut() {
        if let Some(value) = entity.fields.get_mut(&target_field) {
            if matches!(value, DomainValue::Entity(target) if removed.contains(target)) {
                *value = DomainValue::Null;
            }
        }
    }
}

fn spawn_wave(world: &mut WorldState, rules: &NextRules, tick: u32) {
    for (lane, nodes) in &rules.map.lanes {
        for side in [CombatantSide::Attacker, CombatantSide::Defender] {
            let Some(start) = lane_endpoint(nodes, side) else {
                continue;
            };
            for (unit_index, definition) in rules.minions.iter().enumerate() {
                let id = EntityId::from(format!(
                    "minion:{}:{}:{}:{}:{}",
                    support::side_name(side),
                    lane,
                    tick,
                    unit_index,
                    definition.id,
                ));
                if world.entities.contains_key(&id) {
                    continue;
                }
                let mut entity = support::unit(MINION, Some(side), &definition.stats, start, rules);
                support::set_int(
                    &mut entity,
                    "vision",
                    rules
                        .parameters
                        .get("minion_vision")
                        .copied()
                        .unwrap_or(definition.stats.vision),
                );
                support::set_int(&mut entity, "xp_reward", definition.xp);
                support::set_string(&mut entity, "catalog_id", definition.id.clone());
                support::set_string(&mut entity, "lane", lane.clone());
                let goal = lane_waypoint(&rules.map, side, lane, start).unwrap_or_default();
                support::set_string(&mut entity, "goal", goal);
                world.entities.insert(id, entity);
            }
        }
    }
}

fn lane_endpoint<'a>(nodes: &'a [String], side: CombatantSide) -> Option<&'a str> {
    match side {
        CombatantSide::Attacker => nodes.first().map(String::as_str),
        CombatantSide::Defender => nodes.last().map(String::as_str),
    }
}

/// Selects the next node in the configured lane order, then the opposing base.
/// Minions therefore retain their lane and do not take a shorter jungle route.
pub(crate) fn lane_waypoint(map: &BattleMap, side: CombatantSide, lane: &str, node: &str) -> Option<String> {
    let nodes = map.lanes.get(lane)?;
    let index = nodes.iter().position(|candidate| candidate == node);
    let next = match (side, index) {
        (CombatantSide::Attacker, Some(index)) => nodes.get(index + 1),
        (CombatantSide::Defender, Some(index)) => index.checked_sub(1).and_then(|i| nodes.get(i)),
        _ => None,
    };
    if let Some(next) = next {
        return Some(next.clone());
    }
    let enemy_base = match side {
        CombatantSide::Attacker => &map.defender_base,
        CombatantSide::Defender => &map.attacker_base,
    };
    (node != enemy_base).then(|| enemy_base.clone())
}

fn expire_reveals(world: &mut WorldState, tick: u32) {
    for entity in world.entities.values_mut() {
        for field in [
            "reveal_attacker_until",
            "reveal_defender_until",
            "reveal_until",
        ] {
            let reveal_until = support::int(entity, field);
            if reveal_until > 0 && i64::from(tick) >= reveal_until {
                support::set_int(entity, field, 0);
            }
        }
    }
}

fn within_vision(source: &EntityState, target: &EntityState, rules: &NextRules) -> bool {
    let radius = vision_radius(source, rules);
    within_radius(source, target, radius, rules)
}

pub(crate) fn vision_radius(source: &EntityState, rules: &NextRules) -> i64 {
    if source.entity_type.as_str() == "observation" {
        rules.parameters.get("mid_observation_radius_wu").copied().unwrap_or(240)
    } else if source.entity_type == TypeId::from(MINION) {
        rules
            .parameters
            .get("minion_vision")
            .copied()
            .unwrap_or_else(|| support::int(source, "vision"))
    } else {
        support::int(source, "vision")
    }
}

fn within_radius(source: &EntityState, target: &EntityState, radius: i64, rules: &NextRules) -> bool {
    // Sight follows the versioned graph and logical position; projected x/y
    // never reveal an entity across an unconnected map location.
    radius >= 0 && crate::next_support::world_distance2(source, target, rules)
        .is_some_and(|distance2| distance2 <= i128::from(radius) * i128::from(radius))
}

fn collection_observation(
    schema: &CollectionSchema,
    world: &WorldState,
    plan: &RulePlan,
    side: CombatantSide,
    tick: u32,
    projection_index: &crate::world::ProjectionIndex,
) -> Observed<Vec<EntityObservation>> {
    if schema.visibility == Visibility::Internal {
        return Observed::Unknown;
    }
    let CollectionSource::WorldEntities {
        entity_types,
        owner,
        filter,
    } = &schema.source;
    let mut selected = Vec::new();
    for (id, entity) in &world.entities {
        if entity.entity_type != schema.element_type || !entity_types.contains(&entity.entity_type)
        {
            continue;
        }
        if !owner_matches(*owner, side, entity.owner) {
            continue;
        }
        if entity.owner != Some(side)
            && !plan
                .next
                .as_ref()
                .is_some_and(|rules| visible(world, rules, side, entity))
        {
            continue;
        }
        if !visibility_allows(
            schema.visibility,
            side,
            Some(entity),
            world,
            plan.next.as_ref(),
        ) {
            continue;
        }
        if let Some(filter) = filter {
            if !expression_is_currently_observable(
                filter,
                world,
                plan,
                side,
                tick,
                Some(id),
                projection_index,
            ) {
                return Observed::Unknown;
            }
            let context = EvalContext {
                side: Some(side),
                intent: None,
                observed_entity: Some(id),
                projection_index: Some(projection_index),
                tick,
            };
            match crate::eval_truth(filter, world, context) {
                Ok(Truth::True) => {}
                Ok(Truth::False) => continue,
                Ok(Truth::Unknown) | Err(_) => return Observed::Unknown,
            }
        }
        selected.push((id, entity));
    }
    if selected.len() > schema.max_items as usize
        || selected.len() > plan.domain.max_collection_items as usize
    {
        return Observed::Unknown;
    }
    selected.sort_by(|(a_id, a), (b_id, b)| compare_entities(a_id, a, b_id, b, &schema.order_by));
    let mut observations = Vec::with_capacity(selected.len());
    for (id, entity) in selected {
        let fields = schema
            .visible_fields
            .iter()
            .map(|(field, field_schema)| {
                let value = observation_field(
                    field_schema,
                    world,
                    plan,
                    side,
                    tick,
                    Some(id),
                    projection_index,
                );
                (field.clone(), value)
            })
            .collect();
        observations.push(EntityObservation {
            id: id.clone(),
            entity_type: entity.entity_type.clone(),
            fields,
        });
    }
    Observed::Known(observations)
}

fn observation_field(
    schema: &ObservationFieldSchema,
    world: &WorldState,
    plan: &RulePlan,
    side: CombatantSide,
    tick: u32,
    current_entity: Option<&EntityId>,
    projection_index: &crate::world::ProjectionIndex,
) -> Observed<DomainValue> {
    let value = match &schema.source {
        ObservationSource::Tick => {
            if !visibility_allows(schema.visibility, side, None, world, plan.next.as_ref()) {
                return Observed::Unknown;
            }
            Some(DomainValue::Integer(i64::from(tick)))
        }
        ObservationSource::WorldGlobalField { field } => {
            let Some(field_schema) = plan.world.global_fields.get(field) else {
                return Observed::Unknown;
            };
            if !visibility_allows(schema.visibility, side, None, world, plan.next.as_ref())
                || !visibility_allows(
                    field_schema.visibility,
                    side,
                    None,
                    world,
                    plan.next.as_ref(),
                )
            {
                return Observed::Unknown;
            }
            world.global_fields.get(field).cloned()
        }
        ObservationSource::WorldEntityField { entity, field } => {
            let Some(entity_id) =
                crate::world::resolve_world_entity(entity, Some(side), projection_index, world)
            else {
                return Observed::Unknown;
            };
            entity_field_value(&entity_id, field, schema, world, plan, side)
        }
        ObservationSource::CurrentEntityField { field } => {
            let Some(entity_id) = current_entity else {
                return Observed::Unknown;
            };
            entity_field_value(entity_id, field, schema, world, plan, side)
        }
        ObservationSource::Derived(expression) => {
            let target_entity = current_entity.and_then(|id| world.entities.get(id));
            if !visibility_allows(
                schema.visibility,
                side,
                target_entity,
                world,
                plan.next.as_ref(),
            ) {
                return Observed::Unknown;
            }
            if !expression_is_currently_observable(
                expression,
                world,
                plan,
                side,
                tick,
                current_entity,
                projection_index,
            ) {
                return Observed::Unknown;
            }
            let context = EvalContext {
                side: Some(side),
                intent: None,
                observed_entity: current_entity,
                projection_index: Some(projection_index),
                tick,
            };
            crate::eval_value(expression, world, context).ok().flatten()
        }
    };
    value.map_or(Observed::Unknown, Observed::Known)
}

fn expression_is_currently_observable(
    expression: &RuleExpression,
    world: &WorldState,
    plan: &RulePlan,
    side: CombatantSide,
    tick: u32,
    current_entity: Option<&EntityId>,
    projection_index: &crate::world::ProjectionIndex,
) -> bool {
    use RuleExpression as E;
    match expression {
        E::Literal(_) | E::CurrentTick | E::IntentArgument(_) => true,
        E::GlobalField(field) => plan.world.global_fields.get(field).is_some_and(|schema| {
            visibility_allows(schema.visibility, side, None, world, plan.next.as_ref())
        }),
        E::Field { target, field } => {
            let context = EvalContext {
                side: Some(side),
                intent: None,
                observed_entity: current_entity,
                projection_index: Some(projection_index),
                tick,
            };
            let Ok(id) =
                crate::world::resolve_entity_selector(target, context, projection_index, world)
            else {
                return false;
            };
            let Some(entity) = world.entities.get(&id) else {
                return false;
            };
            if entity.owner != Some(side)
                && !plan
                    .next
                    .as_ref()
                    .is_some_and(|rules| visible(world, rules, side, entity))
            {
                return false;
            }
            plan.world
                .entity_types
                .get(&entity.entity_type)
                .and_then(|schema| schema.fields.get(field))
                .is_some_and(|schema| {
                    visibility_allows(
                        schema.visibility,
                        side,
                        Some(entity),
                        world,
                        plan.next.as_ref(),
                    )
                })
        }
        E::AddInteger { left, right }
        | E::SubtractInteger { left, right }
        | E::AddFixed { left, right }
        | E::Equal { left, right }
        | E::LessThan { left, right } => {
            expression_is_currently_observable(
                left,
                world,
                plan,
                side,
                tick,
                current_entity,
                projection_index,
            ) && expression_is_currently_observable(
                right,
                world,
                plan,
                side,
                tick,
                current_entity,
                projection_index,
            )
        }
        E::And(items) | E::Or(items) => items.iter().all(|item| {
            expression_is_currently_observable(
                item,
                world,
                plan,
                side,
                tick,
                current_entity,
                projection_index,
            )
        }),
        E::Not(inner) => expression_is_currently_observable(
            inner,
            world,
            plan,
            side,
            tick,
            current_entity,
            projection_index,
        ),
    }
}

fn entity_field_value(
    entity_id: &EntityId,
    field: &FieldId,
    observation_schema: &ObservationFieldSchema,
    world: &WorldState,
    plan: &RulePlan,
    side: CombatantSide,
) -> Option<DomainValue> {
    let entity = world.entities.get(entity_id)?;
    if entity.owner != Some(side)
        && !plan
            .next
            .as_ref()
            .is_some_and(|rules| visible(world, rules, side, entity))
    {
        return None;
    }
    if !visibility_allows(
        observation_schema.visibility,
        side,
        Some(entity),
        world,
        plan.next.as_ref(),
    ) {
        return None;
    }
    let entity_schema = plan.world.entity_types.get(&entity.entity_type)?;
    let field_schema = entity_schema.fields.get(field)?;
    if !visibility_allows(
        field_schema.visibility,
        side,
        Some(entity),
        world,
        plan.next.as_ref(),
    ) {
        return None;
    }
    entity.fields.get(field).cloned()
}

fn visibility_allows(
    visibility: Visibility,
    side: CombatantSide,
    entity: Option<&EntityState>,
    world: &WorldState,
    rules: Option<&NextRules>,
) -> bool {
    match visibility {
        Visibility::Public => true,
        Visibility::OwningSide => entity.is_some_and(|entity| entity.owner == Some(side)),
        Visibility::EnemyVisible => entity.is_some_and(|entity| {
            entity.owner != Some(side)
                && rules.is_some_and(|rules| visible(world, rules, side, entity))
        }),
        Visibility::Internal => false,
    }
}

fn owner_matches(
    selector: EntityOwnerSelector,
    side: CombatantSide,
    owner: Option<CombatantSide>,
) -> bool {
    match selector {
        EntityOwnerSelector::Any => true,
        EntityOwnerSelector::OwnSide => owner == Some(side),
        EntityOwnerSelector::OtherSide => owner == Some(support::enemy(side)),
        EntityOwnerSelector::Unowned => owner.is_none(),
        EntityOwnerSelector::Attacker => owner == Some(CombatantSide::Attacker),
        EntityOwnerSelector::Defender => owner == Some(CombatantSide::Defender),
    }
}

fn compare_entities(
    a_id: &EntityId,
    a: &EntityState,
    b_id: &EntityId,
    b: &EntityState,
    order_by: &[FieldId],
) -> std::cmp::Ordering {
    for field in order_by {
        let order = match (a.fields.get(field), b.fields.get(field)) {
            (Some(a), Some(b)) => a.cmp(b),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        };
        if order != std::cmp::Ordering::Equal {
            return order;
        }
    }
    a_id.cmp(b_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    #[cfg(feature = "lab-opt-visibility")]
    #[test]
    fn deduplicated_vision_sources_match_original_predicate() {
        let rules = test_rules();
        let mut world = WorldState::default();
        let mut ally = hero(CombatantSide::Attacker, 0, 10);
        support::set_string(&mut ally, "node", "a0");
        support::set_string(&mut ally, "edge_to", "");
        let duplicate = ally.clone();
        let mut enemy = hero(CombatantSide::Defender, 20, 10);
        support::set_string(&mut enemy, "node", "d0");
        support::set_string(&mut enemy, "edge_to", "");
        world.entities.insert(EntityId::from("ally"), ally);
        world.entities.insert(EntityId::from("duplicate"), duplicate);
        world.entities.insert(EntityId::from("enemy"), enemy);
        for side in [CombatantSide::Attacker, CombatantSide::Defender] {
            let sources = vision_sources(&world, &rules, side);
            for entity in world.entities.values() {
                assert_eq!(
                    visible(&world, &rules, side, entity),
                    visible_from_sources(&sources, &rules, side, entity),
                    "batching must not change authorization",
                );
            }
        }
    }

    fn test_rules() -> NextRules {
        let nodes = BTreeMap::from([
            (
                "a0".to_string(),
                MapNode {
                    allegiance: "A".into(),
                    x: 0,
                    y: 0,
                    presentation_x: 0,
                    presentation_y: 0,
                    region: "lane".into(),
                },
            ),
            (
                "a1".to_string(),
                MapNode {
                    allegiance: "N".into(),
                    x: 10,
                    y: 0,
                    presentation_x: 10,
                    presentation_y: 0,
                    region: "lane".into(),
                },
            ),
            (
                "d0".to_string(),
                MapNode {
                    allegiance: "B".into(),
                    x: 20,
                    y: 0,
                    presentation_x: 20,
                    presentation_y: 0,
                    region: "lane".into(),
                },
            ),
        ]);
        NextRules {
            projection_policy: None,
            minion_control: None,
            mechanics_version: Version::new(1, 0, 0),
            world_identity: None,
            map: BattleMap {
                id: "test".into(),
                world_identity: None,
                world_projection: None,
                nodes,
                edges: vec![MapEdge { id: "a0-a1".into(), bridge_site: String::new(), ford: false,
                    from: "a0".into(), to: "a1".into(), length: 10,
                    region: "lane".into(), blocked: false }],
                lanes: BTreeMap::from([(
                    "top".into(),
                    vec!["a0".into(), "a1".into(), "d0".into()],
                )]),
                attacker_base: "a0".into(),
                defender_base: "d0".into(),
                towers: vec![],
            },
            heroes: vec![],
            minions: vec![UnitDefinition {
                id: "footman".into(),
                stats: UnitStats {
                    hp: 10,
                    attack: 2,
                    defense: 0,
                    speed: 1,
                    range: 1,
                    attack_interval: 1,
                    vision: 4,
                },
                xp: 7,
            }],
            monsters: vec![],
            camps: vec![],
            parameters: BTreeMap::from([
                ("minion_spawn_interval".into(), 2),
                ("minion_vision".into(), 5),
            ]),
        }
    }

    fn hero(owner: CombatantSide, x: i64, hp: i64) -> EntityState {
        let mut entity = EntityState {
            entity_type: HERO.into(),
            owner: Some(owner),
            fields: BTreeMap::new(),
        };
        for (field, value) in [("hp", hp), ("vision", 3), ("x", x), ("y", 0), ("xp", 77)] {
            support::set_int(&mut entity, field, value);
        }
        support::set_string(&mut entity, "node", "a0");
        support::set_string(&mut entity, "squad", "alpha");
        support::set_string(&mut entity, "slot_id", "slot-1");
        support::set_string(&mut entity, "skill_path", "vanguard");
        support::set_int(&mut entity, "respawn_at", 12);
        entity.fields.insert(
            "cooldowns".into(),
            DomainValue::Record(BTreeMap::from([("dash".into(), DomainValue::Integer(4))])),
        );
        entity
    }

    fn hero_definition() -> HeroDefinition {
        let stats = UnitStats {
            hp: 10,
            attack: 2,
            defense: 0,
            speed: 1,
            range: 1,
            attack_interval: 1,
            vision: 4,
        };
        HeroDefinition {
            id: "test-catalog".into(),
            name: "Test Hero".into(),
            placement: "any".into(),
            role: "fighter".into(),
            trait_id: "test".into(),
            appearance_key: "test".into(),
            stats: stats.clone(),
            growth: stats,
            skills: (0..4)
                .map(|index| SkillDefinition {
                    id: format!("test_skill_{index}"),
                    name: format!("Test Skill {index}"),
                    passive: false,
                    unlock_level: 1,
                    prerequisites: vec![],
                    cooldown: 1,
                    cost: 0,
                    range: 1,
                    target: "enemy".into(),
                    effect: SkillEffect::Damage,
                    power: 1,
                    duration: 0,
                })
                .collect(),
            skill_paths: BTreeMap::new(),
            synergy: BTreeMap::new(),
        }
    }

    fn empty_plan() -> RulePlan {
        RulePlan {
            next: Some(test_rules()),
            catalog_semantics_digest: None,
            minimum_engine_version: Version::new(1, 0, 0),
            model_version: Version::new(1, 0, 0),
            primitive_set_id: PrimitiveSetId::from("test"),
            primitive_set_version: Version::new(1, 0, 0),
            jinrei_language_version: Version::new(1, 0, 0),
            structured_ast_version: Version::new(1, 0, 0),
            typed_ir_version: Version::new(1, 0, 0),
            bytecode_version: Version::new(1, 0, 0),
            domain: DomainSchema {
                schema_version: Version::new(1, 0, 0),
                senkei_configuration: BTreeMap::new(),
                observation_fields: BTreeMap::new(),
                collections: BTreeMap::new(),
                capabilities: BTreeMap::new(),
                tactical_memory: BTreeMap::new(),
                symbol_domains: BTreeMap::new(),
                max_expression_depth: 32,
                max_collection_items: 32,
            },
            world_initialization: WorldInitialization {
                entities: vec![],
                global_fields: BTreeMap::new(),
                collections: BTreeMap::new(),
            },
            world: WorldSchema {
                entity_types: BTreeMap::new(),
                global_fields: BTreeMap::new(),
                collections: BTreeMap::new(),
                max_entities: 100,
            },
            phases: vec![],
            required_primitives: BTreeSet::new(),
            transitions: vec![],
            arbitration: BTreeMap::new(),
            actor_intent_orders: Vec::new(),
            termination: TerminationPolicy {
                max_ticks: 10,
                conditions: vec![],
                on_timeout: MatchOutcome::Draw,
                on_timeout_reason: "timeout".into(),
            },
            cost_schedule: CostSchedule {
                id: CostScheduleId::from("test"),
                version: Version::new(1, 0, 0),
                operations: BTreeMap::new(),
                per_tick_budget: LogicalCu::ZERO,
                per_match_budget: LogicalCu::ZERO,
                overrun_policy: BudgetOverrunPolicy::AbortMatch,
                memory_commit_policy: MemoryCommitPolicy::OnCompletedEvaluation,
                budget_overrun_reason: "overrun".into(),
            },
            presentation: PresentationPolicy {
                visible_events: BTreeMap::new(),
                visible_entity_fields: BTreeMap::new(),
                visible_global_fields: BTreeSet::new(),
            },
            limits: RuleLimits {
                max_input_bytes: 0,
                max_entities: 100,
                max_events: 0,
                max_diagnostic_events: 0,
                max_output_bytes: 0,
                max_intents_per_side_per_tick: 0,
                max_value_depth: 32,
            },
        }
    }

    #[test]
    fn spawns_initial_and_scheduled_waves_with_lane_goals() {
        let rules = test_rules();
        let mut world = WorldState::default();
        lifecycle(&mut world, &rules, 0);
        assert_eq!(world.entities.len(), 2);
        let attacker = world
            .entities
            .values()
            .find(|entity| entity.owner == Some(CombatantSide::Attacker))
            .unwrap();
        assert_eq!(support::string(attacker, "node"), "a0");
        assert_eq!(support::string(attacker, "goal"), "a1");
        assert_eq!(support::int(attacker, "xp_reward"), 7);
        let defender = world
            .entities
            .values()
            .find(|entity| entity.owner == Some(CombatantSide::Defender))
            .unwrap();
        assert_eq!(support::string(defender, "node"), "d0");
        assert_eq!(support::string(defender, "goal"), "a1");
        lifecycle(&mut world, &rules, 1);
        assert_eq!(world.entities.len(), 2);
        lifecycle(&mut world, &rules, 2);
        assert_eq!(world.entities.len(), 4);
    }

    #[test]
    fn minion_vision_is_shared_living_and_nonstacking() {
        let rules = test_rules();
        let mut world = WorldState::default();
        let mut target = hero(CombatantSide::Attacker, 4, 10);
        let mut minion = support::unit(
            MINION,
            Some(CombatantSide::Attacker),
            &rules.minions[0].stats,
            "a0",
            &rules,
        );
        support::set_int(&mut minion, "vision", 5);
        world.entities.insert("minion-one".into(), minion.clone());
        world.entities.insert("minion-two".into(), minion);
        assert!(minion_vision(&world, &rules, CombatantSide::Attacker, &target));
        assert!(!minion_vision(&world, &rules, CombatantSide::Defender, &target));
        // Changing render coordinates cannot change whether the same logical
        // node is visible; a graph position beyond the radius can.
        target.fields.insert("x".into(), DomainValue::Integer(11_000));
        assert!(minion_vision(&world, &rules, CombatantSide::Attacker, &target));
        support::set_string(&mut target, "node", "a1");
        assert!(!minion_vision(&world, &rules, CombatantSide::Attacker, &target));
        if let Some(dead) = world.entities.get_mut(&EntityId::from("minion-one")) {
            support::set_int(dead, "hp", 0);
        }
        if let Some(dead) = world.entities.get_mut(&EntityId::from("minion-two")) {
            support::set_int(dead, "hp", 0);
        }
        assert!(!minion_vision(&world, &rules, CombatantSide::Attacker, &target));
    }

    #[test]
    fn observation_uses_schema_and_hidden_enemy_fields_are_unknown() {
        let mut plan = empty_plan();
        let hp: FieldId = "hp".into();
        let enemy_collection: CollectionId = "enemies.visible_heroes".into();
        let mut visible_fields = BTreeMap::new();
        visible_fields.insert(
            hp.clone(),
            ObservationFieldSchema {
                value_type: DomainType::Integer {
                    min: None,
                    max: None,
                },
                visibility: Visibility::EnemyVisible,
                source: ObservationSource::CurrentEntityField { field: hp.clone() },
            },
        );
        plan.domain.collections.insert(
            enemy_collection.clone(),
            CollectionSchema {
                element_type: HERO.into(),
                max_items: 16,
                visibility: Visibility::EnemyVisible,
                source: CollectionSource::WorldEntities {
                    entity_types: BTreeSet::from([HERO.into()]),
                    owner: EntityOwnerSelector::OtherSide,
                    filter: None,
                },
                visible_fields,
                order_by: vec![],
                unique_keys: BTreeSet::from([CollectionUniqueKey::EntityId]),
            },
        );
        plan.world.entity_types.insert(
            HERO.into(),
            EntityTypeSchema {
                default_owner: None,
                fields: BTreeMap::from([(
                    hp.clone(),
                    FieldSchema {
                        value_type: DomainType::Integer {
                            min: None,
                            max: None,
                        },
                        visibility: Visibility::EnemyVisible,
                        writable: false,
                    },
                )]),
            },
        );
        plan.domain.observation_fields.insert(
            "enemy.hp".into(),
            ObservationFieldSchema {
                value_type: DomainType::Integer {
                    min: None,
                    max: None,
                },
                visibility: Visibility::EnemyVisible,
                source: ObservationSource::WorldEntityField {
                    entity: WorldEntitySelector::Fixed("hidden".into()),
                    field: hp.clone(),
                },
            },
        );
        let mut world = WorldState::default();
        world
            .entities
            .insert("ally".into(), hero(CombatantSide::Attacker, 0, 10));
        let mut hidden = hero(CombatantSide::Defender, 2, 10);
        support::set_string(&mut hidden, "edge_to", "a1");
        support::set_int(&mut hidden, "edge_progress", 8);
        world.entities.insert("hidden".into(), hidden);
        let snap = observation(&world, &plan, CombatantSide::Attacker, 0);
        assert_eq!(snap.collections[&enemy_collection], Observed::Known(vec![]));
        assert_eq!(
            snap.fields[&ObservationPath::from("enemy.hp")],
            Observed::Unknown
        );
        if let Some(hidden) = world.entities.get_mut(&EntityId::from("hidden")) {
            // Render coordinates can move inside the ally's drawn radius while
            // logical distance still keeps this enemy hidden.
            support::set_int(hidden, "x", 0);
        }
        let snap = observation(&world, &plan, CombatantSide::Attacker, 0);
        assert_eq!(snap.collections[&enemy_collection], Observed::Known(vec![]));
        assert_eq!(snap.fields[&ObservationPath::from("enemy.hp")], Observed::Unknown);
        if let Some(hidden) = world.entities.get_mut(&EntityId::from("hidden")) {
            support::set_int(hidden, "x", 10_000);
            support::set_int(hidden, "edge_progress", 2);
        }
        let snap = observation(&world, &plan, CombatantSide::Attacker, 0);
        let Observed::Known(enemies) = &snap.collections[&enemy_collection] else {
            panic!("visible collection should be known");
        };
        assert_eq!(enemies.len(), 1);
        assert_eq!(enemies[0].id, EntityId::from("hidden"));
        assert_eq!(
            enemies[0].fields[&hp],
            Observed::Known(DomainValue::Integer(10))
        );
        assert_eq!(
            snap.fields[&ObservationPath::from("enemy.hp")],
            Observed::Known(DomainValue::Integer(10))
        );
    }

    #[test]
    fn public_view_is_team_intersection_and_omits_private_fields() {
        let mut rules = test_rules();
        rules.parameters.insert("minion_vision".into(), 1);
        let mut world = WorldState::default();
        let mut ally = hero(CombatantSide::Attacker, -3, 10);
        support::set_string(&mut ally, "node", "d0");
        world.entities.insert("ally-hero".into(), ally);
        let mut enemy = hero(CombatantSide::Defender, 50, 10);
        support::set_string(&mut enemy, "node", "a1");
        world.entities.insert("enemy-hero".into(), enemy);
        let mut scout = hero(CombatantSide::Defender, 3, 10);
        support::set_string(&mut scout, "edge_to", "a1");
        support::set_int(&mut scout, "edge_progress", 1);
        world.entities.insert("enemy-scout".into(), scout);
        let mut minion = support::unit(
            MINION,
            Some(CombatantSide::Attacker),
            &rules.minions[0].stats,
            "a0",
            &rules,
        );
        support::set_int(&mut minion, "x", 0);
        support::set_int(&mut minion, "xp", 99);
        support::set_string(&mut minion, "goal", "d0");
        support::set_string(&mut minion, "edge_to", "a1");
        support::set_int(&mut minion, "edge_progress", 1);
        support::set_string(&mut minion, "track", "CENTER");
        support::set_int(&mut minion, "cross_remaining", 0);
        support::set_int(&mut minion, "ford_remaining", 0);
        support::set_int(&mut minion, "ford_active", 0);
        support::set_string(&mut minion, "catalog_id", "footman");
        support::set_string(&mut minion, "lane", "top");
        minion.fields.insert(
            "skills".into(),
            DomainValue::List(vec![DomainValue::String("dash".into())]),
        );
        world.entities.insert("seen-by-both".into(), minion);
        let view = public_view(&world, &rules);
        let restricted = public_view_with_policy(&world, &rules, &PresentationPolicy {
            visible_events: BTreeMap::new(),
            visible_entity_fields: BTreeMap::from([(
                TypeId::from(MINION),
                BTreeSet::from([FieldId::from("hp")]),
            )]),
            visible_global_fields: BTreeSet::new(),
        });
        assert_eq!(restricted.entities.len(), 1);
        let restricted_minion = &restricted.entities[&EntityId::from("seen-by-both")];
        assert_eq!(restricted_minion.fields.len(), 1);
        assert_eq!(restricted_minion.fields[&FieldId::from("hp")], DomainValue::Integer(10));
        assert!(!restricted_minion.fields.contains_key(&FieldId::from("catalog_id")));
        assert!(!view.entities.contains_key(&EntityId::from("ally-hero")));
        assert!(!view.entities.contains_key(&EntityId::from("enemy-hero")));
        let minion = &view.entities[&EntityId::from("seen-by-both")];
        assert_eq!(minion.fields[&FieldId::from("x")], DomainValue::Integer(0));
        assert_eq!(minion.fields.len(), MINION_PUBLIC_FIELDS.len());
        assert_eq!(
            minion.fields[&FieldId::from("catalog_id")],
            DomainValue::String("footman".into())
        );
        assert_eq!(
            minion.fields[&FieldId::from("lane")],
            DomainValue::String("top".into())
        );
        assert!(!minion.fields.contains_key(&FieldId::from("xp")));
        assert!(!minion.fields.contains_key(&FieldId::from("goal")));
        assert_eq!(minion.fields[&FieldId::from("edge_to")], DomainValue::String("a1".into()));
        assert!(!minion.fields.contains_key(&FieldId::from("skills")));
    }

    #[test]
    fn team_view_keeps_owned_fields_and_hides_unseen_enemies() {
        let mut rules = test_rules();
        let definition = hero_definition();
        let cooldowns = definition
            .skills
            .iter()
            .enumerate()
            .map(|(index, skill)| {
                (
                    FieldId::from(skill.id.as_str()),
                    DomainValue::Integer(index as i64 + 1),
                )
            })
            .chain([("foreign_skill".into(), DomainValue::Integer(99))])
            .collect();
        rules.heroes.push(definition);
        let mut world = WorldState::default();
        let mut ally = hero(CombatantSide::Attacker, 0, 10);
        support::set_string(&mut ally, "catalog_id", "test-catalog");
        ally.fields
            .insert("cooldowns".into(), DomainValue::Record(cooldowns));
        world.entities.insert("ally-hero".into(), ally);
        let mut hidden_enemy = hero(CombatantSide::Defender, 2, 10);
        support::set_string(&mut hidden_enemy, "edge_to", "a1");
        support::set_int(&mut hidden_enemy, "edge_progress", 8);
        world.entities.insert("hidden-enemy".into(), hidden_enemy);

        let local = team_view(&world, &rules, CombatantSide::Attacker);
        assert!(local.entities.contains_key(&EntityId::from("ally-hero")));
        assert!(!local.entities.contains_key(&EntityId::from("hidden-enemy")));
        if let Some(hidden) = world.entities.get_mut(&EntityId::from("hidden-enemy")) {
            support::set_int(hidden, "x", 0);
        }
        let local = team_view(&world, &rules, CombatantSide::Attacker);
        assert!(!local.entities.contains_key(&EntityId::from("hidden-enemy")));
        if let Some(hidden) = world.entities.get_mut(&EntityId::from("hidden-enemy")) {
            support::set_int(hidden, "x", 10_000);
            support::set_int(hidden, "edge_progress", 2);
        }
        let local = team_view(&world, &rules, CombatantSide::Attacker);
        assert!(local.entities.contains_key(&EntityId::from("hidden-enemy")));
        support::set_int(world.entities.get_mut(&EntityId::from("hidden-enemy")).unwrap(), "edge_progress", 8);
        let own = &local.entities[&EntityId::from("ally-hero")].fields;
        assert_eq!(own[&FieldId::from("xp")], DomainValue::Integer(77));
        assert_eq!(
            own[&FieldId::from("squad")],
            DomainValue::String("alpha".into())
        );
        assert_eq!(own[&FieldId::from("respawn_at")], DomainValue::Integer(12));
        let DomainValue::Record(own_cooldowns) = &own[&FieldId::from("cooldowns")] else {
            panic!("projected owner cooldowns should remain a record");
        };
        assert_eq!(own_cooldowns.len(), 4);
        assert!(!own_cooldowns.contains_key(&FieldId::from("foreign_skill")));

        let public = public_view(&world, &rules);
        assert!(public.entities.is_empty());
        assert!(!public.entities.contains_key(&EntityId::from("ally-hero")));
    }

    #[test]
    fn lifecycle_keeps_current_tick_deaths_then_clears_removed_targets() {
        let mut rules = test_rules();
        rules.parameters.insert("minion_spawn_interval".into(), 100);
        let dead_id = EntityId::from("fallen-minion");
        let mut dead = support::unit(
            MINION,
            Some(CombatantSide::Attacker),
            &rules.minions[0].stats,
            "a0",
            &rules,
        );
        support::set_int(&mut dead, "hp", 0);
        support::set_int(&mut dead, "death_tick", 2);
        let mut ally = hero(CombatantSide::Attacker, 0, 10);
        ally.fields
            .insert("target".into(), DomainValue::Entity(dead_id.clone()));
        let mut dead_hero = hero(CombatantSide::Attacker, 1, 0);
        support::set_int(&mut dead_hero, "death_tick", 1);

        let mut world = WorldState::default();
        world.entities.insert(dead_id.clone(), dead);
        world.entities.insert("ally".into(), ally);
        world.entities.insert("dead-hero".into(), dead_hero);

        lifecycle(&mut world, &rules, 2);
        assert!(world.entities.contains_key(&dead_id));
        assert_eq!(
            team_view(&world, &rules, CombatantSide::Attacker).entities[&dead_id].fields
                [&FieldId::from("hp")],
            DomainValue::Integer(0)
        );
        assert_eq!(
            world.entities[&EntityId::from("ally")].fields[&FieldId::from("target")],
            DomainValue::Entity(dead_id.clone())
        );

        lifecycle(&mut world, &rules, 3);
        assert!(!world.entities.contains_key(&dead_id));
        assert_eq!(
            world.entities[&EntityId::from("ally")].fields[&FieldId::from("target")],
            DomainValue::Null
        );
        assert!(world.entities.contains_key(&EntityId::from("dead-hero")));
    }

    #[test]
    fn reveal_expiry_is_applied_before_the_next_snapshot() {
        let rules = test_rules();
        let mut world = WorldState::default();
        let mut hidden = hero(CombatantSide::Defender, 50, 10);
        hidden.owner = None;
        support::set_int(&mut hidden, "reveal_attacker_until", 3);
        world.entities.insert("hidden".into(), hidden);
        assert!(visible(
            &world,
            &rules,
            CombatantSide::Attacker,
            &world.entities[&EntityId::from("hidden")]
        ));
        assert!(!visible(
            &world,
            &rules,
            CombatantSide::Defender,
            &world.entities[&EntityId::from("hidden")]
        ));
        lifecycle(&mut world, &rules, 3);
        assert!(!visible(
            &world,
            &rules,
            CombatantSide::Attacker,
            &world.entities[&EntityId::from("hidden")]
        ));
    }
}
