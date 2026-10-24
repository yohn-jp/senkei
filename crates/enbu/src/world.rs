use crate::{api_error, EvalContext};
use senkei_model::{
    ApiError, ApiErrorCode, CombatantSide, CollectionSchema,
    CollectionSource, ContentDigest, DomainValue, EntityId, EntityObservation,
    EntityOwnerProjection, EntityOwnerSelector, EntityProjection, EntityProjectionSource,
    EntityState, EntityStateView, FieldId, ObservationFieldSchema,
    ObservationSnapshot, ObservationSource, Observed, PresentationEvent, ProjectionId,
    ProjectionSides, ProjectionValue, RulePlan, Visibility, WorldEntitySelector,
    WorldState, WorldStateView,
};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct ProjectionKey {
    pub projection_id: ProjectionId,
    pub entity_type: senkei_model::TypeId,
    pub owner: Option<CombatantSide>,
    pub key: DomainValue,
}

pub(crate) type ProjectionIndex = BTreeMap<ProjectionKey, EntityId>;

pub(crate) fn initialize(
    base: &WorldState,
    attacker: &senkei_model::SenkeiSnapshot,
    defender: &senkei_model::SenkeiSnapshot,
    plan: &RulePlan,
    ruleset_digest: &ContentDigest,
    entity_limit: u32,
) -> Result<(WorldState, ProjectionIndex), ApiError> {
    let mut world = base.clone();
    let mut projection_index = ProjectionIndex::new();

    for (field, value) in &plan.world_initialization.global_fields {
        if world.global_fields.contains_key(field) {
            return Err(conflict(format!("initial global field `{field}` is already populated")));
        }
        world.global_fields.insert(field.clone(), value.clone());
    }
    for (collection, values) in &plan.world_initialization.collections {
        if world.collections.contains_key(collection) {
            return Err(conflict(format!("initial collection `{collection}` is already populated")));
        }
        world.collections.insert(collection.clone(), values.clone());
    }

    for projection in &plan.world_initialization.entities {
        let mut projected = Vec::new();
        for side in projection_sides(projection.applies_to) {
            let snapshot = match side {
                CombatantSide::Attacker => attacker,
                CombatantSide::Defender => defender,
            };
            for item in source_items(projection, snapshot, plan)? {
                let owner = resolve_projection_owner(projection.owner, *side);
                let (entity_id, key) = projected_id(projection, snapshot, plan, item.as_ref(), owner, ruleset_digest)?;
                let mut fields = BTreeMap::new();
                for (field, value) in &projection.fields {
                    fields.insert(field.clone(), project_value(value, snapshot, plan, item.as_ref(), *side)?);
                }
                projected.push((
                    entity_id,
                    key,
                    EntityState { entity_type: projection.entity_type.clone(), owner, fields },
                ));
            }
        }
        projected.sort_by(|a, b| a.0.cmp(&b.0));
        for (entity_id, key, entity) in projected {
            if world.entities.contains_key(&entity_id) {
                return Err(conflict(format!("projected entity ID `{entity_id}` is already present")));
            }
            if let Some(key) = key {
                if projection_index.insert(key, entity_id.clone()).is_some() {
                    return Err(conflict("projection key maps to more than one entity"));
                }
            }
            world.entities.insert(entity_id, entity);
            if world.entities.len() > entity_limit as usize {
                return Err(api_error(ApiErrorCode::ResourceLimit, "projected initial world exceeds the entity limit"));
            }
        }
    }
    Ok((world, projection_index))
}

fn projection_sides(sides: ProjectionSides) -> &'static [CombatantSide] {
    use CombatantSide::{Attacker, Defender};
    match sides {
        ProjectionSides::Both => &[Attacker, Defender],
        ProjectionSides::AttackerOnly => &[Attacker],
        ProjectionSides::DefenderOnly => &[Defender],
    }
}

