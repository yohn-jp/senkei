use enbu::new_match_context;
use jinrei::{compile, Vm};
use senkei_model::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn dispatch(operation: &str, payload: Value) -> Value {
    let request = json!({
        "api_version": WASM_API_VERSION,
        "request_id": "next-decision-integration",
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
        DomainType::Enum { values, .. } => values.iter().next().cloned().map(DomainValue::Enum),
        DomainType::Entity { .. } => None,
        DomainType::Optional(_) => Some(DomainValue::Null),
        DomainType::List { .. } | DomainType::Vector { .. } | DomainType::Matrix { .. } => {
            Some(DomainValue::List(Vec::new()))
        }
        DomainType::Record { fields } => fields
            .iter()
            .map(|(field, ty)| Some((field.clone(), domain_default(ty)?)))
            .collect::<Option<BTreeMap<_, _>>>()
            .map(DomainValue::Record),
    }
}

fn army(rules: &VerifiedRulePlan, side: CombatantSide) -> SenkeiSnapshot {
    let next = rules.plan().next.as_ref().unwrap();
    let (prefix, start) = match side {
        CombatantSide::Attacker => ("attacker", &next.map.attacker_base),
        CombatantSide::Defender => ("defender", &next.map.defender_base),
    };
    let mut configuration = BTreeMap::new();
    for (field, schema) in &rules.plan().domain.senkei_configuration {
        if let Some(value) = schema.default.clone().or_else(|| domain_default(&schema.value_type)) {
            configuration.insert(field.clone(), value);
        } else {
            assert!(!schema.required, "required fixture field {field}");
        }
    }
    let heroes = next.heroes.iter().take(5).enumerate().map(|(index, hero)| {
        DomainValue::Record(BTreeMap::from([
            (FieldId::from("slot_id"), DomainValue::String(format!("{prefix}-{}", index + 1))),
            (FieldId::from("catalog_id"), DomainValue::String(hero.id.clone())),
            (FieldId::from("squad"), DomainValue::String(format!("squad-{index}"))),
            (FieldId::from("node"), DomainValue::String(start.clone())),
            (
                FieldId::from("skill_path"),
                DomainValue::String(hero.skill_paths.keys().next().unwrap().clone()),
            ),
        ]))
    }).collect();
    configuration.insert(FieldId::from("heroes"), DomainValue::List(heroes));
    let program = compile("senkei inspection { state inert { false, }, }", rules)
        .expect("fixture program compiles")
        .program;
    SenkeiSnapshot {
        schema_version: rules.plan().model_version,
        id: ArtifactId::new(format!("{prefix}-private-snapshot")),
        revision: RevisionId::new("1"),
        ruleset: rules.ruleset().clone(),
        configuration,
        program,
        initial_memory: TacticalMemory::new(),
    }
}

struct Fixture {
    rules: VerifiedRulePlan,
    snapshot: ReproductionSnapshot,
    payload: Value,
}

fn fixture() -> Fixture {
    let response = dispatch("next_reproduction_assets", json!({}));
    assert_eq!(response["ok"], true, "builtin reproduction assets: {response}");
    let assets: ReproductionAssets = serde_json::from_value(response["result"].clone()).unwrap();
    let definition = serde_json::from_value(assets.world_definition.clone()).unwrap();
    let world = senkei_world::compile(definition).unwrap();
    let mut resolver = senkei_world::WorldResolver::default();
    resolver.insert(world).unwrap();
    let extension = assets
        .catalog_metadata_extension
        .clone()
        .map(|value| serde_json::from_value(value).unwrap());
    let rules = senritsu::validate_with_world_resolver_and_catalog_extension(
        assets.rule_package.clone(),
        &senritsu::next_engine_compatibility(),
        &resolver,
        extension,
    ).unwrap();
    let mut context = new_match_context(&rules, MatchId::new("next-decision-dispatch"));
    context.max_ticks = 2;
    let term = BehaviorScoreTerm { signal: BehaviorSignal::Constant, weight: 1 };
    context.next_behavior = Some(NextBehaviorMatch {
        policy: NextBehaviorPolicy {
            schema_version: 1,
            policy_id: "test-inspection".into(),
            version: Version::new(1, 0, 0),
            ruleset_digest: rules.package_digest().clone(),
            test_only: true,
            composition: BehaviorComposition {
                hero_aggregation: BehaviorHeroAggregation::MeanFloor,
                override_order: BehaviorOverrideOrder::ArmyThenSquad,
                action_order: BehaviorActionOrder::ScoreDescThenActionIdAsc,
                targeting_profile: BehaviorTargetingProfile::TargetHealthWeight,
            },
            hero_defaults: rules.plan().next.as_ref().unwrap().heroes.iter()
                .map(|hero| (hero.id.clone(), NextBehaviorProfile::default())).collect(),
            domains: BehaviorDomains {
                navigation: vec![term.clone()],
                engagement: vec![term.clone()],
                targeting: vec![term.clone()],
                pursuit: vec![term.clone()],
                survival: vec![term.clone()],
                objective: vec![term],
            },
            candidates: vec![BehaviorCandidateDefinition {
                kind: BehaviorCandidateKind::Move,
                capability: "move".into(),
                arguments: vec![BehaviorArgument::Actor, BehaviorArgument::ObjectiveNode],
            }],
        },
        inputs: NextBehaviorExecutionInputs { schema_version: 1, ..Default::default() },
    });
    let snapshot = ReproductionSnapshot {
        attacker: army(&rules, CombatantSide::Attacker),
        defender: army(&rules, CombatantSide::Defender),
        context,
    };
    let snapshot_digest = enbu::reproduction_snapshot_digest(
        &snapshot.attacker, &snapshot.defender, &snapshot.context,
    ).unwrap();
    let payload = json!({
        "format_version": 1,
        "assets": assets,
        "snapshot": snapshot,
        "snapshot_digest": snapshot_digest,
        "authorized_side": "attacker",
        "selector": { "tick": 1, "slot_id": "attacker-1" },
    });
    Fixture { rules, snapshot, payload }
}

fn refresh_snapshot_digest(payload: &mut Value) {
    let snapshot: ReproductionSnapshot = serde_json::from_value(payload["snapshot"].clone()).unwrap();
    payload["snapshot_digest"] = json!(enbu::reproduction_snapshot_digest(
        &snapshot.attacker, &snapshot.defender, &snapshot.context,
    ).unwrap());
}

fn assert_error(payload: Value, expected_code: &str) -> Value {
    let response = dispatch("inspect_next_decision", payload);
    assert_eq!(response["ok"], false, "unexpected success: {response}");
    assert_eq!(response["error"]["code"], expected_code, "{response}");
    assert!(response["result"].is_null());
    response
}

#[test]
fn inspection_dispatch_matches_direct_enbu_for_each_authorized_side() {
    let fixture = fixture();
    for (side, wire_side, slot, private_opponent_prefix) in [
        (CombatantSide::Attacker, "attacker", "attacker-1", "defender"),
        (CombatantSide::Defender, "defender", "defender-1", "attacker"),
    ] {
        let mut payload = fixture.payload.clone();
        payload["authorized_side"] = json!(wire_side);
        payload["selector"]["slot_id"] = json!(slot);
        let direct = enbu::inspect_next_decision(
            &fixture.snapshot.attacker,
            &fixture.snapshot.defender,
            &fixture.rules,
            &fixture.snapshot.context,
            side,
            1,
            slot,
            &mut Vm::new(&fixture.rules),
        ).expect("direct Enbu inspection succeeds");
        let response = dispatch("inspect_next_decision", payload.clone());
        assert_eq!(response["ok"], true, "{response}");
        assert_eq!(response["result"], serde_json::to_value(direct).unwrap());
        assert_eq!(response["result"]["format_version"], 1);
        assert_eq!(response["result"]["identity"]["snapshot_digest"], payload["snapshot_digest"]);
        assert_eq!(response["result"]["identity"]["authorized_side"], wire_side);
        assert_eq!(response["result"]["identity"]["selector"], payload["selector"]);
        assert_eq!(response["result"]["policy"]["id"], "test-inspection");
        assert_eq!(response["result"]["observation"]["identity_space"], "inspection_observed");
        assert!(response["result"]["observation"]["snapshot"].is_object());
        assert_eq!(response["result"]["decision"]["status"], "evaluated");
        assert!(response["result"]["decision"]["subject"].as_str().unwrap().starts_with("observed-"));
        assert!(!response["result"]["decision"]["candidates"].as_array().unwrap().is_empty());
        assert_eq!(
            dispatch("inspect_next_decision", payload)["result"],
            response["result"],
            "inspection must be deterministic"
        );
        let encoded = response["result"].to_string();
        for index in 1..=5 {
            assert!(
                !encoded.contains(&format!("{private_opponent_prefix}-{index}")),
                "opponent slot must remain private: {encoded}"
            );
        }
        assert!(!encoded.contains("private-snapshot"), "retained snapshot must not be returned: {encoded}");
        for field in ["owner_replays", "diagnostics", "trace", "catalog_stamp"] {
            assert!(response["result"].get(field).is_none(), "unexpected response channel {field}");
        }
    }
}

#[test]
fn inspection_strictly_checks_format_side_and_nested_fields() {
    let valid = fixture().payload;
    let mut version = valid.clone();
    version["format_version"] = json!(2);
    assert_error(version, "invalid_version");

    let mut no_version = valid.clone();
    no_version.as_object_mut().unwrap().remove("format_version");
    assert_error(no_version, "invalid_request");

    let mut no_side = valid.clone();
    no_side.as_object_mut().unwrap().remove("authorized_side");
    assert_error(no_side, "invalid_request");

    let mut bad_side = valid.clone();
    bad_side["authorized_side"] = json!("spectator");
    assert_error(bad_side, "invalid_request");

    let mut missing_selector = valid.clone();
    missing_selector["selector"].as_object_mut().unwrap().remove("slot_id");
    assert_error(missing_selector, "invalid_request");

    let mut negative_tick = valid.clone();
    negative_tick["selector"]["tick"] = json!(-1);
    assert_error(negative_tick, "invalid_request");

    for (path, field) in [
        ("payload", "future_field"),
        ("selector", "future_selector"),
        ("snapshot", "future_snapshot"),
        ("assets", "future_asset"),
        ("army", "future_army"),
        ("context", "future_context"),
        ("package", "future_package"),
        ("hero", "future_hero"),
    ] {
        let mut payload = valid.clone();
        let target = match path {
            "payload" => &mut payload,
            "selector" => &mut payload["selector"],
            "snapshot" => &mut payload["snapshot"],
            "assets" => &mut payload["assets"],
            "army" => &mut payload["snapshot"]["attacker"],
            "context" => &mut payload["snapshot"]["context"],
            "package" => &mut payload["assets"]["rule_package"],
            "hero" => &mut payload["snapshot"]["attacker"]["configuration"]["heroes"]["value"][0],
            _ => unreachable!(),
        };
        target[field] = json!(true);
        let response = assert_error(payload, "invalid_request");
        assert!(response["error"]["message"].as_str().unwrap().contains(field), "{response}");
    }
}

#[test]
fn inspection_validates_retained_assets_and_full_snapshot_digest() {
    let valid = fixture().payload;
    let mut asset_version = valid.clone();
    asset_version["assets"]["format_version"] = json!(2);
    assert_error(asset_version, "invalid_version");

    let mut package = valid.clone();
    package["assets"]["rule_package"]["ruleset"]["digest"] = json!("0".repeat(64));
    assert_error(package, "invalid_ruleset");

    let mut world = valid.clone();
    world["assets"]["world_definition"]["id"] = json!("different-world");
    assert_error(world, "validation_failed");

    let mut digest = valid.clone();
    digest["snapshot_digest"] = json!("f".repeat(64));
    assert_error(digest, "invalid_snapshot");

    let mut opponent = valid.clone();
    opponent["snapshot"]["defender"]["id"] = json!("tampered-opponent");
    assert_error(opponent, "invalid_snapshot");

    let mut owner = valid.clone();
    owner["snapshot"]["attacker"]["id"] = json!("tampered-owner");
    assert_error(owner, "invalid_snapshot");

    let mut context = valid;
    context["snapshot"]["context"]["max_ticks"] = json!(1);
    assert_error(context, "invalid_snapshot");
}

#[test]
fn inspection_rejects_unowned_slots_and_ticks_outside_the_run() {
    let valid = fixture().payload;
    for slot in ["defender-1", "missing-slot", ""] {
        let mut payload = valid.clone();
        payload["selector"]["slot_id"] = json!(slot);
        assert_error(payload, "invalid_request");
    }
    for tick in [0, 3] {
        let mut payload = valid.clone();
        payload["selector"]["tick"] = json!(tick);
        assert_error(payload, "invalid_request");
    }
}

#[test]
fn inspection_enforces_request_and_response_limits() {
    let valid = fixture().payload;
    let mut payload = valid.clone();
    payload["snapshot"]["context"]["host_limits"]["max_output_bytes"] = json!(128);
    refresh_snapshot_digest(&mut payload);
    assert_error(payload, "resource_limit");

    let mut diagnostics = valid;
    diagnostics["snapshot"]["context"]["host_limits"]["max_diagnostic_events"] = json!(0);
    refresh_snapshot_digest(&mut diagnostics);
    assert_error(diagnostics, "resource_limit");

    let padding = "x".repeat(16 * 1024 * 1024);
    let request = format!(
        "{{\"api_version\":{{\"major\":1,\"minor\":0,\"patch\":0}},\"request_id\":\"oversized-inspection\",\"operation\":\"inspect_next_decision\",\"payload\":{{\"padding\":\"{padding}\"}}}}"
    );
    let response: Value = serde_json::from_str(&senkei_wasm::dispatch_json(&request)).unwrap();
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "resource_limit");
    assert_eq!(response["request_id"], "oversized-inspection");
}
