use enbu::projected_assets::apply;
use senkei_model::{CombatantSide, DomainValue, EntityId, EntityState, FieldId, WorldState};
use std::collections::BTreeMap;

#[test]
fn undefined_policy_cannot_apply_an_equipment_bonus() {
    let mut world = WorldState::default();
    world.entities.insert(EntityId::from("attacker:h1"), EntityState {
        entity_type: "hero".into(), owner: Some(CombatantSide::Attacker),
        fields: BTreeMap::from([(FieldId::from("attack"), DomainValue::Integer(10))]),
    });
    assert!(apply(&mut world, None, &Default::default()).is_err());
    assert_eq!(world.entities[&EntityId::from("attacker:h1")].fields[&FieldId::from("attack")], DomainValue::Integer(10));
}

#[test]
fn approved_equipment_changes_world_and_wrong_digest_is_atomic() {
    use senkei_model::{MatchProjection, ProjectedSide, ProjectedHero, ProjectedEquipment, ProjectionPolicy, EquipmentEffectDefinition, StatEffect, ProjectedStat, Version, ContentDigest};
    use sha2::{Digest, Sha256};
    let version = Version::new(1, 0, 0);
    let definition = EquipmentEffectDefinition { version, effects: vec![StatEffect { stat: ProjectedStat::Attack, add: 7 }] };
    let digest = ContentDigest::new(format!("{:x}", Sha256::digest(serde_json::to_vec(&definition).unwrap())));
    let mut policy = ProjectionPolicy { schema_version: 1, test_only: true, hero_catalog_id: "catalogs".into(), hero_catalog_version: version, hero_catalog_digest: ContentDigest::new("catalog-digest"), equipment: BTreeMap::from([("blade".into(), definition)]), relation: None, maturity: None };
    let mut world = WorldState::default();
    let mut sides = BTreeMap::new();
    for side in [CombatantSide::Attacker, CombatantSide::Defender] {
        let owner = format!("{side:?}");
        let mut heroes = Vec::new();
        for n in 0..5 {
            let slot = format!("slot{n}");
            let instance = format!("{owner}-{n}");
            world.entities.insert(EntityId::new(instance.clone()), EntityState { entity_type: "hero".into(), owner: Some(side), fields: BTreeMap::from([
                (FieldId::from("slot_id"), DomainValue::String(slot.clone())),
                (FieldId::from("catalog_id"), DomainValue::String("catalog".into())),
                (FieldId::from("attack"), DomainValue::Integer(10)),
                (FieldId::from("defense"), DomainValue::Integer(10)),
                (FieldId::from("hp"), DomainValue::Integer(10)),
                (FieldId::from("squad"), DomainValue::String("group".into())),
            ]) });
            heroes.push(ProjectedHero { slot_id: slot, owner_id: owner.clone(), instance_id: instance, catalog_id: "catalog".into(), definition_catalog_id: "catalogs".into(), definition_version: version, definition_digest: ContentDigest::new("catalog-digest"), equipment: if n == 0 && side == CombatantSide::Attacker { vec![ProjectedEquipment { instance_id: "item".into(), owner_id: owner.clone(), definition_id: "blade".into(), definition_version: version, definition_digest: digest.clone() }] } else { vec![] } });
        }
        sides.insert(side, ProjectedSide { owner_id: owner, authority: senkei_model::AssetAuthority::Local, heroes, relations: vec![] });
    }
    let mut projection = MatchProjection { schema_version: 1, sides };
    let original = world.clone();
    projection.sides.get_mut(&CombatantSide::Attacker).unwrap().heroes[0].equipment[0].definition_digest = ContentDigest::new("bad");
    assert!(apply(&mut world, Some(&policy), &projection).is_err());
    assert_eq!(world, original);
    projection.sides.get_mut(&CombatantSide::Attacker).unwrap().heroes[0].equipment[0].definition_digest = digest;
    apply(&mut world, Some(&policy), &projection).unwrap();
    assert_eq!(world.entities[&EntityId::from("Attacker-0")].fields[&FieldId::from("attack")], DomainValue::Integer(17));
    // Equipped item order cannot affect a sum of additive effects. In the
    // first order, applying the negative item on its own would cross zero.
    let mut additive_policy = policy.clone();
    let mut equipped = Vec::new();
    for (id, add) in [("negative", -15), ("positive", 15)] {
        let definition = EquipmentEffectDefinition { version, effects: vec![StatEffect { stat: ProjectedStat::Attack, add }] };
        let digest = ContentDigest::new(format!("{:x}", Sha256::digest(serde_json::to_vec(&definition).unwrap())));
        additive_policy.equipment.insert(id.into(), definition);
        equipped.push(ProjectedEquipment { instance_id: id.into(), owner_id: "Attacker".into(), definition_id: id.into(), definition_version: version, definition_digest: digest });
    }
    let mut additive_projection = projection.clone();
    additive_projection.sides.get_mut(&CombatantSide::Attacker).unwrap().heroes[0].equipment = equipped;
    let mut negative_first = original.clone();
    apply(&mut negative_first, Some(&additive_policy), &additive_projection).unwrap();
    additive_projection.sides.get_mut(&CombatantSide::Attacker).unwrap().heroes[0].equipment.reverse();
    let mut positive_first = original.clone();
    apply(&mut positive_first, Some(&additive_policy), &additive_projection).unwrap();
    assert_eq!(negative_first, positive_first);
    assert_eq!(negative_first.entities[&EntityId::from("Attacker-0")].fields[&FieldId::from("attack")], DomainValue::Integer(10));
    additive_projection.sides.get_mut(&CombatantSide::Attacker).unwrap().heroes[0].equipment.retain(|item| item.definition_id == "negative");
    let mut invalid_final = original.clone();
    assert!(apply(&mut invalid_final, Some(&additive_policy), &additive_projection).is_err());
    assert_eq!(invalid_final, original, "an out-of-range final value does not change the world");
    use senkei_model::{ProjectedRelation, RelationFormula, RelationRounding};
    let formula = RelationFormula { version, stat: ProjectedStat::Defense, add_per_level: 1, max_level: 10, max_bonus: 10, rounding: RelationRounding::Floor };
    let formula_digest = ContentDigest::new(format!("{:x}", Sha256::digest(serde_json::to_vec(&formula).unwrap())));
    policy.relation = Some(formula);
    let player = projection.sides.get_mut(&CombatantSide::Attacker).unwrap();
    for (from, to, level) in [("Attacker-0", "Attacker-1", Some(4)), ("Attacker-1", "Attacker-0", Some(8)), ("Attacker-0", "Attacker-2", Some(2)), ("Attacker-2", "Attacker-0", Some(2))] {
        player.relations.push(ProjectedRelation { from_instance_id: from.into(), to_instance_id: to.into(), level, formula_version: Some(version), formula_digest: Some(formula_digest.clone()), maturity_policy: None });
    }
    let mut first = original.clone();
    let mut runtime = apply(&mut first, Some(&policy), &projection).unwrap();
    for (id, expected) in [("Attacker-0", 14), ("Attacker-1", 16), ("Attacker-2", 12)] {
        assert_eq!(first.entities[&EntityId::from(id)].fields[&FieldId::from("defense")], DomainValue::Integer(expected));
    }
    let mut lifecycle = first.clone();
    let hero = EntityId::from("Attacker-1");
    lifecycle.entities.get_mut(&hero).unwrap().fields.insert(FieldId::from("squad"), DomainValue::String("solo".into()));
    runtime.refresh(&mut lifecycle).unwrap();
    assert_eq!(lifecycle.entities[&hero].fields[&FieldId::from("defense")], DomainValue::Integer(10));
    assert_eq!(lifecycle.entities[&EntityId::from("Attacker-0")].fields[&FieldId::from("defense")], DomainValue::Integer(12));
    lifecycle.entities.get_mut(&hero).unwrap().fields.insert(FieldId::from("squad"), DomainValue::String("group".into()));
    runtime.refresh(&mut lifecycle).unwrap();
    assert_eq!(lifecycle, first);
    lifecycle.entities.get_mut(&hero).unwrap().fields.insert(FieldId::from("hp"), DomainValue::Integer(0));
    runtime.refresh(&mut lifecycle).unwrap();
    assert_eq!(lifecycle.entities[&hero].fields[&FieldId::from("defense")], DomainValue::Integer(10));
    lifecycle.entities.get_mut(&hero).unwrap().fields.insert(FieldId::from("defense"), DomainValue::Integer(13));
    lifecycle.entities.get_mut(&hero).unwrap().fields.insert(FieldId::from("hp"), DomainValue::Integer(10));
    runtime.refresh(&mut lifecycle).unwrap();
    assert_eq!(lifecycle.entities[&hero].fields[&FieldId::from("defense")], DomainValue::Integer(19));
    runtime.refresh(&mut lifecycle).unwrap();
    assert_eq!(lifecycle.entities[&hero].fields[&FieldId::from("defense")], DomainValue::Integer(19));
    let player = projection.sides.get_mut(&CombatantSide::Attacker).unwrap();
    player.heroes.reverse(); player.relations.reverse();
    for r in &mut player.relations {
        if r.from_instance_id == "Attacker-0" && r.to_instance_id == "Attacker-1" { r.level = Some(8); }
        if r.from_instance_id == "Attacker-1" && r.to_instance_id == "Attacker-0" { r.level = Some(4); }
    }
    let mut reordered = original.clone();
    apply(&mut reordered, Some(&policy), &projection).unwrap();
    assert_eq!(first, reordered);
    let player = projection.sides.get_mut(&CombatantSide::Attacker).unwrap();
    for r in &mut player.relations { if r.from_instance_id == "Attacker-1" { r.level = None; } }
    let mut undefined = original.clone();
    apply(&mut undefined, Some(&policy), &projection).unwrap();
    assert_eq!(undefined.entities[&EntityId::from("Attacker-1")].fields[&FieldId::from("defense")], DomainValue::Integer(10));
    projection.sides.get_mut(&CombatantSide::Attacker).unwrap().relations.pop();
    assert!(apply(&mut original.clone(), Some(&policy), &projection).is_err());
}