fn source_items<'a>(
    projection: &EntityProjection,
    snapshot: &'a senkei_model::SenkeiSnapshot,
    plan: &RulePlan,
) -> Result<Vec<Option<DomainValue>>, ApiError> {
    match &projection.source {
        EntityProjectionSource::Singleton => Ok(vec![None]),
        EntityProjectionSource::EachConfigurationItem { field } => {
            let Some(value) = configuration_value(snapshot, plan, field) else { return Ok(Vec::new()); };
            let DomainValue::List(items) = value else {
                return Err(api_error(ApiErrorCode::InvalidSnapshot, format!("projection source field `{field}` must be a list")));
            };
            let max_items = plan.domain.max_collection_items.min(plan.limits.max_entities);
            if items.len() > max_items as usize {
                return Err(api_error(ApiErrorCode::ResourceLimit, format!("projection source `{field}` exceeds its item limit")));
            }
            Ok(items.iter().cloned().map(Some).collect())
        }
    }
}

fn projected_id(
    projection: &EntityProjection,
    snapshot: &senkei_model::SenkeiSnapshot,
    plan: &RulePlan,
    item: Option<&DomainValue>,
    owner: Option<CombatantSide>,
    ruleset_digest: &ContentDigest,
) -> Result<(EntityId, Option<ProjectionKey>), ApiError> {
    use senkei_model::EntityIdProjection as I;
    let key = match &projection.entity_id {
        I::Fixed(id) => return Ok((id.clone(), None)),
        I::ConstantKey(key) => DomainValue::String(key.clone()),
        I::ConfigurationKey { root, path } => {
            configuration_path(snapshot, plan, root, path).cloned().ok_or_else(|| api_error(ApiErrorCode::InvalidSnapshot, "entity ID configuration key is missing"))?
        }
        I::ConfigurationItemKey { path } => {
            item_path(item, path).cloned().ok_or_else(|| api_error(ApiErrorCode::InvalidSnapshot, "entity ID item key is missing"))?
        }
    };
    let entity_id = senkei_model::derive_projected_entity_id(
        ruleset_digest,
        &projection.projection_id,
        &projection.entity_type,
        owner,
        &key,
    )?;
    Ok((entity_id, Some(ProjectionKey {
        projection_id: projection.projection_id.clone(),
        entity_type: projection.entity_type.clone(),
        owner,
        key,
    })))
}

fn project_value(
    projection: &ProjectionValue,
    snapshot: &senkei_model::SenkeiSnapshot,
    plan: &RulePlan,
    item: Option<&DomainValue>,
    side: CombatantSide,
) -> Result<DomainValue, ApiError> {
    match projection {
        ProjectionValue::Constant(value) => Ok(value.clone()),
        ProjectionValue::ConfigurationPath { root, path } => configuration_path(snapshot, plan, root, path)
            .cloned().ok_or_else(|| api_error(ApiErrorCode::InvalidSnapshot, "configuration projection value is missing")),
        ProjectionValue::ConfigurationItemPath { path } => item_path(item, path)
            .cloned().ok_or_else(|| api_error(ApiErrorCode::InvalidSnapshot, "configuration item projection value is missing")),
        ProjectionValue::SnapshotSide => Ok(DomainValue::Enum(side_symbol(side))),
    }
}

fn configuration_value<'a>(
    snapshot: &'a senkei_model::SenkeiSnapshot,
    plan: &'a RulePlan,
    field: &FieldId,
) -> Option<&'a DomainValue> {
    snapshot.configuration.get(field).or_else(|| plan.domain.senkei_configuration.get(field).and_then(|schema| schema.default.as_ref()))
}

fn configuration_path<'a>(
    snapshot: &'a senkei_model::SenkeiSnapshot,
    plan: &'a RulePlan,
    root: &FieldId,
    path: &[FieldId],
) -> Option<&'a DomainValue> {
    let mut value = snapshot.configuration.get(root)
        .or_else(|| plan.domain.senkei_configuration.get(root).and_then(|schema| schema.default.as_ref()))?;
    for field in path { value = match value { DomainValue::Record(fields) => fields.get(field)?, _ => return None }; }
    Some(value)
}

