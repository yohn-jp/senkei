use enbu::new_match_context;
use jinrei::compile;
use senkei_model::*;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

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

fn validate_retained_assets(assets: &ReproductionAssets) -> VerifiedRulePlan {
    let definition: senkei_world::WorldDefinition =
        serde_json::from_value(assets.world_definition.clone()).expect("typed retained World");
    let world = senkei_world::compile(definition).expect("retained World compiles");
    let mut resolver = senkei_world::WorldResolver::default();
    resolver.insert(world).expect("retained World has a unique exact identity");
    let extension = assets
        .catalog_metadata_extension
        .clone()
        .map(|value| serde_json::from_value(value).expect("typed retained extension"));
    senritsu::validate_with_world_resolver_and_catalog_extension(
        assets.rule_package.clone(),
        &senritsu::next_engine_compatibility(),
        &resolver,
        extension,
    )
    .expect("retained package validates with its exact World and extension")
}

fn valid_reproduction_request() -> (Value, Value) {
    let assets = dispatch("next_reproduction_assets", json!({}));
    assert_eq!(assets["ok"], true, "current package and World assets are available");
    valid_reproduction_request_from_assets(assets["result"].clone())
}

fn valid_reproduction_request_from_assets(asset_value: Value) -> (Value, Value) {
    let parsed_assets: ReproductionAssets =
        serde_json::from_value(asset_value.clone()).expect("typed reproduction assets");
    let rules = validate_retained_assets(&parsed_assets);
    let extension_present = parsed_assets.catalog_metadata_extension.is_some();
    let mut context = new_match_context(&rules, MatchId::new("reproduction-api-test"));
    context.max_ticks = 1;
    let snapshot = ReproductionSnapshot {
        attacker: valid_snapshot(&rules, CombatantSide::Attacker),
        defender: valid_snapshot(&rules, CombatantSide::Defender),
        context,
    };
    let snapshot_digest = enbu::reproduction_snapshot_digest(
        &snapshot.attacker,
        &snapshot.defender,
        &snapshot.context,
    )
    .expect("canonical snapshot digest");
    let baseline = if extension_present {
        let mut vm = jinrei::Vm::new(&rules);
        let artifact = enbu::simulate(
            &snapshot.attacker,
            &snapshot.defender,
            &rules,
            &snapshot.context,
            &mut vm,
        )
        .expect("same-runtime fixture simulation succeeds");
        json!({"ok": true, "result": artifact.diagnostic_response(CombatantSide::Attacker)})
    } else {
        let response = dispatch(
            "simulate",
            json!({
                "attacker": snapshot.attacker.clone(),
                "defender": snapshot.defender.clone(),
                "context": snapshot.context.clone(),
                "include_diagnostics": true,
                "diagnostics_side": "attacker",
            }),
        );
        assert_eq!(response["ok"], true, "same-runtime baseline simulation succeeds");
        response
    };
    let request = json!({
        "assets": asset_value,
        "snapshot": snapshot,
        "snapshot_digest": snapshot_digest,
        "include_diagnostics": true,
        "diagnostics_side": "attacker",
    });
    (request, baseline["result"].clone())
}

fn fixture_extension_assets() -> Value {
    let mut assets = dispatch("next_reproduction_assets", json!({}))["result"].clone();
    let mut package: RulePackage =
        serde_json::from_value(assets["rule_package"].clone()).unwrap();
    let initial_plan = senritsu::validate(
        package.clone(),
        &senritsu::next_engine_compatibility(),
    )
    .unwrap();
    let field_id = "navigation.mode".to_owned();
    let value = DomainValue::String("safest".to_owned());
    let mut extension = senritsu::CatalogMetadataExtension {
        schema_version: senritsu::DOMAIN_CATALOG_SCHEMA_VERSION,
        ruleset_id: initial_plan.ruleset().id.clone(),
        ruleset_version: initial_plan.ruleset().version,
        ruleset_digest: initial_plan.package_digest().clone(),
        entity_scopes: BTreeMap::new(),
        capabilities: BTreeMap::new(),
        behavior_profiles: senritsu::BehaviorProfileMetadata {
            cross_capability_order: None,
            inheritance_order: vec![
                senritsu::ProfileLayer::SenritsuDefault,
                senritsu::ProfileLayer::HeroCatalogDefault,
                senritsu::ProfileLayer::ArmyPreference,
                senritsu::ProfileLayer::SquadAggregate,
                senritsu::ProfileLayer::JinreiConditionalPreference,
            ],
            fields: BTreeMap::from([(
                field_id.clone(),
                senritsu::BehaviorFieldDefinition {
                    value_type: DomainType::String { max_bytes: 64 },
                    scopes: BTreeSet::from([senritsu::BehaviorScope::Hero]),
                    aggregation: None,
                    override_policy: senritsu::BehaviorOverridePolicy {
                        conditional_tick_override: true,
                        persistent_capability: None,
                    },
                    description: "Fixture navigation preference".into(),
                    unit: None,
                },
            )]),
            senritsu_default: BTreeMap::from([(field_id.clone(), value.clone())]),
            hero_defaults: BTreeMap::new(),
            presets: BTreeMap::from([(
                "navigation.safest".into(),
                senritsu::NamedBehaviorPreset {
                    name: "Safest path".into(),
                    scope: senritsu::BehaviorScope::Hero,
                    values: BTreeMap::from([(field_id, value)]),
                    description: "Fixture named preference".into(),
                },
            )]),
        },
    };
    package.catalog_semantics_digest = Some(
        senritsu::catalog::catalog_semantics_digest(&extension).unwrap(),
    );
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    extension.ruleset_digest = package.ruleset.digest.clone();
    senritsu::validate_with_catalog_extension(
        package.clone(),
        &senritsu::next_engine_compatibility(),
        extension.clone(),
    )
    .expect("fixture package binds its authored metadata extension");
    assets["rule_package"] = serde_json::to_value(package).unwrap();
    assets["catalog_metadata_extension"] = serde_json::to_value(extension).unwrap();
    assets
}

