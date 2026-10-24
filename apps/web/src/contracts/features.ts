import type {
  BenchmarkCase,
  BenchmarkOutcome,
  CompileOutcome,
  SimulationOutcome,
  SimulationSnapshot,
  TacticalInput,
} from "./core";
import type { RestrictedDiagnostics, RulePackage } from "./core-model";
import type { StructuredTacticsAst } from "./core-model";
import type { RulesetRef } from "./core";
import type {
  EditorDraft,
  LocalSenkeiDocument,
  LocalSenkeiRevisionSummary,
  LocalSenkeiDocumentSummary,
  SenkeiDocumentDiffEntry,
  LocalPveScenario,
  SenkeiDraft,
} from "./workspace";

export interface EditorFeatureProps {
  readonly ruleset: RulePackage | null;
  readonly draft: EditorDraft;
  readonly compilation: CompileOutcome | null;
  onDraftChange(draft: EditorDraft): void;
  onParse(source: string, ruleset_ref: RulesetRef): Promise<StructuredTacticsAst>;
  onFormat(ast: StructuredTacticsAst, ruleset_ref: RulesetRef): Promise<string>;
  onCompile(input: TacticalInput): Promise<void>;
}

export interface BattleFeatureProps {
  readonly ruleset: RulePackage | null;
  readonly scenarios: readonly LocalPveScenario[];
  readonly selected_scenario_id: string | null;
  readonly snapshot: SimulationSnapshot | null;
  /** Previous saved simulation input used as the `before` comparison case. */
  readonly baseline_snapshot: SimulationSnapshot | null;
  readonly baseline_scenario_id: string | null;
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
  onBenchmarkScenarios(scenario_ids: readonly string[]): Promise<void>;
}

export interface PersistenceFeatureProps {
  readonly documents: readonly LocalSenkeiDocumentSummary[];
  /** App bootstrap error opening/listing IndexedDB; undefined means no load error. */
  readonly storage_error?: string | null;
  readonly active_document: LocalSenkeiDocument | null;
  readonly active_draft: SenkeiDraft | null;
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
