use senkei_model::*;
use std::collections::{BTreeMap, BTreeSet};

/// Additional finite-system invariants, before constructing a VerifiedRulePlan.
pub(crate) fn validate_next(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    let Some(r) = &package.next else { return };
    let mut check = |ok: bool, path: &str, message: &str| {
        if !ok {
            issues.push(ValidationIssue::new("invalid_next_rules", path, message));
        }
    };
    let paired_world_matches = match (&r.world_identity, &r.map.world_identity) {
        (Some(package_world), Some(map_world)) => {
            let profile_complete = package_world.validation_profile_id.is_some()
                == package_world.validation_profile_version.is_some();
            check(!package_world.world_id.trim().is_empty(), "next.world_identity.world_id", "World ID cannot be empty");
            check(package_world.logic_digest.has_sha256_shape(), "next.world_identity.logic_digest", "World logic digest must be lowercase SHA-256");
            check(package_world.presentation_digest.has_sha256_shape(), "next.world_identity.presentation_digest", "World presentation digest must be lowercase SHA-256");
            check(profile_complete, "next.world_identity.validation_profile", "validation profile ID and version must be supplied together");
            package_world == map_world
        }
        _ => false,
    };
    check(r.world_identity.is_some(), "next.world_identity", "next RulePackage must bind the exact paired identity of its compiled World");
    check(r.map.world_identity.is_some(), "next.map.world_identity", "runtime BattleMap projection must carry its source World identity");
    check(paired_world_matches, "next.map.world_identity", "RulePackage and BattleMap must refer to the exact same paired World identity");
    match (&r.world_identity, &r.map.world_projection) {
        (Some(identity), Some(projection)) => {
            check(projection.source_identity == *identity, "next.map.world_projection.source_identity", "runtime projection must preserve its exact source World identity");
            check(projection.schema_version == Version::new(1, 0, 0), "next.map.world_projection.schema_version", "unsupported runtime BattleMap projection schema");
            let node_ids: BTreeSet<_> = r.map.nodes.keys().cloned().collect();
            check(projection.node_ids == node_ids, "next.map.world_projection.node_ids", "runtime projection must preserve every source node ID exactly");
            let edge_ids: BTreeSet<_> = r.map.edges.iter().map(|edge| edge.id.clone()).collect();
            let fact_ids: BTreeSet<_> = projection.edge_facts.keys().cloned().collect();
            check(edge_ids == fact_ids, "next.map.world_projection.edge_facts", "runtime projection must preserve facts for every source edge ID exactly");
            let edges: BTreeMap<_, _> = r.map.edges.iter().map(|edge| (edge.id.as_str(), edge)).collect();
            for (edge_id, facts) in &projection.edge_facts {
                let Some(edge) = edges.get(edge_id.as_str()) else { continue };
                let track_ids_unique: BTreeSet<_> = facts.tracks.iter().map(|track| track.id.as_str()).collect();
                check(track_ids_unique.len() == facts.tracks.len() && !facts.tracks.is_empty(), "next.map.world_projection.edge_facts.tracks", "each source edge must retain a unique non-empty track set");
                for track in &facts.tracks {
                    check(track.start_progress_wu < track.end_progress_wu && track.end_progress_wu <= edge.length.max(0) as u64, "next.map.world_projection.edge_facts.tracks", "track ranges must be non-empty and fit the source edge length");
                }
                if let Some(crossing) = &facts.river_crossing {
                    check(crossing.start_progress_wu < crossing.end_progress_wu && crossing.end_progress_wu <= edge.length.max(0) as u64, "next.map.world_projection.edge_facts.river_crossing", "crossing ranges must be non-empty and fit the source edge length");
                    check(crossing.river_id.trim().len() > 0, "next.map.world_projection.edge_facts.river_crossing", "river ID cannot be empty");
                    let expected_site = crossing.bridge_site_id.as_deref().unwrap_or("");
                    check(edge.bridge_site == expected_site, "next.map.world_projection.edge_facts.river_crossing", "runtime bridge-site identity must match the source crossing");
                    check(edge.ford == (crossing.kind == "foot_ford"), "next.map.world_projection.edge_facts.river_crossing", "runtime ford flag must match the source crossing kind");
                } else {
                    check(edge.bridge_site.is_empty() && !edge.ford, "next.map.world_projection.edge_facts.river_crossing", "runtime edge must not invent a bridge site or ford absent from the source");
                }
                check(!facts.terrain_profile_id.is_empty(), "next.map.world_projection.edge_facts.terrain_profile_id", "source terrain profile identity must be retained");
            }
            for (site_id, site_edges) in &projection.bridge_sites {
                check(site_edges.iter().all(|edge_id| projection.edge_facts.get(edge_id).is_some_and(|facts| facts.river_crossing.as_ref().and_then(|crossing| crossing.bridge_site_id.as_ref()) == Some(site_id))), "next.map.world_projection.bridge_sites", "bridge sites must enumerate exactly their source crossing edges");
            }
        }
        _ => check(false, "next.map.world_projection", "canonical next BattleMap requires a versioned World projection preserving tracks, crossing intervals, bridge sites, and terrain facts"),
    }
    let mut supported = package.clone();
    crate::next_domain::configure(&mut supported);
    check(
        package.domain == supported.domain && package.world == supported.world,
        "domain",
        "next finite primitives require their registered typed visibility and capability schema",
    );
    check(
        package.transitions.is_empty(),
        "transitions",
        "next mechanics execute only their registered finite phases",
    );
    for value in r.parameters.values() {
        check(
            (0..=1_000_000).contains(value),
            "next.parameters",
            "parameters must fit bounded nonnegative deterministic arithmetic",
        );
    }
    // Canonical v2 behavior must be represented in the digest-covered package,
    // not silently selected from Enbu's implementation fallback values. Keep
    // the set tied to content so adding a canonical parameter makes it required
    // automatically; values remain tunable within the bounded range above.
    let required_parameters =
        crate::next_content::content(crate::next_world::battle_map()).parameters;
    for key in required_parameters.keys() {
        let path = format!("next.parameters.{key}");
        check(
            r.parameters.contains_key(key),
            &path,
            "required canonical v2 parameter must be present in the versioned package",
        );
    }
    for unit in r.minions.iter().chain(r.monsters.iter()) {
        check(
            (0..=1_000_000).contains(&unit.xp),
            "next.units.xp",
            "XP rewards exceed supported bounds",
        );
    }
    check(
        r.parameters.get("vision_graph_metric") == Some(&1),
        "next.parameters.vision_graph_metric",
        "Battlefield v2 vision uses legal graph-distance metric 1",
    );
    check(
        r.parameters.get("vision_occlusion_enabled") == Some(&0),
        "next.parameters.vision_occlusion_enabled",
        "Battlefield v2 visibility does not use geometric occlusion",
    );
    check(
        r.parameters.get("xp_scale") == Some(&2520),
        "next.parameters.xp_scale",
        "exact XP storage requires 2520 quanta per XP",
    );
    check(
        package.ruleset.id.as_str() == "senkei.next"
            && package.ruleset.version.major == 2
            && package.ruleset.version >= Version::new(2, 0, 0),
        "ruleset.version",
        "canonical Battlefield topology requires senkei.next ruleset version 2.x",
    );
    check(
        r.mechanics_version == Version::new(2, 0, 0),
        "next.mechanics_version",
        "unsupported finite battle mechanics version",
    );
    check(
        package.minimum_engine_version >= ENBU_ENGINE_VERSION,
        "minimum_engine_version",
        "authored actor-local intent arbitration requires Enbu 1.4.0",
    );
    check(
        r.heroes.len() == 12,
        "next.heroes",
        "catalog must contain exactly twelve Heroes",
    );
    check(
        r.heroes
            .iter()
            .filter(|h| h.placement == "frontline")
            .count()
            == 6
            && r.heroes
                .iter()
                .filter(|h| h.placement == "backline")
                .count()
                == 6,
        "next.heroes.placement",
        "six frontline and six backline Heroes are required",
    );
    for (key, value) in [
        ("terrain_lane_speed_milli", 1000),
        ("terrain_jungle_speed_milli", 800),
        ("minion_vision_speed_milli", 1200),
        ("squad_1_speed_milli", 1000),
        ("squad_2_speed_milli", 950),
        ("squad_3_speed_milli", 900),
        ("squad_4_speed_milli", 850),
        ("squad_5_speed_milli", 800),
    ] {
        check(
            r.parameters.get(key) == Some(&value),
            "next.parameters",
            "agreed initial movement ratios must be preserved",
        );
    }
    let ids: BTreeSet<_> = r.heroes.iter().map(|h| h.id.as_str()).collect();
    check(ids.len() == 12, "next.heroes", "Hero IDs must be unique");
    for prefix in ["F", "R"] {
        for n in 1..=6 {
            check(
                ids.contains(format!("{prefix}{n:02}").as_str()),
                "next.heroes",
                "catalog requires F01–F06 and R01–R06",
            );
        }
    }
    for h in &r.heroes {
        check(
            h.stats.hp > 0
                && h.stats.speed > 0
                && h.stats.attack_interval > 0
                && h.stats.range >= 0,
            "next.heroes.stats",
            "invalid Hero stats",
        );
        check(
            !h.skill_paths.is_empty() && !h.skills.is_empty(),
            "next.heroes.skills",
            "Heroes require configured skill paths",
        );
        let skills: BTreeSet<_> = h.skills.iter().map(|s| s.id.as_str()).collect();
        check(
            skills.len() == h.skills.len(),
            "next.heroes.skills",
            "duplicate skill ID",
        );
        for skill in &h.skills {
            check(
                (0..=1_000_000).contains(&skill.cooldown)
                    && (0..=1_000_000).contains(&skill.duration)
                    && (0..=1_000_000).contains(&skill.power)
                    && (0..=1_000_000).contains(&skill.range)
                    && (0..=1_000_000).contains(&skill.cost)
                    && skill.unlock_level >= 1
                    && skill
                        .prerequisites
                        .iter()
                        .all(|id| skills.contains(id.as_str())),
                "next.heroes.skills",
                "invalid skill prerequisites or cost",
            );
        }
        for path in h.skill_paths.values() {
            let mut acquired = BTreeSet::new();
            for id in path {
                if let Some(skill) = h.skills.iter().find(|s| &s.id == id) {
                    check(
                        skill.prerequisites.iter().all(|p| acquired.contains(p)),
                        "next.heroes.skill_paths",
                        "path does not satisfy prerequisite order",
                    );
                    acquired.insert(id.clone());
                } else {
                    check(
                        false,
                        "next.heroes.skill_paths",
                        "path references absent skill",
                    );
                }
            }
        }
    }
    check(
        r.map.nodes.contains_key(&r.map.attacker_base)
            && r.map.nodes.contains_key(&r.map.defender_base),
        "next.map",
        "map bases must exist",
    );
    check(
        r.map.attacker_base != r.map.defender_base,
        "next.map",
        "bases must be distinct",
    );
    validate_battlefield_topology(r, &mut check);
    for node in r.map.nodes.values() {
        check(
            (-1_000_000..=1_000_000).contains(&node.x)
                && (-1_000_000..=1_000_000).contains(&node.y),
            "next.map.nodes",
            "coordinates exceed deterministic bounds",
        );
    }
    for edge in &r.map.edges {
        check(
            edge.length > 0
                && edge.length <= 1_000_000
                && edge.from != edge.to
                && r.map.nodes.contains_key(&edge.from)
                && r.map.nodes.contains_key(&edge.to),
            "next.map.edges",
            "edges require positive bounded length and existing endpoints",
        );
    }
    for lane in ["top", "mid", "bot"] {
        check(
            r.map.lanes.get(lane).is_some_and(|p| {
                p.len() >= 2
                    && p.first() == Some(&r.map.attacker_base)
                    && p.last() == Some(&r.map.defender_base)
                    && p.iter().all(|id| r.map.nodes.contains_key(id))
            }),
            "next.map.lanes",
            "all three base-to-base lanes are required",
        );
    }
    for camp in &r.camps {
        check(
            r.map.nodes.contains_key(&camp.node)
                && r.monsters.iter().any(|m| m.id == camp.monster)
                && camp.respawn_ticks > 0,
            "next.camps",
            "invalid camp position/type/respawn",
        );
    }
    let camp_nodes: BTreeSet<_> = r.camps.iter().map(|camp| camp.node.as_str()).collect();
    check(
        r.camps.len() == 4
            && camp_nodes == ["N.A.UC", "N.B.UC", "N.A.LC", "N.B.LC"].into_iter().collect(),
        "next.camps",
        "Battlefield requires four terminal neutral camp branches",
    );
    check(
        !r.minions.is_empty() && r.camps.len() >= 2,
        "next",
        "minion waves and multiple camps required",
    );
    for primitive in [
        TransitionPrimitiveKind::BattleNavigation,
        TransitionPrimitiveKind::BattleVision,
        TransitionPrimitiveKind::BattleSquads,
        TransitionPrimitiveKind::BattleCombat,
    ] {
        check(
            package.required_primitives.contains(&primitive),
            "required_primitives",
            "next requires all finite battle primitives",
        );
    }
    const CAPS: &[&str] = &[
        "move", "pursue", "retreat", "activate", "split", "merge", "regroup",
        "select_track", "bridge_work",
    ];
    check(
        package
            .domain
            .capabilities
            .keys()
            .all(|id| CAPS.contains(&id.as_str())),
        "domain.capabilities",
        "unsupported finite battle capability",
    );
}

