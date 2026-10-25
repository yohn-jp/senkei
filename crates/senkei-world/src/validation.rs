use crate::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorldIssue {
    pub code: &'static str,
    pub path: String,
    pub message: String,
}

impl WorldIssue {
    fn new(code: &'static str, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code,
            path: path.into(),
            message: message.into(),
        }
    }
}

pub(crate) fn validate(def: &WorldDefinition) -> Vec<WorldIssue> {
    let mut v = Validator { issues: Vec::new() };
    v.header(def);
    let nodes = v.unique(&def.topology.nodes, "topology.nodes", |x| x.id.as_str());
    let edges = v.unique(&def.topology.edges, "topology.edges", |x| x.id.as_str());
    let sites = v.unique(&def.topology.bridge_sites, "topology.bridge_sites", |x| {
        x.id.as_str()
    });
    let lengths = v.unique(&def.metric.edge_lengths_wu, "metric.edge_lengths_wu", |x| {
        x.edge_id.as_str()
    });
    let track_sets = v.unique(&def.metric.edge_tracks, "metric.edge_tracks", |x| {
        x.edge_id.as_str()
    });
    let crossing_ranges = v.unique(
        &def.metric.river_crossing_ranges,
        "metric.river_crossing_ranges",
        |x| x.edge_id.as_str(),
    );
    let profiles = v.unique(&def.terrain.profiles, "terrain.profiles", |x| x.id.as_str());
    let assignments = v.unique(&def.terrain.edge_profiles, "terrain.edge_profiles", |x| {
        x.edge_id.as_str()
    });
    let node_views = v.unique(
        &def.presentation.node_positions,
        "presentation.node_positions",
        |x| x.node_id.as_str(),
    );
    let paths = v.unique(
        &def.presentation.edge_paths,
        "presentation.edge_paths",
        |x| x.edge_id.as_str(),
    );
    let rivers = v.unique(&def.presentation.rivers, "presentation.rivers", |x| {
        x.id.as_str()
    });
    let regions = v.unique(
        &def.presentation.visual_regions,
        "presentation.visual_regions",
        |x| x.id.as_str(),
    );
    let materials = v.unique(&def.presentation.materials, "presentation.materials", |x| {
        x.id.as_str()
    });
    let foliage = v.unique(&def.presentation.foliage, "presentation.foliage", |x| {
        x.id.as_str()
    });
    v.runtime_layout(def, &nodes, &edges);

    for (id, (_, index)) in nodes.iter() {
        v.check_id(id, format!("topology.nodes[{index}].id"));
    }
    for (id, (_, index)) in edges.iter() {
        v.check_id(id, format!("topology.edges[{index}].id"));
    }
    for (id, (_, index)) in sites.iter() {
        v.check_id(id, format!("topology.bridge_sites[{index}].id"));
    }
    for (id, (_, index)) in profiles.iter() {
        v.check_id(id, format!("terrain.profiles[{index}].id"));
    }
    for (id, (_, index)) in rivers.iter() {
        v.check_id(id, format!("presentation.rivers[{index}].id"));
    }
    for (id, (_, index)) in regions.iter() {
        v.check_id(id, format!("presentation.visual_regions[{index}].id"));
    }
    for (id, (_, index)) in materials.iter() {
        v.check_id(id, format!("presentation.materials[{index}].id"));
    }
    for (id, (_, index)) in foliage.iter() {
        v.check_id(id, format!("presentation.foliage[{index}].id"));
    }

    let mut bridge_membership = BTreeMap::<&str, &str>::new();
    for (site_index, site) in def.topology.bridge_sites.iter().enumerate() {
        if site.edge_ids.is_empty() {
            v.issue(
                "empty_bridge_site",
                format!("topology.bridge_sites[{site_index}].edge_ids"),
                "bridge sites must reference at least one fixed crossing edge",
            );
        }
        let mut seen = BTreeSet::new();
        for edge_id in &site.edge_ids {
            if !seen.insert(edge_id.as_str()) {
                v.issue(
                    "duplicate_bridge_edge",
                    format!("topology.bridge_sites[{site_index}].edge_ids"),
                    format!("edge '{edge_id}' appears more than once"),
                );
            }
            if !edges.contains_key(edge_id.as_str()) {
                v.issue(
                    "unknown_edge",
                    format!("topology.bridge_sites[{site_index}].edge_ids"),
                    format!("unknown edge '{edge_id}'"),
                );
            }
            if let Some(previous) = bridge_membership.insert(edge_id, site.id.as_str()) {
                v.issue(
                    "multiple_bridge_sites",
                    format!("topology.bridge_sites[{site_index}].edge_ids"),
                    format!("edge '{edge_id}' is already assigned to bridge site '{previous}'"),
                );
            }
        }
    }

    for (i, edge) in def.topology.edges.iter().enumerate() {
        let path = format!("topology.edges[{i}]");
        if !nodes.contains_key(edge.from.as_str()) {
            v.issue(
                "unknown_node",
                format!("{path}.from"),
                format!("unknown node '{}'", edge.from),
            );
        }
        if !nodes.contains_key(edge.to.as_str()) {
            v.issue(
                "unknown_node",
                format!("{path}.to"),
                format!("unknown node '{}'", edge.to),
            );
        }
        if edge.from == edge.to {
            v.issue(
                "self_edge",
                path.clone(),
                "an edge must connect distinct nodes",
            );
        }
        match &edge.river_crossing {
            Some(crossing) => {
                v.check_id(
                    &crossing.river_id,
                    format!("{path}.river_crossing.river_id"),
                );
                if !rivers.contains_key(crossing.river_id.as_str()) {
                    v.issue(
                        "unknown_river",
                        format!("{path}.river_crossing.river_id"),
                        format!("unknown river '{}'", crossing.river_id),
                    );
                }
                match (crossing.kind, crossing.bridge_site_id.as_deref()) {
                    (RiverCrossingKind::FootFord, None) => {
                        if edge.class != EdgeClass::Jungle {
                            v.issue(
                                "ford_not_jungle",
                                path.clone(),
                                "foot fords are confined to the jungle topology",
                            );
                        }
                    }
                    (RiverCrossingKind::FootFord, Some(_)) => v.issue(
                        "ford_has_bridge",
                        format!("{path}.river_crossing.bridge_site_id"),
                        "jungle foot fords cannot have bridge sites",
                    ),
                    (
                        RiverCrossingKind::FixedBridge | RiverCrossingKind::FixedFacilityBridge,
                        Some(site_id),
                    ) => {
                        if edge.class == EdgeClass::Jungle {
                            v.issue(
                                "bridge_in_jungle",
                                path.clone(),
                                "jungle river crossings cannot contain bridges",
                            );
                        }
                        match sites.get(site_id) {
                            None => v.issue(
                                "unknown_bridge_site",
                                format!("{path}.river_crossing.bridge_site_id"),
                                format!("unknown bridge site '{site_id}'"),
                            ),
                            Some((site, _)) => {
                                let expected =
                                    if crossing.kind == RiverCrossingKind::FixedFacilityBridge {
                                        BridgeSiteKind::FacilityBridge
                                    } else {
                                        BridgeSiteKind::LaneBridge
                                    };
                                if site.kind != expected {
                                    v.issue(
                                        "bridge_kind_mismatch",
                                        format!("{path}.river_crossing.bridge_site_id"),
                                        "crossing kind and bridge site kind disagree",
                                    );
                                }
                                if !site.edge_ids.iter().any(|member| member == &edge.id) {
                                    v.issue(
                                        "bridge_membership_mismatch",
                                        path.clone(),
                                        format!("bridge site '{site_id}' does not list this edge"),
                                    );
                                }
                            }
                        }
                    }
                    (
                        RiverCrossingKind::FixedBridge | RiverCrossingKind::FixedFacilityBridge,
                        None,
                    ) => v.issue(
                        "bridge_without_site",
                        format!("{path}.river_crossing.bridge_site_id"),
                        "fixed bridges must reference a fixed bridge site",
                    ),
                }
            }
            None => {
                if bridge_membership.contains_key(edge.id.as_str()) {
                    v.issue(
                        "bridge_edge_unmarked",
                        path.clone(),
                        "a bridge site's member edge must declare its river crossing",
                    );
                }
            }
        }
    }
    for (edge_id, site_id) in &bridge_membership {
        if let Some((_, edge_index)) = edges.get(edge_id) {
            let edge = &def.topology.edges[*edge_index];
            if edge
                .river_crossing
                .as_ref()
                .and_then(|x| x.bridge_site_id.as_deref())
                != Some(*site_id)
            {
                v.issue(
                    "bridge_membership_mismatch",
                    format!("topology.edges[{}].river_crossing", edge_index),
                    format!("edge must reference bridge site '{site_id}'"),
                );
            }
        }
    }

    v.check_exact_refs(
        "metric.edge_lengths_wu",
        lengths.keys().copied(),
        edges.keys().copied(),
        "edge",
    );
    v.check_exact_refs(
        "metric.edge_tracks",
        track_sets.keys().copied(),
        edges.keys().copied(),
        "edge",
    );
    let crossing_edge_ids: BTreeSet<_> = def
        .topology
        .edges
        .iter()
        .filter(|edge| edge.river_crossing.is_some())
        .map(|edge| edge.id.as_str())
        .collect();
    v.check_exact_refs(
        "metric.river_crossing_ranges",
        crossing_ranges.keys().copied(),
        crossing_edge_ids.iter().copied(),
        "river-crossing edge",
    );
    for (i, length) in def.metric.edge_lengths_wu.iter().enumerate() {
        v.check_id(
            &length.edge_id,
            format!("metric.edge_lengths_wu[{i}].edge_id"),
        );
        if length.length_wu == 0 {
            v.issue(
                "invalid_length",
                format!("metric.edge_lengths_wu[{i}].length_wu"),
                "edge length must be a finite positive integer WU value",
            );
        }
    }
    for (i, set) in def.metric.edge_tracks.iter().enumerate() {
        let path = format!("metric.edge_tracks[{i}]");
        let Some((edge, _)) = edges.get(set.edge_id.as_str()) else {
            v.issue(
                "unknown_edge",
                format!("{path}.edge_id"),
                format!("unknown edge '{}'", set.edge_id),
            );
            continue;
        };
        let length = lengths
            .get(set.edge_id.as_str())
            .map(|(length, _)| length.length_wu);
        if set.tracks.is_empty() {
            v.issue(
                "empty_track_set",
                format!("{path}.tracks"),
                "each edge must declare at least one typed metric track",
            );
        }
        let mut track_ids = BTreeSet::new();
        let mut track_kinds = BTreeSet::new();
        for (j, track) in set.tracks.iter().enumerate() {
            let track_path = format!("{path}.tracks[{j}]");
            v.check_id(&track.id, format!("{track_path}.id"));
            if !track_ids.insert(track.id.as_str()) {
                v.issue(
                    "duplicate_track_id",
                    format!("{track_path}.id"),
                    format!("duplicate metric track ID '{}'", track.id),
                );
            }
            if track.kind != TrackKind::Other && !track_kinds.insert(track.kind as u8) {
                v.issue(
                    "duplicate_track_kind",
                    format!("{track_path}.kind"),
                    "core track kinds may only appear once on an edge",
                );
            }
            match (track.kind, track.id.as_str()) {
                (TrackKind::Left, "left")
                | (TrackKind::Center, "center")
                | (TrackKind::Right, "right")
                | (TrackKind::Single, "single") => {}
                (TrackKind::Left | TrackKind::Center | TrackKind::Right | TrackKind::Single, _) => {
                    v.issue(
                        "invalid_track_id",
                        format!("{track_path}.id"),
                        "core track IDs must match their stable lowercase kind name",
                    )
                }
                (TrackKind::Other, _) => {}
            }
            if track.start_progress_wu >= track.end_progress_wu {
                v.issue(
                    "invalid_track_range",
                    track_path.clone(),
                    "track interval start must be less than end",
                );
            }
            if let Some(length) = length {
                if track.end_progress_wu > length {
                    v.issue(
                        "track_range_out_of_bounds",
                        track_path,
                        "track interval exceeds edge length",
                    );
                }
            }
        }
        match edge.class {
            EdgeClass::Lane if set.tracks.iter().any(|x| x.kind == TrackKind::Single) => v.issue(
                "lane_track_mismatch",
                format!("{path}.tracks"),
                "lane edges cannot use the single-corridor track",
            ),
            EdgeClass::Jungle
                if set.tracks.len() != 1
                    || set.tracks.first().map(|x| x.kind) != Some(TrackKind::Single) =>
            {
                v.issue(
                    "jungle_track_mismatch",
                    format!("{path}.tracks"),
                    "jungle edges use exactly one typed single-corridor track",
                )
            }
            EdgeClass::Other
                if set.tracks.iter().any(|x| x.kind == TrackKind::Single)
                    && set.tracks.len() != 1 =>
            {
                v.issue(
                    "mixed_single_track",
                    format!("{path}.tracks"),
                    "single-corridor tracks cannot be mixed with other tracks",
                )
            }
            _ => {}
        }
    }
    for (i, crossing) in def.metric.river_crossing_ranges.iter().enumerate() {
        let path = format!("metric.river_crossing_ranges[{i}]");
        let Some((edge, _)) = edges.get(crossing.edge_id.as_str()) else {
            v.issue(
                "unknown_edge",
                format!("{path}.edge_id"),
                format!("unknown edge '{}'", crossing.edge_id),
            );
            continue;
        };
        let Some(topology_crossing) = edge.river_crossing.as_ref() else {
            v.issue(
                "unexpected_crossing_range",
                path.clone(),
                "edge does not declare a river crossing",
            );
            continue;
        };
        if topology_crossing.river_id != crossing.river_id {
            v.issue(
                "crossing_river_mismatch",
                format!("{path}.river_id"),
                "metric and topology name different rivers",
            );
        }
        if crossing.start_progress_wu >= crossing.end_progress_wu {
            v.issue(
                "invalid_crossing_range",
                path.clone(),
                "crossing interval start must be less than end",
            );
        }
        if let Some((length, _)) = lengths.get(crossing.edge_id.as_str()) {
            if crossing.end_progress_wu > length.length_wu {
                v.issue(
                    "crossing_range_out_of_bounds",
                    path,
                    "river crossing interval exceeds edge length",
                );
            }
        }
    }

    for (i, assignment) in def.terrain.edge_profiles.iter().enumerate() {
        let path = format!("terrain.edge_profiles[{i}]");
        v.check_id(&assignment.edge_id, format!("{path}.edge_id"));
        if !edges.contains_key(assignment.edge_id.as_str()) {
            v.issue(
                "unknown_edge",
                format!("{path}.edge_id"),
                format!("unknown edge '{}'", assignment.edge_id),
            );
        }
        match profiles.get(assignment.profile_id.as_str()) {
            None => v.issue(
                "unknown_terrain_profile",
                format!("{path}.profile_id"),
                format!("unknown terrain profile '{}'", assignment.profile_id),
            ),
            Some((profile, _)) => {
                if let Some((edge, _)) = edges.get(assignment.edge_id.as_str()) {
                    let expected = match edge.class {
                        EdgeClass::Lane => Some(TerrainKind::Lane),
                        EdgeClass::Jungle => Some(TerrainKind::Jungle),
                        EdgeClass::Other => None,
                    };
                    if expected.is_some_and(|kind| profile.kind != kind) {
                        v.issue(
                            "terrain_class_mismatch",
                            format!("{path}.profile_id"),
                            "terrain profile kind does not match the topological edge class",
                        );
                    }
                }
            }
        }
    }
    v.check_exact_refs(
        "terrain.edge_profiles",
        assignments.keys().copied(),
        edges.keys().copied(),
        "edge",
    );
    if def.terrain.profiles.is_empty() {
        v.issue(
            "empty_schema",
            "terrain.profiles",
            "at least one terrain profile is required",
        );
    }

    v.validate_connectivity(&def.topology, &nodes);
    v.validate_presentation(
        def,
        &nodes,
        &edges,
        &profiles,
        &node_views,
        &paths,
        &rivers,
        &regions,
        &materials,
        &foliage,
    );
    v.validate_profile(def, &nodes, &edges, &lengths, &sites);

    v.issues
        .sort_by(|a, b| (&a.path, a.code, &a.message).cmp(&(&b.path, b.code, &b.message)));
    v.issues
        .dedup_by(|a, b| a.path == b.path && a.code == b.code && a.message == b.message);
    v.issues
}

