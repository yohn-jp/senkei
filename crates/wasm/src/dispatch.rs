use senkei_model::{
    ApiError, ApiErrorCode, ApiRequestEnvelope, ApiResponseEnvelope, CompileAstPayload,
    CompileResultEnvelope, CompileTextPayload, FormatAstPayload, LocalSimulationResponse,
    CombatantSide, ContentDigest, NewMatchContextPayload, ParseTextPayload, PreflightPayload,
    PreflightReproductionPayload, ReproducePayload, ReproductionAssets, RulesetRef,
    ReproductionSnapshot, SimulatePayload, VerifiedRulePlan, Version, OP_NEXT_REPRODUCTION_ASSETS,
    OP_PREFLIGHT_REPRODUCTION, OP_REPRODUCE, REPRODUCTION_ASSETS_FORMAT_VERSION,
    WASM_API_VERSION, OP_SIMULATE_BEHAVIOR, BEHAVIOR_SIMULATION_FORMAT_VERSION,
    SimulateBehaviorPayload, BehaviorSimulationResponse, BehaviorOwnerResponse,
    OP_SIMULATE_ACTOR_DECISIONS, ACTOR_DECISIONS_FORMAT_VERSION, ACTOR_DECISIONS_TRACE_SCHEMA_VERSION,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 64_000_000;
const MAX_REQUEST_ID_BYTES: usize = 128;

#[derive(serde::Deserialize)]
struct RequestIdProbe {
    #[serde(default)]
    request_id: String,
}

/// Dispatch one versioned core JSON envelope. This is the sole operation path
/// for native golden comparisons and the WASM C ABI.
pub fn dispatch_json(request_json: &str) -> String {
    if request_json.len() > MAX_REQUEST_BYTES {
        return encode_error(
            request_id_for_oversized_input(request_json),
            api_error(
                ApiErrorCode::ResourceLimit,
                Some("request"),
                format!("request exceeds the {MAX_REQUEST_BYTES}-byte core adapter limit"),
            ),
        );
    }

    let request_value = match serde_json::from_str::<Value>(request_json) {
        Ok(value) => value,
        Err(error) => {
            return encode_error(
                String::new(),
                api_error(
                    ApiErrorCode::InvalidRequest,
                    None,
                    format!("request is not valid JSON: {error}"),
                ),
            );
        }
    };
    match dispatch_value(request_value) {
        Ok((request_id, result, max_output_bytes)) => {
            encode_success(request_id, result, max_output_bytes)
        }
        Err((request_id, error)) => encode_error(request_id, error),
    }
}

fn request_id_for_oversized_input(request_json: &str) -> String {
    serde_json::from_str::<RequestIdProbe>(request_json)
        .ok()
        .map(|header| header.request_id)
        .filter(|request_id| !request_id.is_empty() && request_id.len() <= MAX_REQUEST_ID_BYTES)
        .unwrap_or_default()
}

pub(crate) fn invalid_utf8_response() -> String {
    encode_error(
        String::new(),
        api_error(
            ApiErrorCode::InvalidRequest,
            Some("request"),
            "request bytes must be UTF-8",
        ),
    )
}

fn dispatch_value(request: Value) -> Result<(String, Value, u64), (String, ApiError)> {
    let request_id = request
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let envelope = decode_envelope(request).map_err(|error| (request_id.clone(), error))?;
    let (result, max_output_bytes) = handle_operation(&envelope.operation, envelope.payload)
        .map_err(|error| (request_id.clone(), error))?;
    Ok((request_id, result, max_output_bytes))
}

fn decode_envelope(request: Value) -> Result<ApiRequestEnvelope<Value>, ApiError> {
    let object = request.as_object().ok_or_else(|| {
        api_error(
            ApiErrorCode::InvalidRequest,
            Some("request"),
            "request must be a JSON object",
        )
    })?;

    let request_id = object
        .get("request_id")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            api_error(
                ApiErrorCode::InvalidRequest,
                Some("request_id"),
                "request_id must be a string",
            )
        })?;
    if request_id.is_empty() || request_id.len() > MAX_REQUEST_ID_BYTES {
        return Err(api_error(
            ApiErrorCode::InvalidRequest,
            Some("request_id"),
            "request_id must be non-empty and at most 128 UTF-8 bytes",
        ));
    }

    let api_version = object
        .get("api_version")
        .cloned()
        .ok_or_else(|| {
            api_error(
                ApiErrorCode::InvalidVersion,
                Some("api_version"),
                "api_version is required",
            )
        })
        .and_then(|value| decode::<Version>(value, "api_version"))?;
    if api_version != WASM_API_VERSION {
        return Err(api_error(
            ApiErrorCode::InvalidVersion,
            Some("api_version"),
            "unsupported core API version",
        ));
    }

    let operation = object
        .get("operation")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            api_error(
                ApiErrorCode::InvalidRequest,
                Some("operation"),
                "operation must be a string",
            )
        })?
        .to_owned();
    let payload = object.get("payload").cloned().ok_or_else(|| {
        api_error(
            ApiErrorCode::InvalidRequest,
            Some("payload"),
            "payload is required",
        )
    })?;

    Ok(ApiRequestEnvelope {
        api_version,
        request_id: request_id.to_owned(),
        operation,
        payload,
    })
}