fn validate_battlefield_topology(r: &NextRules, check: &mut impl FnMut(bool, &str, &str)) {
    let expected = crate::next_world::battle_map();
    check(r.map.id == crate::next_world::BATTLEFIELD_MAP_ID, "next.map.id", "Battlefield topology requires its versioned map ID");
    check(r.map.nodes.len() == 35 && r.map.nodes.len() == expected.nodes.len(), "next.map.nodes", "canonical Battlefield requires exactly 35 nodes");
    check(r.map.edges.len() == 42 && r.map.edges.len() == expected.edges.len(), "next.map.edges", "canonical Battlefield requires exactly 42 edges");
    check(r.map.attacker_base == "A.BASE" && r.map.defender_base == "B.BASE", "next.map.bases", "canonical diagonal bases are A.BASE and B.BASE");
    check(r.map.nodes.keys().eq(expected.nodes.keys()), "next.map.nodes", "node IDs must match the versioned canonical topology");
    for (id, node) in &r.map.nodes {
        let Some(canonical) = expected.nodes.get(id) else { continue };
        check(node.allegiance == canonical.allegiance, "next.map.nodes.allegiance", "node allegiance is static A/B/N geography");
        check(node.region == canonical.region, "next.map.nodes.region", "node regions must retain canonical terrain classes");
    }
    let edge_ids: BTreeSet<_> = r.map.edges.iter().map(|edge| edge.id.as_str()).collect();
    check(edge_ids.len() == r.map.edges.len() && edge_ids.len() == 42, "next.map.edges.id", "edge IDs must be unique and complete");
    let expected_edges: BTreeMap<_, _> = expected.edges.iter().map(|edge| (edge.id.as_str(), edge)).collect();
    for edge in &r.map.edges {
        let Some(canonical) = expected_edges.get(edge.id.as_str()) else {
            check(false, "next.map.edges.id", "edge list contains an undeclared shortcut");
            continue;
        };
        check(edge.from == canonical.from && edge.to == canonical.to && edge.length == canonical.length && edge.region == canonical.region && edge.bridge_site == canonical.bridge_site && edge.ford == canonical.ford && edge.blocked == canonical.blocked,
            "next.map.edges", "edge identity, endpoints, distance, terrain and bridge site are versioned rules");
    }
    check(r.map.lanes == expected.lanes, "next.map.lanes", "lane routes must use the canonical consecutive node sequence");
    let towers: BTreeMap<_, _> = r.map.towers.iter().map(|tower| (tower.id.as_str(), tower)).collect();
    let expected_towers: BTreeMap<_, _> = expected.towers.iter().map(|tower| (tower.id.as_str(), tower)).collect();
    check(towers.len() == 12 && towers == expected_towers, "next.map.towers", "each lane requires A/B T1 and T2 tower sites");
}