struct Validator {
    issues: Vec<WorldIssue>,
}

impl Validator {
    fn runtime_layout(
        &mut self,
        def: &WorldDefinition,
        nodes: &BTreeMap<&str, (&NodeDefinition, usize)>,
        edges: &BTreeMap<&str, (&EdgeDefinition, usize)>,
    ) {
        let Some(layout) = &def.runtime_layout else {
            if def.validation_profile.as_ref().is_some_and(|p| p.id == INITIAL_BATTLEFIELD_PROFILE_ID) {
                self.issue("missing_runtime_layout", "runtime_layout", "initial Battlefield World must author bases, lane routes, and tower placements");
            }
            return;
        };
        for (label, id) in [("attacker_base", layout.attacker_base.as_str()), ("defender_base", layout.defender_base.as_str())] {
            if !nodes.contains_key(id) {
                self.issue("unknown_runtime_base", format!("runtime_layout.{label}"), format!("base node '{id}' does not exist"));
            }
        }
        if layout.attacker_base == layout.defender_base {
            self.issue("duplicate_runtime_base", "runtime_layout", "attacker and defender bases must be distinct");
        }
        for (lane, route) in &layout.lanes {
            self.check_id(lane, format!("runtime_layout.lanes.{lane}"));
            if route.len() < 2 {
                self.issue("short_runtime_route", format!("runtime_layout.lanes.{lane}"), "lane route must contain at least two nodes");
            }
            for (index, pair) in route.windows(2).enumerate() {
                if !nodes.contains_key(pair[0].as_str()) || !nodes.contains_key(pair[1].as_str()) {
                    self.issue("unknown_runtime_route_node", format!("runtime_layout.lanes.{lane}[{index}]"), "lane route references an unknown node");
                    continue;
                }
                let adjacent = edges.values().any(|(edge, _)| {
                    (edge.from == pair[0] && edge.to == pair[1])
                        || (edge.directionality == Directionality::Bidirectional && edge.from == pair[1] && edge.to == pair[0])
                });
                if !adjacent {
                    self.issue("nonadjacent_runtime_route", format!("runtime_layout.lanes.{lane}[{index}]"), "consecutive lane route nodes must be joined by an authored legal edge");
                }
            }
        }
        let mut tower_ids = BTreeSet::new();
        let mut tower_nodes = BTreeSet::new();
        for (index, tower) in layout.towers.iter().enumerate() {
            self.check_id(&tower.id, format!("runtime_layout.towers[{index}].id"));
            if !tower_ids.insert(&tower.id) {
                self.issue("duplicate_runtime_tower", format!("runtime_layout.towers[{index}].id"), "tower IDs must be unique");
            }
            if !nodes.contains_key(tower.node.as_str()) {
                self.issue("unknown_runtime_tower_node", format!("runtime_layout.towers[{index}].node"), "tower placement references an unknown node");
            }
            if !layout.lanes.contains_key(&tower.lane) {
                self.issue("unknown_runtime_tower_lane", format!("runtime_layout.towers[{index}].lane"), "tower placement references an unknown lane route");
            }
            if !tower_nodes.insert(&tower.node) {
                self.issue("duplicate_runtime_tower_node", format!("runtime_layout.towers[{index}].node"), "only one tower placement may occupy a node");
            }
        }
    }

