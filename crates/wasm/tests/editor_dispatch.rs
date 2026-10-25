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