fn item_path<'a>(item: Option<&'a DomainValue>, path: &[FieldId]) -> Option<&'a DomainValue> {
    let mut value = item?;
    for field in path { value = match value { DomainValue::Record(fields) => fields.get(field)?, _ => return None }; }
    Some(value)
}

fn resolve_projection_owner(owner: EntityOwnerProjection, side: CombatantSide) -> Option<CombatantSide> {
    match owner {
        EntityOwnerProjection::Unowned => None,
        EntityOwnerProjection::Fixed(owner) => Some(owner),
        EntityOwnerProjection::SnapshotSide => Some(side),
    }
}

pub(crate) fn resolve_world_entity(
    selector: &WorldEntitySelector,
    side: Option<CombatantSide>,
    index: &ProjectionIndex,
    world: &WorldState,
) -> Option<EntityId> {
    match selector {
        WorldEntitySelector::Fixed(id) => world.entities.contains_key(id).then(|| id.clone()),
        WorldEntitySelector::ByProjectionKey { projection_id, entity_type, owner, key } => {
            let matches = index.iter().filter(|(projected, entity_id)| {
                projected.projection_id == *projection_id
                    && projected.entity_type == *entity_type
                    && projected.key == *key
                    && owner_matches(*owner, side, projected.owner)
                    && world.entities.contains_key(*entity_id)
            }).map(|(_, id)| id.clone()).collect::<Vec<_>>();
            (matches.len() == 1).then(|| matches[0].clone())
        }
    }
}

pub(crate) fn resolve_entity_selector(
    selector: &senkei_model::EntitySelector,
    context: EvalContext<'_>,
    projection_index: &ProjectionIndex,
    world: &WorldState,
) -> Result<EntityId, ApiError> {
    use senkei_model::EntitySelector as S;
    match selector {
        S::IntentActor => context.intent.and_then(|intent| intent.actor.clone()),
        S::IntentTarget => context.intent.and_then(|intent| intent.target.clone()),
        S::ByIntentArgument(index) => context.intent
            .and_then(|intent| intent.arguments.get(*index as usize))
            .and_then(|value| match value { DomainValue::Entity(id) => Some(id.clone()), _ => None }),
        S::ObservedEntity => context.observed_entity.cloned(),
        S::Fixed(id) => Some(id.clone()),
        S::ByProjectionKey { projection_id, entity_type, owner, key } => {
            let selector = WorldEntitySelector::ByProjectionKey {
                projection_id: projection_id.clone(),
                entity_type: entity_type.clone(),
                owner: *owner,
                key: key.clone(),
            };
            resolve_world_entity(&selector, context.side, projection_index, world)
        }
    }.filter(|id| world.entities.contains_key(id)).ok_or_else(|| {
        api_error(ApiErrorCode::ValidationFailed, "entity selector did not resolve to a world entity")
    })
}

pub(crate) fn observation(
    world: &WorldState,
    plan: &RulePlan,
    side: CombatantSide,
    tick: u32,
    projection_index: &ProjectionIndex,
) -> Result<ObservationSnapshot, ApiError> {
    let mut fields = BTreeMap::new();
    for (path, schema) in &plan.domain.observation_fields {
        let value = observation_field_value(schema, world, plan, side, tick, None, projection_index)?;
        fields.insert(path.clone(), value);
    }
    let mut collections = BTreeMap::new();
    for (id, schema) in &plan.domain.collections {
        collections.insert(
            id.clone(),
            collection_observation(schema, world, plan, side, tick, projection_index)?,
        );
    }
    Ok(ObservationSnapshot { tick, side, fields, collections })
}

