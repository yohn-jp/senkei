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
fn actor_decision_dispatch_binds_one_owner_and_the_same_simulation() {
    let rules = senritsu::validate(senritsu::next_package(), &senritsu::next_engine_compatibility()).unwrap();
    let attacker = valid_snapshot(&rules, CombatantSide::Attacker);
    let defender = valid_snapshot(&rules, CombatantSide::Defender);
    let mut context = new_match_context(&rules, MatchId::new("actor-diagnostics"));
    context.max_ticks = 1;
    let mut payload = json!({"attacker": attacker, "defender": defender, "context": context,
        "include_diagnostics": true, "diagnostics_side": "attacker"});
    let ordinary = dispatch("simulate", payload.clone());
    let response = dispatch("simulate_actor_decisions", payload.clone());
    assert_eq!(response["ok"], true, "{response:#}");
    let result = &response["result"];
    assert_eq!(result["format_version"], 1);
    assert_eq!(result["trace_schema_version"], 1);
    assert_eq!(result["authorized_side"], "attacker");
    assert_eq!(result["simulation"], ordinary["result"]);
    assert_eq!(result["simulation"]["diagnostics"]["identity"]["side"], "attacker");
    assert_eq!(result["simulation"]["diagnostics"]["identity"]["snapshot_digest"], enbu::reproduction_snapshot_digest(&attacker, &defender, &context).unwrap().as_str());
    assert!(result["trace"].as_array().is_some_and(|trace| !trace.is_empty()));
    assert!(result["trace"].as_array().unwrap().iter().all(|trace| trace["actor"].as_str().is_some_and(|id| id.starts_with("visible-")) && trace["kind"] != "monster"));
    assert!(result["simulation"]["owner_replays"].get("defender").is_none());

    payload["include_diagnostics"] = json!(false);
    payload.as_object_mut().unwrap().remove("diagnostics_side");
    let rejected = dispatch("simulate_actor_decisions", payload);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_request");
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

#[test]
fn preflight_failure_targets_are_structured_and_side_specific() {
    let rules = senritsu::validate(senritsu::next_package(), &senritsu::next_engine_compatibility()).unwrap();
    let context = new_match_context(&rules, MatchId::new("preflight-targets"));
    let valid = json!({ "attacker": valid_snapshot(&rules, CombatantSide::Attacker), "defender": valid_snapshot(&rules, CombatantSide::Defender), "context": context });
    for side in ["attacker", "defender"] {
        for case in ["skill_path", "squad", "program"] {
            let mut input = valid.clone();
            match case {
                "skill_path" => input[side]["configuration"]["heroes"]["value"][1]["value"]["skill_path"]["value"] = json!("missing-path"),
                "squad" => {
                    input[side]["configuration"]["heroes"]["value"][1]["value"]["squad"] = input[side]["configuration"]["heroes"]["value"][0]["value"]["squad"].clone();
                    let base = input[side]["configuration"]["heroes"]["value"][0]["value"]["node"]["value"].as_str().unwrap();
                    let other = rules.plan().next.as_ref().unwrap().map.nodes.keys().find(|node| node.as_str() != base).unwrap();
                    input[side]["configuration"]["heroes"]["value"][1]["value"]["node"]["value"] = json!(other);
                }
                _ => input[side]["program"]["content_digest"] = json!("0".repeat(64)),
            }
            let response = dispatch("preflight", input);
            assert_eq!(response["ok"], false);
            let error = &response["error"];
            assert_eq!(error["details"]["preflight_side"], side);
            if case == "program" {
                assert_eq!(error["code"], "invalid_program");
                assert_eq!(error["path"], format!("{side}.program"));
                assert!(error["details"].get("preflight_slot_id").is_none());
            } else {
                let field = if case == "squad" { "node" } else { "skill_path" };
                assert_eq!(error["code"], "invalid_snapshot");
                assert_eq!(error["path"], format!("{side}.configuration.heroes.value[1].value.{field}"));
                assert_eq!(error["details"]["preflight_record_index"], "1");
                assert_eq!(error["details"]["preflight_slot_id"], "slot-2");
                assert_eq!(error["details"]["preflight_field"], field);
            }
        }
    }
    assert_eq!(dispatch("preflight", valid)["ok"], true);
}


/// Export real, versioned Enbu inputs and native Rust golden digests for the
/// public Simulation Lab. This calls the production dispatcher, not a test
/// approximation of combat, and the Pages gate runs the same inputs in WASM.
#[test]
fn export_enbu_lab_fixtures() {
    use sha2::{Digest, Sha256};
    let rules = senritsu::validate(
        senritsu::next_package(),
        &senritsu::next_engine_compatibility(),
    ).expect("published Next package must validate");
    let attacker = valid_snapshot(&rules, CombatantSide::Attacker);
    let defender = valid_snapshot(&rules, CombatantSide::Defender);
    let mut cases = Vec::new();
    for ticks in [1_u32, 4, 16] {
        let mut context = new_match_context(&rules, MatchId::new("lab-enbu-wasm"));
        context.max_ticks = ticks;
        let request = json!({
            "api_version": WASM_API_VERSION,
            "request_id": format!("lab-enbu-{ticks}"),
            "operation": "simulate",
            "payload": {
                "attacker": attacker.clone(),
                "defender": defender.clone(),
                "context": context,
                "include_diagnostics": true,
                "diagnostics_side": "attacker",
            }
        });
        let response = senkei_wasm::dispatch_json(&request.to_string());
        let parsed: Value = serde_json::from_str(&response).expect("valid response JSON");
        assert_eq!(parsed["ok"], true, "real Enbu fixture failed: {parsed:#}");
        let digest = format!("{:x}", Sha256::digest(response.as_bytes()));
        cases.push(json!({
            "id": format!("next-{ticks}"),
            "ticks": ticks,
            "request": request,
            "response_sha256": digest,
        }));
    }
    if let Ok(path) = std::env::var("SENKEI_LAB_FIXTURE_OUT") {
        let fixture = json!({"schema": "senkei-enbu-wasm/v1", "cases": cases});
        std::fs::write(path, serde_json::to_vec_pretty(&fixture).unwrap())
            .expect("write exact native Enbu fixture");
    }
}
