//! Native local facade for compiling both Senkei tactics and simulating a full
//! deterministic Senritsu match through the production Jinrei VM and Enbu.

use enbu::{new_match_context, simulate};
use jinrei::{compile, Vm};
use senkei_model::{
    ApiError, ArtifactId, CombatantSide, CompileDiagnostic, DomainType, DomainValue, MatchId,
    PresentationReplay, PublicSimulationResponse, RestrictedDiagnostics, RevisionId, RulesetRef,
    SenkeiSnapshot, TacticalMemory, Version,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

pub const INPUT_SCHEMA_VERSION: Version = Version::new(1, 0, 0);
pub const MAX_INPUT_BYTES: usize = 4_000_000;

/// A complete immutable local battle request. An omitted configuration field
/// takes its default from the bundled, validated Senritsu package.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalMatchInput {
    #[serde(default = "default_schema_version")]
    pub schema_version: Version,
    #[serde(default = "default_match_id")]
    pub match_id: MatchId,
    pub ruleset_ref: RulesetRef,
    pub attacker: CombatantInput,
    pub defender: CombatantInput,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CombatantInput {
    #[serde(default = "default_attacker_id")]
    pub id: ArtifactId,
    #[serde(default = "default_revision")]
    pub revision: RevisionId,
    #[serde(default)]
    pub configuration: BTreeMap<senkei_model::FieldId, DomainValue>,
    #[serde(default)]
    pub initial_memory: TacticalMemory,
    /// Jinrei v0.1 source compiled against the bundled Senritsu for this run.
    pub tactics: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CompilationSummary {
    pub estimated_cu: senkei_model::LogicalCu,
    pub diagnostics: Vec<CompileDiagnostic>,
}

/// Local-only output. The public response is independently available without
/// diagnostics, tactical source, or compiled bytecode.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalMatchOutput {
    pub public: PublicSimulationResponse,
    pub ruleset_ref: RulesetRef,
    pub compilation: BTreeMap<CombatantSide, CompilationSummary>,
    pub diagnostics: RestrictedDiagnostics,
    output_byte_limit: u64,
}

#[derive(Debug, Error)]
pub enum RunnerError {
    #[error("input exceeds the {MAX_INPUT_BYTES}-byte runner limit")]
    InputTooLarge,
    #[error("could not decode local match input: {0}")]
    InvalidInput(#[from] serde_json::Error),
    #[error("unsupported local match schema version {actual:?}; expected {expected:?}")]
    InvalidInputVersion { actual: Version, expected: Version },
    #[error("bundled Senritsu package failed validation: {0:?}")]
    InvalidRulePackage(Vec<senkei_model::ValidationIssue>),
    #[error("requested ruleset {actual:?} does not match bundled ruleset {expected:?}")]
    InvalidRuleset {
        actual: RulesetRef,
        expected: RulesetRef,
    },
    #[error("{side:?} tactic did not compile: {error:?}")]
    Compile {
        side: CombatantSide,
        error: ApiError,
    },
    #[error("match simulation failed: {0:?}")]
    Simulation(ApiError),
    #[error("serialized output is {actual} bytes; the ruleset limit is {limit} bytes")]
    OutputTooLarge { actual: usize, limit: u64 },
}

/// Decode one file or stdin payload under the local runner's fixed input cap.
pub fn decode_input(bytes: &[u8]) -> Result<LocalMatchInput, RunnerError> {
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(RunnerError::InputTooLarge);
    }
    Ok(serde_json::from_slice(bytes)?)
}

/// Validate the bundled rules, compile each side, execute both programs in
/// Enbu, and return separate public/private views of the same simulation.
pub fn run(input: LocalMatchInput) -> Result<LocalMatchOutput, RunnerError> {
    if input.schema_version != INPUT_SCHEMA_VERSION {
        return Err(RunnerError::InvalidInputVersion {
            actual: input.schema_version,
            expected: INPUT_SCHEMA_VERSION,
        });
    }
    if serde_json::to_vec(&input)?.len() > MAX_INPUT_BYTES {
        return Err(RunnerError::InputTooLarge);
    }

    let package = senritsu::initial_package();
    if input.ruleset_ref != package.ruleset {
        return Err(RunnerError::InvalidRuleset {
            actual: input.ruleset_ref,
            expected: package.ruleset,
        });
    }
    let ruleset_ref = package.ruleset.clone();
    let rules = senritsu::validate(package, &senritsu::initial_engine_compatibility())
        .map_err(RunnerError::InvalidRulePackage)?;
    let plan = rules.plan();

    let attacker_compiled =
        compile(&input.attacker.tactics, &rules).map_err(|error| RunnerError::Compile {
            side: CombatantSide::Attacker,
            error,
        })?;
    let defender_compiled =
        compile(&input.defender.tactics, &rules).map_err(|error| RunnerError::Compile {
            side: CombatantSide::Defender,
            error,
        })?;

    let attacker = snapshot(
        input.attacker,
        attacker_compiled.program.clone(),
        &plan.domain.senkei_configuration,
        &plan.domain.tactical_memory,
    )?;
    let defender = snapshot(
        input.defender,
        defender_compiled.program.clone(),
        &plan.domain.senkei_configuration,
        &plan.domain.tactical_memory,
    )?;
    let context = new_match_context(&rules, input.match_id);
    let mut vm = Vm::new(&rules);
    let artifact = simulate(&attacker, &defender, &rules, &context, &mut vm)
        .map_err(RunnerError::Simulation)?;

    let output = LocalMatchOutput {
        public: artifact.public_response(),
        ruleset_ref,
        compilation: BTreeMap::from([
            (
                CombatantSide::Attacker,
                CompilationSummary {
                    estimated_cu: attacker_compiled.estimated_cu,
                    diagnostics: attacker_compiled.diagnostics,
                },
            ),
            (
                CombatantSide::Defender,
                CompilationSummary {
                    estimated_cu: defender_compiled.estimated_cu,
                    diagnostics: defender_compiled.diagnostics,
                },
            ),
        ]),
        diagnostics: artifact.diagnostics,
        output_byte_limit: plan.limits.max_output_bytes,
    };
    Ok(output)
}

impl LocalMatchOutput {
    /// Serialize only the allowlisted MatchResult and PresentationReplay.
    pub fn to_public_json(&self) -> Result<String, RunnerError> {
        self.serialize_bounded(&self.public)
    }

    /// Serialize local compilation summaries and restricted diagnostics too.
    /// This response is private to the local caller and must not be published.
    pub fn to_local_json(&self) -> Result<String, RunnerError> {
        #[derive(Serialize)]
        struct LocalResponse<'a> {
            ruleset_ref: &'a RulesetRef,
            result: &'a senkei_model::MatchResult,
            replay: &'a PresentationReplay,
            compilation: &'a BTreeMap<CombatantSide, CompilationSummary>,
            diagnostics: &'a RestrictedDiagnostics,
        }

        self.serialize_bounded(&LocalResponse {
            ruleset_ref: &self.ruleset_ref,
            result: &self.public.result,
            replay: &self.public.replay,
            compilation: &self.compilation,
            diagnostics: &self.diagnostics,
        })
    }

    fn serialize_bounded<T: Serialize>(&self, value: &T) -> Result<String, RunnerError> {
        let json = serde_json::to_string(value)?;
        if json.len() as u64 > self.output_byte_limit {
            return Err(RunnerError::OutputTooLarge {
                actual: json.len(),
                limit: self.output_byte_limit,
            });
        }
        Ok(json)
    }
}