    fn issue(&mut self, code: &'static str, path: impl Into<String>, message: impl Into<String>) {
        self.issues.push(WorldIssue::new(code, path, message));
    }

    fn check_id(&mut self, id: &str, path: String) {
        let valid = !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b':'))
            && !id.starts_with('.')
            && !id.ends_with('.')
            && !id.contains("..");
        if !valid {
            self.issue("invalid_id", path, "IDs must be 1-128 ASCII letters, digits, dots, underscores, or hyphens, with no empty dot segment");
        }
    }

    fn unique<'a, T>(
        &mut self,
        values: &'a [T],
        path: &str,
        id: impl Fn(&'a T) -> &'a str,
    ) -> BTreeMap<&'a str, (&'a T, usize)> {
        let mut out = BTreeMap::new();
        for (i, item) in values.iter().enumerate() {
            let key = id(item);
            if let Some((_, previous)) = out.get(key) {
                self.issue(
                    "duplicate_id",
                    format!("{path}[{i}]"),
                    format!("duplicate ID '{key}' also appears at index {previous}"),
                );
            } else {
                out.insert(key, (item, i));
            }
        }
        out
    }

    fn check_exact_refs<'a>(
        &mut self,
        path: &str,
        actual: impl Iterator<Item = &'a str>,
        expected: impl Iterator<Item = &'a str>,
        label: &str,
    ) {
        let actual: BTreeSet<_> = actual.collect();
        let expected: BTreeSet<_> = expected.collect();
        for missing in expected.difference(&actual) {
            self.issue(
                "missing_reference",
                path,
                format!("missing {label} entry for '{missing}'"),
            );
        }
        for unknown in actual.difference(&expected) {
            self.issue(
                "unknown_reference",
                path,
                format!("entry references unknown {label} '{unknown}'"),
            );
        }
    }

    fn header(&mut self, def: &WorldDefinition) {
        self.check_id(&def.id, "id".into());
        if def.schema_version != Version::new(1, 0, 0) {
            self.issue(
                "unsupported_schema_version",
                "schema_version",
                "only World schema version 1.0.0 is supported",
            );
        }
        if def.compatibility.minimum_compiler.is_zero() {
            self.issue(
                "invalid_compatibility",
                "compatibility.minimum_compiler",
                "minimum compiler version must be nonzero",
            );
        }
        if def.compatibility.minimum_compiler > COMPILER_VERSION {
            self.issue(
                "incompatible_compiler",
                "compatibility.minimum_compiler",
                "World requires a newer compiler than this one",
            );
        }
        if let Some(max) = def.compatibility.maximum_compiler_exclusive {
            if max <= def.compatibility.minimum_compiler {
                self.issue(
                    "invalid_compatibility",
                    "compatibility.maximum_compiler_exclusive",
                    "exclusive maximum must be greater than the minimum",
                );
            }
            if max <= COMPILER_VERSION {
                self.issue(
                    "incompatible_compiler",
                    "compatibility.maximum_compiler_exclusive",
                    "World excludes this compiler version",
                );
            }
        }
        if let Some(profile) = &def.validation_profile {
            self.check_id(&profile.id, "validation_profile.id".into());
            match (profile.id.as_str(), profile.version) {
                (INITIAL_BATTLEFIELD_PROFILE_ID, INITIAL_BATTLEFIELD_PROFILE_VERSION) => {}
                _ => self.issue(
                    "unsupported_validation_profile",
                    "validation_profile",
                    format!(
                        "unsupported validation profile '{}@{}.{}.{}'",
                        profile.id,
                        profile.version.major,
                        profile.version.minor,
                        profile.version.patch
                    ),
                ),
            }
        }
        if def.topology.nodes.is_empty() {
            self.issue(
                "empty_topology",
                "topology.nodes",
                "World topology requires at least one node",
            );
        }
        if def.topology.edges.is_empty() {
            self.issue(
                "empty_topology",
                "topology.edges",
                "World topology requires at least one edge",
            );
        }
    }

    fn validate_connectivity(
        &mut self,
        topology: &TopologyDefinition,
        nodes: &BTreeMap<&str, (&NodeDefinition, usize)>,
    ) {
        if topology.entry_nodes.is_empty() {
            self.issue(
                "missing_entry_node",
                "topology.entry_nodes",
                "at least one authored topology entry node is required",
            );
        }
        let mut entries = BTreeSet::new();
        for (i, entry) in topology.entry_nodes.iter().enumerate() {
            self.check_id(entry, format!("topology.entry_nodes[{i}]"));
            if !entries.insert(entry.as_str()) {
                self.issue(
                    "duplicate_entry_node",
                    format!("topology.entry_nodes[{i}]"),
                    format!("entry node '{entry}' is repeated"),
                );
            }
            if !nodes.contains_key(entry.as_str()) {
                self.issue(
                    "unknown_entry_node",
                    format!("topology.entry_nodes[{i}]"),
                    format!("unknown entry node '{entry}'"),
                );
            }
        }
        let mut adjacency: BTreeMap<&str, Vec<&str>> =
            nodes.keys().map(|id| (*id, Vec::new())).collect();
        for edge in &topology.edges {
            match edge.directionality {
                Directionality::Bidirectional => {
                    if let Some(a) = adjacency.get_mut(edge.from.as_str()) {
                        a.push(edge.to.as_str());
                    }
                    if let Some(b) = adjacency.get_mut(edge.to.as_str()) {
                        b.push(edge.from.as_str());
                    }
                }
                Directionality::FromTo => {
                    if let Some(a) = adjacency.get_mut(edge.from.as_str()) {
                        a.push(edge.to.as_str());
                    }
                }
                Directionality::ToFrom => {
                    if let Some(b) = adjacency.get_mut(edge.to.as_str()) {
                        b.push(edge.from.as_str());
                    }
                }
            }
        }
        let mut visited = BTreeSet::new();
        let mut todo: VecDeque<_> = entries.iter().copied().collect();
        while let Some(node) = todo.pop_front() {
            if !visited.insert(node) {
                continue;
            }
            if let Some(neighbors) = adjacency.get(node) {
                todo.extend(neighbors.iter().copied());
            }
        }
        for node in nodes.keys() {
            if !visited.contains(node) {
                self.issue(
                    "unreachable_node",
                    format!("topology.nodes.{node}"),
                    "node is outside the World's connected topology",
                );
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn validate_presentation(
        &mut self,
        def: &WorldDefinition,
        nodes: &BTreeMap<&str, (&NodeDefinition, usize)>,
        edges: &BTreeMap<&str, (&EdgeDefinition, usize)>,
        profiles: &BTreeMap<&str, (&TerrainProfileDefinition, usize)>,
        node_views: &BTreeMap<&str, (&NodeViewDefinition, usize)>,
        paths: &BTreeMap<&str, (&EdgePathDefinition, usize)>,
        rivers: &BTreeMap<&str, (&RiverViewDefinition, usize)>,
        regions: &BTreeMap<&str, (&VisualRegionDefinition, usize)>,
        materials: &BTreeMap<&str, (&MaterialDefinition, usize)>,
        foliage: &BTreeMap<&str, (&FoliageDefinition, usize)>,
    ) {
        let p = &def.presentation;
        if p.view_box.width == 0 || p.view_box.height == 0 {
            self.issue(
                "invalid_view_box",
                "presentation.view_box",
                "view box dimensions must be positive",
            );
        }
        if p.lighting.ambient_percent > 100 || p.lighting.key_percent > 100 {
            self.issue(
                "invalid_lighting",
                "presentation.lighting",
                "lighting percentages must be at most 100",
            );
        }
        self.check_exact_refs(
            "presentation.node_positions",
            node_views.keys().copied(),
            nodes.keys().copied(),
            "node",
        );
        self.check_exact_refs(
            "presentation.edge_paths",
            paths.keys().copied(),
            edges.keys().copied(),
            "edge",
        );

        for (id, (material, i)) in materials {
            self.check_id(id, format!("presentation.materials[{i}].id"));
            if material.opacity_percent > 100 {
                self.issue(
                    "invalid_opacity",
                    format!("presentation.materials[{i}].opacity_percent"),
                    "opacity percentage must be at most 100",
                );
            }
            let color = material.color.as_bytes();
            if color.len() != 7 || color[0] != b'#' || !color[1..].iter().all(u8::is_ascii_hexdigit)
            {
                self.issue(
                    "invalid_color",
                    format!("presentation.materials[{i}].color"),
                    "material color must be a #RRGGBB literal",
                );
            }
        }
        for (id, (view, i)) in node_views {
            self.check_id(id, format!("presentation.node_positions[{i}].node_id"));
            self.point(
                view.position,
                &format!("presentation.node_positions[{i}].position"),
                p.view_box,
            );
            if !materials.contains_key(view.material_id.as_str()) {
                self.issue(
                    "unknown_material",
                    format!("presentation.node_positions[{i}].material_id"),
                    format!("unknown material '{}'", view.material_id),
                );
            }
        }
        let mut used_positions = BTreeMap::<Point2, &str>::new();
        for (node_id, (view, i)) in node_views {
            if let Some(other) = used_positions.insert(view.position, node_id) {
                self.issue(
                    "overlapping_nodes",
                    format!("presentation.node_positions[{i}].position"),
                    format!("node '{node_id}' has the same visual position as '{other}'"),
                );
            }
        }

        let mut normalized_paths = BTreeMap::<&str, Vec<Point2>>::new();
        for (edge_id, (path, i)) in paths {
            let source_path = format!("presentation.edge_paths[{i}]");
            if path.visual_width == 0 {
                self.issue(
                    "invalid_visual_width",
                    format!("{source_path}.visual_width"),
                    "edge paths require a positive width",
                );
            }
            if !materials.contains_key(path.material_id.as_str()) {
                self.issue(
                    "unknown_material",
                    format!("{source_path}.material_id"),
                    format!("unknown material '{}'", path.material_id),
                );
            }
            self.points(
                &path.points,
                2,
                &format!("{source_path}.points"),
                p.view_box,
            );
            if let Some((edge, _)) = edges.get(edge_id) {
                if let (Some(start), Some(end), Some(from), Some(to)) = (
                    path.points.first(),
                    path.points.last(),
                    node_views.get(edge.from.as_str()),
                    node_views.get(edge.to.as_str()),
                ) {
                    let from_position = from.0.position;
                    let to_position = to.0.position;
                    if (*start, *end) != (from_position, to_position)
                        && (*start, *end) != (to_position, from_position)
                    {
                        self.issue(
                            "path_endpoint_mismatch",
                            format!("{source_path}.points"),
                            format!(
                                "edge path endpoints must match '{}' and '{}' positions",
                                edge.from, edge.to
                            ),
                        );
                    }
                }
            }
            if polyline_self_intersects(&path.points) {
                self.issue(
                    "self_intersecting_path",
                    format!("{source_path}.points"),
                    "an edge path cannot loop across itself",
                );
            }
            normalized_paths.insert(edge_id, path.points.clone());
        }
        self.validate_path_intersections(edges, node_views, &normalized_paths);

        let mut declared_rivers = BTreeSet::new();
        for edge in &def.topology.edges {
            if let Some(crossing) = &edge.river_crossing {
                declared_rivers.insert(crossing.river_id.as_str());
            }
        }
        self.check_exact_refs(
            "presentation.rivers",
            rivers.keys().copied(),
            declared_rivers.iter().copied(),
            "river",
        );
        for (id, (river, i)) in rivers {
            self.check_id(id, format!("presentation.rivers[{i}].id"));
            self.points(
                &river.points,
                2,
                &format!("presentation.rivers[{i}].points"),
                p.view_box,
            );
            if river.visual_width == 0 {
                self.issue(
                    "invalid_visual_width",
                    format!("presentation.rivers[{i}].visual_width"),
                    "river paths require a positive width",
                );
            }
            if !materials.contains_key(river.material_id.as_str()) {
                self.issue(
                    "unknown_material",
                    format!("presentation.rivers[{i}].material_id"),
                    format!("unknown material '{}'", river.material_id),
                );
            }
            let river_crossings: Vec<_> = def
                .topology
                .edges
                .iter()
                .filter_map(|edge| {
                    edge.river_crossing
                        .as_ref()
                        .filter(|x| x.river_id == *id)
                        .map(|crossing| (edge, crossing))
                })
                .collect();
            for (edge, _) in river_crossings {
                match normalized_paths.get(edge.id.as_str()) {
                    Some(edge_points) if polylines_intersect(&river.points, edge_points) => {}
                    Some(_) => self.issue(
                        "missing_visual_crossing",
                        format!("presentation.rivers[{i}]"),
                        format!(
                            "declared river crossing edge '{}' does not meet the river geometry",
                            edge.id
                        ),
                    ),
                    None => {}
                }
            }
            for edge in &def.topology.edges {
                let crosses = normalized_paths
                    .get(edge.id.as_str())
                    .is_some_and(|points| polylines_intersect(&river.points, points));
                if crosses
                    && edge
                        .river_crossing
                        .as_ref()
                        .is_none_or(|x| x.river_id != *id)
                {
                    self.issue("unmarked_visual_crossing", format!("presentation.rivers[{i}]"), format!("edge '{}' crosses this river in the presentation but has no matching logical crossing", edge.id));
                }
            }
        }

        for (id, (region, i)) in regions {
            self.check_id(id, format!("presentation.visual_regions[{i}].id"));
            self.points(
                &region.outline,
                3,
                &format!("presentation.visual_regions[{i}].outline"),
                p.view_box,
            );
            if region.outline.iter().collect::<BTreeSet<_>>().len() < 3 {
                self.issue(
                    "invalid_polygon",
                    format!("presentation.visual_regions[{i}].outline"),
                    "region outlines need at least three distinct points",
                );
            }
            if !profiles.contains_key(region.terrain_profile_id.as_str()) {
                self.issue(
                    "unknown_terrain_profile",
                    format!("presentation.visual_regions[{i}].terrain_profile_id"),
                    format!("unknown profile '{}'", region.terrain_profile_id),
                );
            }
            if !materials.contains_key(region.material_id.as_str()) {
                self.issue(
                    "unknown_material",
                    format!("presentation.visual_regions[{i}].material_id"),
                    format!("unknown material '{}'", region.material_id),
                );
            }
            if polyline_self_intersects_closed(&region.outline) {
                self.issue(
                    "self_intersecting_region",
                    format!("presentation.visual_regions[{i}].outline"),
                    "region polygons cannot cross themselves",
                );
            }
        }
        for (id, (f, i)) in foliage {
            self.check_id(id, format!("presentation.foliage[{i}].id"));
            if !regions.contains_key(f.region_id.as_str()) {
                self.issue(
                    "unknown_visual_region",
                    format!("presentation.foliage[{i}].region_id"),
                    format!("unknown visual region '{}'", f.region_id),
                );
            }
            if f.species.trim().is_empty() {
                self.issue(
                    "invalid_foliage",
                    format!("presentation.foliage[{i}].species"),
                    "foliage species ID must not be empty",
                );
            }
            if f.density_per_mille > 1000 {
                self.issue(
                    "invalid_foliage_density",
                    format!("presentation.foliage[{i}].density_per_mille"),
                    "foliage density must be between 0 and 1000 per mille",
                );
            }
        }
    }

    fn point(&mut self, p: Point2, path: &str, bounds: ViewBox) {
        if p.x > bounds.width || p.y > bounds.height {
            self.issue(
                "point_outside_view_box",
                path,
                "presentation point is outside the declared view box",
            );
        }
    }

    fn points(&mut self, points: &[Point2], minimum: usize, path: &str, bounds: ViewBox) {
        if points.len() < minimum {
            self.issue(
                "too_few_points",
                path,
                format!("at least {minimum} distinct ordered points are required"),
            );
        }
        for (i, point) in points.iter().enumerate() {
            self.point(*point, &format!("{path}[{i}]"), bounds);
        }
        if points.windows(2).any(|pair| pair[0] == pair[1]) {
            self.issue(
                "duplicate_path_point",
                path,
                "consecutive duplicate points are not canonical",
            );
        }
    }

    fn validate_path_intersections(
        &mut self,
        edges: &BTreeMap<&str, (&EdgeDefinition, usize)>,
        node_views: &BTreeMap<&str, (&NodeViewDefinition, usize)>,
        paths: &BTreeMap<&str, Vec<Point2>>,
    ) {
        let ids: Vec<_> = paths.keys().copied().collect();
        for left_index in 0..ids.len() {
            for right_index in (left_index + 1)..ids.len() {
                let left_id = ids[left_index];
                let right_id = ids[right_index];
                let (Some((left, _)), Some((right, _)), Some(a), Some(b)) = (
                    edges.get(left_id),
                    edges.get(right_id),
                    paths.get(left_id),
                    paths.get(right_id),
                ) else {
                    continue;
                };
                let shared_nodes: Vec<_> = [left.from.as_str(), left.to.as_str()]
                    .into_iter()
                    .filter(|node| *node == right.from || *node == right.to)
                    .collect();
                let allowed: BTreeSet<_> = shared_nodes
                    .iter()
                    .filter_map(|id| node_views.get(id).map(|v| v.0.position))
                    .collect();
                if polylines_intersection_outside(a, b, &allowed) {
                    self.issue("unmodeled_visual_intersection", format!("presentation.edge_paths.{left_id}"), format!("visual paths '{left_id}' and '{right_id}' meet away from a shared topological node"));
                }
            }
        }
    }

    fn validate_profile(
        &mut self,
        def: &WorldDefinition,
        nodes: &BTreeMap<&str, (&NodeDefinition, usize)>,
        edges: &BTreeMap<&str, (&EdgeDefinition, usize)>,
        lengths: &BTreeMap<&str, (&EdgeLengthDefinition, usize)>,
        sites: &BTreeMap<&str, (&BridgeSiteDefinition, usize)>,
    ) {
        let Some(profile) = &def.validation_profile else {
            return;
        };
        if profile.id != INITIAL_BATTLEFIELD_PROFILE_ID
            || profile.version != INITIAL_BATTLEFIELD_PROFILE_VERSION
        {
            return;
        }
        let mut expected_nodes = BTreeMap::<String, (Allegiance, NodeKind)>::new();
        expected_nodes.insert("A.BASE".into(), (Allegiance::A, NodeKind::Base));
        expected_nodes.insert("B.BASE".into(), (Allegiance::B, NodeKind::Base));
        expected_nodes.insert(
            "N.MID.OBS".into(),
            (Allegiance::Neutral, NodeKind::ObservationBase),
        );
        for side in ["A", "B"] {
            for lane in ["TOP", "MID", "BOT"] {
                let allegiance = if side == "A" {
                    Allegiance::A
                } else {
                    Allegiance::B
                };
                for suffix in ["T1", "T2"] {
                    expected_nodes.insert(
                        format!("{side}.{lane}.{suffix}"),
                        (allegiance, NodeKind::Lane),
                    );
                }
                expected_nodes.insert(format!("{side}.{lane}.J"), (allegiance, NodeKind::Junction));
                expected_nodes.insert(format!("{side}.{lane}.BANK"), (allegiance, NodeKind::Bank));
            }
        }
        for side in ["A", "B"] {
            for branch in ["U", "L"] {
                expected_nodes.insert(
                    format!("N.{side}.{branch}J"),
                    (Allegiance::Neutral, NodeKind::JungleJunction),
                );
                expected_nodes.insert(
                    format!("N.{side}.{branch}C"),
                    (Allegiance::Neutral, NodeKind::Camp),
                );
            }
        }
        if nodes.len() != 35 {
            self.issue(
                "battlefield_node_count",
                "topology.nodes",
                format!(
                    "initial Battlefield profile requires 35 nodes, found {}",
                    nodes.len()
                ),
            );
        }
        for id in expected_nodes.keys() {
            if !nodes.contains_key(id.as_str()) {
                self.issue(
                    "battlefield_missing_node",
                    "topology.nodes",
                    format!("initial Battlefield is missing '{id}'"),
                );
            }
        }
        for id in nodes.keys() {
            if !expected_nodes.contains_key(*id) {
                self.issue(
                    "battlefield_unexpected_node",
                    format!("topology.nodes.{id}"),
                    "node is outside the initial Battlefield profile",
                );
            }
        }
        for (id, (allegiance, kind)) in expected_nodes {
            if let Some((node, _)) = nodes.get(id.as_str()) {
                if (node.allegiance, node.kind) != (allegiance, kind) {
                    self.issue(
                        "battlefield_node_role",
                        format!("topology.nodes.{id}"),
                        "node allegiance or kind does not match the initial Battlefield profile",
                    );
                }
            }
        }
        let entries: BTreeSet<_> = def
            .topology
            .entry_nodes
            .iter()
            .map(String::as_str)
            .collect();
        if entries != ["A.BASE", "B.BASE"].into_iter().collect() {
            self.issue(
                "battlefield_entry_nodes",
                "topology.entry_nodes",
                "initial Battlefield uses both team bases as explicit topology entries",
            );
        }

        let mut expected_edges = BTreeMap::<
            (String, String),
            (u64, EdgeClass, Option<(RiverCrossingKind, Option<String>)>),
        >::new();
        let mut add =
            |from: String,
             to: String,
             length: u64,
             class: EdgeClass,
             crossing: Option<(RiverCrossingKind, Option<String>)>| {
                expected_edges.insert(normalized_pair(&from, &to), (length, class, crossing));
            };
        for side in ["A", "B"] {
            for lane in ["TOP", "MID", "BOT"] {
                let mut lane_nodes = if side == "A" {
                    vec![
                        "A.BASE".to_owned(),
                        format!("A.{lane}.T1"),
                        format!("A.{lane}.T2"),
                        format!("A.{lane}.J"),
                        format!("A.{lane}.BANK"),
                    ]
                } else {
                    vec![
                        format!("B.{lane}.BANK"),
                        format!("B.{lane}.J"),
                        format!("B.{lane}.T2"),
                        format!("B.{lane}.T1"),
                        "B.BASE".to_owned(),
                    ]
                };
                let lane_lengths = if side == "A" {
                    [150, 150, 100, 50]
                } else {
                    [50, 100, 150, 150]
                };
                for (pair, length) in lane_nodes.windows(2).zip(lane_lengths) {
                    add(
                        pair[0].clone(),
                        pair[1].clone(),
                        length,
                        EdgeClass::Lane,
                        None,
                    );
                }
                lane_nodes.clear();
            }
        }
        for (lane, crossing) in [
            (
                "TOP",
                (
                    RiverCrossingKind::FixedBridge,
                    Some("bridge.top".to_owned()),
                ),
            ),
            (
                "BOT",
                (
                    RiverCrossingKind::FixedBridge,
                    Some("bridge.bot".to_owned()),
                ),
            ),
        ] {
            add(
                format!("A.{lane}.BANK"),
                format!("B.{lane}.BANK"),
                100,
                EdgeClass::Lane,
                Some(crossing),
            );
        }
        add(
            "A.MID.BANK".into(),
            "N.MID.OBS".into(),
            50,
            EdgeClass::Lane,
            Some((
                RiverCrossingKind::FixedFacilityBridge,
                Some("bridge.mid".into()),
            )),
        );
        add(
            "N.MID.OBS".into(),
            "B.MID.BANK".into(),
            50,
            EdgeClass::Lane,
            Some((
                RiverCrossingKind::FixedFacilityBridge,
                Some("bridge.mid".into()),
            )),
        );
        for side in ["A", "B"] {
            for (jungle, lane_from, lane_to, camp) in
                [("UJ", "TOP", "MID", "UC"), ("LJ", "MID", "BOT", "LC")]
            {
                let junction = format!("N.{side}.{jungle}");
                add(
                    format!("{side}.{lane_from}.J"),
                    junction.clone(),
                    325,
                    EdgeClass::Jungle,
                    None,
                );
                add(
                    junction.clone(),
                    format!("{side}.{lane_to}.J"),
                    325,
                    EdgeClass::Jungle,
                    None,
                );
                add(
                    junction,
                    format!("N.{side}.{camp}"),
                    45,
                    EdgeClass::Jungle,
                    None,
                );
            }
        }
        for branch in ["UJ", "LJ"] {
            add(
                format!("N.A.{branch}"),
                format!("N.B.{branch}"),
                620,
                EdgeClass::Jungle,
                Some((RiverCrossingKind::FootFord, None)),
            );
        }
        if edges.len() != 42 {
            self.issue(
                "battlefield_edge_count",
                "topology.edges",
                format!(
                    "initial Battlefield profile requires 42 edges, found {}",
                    edges.len()
                ),
            );
        }
        let actual_pairs: BTreeSet<_> = def
            .topology
            .edges
            .iter()
            .map(|edge| normalized_pair(&edge.from, &edge.to))
            .collect();
        if actual_pairs.len() != edges.len() {
            self.issue(
                "battlefield_parallel_edge",
                "topology.edges",
                "initial Battlefield does not contain parallel links between the same nodes",
            );
        }
        for pair in expected_edges.keys() {
            if !actual_pairs.contains(pair) {
                self.issue(
                    "battlefield_missing_edge",
                    "topology.edges",
                    format!("required connection '{}' — '{}' is missing", pair.0, pair.1),
                );
            }
        }
        let expected_pairs: BTreeSet<_> = expected_edges.keys().cloned().collect();
        for pair in actual_pairs.difference(&expected_pairs) {
            self.issue(
                "battlefield_unexpected_edge",
                "topology.edges",
                format!(
                    "connection '{}' — '{}' is not in the initial Battlefield profile",
                    pair.0, pair.1
                ),
            );
        }
        if expected_edges.len() != 42 {
            self.issue(
                "battlefield_profile_error",
                "validation_profile",
                "built-in Battlefield profile has an invalid expected topology table",
            );
        }
        for edge in &def.topology.edges {
            let pair = normalized_pair(&edge.from, &edge.to);
            if let Some((expected_length, expected_class, expected_crossing)) =
                expected_edges.get(&pair)
            {
                if edge.directionality != Directionality::Bidirectional {
                    self.issue(
                        "battlefield_edge_direction",
                        format!("topology.edges.{}", edge.id),
                        "initial Battlefield edges are bidirectional",
                    );
                }
                if edge.class != *expected_class {
                    self.issue(
                        "battlefield_edge_class",
                        format!("topology.edges.{}", edge.id),
                        "edge class does not match the initial Battlefield profile",
                    );
                }
                let actual_crossing = edge
                    .river_crossing
                    .as_ref()
                    .map(|x| (x.kind, x.bridge_site_id.clone()));
                if &actual_crossing != expected_crossing {
                    self.issue(
                        "battlefield_crossing_kind",
                        format!("topology.edges.{}.river_crossing", edge.id),
                        "river crossing metadata does not match the fixed bridge and ford profile",
                    );
                }
                if let Some((actual, _)) = lengths.get(edge.id.as_str()) {
                    if actual.length_wu != *expected_length {
                        self.issue(
                            "battlefield_metric",
                            format!("metric.edge_lengths_wu.{}", edge.id),
                            format!("initial Battlefield edge length must be {expected_length} WU"),
                        );
                    }
                }
                let expected_kinds: BTreeSet<_> = match edge.river_crossing.as_ref().map(|x| x.kind)
                {
                    Some(
                        RiverCrossingKind::FixedBridge | RiverCrossingKind::FixedFacilityBridge,
                    ) => [TrackKind::Center].into_iter().collect(),
                    Some(RiverCrossingKind::FootFord) => [TrackKind::Single].into_iter().collect(),
                    None if edge.class == EdgeClass::Lane => {
                        [TrackKind::Left, TrackKind::Center, TrackKind::Right]
                            .into_iter()
                            .collect()
                    }
                    None => [TrackKind::Single].into_iter().collect(),
                };
                if let Some(set) = def
                    .metric
                    .edge_tracks
                    .iter()
                    .find(|set| set.edge_id == edge.id)
                {
                    let actual: BTreeSet<_> = set.tracks.iter().map(|track| track.kind).collect();
                    if actual != expected_kinds {
                        self.issue("battlefield_track_set", format!("metric.edge_tracks.{}", edge.id), "track set does not match normal lane, fixed bridge, or single-corridor Battlefield policy");
                    }
                    if let Some(length) = lengths.get(edge.id.as_str()).map(|x| x.0.length_wu) {
                        if set.tracks.iter().any(|track| {
                            track.start_progress_wu != 0 || track.end_progress_wu != length
                        }) {
                            self.issue(
                                "battlefield_track_range",
                                format!("metric.edge_tracks.{}", edge.id),
                                "initial Battlefield tracks span their full edge length",
                            );
                        }
                    }
                }
            }
        }
        let expected_sites: BTreeSet<_> = ["bridge.top", "bridge.bot", "bridge.mid"]
            .into_iter()
            .collect();
        let actual_sites: BTreeSet<_> = sites.keys().copied().collect();
        if actual_sites != expected_sites {
            self.issue(
                "battlefield_bridge_sites",
                "topology.bridge_sites",
                "initial Battlefield requires fixed TOP, BOT and shared MID bridge sites",
            );
        }
        let river_ids: BTreeSet<_> = def
            .topology
            .edges
            .iter()
            .filter_map(|edge| edge.river_crossing.as_ref().map(|x| x.river_id.as_str()))
            .collect();
        if river_ids != ["river.main"].into_iter().collect() {
            self.issue(
                "battlefield_river",
                "topology.edges",
                "initial Battlefield crossing edges reference the single river.main feature",
            );
        }
        for edge in &def.topology.edges {
            if let Some(assignment) = def
                .terrain
                .edge_profiles
                .iter()
                .find(|x| x.edge_id == edge.id)
            {
                if let Some(profile) = def
                    .terrain
                    .profiles
                    .iter()
                    .find(|x| x.id == assignment.profile_id)
                {
                    let expected_observation = match edge.class {
                        EdgeClass::Lane => Some(ObservationSemantics::Open),
                        EdgeClass::Jungle => Some(ObservationSemantics::Concealing),
                        EdgeClass::Other => None,
                    };
                    if expected_observation.is_some_and(|expected| profile.observation != expected)
                    {
                        self.issue(
                            "battlefield_terrain_semantics",
                            format!("terrain.profiles.{}", profile.id),
                            "initial Battlefield lane and jungle observation semantics differ",
                        );
                    }
                }
            }
        }

        for lane in ["TOP", "MID", "BOT"] {
            let route: Vec<String> = if lane == "MID" {
                [
                    "A.BASE",
                    "A.MID.T1",
                    "A.MID.T2",
                    "A.MID.J",
                    "A.MID.BANK",
                    "N.MID.OBS",
                    "B.MID.BANK",
                    "B.MID.J",
                    "B.MID.T2",
                    "B.MID.T1",
                    "B.BASE",
                ]
                .into_iter()
                .map(str::to_owned)
                .collect()
            } else {
                vec![
                    "A.BASE".to_owned(),
                    format!("A.{lane}.T1"),
                    format!("A.{lane}.T2"),
                    format!("A.{lane}.J"),
                    format!("A.{lane}.BANK"),
                    format!("B.{lane}.BANK"),
                    format!("B.{lane}.J"),
                    format!("B.{lane}.T2"),
                    format!("B.{lane}.T1"),
                    "B.BASE".to_owned(),
                ]
            };
            let distance = route.windows(2).try_fold(0u64, |sum, pair| {
                let edge = def.topology.edges.iter().find(|edge| {
                    (edge.from == pair[0] && edge.to == pair[1])
                        || (edge.from == pair[1] && edge.to == pair[0])
                })?;
                let length = lengths.get(edge.id.as_str())?.0.length_wu;
                Some(sum.saturating_add(length))
            });
            if distance != Some(1000) {
                self.issue(
                    "battlefield_lane_distance",
                    "metric.edge_lengths_wu",
                    format!("the initial {lane} route between bases must total 1000 WU"),
                );
            }
        }
    }
}

fn normalized_pair(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_owned(), b.to_owned())
    } else {
        (b.to_owned(), a.to_owned())
    }
}

