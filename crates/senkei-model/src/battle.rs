use crate::{
    ActionId, CapabilityId, CollectionId, ComponentVersions, ContentDigest, DomainValue, EntityId,
    EventId, FieldId, LogicalCu, ObservationPath, Observed, RulesetRef, StateId, SymbolId, TypeId,
    Version,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CombatantSide {
    Attacker,
    Defender,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TacticalProgram {
    pub language_version: Version,
    pub ir_version: Version,
    pub bytecode_version: Version,
    pub cost_schedule_id: crate::CostScheduleId,
    pub cost_schedule_version: Version,
    pub ruleset: RulesetRef,
    pub content_digest: ContentDigest,
    /// Opaque, verified Jinrei-specific bytecode. The shared model never interprets it.
    pub bytecode: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileResult {
    pub ast: crate::StructuredTacticsAst,
    pub program: TacticalProgram,
    pub estimated_cu: LogicalCu,
    pub diagnostics: Vec<crate::CompileDiagnostic>,
    /// Nonsemantic editor metadata, absent when compiled from a structured AST.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_map: Option<ActionSourceMap>,
}

/// Exact text revision and compiled program binding. Never part of program identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionSourceMap {
    pub schema_version: u32,
    /// SHA-256 of the exact UTF-8 source bytes, including comments and whitespace.
    pub source_digest: ContentDigest,
    pub program_digest: ContentDigest,
    pub actions: Vec<ActionSourceLocation>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionSourceLocation {
    pub action_id: ActionId,
    /// Index in the original parsed declarations, before semantic canonicalization.
    pub declaration_index: usize,
    /// Half-open UTF-8 byte range, from `action` through its closing brace.
    pub start_utf8: usize,
    pub end_utf8: usize,
}

pub type TacticalMemory = BTreeMap<StateId, DomainValue>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenkeiSnapshot {
    pub schema_version: Version,
    pub id: crate::ArtifactId,
    pub revision: crate::RevisionId,
    pub ruleset: RulesetRef,
    /// Senritsu-defined, schema-checked army, deployment, and other preparation data.
    pub configuration: BTreeMap<FieldId, DomainValue>,
    pub program: TacticalProgram,
    pub initial_memory: TacticalMemory,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldState {
    pub entities: BTreeMap<EntityId, EntityState>,
    pub global_fields: BTreeMap<FieldId, DomainValue>,
    pub collections: BTreeMap<CollectionId, Vec<DomainValue>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityState {
    pub entity_type: TypeId,
    pub owner: Option<CombatantSide>,
    pub fields: BTreeMap<FieldId, DomainValue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityObservation {
    pub id: EntityId,
    pub entity_type: TypeId,
    pub fields: BTreeMap<FieldId, Observed<DomainValue>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObservationSnapshot {
    pub tick: u32,
    pub side: CombatantSide,
    pub fields: BTreeMap<ObservationPath, Observed<DomainValue>>,
    pub collections: BTreeMap<CollectionId, Observed<Vec<EntityObservation>>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Intent {
    pub action_id: ActionId,
    pub capability: CapabilityId,
    pub actor: Option<EntityId>,
    pub target: Option<EntityId>,
    pub arguments: Vec<DomainValue>,
    /// Only read by a RulePlan that explicitly includes the Priority key.
    pub priority: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntentBatch {
    pub tick: u32,
    pub side: CombatantSide,
    pub intents: Vec<Intent>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchContext {
    pub schema_version: Version,
    pub match_id: crate::MatchId,
    pub ruleset: RulesetRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_identity: Option<crate::WorldIdentityRef>,
    pub versions: ComponentVersions,
    pub initial_world: WorldState,
    pub max_ticks: u32,
    pub host_limits: HostLimits,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostLimits {
    pub max_input_bytes: u64,
    pub max_entities: u32,
    pub max_events: u64,
    pub max_diagnostic_events: u64,
    pub max_output_bytes: u64,
}

impl From<&crate::RuleLimits> for HostLimits {
    fn from(limits: &crate::RuleLimits) -> Self {
        Self {
            max_input_bytes: limits.max_input_bytes,
            max_entities: limits.max_entities,
            max_events: limits.max_events,
            max_diagnostic_events: limits.max_diagnostic_events,
            max_output_bytes: limits.max_output_bytes,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchResult {
    pub match_id: crate::MatchId,
    pub outcome: crate::MatchOutcome,
    pub termination_reason: SymbolId,
    pub final_tick: u32,
    pub statistics: BTreeMap<SymbolId, DomainValue>,
    pub cu_spent: BTreeMap<CombatantSide, LogicalCu>,
    pub final_state_digest: ContentDigest,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationReplay {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perspective: Option<CombatantSide>,
    pub schema_version: Version,
    /// Paired World artifact identity used to interpret static scene and replay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_identity: Option<crate::WorldIdentityRef>,
    /// Exact RulePackage identity used to produce this replay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ruleset: Option<RulesetRef>,
    pub match_id: crate::MatchId,
    pub result_digest: ContentDigest,
    pub frames: Vec<ReplayFrame>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplayFrame {
    pub tick: u32,
    pub events: Vec<PresentationEvent>,
    pub visible_state: Option<WorldStateView>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationEvent {
    pub event: EventId,
    pub entity: Option<EntityId>,
    pub payload: BTreeMap<FieldId, DomainValue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldStateView {
    pub entities: BTreeMap<EntityId, EntityStateView>,
    pub global_fields: BTreeMap<FieldId, DomainValue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityStateView {
    pub entity_type: TypeId,
    pub owner: Option<CombatantSide>,
    pub fields: BTreeMap<FieldId, DomainValue>,
}

/// A presentation-only projection. It is not interchangeable with internal WorldState.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicSimulationResponse {
    pub result: MatchResult,
    pub replay: PresentationReplay,
}

/// The complete battle input needed for deterministic local reproduction.
/// It intentionally has no general `Serialize` implementation because it can
/// contain both sides' private programs and setup data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReproductionContext {
    pub attacker: SenkeiSnapshot,
    pub defender: SenkeiSnapshot,
    pub rule_package_digest: ContentDigest,
    pub context: MatchContext,
}

/// Complete engine output. Callers choose explicitly whether to serialize
/// `diagnostics`; there is no blanket public serialization for this container.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SimulationArtifact {
    /// Legacy attacker-only alias retained during owner-channel migration.
    pub owner_replay: Option<PresentationReplay>,
    /// Authenticated owner-only projections keyed by perspective.
    pub owner_replays: BTreeMap<CombatantSide, PresentationReplay>,
    pub result: MatchResult,
    pub replay: PresentationReplay,
    pub diagnostics: crate::RestrictedDiagnostics,
    pub reproduction: ReproductionContext,
}

impl SimulationArtifact {
    pub fn public_response(&self) -> PublicSimulationResponse {
        PublicSimulationResponse {
            result: self.result.clone(),
            replay: self.replay.clone(),
        }
    }

    pub fn diagnostic_response(&self, side: CombatantSide) -> crate::LocalSimulationResponse {
        let mut diagnostics = self.diagnostics.clone();
        diagnostics.events.retain(|event| event.side == side);
        diagnostics.cu_by_side.retain(|event_side, _| *event_side == side);
        diagnostics.final_memory_by_side.retain(|event_side, _| *event_side == side);
        let owner_replays = self.owner_replays.iter()
            .filter(|(owner, _)| **owner == side)
            .map(|(owner, replay)| (*owner, replay.clone()))
            .collect();
        crate::LocalSimulationResponse {
            authorized_side: Some(side),
            // Deprecated wire alias remains empty; consumers use the
            // side-keyed authorized channel below.
            owner_replay: None,
            owner_replays,
            result: self.result.clone(),
            replay: self.replay.clone(),
            diagnostics: Some(diagnostics),
        }
    }
}
