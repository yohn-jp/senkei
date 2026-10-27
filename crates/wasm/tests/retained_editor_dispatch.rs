use senkei_model::*;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[path = "../../senkei-editor-adapter/tests/support/profile_catalog.rs"]
mod profile_catalog;

const CUSTOM_SOURCE: &str = "senkei control { action army_all { when match.tick == 1, do trial_army(), }, action lane_mid { when match.tick == 1, do trial_lane(beta), }, }";
const BUILTIN_SOURCE: &str = "senkei editor_test { action hold { when true, do move(argmin hero in allies.heroes by hero.level then hero.id, \"attacker_base\"), }, }";

fn dispatch(operation: &str, payload: Value) -> Value {
    let request = json!({
        "api_version": WASM_API_VERSION,
        "request_id": "retained-editor-integration",
        "operation": operation,
        "payload": payload,
    });
    serde_json::from_str(&senkei_wasm::dispatch_bytes(request.to_string().as_bytes()))
        .expect("valid dispatcher response")
}

fn builtin_assets() -> Value {
    let response = dispatch("next_reproduction_assets", json!({}));
    assert_eq!(response["ok"], true, "{response}");
    response["result"].clone()
}

// A real, test-only Minion package, authored the same way as the Enbu Minion
// control integration fixture. It is deliberately not a bundled RulePackage.
fn minion_assets() -> Value {
    let mut package = senritsu::next_local_trial_package();
    for name in ["behavior_preference", "select_target"] {
        package.domain.capabilities.remove(&CapabilityId::from(name));
        package.arbitration.remove(&CapabilityId::from(name));
    }
    package.domain.symbol_domains.remove(&SymbolDomainId::from("behavior_domain"));
    let values = BTreeMap::from([
        (SymbolId::new("alpha"), MinionLane::Top),
        (SymbolId::new("beta"), MinionLane::Mid),
        (SymbolId::new("gamma"), MinionLane::Bot),
    ]);
    let variants: BTreeSet<_> = values.keys().cloned().collect();
    package.next.as_mut().unwrap().minion_control = Some(NextMinionControlDeclaration {
        schema_version: 1,
        version: Version::new(1, 0, 0),
        test_only: true,
        scope_resolution: MinionControlScopeResolution::LaneOverridesArmy,
        capabilities: BTreeMap::from([
            ("trial_army".into(), MinionControlCapability {
                scope: MinionControlScope::Army,
                candidate: MinionBehaviorCandidate::LaneWaypoint,
            }),
            ("trial_lane".into(), MinionControlCapability {
                scope: MinionControlScope::Lane { values },
                candidate: MinionBehaviorCandidate::LaneWaypoint,
            }),
        ]),
    });
    package.domain.symbol_domains.insert("fixture_lane".into(), variants.clone());
    let move_cap = package.domain.capabilities[&CapabilityId::from("move")].clone();
    for name in ["trial_army", "trial_lane"] {
        let arguments = if name == "trial_army" { Vec::new() } else {
            vec![ParameterSchema {
                id: "lane".into(),
                value_type: DomainType::Enum { domain: "fixture_lane".into(), values: variants.clone() },
                optional: false,
            }]
        };
        package.domain.capabilities.insert(name.into(), CapabilitySchema {
            arguments,
            actor_argument: None,
            target_argument: None,
            target_type: None,
            target_owner: TargetOwnerConstraint::Any,
            phases: move_cap.phases.clone(),
            preconditions: Vec::new(),
            issue_cost: move_cap.issue_cost.clone(),
        });
        package.arbitration.insert(name.into(), ArbitrationRule {
            conflict_keys: if name == "trial_army" {
                vec![IntentKey::Side]
            } else {
                vec![IntentKey::Side, IntentKey::Argument(0)]
            },
            resolution: ArbitrationResolution::RejectConflicts,
        });
    }
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    let mut assets = builtin_assets();
    assets["rule_package"] = json!(package);
    assets
}

fn catalog(assets: &Value) -> (String, Value, Value) {
    let response = dispatch("editor_catalog_retained", json!({ "assets": assets }));
    assert_eq!(response["ok"], true, "{response}");
    let canonical = response["result"].as_str().unwrap().to_owned();
    let parsed: Value = serde_json::from_str(&canonical).unwrap();
    let stamp = json!({
        "identity": parsed["identity"],
        "catalogDigest": parsed["catalogDigest"],
        "metadataExtensionDigest": parsed["metadataExtensionDigest"],
    });
    (canonical, parsed, stamp)
}

