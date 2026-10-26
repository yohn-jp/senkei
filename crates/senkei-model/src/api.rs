use crate::{
    ApiError, CompileResult, MatchContext, MatchId, RulesetRef, SenkeiSnapshot,
    StructuredTacticsAst, Version,
};
use serde::{Deserialize, Serialize};

pub const WASM_API_VERSION: Version = Version::new(1, 0, 0);

pub const OP_INITIAL_RULESET: &str = "initial_ruleset";
pub const OP_COMPILE_TEXT: &str = "compile_text";
pub const OP_COMPILE_AST: &str = "compile_ast";
pub const OP_PARSE_TEXT: &str = "parse_text";
pub const OP_FORMAT_AST: &str = "format_ast";
pub const OP_NEW_MATCH_CONTEXT: &str = "new_match_context";
pub const OP_SIMULATE: &str = "simulate";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmptyPayload {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiRequestEnvelope<T> {
    pub api_version: Version,
    pub request_id: String,
    pub operation: String,
    pub payload: T,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiResponseEnvelope<T> {
    pub api_version: Version,
    pub request_id: String,
    pub ok: bool,
    pub result: Option<T>,
    pub error: Option<ApiError>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileTextPayload {
    pub ruleset_ref: RulesetRef,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParseTextPayload {
    pub ruleset_ref: RulesetRef,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileAstPayload {
    pub ruleset_ref: RulesetRef,
    pub ast: StructuredTacticsAst,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormatAstPayload {
    pub ruleset_ref: RulesetRef,
    pub ast: StructuredTacticsAst,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewMatchContextPayload {
    pub ruleset_ref: RulesetRef,
    pub match_id: MatchId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimulatePayload {
    pub attacker: SenkeiSnapshot,
    pub defender: SenkeiSnapshot,
    pub context: MatchContext,
    /// Local WASM only. Public outputs use `PublicSimulationResponse`.
    pub include_diagnostics: bool,
    /// Required when diagnostics are requested; authorizes one owner channel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostics_side: Option<crate::CombatantSide>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreflightPayload {
    pub attacker: SenkeiSnapshot,
    pub defender: SenkeiSnapshot,
    pub context: MatchContext,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalSimulationResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorized_side: Option<crate::CombatantSide>,
    /// Restricted attacker-perspective projection; absent from public responses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_replay: Option<crate::PresentationReplay>,
    /// Owner-only perspective projections keyed by their authorized side.
    #[serde(default)]
    pub owner_replays: std::collections::BTreeMap<crate::CombatantSide, crate::PresentationReplay>,
    pub result: crate::MatchResult,
    pub replay: crate::PresentationReplay,
    /// `null` unless requested by the local-only simulator caller.
    pub diagnostics: Option<crate::RestrictedDiagnostics>,
}

impl From<CompileResult> for CompileResultEnvelope {
    fn from(value: CompileResult) -> Self {
        Self {
            ast: value.ast,
            program: value.program,
            estimated_cu: value.estimated_cu,
            diagnostics: value.diagnostics,
            source_map: value.source_map,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileResultEnvelope {
    pub ast: StructuredTacticsAst,
    pub program: crate::TacticalProgram,
    pub estimated_cu: crate::LogicalCu,
    pub diagnostics: Vec<crate::CompileDiagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_map: Option<crate::ActionSourceMap>,
}
