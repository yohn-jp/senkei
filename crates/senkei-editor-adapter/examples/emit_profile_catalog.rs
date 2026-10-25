#[path = "../tests/support/profile_catalog.rs"]
mod profile_catalog;

fn main() {
    print!("{}", profile_catalog::authored_profile_catalog_json());
}
