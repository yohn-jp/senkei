import type {
  BenchmarkCase,
  BenchmarkOutcome,
  CompileOutcome,
  SimulationOutcome,
  SimulationSnapshot,
  TacticalInput,
} from "./core";
import type { RestrictedDiagnostics, RulePackage } from "./core-model";
import type {
  EditorDraft,
  LocalSenkeiDocument,
  LocalSenkeiRevisionSummary,
  LocalSenkeiDocumentSummary,
  SenkeiDocumentDiffEntry,
  LocalPveScenario,
} from "./workspace";

export interface EditorFeatureProps {
  readonly ruleset: RulePackage | null;
  readonly draft: EditorDraft;
  readonly compilation: CompileOutcome | null;
  onDraftChange(draft: EditorDraft): void;
  onCompile(input: TacticalInput): Promise<void>;
}

export interface BattleFeatureProps {
  readonly scenarios: readonly LocalPveScenario[];
  readonly selected_scenario_id: string | null;
  readonly snapshot: SimulationSnapshot | null;
  readonly outcome: SimulationOutcome | null;
  readonly benchmark: BenchmarkOutcome | null;
  readonly restricted_diagnostics: RestrictedDiagnostics | null;
  onSelectScenario(scenario_id: string): void;
  onSnapshotChange(snapshot: SimulationSnapshot): void;
  onSimulate(
    snapshot: SimulationSnapshot,
    options?: { readonly include_diagnostics?: boolean },
  ): Promise<void>;
  onBenchmark(cases: readonly BenchmarkCase[]): Promise<void>;
}

export interface PersistenceFeatureProps {
  readonly documents: readonly LocalSenkeiDocumentSummary[];
  readonly history: readonly LocalSenkeiRevisionSummary[];
  readonly diff: readonly SenkeiDocumentDiffEntry[] | null;
  readonly selected_document_id: string | null;
  readonly selected_revision: number | null;
  onCreate(name: string): Promise<void>;
  onSelect(document_id: string): Promise<void>;
  onSave(document: LocalSenkeiDocument): Promise<void>;
  onDelete(document_id: string): Promise<void>;
  onCompareRevisions(document_id: string, before_revision: number, after_revision: number): Promise<void>;
  onRestoreRevision(document_id: string, revision: number): Promise<void>;
  onImport(file: File): Promise<void>;
  onExport(document_id: string): Promise<void>;
}