fn preflight_request_from(reproduction: &Value) -> Value {
    json!({
        "assets": reproduction["assets"],
        "snapshot": reproduction["snapshot"],
        "snapshot_digest": reproduction["snapshot_digest"],
    })
}

#[test]
fn retained_preflight_validates_exact_inputs_without_simulating() {
    let (reproduction, _) = valid_reproduction_request();
    let preflight = dispatch("preflight_reproduction", preflight_request_from(&reproduction));
    assert_eq!(preflight["ok"], true, "retained exact package and World pass Ready validation");
    assert!(preflight["result"].is_null(), "preflight returns no match result or replay");
}

#[test]
fn retained_preflight_rejects_snapshot_digest_before_run() {
    let (reproduction, _) = valid_reproduction_request();
    let mut preflight_request = preflight_request_from(&reproduction);
    preflight_request["snapshot_digest"] = json!("f".repeat(64));
    let preflight = dispatch("preflight_reproduction", preflight_request);
    assert_eq!(preflight["ok"], false);
    assert_eq!(preflight["error"]["code"], "invalid_snapshot");
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
fn retained_catalog_extension_is_verified_and_reproduces_with_exact_world() {
    let (request, baseline) = valid_reproduction_request_from_assets(fixture_extension_assets());
    let ready = dispatch("preflight_reproduction", preflight_request_from(&request));
    assert_eq!(ready["ok"], true, "typed Catalog extension and retained World pass Ready validation");
    assert!(ready["result"].is_null());

    let reproduced = dispatch("reproduce", request);
    assert_eq!(reproduced["ok"], true, "verified Catalog extension is accepted for exact rerun");
    assert_eq!(reproduced["result"], baseline);
}

#[test]
fn retained_catalog_extension_rejects_tampering_and_unbound_fields() {
    let (valid, _) = valid_reproduction_request_from_assets(fixture_extension_assets());

    let mut tampered = valid.clone();
    tampered["assets"]["catalog_metadata_extension"]["rulesetDigest"] = json!("0".repeat(64));
    let rejected = dispatch("reproduce", tampered);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "validation_failed");

    let mut unknown = preflight_request_from(&valid);
    unknown["assets"]["catalog_metadata_extension"]["unbound_note"] = json!("must not be ignored");
    let rejected = dispatch("preflight_reproduction", unknown);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "validation_failed");
    assert!(rejected["error"]["message"]
        .as_str()
        .unwrap()
        .contains("unrecognized or noncanonical fields"));
}

