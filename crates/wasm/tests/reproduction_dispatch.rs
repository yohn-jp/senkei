use enbu::new_match_context;
use jinrei::compile;
use senkei_model::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn dispatch(operation: &str, payload: Value) -> Value {
    let request = json!({
        "api_version": WASM_API_VERSION,
        "request_id": "reproduction-integration",
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
            Some(DomainValue::Fixed {
                coefficient: max.map_or(value, |maximum| value.min(maximum)),
                scale: *scale,
            })
        }
        DomainType::String { .. } => Some(DomainValue::String(String::new())),
        DomainType::Enum { values, .. } => {
            values.iter().next().cloned().map(DomainValue::Enum)
        }
        DomainType::Entity { .. } => None,
        DomainType::Optional(_) => Some(DomainValue::Null),
        DomainType::List { .. } | DomainType::Vector { .. } | DomainType::Matrix { .. } => {
            Some(DomainValue::List(Vec::new()))
        }
        DomainType::Record { fields } => fields
            .iter()
            .map(|(field, value_type)| Some((field.clone(), domain_default(value_type)?)))
            .collect::<Option<BTreeMap<_, _>>>()
            .map(DomainValue::Record),
    }
}

fn valid_snapshot(rules: &VerifiedRulePlan, side: CombatantSide) -> SenkeiSnapshot {
    let next = rules
        .plan()
        .next
        .as_ref()
        .expect("Next package has hero mechanics");
    let mut configuration = BTreeMap::new();
    for (field, schema) in &rules.plan().domain.senkei_configuration {
        if let Some(value) = schema.default.clone().or_else(|| domain_default(&schema.value_type)) {
            configuration.insert(field.clone(), value);
        } else if schema.required {
            panic!("required field {field} must have a fixture value");
        }
    }
    let start = match side {
        CombatantSide::Attacker => &next.map.attacker_base,
        CombatantSide::Defender => &next.map.defender_base,
    };
    let heroes = next
        .heroes
        .iter()
        .take(5)
        .enumerate()
        .map(|(index, hero)| {
            DomainValue::Record(BTreeMap::from([
                (
                    FieldId::new("slot_id"),
                    DomainValue::String(format!("slot-{}", index + 1)),
                ),
                (
                    FieldId::new("catalog_id"),
                    DomainValue::String(hero.id.clone()),
                ),
                (
                    FieldId::new("squad"),
                    DomainValue::String(format!("squad-{}", index + 1)),
                ),
                (
                    FieldId::new("node"),
                    DomainValue::String(start.clone()),
                ),
                (
                    FieldId::new("skill_path"),
                    DomainValue::String(hero.skill_paths.keys().next().unwrap().clone()),
                ),
            ]))
        })
        .collect();
    configuration.insert(FieldId::new("heroes"), DomainValue::List(heroes));
    let program = compile("senkei reproduction { state inert { false, }, }", rules)
        .expect("fixture Jinrei compiles")
        .program;
    SenkeiSnapshot {
        schema_version: rules.plan().model_version,
        id: ArtifactId::new(format!("reproduction-{side:?}")),
        revision: RevisionId::new("1"),
        ruleset: rules.ruleset().clone(),
        configuration,
        program,
        initial_memory: TacticalMemory::new(),
    }
}

fn valid_reproduction_request() -> (Value, Value) {
    let assets = dispatch("next_reproduction_assets", json!({}));
    assert_eq!(assets["ok"], true, "current package and World assets are available");
    let parsed_assets: ReproductionAssets =
        serde_json::from_value(assets["result"].clone()).expect("typed reproduction assets");
    let rules = senritsu::validate(
        parsed_assets.rule_package.clone(),
        &senritsu::next_engine_compatibility(),
    )
    .expect("current Next package validates");
    let mut context = new_match_context(&rules, MatchId::new("reproduction-api-test"));
    context.max_ticks = 1;
    let snapshot = json!({
        "attacker": valid_snapshot(&rules, CombatantSide::Attacker),
        "defender": valid_snapshot(&rules, CombatantSide::Defender),
        "context": context,
    });
    let baseline = dispatch(
        "simulate",
        json!({
            "attacker": snapshot["attacker"],
            "defender": snapshot["defender"],
            "context": snapshot["context"],
            "include_diagnostics": true,
            "diagnostics_side": "attacker",
        }),
    );
    assert_eq!(baseline["ok"], true, "same-runtime baseline simulation succeeds");
    let snapshot_digest = baseline["result"]["diagnostics"]["identity"]["snapshot_digest"]
        .as_str()
        .expect("diagnostic identity carries canonical snapshot digest");
    let request = json!({
        "assets": assets["result"],
        "snapshot": snapshot,
        "snapshot_digest": snapshot_digest,
        "include_diagnostics": true,
        "diagnostics_side": "attacker",
    });
    (request, baseline["result"].clone())
}

