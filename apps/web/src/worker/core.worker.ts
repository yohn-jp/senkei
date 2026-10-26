import { simulationAuthorizationError } from "./simulation-authorization";
import { CORE_API_VERSION, WEB_WORKER_PROTOCOL_VERSION } from "../contracts/core";
import type { CoreJsonValue, CoreVersion, WorkerFailureCode } from "../contracts/core";
import { WasmRuntime } from "./wasm-runtime";
import { isCombatantSide, simulationDiagnosticsRequestError } from "./simulation-request";

const MAX_WORKER_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_WORKER_RESPONSE_BYTES = 64_000_000;
const MAX_BENCHMARK_CASES = 256;
const MAX_IDENTIFIER_LENGTH = 128;

type RequestOperation =
  | "initial_ruleset"
  | "next_ruleset"
  | "next_reproduction_assets"
  | "editor_catalog"
  | "editor_compile"
  | "new_match_context"
  | "compile"
  | "parse_text"
  | "format_ast"
  | "preflight"
  | "simulate"
  | "reproduce"
  | "benchmark";

interface WorkerRequest {
  readonly web_protocol_version: number;
  readonly request_id: string;
  readonly operation: RequestOperation;
  readonly payload: Record<string, unknown>;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

interface FailureResponse {
  readonly web_protocol_version: typeof WEB_WORKER_PROTOCOL_VERSION;
  readonly request_id: string;
  readonly ok: false;
  readonly error: {
    readonly code: WorkerFailureCode;
    readonly message: string;
    readonly details?: CoreJsonValue;
  };
}

interface CoreApiErrorValue {
  readonly code: string;
  readonly message: string;
  readonly path: string | null;
  readonly details: Readonly<Record<string, string>>;
}

class RequestFailure extends Error {
  constructor(
    readonly code: WorkerFailureCode,
    message: string,
    readonly details?: CoreJsonValue,
  ) {
    super(message);
    this.name = "RequestFailure";
  }
}

class CoreRequestFailure extends Error {
  constructor(readonly error: CoreApiErrorValue) {
    super(error.message);
    this.name = "CoreRequestFailure";
  }
}

const scope = globalThis as unknown as WorkerScope;
const wasm = new WasmRuntime();
let nextCoreRequestId = 0;
let queue = Promise.resolve();

// Keep one operation in flight. Benchmark cases run to completion in their
// submitted order before a later worker message begins.
scope.onmessage = (event): void => {
  queue = queue.then(() => handleMessage(event.data)).catch(() => undefined);
};

async function handleMessage(raw: unknown): Promise<void> {
  const header = asRecord(raw);
  const requestId = typeof header?.request_id === "string"
    ? header.request_id
    : "invalid-request";

  try {
    const request = validateWorkerRequest(raw);
    const result = await runOperation(request);
    const response = {
      web_protocol_version: WEB_WORKER_PROTOCOL_VERSION,
      request_id: request.request_id,
      operation: request.operation,
      ok: true,
      result,
    };
    assertMessageSize(response, MAX_WORKER_RESPONSE_BYTES, "worker response");
    scope.postMessage(response);
  } catch (error) {
    scope.postMessage(failureResponse(requestId, toWorkerFailure(error)));
  }
}

function validateWorkerRequest(value: unknown): WorkerRequest {
  const record = asRecord(value);
  if (record === null) {
    throw new RequestFailure("invalid_request", "Worker request must be a JSON object.");
  }

  if (record.web_protocol_version !== WEB_WORKER_PROTOCOL_VERSION) {
    throw new RequestFailure(
      "unsupported_protocol",
      `Unsupported worker protocol version: ${String(record.web_protocol_version)}.`,
    );
  }
  if (
    typeof record.request_id !== "string" ||
    record.request_id.length === 0 ||
    record.request_id.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new RequestFailure("invalid_request", "Worker request ID is missing or invalid.");
  }

  const operation = record.operation;
  if (
    operation !== "initial_ruleset" &&
    operation !== "next_ruleset" &&
    operation !== "next_reproduction_assets" &&
    operation !== "editor_catalog" &&
    operation !== "editor_compile" &&
    operation !== "new_match_context" &&
    operation !== "compile" &&
    operation !== "parse_text" &&
    operation !== "format_ast" &&
    operation !== "preflight" &&
    operation !== "simulate" &&
    operation !== "reproduce" &&
    operation !== "benchmark"
  ) {
    throw new RequestFailure("invalid_request", "Worker operation is unknown.");
  }

  const payload = asRecord(record.payload);
  if (payload === null) {
    throw new RequestFailure("invalid_request", "Worker request payload must be a JSON object.");
  }
  assertMessageSize(value, MAX_WORKER_REQUEST_BYTES, "worker request");
  validatePayload(operation, payload);

  return {
    web_protocol_version: WEB_WORKER_PROTOCOL_VERSION,
    request_id: record.request_id,
    operation,
    payload,
  };
}

function validatePayload(operation: RequestOperation, payload: Record<string, unknown>): void {
  switch (operation) {
    case "initial_ruleset":
    case "next_ruleset":
    case "next_reproduction_assets":
    case "editor_catalog":
      if (Object.keys(payload).length !== 0) {
        throw new RequestFailure("invalid_request", `${operation} payload must be empty.`);
      }
      return;
    case "editor_compile": {
      requireString(payload.source, "editor_compile.source");
      requireRecord(payload.stamp, "editor_compile.stamp");
      const stamp = payload.stamp as Record<string, unknown>;
      requireRecord(stamp.identity, "editor_compile.stamp.identity");
      requireString(stamp.catalogDigest, "editor_compile.stamp.catalogDigest");
      if (!(stamp.metadataExtensionDigest === null || typeof stamp.metadataExtensionDigest === "string")) {
        throw new RequestFailure("invalid_request", "editor_compile.stamp.metadataExtensionDigest must be a string or null.");
      }
      if (!Number.isSafeInteger(payload.revision) || (payload.revision as number) < 0) {
        throw new RequestFailure("invalid_request", "editor_compile.revision must be a non-negative safe integer.");
      }
      return;
    }
    case "new_match_context":
      requireRecord(payload.ruleset_ref, "new_match_context.ruleset_ref");
      requireString(payload.match_id, "new_match_context.match_id");
      return;
    case "compile":
      if (payload.kind === "text") {
        requireRecord(payload.ruleset_ref, "compile.ruleset_ref");
        requireString(payload.source, "compile.source");
        return;
      }
      if (payload.kind === "structured_ast") {
        requireRecord(payload.ruleset_ref, "compile.ruleset_ref");
        requireRecord(payload.ast, "compile.ast");
        return;
      }
      throw new RequestFailure("invalid_request", "Compile input kind is invalid.");
    case "parse_text":
      requireRecord(payload.ruleset_ref, "parse_text.ruleset_ref");
      requireString(payload.source, "parse_text.source");
      return;
    case "format_ast":
      requireRecord(payload.ruleset_ref, "format_ast.ruleset_ref");
      requireRecord(payload.ast, "format_ast.ast");
      return;
    case "simulate": {
      requireRecord(payload.snapshot, "simulate.snapshot");
      requireBoolean(payload.include_diagnostics, "simulate.include_diagnostics");
      const diagnosticsRequestError = simulationDiagnosticsRequestError(payload.include_diagnostics, payload.diagnostics_side);
      if (diagnosticsRequestError !== null) throw new RequestFailure("invalid_request", diagnosticsRequestError);
      validateSnapshot(payload.snapshot, "simulate.snapshot");
      return;
    }
    case "reproduce": {
      const assets = requireRecord(payload.assets, "reproduce.assets");
      if (assets.format_version !== 1) {
        throw new RequestFailure("invalid_request", "reproduce.assets.format_version is unsupported.");
      }
      requireRecord(assets.rule_package, "reproduce.assets.rule_package");
      requireRecord(assets.world_definition, "reproduce.assets.world_definition");
      requireRecord(payload.snapshot, "reproduce.snapshot");
      const snapshotDigest = requireString(payload.snapshot_digest, "reproduce.snapshot_digest");
      if (!/^[0-9a-f]{64}$/.test(snapshotDigest)) {
        throw new RequestFailure("invalid_request", "reproduce.snapshot_digest must be a lowercase SHA-256 digest.");
      }
      requireBoolean(payload.include_diagnostics, "reproduce.include_diagnostics");
      const diagnosticsRequestError = simulationDiagnosticsRequestError(payload.include_diagnostics, payload.diagnostics_side);
      if (diagnosticsRequestError !== null) throw new RequestFailure("invalid_request", diagnosticsRequestError);
      validateSnapshot(payload.snapshot, "reproduce.snapshot");
      return;
    }
    case "preflight":
      requireRecord(payload.snapshot, "preflight.snapshot");
      validateSnapshot(payload.snapshot, "preflight.snapshot");
      return;
    case "benchmark":
      if (!Array.isArray(payload.cases)) {
        throw new RequestFailure("invalid_request", "benchmark.cases must be an array.");
      }
      if (payload.cases.length > MAX_BENCHMARK_CASES) {
        throw new RequestFailure(
          "invalid_request",
          `A benchmark may contain at most ${MAX_BENCHMARK_CASES} cases.`,
        );
      }
      for (const [index, candidate] of payload.cases.entries()) {
        const benchmarkCase = requireRecord(candidate, `benchmark.cases[${index}]`);
        requireString(benchmarkCase.case_id, `benchmark.cases[${index}].case_id`);
        if (typeof benchmarkCase.case_role !== "undefined" &&
          benchmarkCase.case_role !== "before" &&
          benchmarkCase.case_role !== "current") {
          throw new RequestFailure(
            "invalid_request",
            `benchmark.cases[${index}].case_role is invalid.`,
          );
        }
        validateSnapshot(benchmarkCase.snapshot, `benchmark.cases[${index}].snapshot`);
      }
      return;
  }
}

async function runOperation(request: WorkerRequest): Promise<unknown> {
  switch (request.operation) {
    case "initial_ruleset":
    case "next_ruleset":
      return callCore(request.operation, {}, request.request_id);
    case "next_reproduction_assets":
      return callCore("next_reproduction_assets", {}, request.request_id);
    case "editor_catalog":
      return callCore("editor_catalog", {}, request.request_id);
    case "editor_compile":
      return callCore("editor_compile", request.payload, request.request_id);
    case "new_match_context":
      return callCore("new_match_context", {
        ruleset_ref: request.payload.ruleset_ref,
        match_id: request.payload.match_id,
      }, request.request_id);
    case "parse_text":
      return callCore("parse_text", {
        ruleset_ref: request.payload.ruleset_ref,
        source: request.payload.source,
      }, request.request_id);
    case "format_ast":
      return callCore("format_ast", {
        ruleset_ref: request.payload.ruleset_ref,
        ast: request.payload.ast,
      }, request.request_id);
    case "compile": {
      if (request.payload.kind === "text") {
        return callCore("compile_text", {
          ruleset_ref: request.payload.ruleset_ref,
          source: request.payload.source,
        }, request.request_id);
      }
      return callCore("compile_ast", {
        ruleset_ref: request.payload.ruleset_ref,
        ast: request.payload.ast,
      }, request.request_id);
    }
    case "simulate":
      return runSimulation(request.payload, request.request_id);
    case "reproduce":
      return runReproduction(request.payload, request.request_id);
    case "preflight": {
      const snapshot = requireRecord(request.payload.snapshot, "preflight.snapshot");
      return callCore("preflight", {
        attacker: snapshot.attacker,
        defender: snapshot.defender,
        context: snapshot.context,
      }, request.request_id);
    }
    case "benchmark":
      return runBenchmark(request.payload, request.request_id);
  }
}

async function runSimulation(
  payload: Record<string, unknown>,
  webRequestId: string,
): Promise<unknown> {
  const snapshot = requireRecord(payload.snapshot, "simulate.snapshot");
  const includeDiagnostics = payload.include_diagnostics === true;
  const diagnosticsRequestError = simulationDiagnosticsRequestError(includeDiagnostics, payload.diagnostics_side);
  if (diagnosticsRequestError !== null) throw new RequestFailure("invalid_request", diagnosticsRequestError);
  const diagnosticsSide = includeDiagnostics && isCombatantSide(payload.diagnostics_side)
    ? payload.diagnostics_side
    : undefined;
  const coreResult = await callCore("simulate", {
    attacker: snapshot.attacker,
    defender: snapshot.defender,
    context: snapshot.context,
    include_diagnostics: includeDiagnostics,
    ...(diagnosticsSide !== undefined ? { diagnostics_side: diagnosticsSide } : {}),
  }, webRequestId);
  return adaptSimulationResponse(coreResult, snapshot, includeDiagnostics, diagnosticsSide);
}

async function runReproduction(
  payload: Record<string, unknown>,
  webRequestId: string,
): Promise<unknown> {
  const snapshot = requireRecord(payload.snapshot, "reproduce.snapshot");
  const includeDiagnostics = payload.include_diagnostics === true;
  const diagnosticsRequestError = simulationDiagnosticsRequestError(includeDiagnostics, payload.diagnostics_side);
  if (diagnosticsRequestError !== null) throw new RequestFailure("invalid_request", diagnosticsRequestError);
  const diagnosticsSide = includeDiagnostics && isCombatantSide(payload.diagnostics_side)
    ? payload.diagnostics_side
    : undefined;
  const coreResult = await callCore("reproduce", {
    assets: payload.assets,
    attacker: snapshot.attacker,
    defender: snapshot.defender,
    context: snapshot.context,
    snapshot_digest: payload.snapshot_digest,
    include_diagnostics: includeDiagnostics,
    ...(diagnosticsSide !== undefined ? { diagnostics_side: diagnosticsSide } : {}),
  }, webRequestId);
  return adaptSimulationResponse(coreResult, snapshot, includeDiagnostics, diagnosticsSide);
}

function adaptSimulationResponse(
  coreResult: unknown,
  snapshot: Record<string, unknown>,
  includeDiagnostics: boolean,
  diagnosticsSide: "attacker" | "defender" | undefined,
): unknown {
  const local = requireRecord(coreResult, "core.simulate.result");
  const result = requireRecord(local.result, "core.simulate.result.result");
  const replay = requireRecord(local.replay, "core.simulate.result.replay");
  if (!("diagnostics" in local)) {
    throw new RequestFailure("core_error", "The core simulation response is missing diagnostics.");
  }
  const diagnostics = local.diagnostics;
  if (diagnostics !== null && asRecord(diagnostics) === null) {
    throw new RequestFailure("core_error", "The core returned malformed restricted diagnostics.");
  }
  if (!includeDiagnostics && diagnostics !== null) {
    throw new RequestFailure(
      "core_error",
      "The core returned restricted diagnostics when they were not requested.",
    );
  }
  if (includeDiagnostics && diagnostics === null) {
    throw new RequestFailure(
      "core_error",
      "The core omitted restricted diagnostics that were requested.",
    );
  }

  const authorizationError = simulationAuthorizationError(local, includeDiagnostics
    ? diagnosticsSide as "attacker" | "defender" : null,
    // The retained initial rules have diagnostics but no World/owner replay.
    // World-bound Next snapshots must carry their requested owner projection.
    asRecord(snapshot.context)?.world_identity != null);
  if (authorizationError !== null) throw new RequestFailure("core_error", authorizationError);

  return {
    outcome: { result, presentation_replay: replay },
    ...(includeDiagnostics ? { authorized_side: diagnosticsSide } : {}),
    ...(includeDiagnostics && asRecord(local.owner_replays) ? { owner_replays: local.owner_replays } : {}),
    ...(includeDiagnostics && asRecord(local.owner_replay) ? { owner_replay: local.owner_replay } : {}),
    ...(includeDiagnostics && diagnostics !== null
      ? { restricted_diagnostics: diagnostics }
      : {}),
  };
}

async function runBenchmark(
  payload: Record<string, unknown>,
  webRequestId: string,
): Promise<unknown> {
  const cases = payload.cases as readonly Record<string, unknown>[];
  const outcomes: Array<Record<string, unknown>> = [];
  for (const benchmarkCase of cases) {
    try {
      const simulation = await runSimulation({
        snapshot: benchmarkCase.snapshot,
        include_diagnostics: false,
      }, webRequestId);
      const row: Record<string, unknown> = {
        case_id: benchmarkCase.case_id,
        outcome: (simulation as { readonly outcome: unknown }).outcome,
      };
      if (typeof benchmarkCase.case_role !== "undefined") {
        row.case_role = benchmarkCase.case_role;
      }
      outcomes.push(row);
    } catch (error) {
      if (error instanceof CoreRequestFailure) {
        throw new RequestFailure(
          "core_error",
          `Benchmark case ${String(benchmarkCase.case_id)} failed: ${error.message}`,
          {
            case_id: String(benchmarkCase.case_id),
            core_error: apiErrorDetails(error.error),
          },
        );
      }
      throw error;
    }
  }
  return { cases: outcomes };
}

async function callCore(
  operation: string,
  payload: unknown,
  _webRequestId: string,
): Promise<unknown> {
  nextCoreRequestId += 1;
  const requestId = `worker-core-${nextCoreRequestId}`;
  const envelope = {
    api_version: CORE_API_VERSION,
    request_id: requestId,
    operation,
    payload,
  };
  const json = stringifyJson(envelope);
  assertMessageSize(json, MAX_WORKER_REQUEST_BYTES, "core request");

  let responseValue: unknown;
  try {
    responseValue = JSON.parse(await wasm.dispatchJson(json)) as unknown;
  } catch (error) {
    throw new RequestFailure(
      "worker_error",
      error instanceof Error ? error.message : "The local WASM core could not be called.",
    );
  }
  const response = requireRecord(responseValue, "core response");
  if (
    !sameVersion(response.api_version, CORE_API_VERSION) ||
    response.request_id !== requestId ||
    typeof response.ok !== "boolean"
  ) {
    throw new RequestFailure("core_error", "The core returned a mismatched response envelope.");
  }
  if (response.ok === false) {
    const error = parseCoreError(response.error);
    throw new CoreRequestFailure(error);
  }
  if (response.error !== null || !("result" in response)) {
    throw new RequestFailure("core_error", "The core returned a malformed success envelope.");
  }
  return response.result;
}

function parseCoreError(value: unknown): CoreApiErrorValue {
  const record = requireRecord(value, "core error");
  if (
    typeof record.code !== "string" ||
    typeof record.message !== "string" ||
    !(record.path === null || typeof record.path === "string")
  ) {
    throw new RequestFailure("core_error", "The core returned a malformed error envelope.");
  }
  const details = requireRecord(record.details, "core error details");
  const stringDetails: Record<string, string> = {};
  for (const [key, detail] of Object.entries(details)) {
    if (typeof detail !== "string") {
      throw new RequestFailure("core_error", "The core error details must contain strings.");
    }
    stringDetails[key] = detail;
  }
  return {
    code: record.code,
    message: record.message,
    path: record.path,
    details: stringDetails,
  };
}

function apiErrorDetails(error: CoreApiErrorValue): Record<string, CoreJsonValue> {
  return {
    code: error.code,
    message: error.message,
    path: error.path,
    details: error.details,
  };
}

function toWorkerFailure(error: unknown): RequestFailure {
  if (error instanceof RequestFailure) return error;
  if (error instanceof CoreRequestFailure) {
    return new RequestFailure("core_error", error.message, apiErrorDetails(error.error));
  }
  return new RequestFailure(
    "worker_error",
    error instanceof Error ? error.message : "The worker could not complete the request.",
  );
}

function failureResponse(requestId: string, failure: RequestFailure): FailureResponse {
  return {
    web_protocol_version: WEB_WORKER_PROTOCOL_VERSION,
    request_id: requestId,
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      ...(typeof failure.details !== "undefined" ? { details: failure.details } : {}),
    },
  };
}

