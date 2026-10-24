use senkei_model::{RulePackage, Version};
use std::collections::BTreeMap;

fn refresh_digest(package: &mut RulePackage) {
    package.ruleset.digest = senritsu::canonical_digest(package)
        .expect("Next package must have canonical JSON serialization");
}

#[test]
fn next_package_is_versioned_and_covers_the_initial_catalog() {
    let package = senritsu::next_package();
    let next = package.next.as_ref().expect("next package contains finite NextRules");

    assert_eq!(package.ruleset.id.as_str(), "senkei.next");
    assert_eq!(package.ruleset.version, Version::new(1, 0, 0));
    assert_eq!(next.mechanics_version, Version::new(1, 0, 0));
    assert_eq!(package.minimum_engine_version, Version::new(1, 1, 0));
    assert_eq!(next.parameters["xp_scale"], 2_520);

    assert_eq!(next.heroes.len(), 12, "the initial catalog has twelve Heroes");
    let mut placement_counts = BTreeMap::<&str, usize>::new();
    let mut hero_ids = Vec::new();
    for hero in &next.heroes {
        *placement_counts.entry(hero.placement.as_str()).or_default() += 1;
        hero_ids.push(hero.id.as_str());
        assert!(!hero.skill_paths.is_empty(), "{} has a prepared skill path", hero.id);
        assert!(!hero.skills.is_empty(), "{} has catalog skills", hero.id);
        assert!(hero.stats.hp > 0 && hero.stats.speed > 0, "{} has usable baseline stats", hero.id);
        for (path, skills) in &hero.skill_paths {
            assert!(!path.is_empty(), "{} has a nonempty skill path name", hero.id);
            assert!(!skills.is_empty(), "{} path {path} has at least one skill", hero.id);
            for skill in skills {
                assert!(hero.skills.iter().any(|definition| &definition.id == skill),
                    "{} path {path} references catalog skill {skill}", hero.id);
            }
        }
    }
    hero_ids.sort_unstable();
    hero_ids.dedup();
    assert_eq!(hero_ids.len(), next.heroes.len(), "Hero catalog IDs are unique");
    assert_eq!(placement_counts.get("frontline"), Some(&6));
    assert_eq!(placement_counts.get("backline"), Some(&6));

    let lanes = next.map.lanes.keys().map(String::as_str).collect::<Vec<_>>();
    assert_eq!(lanes, vec!["bot", "mid", "top"]);
    assert!(next.map.edges.iter().all(|edge| edge.length > 0));
    assert!(!next.camps.is_empty(), "the map includes jungle camps");
    assert!(next.camps.iter().all(|camp| next.monsters.iter().any(|monster| monster.id == camp.monster)));

    let compatibility = senritsu::next_engine_compatibility();
    senritsu::validate(package, &compatibility)
        .expect("the published Next package validates against its engine declaration");
}

#[test]
fn next_package_contains_the_agreed_movement_factors() {
    let package = senritsu::next_package();
    let next = package.next.expect("next package contains finite NextRules");
    let factors = next.parameters;

    assert_eq!(factors["terrain_lane_speed_milli"], 1_000);
    assert_eq!(factors["terrain_jungle_speed_milli"], 800);
    assert_eq!(factors["minion_vision_speed_milli"], 1_200);
    for (squad_size, expected) in [(1, 1_000), (2, 950), (3, 900), (4, 850), (5, 800)] {
        assert_eq!(factors[&format!("squad_{squad_size}_speed_milli")], expected);
    }

    let expected = [
        [1_000, 1_200, 800, 960],
        [950, 1_140, 760, 912],
        [900, 1_080, 720, 864],
        [850, 1_020, 680, 816],
        [800, 960, 640, 768],
    ];
    for squad_size in 1..=5 {
        let squad_factor = factors[&format!("squad_{squad_size}_speed_milli")];
        for (column, (terrain_factor, vision_factor)) in [
            (1_000_i64, 1_000_i64),
            (1_000, 1_200),
            (800, 1_000),
            (800, 1_200),
        ]
        .into_iter()
        .enumerate()
        {
            let composed_milli = terrain_factor * vision_factor * squad_factor / 1_000_000;
            assert_eq!(composed_milli, expected[squad_size as usize - 1][column],
                "squad {squad_size}, terrain factor {terrain_factor}, vision factor {vision_factor}");
        }
    }
}

#[test]
fn next_package_rejects_unsupported_mechanics_and_engine_versions() {
    let compatibility = senritsu::next_engine_compatibility();
    let mut unknown_mechanics = senritsu::next_package();
    let next = unknown_mechanics.next.as_mut().expect("next package contains finite NextRules");
    next.mechanics_version = Version::new(99, 0, 0);
    refresh_digest(&mut unknown_mechanics);
    assert!(senritsu::validate(unknown_mechanics, &compatibility).is_err(),
        "an unknown major mechanics version must be rejected after a valid digest is supplied");

    let mut older_engine = compatibility.clone();
    older_engine.engine = Version::new(1, 0, 0);
    assert!(senritsu::validate(senritsu::next_package(), &older_engine).is_err(),
        "Next requires its declared Enbu 1.1.0-compatible engine");

    let mut missing_primitives = compatibility;
    missing_primitives.available_primitives.clear();
    assert!(senritsu::validate(senritsu::next_package(), &missing_primitives).is_err(),
        "the package requires the published finite navigation, vision, squads, and combat primitives");

}