fn orient(a: Point2, b: Point2, c: Point2) -> i128 {
    (i128::from(b.x) - i128::from(a.x)) * (i128::from(c.y) - i128::from(a.y))
        - (i128::from(b.y) - i128::from(a.y)) * (i128::from(c.x) - i128::from(a.x))
}

fn on_segment(a: Point2, b: Point2, p: Point2) -> bool {
    orient(a, b, p) == 0
        && p.x >= a.x.min(b.x)
        && p.x <= a.x.max(b.x)
        && p.y >= a.y.min(b.y)
        && p.y <= a.y.max(b.y)
}

fn segments_intersect(a: Point2, b: Point2, c: Point2, d: Point2) -> bool {
    let (o1, o2, o3, o4) = (
        orient(a, b, c),
        orient(a, b, d),
        orient(c, d, a),
        orient(c, d, b),
    );
    if o1 == 0 && on_segment(a, b, c) {
        return true;
    }
    if o2 == 0 && on_segment(a, b, d) {
        return true;
    }
    if o3 == 0 && on_segment(c, d, a) {
        return true;
    }
    if o4 == 0 && on_segment(c, d, b) {
        return true;
    }
    (o1.signum() != o2.signum()) && (o3.signum() != o4.signum())
}

fn pair_intersection_allowed(
    a: Point2,
    b: Point2,
    c: Point2,
    d: Point2,
    allowed: &BTreeSet<Point2>,
) -> bool {
    if !segments_intersect(a, b, c, d) {
        return true;
    }
    if orient(a, b, c) == 0 && orient(a, b, d) == 0 {
        let common: BTreeSet<_> = [a, b].into_iter().filter(|p| *p == c || *p == d).collect();
        return common.len() == 1 && common.iter().all(|p| allowed.contains(p));
    }
    [a, b, c, d]
        .into_iter()
        .any(|p| allowed.contains(&p) && on_segment(a, b, p) && on_segment(c, d, p))
}