#[test]
fn reproduction_rejects_tampered_package_world_snapshot_and_missing_world() {
    let (valid, _) = valid_reproduction_request();

    let mut package = valid.clone();
    package["assets"]["rule_package"]["ruleset"]["digest"] = json!("0".repeat(64));
    let rejected = dispatch("reproduce", package);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_ruleset");

    let mut package = preflight_request_from(&valid);
    package["assets"]["rule_package"]["ruleset"]["digest"] = json!("0".repeat(64));
    let preflight_rejected = dispatch("preflight_reproduction", package);
    assert_eq!(preflight_rejected["ok"], false);
    assert_eq!(preflight_rejected["error"]["code"], "invalid_ruleset");

    let mut world = valid.clone();
    world["assets"]["world_definition"]["id"] = json!("different-world");
    let rejected = dispatch("reproduce", world);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "validation_failed");

    let mut world = preflight_request_from(&valid);
    world["assets"]["world_definition"]["id"] = json!("different-world");
    let preflight_rejected = dispatch("preflight_reproduction", world);
    assert_eq!(preflight_rejected["ok"], false);
    assert_eq!(preflight_rejected["error"]["code"], "validation_failed");

    let mut snapshot = valid.clone();
    snapshot["snapshot_digest"] = json!("f".repeat(64));
    let rejected = dispatch("reproduce", snapshot);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_snapshot");

    let mut preflight_snapshot = preflight_request_from(&valid);
    preflight_snapshot["snapshot_digest"] = json!("f".repeat(64));
    let rejected = dispatch("preflight_reproduction", preflight_snapshot);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_snapshot");

    let mut missing_world = valid;
    missing_world["assets"].as_object_mut().unwrap().remove("world_definition");
    let rejected = dispatch("reproduce", missing_world);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_request");
}

#[test]
fn reproduction_rejects_unknown_fields_recursively_before_hash_projection() {
    let (valid, _) = valid_reproduction_request();

    let mut package = valid.clone();
    package["assets"]["rule_package"]["future_semantics"] = json!({ "damage": 99 });
    let rejected = dispatch("reproduce", package);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_request");
    assert!(rejected["error"]["message"].as_str().unwrap().contains("future_semantics"));

    let mut side = valid.clone();
    side["snapshot"]["attacker"]["future_input"] = json!({ "program": "ignored" });
    let rejected = dispatch("reproduce", side);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_request");
    assert!(rejected["error"]["message"].as_str().unwrap().contains("future_input"));

    let mut identity = preflight_request_from(&valid);
    identity["snapshot"]["context"]["world_identity"]["future_compiler"] = json!({ "patch": 7 });
    let rejected = dispatch("preflight_reproduction", identity);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_request");
    assert!(rejected["error"]["message"].as_str().unwrap().contains("future_compiler"));

    let mut context = preflight_request_from(&valid);
    context["snapshot"]["context"]["future_policy"] = json!({ "max_ticks": 0 });
    let rejected = dispatch("preflight_reproduction", context);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_request");
    assert!(rejected["error"]["message"].as_str().unwrap().contains("future_policy"));

    let mut nested_array = valid.clone();
    nested_array["snapshot"]["attacker"]["configuration"]["heroes"]["value"][0]["future_slot_input"] = json!({ "level": 9 });
    let rejected = dispatch("reproduce", nested_array);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_request");
    assert!(rejected["error"]["message"].as_str().unwrap().contains("future_slot_input"));

    let mut nested_package_array = valid.clone();
    nested_package_array["assets"]["rule_package"]["phases"][0]["future_phase_policy"] = json!({ "order": 1 });
    let rejected = dispatch("reproduce", nested_package_array);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_request");
    assert!(rejected["error"]["message"].as_str().unwrap().contains("future_phase_policy"));

    let mut nested_package_map = valid.clone();
    let entity_types = nested_package_map["assets"]["rule_package"]["world"]["entity_types"]
        .as_object_mut()
        .unwrap();
    entity_types.values_mut().next().unwrap()["future_entity_schema"] = json!({ "field": "ignored" });
    let rejected = dispatch("reproduce", nested_package_map);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_request");
    assert!(rejected["error"]["message"].as_str().unwrap().contains("future_entity_schema"));
}

#[test]
fn reproduction_accepts_known_optional_null_extension_field() {
    let (mut valid, baseline) = valid_reproduction_request();
    valid["assets"]["catalog_metadata_extension"] = Value::Null;
    let reproduced = dispatch("reproduce", valid);
    assert_eq!(reproduced["ok"], true, "known optional null stays equivalent to an absent extension");
    assert_eq!(reproduced["result"], baseline);
}

