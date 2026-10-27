import type {
  BenchmarkCase,
  BenchmarkOutcome,
  CompileOutcome,
  CoreApiError,
  ReproductionAssets,
  CoreVersion,
  EditorCompilerEnvelope,
  RulesetRef,
  SimulationResponse,
  SimulationRequestPayload,
  SimulationSnapshot,
  TacticalInput,
  WorkerFailure,
} from "./core";
import type { ContentDigest, RulePackage } from "./core-model";
import type { BehaviorSimulationRequest, BehaviorSimulationResponse } from "./behavior";
import type { CompilerRequest as EditorCompileRequest } from "@senkei/jinrei-editor";
import { WEB_WORKER_PROTOCOL_VERSION } from "./core";

interface WorkerRequestBase {
  readonly web_protocol_version: typeof WEB_WORKER_PROTOCOL_VERSION;
  readonly request_id: string;
}

export type WebWorkerRequest =
  | (WorkerRequestBase & { readonly operation: "editor_resolve_behavior"; readonly payload: import("./behavior-resolution").BehaviorResolveRequest })
  | (WorkerRequestBase & { readonly operation: "simulate_behavior"; readonly payload: BehaviorSimulationRequest })
  | (WorkerRequestBase & {
      readonly operation: "initial_ruleset" | "next_ruleset";
      readonly payload: { readonly local_trial?: boolean };
    })
  | (WorkerRequestBase & {
      readonly operation: "next_reproduction_assets";
      readonly payload: { readonly local_trial?: boolean };
    })
  | (WorkerRequestBase & {
      readonly operation: "editor_catalog";
      readonly payload: { readonly local_trial?: boolean };
    })
  | (WorkerRequestBase & {
      readonly operation: "editor_compile";
      readonly payload: EditorCompileRequest;
    })
  | (WorkerRequestBase & {
      readonly operation: "new_match_context";
      readonly payload: { readonly ruleset_ref: RulesetRef; readonly match_id: string };
    })
  | (WorkerRequestBase & {
      readonly operation: "compile";
      readonly payload: TacticalInput;
    })
  | (WorkerRequestBase & {
      readonly operation: "parse_text";
      readonly payload: { readonly source: string; readonly ruleset_ref: RulesetRef };
    })
  | (WorkerRequestBase & {
      readonly operation: "format_ast";
      readonly payload: {
        readonly ast: import("./core-model").StructuredTacticsAst;
        readonly ruleset_ref: RulesetRef;
      };
    })
  | (WorkerRequestBase & {
      readonly operation: "simulate";
      readonly payload: { readonly snapshot: SimulationSnapshot } & SimulationRequestPayload;
    })
  | (WorkerRequestBase & {
      readonly operation: "reproduce";
      readonly payload: {
        readonly assets: ReproductionAssets;
        readonly snapshot: SimulationSnapshot;
        readonly snapshot_digest: ContentDigest;
      } & SimulationRequestPayload;
    })
  | (WorkerRequestBase & {
      readonly operation: "preflight_reproduction";
      readonly payload: {
        readonly assets: ReproductionAssets;
        readonly snapshot: SimulationSnapshot;
        readonly snapshot_digest: ContentDigest;
      };
    })
  | (WorkerRequestBase & {
      readonly operation: "preflight";
      readonly payload: { readonly snapshot: SimulationSnapshot };
    })
  | (WorkerRequestBase & {
      readonly operation: "benchmark";
      readonly payload: { readonly cases: readonly BenchmarkCase[] };
    });

interface WorkerResponseBase {
  readonly web_protocol_version: typeof WEB_WORKER_PROTOCOL_VERSION;
  readonly request_id: string;
  readonly ok: boolean;
}

