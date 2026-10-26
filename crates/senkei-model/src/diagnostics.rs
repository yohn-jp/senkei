use crate::{CombatantSide, ContentDigest, DomainValue, Intent, LogicalCu, MatchId, StateId, SymbolId};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestrictedDiagnostics {
    pub identity: RestrictedDiagnosticsIdentity,
    pub events: Vec<DiagnosticEvent>,
    pub cu_by_side: BTreeMap<CombatantSide, LogicalCu>,
    pub final_memory_by_side: BTreeMap<CombatantSide, crate::TacticalMemory>,
}

/// Provenance binding for one owner's restricted trace. The other side's
/// program digest is deliberately absent from this owner-only projection.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestrictedDiagnosticsIdentity {
    pub schema_version: u32,
    pub side: CombatantSide,
    pub match_id: MatchId,
    pub result_digest: ContentDigest,
    /// SHA-256 of canonical JSON for both snapshots and the complete MatchContext.
    pub snapshot_digest: ContentDigest,
    /// Content digest of the program owned by `side`.
    pub program_digest: ContentDigest,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticEvent {
    pub tick: u32,
    pub side: CombatantSide,
    pub sequence: u64,
    /// Null when the event is not attributable to one tactical action/entity.
    pub action_id: Option<crate::ActionId>,
    pub entity_id: Option<crate::EntityId>,
    pub record: DiagnosticRecord,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum DiagnosticRecord {
    StateEvaluated { state: StateId, result: crate::Truth },
    IntentProposed { intent: Intent },
    IntentAccepted { intent: Intent },
    IntentRejected { intent: Intent, reason: SymbolId },
    CostCharged { operation: crate::CostOperationId, amount: LogicalCu },
    MemoryRead { state: StateId, value: Option<DomainValue> },
    MemoryWritten { state: StateId, value: DomainValue },
    RuntimeNotice { code: crate::DiagnosticCode, details: BTreeMap<String, String> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum TacticalDiagnostic {
    StateEvaluated { state: StateId, result: crate::Truth },
    IntentProposed { intent: Intent },
    CostCharged { operation: crate::CostOperationId, amount: LogicalCu },
    MemoryRead { state: StateId, value: Option<DomainValue> },
    MemoryWritten { state: StateId, value: DomainValue },
    RuntimeNotice { code: crate::DiagnosticCode, details: BTreeMap<String, String> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub code: String,
    pub path: String,
    pub message: String,
    pub details: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileDiagnostic {
    pub severity: DiagnosticSeverity,
    pub code: crate::DiagnosticCode,
    pub message: String,
    pub path: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticSeverity {
    Info,
    Warning,
}

impl ValidationIssue {
    pub fn new(code: impl Into<String>, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), path: path.into(), message: message.into(), details: BTreeMap::new() }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiError {
    pub code: ApiErrorCode,
    pub message: String,
    pub path: Option<String>,
    pub details: BTreeMap<String, String>,
}

impl ApiError {
    pub fn new(code: ApiErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), path: None, details: BTreeMap::new() }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiErrorCode {
    InvalidRequest,
    InvalidVersion,
    InvalidRuleset,
    ValidationFailed,
    CompileFailed,
    InvalidProgram,
    RuntimeFailure,
    InvalidSnapshot,
    IncompatibleVersion,
    UnsupportedPrimitive,
    BudgetExceeded,
    ResourceLimit,
    TransitionConflict,
    ArithmeticOverflow,
    InternalError,
}