function validateSnapshot(value: unknown, path: string): void {
  const snapshot = requireRecord(value, path);
  requireRecord(snapshot.attacker, `${path}.attacker`);
  requireRecord(snapshot.defender, `${path}.defender`);
  requireRecord(snapshot.context, `${path}.context`);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  const record = asRecord(value);
  if (record === null) {
    throw new RequestFailure("invalid_request", `${path} must be a JSON object.`);
  }
  return record;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new RequestFailure("invalid_request", `${path} must be a string.`);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new RequestFailure("invalid_request", `${path} must be a boolean.`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return null;
  }
  return value as Record<string, unknown>;
}

function sameVersion(value: unknown, expected: CoreVersion): boolean {
  const version = asRecord(value);
  return version !== null &&
    version.major === expected.major &&
    version.minor === expected.minor &&
    version.patch === expected.patch;
}

function assertMessageSize(value: unknown, maxBytes: number, label: string): void {
  const json = typeof value === "string" ? value : stringifyJson(value);
  const byteLength = new TextEncoder().encode(json).byteLength;
  if (byteLength > maxBytes) {
    throw new RequestFailure(
      "invalid_request",
      `The ${label} exceeds the ${maxBytes}-byte worker limit.`,
    );
  }
}

function stringifyJson(value: unknown): string {
  const json = JSON.stringify(sanitizeJson(value, new WeakSet<object>(), 0));
  if (json === undefined) throw new RequestFailure("invalid_request", "Message is not JSON-compatible.");
  return json;
}

function sanitizeJson(value: unknown, active: WeakSet<object>, depth: number): unknown {
  if (depth > 128) throw new RequestFailure("invalid_request", "Message exceeds the JSON depth limit.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RequestFailure("invalid_request", "JSON numbers must be finite.");
    return value;
  }
  if (typeof value !== "object") {
    throw new RequestFailure("invalid_request", "Message contains a non-JSON value.");
  }
  if (active.has(value)) throw new RequestFailure("invalid_request", "Message contains a circular value.");
  active.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => sanitizeJson(item, active, depth + 1));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RequestFailure("invalid_request", "Message objects must be plain JSON objects.");
    }
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = sanitizeJson(child, active, depth + 1);
    }
    return result;
  } finally {
    active.delete(value);
  }
}