fn handle_operation(operation: &str, payload: Value) -> Result<(Value, u64), ApiError> {
    match operation {
        "initial_ruleset" => initial_ruleset(payload),
        "next_ruleset" => next_ruleset(payload),
        OP_NEXT_REPRODUCTION_ASSETS => next_reproduction_assets(payload),
        OP_REPRODUCE => reproduce(payload),
        OP_PREFLIGHT_REPRODUCTION => preflight_reproduction(payload),
        "inspect_next_decision" => inspect_next_decision(payload),
        "editor_catalog" => editor_catalog(payload),
        "editor_compile" => editor_compile(payload),
        "editor_catalog_retained" => editor_catalog_retained(payload),
        "editor_compile_retained" => editor_compile_retained(payload),
        "format_ast_retained" => format_ast_retained(payload),
        "editor_resolve_behavior" => editor_resolve_behavior(payload),
        "new_match_context" => new_match_context(payload),
        "parse_text" => parse_text(payload),
        "format_ast" => format_ast(payload),
        "compile_text" => compile_text(payload),
        "compile_ast" => compile_ast(payload),
        "preflight" => preflight(payload),
        "simulate" => simulate(payload),
        OP_SIMULATE_BEHAVIOR => simulate_behavior(payload),
        OP_SIMULATE_ACTOR_DECISIONS => simulate_actor_decisions(payload),
        _ => Err(api_error(
            ApiErrorCode::InvalidRequest,
            Some("operation"),
            "unknown core operation",
        )),
    }
}

fn initial_ruleset(payload: Value) -> Result<(Value, u64), ApiError> {
    require_empty_object(&payload, "payload")?;
    let package = senritsu::initial_package();
    validate_package(&package)?;
    let max_output_bytes = package.limits.max_output_bytes;
    Ok((encode(&package, "result")?, max_output_bytes))
}

#[derive(serde::Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct NextSelection { #[serde(default)] local_trial: bool }
fn selected_next(payload: Value) -> Result<senkei_model::RulePackage, ApiError> {
    let selection: NextSelection = decode_strict(payload, "payload")?;
    Ok(if selection.local_trial { senritsu::next_local_trial_package() } else { senritsu::next_package() })
}
fn next_ruleset(payload: Value) -> Result<(Value, u64), ApiError> {
    let package=selected_next(payload)?;
    validate_package(&package)?;
    Ok((encode(&package,"result")?,package.limits.max_output_bytes))
}

/// Return the current trusted builtin package together with its authored
/// World Definition. Keeping the source alongside the package lets a caller
/// rebuild the exact sealed World artifact after the originating process exits.
fn next_reproduction_assets(payload: Value) -> Result<(Value, u64), ApiError> {
    let rule_package = selected_next(payload)?;
    validate_package(&rule_package)?;
    let world_definition = serde_json::to_value(senritsu::next_world::builtin_world_definition())
        .map_err(|error| api_error(
            ApiErrorCode::InternalError,
            Some("result.world_definition"),
            format!("builtin World Definition could not be serialized: {error}"),
        ))?;
    let assets = ReproductionAssets {
        format_version: REPRODUCTION_ASSETS_FORMAT_VERSION,
        rule_package,
        world_definition,
        catalog_metadata_extension: None,
    };
    let max_output_bytes = assets.rule_package.limits.max_output_bytes;
    Ok((encode(&assets, "result")?, max_output_bytes))
}

/// Return Senritsu's canonical Domain Catalog string without decoding and
/// reserializing it. The Editor verifies the producer digest over these exact
/// canonical bytes before accepting the Catalog.
fn editor_catalog(payload: Value) -> Result<(Value, u64), ApiError> {
    let plan = validate_package(&selected_next(payload)?)?;
    let catalog = senritsu::DomainCatalog::from_verified_plan(&plan)
        .map_err(|e| api_error(ApiErrorCode::ValidationFailed, Some("ruleset"), e.to_string()))?;
    let json = String::from_utf8(catalog.canonical_json().map_err(|e| api_error(ApiErrorCode::InternalError, None, e.to_string()))?)
        .map_err(|e| api_error(ApiErrorCode::InternalError, None, e.to_string()))?;
    Ok((Value::String(json), MAX_RESPONSE_BYTES as u64))
}

