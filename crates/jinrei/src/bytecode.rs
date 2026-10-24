use crate::{types::TypedProgram, BYTECODE_VERSION, MAX_BYTECODE_BYTES};
use serde::{Deserialize, Serialize};
use senkei_model::{ApiErrorCode, CostOperationId, CostSchedule, LogicalCuCost, StructuredTacticsAst, Version};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(crate) const MAGIC: &[u8; 8] = b"JINREI\0\x01";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CostKind { PathRead, Compare, Logic, Knownness, StateReference, CollectionIteration, Aggregate, Arithmetic }

impl CostKind {
    pub fn key(self) -> &'static str {
        match self {
            Self::PathRead => "jinrei.path_read",
            Self::Compare | Self::Knownness => "jinrei.comparison",
            Self::Logic => "jinrei.logic",
            Self::StateReference => "jinrei.state_reference",
            Self::CollectionIteration => "jinrei.collection_iteration",
            Self::Aggregate => "jinrei.aggregate",
            Self::Arithmetic => "jinrei.arithmetic",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CostedProgram {
    pub source_ast: StructuredTacticsAst,
    pub typed: TypedProgram,
    pub cost_schedule_id: senkei_model::CostScheduleId,
    pub cost_schedule_version: Version,
    pub costs: BTreeMap<CostKind, CostQuote>,
    pub static_estimate: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CostQuote {
    pub operation: CostOperationId,
    pub amount: LogicalCuCost,
}

pub(crate) fn encode(program: &CostedProgram) -> Result<Vec<u8>, crate::CompileError> {
    let json = serde_json::to_vec(program).map_err(|_| crate::CompileError::new(ApiErrorCode::InternalError, "failed to encode Jinrei bytecode"))?;
    let total = MAGIC.len().saturating_add(6).saturating_add(json.len());
    if total > MAX_BYTECODE_BYTES { return Err(crate::CompileError::new(ApiErrorCode::ResourceLimit, "compiled bytecode exceeds the host bytecode limit")); }
    let mut bytes = Vec::with_capacity(total);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&BYTECODE_VERSION.major.to_be_bytes());
    bytes.extend_from_slice(&BYTECODE_VERSION.minor.to_be_bytes());
    bytes.extend_from_slice(&BYTECODE_VERSION.patch.to_be_bytes());
    bytes.extend_from_slice(&json);
    Ok(bytes)
}

pub(crate) fn decode(bytes: &[u8]) -> Result<CostedProgram, crate::CompileError> {
    if bytes.len() > MAX_BYTECODE_BYTES { return Err(invalid("bytecode exceeds the host bytecode limit")); }
    if bytes.len() < MAGIC.len() + 6 || &bytes[..MAGIC.len()] != MAGIC { return Err(invalid("invalid Jinrei bytecode magic")); }
    let major = u16::from_be_bytes([bytes[8], bytes[9]]);
    let minor = u16::from_be_bytes([bytes[10], bytes[11]]);
    let patch = u16::from_be_bytes([bytes[12], bytes[13]]);
    if Version::new(major, minor, patch) != BYTECODE_VERSION { return Err(invalid("unsupported Jinrei bytecode version")); }
    let payload = &bytes[MAGIC.len() + 6..];
    if !bounded_json_depth(payload, 128) { return Err(invalid("bytecode nesting exceeds the verifier limit")); }
    serde_json::from_slice(payload).map_err(|_| invalid("malformed Jinrei bytecode payload"))
}

pub(crate) fn digest(bytes: &[u8]) -> String {
    let hash = Sha256::digest(bytes);
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn verify_cost_schedule(program: &CostedProgram, schedule: &CostSchedule) -> bool {
    if program.cost_schedule_id != schedule.id || program.cost_schedule_version != schedule.version { return false; }
    program.costs.iter().all(|(kind, quote)| schedule.operations.get(&quote.operation) == Some(&quote.amount)
        && quote.operation.as_str() == kind.key())
}

fn bounded_json_depth(bytes: &[u8], max_depth: usize) -> bool {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for byte in bytes {
        if in_string {
            if escaped { escaped = false; }
            else if *byte == b'\\' { escaped = true; }
            else if *byte == b'"' { in_string = false; }
            continue;
        }
        match *byte {
            b'"' => in_string = true,
            b'{' | b'[' => { depth = depth.saturating_add(1); if depth > max_depth { return false; } }
            b'}' | b']' => { if depth == 0 { return false; } depth -= 1; }
            _ => {}
        }
    }
    depth == 0 && !in_string
}

fn invalid(message: impl Into<String>) -> crate::CompileError {
    crate::CompileError::new(ApiErrorCode::InvalidProgram, message)
}

pub(crate) fn required_costs(schedule: &CostSchedule, required: &std::collections::BTreeSet<CostKind>) -> Result<BTreeMap<CostKind, CostQuote>, crate::CompileError> {
    let mut costs = BTreeMap::new();
    for kind in required {
        let id = CostOperationId::new(kind.key());
        let amount = schedule.operations.get(&id).copied().ok_or_else(|| crate::CompileError::new(
            ApiErrorCode::ValidationFailed, format!("Senritsu cost schedule is missing required operation '{}'", kind.key())))?;
        costs.insert(*kind, CostQuote { operation: id, amount });
    }
    Ok(costs)
}

pub(crate) fn verify_core_cost_schedule(schedule: &CostSchedule) -> Result<(), crate::CompileError> {
    const REQUIRED: &[&str] = &[
        "jinrei.path_read", "jinrei.comparison", "jinrei.arithmetic", "jinrei.logic",
        "jinrei.state_reference", "jinrei.collection_iteration", "jinrei.aggregate",
        "jinrei.memory_read", "jinrei.memory_write", "jinrei.capability_issue",
    ];
    for name in REQUIRED {
        let id = CostOperationId::new(*name);
        let cost = schedule.operations.get(&id).ok_or_else(|| crate::CompileError::new(
            ApiErrorCode::ValidationFailed, format!("Senritsu cost schedule is missing required operation '{name}'")))?;
        if cost.base == 0 && cost.per_item == 0 {
            return Err(crate::CompileError::new(ApiErrorCode::ValidationFailed, format!("Senritsu cost operation '{name}' must define a nonzero total charge")));
        }
    }
    Ok(())
}
