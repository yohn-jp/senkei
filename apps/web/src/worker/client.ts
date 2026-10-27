import type {
  BenchmarkCase,
  BenchmarkOutcome,
  CompileOutcome,
  CoreClient,
  CoreJsonValue,
  EditorCompilerEnvelope,
  ReproductionAssets,
  SimulationRequestOptions,
  SimulationResponse,
  SimulationSnapshot,
  TacticalInput,
  WorkerFailure,
  WorkerFailureCode,
  RulesetRef,
} from "../contracts/core";
import type { ContentDigest, MatchContext, RulePackage, StructuredTacticsAst } from "../contracts/core-model";
import type { CompilerRequest as EditorCompileRequest } from "@senkei/jinrei-editor";
import type { WebWorkerRequest, WebWorkerResponse } from "../contracts/worker";
import { WEB_WORKER_PROTOCOL_VERSION } from "../contracts/core";
import type { BehaviorSimulationRequest, BehaviorSimulationResponse } from "../contracts/behavior";

const DEFAULT_MAX_PENDING = 64;
const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_BENCHMARK_CASES = 256;

export interface CoreClientOptions {
  /** Supply a worker for embedding or lifecycle control; otherwise one is created. */
  readonly worker?: Worker;
  readonly max_pending_requests?: number;
  readonly max_request_bytes?: number;
}

export class CoreClientError extends Error {
  readonly code: WorkerFailureCode;
  readonly details?: CoreJsonValue;

  constructor(failure: WorkerFailure, options?: ErrorOptions) {
    super(failure.message, options);
    this.name = "CoreClientError";
    this.code = failure.code;
    this.details = failure.details;
  }
}

interface PendingRequest {
  readonly operation: WebWorkerRequest["operation"];
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: CoreClientError) => void;
}

let clientSequence = 0;