export type WebWorkerResponse =
  | (WorkerResponseBase & { readonly operation: "editor_resolve_behavior"; readonly ok: true; readonly result: import("./behavior-resolution").BehaviorResolveReply })
  | (WorkerResponseBase & { readonly operation: "simulate_behavior"; readonly ok: true; readonly result: BehaviorSimulationResponse })
  | (WorkerResponseBase & {
      readonly operation: "initial_ruleset" | "next_ruleset";
      readonly ok: true;
      readonly result: RulePackage;
    })
  | (WorkerResponseBase & {
      readonly operation: "next_reproduction_assets";
      readonly ok: true;
      readonly result: ReproductionAssets;
    })
  | (WorkerResponseBase & {
      readonly operation: "editor_catalog";
      readonly ok: true;
      readonly result: string;
    })
  | (WorkerResponseBase & {
      readonly operation: "editor_compile";
      readonly ok: true;
      readonly result: EditorCompilerEnvelope;
    })
  | (WorkerResponseBase & {
      readonly operation: "new_match_context";
      readonly ok: true;
      readonly result: import("./core-model").MatchContext;
    })
  | (WorkerResponseBase & {
      readonly operation: "compile";
      readonly ok: true;
      readonly result: CompileOutcome;
    })
  | (WorkerResponseBase & {
      readonly operation: "parse_text";
      readonly ok: true;
      readonly result: import("./core-model").StructuredTacticsAst;
    })
  | (WorkerResponseBase & {
      readonly operation: "format_ast";
      readonly ok: true;
      readonly result: string;
    })
  | (WorkerResponseBase & {
      readonly operation: "simulate";
      readonly ok: true;
      readonly result: SimulationResponse;
    })
  | (WorkerResponseBase & {
      readonly operation: "reproduce";
      readonly ok: true;
      readonly result: SimulationResponse;
    })
  | (WorkerResponseBase & {
      readonly operation: "preflight_reproduction";
      readonly ok: true;
      readonly result: null;
    })
  | (WorkerResponseBase & {
      readonly operation: "preflight";
      readonly ok: true;
      readonly result: null;
    })
  | (WorkerResponseBase & {
      readonly operation: "benchmark";
      readonly ok: true;
      readonly result: BenchmarkOutcome;
    })
  | (WorkerResponseBase & {
      readonly ok: false;
      readonly error: WorkerFailure;
    });

interface WebCoreApiRequestBase {
  readonly api_version: CoreVersion;
  readonly request_id: string;
}

export type WebCoreApiEnvelope =
  | (WebCoreApiRequestBase & {
      readonly operation: "initial_ruleset" | "next_ruleset";
      readonly payload: { readonly local_trial?: boolean };
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "next_reproduction_assets";
      readonly payload: { readonly local_trial?: boolean };
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "editor_catalog";
      readonly payload: { readonly local_trial?: boolean };
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "editor_compile";
      readonly payload: EditorCompileRequest;
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "new_match_context";
      readonly payload: { readonly ruleset_ref: RulesetRef; readonly match_id: string };
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "compile_text";
      readonly payload: { readonly ruleset_ref: RulesetRef; readonly source: string };
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "parse_text";
      readonly payload: { readonly ruleset_ref: RulesetRef; readonly source: string };
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "format_ast";
      readonly payload: {
        readonly ruleset_ref: RulesetRef;
        readonly ast: import("./core-model").StructuredTacticsAst;
      };
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "compile_ast";
      readonly payload: {
        readonly ruleset_ref: RulesetRef;
        readonly ast: import("./core-model").StructuredTacticsAst;
      };
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "simulate";
      readonly payload: SimulationSnapshot & SimulationRequestPayload;
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "reproduce";
      readonly payload: {
        readonly assets: ReproductionAssets;
        readonly snapshot_digest: ContentDigest;
        readonly snapshot: SimulationSnapshot;
      } & SimulationRequestPayload;
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "preflight_reproduction";
      readonly payload: {
        readonly assets: ReproductionAssets;
        readonly snapshot_digest: ContentDigest;
        readonly snapshot: SimulationSnapshot;
      };
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "preflight";
      readonly payload: SimulationSnapshot;
    });

export interface WebCoreApiSuccess<TValue = unknown> {
  readonly api_version: CoreVersion;
  readonly request_id: string;
  readonly ok: true;
  readonly result: TValue;
  readonly error: null;
}

export interface WebCoreApiError {
  readonly api_version: CoreVersion;
  readonly request_id: string;
  readonly ok: false;
  readonly result: null;
  readonly error: CoreApiError;
}