fn collection_observation(
    schema: &CollectionSchema,
    world: &WorldState,
    plan: &RulePlan,
    side: CombatantSide,
    tick: u32,
    projection_index: &ProjectionIndex,
) -> Result<Observed<Vec<EntityObservation>>, ApiError> {
    if schema.visibility == Visibility::Internal { return Ok(Observed::Unknown); }
    let CollectionSource::WorldEntities { entity_types, owner, filter } = &schema.source;
    let mut selected = Vec::new();
    for (id, entity) in &world.entities {
        if entity.entity_type != schema.element_type
            || !entity_types.contains(&entity.entity_type)
            || !visibility_item(schema.visibility, side, entity.owner)
            || !owner_matches(*owner, Some(side), entity.owner)
        { continue; }
        if let Some(filter) = filter {
            let context = EvalContext {
                side: Some(side), intent: None, observed_entity: Some(id), projection_index: Some(projection_index), tick,
            };
            match crate::eval_truth(filter, world, context)? {
                senkei_model::Truth::True => {},
                senkei_model::Truth::False => continue,
                senkei_model::Truth::Unknown => return Ok(Observed::Unknown),
            }
        }
        selected.push((id.clone(), entity));
    }
    if selected.len() > schema.max_items as usize || selected.len() > plan.domain.max_collection_items as usize {
        return Err(api_error(ApiErrorCode::ResourceLimit, "observable entity collection exceeds its item limit"));
    }
    // This is a fallible typed comparison: schema or snapshot corruption must
    // not silently choose a host-specific fallback ordering.
    for index in 1..selected.len() {
        let mut cursor = index;
        while cursor > 0
            && compare_entities(
                &selected[cursor - 1].0,
                selected[cursor - 1].1,
                &selected[cursor].0,
                selected[cursor].1,
                &schema.order_by,
            )? == std::cmp::Ordering::Greater
        {
            selected.swap(cursor - 1, cursor);
            cursor -= 1;
        }
    }
    let mut observations = Vec::with_capacity(selected.len());
    for (id, entity) in selected {
        let mut fields = BTreeMap::new();
        for (field, field_schema) in &schema.visible_fields {
            fields.insert(field.clone(), observation_field_value(field_schema, world, plan, side, tick, Some(&id), projection_index)?);
        }
        observations.push(EntityObservation { id, entity_type: entity.entity_type.clone(), fields });
    }
    Ok(Observed::Known(observations))
}

fn compare_entities(
    a_id: &EntityId,
    a: &EntityState,
    b_id: &EntityId,
    b: &EntityState,
    order_by: &[FieldId],
) -> Result<std::cmp::Ordering, ApiError> {
    for field in order_by {
        let order = match (a.fields.get(field), b.fields.get(field)) {
            (Some(a), Some(b)) => crate::compare_values(a, b).ok_or_else(|| {
                api_error(ApiErrorCode::ValidationFailed, "collection order field is not a comparable scalar")
            })?,
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        };
        if order != std::cmp::Ordering::Equal { return Ok(order); }
    }
    Ok(a_id.cmp(b_id))
}

fn observation_field_value(
    schema: &ObservationFieldSchema,
    world: &WorldState,
    plan: &RulePlan,
    side: CombatantSide,
    tick: u32,
    current_entity: Option<&EntityId>,
    projection_index: &ProjectionIndex,
) -> Result<Observed<DomainValue>, ApiError> {
    use ObservationSource as S;
    let value = match &schema.source {
        S::Tick => {
            if !visibility_item(schema.visibility, side, None) { return Ok(Observed::Unknown); }
            Some(DomainValue::Integer(i64::from(tick)))
        }
        S::WorldGlobalField { field } => {
            let Some(field_schema) = plan.world.global_fields.get(field) else { return Ok(Observed::Unknown); };
            if !visibility_item(schema.visibility, side, None) || !visibility_item(field_schema.visibility, side, None) { return Ok(Observed::Unknown); }
            world.global_fields.get(field).cloned()
        }
        S::WorldEntityField { entity, field } => {
            let Some(entity_id) = resolve_world_entity(entity, Some(side), projection_index, world) else { return Ok(Observed::Unknown); };
            entity_field_value(&entity_id, field, schema, world, plan, side)?
        }
        S::CurrentEntityField { field } => {
            let Some(entity_id) = current_entity else { return Ok(Observed::Unknown); };
            entity_field_value(entity_id, field, schema, world, plan, side)?
        }
        S::Derived(expression) => {
            let owner = current_entity.and_then(|id| world.entities.get(id)).and_then(|entity| entity.owner);
            if !visibility_item(schema.visibility, side, owner) { return Ok(Observed::Unknown); }
            let context = EvalContext {
                side: Some(side), intent: None, observed_entity: current_entity, projection_index: Some(projection_index), tick,
            };
            crate::eval_value(expression, world, context)?
        }
    };
    Ok(match value { Some(value) => Observed::Known(value), None => Observed::Unknown })
}