/// Compile a Catalog-stamped editor draft with the existing Jinrei compiler.
/// The adapter checks the complete identity and echoes the submitted revision.
fn editor_compile(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: senkei_editor_adapter::EditorCompileRequest = decode(payload, "payload")?;
    let request_json = serde_json::to_string(&request).map_err(|error| {
        api_error(
            ApiErrorCode::InternalError,
            Some("payload"),
            format!("editor compile request could not be serialized: {error}"),
        )
    })?;
    let response_json = senkei_editor_adapter::compile_next_json(&request_json)
        .map_err(editor_adapter_error)?;
    let response = serde_json::from_str::<Value>(&response_json).map_err(|error| {
        api_error(
            ApiErrorCode::InternalError,
            Some("result"),
            format!("editor compiler response could not be decoded: {error}"),
        )
    })?;
    Ok((response, MAX_RESPONSE_BYTES as u64))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RetainedCatalogPayload {
    assets: ReproductionAssets,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RetainedCompilePayload {
    assets: ReproductionAssets,
    source: String,
    stamp: senkei_editor_adapter::CatalogStamp,
    revision: u64,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RetainedFormatAstPayload {
    assets: ReproductionAssets,
    ast: senkei_model::StructuredTacticsAst,
}

/// Verify retained World/package inputs before exposing their real Catalog.
fn editor_catalog_retained(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: RetainedCatalogPayload = decode_strict(payload, "payload")?;
    let (rules, extension) = retained_editor_inputs(request.assets)?;
    let catalog = senkei_editor_adapter::catalog_for_verified_plan(&rules, extension)
        .map_err(editor_adapter_error)?;
    let json = String::from_utf8(catalog.canonical_json().map_err(|error| {
        api_error(ApiErrorCode::InternalError, Some("result"), error.to_string())
    })?).map_err(|error| api_error(ApiErrorCode::InternalError, Some("result"), error.to_string()))?;
    Ok((Value::String(json), rules.plan().limits.max_output_bytes))
}

/// Compile against precisely the retained package and Catalog identity.
fn editor_compile_retained(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: RetainedCompilePayload = decode_strict(payload, "payload")?;
    let (rules, extension) = retained_editor_inputs(request.assets)?;
    let response = senkei_editor_adapter::compile_verified_request(
        senkei_editor_adapter::EditorCompileRequest {
            source: request.source,
            stamp: request.stamp,
            revision: request.revision,
        },
        &rules,
        extension,
    ).map_err(editor_adapter_error)?;
    Ok((encode(&response, "result")?, rules.plan().limits.max_output_bytes))
}

fn format_ast_retained(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: RetainedFormatAstPayload = decode_strict(payload, "payload")?;
    let rules = validate_reproduction_assets(request.assets)?;
    let source = jinrei::format(&request.ast)?;
    Ok((encode(&source, "result")?, rules.plan().limits.max_output_bytes))
}

fn retained_editor_inputs(
    assets: ReproductionAssets,
) -> Result<(VerifiedRulePlan, Option<senritsu::CatalogMetadataExtension>), ApiError> {
    let extension = assets.catalog_metadata_extension.clone();
    let rules = validate_reproduction_assets(assets)?;
    // validate_reproduction_assets has already parsed and checked the exact
    // retained extension; keep that same value for the Catalog producer.
    let extension = extension.map(|value| serde_json::from_value(value).map_err(|error| {
        api_error(ApiErrorCode::InternalError, Some("payload.assets.catalog_metadata_extension"),
            format!("verified Catalog extension could not be decoded: {error}"))
    })).transpose()?;
    Ok((rules, extension))
}

/// Compose a Profile against the exact verified package and Catalog stamp.
fn editor_resolve_behavior(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: senkei_editor_adapter::BehaviorResolveRequest = decode_strict(payload, "payload")?;
    let response = senkei_editor_adapter::resolve_behavior(request).map_err(editor_adapter_error)?;
    Ok((encode(&response, "result")?, MAX_RESPONSE_BYTES as u64))
}

fn editor_adapter_error(error: senkei_editor_adapter::AdapterError) -> ApiError {
    use senkei_editor_adapter::AdapterError;
    let (code, path) = match &error {
        AdapterError::CatalogMismatch => (ApiErrorCode::InvalidRuleset, Some("payload.stamp")),
        AdapterError::PackageInvalid(_) | AdapterError::CatalogInvalid(_) => {
            (ApiErrorCode::ValidationFailed, Some("ruleset"))
        }
        AdapterError::Serialization(_) => (ApiErrorCode::InternalError, None),
    };
    api_error(code, path, error.to_string())
}

fn new_match_context(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: NewMatchContextPayload = decode(payload, "payload")?;
    let rules = resolve_ruleset(&request.ruleset_ref)?;
    let context = enbu::new_match_context(&rules, request.match_id);
    let max_output_bytes = rules.plan().limits.max_output_bytes;
    Ok((encode(&context, "result")?, max_output_bytes))
}

fn parse_text(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: ParseTextPayload = decode(payload, "payload")?;
    let rules = resolve_ruleset(&request.ruleset_ref)?;
    let ast = jinrei::parse(&request.source)?;
    let max_output_bytes = rules.plan().limits.max_output_bytes;
    Ok((encode(&ast, "result")?, max_output_bytes))
}

fn format_ast(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: FormatAstPayload = decode(payload, "payload")?;
    let rules = resolve_ruleset(&request.ruleset_ref)?;
    let source = jinrei::format(&request.ast)?;
    let max_output_bytes = rules.plan().limits.max_output_bytes;
    Ok((encode(&source, "result")?, max_output_bytes))
}

fn compile_text(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: CompileTextPayload = decode(payload, "payload")?;
    let rules = resolve_ruleset(&request.ruleset_ref)?;
    let compilation = jinrei::compile(&request.source, &rules)?;
    let response = CompileResultEnvelope::from(compilation);
    let max_output_bytes = rules.plan().limits.max_output_bytes;
    Ok((encode(&response, "result")?, max_output_bytes))
}

fn compile_ast(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: CompileAstPayload = decode(payload, "payload")?;
    let rules = resolve_ruleset(&request.ruleset_ref)?;
    let compilation = jinrei::compile_ast(&request.ast, &rules)?;
    let response = CompileResultEnvelope::from(compilation);
    let max_output_bytes = rules.plan().limits.max_output_bytes;
    Ok((encode(&response, "result")?, max_output_bytes))
}

fn simulate(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: SimulatePayload = decode(payload, "payload")?;
    let diagnostics_side = requested_diagnostics_side(request.include_diagnostics, request.diagnostics_side)?;
    let rules = resolve_ruleset(&request.context.ruleset)?;
    let max_output_bytes = rules
        .plan()
        .limits
        .max_output_bytes
        .min(request.context.host_limits.max_output_bytes);
    let mut vm = jinrei::Vm::new(&rules);
    let artifact = enbu::simulate(
        &request.attacker,
        &request.defender,
        &rules,
        &request.context,
        &mut vm,
    )?;
    let response = project_simulation_response(&artifact, diagnostics_side);
    Ok((encode(&response, "result")?, max_output_bytes))
}

/// Execute the exact versioned Behavior inputs through the same Enbu tick as
/// native. The generic package and extension are untrusted until verified.
fn simulate_behavior(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: SimulateBehaviorPayload = decode_strict(payload, "payload")?;
    if request.format_version != BEHAVIOR_SIMULATION_FORMAT_VERSION {
        return Err(api_error(ApiErrorCode::InvalidVersion, Some("payload.format_version"), "unsupported Behavior simulation format"));
    }
    let side = requested_diagnostics_side(request.include_diagnostics, request.diagnostics_side)?;
    let extension: senritsu::CatalogMetadataExtension = decode_strict(request.catalog_metadata_extension, "payload.catalog_metadata_extension")?;
    let inputs: enbu::BehaviorExecutionInputs = decode_strict(request.behavior_inputs, "payload.behavior_inputs")?;
    let rules = senritsu::validate_with_catalog_extension(request.rule_package, &senritsu::next_engine_compatibility(), extension.clone())
        .map_err(|issues| {
            let mut error = api_error(ApiErrorCode::ValidationFailed, Some("payload.rule_package"), "Behavior RulePackage and extension failed validation");
            error.details.insert("issues".into(), serde_json::to_string(&issues).unwrap_or_else(|_| "[]".into()));
            error
        })?;
    let catalog = senritsu::DomainCatalog::from_verified_plan_with_extension(&rules, extension)
        .map_err(|_| api_error(ApiErrorCode::ValidationFailed, Some("payload.catalog_metadata_extension"), "Behavior Catalog failed validation"))?;
    let max_output_bytes = reproduction_output_limit(&rules, &request.snapshot.context);
    let mut vm = jinrei::Vm::new(&rules);
    let artifact = enbu::simulate_with_behavior(&request.snapshot.attacker, &request.snapshot.defender, &rules, &request.snapshot.context, &mut vm, &catalog, &inputs)?;
    let public = artifact.public_response();
    let owner = if let Some(side) = side {
        let diagnostics = artifact.diagnostics_for_owner(side);
        Some(BehaviorOwnerResponse { authorized_side: side, behavior_run_digest: diagnostics.behavior_run_digest, diagnostics: diagnostics.diagnostics, trace: encode(&artifact.traces_for_owner(side), "result.owner.trace")? })
    } else { None };
    let response = BehaviorSimulationResponse { format_version: BEHAVIOR_SIMULATION_FORMAT_VERSION, behavior_runtime_version: enbu::BEHAVIOR_RUNTIME_VERSION, result: public.result, replay: public.replay, owner };
    Ok((encode(&response, "result")?, max_output_bytes))
}

/// Explicit owner-only diagnostics for bounded autonomous combat decisions.
/// This uses the same immutable inputs and side authorization as `simulate`.
fn simulate_actor_decisions(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: SimulatePayload = decode_strict(payload, "payload")?;
    let side = requested_diagnostics_side(request.include_diagnostics, request.diagnostics_side)?
        .ok_or_else(|| api_error(ApiErrorCode::InvalidRequest, Some("payload.include_diagnostics"), "owner diagnostics are required for actor decisions"))?;
    let rules = resolve_ruleset(&request.context.ruleset)?;
    let max_output_bytes = rules.plan().limits.max_output_bytes.min(request.context.host_limits.max_output_bytes);
    let mut vm = jinrei::Vm::new(&rules);
    let artifact = enbu::simulate_with_actor_decisions_for_owner(&request.attacker, &request.defender, &rules, &request.context, side, &mut vm)?;
    #[derive(serde::Serialize)]
    struct Response {
        format_version: u16,
        trace_schema_version: u16,
        authorized_side: CombatantSide,
        simulation: LocalSimulationResponse,
        trace: Vec<enbu::AutonomousCombatTrace>,
    }
    let response = Response {
        format_version: ACTOR_DECISIONS_FORMAT_VERSION,
        trace_schema_version: ACTOR_DECISIONS_TRACE_SCHEMA_VERSION,
        authorized_side: side,
        simulation: artifact.response_for_owner(side),
        trace: artifact.traces_for_owner(side),
    };
    Ok((encode(&response, "result")?, max_output_bytes))
}

/// Rebuild a verified package from retained, untrusted JSON inputs and rerun
/// the original match with the current deterministic engine.
fn reproduce(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: ReproducePayload = decode_strict(payload, "payload")?;
    let diagnostics_side = requested_diagnostics_side(
        request.include_diagnostics,
        request.diagnostics_side,
    )?;
    let rules = validate_reproduction_assets(request.assets)?;
    validate_reproduction_snapshot(&request.snapshot, &request.snapshot_digest)?;
    let max_output_bytes = reproduction_output_limit(&rules, &request.snapshot.context);
    enbu::preflight(
        &request.snapshot.attacker,
        &request.snapshot.defender,
        &rules,
        &request.snapshot.context,
    )?;
    let mut vm = jinrei::Vm::new(&rules);
    let artifact = enbu::simulate(
        &request.snapshot.attacker,
        &request.snapshot.defender,
        &rules,
        &request.snapshot.context,
        &mut vm,
    )?;
    let response = project_simulation_response(&artifact, diagnostics_side);
    Ok((encode(&response, "result")?, max_output_bytes))
}

/// Validate retained assets and the exact Run input without executing match ticks.
fn preflight_reproduction(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: PreflightReproductionPayload = decode_strict(payload, "payload")?;
    let rules = validate_reproduction_assets(request.assets)?;
    validate_reproduction_snapshot(&request.snapshot, &request.snapshot_digest)?;
    let max_output_bytes = reproduction_output_limit(&rules, &request.snapshot.context);
    enbu::preflight(
        &request.snapshot.attacker,
        &request.snapshot.defender,
        &rules,
        &request.snapshot.context,
    )?;
    Ok((Value::Null, max_output_bytes))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct InspectNextDecisionPayload {
    format_version: u16,
    assets: ReproductionAssets,
    snapshot: ReproductionSnapshot,
    snapshot_digest: ContentDigest,
    authorized_side: CombatantSide,
    selector: InspectNextDecisionSelector,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct InspectNextDecisionSelector {
    tick: u32,
    slot_id: String,
}

/// Inspect one owner's decision from the exact retained match input.
fn inspect_next_decision(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: InspectNextDecisionPayload = decode_strict(payload, "payload")?;
    if request.format_version != enbu::NEXT_DECISION_INSPECTION_FORMAT_VERSION {
        return Err(api_error(
            ApiErrorCode::InvalidVersion,
            Some("payload.format_version"),
            "unsupported Next decision inspection format",
        ));
    }
    let rules = validate_reproduction_assets(request.assets)?;
    validate_reproduction_snapshot(&request.snapshot, &request.snapshot_digest)?;
    let max_output_bytes = reproduction_output_limit(&rules, &request.snapshot.context);
    let mut vm = jinrei::Vm::new(&rules);
    let inspection = enbu::inspect_next_decision(
        &request.snapshot.attacker,
        &request.snapshot.defender,
        &rules,
        &request.snapshot.context,
        request.authorized_side,
        request.selector.tick,
        &request.selector.slot_id,
        &mut vm,
    )?;
    Ok((encode(&inspection, "result")?, max_output_bytes))
}

/// Rebuild the exact verified package used by both reproduction endpoints.
fn validate_reproduction_assets(assets: ReproductionAssets) -> Result<VerifiedRulePlan, ApiError> {
    if assets.format_version != REPRODUCTION_ASSETS_FORMAT_VERSION {
        return Err(api_error(
            ApiErrorCode::InvalidVersion,
            Some("payload.assets.format_version"),
            "unsupported reproduction asset format",
        ));
    }

    let package = assets.rule_package;
    let extension = assets
        .catalog_metadata_extension
        .map(|value| {
            let extension = serde_json::from_value::<senritsu::CatalogMetadataExtension>(value.clone())
                .map_err(|error| {
                    api_error(
                        ApiErrorCode::ValidationFailed,
                        Some("payload.assets.catalog_metadata_extension"),
                        format!("stored Catalog/Behavior extension is malformed: {error}"),
                    )
                })?;
            let canonical = serde_json::to_value(&extension).map_err(|error| {
                api_error(
                    ApiErrorCode::ValidationFailed,
                    Some("payload.assets.catalog_metadata_extension"),
                    format!("stored Catalog/Behavior extension could not be serialized: {error}"),
                )
            })?;
            if canonical != value {
                return Err(api_error(
                    ApiErrorCode::ValidationFailed,
                    Some("payload.assets.catalog_metadata_extension"),
                    "stored Catalog/Behavior extension contains unrecognized or noncanonical fields",
                ));
            }
            Ok(extension)
        })
        .transpose()?;
    let expected_world_identity = package
        .next
        .as_ref()
        .and_then(|next| next.world_identity.as_ref())
        .ok_or_else(|| api_error(
            ApiErrorCode::InvalidRuleset,
            Some("payload.assets.rule_package.next.world_identity"),
            "a reproducible Next RulePackage must carry its exact World identity",
        ))?;
    let current_compiler = Version::new(
        senkei_world::COMPILER_VERSION.major,
        senkei_world::COMPILER_VERSION.minor,
        senkei_world::COMPILER_VERSION.patch,
    );
    if expected_world_identity.compiler_version != current_compiler {
        return Err(api_error(
            ApiErrorCode::IncompatibleVersion,
            Some("payload.assets.rule_package.next.world_identity.compiler_version"),
            "the stored World Compiler version is not available in this runtime",
        ));
    }

    let definition: senkei_world::WorldDefinition = serde_json::from_value(
        assets.world_definition,
    ).map_err(|error| api_error(
        ApiErrorCode::ValidationFailed,
        Some("payload.assets.world_definition"),
        format!("stored World Definition is malformed: {error}"),
    ))?;
    let world = senkei_world::compile(definition).map_err(|issues| {
        let mut error = api_error(
            ApiErrorCode::ValidationFailed,
            Some("payload.assets.world_definition"),
            "stored World Definition does not compile under the current World Compiler",
        );
        error.details.insert(
            "issues".to_owned(),
            serde_json::to_string(
                &issues
                    .iter()
                    .map(|issue| {
                        serde_json::json!({
                            "code": &issue.code,
                            "path": &issue.path,
                            "message": &issue.message,
                        })
                    })
                    .collect::<Vec<_>>(),
            )
            .unwrap_or_else(|_| "[]".to_owned()),
        );
        error
    })?;
    if world.identity().to_model_ref() != *expected_world_identity {
        return Err(api_error(
            ApiErrorCode::ValidationFailed,
            Some("payload.assets.world_definition"),
            "compiled World identity does not match the retained RulePackage reference",
        ));
    }
    let mut resolver = senkei_world::WorldResolver::default();
    resolver.insert(world).map_err(|error| api_error(
        ApiErrorCode::ValidationFailed,
        Some("payload.assets.world_definition"),
        format!("stored World could not be inserted into the exact resolver: {error}"),
    ))?;

    let actual_package_digest = senritsu::canonical_digest(&package).map_err(|error| {
        api_error(
            ApiErrorCode::InvalidRuleset,
            Some("payload.assets.rule_package"),
            format!("stored RulePackage could not be canonically hashed: {error}"),
        )
    })?;
    if actual_package_digest != package.ruleset.digest {
        return Err(api_error(
            ApiErrorCode::InvalidRuleset,
            Some("payload.assets.rule_package.ruleset.digest"),
            "stored RulePackage digest does not match its content",
        ));
    }
    senritsu::validate_with_world_resolver_and_catalog_extension(
        package,
        &senritsu::next_engine_compatibility(),
        &resolver,
        extension,
    ).map_err(|issues| {
        let mut error = api_error(
            ApiErrorCode::ValidationFailed,
            Some("payload.assets.rule_package"),
            "retained RulePackage could not be verified against its exact World artifact",
        );
        error.details.insert(
            "issues".to_owned(),
            serde_json::to_string(&issues).unwrap_or_else(|_| "[]".to_owned()),
        );
        error
    })
}

fn validate_reproduction_snapshot(
    snapshot: &senkei_model::ReproductionSnapshot,
    expected_digest: &senkei_model::ContentDigest,
) -> Result<(), ApiError> {
    let actual_digest = enbu::reproduction_snapshot_digest(
        &snapshot.attacker,
        &snapshot.defender,
        &snapshot.context,
    )?;
    if &actual_digest != expected_digest {
        return Err(api_error(
            ApiErrorCode::InvalidSnapshot,
            Some("payload.snapshot_digest"),
            "retained snapshot digest does not match the complete immutable Run input",
        ));
    }
    Ok(())
}

fn reproduction_output_limit(rules: &VerifiedRulePlan, context: &senkei_model::MatchContext) -> u64 {
    rules.plan().limits.max_output_bytes.min(context.host_limits.max_output_bytes)
}

fn project_simulation_response(
    artifact: &senkei_model::SimulationArtifact,
    diagnostics_side: Option<CombatantSide>,
) -> LocalSimulationResponse {
    let public = artifact.public_response();
    if let Some(side) = diagnostics_side {
        artifact.diagnostic_response(side)
    } else {
        LocalSimulationResponse {
            authorized_side: None,
            owner_replay: None,
            owner_replays: Default::default(),
            result: public.result,
            replay: public.replay,
            diagnostics: None,
        }
    }
}

fn requested_diagnostics_side(
    include_diagnostics: bool,
    diagnostics_side: Option<CombatantSide>,
) -> Result<Option<CombatantSide>, ApiError> {
    match (include_diagnostics, diagnostics_side) {
        (true, Some(side)) => Ok(Some(side)),
        (true, None) => Err(ApiError::new(
            ApiErrorCode::InvalidRequest,
            "diagnostics_side is required when include_diagnostics is true",
        )),
        (false, None) => Ok(None),
        (false, Some(_)) => Err(ApiError::new(
            ApiErrorCode::InvalidRequest,
            "diagnostics_side must be omitted when include_diagnostics is false",
        )),
    }
}

fn preflight(payload: Value) -> Result<(Value, u64), ApiError> {
    let request: PreflightPayload = decode(payload, "payload")?;
    let rules = resolve_ruleset(&request.context.ruleset)?;
    let max_output_bytes = rules
        .plan()
        .limits
        .max_output_bytes
        .min(request.context.host_limits.max_output_bytes);
    enbu::preflight(&request.attacker, &request.defender, &rules, &request.context)?;
    Ok((Value::Null, max_output_bytes))
}

fn resolve_ruleset(expected: &RulesetRef) -> Result<VerifiedRulePlan, ApiError> {
    let trial = senritsu::next_local_trial_package();
    let package = if expected == &trial.ruleset { trial } else if expected.id.as_str() == "senkei.next" { senritsu::next_package() } else { senritsu::initial_package() };
    if &package.ruleset != expected {
        return Err(api_error(
            ApiErrorCode::InvalidRuleset,
            Some("payload.ruleset_ref"),
            "the requested ruleset is not the locally bundled package",
        ));
    }
    validate_package(&package)
}

fn validate_package(package: &senkei_model::RulePackage) -> Result<VerifiedRulePlan, ApiError> {
    senritsu::validate(package.clone(), &senritsu::next_engine_compatibility()).map_err(
        |issues| {
            let serialized_issues =
                serde_json::to_string(&issues).unwrap_or_else(|_| "[]".to_owned());
            let mut error = api_error(
                ApiErrorCode::ValidationFailed,
                Some("ruleset"),
                "the bundled ruleset failed validation",
            );
            error.details.insert("issues".to_owned(), serialized_issues);
            error
        },
    )
}

fn require_empty_object(value: &Value, path: &str) -> Result<(), ApiError> {
    match value.as_object() {
        Some(object) if object.is_empty() => Ok(()),
        _ => Err(api_error(
            ApiErrorCode::InvalidRequest,
            Some(path),
            "payload must be an empty object",
        )),
    }
}

fn decode<T: DeserializeOwned>(value: Value, path: &str) -> Result<T, ApiError> {
    serde_json::from_value(value).map_err(|error| {
        api_error(
            ApiErrorCode::InvalidRequest,
            Some(path),
            format!("payload could not be deserialized: {error}"),
        )
    })
}

/// Deserialize reproduction requests while reporting fields that Serde would
/// otherwise silently ignore in nested model structs. The retained digest is
/// computed over the typed projection, so ignored input must never disappear
/// before identity checks. Known optional/null/default fields still use their
/// declared Serde behavior.
fn decode_strict<T: DeserializeOwned>(value: Value, path: &str) -> Result<T, ApiError> {
    let encoded = serde_json::to_string(&value).map_err(|error| {
        api_error(
            ApiErrorCode::InvalidRequest,
            Some(path),
            format!("payload could not be serialized for strict decoding: {error}"),
        )
    })?;
    let mut deserializer = serde_json::Deserializer::from_str(&encoded);
    let mut ignored_path = None;
    let decoded = serde_ignored::deserialize(&mut deserializer, |field| {
        if ignored_path.is_none() {
            ignored_path = Some(field.to_string());
        }
    })
    .map_err(|error| {
        api_error(
            ApiErrorCode::InvalidRequest,
            Some(path),
            format!("payload could not be deserialized: {error}"),
        )
    })?;
    if let Some(ignored_path) = ignored_path {
        return Err(api_error(
            ApiErrorCode::InvalidRequest,
            Some(path),
            format!("payload contains unsupported field: {ignored_path}"),
        ));
    }
    Ok(decoded)
}

fn encode<T: serde::Serialize>(value: &T, path: &str) -> Result<Value, ApiError> {
    serde_json::to_value(value).map_err(|error| {
        api_error(
            ApiErrorCode::InternalError,
            Some(path),
            format!("core result could not be serialized: {error}"),
        )
    })
}

fn encode_success(request_id: String, result: Value, max_output_bytes: u64) -> String {
    let response = ApiResponseEnvelope {
        api_version: WASM_API_VERSION,
        request_id: request_id.clone(),
        ok: true,
        result: Some(result),
        error: None,
    };
    let max_response_bytes = usize::try_from(max_output_bytes)
        .unwrap_or(usize::MAX)
        .min(MAX_RESPONSE_BYTES);
    match serde_json::to_string(&response) {
        Ok(json) if json.len() <= max_response_bytes => json,
        _ => encode_error(
            request_id,
            api_error(
                ApiErrorCode::ResourceLimit,
                Some("result"),
                format!("response exceeds the {max_response_bytes}-byte core adapter limit"),
            ),
        ),
    }
}

fn encode_error(request_id: String, error: ApiError) -> String {
    let response = ApiResponseEnvelope::<Value> {
        api_version: WASM_API_VERSION,
        request_id,
        ok: false,
        result: None,
        error: Some(error),
    };
    serde_json::to_string(&response).unwrap_or_else(|_| {
        format!(
            "{{\"api_version\":{{\"major\":{},\"minor\":{},\"patch\":{}}},\"request_id\":\"\",\"ok\":false,\"result\":null,\"error\":{{\"code\":\"internal_error\",\"message\":\"could not serialize error response\",\"path\":null,\"details\":{{}}}}}}",
            WASM_API_VERSION.major,
            WASM_API_VERSION.minor,
            WASM_API_VERSION.patch,
        )
    })
}

fn api_error(code: ApiErrorCode, path: Option<&str>, message: impl Into<String>) -> ApiError {
    let mut error = ApiError::new(code, message);
    error.path = path.map(str::to_owned);
    error
}

#[cfg(test)]
mod response_limit_tests {
    use super::MAX_RESPONSE_BYTES;

    #[test]
    fn dispatcher_response_cap_matches_the_versioned_next_output_limit() {
        assert_eq!(
            senritsu::next_package().limits.max_output_bytes,
            MAX_RESPONSE_BYTES as u64,
            "the local response cap must cover both public and authorized owner replay projections",
        );
    }

    #[test]
    fn dispatcher_encodes_authorized_local_payloads_above_the_previous_32m_cap() {
        let maximum = senritsu::next_package().limits.max_output_bytes;
        let payload = serde_json::json!({
            "result": null,
            "replay": null,
            "owner_replay": {
                "frames": [{ "visible_state": { "entities": { "authorized_hero": "x".repeat(34_202_605) } } }]
            },
            "diagnostics": null,
        });
        let response = super::encode_success("long-workbench-response".to_owned(), payload, maximum);
        assert!(response.len() > 32_000_000, "the regression payload must exceed the previous adapter limit");
        assert!(response.len() <= maximum as usize, "the response remains within the versioned package limit");
        let envelope: serde_json::Value = serde_json::from_str(&response).expect("accepted response is valid JSON");
        assert_eq!(envelope["ok"], true, "the dispatcher uses the successful response path");
    }
}

#[cfg(test)]
mod diagnostics_request_tests {
    use super::requested_diagnostics_side;
    use senkei_model::CombatantSide;

    #[test]
    fn diagnostics_requests_require_one_explicit_owner_side() {
        assert!(matches!(requested_diagnostics_side(true, Some(CombatantSide::Attacker)), Ok(Some(CombatantSide::Attacker))));
        assert!(matches!(requested_diagnostics_side(true, Some(CombatantSide::Defender)), Ok(Some(CombatantSide::Defender))));
        assert!(requested_diagnostics_side(true, None).is_err());
    }

    #[test]
    fn public_simulation_requests_forbid_a_diagnostics_side() {
        assert!(matches!(requested_diagnostics_side(false, None), Ok(None)));
        assert!(requested_diagnostics_side(false, Some(CombatantSide::Attacker)).is_err());
        assert!(requested_diagnostics_side(false, Some(CombatantSide::Defender)).is_err());
    }
}

#[cfg(test)]
mod behavior_wire_tests {
    #[test]
    fn behavior_operation_validates_its_versioned_payload() {
        let response: serde_json::Value = serde_json::from_str(&super::dispatch_json(&serde_json::json!({
            "api_version": {"major": 1, "minor": 0, "patch": 0}, "request_id": "behavior-invalid",
            "operation": "simulate_behavior", "payload": {}
        }).to_string())).unwrap();
        assert_eq!(response["ok"], false);
        assert!(response["error"]["message"].as_str().unwrap().contains("payload could not be deserialized"));
    }
}
