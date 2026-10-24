import type {
  BenchmarkOutcome,
  CoreJsonValue,
  SimulationResponse,
  SimulationSnapshot,
} from "./core";
import type {
  ComponentVersions,
  RulePackage,
  TacticalProgram,
} from "./core-model";
import type {
  LocalPveScenario,
  LocalSenkeiDocument,
} from "./workspace";
import type { CompileOutcome } from "./core";

/** Versioned sidecar for state that is not part of a SenkeiDraft. */
export interface LocalSenkeiWorkspaceData {
  readonly bundle_version: 1;
  readonly compiled_program: TacticalProgram | null;
  readonly compilation: CompileOutcome | null;
  readonly rulesets: readonly RulePackage[];
  readonly component_versions: ComponentVersions | null;
  readonly scenarios: readonly LocalPveScenario[];
  readonly simulation_snapshots: readonly SimulationSnapshot[];
  /** Parallel to `simulation_snapshots`; null means no campaign scenario. */
  readonly simulation_scenario_ids: readonly (string | null)[];
  readonly simulation_outcomes: readonly SimulationResponse[];
  readonly baseline_scenario_id: string | null;
  readonly benchmark: BenchmarkOutcome | null;
  readonly benchmark_history: readonly BenchmarkOutcome[];
  /** Preserves fields owned by later local features without lossy migrations. */
  readonly extensions: CoreJsonValue;
}

/** One immutable save point. The document is kept verbatim with its sidecar. */
export interface LocalSenkeiHistoryRevision {
  readonly document: LocalSenkeiDocument;
  readonly workspace_data: LocalSenkeiWorkspaceData;
}

/** JSON import/export includes every immutable revision and its full sidecar. */
export interface LocalSenkeiExportBundle {
  readonly format: "senkei.local-workspace";
  readonly bundle_version: 1;
  readonly active_document_id: string;
  readonly active_revision: number;
  readonly history: readonly LocalSenkeiHistoryRevision[];
}
