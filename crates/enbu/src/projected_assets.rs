//! Apply only effects supplied by the verified, immutable rules package.
use senkei_model::{ApiError, ApiErrorCode, DomainValue, FieldId, MatchProjection, ProjectedStat, ProjectionPolicy, WorldState};
use std::collections::{BTreeSet, BTreeMap};
use senkei_model::EntityId;

pub fn apply(world: &mut WorldState, policy: Option<&ProjectionPolicy>, projection: &MatchProjection) -> Result<RelationRuntime, ApiError> {
    let invalid = |s: &str| ApiError::new(ApiErrorCode::ValidationFailed, s);
    let policy = policy.ok_or_else(|| invalid("asset effects are undefined in this rules package"))?;
    if projection.schema_version != 1 || policy.schema_version != 1 || !policy.test_only { return Err(invalid("unsupported asset projection version")); }
    if projection.sides.len() != 2 { return Err(invalid("projection requires both sides")); }
    let mut updated = world.clone();
    let mut hero_instances = BTreeSet::new();
    let mut equipment_instances = BTreeSet::new();
    for (side, player) in &projection.sides {
        if player.authority != senkei_model::AssetAuthority::Local || player.owner_id.is_empty() { return Err(invalid("missing player identity")); }
        if player.heroes.len() != 5 { return Err(invalid("projection requires all five Heroes")); }
        let mut slots = BTreeSet::new();
        for hero in &player.heroes {
            if hero.owner_id != player.owner_id || hero.instance_id.is_empty() || !hero_instances.insert(&hero.instance_id) || !slots.insert(&hero.slot_id) { return Err(invalid("invalid Hero ownership or duplicate instance")); }
            if hero.definition_catalog_id != policy.hero_catalog_id || hero.definition_version != policy.hero_catalog_version || hero.definition_digest != policy.hero_catalog_digest { return Err(invalid("Hero catalog identity mismatch")); }
            let matches: Vec<_> = updated.entities.iter_mut().filter(|(_, e)| e.entity_type.as_str() == "hero" && e.owner == Some(*side) && e.fields.get(&FieldId::from("slot_id")) == Some(&DomainValue::String(hero.slot_id.clone())) && e.fields.get(&FieldId::from("catalog_id")) == Some(&DomainValue::String(hero.catalog_id.clone()))).collect();
            if matches.len() != 1 { return Err(invalid("Hero slot or catalog does not match the formation")); }
            let (_, entity) = matches.into_iter().next().unwrap();
            // Effects are additive, so validate the final stat after combining
            // all equipped items. Validity must not depend on item order or an
            // intermediate value from applying a negative effect first.
            let mut additions: BTreeMap<&str, i128> = BTreeMap::new();
            for item in &hero.equipment {
                if item.owner_id != player.owner_id || item.instance_id.is_empty() || !equipment_instances.insert(&item.instance_id) { return Err(invalid("invalid equipment ownership or duplicate instance")); }
                let def = policy.equipment.get(&item.definition_id).ok_or_else(|| invalid("unknown equipment definition"))?;
                if item.definition_version != def.version || crate::digest_json(def)? != item.definition_digest { return Err(invalid("equipment definition version mismatch")); }
                for effect in &def.effects {
                    let key = match effect.stat { ProjectedStat::Attack => "attack", ProjectedStat::Defense => "defense", ProjectedStat::Speed => "speed", ProjectedStat::Range => "range", ProjectedStat::Vision => "vision", ProjectedStat::MaxHp => "max_hp" };
                    let total = additions.entry(key).or_default();
                    *total = total.checked_add(i128::from(effect.add)).ok_or_else(|| invalid("projected stat overflow"))?;
                }
            }
            for (key, addition) in additions {
                let base = match entity.fields.get(&FieldId::from(key)) { Some(DomainValue::Integer(v)) => *v, _ => return Err(invalid("missing projected stat")) };
                let value = i128::from(base).checked_add(addition).filter(|v| (1..=1_000_000_000).contains(v)).ok_or_else(|| invalid("projected stat out of range"))? as i64;
                entity.fields.insert(FieldId::from(key), DomainValue::Integer(value));
                if key == "max_hp" { entity.fields.insert(FieldId::from("hp"), DomainValue::Integer(value)); }
            }
        }
    }
    let mut runtime = RelationRuntime { projection: projection.clone(), policy: policy.clone(), previous: BTreeMap::new() };
    runtime.refresh(&mut updated)?;
    *world = updated;
    Ok(runtime)
}

