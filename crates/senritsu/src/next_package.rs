use senkei_model::*;
/// Independently versioned next Senritsu; initial package remains unchanged.
pub fn next_package() -> RulePackage {
    let mut package = crate::initial_package();
    package.ruleset.id = "senkei.next".into();
    package.next = Some(crate::next_content::content(crate::next_world::battle_map()));
    crate::next_domain::configure(&mut package);
    package.ruleset.version = Version::new(2, 0, 0);
    package.minimum_engine_version = Version::new(1, 2, 0);
    package.ruleset.digest = crate::canonical_digest(&package).expect("canonical next package");
    package
}
pub fn next_engine_compatibility() -> EngineCompatibility {
    let mut engine = crate::initial_engine_compatibility();
    engine.engine = Version::new(1, 2, 0);
    engine.available_primitives.extend([
        TransitionPrimitiveKind::BattleNavigation,
        TransitionPrimitiveKind::BattleVision,
        TransitionPrimitiveKind::BattleSquads,
        TransitionPrimitiveKind::BattleCombat,
    ]);
    engine
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_next_package_validates() {
        let p = next_package();
        if let Err(issues) = crate::validate(p, &next_engine_compatibility()) {
            panic!("{issues:#?}");
        }
    }
    #[test]
    fn versioned_parameter_tuning_can_advance_the_ruleset_patch() {
        let mut package = next_package();
        package.next.as_mut().unwrap().parameters.insert("ford_extra_ticks".into(), 25);
        package.ruleset.version = Version::new(2, 0, 1);
        package.ruleset.digest = crate::canonical_digest(&package).unwrap();
        crate::validate(package, &next_engine_compatibility())
            .expect("versioned numeric tuning preserves canonical topology");
    }
    #[test]
    fn canonical_battlefield_rejects_unlisted_shortcuts_even_with_a_fresh_digest() {
        let mut package = next_package();
        let next = package.next.as_mut().unwrap();
        next.map.edges.push(MapEdge { id: "shortcut".into(), from: "A.TOP.J".into(), to: "A.MID.J".into(), length: 1, region: "lane".into(), blocked: false, bridge_site: String::new(), ford: false });
        package.ruleset.digest = crate::canonical_digest(&package).unwrap();
        let issues = crate::validate(package, &next_engine_compatibility()).unwrap_err();
        assert!(issues.iter().any(|issue| issue.path == "next.map.edges"));
    }
}