#[test]
fn current_builtin_assets_can_reproduce_a_match_from_retained_inputs() {
    let assets = dispatch("next_reproduction_assets", json!({}));
    assert_eq!(assets["ok"], true);
    assert_eq!(
        assets["result"]["format_version"],
        REPRODUCTION_ASSETS_FORMAT_VERSION
    );
    assert_eq!(assets["result"]["rule_package"]["ruleset"]["id"], "senkei.next");
    assert!(assets["result"]["world_definition"].is_object());
    assert_eq!(
        assets["result"]["rule_package"]["next"]["world_identity"]["compiler_version"],
        serde_json::to_value(senkei_world::COMPILER_VERSION).unwrap()
    );

    let (request, baseline) = valid_reproduction_request();
    let reproduced = dispatch("reproduce", request);
    assert_eq!(reproduced["ok"], true, "retained exact inputs are accepted");
    let actual = &reproduced["result"];
    assert_eq!(actual["result"], baseline["result"]);
    assert_eq!(actual["replay"], baseline["replay"]);
    assert_eq!(actual["owner_replays"], baseline["owner_replays"]);
    assert_eq!(actual["diagnostics"], baseline["diagnostics"]);
}

#[test]
fn reproduction_rejects_tampered_package_world_snapshot_and_missing_world() {
    let (valid, _) = valid_reproduction_request();

    let mut package = valid.clone();
    package["assets"]["rule_package"]["ruleset"]["digest"] = json!("0".repeat(64));
    let rejected = dispatch("reproduce", package);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_ruleset");

    let mut world = valid.clone();
    world["assets"]["world_definition"]["id"] = json!("different-world");
    let rejected = dispatch("reproduce", world);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "validation_failed");

    let mut snapshot = valid.clone();
    snapshot["snapshot_digest"] = json!("f".repeat(64));
    let rejected = dispatch("reproduce", snapshot);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_snapshot");

    let mut missing_world = valid;
    missing_world["assets"].as_object_mut().unwrap().remove("world_definition");
    let rejected = dispatch("reproduce", missing_world);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_request");
}

#[test]
fn reproduction_rejects_unsupported_world_compiler_and_missing_catalog_extension() {
    let (valid, _) = valid_reproduction_request();

    let mut compiler = valid.clone();
    compiler["assets"]["rule_package"]["next"]["world_identity"]["compiler_version"]["patch"] = json!(u16::MAX);
    let rejected = dispatch("reproduce", compiler);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "incompatible_version");

    let mut package: RulePackage = serde_json::from_value(valid["assets"]["rule_package"].clone()).unwrap();
    package.catalog_semantics_digest = Some(ContentDigest::new("c".repeat(64)));
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    let mut extension = valid;
    extension["assets"]["rule_package"] = serde_json::to_value(package).unwrap();
    let rejected = dispatch("reproduce", extension);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "validation_failed");
    assert!(rejected["error"]["message"]
        .as_str()
        .unwrap()
        .contains("extension artifact"));
}

#[test]
fn reproduction_keeps_the_core_sixteen_mib_request_bound() {
    let padding = "x".repeat(16 * 1024 * 1024);
    let request = format!(
        "{{\"api_version\":{{\"major\":1,\"minor\":0,\"patch\":0}},\"request_id\":\"oversized-reproduction\",\"operation\":\"reproduce\",\"payload\":{{\"padding\":\"{padding}\"}}}}"
    );
    let response: Value = serde_json::from_str(&senkei_wasm::dispatch_json(&request))
        .expect("oversized request still receives valid JSON error");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "resource_limit");
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("16777216-byte core adapter limit"));
}