/** Request/reply facade for the dedicated worker and local Rust/WASM core. */
export class WorkerCoreClient implements CoreClient {
  /** Opt-in generic mechanism; not a production Next Profile or saved Run. */
  simulateBehavior(payload: BehaviorSimulationRequest): Promise<BehaviorSimulationResponse> {
    return this.request("simulate_behavior", payload) as Promise<BehaviorSimulationResponse>;
  }
  private readonly worker: Worker;
  private readonly maxPendingRequests: number;
  private readonly maxRequestBytes: number;
  private readonly clientId: number;
  private requestSequence = 0;
  private disposed = false;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: CoreClientOptions = {}) {
    this.maxPendingRequests = positiveLimit(
      options.max_pending_requests ?? DEFAULT_MAX_PENDING,
      "max_pending_requests",
    );
    this.maxRequestBytes = positiveLimit(
      options.max_request_bytes ?? DEFAULT_MAX_REQUEST_BYTES,
      "max_request_bytes",
    );
    this.worker = options.worker ?? new Worker(
      new URL("./core.worker.ts", import.meta.url),
      { type: "module", name: "senkei-core" },
    );
    this.clientId = ++clientSequence;

    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onError);
    this.worker.addEventListener("messageerror", this.onMessageError);
  }

  nextRuleset(localTrial = false): Promise<RulePackage> {
    return this.request("next_ruleset", localTrial ? {local_trial:true} : {}) as Promise<RulePackage>;
  }

  reproductionAssets(localTrial = false): Promise<ReproductionAssets> {
    return this.request("next_reproduction_assets", localTrial ? {local_trial:true} : {}) as Promise<ReproductionAssets>;
  }

  editorCatalogJson(localTrial = false): Promise<string> {
    return this.request("editor_catalog", localTrial ? {local_trial:true} : {}) as Promise<string>;
  }

  editorCompile(request: EditorCompileRequest): Promise<EditorCompilerEnvelope> {
    return this.request("editor_compile", request) as Promise<EditorCompilerEnvelope>;
  }

  initialRuleset(): Promise<RulePackage> {
    return this.request("initial_ruleset", {}) as Promise<RulePackage>;
  }

  newMatchContext(ruleset_ref: RulesetRef, match_id: string): Promise<MatchContext> {
    return this.request("new_match_context", { ruleset_ref, match_id }) as Promise<MatchContext>;
  }

  parseText(source: string, ruleset_ref: RulesetRef): Promise<StructuredTacticsAst> {
    return this.request("parse_text", { source, ruleset_ref }) as Promise<StructuredTacticsAst>;
  }

  formatAst(ast: StructuredTacticsAst, ruleset_ref: RulesetRef): Promise<string> {
    return this.request("format_ast", { ast, ruleset_ref }) as Promise<string>;
  }

  compile(input: TacticalInput): Promise<CompileOutcome> {
    return this.request("compile", input) as Promise<CompileOutcome>;
  }

  preflight(snapshot: SimulationSnapshot): Promise<void> {
    return this.request("preflight", { snapshot }) as Promise<void>;
  }

  preflightReproduction(
    snapshot: SimulationSnapshot,
    assets: ReproductionAssets,
    snapshot_digest: ContentDigest,
  ): Promise<void> {
    return this.request("preflight_reproduction", { assets, snapshot, snapshot_digest }).then((result) => {
      if (result !== null) {
        throw new CoreClientError({
          code: "core_error",
          message: "The reproduction preflight worker operation must return null.",
        });
      }
    });
  }

  simulate(
    snapshot: SimulationSnapshot,
    options: SimulationRequestOptions = {},
  ): Promise<SimulationResponse> {
    const payload = options.include_diagnostics === true
      ? { snapshot, include_diagnostics: true as const, diagnostics_side: options.diagnostics_side }
      : { snapshot, include_diagnostics: false as const };
    return this.request("simulate", payload) as Promise<SimulationResponse>;
  }

  reproduce(
    snapshot: SimulationSnapshot,
    assets: ReproductionAssets,
    snapshot_digest: string,
    options: SimulationRequestOptions = {},
  ): Promise<SimulationResponse> {
    const payload = options.include_diagnostics === true
      ? { assets, snapshot, snapshot_digest, include_diagnostics: true as const, diagnostics_side: options.diagnostics_side }
      : { assets, snapshot, snapshot_digest, include_diagnostics: false as const };
    return this.request("reproduce", payload) as Promise<SimulationResponse>;
  }

  benchmark(cases: readonly BenchmarkCase[]): Promise<BenchmarkOutcome> {
    if (cases.length > MAX_BENCHMARK_CASES) {
      return Promise.reject(new CoreClientError({
        code: "invalid_request",
        message: `A benchmark may contain at most ${MAX_BENCHMARK_CASES} cases.`,
      }));
    }
    return this.request("benchmark", { cases }) as Promise<BenchmarkOutcome>;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onError);
    this.worker.removeEventListener("messageerror", this.onMessageError);
    this.worker.terminate();
    this.rejectPending({
      code: "worker_error",
      message: "The core worker was disposed before completing its request.",
    });
  }

  private request(
    operation: WebWorkerRequest["operation"],
    payload: unknown,
  ): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new CoreClientError({
        code: "worker_error",
        message: "The core worker client has been disposed.",
      }));
    }
    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(new CoreClientError({
        code: "invalid_request",
        message: `The core worker queue is full (${this.maxPendingRequests} pending requests).`,
      }));
    }

    let requestId: string;
    try {
      requestId = this.nextRequestId();
    } catch (error) {
      return Promise.reject(error);
    }
    const request = {
      web_protocol_version: WEB_WORKER_PROTOCOL_VERSION,
      request_id: requestId,
      operation,
      payload,
    };
    let json: string;
    try {
      json = stringifyJson(request);
      if (new TextEncoder().encode(json).byteLength > this.maxRequestBytes) {
        throw new CoreClientError({
          code: "invalid_request",
          message: `The core request exceeds the ${this.maxRequestBytes}-byte client limit.`,
        });
      }
    } catch (error) {
      return Promise.reject(error instanceof CoreClientError
        ? error
        : new CoreClientError({
          code: "invalid_request",
          message: error instanceof Error ? error.message : "The request is not JSON-compatible.",
        }, { cause: error }));
    }

    // Round-trip through JSON so the message contains only JSON-compatible data.
    const jsonRequest = JSON.parse(json) as WebWorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { operation, resolve, reject });
      try {
        this.worker.postMessage(jsonRequest);
      } catch (error) {
        this.pending.delete(requestId);
        reject(new CoreClientError({
          code: "invalid_request",
          message: error instanceof Error ? error.message : "The request could not be sent to the worker.",
        }, { cause: error }));
      }
    });
  }

  private nextRequestId(): string {
    if (this.requestSequence >= Number.MAX_SAFE_INTEGER) {
      throw new CoreClientError({
        code: "invalid_request",
        message: "This core worker client has exhausted its request ID space.",
      });
    }
    this.requestSequence += 1;
    return `senkei-${this.clientId}-${this.requestSequence}`;
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const data = asRecord(event.data);
    const requestId = typeof data?.request_id === "string" ? data.request_id : null;
    if (requestId === null) return;
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;

    const response = decodeResponse(event.data);
    if (response === null) {
      this.pending.delete(requestId);
      pending.reject(new CoreClientError({
        code: "worker_error",
        message: "The core worker returned a malformed response.",
      }));
      return;
    }
    if (response.web_protocol_version !== WEB_WORKER_PROTOCOL_VERSION) {
      this.pending.delete(requestId);
      pending.reject(new CoreClientError({
        code: "unsupported_protocol",
        message: "The core worker response uses an unsupported protocol version.",
      }));
      return;
    }
    if (!response.ok) {
      this.pending.delete(requestId);
      pending.reject(new CoreClientError(response.error));
      return;
    }
    if (response.operation !== pending.operation) {
      this.pending.delete(requestId);
      pending.reject(new CoreClientError({
        code: "worker_error",
        message: "The core worker response operation does not match the request.",
      }));
      return;
    }

    this.pending.delete(requestId);
    pending.resolve(response.result);
  };

  private readonly onError = (event: ErrorEvent): void => {
    event.preventDefault();
    this.failWorker(event.message || "The core worker stopped unexpectedly.");
  };

  private readonly onMessageError = (): void => {
    this.failWorker("The core worker sent a message that could not be decoded.");
  };

  private failWorker(message: string): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onError);
    this.worker.removeEventListener("messageerror", this.onMessageError);
    this.worker.terminate();
    this.rejectPending({ code: "worker_error", message });
  }

  private rejectPending(failure: WorkerFailure): void {
    const error = new CoreClientError(failure);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export function createCoreClient(options?: CoreClientOptions): CoreClient {
  return new WorkerCoreClient(options);
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function stringifyJson(value: unknown): string {
  const sanitized = sanitizeJson(value, new WeakSet<object>(), 0);
  const json = JSON.stringify(sanitized);
  if (json === undefined) throw new TypeError("The request did not serialize to JSON.");
  return json;
}

function sanitizeJson(value: unknown, active: WeakSet<object>, depth: number): CoreJsonValue {
  if (depth > 128) throw new TypeError("The request exceeds the JSON nesting limit.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite.");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("The request contains a non-JSON value.");
  if (active.has(value)) throw new TypeError("The request contains a circular reference.");

  active.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeJson(item, active, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("The request must contain plain JSON objects.");
    }
    const output: Record<string, CoreJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = sanitizeJson(item, active, depth + 1);
    }
    return output;
  } finally {
    active.delete(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function decodeResponse(value: unknown): WebWorkerResponse | null {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.web_protocol_version !== "number" ||
    typeof record.request_id !== "string" ||
    typeof record.ok !== "boolean"
  ) {
    return null;
  }
  if (record.ok) {
    if (typeof record.operation !== "string" || !("result" in record)) return null;
  } else {
    const error = asRecord(record.error);
    if (
      error === null ||
      !isWorkerFailureCode(error.code) ||
      typeof error.message !== "string"
    ) {
      return null;
    }
  }
  return value as WebWorkerResponse;
}

function isWorkerFailureCode(value: unknown): value is WorkerFailureCode {
  return value === "invalid_request" ||
    value === "unsupported_protocol" ||
    value === "core_error" ||
    value === "worker_error";
}
