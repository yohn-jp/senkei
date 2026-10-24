//! Shared deterministic scalar access for finite battle primitives.
use senkei_model::*;
use std::collections::BTreeMap;
pub fn int(e: &EntityState, key: &str) -> i64 { match e.fields.get(&FieldId::from(key)) { Some(DomainValue::Integer(v)) => *v, _ => 0 } }
pub fn string(e: &EntityState, key: &str) -> String { match e.fields.get(&FieldId::from(key)) { Some(DomainValue::String(v)) => v.clone(), Some(DomainValue::Enum(v)) => v.as_str().into(), _ => String::new() } }
pub fn set_int(e: &mut EntityState, key: &str, value: i64) { e.fields.insert(key.into(), DomainValue::Integer(value)); }
pub fn set_string(e: &mut EntityState, key: &str, value: impl Into<String>) { e.fields.insert(key.into(), DomainValue::String(value.into())); }
pub fn alive(e: &EntityState) -> bool { int(e, "hp") > 0 }
pub fn param(r: &NextRules, key: &str, fallback: i64) -> i64 { r.parameters.get(key).copied().unwrap_or(fallback) }
pub fn side_name(s: CombatantSide) -> &'static str { match s { CombatantSide::Attacker => "attacker", CombatantSide::Defender => "defender" } }
pub fn enemy(s: CombatantSide) -> CombatantSide { match s { CombatantSide::Attacker => CombatantSide::Defender, CombatantSide::Defender => CombatantSide::Attacker } }
pub fn distance2(a: &EntityState, b: &EntityState) -> i128 { let dx = i128::from(int(a,"x")) - i128::from(int(b,"x")); let dy = i128::from(int(a,"y")) - i128::from(int(b,"y")); dx*dx+dy*dy }
pub fn in_range(a: &EntityState, b: &EntityState, range: i64) -> bool { distance2(a,b) <= i128::from(range)*i128::from(range) }
pub fn unit(kind: &str, owner: Option<CombatantSide>, stats: &UnitStats, node: &str, rules: &NextRules) -> EntityState {
    let mut e = EntityState { entity_type: kind.into(), owner, fields: BTreeMap::new() };
    for (k,v) in [("hp",stats.hp),("max_hp",stats.hp),("attack",stats.attack),("defense",stats.defense),("speed",stats.speed),("range",stats.range),("attack_interval",stats.attack_interval),("vision",stats.vision),("attack_ready",0)] { set_int(&mut e,k,v); }
    place(&mut e,node,rules); e
}
pub fn place(e: &mut EntityState, node: &str, r: &NextRules) { set_string(e,"node",node); set_string(e,"edge_to",""); set_int(e,"edge_progress",0); if let Some(n)=r.map.nodes.get(node) { set_int(e,"x",n.x); set_int(e,"y",n.y); } }
pub fn event(id: &str, entity: Option<EntityId>, payload: BTreeMap<FieldId,DomainValue>) -> PresentationEvent { PresentationEvent { event: id.into(), entity, payload } }
