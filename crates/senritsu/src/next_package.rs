use senkei_model::*;
/// Independently versioned next Senritsu; initial package remains unchanged.
pub fn next_package() -> RulePackage {
    let mut package=crate::initial_package();
    package.ruleset.id="senkei.next".into();
    package.ruleset.version=Version::new(1,0,0);
    package.minimum_engine_version=Version::new(1,1,0);
    package.next=Some(crate::next_content::content(crate::next_world::battle_map()));
    crate::next_domain::configure(&mut package);
    package.ruleset.digest=crate::canonical_digest(&package).expect("canonical next package");
    package
}
pub fn next_engine_compatibility() -> EngineCompatibility {
    let mut engine=crate::initial_engine_compatibility();
    engine.engine=Version::new(1,1,0);
    engine
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_next_package_validates() {
        let p=next_package();
        if let Err(issues)=crate::validate(p,&next_engine_compatibility()) { panic!("{issues:#?}"); }
    }
}
