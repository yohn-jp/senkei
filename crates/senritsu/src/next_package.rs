use senkei_model::*;
/// Independently versioned next Senritsu; initial package remains unchanged.
pub fn next_package() -> RulePackage {
    let mut package = crate::initial_package();
    package.ruleset.id = "senkei.next".into();
    package.next = Some(crate::next_content::content(crate::next_world::battle_map()));
    package.next.as_mut().unwrap().world_identity = package
        .next
        .as_ref()
        .and_then(|next| next.map.world_identity.clone());
    crate::next_domain::configure(&mut package);
    package.ruleset.version = Version::new(2, 0, 0);
    package.minimum_engine_version = ENBU_ENGINE_VERSION;
    package.ruleset.digest = crate::canonical_digest(&package).expect("canonical next package");
    package
}
pub fn next_engine_compatibility() -> EngineCompatibility {
    let mut engine = crate::initial_engine_compatibility();
    engine.engine = ENBU_ENGINE_VERSION;
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
    fn canonical_world_package_requires_enbu_1_3_without_raising_initial_minimum() {
        let mut old_engine = next_engine_compatibility();
        old_engine.engine = Version::new(1, 2, 0);
        assert!(crate::validate(next_package(), &old_engine).is_err(),
            "Enbu 1.2 must reject canonical World projection and crossing interval semantics");
        crate::validate(crate::initial_package(), &old_engine)
            .expect("the initial RulePackage remains compatible with Enbu 1.2");
    }
    #[test]
    fn next_validation_resolves_the_exact_world_and_projection() {
        let package = next_package();
        crate::validate(package.clone(), &next_engine_compatibility())
            .expect("default validation resolves the built-in immutable World");

        let empty = senkei_world::WorldResolver::default();
        let issues = crate::validate_with_world_resolver(
            package.clone(),
            &next_engine_compatibility(),
            &empty,
        ).unwrap_err();
        assert!(issues.iter().any(|issue| issue.code == "world_artifact_missing"));

        let mut other_world = crate::next_world::builtin_world_definition();
        other_world.presentation.materials[0].color = "#010203".into();
        let other_world = senkei_world::compile(other_world).unwrap();
        let mut wrong_resolver = senkei_world::WorldResolver::default();
        wrong_resolver.insert(other_world).unwrap();
        let issues = crate::validate_with_world_resolver(
            package,
            &next_engine_compatibility(),
            &wrong_resolver,
        ).unwrap_err();
        assert!(issues.iter().any(|issue| issue.code == "world_identity_mismatch"));
    }

    #[test]
    fn next_validation_rejects_self_digested_forged_projection() {
        let mut package = next_package();
        package.next.as_mut().unwrap().map.world_projection.as_mut().unwrap()
            .edge_facts.values_mut().next().unwrap().terrain_profile_id = "forged-profile".into();
        package.ruleset.digest = crate::canonical_digest(&package).unwrap();
        let issues = crate::validate(package, &next_engine_compatibility()).unwrap_err();
        assert!(issues.iter().any(|issue| issue.code == "world_projection_mismatch"));
    }
    #[test]
    fn presentation_artifact_is_paired_and_exact_validated_but_not_a_rule_digest_input() {
        let mut package = next_package();
        let original = crate::canonical_digest(&package).unwrap();
        package.next.as_mut().unwrap().map.world_projection.as_mut().unwrap()
            .presentation_artifact.content["lighting"]["key_percent"] = serde_json::json!(999);
        assert_eq!(crate::canonical_digest(&package).unwrap(), original);
        package.ruleset.digest = original;
        let issues = crate::validate(package, &next_engine_compatibility()).unwrap_err();
        assert!(issues.iter().any(|issue| issue.code == "world_projection_mismatch"));
    }
    #[test]
    fn package_rejects_missing_or_mismatched_paired_world_identity() {
        let mut missing = next_package();
        missing.next.as_mut().unwrap().world_identity = None;
        missing.ruleset.digest = crate::canonical_digest(&missing).unwrap();
        let issues = crate::validate(missing, &next_engine_compatibility()).unwrap_err();
        assert!(issues.iter().any(|issue| issue.code == "invalid_next_rules" && issue.path == "next.world_identity"));

        let mut mismatch = next_package();
        mismatch.next.as_mut().unwrap().map.world_identity.as_mut().unwrap().world_id = "other-world".into();
        mismatch.ruleset.digest = crate::canonical_digest(&mismatch).unwrap();
        let issues = crate::validate(mismatch, &next_engine_compatibility()).unwrap_err();
        assert!(issues.iter().any(|issue| issue.code == "invalid_next_rules" && issue.path == "next.map.world_identity"));
    }
    #[test]
    fn package_cannot_be_verified_without_referenced_behavior_extension() {
        let mut package = next_package();
        package.catalog_semantics_digest = Some(senkei_model::ContentDigest::new("c".repeat(64)));
        package.ruleset.digest = crate::canonical_digest(&package).unwrap();
        let issues = crate::validate(package, &next_engine_compatibility()).unwrap_err();
        assert!(issues.iter().any(|issue| issue.code == "missing_catalog_semantics_extension"));
    }
    #[test]
    fn presentation_only_map_changes_do_not_change_rule_package_digest_but_logical_changes_do() {
        let mut package = next_package();
        let original = crate::canonical_digest(&package).unwrap();
        {
            let next = package.next.as_mut().unwrap();
            next.map.nodes.values_mut().next().unwrap().presentation_x += 123;
            next.map.nodes.values_mut().next().unwrap().presentation_y += 456;
            next.map.world_identity.as_mut().unwrap().presentation_digest =
                senkei_model::ContentDigest::new("a".repeat(64));
            next.world_identity.as_mut().unwrap().presentation_digest =
                senkei_model::ContentDigest::new("a".repeat(64));
        }
        assert_eq!(crate::canonical_digest(&package).unwrap(), original);

        let next = package.next.as_mut().unwrap();
        next.map.nodes.values_mut().next().unwrap().x += 123;
        assert_ne!(crate::canonical_digest(&package).unwrap(), original);
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
    fn canonical_battlefield_rejects_missing_digest_refreshed_parameters() {
        let mut package = next_package();
        package.next.as_mut().unwrap().parameters.remove("bridge_hp");
        package.ruleset.digest = crate::canonical_digest(&package).unwrap();

        let issues = crate::validate(package, &next_engine_compatibility()).unwrap_err();
        assert!(issues.iter().any(|issue| {
            issue.path == "next.parameters.bridge_hp"
                && issue.message.contains("required canonical v2 parameter")
        }), "freshly digested packages may not silently inherit engine parameter defaults: {issues:#?}");
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