fn snapshot(
    input: CombatantInput,
    program: senkei_model::TacticalProgram,
    configuration_schema: &BTreeMap<senkei_model::FieldId, senkei_model::ConfigurationFieldSchema>,
    memory_schema: &BTreeMap<senkei_model::StateId, DomainType>,
) -> Result<SenkeiSnapshot, RunnerError> {
    let mut configuration = BTreeMap::new();
    for (field, schema) in configuration_schema {
        let default = schema.default.clone().map(Ok).unwrap_or_else(|| {
            default_value(&schema.value_type).ok_or_else(|| {
                RunnerError::InvalidRulePackage(vec![senkei_model::ValidationIssue::new(
                    "missing_input_default",
                    format!("domain.senkei_configuration.{field}"),
                    "required input has no default and its type has no generic value",
                )])
            })
        })?;
        configuration.insert(field.clone(), default);
    }
    configuration.extend(input.configuration);

    let mut initial_memory = BTreeMap::new();
    for (state, state_type) in memory_schema {
        let value = default_value(state_type).ok_or_else(|| {
            RunnerError::InvalidRulePackage(vec![senkei_model::ValidationIssue::new(
                "missing_memory_default",
                format!("domain.tactical_memory.{state}"),
                "tactical memory type has no generic initial value",
            )])
        })?;
        initial_memory.insert(state.clone(), value);
    }
    initial_memory.extend(input.initial_memory);

    Ok(SenkeiSnapshot {
        schema_version: INPUT_SCHEMA_VERSION,
        id: input.id,
        revision: input.revision,
        ruleset: program.ruleset.clone(),
        configuration,
        program,
        initial_memory,
    })
}

fn default_value(value_type: &DomainType) -> Option<DomainValue> {
    match value_type {
        DomainType::Bool => Some(DomainValue::Bool(false)),
        DomainType::Integer { min, max } => Some(DomainValue::Integer(clamp_zero(*min, *max))),
        DomainType::Fixed { scale, min, max } => Some(DomainValue::Fixed {
            coefficient: clamp_zero(*min, *max),
            scale: *scale,
        }),
        DomainType::String { .. } => Some(DomainValue::String(String::new())),
        DomainType::Enum { values, .. } => values.iter().next().cloned().map(DomainValue::Enum),
        DomainType::Entity { .. } => None,
        DomainType::Optional(_) => Some(DomainValue::Null),
        DomainType::List { .. } | DomainType::Vector { .. } | DomainType::Matrix { .. } => {
            Some(DomainValue::List(Vec::new()))
        }
        DomainType::Record { fields } => fields
            .iter()
            .map(|(field, value_type)| Some((field.clone(), default_value(value_type)?)))
            .collect::<Option<BTreeMap<_, _>>>()
            .map(DomainValue::Record),
    }
}

fn clamp_zero(min: Option<i64>, max: Option<i64>) -> i64 {
    let candidate = min.unwrap_or(0);
    max.map_or(candidate, |max| candidate.min(max))
}

fn default_schema_version() -> Version {
    INPUT_SCHEMA_VERSION
}

fn default_match_id() -> MatchId {
    MatchId::new("local-match")
}

fn default_attacker_id() -> ArtifactId {
    ArtifactId::new("attacker")
}

fn default_revision() -> RevisionId {
    RevisionId::new("1")
}
