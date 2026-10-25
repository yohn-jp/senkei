import type {
  CoreJsonValue,
  SimulationResponse,
  SimulationSnapshot,
} from "./core";
import type {
  ComponentVersions,
  MatchResult,
  RulePackage,
  TacticalProgram,
} from "./core-model";
import type {
  LocalPveScenario,
  LocalSenkeiDocument,
} from "./workspace";
import type { CompileOutcome } from "./core";

/** Versioned sidecar for state that is not part of a SenkeiDraft. */
export interface LocalSenkeiRunSummary {
  readonly scenario_id: string | null;
  readonly snapshot: SimulationSnapshot;
  readonly result: MatchResult;
}

/** The current complete response, including public replay and optional local diagnostics. */
export interface LocalSenkeiLatestRun {
  readonly scenario_id: string | null;
  readonly snapshot: SimulationSnapshot;
  readonly response: SimulationResponse;
}

export interface LocalSenkeiBenchmarkCaseSummary {
  readonly case_id: string;
  readonly case_role?: "before" | "current";
  /** Exact input snapshot for a future deterministic rerun. */
  readonly snapshot: SimulationSnapshot;
  readonly result: MatchResult;
}

/** Compact benchmark history; replay frames and diagnostics are not duplicated here. */
export interface LocalSenkeiBenchmarkSummary {
  readonly cases: readonly LocalSenkeiBenchmarkCaseSummary[];
}

export interface LocalSenkeiWorkspaceData {
  readonly bundle_version: 2;
  readonly compiled_program: TacticalProgram | null;
  readonly compilation: CompileOutcome | null;
  readonly rulesets: readonly RulePackage[];
  readonly component_versions: ComponentVersions | null;
  readonly scenarios: readonly LocalPveScenario[];
  /** Only the latest run keeps its full replay and optional diagnostics. */
  readonly latest_run: LocalSenkeiLatestRun | null;
  /** Previous exact input and authoritative result, used for before/current comparisons. */
  readonly baseline: LocalSenkeiRunSummary | null;
  /** Latest benchmark inputs/results without storing their replay frames again. */
  readonly benchmark: LocalSenkeiBenchmarkSummary | null;
  /** Bounded compact history of prior benchmark results. */
  readonly benchmark_history: readonly LocalSenkeiBenchmarkSummary[];
  /** Preserves fields owned by later local features without lossy migrations. */
  readonly extensions: CoreJsonValue;
}

/** Immutable local Next match record used for the latest run and its comparison baseline. */
export interface LocalNextExperiment {
  readonly id: string;
  readonly match_id: string;
  readonly created_at: string;
  readonly snapshot: SimulationSnapshot;
  readonly response: SimulationResponse;
  /** Browser-owned Next setup captured with the submitted match snapshots. */
  readonly setup: CoreJsonValue;
  readonly include_diagnostics: boolean;
  readonly estimated_cu: number;
}

/** Bounded store: at most the latest experiment and one prior comparison run. */
export interface LocalNextExperimentStore {
  readonly format_version: 1;
  readonly ruleset_digest: string;
  readonly experiments: readonly LocalNextExperiment[];
}

/** One immutable save point. The document is kept verbatim with its sidecar. */
export interface LocalSenkeiHistoryRevision {
  readonly document: LocalSenkeiDocument;
  readonly workspace_data: LocalSenkeiWorkspaceData;
}

/** JSON import/export includes every immutable revision and its full sidecar. */
export interface LocalSenkeiExportBundle {
  readonly format: "senkei.local-workspace";
  readonly bundle_version: 2;
  readonly active_document_id: string;
  readonly active_revision: number;
  readonly history: readonly LocalSenkeiHistoryRevision[];
}