fn entity_field_value(
    entity_id: &EntityId,
    field: &FieldId,
    observation_schema: &ObservationFieldSchema,
    world: &WorldState,
    plan: &RulePlan,
    side: CombatantSide,
) -> Result<Option<DomainValue>, ApiError> {
    let Some(entity) = world.entities.get(entity_id) else { return Ok(None); };
    let Some(entity_type) = plan.world.entity_types.get(&entity.entity_type) else { return Ok(None); };
    let Some(field_schema) = entity_type.fields.get(field) else { return Ok(None); };
    if !visibility_item(observation_schema.visibility, side, entity.owner)
        || !visibility_item(field_schema.visibility, side, entity.owner)
    { return Ok(None); }
    Ok(entity.fields.get(field).cloned())
}

pub(crate) fn public_view(world: &WorldState, plan: &RulePlan) -> WorldStateView {
    let mut entities = BTreeMap::new();
    for (id, entity) in &world.entities {
        let Some(allowed_fields) = plan.presentation.visible_entity_fields.get(&entity.entity_type) else { continue; };
        let fields = allowed_fields.iter()
            .filter_map(|field| entity.fields.get(field).map(|value| (field.clone(), value.clone())))
            .collect();
        entities.insert(id.clone(), EntityStateView { entity_type: entity.entity_type.clone(), owner: entity.owner, fields });
    }
    let global_fields = plan.presentation.visible_global_fields.iter()
        .filter_map(|field| world.global_fields.get(field).map(|value| (field.clone(), value.clone())))
        .collect();
    WorldStateView { entities, global_fields }
}

pub(crate) fn public_event(event: &crate::InternalEvent, plan: &RulePlan, world: &WorldState) -> Option<PresentationEvent> {
    let schema = plan.presentation.visible_events.get(&event.event)?;
    let payload = schema.payload.keys().filter_map(|field| event.payload.get(field).map(|value| (field.clone(), value.clone()))).collect();
    let entity = event.entity.as_ref().and_then(|id| {
        let state = world.entities.get(id)?;
        plan.presentation.visible_entity_fields.contains_key(&state.entity_type).then(|| id.clone())
    });
    Some(PresentationEvent { event: event.event.clone(), entity, payload })
}

fn side_symbol(side: CombatantSide) -> senkei_model::SymbolId {
    senkei_model::SymbolId::from(match side { CombatantSide::Attacker => "attacker", CombatantSide::Defender => "defender" })
}

fn owner_matches(rule: EntityOwnerSelector, side: Option<CombatantSide>, owner: Option<CombatantSide>) -> bool {
    use EntityOwnerSelector as O;
    match rule {
        O::Any => true,
        O::OwnSide => side.is_some_and(|side| owner == Some(side)),
        O::OtherSide => side.is_some_and(|side| owner == Some(opponent(side))),
        O::Unowned => owner.is_none(),
        O::Attacker => owner == Some(CombatantSide::Attacker),
        O::Defender => owner == Some(CombatantSide::Defender),
    }
}

fn opponent(side: CombatantSide) -> CombatantSide {
    match side { CombatantSide::Attacker => CombatantSide::Defender, CombatantSide::Defender => CombatantSide::Attacker }
}

fn visibility_item(visibility: Visibility, side: CombatantSide, owner: Option<CombatantSide>) -> bool {
    match visibility {
        Visibility::Public => true,
        Visibility::OwningSide => owner == Some(side),
        Visibility::EnemyVisible => owner == Some(opponent(side)),
        Visibility::Internal => false,
    }
}

fn conflict(message: impl Into<String>) -> ApiError { api_error(ApiErrorCode::TransitionConflict, message) }