/// Per-simulation accounting; never serialized into the public world.
pub struct RelationRuntime {
    projection: MatchProjection,
    policy: ProjectionPolicy,
    previous: BTreeMap<EntityId, i64>,
}
impl RelationRuntime {
    pub fn refresh(&mut self, world: &mut WorldState) -> Result<(), ApiError> {
        let invalid = |s: &str| ApiError::new(ApiErrorCode::ValidationFailed, s);
        let mut updated = world.clone();
        let mut next_previous = BTreeMap::new();
        if let Some(formula) = &self.policy.relation {
            let key = match formula.stat { ProjectedStat::Attack => "attack", ProjectedStat::Defense => "defense", _ => return Err(invalid("unsupported relation stat")) };
            for (id, old) in &self.previous {
                let entity = updated.entities.get_mut(id).ok_or_else(|| invalid("relation Hero disappeared"))?;
                let current = match entity.fields.get(&FieldId::from(key)) { Some(DomainValue::Integer(v)) => *v, _ => return Err(invalid("missing relation stat")) };
                let base = current.checked_sub(*old).filter(|v| (1..=1_000_000_000).contains(v)).ok_or_else(|| invalid("relation base out of range"))?;
                entity.fields.insert(FieldId::from(key), DomainValue::Integer(base));
            }
        }
    for (side, player) in &self.projection.sides {
        use std::collections::BTreeMap;
        let mut directions = BTreeMap::new();
        for relation in &player.relations {
            if relation.from_instance_id == relation.to_instance_id || directions.insert((&relation.from_instance_id, &relation.to_instance_id), relation).is_some() { return Err(invalid("invalid relation pair")); }
            if !player.heroes.iter().any(|h| h.instance_id == relation.from_instance_id) || !player.heroes.iter().any(|h| h.instance_id == relation.to_instance_id) { return Err(invalid("unknown relation Hero")); }
            let formula = self.policy.relation.as_ref().ok_or_else(|| invalid("relation formula is undefined"))?;
            if relation.formula_version != formula.version || crate::digest_json(formula)? != relation.formula_digest || relation.level.is_some_and(|v| v < 0 || v > formula.max_level) { return Err(invalid("invalid relation formula or level")); }
        }
        let mut totals: BTreeMap<&str, (i64, i64)> = BTreeMap::new();
        for ((from, to), forward) in &directions {
            let backward = directions.get(&(to, from)).ok_or_else(|| invalid("both relation directions are required"))?;
            if from >= to { continue; }
            let (Some(a), Some(b)) = (forward.level, backward.level) else { continue };
            let left = player.heroes.iter().find(|h| &h.instance_id == *from).unwrap();
            let right = player.heroes.iter().find(|h| &h.instance_id == *to).unwrap();
            let squad = |slot: &str| updated.entities.values().find(|e| e.entity_type.as_str() == "hero" && e.owner == Some(*side) && e.fields.get(&FieldId::from("slot_id")) == Some(&DomainValue::String(slot.to_owned()))).and_then(|e| e.fields.get(&FieldId::from("squad"))).cloned();
            let (Some(left_squad), Some(right_squad)) = (squad(&left.slot_id), squad(&right.slot_id)) else { return Err(invalid("relation Hero squad missing")); };
            let alive = |slot: &str| updated.entities.values().any(|e| e.entity_type.as_str() == "hero" && e.owner == Some(*side) && e.fields.get(&FieldId::from("slot_id")) == Some(&DomainValue::String(slot.to_owned())) && matches!(e.fields.get(&FieldId::from("hp")), Some(DomainValue::Integer(hp)) if *hp > 0));
            if left_squad != right_squad || !alive(&left.slot_id) || !alive(&right.slot_id) { continue; }
            let pair = a.checked_add(b).ok_or_else(|| invalid("relation overflow"))? / 2;
            for hero in [left, right] { let total = totals.entry(&hero.instance_id).or_default(); total.0 = total.0.checked_add(pair).ok_or_else(|| invalid("relation overflow"))?; total.1 += 1; }
        }
        for (instance, (sum, count)) in totals {
            let formula = self.policy.relation.as_ref().unwrap();
            let add = (sum / count).checked_mul(formula.add_per_level).ok_or_else(|| invalid("relation overflow"))?.min(formula.max_bonus);
            let hero = player.heroes.iter().find(|h| h.instance_id == instance).unwrap();
            let (entity_id, entity) = updated.entities.iter_mut().find(|(_, e)| e.entity_type.as_str() == "hero" && e.owner == Some(*side) && e.fields.get(&FieldId::from("slot_id")) == Some(&DomainValue::String(hero.slot_id.clone()))).ok_or_else(|| invalid("relation source missing from formation"))?;
            let key = match formula.stat { ProjectedStat::Attack => "attack", ProjectedStat::Defense => "defense", ProjectedStat::Speed => "speed", ProjectedStat::Range => "range", ProjectedStat::Vision => "vision", ProjectedStat::MaxHp => "max_hp" };
            let value = match entity.fields.get(&FieldId::from(key)) { Some(DomainValue::Integer(v)) => *v, _ => return Err(invalid("missing relation stat")) };
            let value = value.checked_add(add).filter(|v| (1..=1_000_000_000).contains(v)).ok_or_else(|| invalid("relation stat out of range"))?;
            entity.fields.insert(FieldId::from(key), DomainValue::Integer(value));
            next_previous.insert(entity_id.clone(), add);
        }
    }
        *world = updated;
        self.previous = next_previous;
        Ok(())
    }
}
