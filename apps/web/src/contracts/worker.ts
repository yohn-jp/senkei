import type {
  BenchmarkCase,
  BenchmarkOutcome,
  CompileOutcome,
  CoreApiError,
  CoreVersion,
  EditorCompilerEnvelope,
  RulesetRef,
  SimulationResponse,
  SimulationSnapshot,
  TacticalInput,
  WorkerFailure,
} from "./core";
import type { RulePackage } from "./core-model";
import type { CompilerRequest as EditorCompileRequest } from "@senkei/jinrei-editor";
import { WEB_WORKER_PROTOCOL_VERSION } from "./core";

interface WorkerRequestBase {
  readonly web_protocol_version: typeof WEB_WORKER_PROTOCOL_VERSION;
  readonly request_id: string;
}

export type WebWorkerRequest =
  | (WorkerRequestBase & {
      readonly operation: "initial_ruleset" | "next_ruleset";
      readonly payload: Record<string, never>;
    })
  | (WorkerRequestBase & {
      readonly operation: "editor_catalog";
      readonly payload: Record<string, never>;
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
      readonly payload: {
        readonly snapshot: SimulationSnapshot;
        readonly include_diagnostics: boolean;
      };
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
  | (WorkerResponseBase & {
      readonly operation: "initial_ruleset" | "next_ruleset";
      readonly ok: true;
      readonly result: RulePackage;
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
      readonly payload: Record<string, never>;
    })
  | (WebCoreApiRequestBase & {
      readonly operation: "editor_catalog";
      readonly payload: Record<string, never>;
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
      readonly payload: SimulationSnapshot & { readonly include_diagnostics: boolean };
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
