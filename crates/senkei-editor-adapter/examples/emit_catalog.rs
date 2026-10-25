fn main() {
    print!(
        "{}",
        senkei_editor_adapter::next_catalog_json().expect("verified next package catalog")
    );
}
