use senkei_world::*;

fn definition() -> WorldDefinition {
    serde_json::from_str(include_str!("../fixtures/initial-battlefield.json"))
        .expect("initial Battlefield authoring fixture parses")
}

fn compile_issues(def: WorldDefinition) -> Vec<WorldIssue> {
    compile(def).expect_err("invalid World definition must be rejected")
}

fn has_code(issues: &[WorldIssue], code: &str) -> bool {
    issues.iter().any(|issue| issue.code == code)
}

#[test]
fn initial_battlefield_is_a_valid_profiled_world_artifact() {
    let compiled =
        compile(definition()).expect("initial Battlefield matches the versioned profile");
    assert_eq!(compiled.simulation_world().topology.nodes.len(), 35);
    assert_eq!(compiled.simulation_world().topology.edges.len(), 42);
    assert_eq!(
        compiled.identity().validation_profile.as_ref().unwrap().id,
        INITIAL_BATTLEFIELD_PROFILE_ID
    );
    assert_eq!(compiled.identity().compiler_version, COMPILER_VERSION);
    let model_ref = compiled.identity().to_model_ref();
    assert_eq!(model_ref.compiler_version, senkei_model::Version::new(
        COMPILER_VERSION.major,
        COMPILER_VERSION.minor,
        COMPILER_VERSION.patch,
    ));
    let model_ref_bytes = serde_json::to_vec(&model_ref).unwrap();
    let decoded: senkei_model::WorldIdentityRef = serde_json::from_slice(&model_ref_bytes).unwrap();
    assert_eq!(decoded, model_ref);
    assert_eq!(compiled.identity().logic_digest.as_str().len(), 64);
    assert_eq!(compiled.identity().presentation_digest.as_str().len(), 64);
}

#[test]
fn canonical_artifacts_ignore_authoring_array_order() {
    let mut shuffled = definition();
    shuffled.topology.nodes.reverse();
    shuffled.topology.edges.reverse();
    shuffled.topology.bridge_sites.reverse();
    shuffled.metric.edge_lengths_wu.reverse();
    shuffled.metric.edge_tracks.reverse();
    for tracks in &mut shuffled.metric.edge_tracks {
        tracks.tracks.reverse();
    }
    shuffled.metric.river_crossing_ranges.reverse();
    shuffled.terrain.profiles.reverse();
    shuffled.terrain.edge_profiles.reverse();
    shuffled.presentation.node_positions.reverse();
    shuffled.presentation.edge_paths.reverse();
    shuffled.presentation.rivers.reverse();
    shuffled.presentation.visual_regions.reverse();
    shuffled.presentation.materials.reverse();
    shuffled.presentation.foliage.reverse();

    let first = compile(definition()).unwrap();
    let second = compile(shuffled).unwrap();
    assert_eq!(first.identity(), second.identity());
    assert_eq!(
        canonical_simulation_bytes(&first).unwrap(),
        canonical_simulation_bytes(&second).unwrap()
    );
    assert_eq!(
        canonical_presentation_bytes(&first).unwrap(),
        canonical_presentation_bytes(&second).unwrap()
    );
    assert_eq!(
        canonical_artifact_bytes(&first).unwrap(),
        canonical_artifact_bytes(&second).unwrap()
    );
}

#[test]
fn presentation_changes_have_an_independent_digest() {
    let first = compile(definition()).unwrap();
    let mut changed_definition = definition();
    changed_definition.presentation.lighting.key_percent += 1;
    let changed = compile(changed_definition).unwrap();
    assert_eq!(
        first.identity().logic_digest,
        changed.identity().logic_digest
    );
    assert_ne!(
        first.identity().presentation_digest,
        changed.identity().presentation_digest
    );
}

#[test]
fn logic_changes_do_not_change_presentation_digest() {
    let first = compile(definition()).unwrap();
    let mut changed_definition = definition();
    changed_definition.validation_profile = None;
    changed_definition
        .terrain
        .profiles
        .iter_mut()
        .find(|x| x.id == "terrain.jungle")
        .unwrap()
        .observation = ObservationSemantics::ElevatedObservation;
    let changed = compile(changed_definition).unwrap();
    assert_ne!(
        first.identity().logic_digest,
        changed.identity().logic_digest
    );
    assert_eq!(
        first.identity().presentation_digest,
        changed.identity().presentation_digest
    );
}

#[test]
fn duplicate_ids_and_unknown_references_are_rejected() {
    let mut duplicate = definition();
    duplicate
        .topology
        .nodes
        .push(duplicate.topology.nodes[0].clone());
    assert!(has_code(&compile_issues(duplicate), "duplicate_id"));

    let mut endpoint = definition();
    endpoint.topology.edges[0].to = "missing.node".into();
    assert!(has_code(&compile_issues(endpoint), "unknown_node"));

    let mut terrain = definition();
    terrain.terrain.edge_profiles[0].profile_id = "terrain.unknown".into();
    assert!(has_code(
        &compile_issues(terrain),
        "unknown_terrain_profile"
    ));

    let mut bridge = definition();
    bridge
        .topology
        .edges
        .iter_mut()
        .find(|x| x.river_crossing.is_some())
        .unwrap()
        .river_crossing
        .as_mut()
        .unwrap()
        .bridge_site_id = Some("bridge.unknown".into());
    assert!(has_code(&compile_issues(bridge), "unknown_bridge_site"));
}

