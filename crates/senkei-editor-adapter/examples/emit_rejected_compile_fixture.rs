use serde_json::Value;

fn main() {
    let catalog: Value = serde_json::from_str(
        &senkei_editor_adapter::next_catalog_json().expect("verified catalog"),
    )
    .expect("catalog JSON");
    let request = senkei_editor_adapter::EditorCompileRequest {
        source: "senkei editor_test { action bad { when true, do missing(), }, }".into(),
        stamp: serde_json::from_value(serde_json::json!({
            "identity": catalog["identity"],
            "catalogDigest": catalog["catalogDigest"],
            "metadataExtensionDigest": catalog["metadataExtensionDigest"],
        }))
        .expect("catalog stamp"),
        revision: 9,
    };
    print!(
        "{}",
        senkei_editor_adapter::compile_next_json(
            &serde_json::to_string(&request).expect("request JSON")
        )
        .expect("real Jinrei diagnostic")
    );
}