#[test]
fn reproduction_and_ready_reject_unknown_enum_payload_fields() {
    let (valid, _) = valid_reproduction_request();
    let cases = [
        (
            "future_domain_value_semantics",
            {
                let mut request = valid.clone();
                request["snapshot"]["attacker"]["initial_memory"]["fixture-value"] = json!({
                    "kind": "null",
                    "future_domain_value_semantics": true
                });
                request
            },
        ),
        (
            "future_domain_bound",
            {
                let mut request = valid.clone();
                request["assets"]["rule_package"]["world"]["entity_types"]["base"]["fields"]["attack"]["value_type"]["value"]["future_domain_bound"] = json!(5);
                request
            },
        ),
        (
            "future_expression_semantics",
            {
                let mut request = valid.clone();
                request["assets"]["rule_package"]["termination"]["conditions"] = json!([{
                    "order": 1,
                    "when": {
                        "kind": "equal",
                        "value": {
                            "left": { "kind": "current_tick" },
                            "right": { "kind": "current_tick" },
                            "future_expression_semantics": true
                        }
                    },
                    "outcome": "draw",
                    "reason": "fixture"
                }]);
                request
            },
        ),
        (
            "future_primitive_semantics",
            {
                let mut request = valid.clone();
                request["assets"]["rule_package"]["transitions"] = json!([{
                    "id": "strict-enum-fixture",
                    "phase": "transition",
                    "order": 1,
                    "capability": null,
                    "when": null,
                    "operations": [{
                        "kind": "set_field",
                        "target": { "kind": "intent_actor" },
                        "field": "hp",
                        "value": { "kind": "current_tick" },
                        "future_primitive_semantics": true
                    }]
                }]);
                request
            },
        ),
    ];

    for (field, request) in cases {
        let reproduce = dispatch("reproduce", request.clone());
        assert_eq!(reproduce["ok"], false, "reproduce must reject {field}");
        assert_eq!(reproduce["error"]["code"], "invalid_request", "{field}");
        assert!(reproduce["error"]["message"].as_str().unwrap().contains(field));

        let ready = dispatch("preflight_reproduction", preflight_request_from(&request));
        assert_eq!(ready["ok"], false, "preflight must reject {field}");
        assert_eq!(ready["error"]["code"], "invalid_request", "{field}");
        assert!(ready["error"]["message"].as_str().unwrap().contains(field));
    }
}

#[test]
fn reproduction_keeps_known_enum_null_and_optional_fields() {
    let (valid, _) = valid_reproduction_request();

    let mut null_domain_value = valid.clone();
    null_domain_value["snapshot"]["attacker"]["initial_memory"]["fixture-null"] = json!({ "kind": "null" });
    let rejected = dispatch("reproduce", null_domain_value);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_snapshot", "canonical DomainValue::Null parses before digest comparison");

    let mut optional_bounds = valid;
    optional_bounds["assets"]["rule_package"]["world"]["entity_types"]["base"]["fields"]["attack"]["value_type"]["value"]["min"] = Value::Null;
    let rejected = dispatch("preflight_reproduction", preflight_request_from(&optional_bounds));
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "invalid_ruleset", "known optional DomainType bound parses before package digest verification");
}

#[test]
fn reproduction_rejects_unsupported_world_compiler_and_missing_catalog_extension() {
    let (valid, _) = valid_reproduction_request();

    let mut compiler = valid.clone();
    compiler["assets"]["rule_package"]["next"]["world_identity"]["compiler_version"]["patch"] = json!(u16::MAX);
    let rejected = dispatch("reproduce", compiler);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "incompatible_version");

    let mut compiler = preflight_request_from(&valid);
    compiler["assets"]["rule_package"]["next"]["world_identity"]["compiler_version"]["patch"] = json!(u16::MAX);
    let preflight_rejected = dispatch("preflight_reproduction", compiler);
    assert_eq!(preflight_rejected["ok"], false);
    assert_eq!(preflight_rejected["error"]["code"], "incompatible_version");

    let mut package: RulePackage = serde_json::from_value(valid["assets"]["rule_package"].clone()).unwrap();
    package.catalog_semantics_digest = Some(ContentDigest::new("c".repeat(64)));
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    let mut extension = valid.clone();
    extension["assets"]["rule_package"] = serde_json::to_value(package).unwrap();
    let rejected = dispatch("reproduce", extension);
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "validation_failed");
    assert!(rejected["error"]["details"]["issues"]
        .as_str()
        .unwrap()
        .contains("missing_catalog_semantics_extension"));

    let mut extension = preflight_request_from(&valid);
    let mut package: RulePackage = serde_json::from_value(extension["assets"]["rule_package"].clone()).unwrap();
    package.catalog_semantics_digest = Some(ContentDigest::new("c".repeat(64)));
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    extension["assets"]["rule_package"] = serde_json::to_value(package).unwrap();
    let preflight_rejected = dispatch("preflight_reproduction", extension);
    assert_eq!(preflight_rejected["ok"], false);
    assert_eq!(preflight_rejected["error"]["code"], "validation_failed");
    assert!(preflight_rejected["error"]["details"]["issues"]
        .as_str()
        .unwrap()
        .contains("missing_catalog_semantics_extension"));
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
