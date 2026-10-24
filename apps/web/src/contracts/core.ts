import type {
  CompileDiagnostic,
  MatchContext,
  MatchResult,
  PresentationReplay,
  RestrictedDiagnostics,
  RulePackage,
  SenkeiSnapshot,
  StructuredTacticsAst,
  TacticalProgram,
} from "./core-model";

/** JSON values crossing the Rust/WASM boundary. Domain shapes stay core-owned. */
export type CoreJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CoreJsonValue[]
  | { readonly [key: string]: CoreJsonValue };

export interface CoreVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export const CORE_API_VERSION: CoreVersion = Object.freeze({
  major: 1,
  minor: 0,
  patch: 0,
});

/** Version of StructuredTacticsAst wire JSON, independent of Jinrei language version. */
export const STRUCTURED_AST_VERSION: CoreVersion = Object.freeze({
  major: 1,
  minor: 0,
  patch: 0,
});

export interface RulesetRef {
  readonly id: string;
  readonly version: CoreVersion;
  readonly digest: string;
}

export type LogicalCu = number;

export type ApiErrorCode =
  | "invalid_request"
  | "invalid_version"
  | "invalid_ruleset"
  | "validation_failed"
  | "compile_failed"
  | "invalid_program"
  | "runtime_failure"
  | "invalid_snapshot"
  | "incompatible_version"
  | "unsupported_primitive"
  | "budget_exceeded"
  | "resource_limit"
  | "transition_conflict"
  | "arithmetic_overflow"
  | "internal_error";

export const WEB_WORKER_PROTOCOL_VERSION = 1 as const;

export type TacticalInput =
  | {
      readonly kind: "text";
      readonly ruleset_ref: RulesetRef;
      readonly source: string;
    }
  | {
      readonly kind: "structured_ast";
      readonly ruleset_ref: RulesetRef;
      readonly ast: StructuredTacticsAst;
    };

/** Complete immutable Enbu input, using the Rust core's JSON DTOs. */
export interface SimulationSnapshot {
  readonly attacker: SenkeiSnapshot;
  readonly defender: SenkeiSnapshot;
  readonly context: MatchContext;
}

export interface BenchmarkCase {
  readonly case_id: string;
  readonly case_role?: "before" | "current";
  readonly snapshot: SimulationSnapshot;
}

export interface CompileOutcome {
  readonly program: TacticalProgram;
  readonly ast: StructuredTacticsAst;
  readonly estimated_cu: LogicalCu;
  readonly diagnostics: readonly CompileDiagnostic[];
}

export interface SimulationOutcome {
  readonly result: MatchResult;
  readonly presentation_replay: PresentationReplay;
}

export interface SimulationResponse {
  /** Local attacker perspective, kept separate from the public replay. */
  readonly owner_replay?: import("./core-model").PresentationReplay;
  readonly outcome: SimulationOutcome;
  /** Separate local-only channel; renderers receive SimulationOutcome instead. */
  readonly restricted_diagnostics?: RestrictedDiagnostics;
}

export interface BenchmarkOutcome {
  /** Entries are returned in input order. No wall-clock timing becomes game data. */
  readonly cases: readonly {
    readonly case_id: string;
    readonly case_role?: "before" | "current";
    readonly outcome: SimulationOutcome;
  }[];
}

export interface CoreApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly path: string | null;
  readonly details: Readonly<Record<string, string>>;
}

export type WorkerFailureCode =
  | "invalid_request"
  | "unsupported_protocol"
  | "core_error"
  | "worker_error";

export interface WorkerFailure {
  readonly code: WorkerFailureCode;
  readonly message: string;
  readonly details?: CoreJsonValue;
}

export interface CoreClient {
  initialRuleset(): Promise<RulePackage>;
  nextRuleset(): Promise<RulePackage>;
  newMatchContext(ruleset_ref: RulesetRef, match_id: string): Promise<MatchContext>;
  parseText(source: string, ruleset_ref: RulesetRef): Promise<StructuredTacticsAst>;
  formatAst(ast: StructuredTacticsAst, ruleset_ref: RulesetRef): Promise<string>;
  compile(input: TacticalInput): Promise<CompileOutcome>;
  simulate(
    snapshot: SimulationSnapshot,
    options?: { readonly include_diagnostics?: boolean },
  ): Promise<SimulationResponse>;
  benchmark(cases: readonly BenchmarkCase[]): Promise<BenchmarkOutcome>;
  dispose(): void;
}