fn polylines_intersection_outside(a: &[Point2], b: &[Point2], allowed: &BTreeSet<Point2>) -> bool {
    for left in a.windows(2) {
        for right in b.windows(2) {
            if segments_intersect(left[0], left[1], right[0], right[1])
                && !pair_intersection_allowed(left[0], left[1], right[0], right[1], allowed)
            {
                return true;
            }
        }
    }
    false
}

fn polylines_intersect(a: &[Point2], b: &[Point2]) -> bool {
    a.windows(2).any(|x| {
        b.windows(2)
            .any(|y| segments_intersect(x[0], x[1], y[0], y[1]))
    })
}

fn polyline_self_intersects(points: &[Point2]) -> bool {
    for i in 0..points.len().saturating_sub(1) {
        for j in i + 2..points.len().saturating_sub(1) {
            if segments_intersect(points[i], points[i + 1], points[j], points[j + 1]) {
                return true;
            }
        }
    }
    false
}

fn polyline_self_intersects_closed(points: &[Point2]) -> bool {
    if polyline_self_intersects(points) {
        return true;
    }
    let Some(first) = points.first() else {
        return false;
    };
    let Some(last) = points.last() else {
        return false;
    };
    for i in 1..points.len().saturating_sub(2) {
        if segments_intersect(*first, *last, points[i], points[i + 1]) {
            return true;
        }
    }
    false
}
