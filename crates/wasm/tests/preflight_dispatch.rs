use enbu::new_match_context;
use jinrei::compile;
use senkei_model::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn dispatch(operation: &str, payload: Value) -> Value {
    let request = json!({
        "api_version": WASM_API_VERSION,
        "request_id": "preflight-integration",
        "operation": operation,
        "payload": payload,
    });
    serde_json::from_str(&senkei_wasm::dispatch_bytes(request.to_string().as_bytes()))
        .expect("dispatcher response is valid JSON")
}

fn domain_default(value_type: &DomainType) -> Option<DomainValue> {
    match value_type {
        DomainType::Bool => Some(DomainValue::Bool(false)),
        DomainType::Integer { min, max } => {
            let value = min.unwrap_or(0).max(0);
            Some(DomainValue::Integer(max.map_or(value, |maximum| value.min(maximum))))
        }
        DomainType::Fixed { scale, min, max } => {
            let value = min.unwrap_or(0).max(0);
            Some(DomainValue::Fixed { coefficient: max.map_or(value, |maximum| value.min(maximum)), scale: *scale })
        }
        DomainType::String { .. } => Some(DomainValue::String(String::new())),
        DomainType::Enum { values, .. } => values.iter().next().cloned().map(DomainValue::Enum),
        DomainType::Entity { .. } => None,
        DomainType::Optional(_) => Some(DomainValue::Null),
        DomainType::List { .. } | DomainType::Vector { .. } | DomainType::Matrix { .. } => Some(DomainValue::List(Vec::new())),
        DomainType::Record { fields } => fields.iter()
            .map(|(field, value_type)| Some((field.clone(), domain_default(value_type)?)))
            .collect::<Option<BTreeMap<_, _>>>()
            .map(DomainValue::Record),
    }
}

fn valid_snapshot(rules: &VerifiedRulePlan, side: CombatantSide) -> SenkeiSnapshot {
    let next = rules.plan().next.as_ref().expect("Next package has hero mechanics");
    let mut configuration = BTreeMap::new();
    for (field, schema) in &rules.plan().domain.senkei_configuration {
        if let Some(value) = schema.default.clone().or_else(|| domain_default(&schema.value_type)) {
            configuration.insert(field.clone(), value);
        } else if schema.required {
            panic!("required field {field} must have a fixture value");
        }
    }
    let start = match side { CombatantSide::Attacker => &next.map.attacker_base, CombatantSide::Defender => &next.map.defender_base };
    let heroes = next.heroes.iter().take(5).enumerate().map(|(index, hero)| {
        DomainValue::Record(BTreeMap::from([
            (FieldId::new("slot_id"), DomainValue::String(format!("slot-{}", index + 1))),
            (FieldId::new("catalog_id"), DomainValue::String(hero.id.clone())),
            (FieldId::new("squad"), DomainValue::String(format!("squad-{}", index + 1))),
            (FieldId::new("node"), DomainValue::String(start.clone())),
            (FieldId::new("skill_path"), DomainValue::String(hero.skill_paths.keys().next().unwrap().clone())),
        ]))
    }).collect();
    configuration.insert(FieldId::new("heroes"), DomainValue::List(heroes));
    let source = "senkei preflight { state inert { false, }, }";
    let program = compile(source, rules).expect("fixture Jinrei compiles").program;
    SenkeiSnapshot {
        schema_version: rules.plan().model_version,
        id: ArtifactId::new(format!("preflight-{side:?}")),
        revision: RevisionId::new("1"),
        ruleset: rules.ruleset().clone(),
        configuration,
        program,
        initial_memory: TacticalMemory::new(),
    }
}

#[test]
fn preflight_operation_accepts_a_real_launch_snapshot_and_rejects_invalid_roster() {
    let rules = senritsu::validate(senritsu::next_package(), &senritsu::next_engine_compatibility())
        .expect("published Next package validates");
    let attacker = valid_snapshot(&rules, CombatantSide::Attacker);
    let defender = valid_snapshot(&rules, CombatantSide::Defender);
    let context = new_match_context(&rules, MatchId::new("preflight-api-test"));
    let snapshot = json!({ "attacker": attacker, "defender": defender, "context": context });

    let accepted = dispatch("preflight", snapshot.clone());
    assert_eq!(accepted["ok"], true);
    assert!(accepted["result"].is_null(), "preflight returns only a successful validation acknowledgement");

    let mut invalid = snapshot;
    invalid["attacker"]["configuration"]["heroes"]["value"]
        .as_array_mut().expect("hero list exists").pop();
    let rejected = dispatch("preflight", invalid);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_snapshot");
}
