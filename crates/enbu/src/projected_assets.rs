//! Apply only effects supplied by the verified, immutable rules package.
use senkei_model::{ApiError, ApiErrorCode, DomainValue, FieldId, MatchProjection, ProjectedStat, ProjectionPolicy, WorldState};
use std::collections::BTreeSet;

pub fn apply(world: &mut WorldState, policy: Option<&ProjectionPolicy>, projection: &MatchProjection) -> Result<(), ApiError> {
    let invalid = |s: &str| ApiError::new(ApiErrorCode::ValidationFailed, s);
    let policy = policy.ok_or_else(|| invalid("asset effects are undefined in this rules package"))?;
    if projection.schema_version != 1 || policy.schema_version != 1 { return Err(invalid("unsupported asset projection version")); }
    if projection.sides.len() != 2 { return Err(invalid("projection requires both sides")); }
    let mut updated = world.clone();
    let mut hero_instances = BTreeSet::new();
    let mut equipment_instances = BTreeSet::new();
    for (side, player) in &projection.sides {
        if player.owner_id.is_empty() { return Err(invalid("missing player identity")); }
        if player.heroes.len() != 5 { return Err(invalid("projection requires all five Heroes")); }
        let mut slots = BTreeSet::new();
        for hero in &player.heroes {
            if hero.owner_id != player.owner_id || hero.instance_id.is_empty() || !hero_instances.insert(&hero.instance_id) || !slots.insert(&hero.slot_id) { return Err(invalid("invalid Hero ownership or duplicate instance")); }
            let matches: Vec<_> = updated.entities.iter_mut().filter(|(_, e)| e.entity_type.as_str() == "hero" && e.owner == Some(*side) && e.fields.get(&FieldId::from("slot_id")) == Some(&DomainValue::String(hero.slot_id.clone())) && e.fields.get(&FieldId::from("catalog_id")) == Some(&DomainValue::String(hero.catalog_id.clone()))).collect();
            if matches.len() != 1 { return Err(invalid("Hero slot or catalog does not match the formation")); }
            let (_, entity) = matches.into_iter().next().unwrap();
            for item in &hero.equipment {
                if item.owner_id != player.owner_id || item.instance_id.is_empty() || !equipment_instances.insert(&item.instance_id) { return Err(invalid("invalid equipment ownership or duplicate instance")); }
                let def = policy.equipment.get(&item.definition_id).ok_or_else(|| invalid("unknown equipment definition"))?;
                if item.definition_version != def.version || crate::digest_json(def)? != item.definition_digest { return Err(invalid("equipment definition version mismatch")); }
                for effect in &def.effects {
                    let key = match effect.stat { ProjectedStat::Attack => "attack", ProjectedStat::Defense => "defense", ProjectedStat::Speed => "speed", ProjectedStat::Range => "range", ProjectedStat::Vision => "vision", ProjectedStat::MaxHp => "max_hp" };
                    let value = match entity.fields.get(&FieldId::from(key)) { Some(DomainValue::Integer(v)) => *v, _ => return Err(invalid("missing projected stat")) };
                    let value = value.checked_add(effect.add).filter(|v| (1..=1_000_000_000).contains(v)).ok_or_else(|| invalid("projected stat out of range"))?;
                    entity.fields.insert(FieldId::from(key), DomainValue::Integer(value));
                    if key == "max_hp" { entity.fields.insert(FieldId::from("hp"), DomainValue::Integer(value)); }
                }
            }
        }
    }
    for (side, player) in &projection.sides {
        let mut pairs = BTreeSet::new();
        for relation in &player.relations {
            if relation.from_instance_id == relation.to_instance_id || !pairs.insert((&relation.from_instance_id, &relation.to_instance_id)) { return Err(invalid("invalid relation pair")); }
            let from = player.heroes.iter().find(|h| h.instance_id == relation.from_instance_id).ok_or_else(|| invalid("unknown relation source"))?;
            if !player.heroes.iter().any(|h| h.instance_id == relation.to_instance_id) { return Err(invalid("unknown relation target")); }
            let formula = policy.relation.as_ref().ok_or_else(|| invalid("relation formula is undefined"))?;
            if relation.formula_version != formula.version || crate::digest_json(formula)? != relation.formula_digest || relation.level < 0 || relation.level > formula.max_level { return Err(invalid("invalid relation formula or level")); }
            let add = formula.add_per_level.checked_mul(relation.level).ok_or_else(|| invalid("relation effect overflow"))?;
            let entity = updated.entities.values_mut().find(|e| e.entity_type.as_str() == "hero" && e.owner == Some(*side) && e.fields.get(&FieldId::from("slot_id")) == Some(&DomainValue::String(from.slot_id.clone()))).ok_or_else(|| invalid("relation source missing from formation"))?;
            let key = match formula.stat { ProjectedStat::Attack => "attack", ProjectedStat::Defense => "defense", ProjectedStat::Speed => "speed", ProjectedStat::Range => "range", ProjectedStat::Vision => "vision", ProjectedStat::MaxHp => "max_hp" };
            let value = match entity.fields.get(&FieldId::from(key)) { Some(DomainValue::Integer(v)) => *v, _ => return Err(invalid("missing relation stat")) };
            let value = value.checked_add(add).filter(|v| (1..=1_000_000_000).contains(v)).ok_or_else(|| invalid("relation stat out of range"))?;
            entity.fields.insert(FieldId::from(key), DomainValue::Integer(value));
            if key == "max_hp" { entity.fields.insert(FieldId::from("hp"), DomainValue::Integer(value)); }
        }
    }
    *world = updated;
    Ok(())
}
