use senkei_model::{
    ApiError, ApiErrorCode, ApiRequestEnvelope, ApiResponseEnvelope, CompileAstPayload,
    CompileResultEnvelope, CompileTextPayload, FormatAstPayload, LocalSimulationResponse,
    NewMatchContextPayload, ParseTextPayload, RulesetRef, SimulatePayload, VerifiedRulePlan,
    Version, WASM_API_VERSION,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
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
        "new_match_context" => new_match_context(payload),
        "parse_text" => parse_text(payload),
        "format_ast" => format_ast(payload),
        "compile_text" => compile_text(payload),
        "compile_ast" => compile_ast(payload),
        "simulate" => simulate(payload),
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

fn next_ruleset(payload: Value) -> Result<(Value, u64), ApiError> {
    require_empty_object(&payload,"payload")?;
    let package=senritsu::next_package();
    validate_package(&package)?;
    Ok((encode(&package,"result")?,package.limits.max_output_bytes))
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
    let public = artifact.public_response();
    let response = LocalSimulationResponse {
        owner_replay: request.include_diagnostics.then(||artifact.owner_replay.clone()).flatten(),
        result: public.result,
        replay: public.replay,
        diagnostics: request
            .include_diagnostics
            .then(|| {
                let mut diagnostics=artifact.diagnostics.clone();
                if rules.plan().next.is_some() {
                    diagnostics.events.retain(|event| event.side == senkei_model::CombatantSide::Attacker);
                    diagnostics.cu_by_side.retain(|side,_| *side == senkei_model::CombatantSide::Attacker);
                    diagnostics.final_memory_by_side.retain(|side,_| *side == senkei_model::CombatantSide::Attacker);
                }
                diagnostics
            }),
    };
    Ok((encode(&response, "result")?, max_output_bytes))
}

fn resolve_ruleset(expected: &RulesetRef) -> Result<VerifiedRulePlan, ApiError> {
    let package = if expected.id.as_str() == "senkei.next" { senritsu::next_package() } else { senritsu::initial_package() };
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