fn compile_payload(assets: &Value, source: &str, stamp: &Value) -> Value {
    json!({ "assets": assets, "source": source, "stamp": stamp, "revision": 42 })
}

fn assert_error(operation: &str, payload: Value, code: &str) -> Value {
    let response = dispatch(operation, payload);
    assert_eq!(response["ok"], false, "{response}");
    assert_eq!(response["error"]["code"], code, "{response}");
    assert!(response["result"].is_null());
    response
}

#[test]
fn retained_minion_catalog_compiles_authored_capabilities_with_exact_identity() {
    let assets = minion_assets();
    let (_, parsed, stamp) = catalog(&assets);
    assert_eq!(parsed["identity"]["rulesetDigest"], assets["rule_package"]["ruleset"]["digest"]);
    assert!(parsed["capabilities"].get("trial_army").is_some());
    assert!(parsed["capabilities"].get("trial_lane").is_some());
    let response = dispatch("editor_compile_retained", compile_payload(&assets, CUSTOM_SOURCE, &stamp));
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(response["result"]["revision"], 42);
    assert_eq!(response["result"]["reply"]["status"], "compiled", "{response}");
    assert_eq!(response["result"]["reply"]["stamp"], stamp);
    assert_eq!(response["result"]["reply"]["result"]["program"]["ruleset"]["digest"], assets["rule_package"]["ruleset"]["digest"]);

    let builtin = dispatch("editor_catalog", json!({}));
    let built: Value = serde_json::from_str(builtin["result"].as_str().unwrap()).unwrap();
    let builtin_stamp = json!({ "identity": built["identity"], "catalogDigest": built["catalogDigest"], "metadataExtensionDigest": built["metadataExtensionDigest"] });
    let old_compiler = dispatch("editor_compile", json!({ "source": CUSTOM_SOURCE, "stamp": builtin_stamp, "revision": 42 }));
    assert_eq!(old_compiler["result"]["reply"]["status"], "rejected");
    assert_error("editor_compile_retained", compile_payload(&assets, CUSTOM_SOURCE, &builtin_stamp), "invalid_ruleset");
}

#[test]
fn retained_builtin_catalog_and_compile_match_existing_operations() {
    let assets = builtin_assets();
    let (retained_json, _, stamp) = catalog(&assets);
    let builtin = dispatch("editor_catalog", json!({}));
    assert_eq!(retained_json, builtin["result"].as_str().unwrap());
    let retained = dispatch("editor_compile_retained", compile_payload(&assets, BUILTIN_SOURCE, &stamp));
    let existing = dispatch("editor_compile", json!({ "source": BUILTIN_SOURCE, "stamp": stamp, "revision": 42 }));
    assert_eq!(retained["ok"], true, "{retained}");
    assert_eq!(retained["result"], existing["result"]);
    let rejected = dispatch("editor_compile_retained", compile_payload(&assets, "senkei x { action bad { when true, do missing(), }, }", &stamp));
    assert_eq!(rejected["ok"], true);
    assert_eq!(rejected["result"]["reply"]["status"], "rejected");
}

#[test]
fn retained_catalog_preserves_and_binds_the_authored_metadata_extension() {
    let (package, extension) = profile_catalog::authored_profile_package();
    let mut assets = builtin_assets();
    assets["rule_package"] = json!(package);
    assets["catalog_metadata_extension"] = json!(extension);
    let (canonical, parsed, stamp) = catalog(&assets);
    assert_eq!(canonical, profile_catalog::authored_profile_catalog_json());
    assert!(!parsed["metadataExtensionDigest"].is_null());
    assert_eq!(parsed["behaviorProfiles"]["status"], "authored_extension");
    let response = dispatch("editor_compile_retained", compile_payload(&assets, BUILTIN_SOURCE, &stamp));
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(response["result"]["reply"]["status"], "compiled");
    assert_eq!(response["result"]["reply"]["stamp"], stamp);

    let mut stale = stamp.clone();
    stale["metadataExtensionDigest"] = json!("0".repeat(64));
    assert_error("editor_compile_retained", compile_payload(&assets, BUILTIN_SOURCE, &stale), "invalid_ruleset");
    let mut missing = assets.clone();
    missing["catalog_metadata_extension"] = Value::Null;
    assert_error("editor_catalog_retained", json!({"assets": missing}), "validation_failed");
    let mut modified = assets;
    modified["catalog_metadata_extension"]["unexpected"] = json!(true);
    assert_error("editor_catalog_retained", json!({"assets": modified}), "validation_failed");
}