#[test]
fn invalid_metric_compatibility_and_profile_shortcuts_are_rejected() {
    let mut track = definition();
    track.metric.edge_tracks[0].tracks[0].end_progress_wu = u64::MAX;
    assert!(has_code(
        &compile_issues(track),
        "track_range_out_of_bounds"
    ));

    let mut crossing = definition();
    crossing.metric.river_crossing_ranges[0].end_progress_wu = u64::MAX;
    assert!(has_code(
        &compile_issues(crossing),
        "crossing_range_out_of_bounds"
    ));

    let mut incompatible = definition();
    incompatible.compatibility.minimum_compiler = Version::new(2, 0, 0);
    assert!(has_code(
        &compile_issues(incompatible),
        "incompatible_compiler"
    ));

    let mut shortcut = definition();
    let edge = shortcut
        .topology
        .edges
        .iter_mut()
        .find(|x| x.id == "edge-a-top-j-n-a-uj")
        .unwrap();
    edge.to = "N.B.UJ".into();
    assert!(has_code(
        &compile_issues(shortcut),
        "battlefield_unexpected_edge"
    ));
}

#[test]
fn negative_nonfinite_and_unknown_profile_values_are_rejected() {
    let mut negative = serde_json::from_str::<serde_json::Value>(include_str!(
        "../fixtures/initial-battlefield.json"
    ))
    .unwrap();
    negative["metric"]["edge_lengths_wu"][0]["length_wu"] = (-1).into();
    assert!(matches!(
        compile_json(&serde_json::to_vec(&negative).unwrap()),
        Err(WorldCompileError::InvalidJson(_))
    ));

    let source = include_str!("../fixtures/initial-battlefield.json");
    let nonfinite = source.replacen("\"length_wu\": 150", "\"length_wu\": NaN", 1);
    assert!(matches!(
        compile_json(nonfinite.as_bytes()),
        Err(WorldCompileError::InvalidJson(_))
    ));

    let mut unsupported = definition();
    unsupported
        .validation_profile
        .as_mut()
        .unwrap()
        .version
        .patch += 1;
    assert!(has_code(
        &compile_issues(unsupported),
        "unsupported_validation_profile"
    ));
}

#[test]
fn presentation_references_and_geometry_are_validated() {
    let mut outside = definition();
    outside.presentation.node_positions[0].position.x = 1201;
    assert!(has_code(&compile_issues(outside), "point_outside_view_box"));

    let mut crossing = definition();
    crossing.presentation.rivers[0].points = vec![Point2 { x: 10, y: 20 }, Point2 { x: 10, y: 40 }];
    assert!(has_code(
        &compile_issues(crossing),
        "missing_visual_crossing"
    ));

    let mut region = definition();
    region.presentation.visual_regions[0].terrain_profile_id = "terrain.unknown".into();
    assert!(has_code(&compile_issues(region), "unknown_terrain_profile"));

    let mut roads = definition();
    roads
        .presentation
        .edge_paths
        .iter_mut()
        .find(|path| path.edge_id == "edge-a-top-t1-a-top-t2")
        .unwrap()
        .points
        .insert(1, Point2 { x: 220, y: 500 });
    assert!(has_code(
        &compile_issues(roads),
        "unmodeled_visual_intersection"
    ));
}

#[test]
fn directed_unreachable_nodes_are_rejected() {
    let mut world = definition();
    world
        .topology
        .edges
        .iter_mut()
        .find(|edge| edge.from == "N.A.UJ" && edge.to == "N.A.UC")
        .unwrap()
        .directionality = Directionality::ToFrom;
    let issues = compile_issues(world);
    assert!(has_code(&issues, "unreachable_node"));
}

#[test]
fn strict_json_rejects_unknown_fields() {
    let mut value: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/initial-battlefield.json")).unwrap();
    value["topology"]["edges"][0]["silently_ignored"] = serde_json::Value::Bool(true);
    let bytes = serde_json::to_vec(&value).unwrap();
    assert!(matches!(
        compile_json(&bytes),
        Err(WorldCompileError::InvalidJson(_))
    ));
}

#[test]
fn issue_order_is_stable() {
    let mut bad = definition();
    bad.topology.nodes.push(bad.topology.nodes[0].clone());
    bad.topology.edges[0].from = "unknown".into();
    let first = compile_issues(bad.clone());
    let second = compile_issues(bad);
    assert_eq!(first, second);
    let mut ordered = first.clone();
    ordered.sort_by(|a, b| (&a.path, a.code, &a.message).cmp(&(&b.path, b.code, &b.message)));
    assert_eq!(first, ordered);
}
