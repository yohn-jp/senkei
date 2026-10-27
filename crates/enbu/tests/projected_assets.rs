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
    let policy = ProjectionPolicy { schema_version: 1, equipment: BTreeMap::from([("blade".into(), definition)]), relation: None };
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
            ]) });
            heroes.push(ProjectedHero { slot_id: slot, owner_id: owner.clone(), instance_id: instance, catalog_id: "catalog".into(), equipment: if n == 0 && side == CombatantSide::Attacker { vec![ProjectedEquipment { instance_id: "item".into(), owner_id: owner.clone(), definition_id: "blade".into(), definition_version: version, definition_digest: digest.clone() }] } else { vec![] } });
        }
        sides.insert(side, ProjectedSide { owner_id: owner, heroes, relations: vec![] });
    }
    let mut projection = MatchProjection { schema_version: 1, sides };
    let original = world.clone();
    projection.sides.get_mut(&CombatantSide::Attacker).unwrap().heroes[0].equipment[0].definition_digest = ContentDigest::new("bad");
    assert!(apply(&mut world, Some(&policy), &projection).is_err());
    assert_eq!(world, original);
    projection.sides.get_mut(&CombatantSide::Attacker).unwrap().heroes[0].equipment[0].definition_digest = digest;
    apply(&mut world, Some(&policy), &projection).unwrap();
    assert_eq!(world.entities[&EntityId::from("Attacker-0")].fields[&FieldId::from("attack")], DomainValue::Integer(17));
}