#[test]
fn retained_operations_reject_tampering_stale_stamps_and_unknown_fields() {
    let assets = minion_assets();
    let (_, _, stamp) = catalog(&assets);
    let mut bad_digest = assets.clone();
    bad_digest["rule_package"]["ruleset"]["digest"] = json!("0".repeat(64));
    for operation in ["editor_catalog_retained", "editor_compile_retained", "format_ast_retained"] {
        let payload = match operation {
            "editor_catalog_retained" => json!({ "assets": bad_digest }),
            "editor_compile_retained" => compile_payload(&bad_digest, CUSTOM_SOURCE, &stamp),
            _ => json!({ "assets": bad_digest, "ast": jinrei::parse(CUSTOM_SOURCE).unwrap() }),
        };
        assert_error(operation, payload, "invalid_ruleset");
    }
    let mut bad_world = assets.clone();
    bad_world["world_definition"]["id"] = json!("different-world");
    assert_error("editor_catalog_retained", json!({"assets": bad_world}), "validation_failed");

    let mut stale = stamp.clone();
    stale["catalogDigest"] = json!("0".repeat(64));
    assert_error("editor_compile_retained", compile_payload(&assets, CUSTOM_SOURCE, &stale), "invalid_ruleset");
    let mut stale_identity = stamp.clone();
    stale_identity["identity"]["rulesetDigest"] = json!("f".repeat(64));
    assert_error("editor_compile_retained", compile_payload(&assets, CUSTOM_SOURCE, &stale_identity), "invalid_ruleset");

    let mut unknown_catalog = json!({ "assets": assets, "future": true });
    assert_error("editor_catalog_retained", unknown_catalog.take(), "invalid_request");
    let mut unknown = compile_payload(&assets, CUSTOM_SOURCE, &stamp);
    unknown["stamp"]["future"] = json!(true);
    assert_error("editor_compile_retained", unknown, "invalid_request");
    let mut unknown = compile_payload(&assets, CUSTOM_SOURCE, &stamp);
    unknown["assets"]["rule_package"]["future"] = json!(true);
    assert_error("editor_compile_retained", unknown, "invalid_request");
}

#[test]
fn retained_format_uses_real_formatter_and_rejects_invalid_ast() {
    let assets = minion_assets();
    let ast = jinrei::parse(CUSTOM_SOURCE).unwrap();
    let formatted = dispatch("format_ast_retained", json!({ "assets": assets, "ast": ast }));
    assert_eq!(formatted["ok"], true, "{formatted}");
    assert_eq!(formatted["result"], jinrei::format(&ast).unwrap());
    let (_, _, stamp) = catalog(&assets);
    let compiled = dispatch("editor_compile_retained", compile_payload(&assets, formatted["result"].as_str().unwrap(), &stamp));
    assert_eq!(compiled["result"]["reply"]["status"], "compiled", "{compiled}");

    let mut invalid = json!({ "assets": assets, "ast": ast });
    invalid["ast"]["program_name"] = json!("not a valid identifier");
    assert_error("format_ast_retained", invalid, "validation_failed");
    let mut invalid_version = json!({ "assets": assets, "ast": ast });
    invalid_version["ast"]["schema_version"]["major"] = json!(99);
    assert_error("format_ast_retained", invalid_version, "incompatible_version");
    let mut unknown = json!({ "assets": assets, "ast": ast });
    unknown["ast"]["future"] = json!(true);
    assert_error("format_ast_retained", unknown, "invalid_request");
}

#[test]
fn retained_operations_enforce_source_and_output_limits() {
    let mut assets = minion_assets();
    let (_, _, stamp) = catalog(&assets);
    let limit = assets["rule_package"]["limits"]["max_input_bytes"].as_u64().unwrap();
    let source = "x".repeat(limit as usize + 1);
    let rejected = dispatch("editor_compile_retained", compile_payload(&assets, &source, &stamp));
    assert_eq!(rejected["ok"], true, "{rejected}");
    assert_eq!(rejected["result"]["reply"]["status"], "rejected");
    assert_eq!(rejected["result"]["reply"]["error"]["code"], "resource_limit");

    let mut package: RulePackage = serde_json::from_value(assets["rule_package"].clone()).unwrap();
    package.limits.max_output_bytes = 128;
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    assets["rule_package"] = json!(package);
    assert_error("editor_catalog_retained", json!({ "assets": assets }), "resource_limit");
    let ast = jinrei::parse(CUSTOM_SOURCE).unwrap();
    assert_error("format_ast_retained", json!({ "assets": assets, "ast": ast }), "resource_limit");
}
