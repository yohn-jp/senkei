use crate::*;
use serde::Serialize;

/// A successfully validated World artifact.
///
/// Construction is private and the artifact has no Deserialize implementation,
/// so callers cannot make untrusted serialized data appear verified.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct VerifiedWorld {
    identity: WorldIdentity,
    simulation: CanonicalSimulationWorld,
    presentation: CanonicalPresentationWorld,
}

impl VerifiedWorld {
    pub fn identity(&self) -> &WorldIdentity {
        &self.identity
    }
    pub fn simulation_world(&self) -> &CanonicalSimulationWorld {
        &self.simulation
    }
    pub fn presentation_world(&self) -> &CanonicalPresentationWorld {
        &self.presentation
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorldCompileError {
    InvalidJson(String),
    InvalidWorld(Vec<WorldIssue>),
}

impl std::fmt::Display for WorldCompileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(error) => write!(f, "invalid World definition JSON: {error}"),
            Self::InvalidWorld(issues) => write!(
                f,
                "World definition has {} validation issue(s)",
                issues.len()
            ),
        }
    }
}

impl std::error::Error for WorldCompileError {}

/// Parse strict authoring JSON and compile it into a sealed artifact.
pub fn compile_json(bytes: &[u8]) -> Result<VerifiedWorld, WorldCompileError> {
    let definition: WorldDefinition = serde_json::from_slice(bytes)
        .map_err(|error| WorldCompileError::InvalidJson(error.to_string()))?;
    compile(definition).map_err(WorldCompileError::InvalidWorld)
}

/// Validate and compile an authored World.
pub fn compile(definition: WorldDefinition) -> Result<VerifiedWorld, Vec<WorldIssue>> {
    let issues = validation::validate(&definition);
    if !issues.is_empty() {
        return Err(issues);
    }

    let simulation = CanonicalSimulationWorld {
        topology: CanonicalTopology {
            entry_nodes: definition.topology.entry_nodes.into_iter().collect(),
            nodes: definition
                .topology
                .nodes
                .into_iter()
                .map(|node| (node.id.clone(), node))
                .collect(),
            edges: definition
                .topology
                .edges
                .into_iter()
                .map(|edge| (edge.id.clone(), edge))
                .collect(),
            bridge_sites: definition
                .topology
                .bridge_sites
                .into_iter()
                .map(|mut site| {
                    site.edge_ids.sort();
                    (
                        site.id.clone(),
                        CanonicalBridgeSite {
                            id: site.id,
                            kind: site.kind,
                            edge_ids: site.edge_ids,
                        },
                    )
                })
                .collect(),
        },
        metric: CanonicalMetric {
            edge_lengths_wu: definition
                .metric
                .edge_lengths_wu
                .into_iter()
                .map(|length| (length.edge_id, length.length_wu))
                .collect(),
            edge_tracks: definition
                .metric
                .edge_tracks
                .into_iter()
                .map(|mut tracks| {
                    tracks.tracks.sort_by(|a, b| {
                        (&a.id, a.kind, a.start_progress_wu, a.end_progress_wu).cmp(&(
                            &b.id,
                            b.kind,
                            b.start_progress_wu,
                            b.end_progress_wu,
                        ))
                    });
                    (tracks.edge_id, tracks.tracks)
                })
                .collect(),
            river_crossing_ranges: definition
                .metric
                .river_crossing_ranges
                .into_iter()
                .map(|range| {
                    (
                        range.edge_id,
                        CanonicalRiverCrossingRange {
                            river_id: range.river_id,
                            start_progress_wu: range.start_progress_wu,
                            end_progress_wu: range.end_progress_wu,
                        },
                    )
                })
                .collect(),
        },
        terrain: CanonicalTerrain {
            profiles: definition
                .terrain
                .profiles
                .into_iter()
                .map(|profile| (profile.id.clone(), profile))
                .collect(),
            edge_profiles: definition
                .terrain
                .edge_profiles
                .into_iter()
                .map(|assignment| (assignment.edge_id, assignment.profile_id))
                .collect(),
        },
    };
    let presentation = CanonicalPresentationWorld {
        view_box: definition.presentation.view_box,
        node_positions: definition
            .presentation
            .node_positions
            .into_iter()
            .map(|node| {
                (
                    node.node_id,
                    CanonicalNodeView {
                        position: node.position,
                        material_id: node.material_id,
                    },
                )
            })
            .collect(),
        edge_paths: definition
            .presentation
            .edge_paths
            .into_iter()
            .map(|path| {
                (
                    path.edge_id,
                    CanonicalEdgePath {
                        points: path.points,
                        visual_width: path.visual_width,
                        material_id: path.material_id,
                    },
                )
            })
            .collect(),
        rivers: definition
            .presentation
            .rivers
            .into_iter()
            .map(|river| {
                (
                    river.id,
                    CanonicalRiverView {
                        points: river.points,
                        visual_width: river.visual_width,
                        material_id: river.material_id,
                    },
                )
            })
            .collect(),
        visual_regions: definition
            .presentation
            .visual_regions
            .into_iter()
            .map(|region| {
                (
                    region.id,
                    CanonicalVisualRegion {
                        terrain_profile_id: region.terrain_profile_id,
                        outline: region.outline,
                        material_id: region.material_id,
                    },
                )
            })
            .collect(),
        materials: definition
            .presentation
            .materials
            .into_iter()
            .map(|material| (material.id.clone(), material))
            .collect(),
        lighting: definition.presentation.lighting,
        foliage: definition
            .presentation
            .foliage
            .into_iter()
            .map(|foliage| (foliage.id.clone(), foliage))
            .collect(),
    };

    let logic_digest =
        WorldLogicDigest::from_value(&simulation).expect("World simulation schema serializes");
    let presentation_digest = WorldPresentationDigest::from_value(&presentation)
        .expect("World presentation schema serializes");
    Ok(VerifiedWorld {
        identity: WorldIdentity {
            world_id: definition.id,
            schema_version: definition.schema_version,
            compatibility: definition.compatibility,
            validation_profile: definition.validation_profile,
            logic_digest,
            presentation_digest,
        },
        simulation,
        presentation,
    })
}

/// Serialize a compiler artifact's simulation projection in canonical bytes.
pub fn canonical_simulation_bytes(world: &VerifiedWorld) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&world.simulation)
}

/// Serialize a compiler artifact's presentation projection in canonical bytes.
pub fn canonical_presentation_bytes(world: &VerifiedWorld) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&world.presentation)
}

/// Serialize the paired identity and both verified projections as one artifact.
/// The bytes are output-only; parsing them cannot create a `VerifiedWorld`.
pub fn canonical_artifact_bytes(world: &VerifiedWorld) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(world)
}
