#[path = "support/profile_catalog.rs"]
mod profile_catalog;

#[test]
fn producer_profile_fixture_is_stable_and_authored() {
    let first = profile_catalog::authored_profile_catalog_json();
    let second = profile_catalog::authored_profile_catalog_json();
    assert_eq!(first, second);
    let value: serde_json::Value = serde_json::from_str(&first).unwrap();
    assert_eq!(value["behaviorProfiles"]["status"], "authored_extension");
    assert_eq!(
        value["behaviorProfiles"]["value"]["metadata"]["fields"]["navigation.mode"]["valueType"]
            ["kind"],
        "string"
    );
    assert_eq!(
        value["behaviorProfiles"]["value"]["metadata"]["presets"]["navigation.safest"]["scope"],
        "hero"
    );
    assert_eq!(
        first,
        include_str!(
            "../../../packages/jinrei-editor/fixtures/next-domain-catalog-with-profile.json"
        )
    );
}
