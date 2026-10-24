use crate::{
    CombatantSide, DomainValue, Intent, ObservationSnapshot, TacticalMemory,
    TacticalProgram,
};
use std::collections::BTreeSet;

pub const COST_PATH_READ: &str = "jinrei.path_read";
pub const COST_COMPARISON: &str = "jinrei.comparison";
pub const COST_ARITHMETIC: &str = "jinrei.arithmetic";
pub const COST_LOGIC: &str = "jinrei.logic";
pub const COST_STATE_REFERENCE: &str = "jinrei.state_reference";
pub const COST_COLLECTION_ITERATION: &str = "jinrei.collection_iteration";
pub const COST_AGGREGATE: &str = "jinrei.aggregate";
pub const COST_MEMORY_READ: &str = "jinrei.memory_read";
pub const COST_MEMORY_WRITE: &str = "jinrei.memory_write";
pub const COST_CAPABILITY_ISSUE: &str = "jinrei.capability_issue";
pub const REQUIRED_JINREI_COST_OPERATIONS: [&str; 10] = [
    COST_PATH_READ,
    COST_COMPARISON,
    COST_ARITHMETIC,
    COST_LOGIC,
    COST_STATE_REFERENCE,
    COST_COLLECTION_ITERATION,
    COST_AGGREGATE,
    COST_MEMORY_READ,
    COST_MEMORY_WRITE,
    COST_CAPABILITY_ISSUE,
];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct LogicalCu(pub u64);

impl LogicalCu {
    pub const ZERO: Self = Self(0);
    /// Upper bound required when values cross the JSON-to-JavaScript boundary.
    pub const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;

    pub fn checked_add(self, other: Self) -> Option<Self> {
        self.0.checked_add(other.0).map(Self)
    }

    pub fn is_json_safe(self) -> bool {
        self.0 <= Self::MAX_SAFE_JSON_INTEGER
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ExecutionBudget {
    pub available_cu: LogicalCu,
    pub max_intents: u32,
}

pub struct TacticalExecutionRequest<'a> {
    pub side: CombatantSide,
    pub tick: u32,
    pub program: &'a TacticalProgram,
    pub observation: &'a ObservationSnapshot,
    pub memory: &'a TacticalMemory,
    pub allowed_capabilities: &'a BTreeSet<crate::CapabilityId>,
    pub budget: ExecutionBudget,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TacticalExecutionOutput {
    pub status: TacticalExecutionStatus,
    pub intents: Vec<Intent>,
    /// Proposed next memory; Enbu commits it atomically at the RulePlan-defined point.
    pub next_memory: TacticalMemory,
    pub charged_cu: LogicalCu,
    /// Full deterministic cost of the evaluation, before the budget cap.
    pub required_cu: LogicalCu,
    pub diagnostics: Vec<crate::TacticalDiagnostic>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TacticalExecutionStatus {
    Completed,
    BudgetExceeded,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TacticalExecutionError {
    pub code: crate::ApiErrorCode,
    pub message: String,
    pub details: std::collections::BTreeMap<String, String>,
}

/// Enbu depends on this execution port and does not depend on Jinrei's parser or VM.
pub trait TacticalExecutionPort {
    fn execute(
        &mut self,
        request: TacticalExecutionRequest<'_>,
    ) -> Result<TacticalExecutionOutput, TacticalExecutionError>;
}

/// A convenience record for schema-typed values emitted to diagnostic traces.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StateWrite {
    pub state: crate::StateId,
    pub value: DomainValue,
}
