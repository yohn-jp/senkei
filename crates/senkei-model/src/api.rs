use crate::{
    ApiError, CompileResult, MatchContext, RulesetRef, SenkeiSnapshot,
    Version,
};
use serde::{Deserialize, Serialize};

pub const WASM_API_VERSION: Version = Version::new(1, 0, 0);

pub const OP_INITIAL_RULESET: &str = "initial_ruleset";
pub const OP_COMPILE_TEXT: &str = "compile_text";
pub const OP_COMPILE_AST: &str = "compile_ast";
pub const OP_SIMULATE: &str = "simulate";

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

/// `ast` is serialized by Jinrei's versioned Structured AST contract. The
/// generic envelope leaves the AST type owned by Jinrei rather than duplicating
/// compiler syntax in this game-neutral crate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileAstPayload<Ast> {
    pub ruleset_ref: RulesetRef,
    pub ast: Ast,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimulatePayload {
    pub attacker: SenkeiSnapshot,
    pub defender: SenkeiSnapshot,
    pub context: MatchContext,
    /// Local WASM only. Public outputs use `PublicSimulationResponse`.
    pub include_diagnostics: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalSimulationResponse {
    pub result: crate::MatchResult,
    pub replay: crate::PresentationReplay,
    /// `null` unless requested by the local-only simulator caller.
    pub diagnostics: Option<crate::RestrictedDiagnostics>,
}

impl From<CompileResult> for CompileResultEnvelope {
    fn from(value: CompileResult) -> Self {
        Self { program: value.program, estimated_cu: value.estimated_cu, diagnostics: value.diagnostics }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileResultEnvelope {
    pub program: crate::TacticalProgram,
    pub estimated_cu: crate::LogicalCu,
    pub diagnostics: Vec<crate::CompileDiagnostic>,
}
