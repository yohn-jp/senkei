use serde_json::{json, Value};

fn dispatch(operation: &str, payload: Value) -> Value {
    let request = json!({
        "api_version": senkei_model::WASM_API_VERSION,
        "request_id": "editor-integration",
        "operation": operation,
        "payload": payload,
    });
    serde_json::from_str(&senkei_wasm::dispatch_bytes(request.to_string().as_bytes()))
        .expect("dispatcher response is valid JSON")
}

#[test]
fn editor_dispatch_uses_the_real_catalog_and_catalog_stamped_jinrei_compiler() {
    let catalog_response = dispatch("editor_catalog", json!({}));
    assert_eq!(catalog_response["ok"], true);
    let catalog_json = catalog_response["result"]
        .as_str()
        .expect("editor Catalog remains canonical JSON text");
    let catalog: Value = serde_json::from_str(catalog_json).expect("producer Catalog is JSON");
    assert_eq!(catalog["identity"]["rulesetId"], "senkei.next");
    assert_eq!(catalog["catalogDigest"].as_str().unwrap().len(), 64);

    let stamp = json!({
        "identity": catalog["identity"],
        "catalogDigest": catalog["catalogDigest"],
        "metadataExtensionDigest": catalog["metadataExtensionDigest"],
    });
    let source = "senkei editor_test { action hold { when true, do move(argmin hero in allies.heroes by hero.level then hero.id, \"attacker_base\"), }, }";
    let compiled = dispatch(
        "editor_compile",
        json!({ "source": source, "stamp": stamp, "revision": 11 }),
    );
    assert_eq!(compiled["ok"], true);
    assert_eq!(compiled["result"]["revision"], 11);
    assert_eq!(compiled["result"]["reply"]["status"], "compiled");
    assert!(compiled["result"]["reply"]["result"]["estimated_cu"]
        .as_u64()
        .unwrap()
        > 0);

    let rejected = dispatch(
        "editor_compile",
        json!({
            "source": "senkei editor_test { action bad { when true, do missing(), }, }",
            "stamp": stamp,
            "revision": 12,
        }),
    );
    assert_eq!(rejected["ok"], true);
    assert_eq!(rejected["result"]["revision"], 12);
    assert_eq!(rejected["result"]["reply"]["status"], "rejected");

    let stale_stamp = json!({
        "identity": catalog["identity"],
        "catalogDigest": "0".repeat(64),
        "metadataExtensionDigest": catalog["metadataExtensionDigest"],
    });
    let stale = dispatch(
        "editor_compile",
        json!({ "source": source, "stamp": stale_stamp, "revision": 13 }),
    );
    assert_eq!(stale["ok"], false);
    assert_eq!(stale["error"]["code"], "invalid_ruleset");
}

#[test]
fn editor_catalog_operation_requires_an_empty_payload() {
    let response = dispatch("editor_catalog", json!({ "ruleset_id": "senkei.next" }));
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "invalid_request");
}

#[test]
fn local_trial_selection_binds_catalog_compiler_and_context_to_its_exact_digest() {
    let trial = dispatch("next_ruleset", json!({"local_trial":true}));
    assert_eq!(trial["ok"], true);
    assert_eq!(trial["result"]["next"]["projection_policy"]["test_only"], true);
    let ordinary = dispatch("next_ruleset", json!({}));
    assert_ne!(trial["result"]["ruleset"]["digest"], ordinary["result"]["ruleset"]["digest"]);
    let catalog_response = dispatch("editor_catalog", json!({"local_trial":true}));
    let catalog: Value = serde_json::from_str(catalog_response["result"].as_str().unwrap()).unwrap();
    assert_eq!(catalog["identity"]["rulesetDigest"], trial["result"]["ruleset"]["digest"]);
    let compiled = dispatch("editor_compile", json!({"source":"senkei local_trial { action inactive_order { when false, do retreat(argmin hero in allies.heroes by hero.level then hero.id), }, }","stamp":{
        "identity":catalog["identity"],"catalogDigest":catalog["catalogDigest"],"metadataExtensionDigest":catalog["metadataExtensionDigest"]},"revision":1}));
    assert_eq!(compiled["ok"], true, "{compiled}");
    assert_eq!(compiled["result"]["reply"]["status"], "compiled", "{compiled}");
    let context = dispatch("new_match_context", json!({"ruleset_ref":trial["result"]["ruleset"],"match_id":"trial-context"}));
    assert_eq!(context["ok"], true, "{context}");
    let assets = dispatch("next_reproduction_assets", json!({"local_trial":true}));
    assert_eq!(assets["result"]["rule_package"]["ruleset"], trial["result"]["ruleset"]);
    assert_eq!(dispatch("next_ruleset", json!({"local_trial":"true"}))["ok"], false);
}
