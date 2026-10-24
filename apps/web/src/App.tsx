import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BenchmarkCase,
  CompileOutcome,
  CoreClient,
  EditorDraft,
  LocalPveScenario,
  LocalSenkeiDocument,
  LocalSenkeiDocumentSummary,
  LocalSenkeiRevisionSummary,
  LocalSenkeiWorkspaceData,
  MatchContext,
  PersistenceFeatureProps,
  RulePackage,
  SenkeiDocumentDiffEntry,
  SenkeiDraft,
  SimulationOutcome,
  SimulationResponse,
  SimulationSnapshot,
  TacticalInput,
  WorkspaceView,
} from "./contracts";
import { BattleFeature } from "./features/battle/BattleFeature";
import { EditorFeature } from "./features/editor";
import { PersistenceFeature } from "./features/persistence";
import {
  compareDocumentRevisions,
  createDocument,
  createExportBlob,
  deleteDocument,
  exportDocumentJson,
  importDocumentFile,
  listDocumentHistory,
  listDocuments,
  loadDocumentRevision,
  restoreDocumentRevision,
  saveDocument,
} from "./features/persistence/repository";
import { createCoreClient } from "./worker";
import { createBeginnerPreset, createCampaignScenarios } from "../../../scenarios/campaign/catalog";

const navigation: readonly { id: WorkspaceView; label: string; number: string }[] = [
  { id: "editor", label: "Tactics", number: "01" },
  { id: "battle", label: "Battle lab", number: "02" },
  { id: "persistence", label: "Library", number: "03" },
];

const EMPTY_WORKSPACE_DATA: LocalSenkeiWorkspaceData = Object.freeze({
  bundle_version: 1,
  compiled_program: null,
  compilation: null,
  rulesets: Object.freeze([]),
  component_versions: null,
  scenarios: Object.freeze([]),
  simulation_snapshots: Object.freeze([]),
  simulation_scenario_ids: Object.freeze([]),
  simulation_outcomes: Object.freeze([]),
  baseline_scenario_id: null,
  benchmark: null,
  benchmark_history: Object.freeze([]),
  extensions: Object.freeze({}),
});

interface CompletedRun {
  readonly scenario_id: string | null;
  readonly snapshot: SimulationSnapshot;
  readonly response: SimulationResponse;
}

interface PreparedRun {
  readonly scenario_id: string;
  readonly draft_key: string;
  readonly snapshot: SimulationSnapshot;
}

function draftKey(draft: EditorDraft): string | null {
  return draft === null ? null : JSON.stringify(draft);
}

function coreInput(draft: SenkeiDraft): TacticalInput {
  return draft.program_input.kind === "text"
    ? { kind: "text", ruleset_ref: draft.ruleset, source: draft.program_input.source }
    : { kind: "structured_ast", ruleset_ref: draft.ruleset, ast: draft.program_input.ast };
}

function snapshotForDraft(
  draft: SenkeiDraft,
  program: CompileOutcome["program"],
): SimulationSnapshot["attacker"] {
  return {
    schema_version: draft.schema_version,
    id: draft.id,
    revision: draft.revision,
    ruleset: draft.ruleset,
    configuration: draft.configuration,
    program,
    initial_memory: draft.initial_memory,
  };
}

function mergeRuleset(
  rulesets: readonly RulePackage[],
  ruleset: RulePackage | null,
): readonly RulePackage[] {
  if (!ruleset) return rulesets;
  return [
    ...rulesets.filter((saved) => saved.ruleset.digest !== ruleset.ruleset.digest),
    ruleset,
  ];
}

function sameSnapshot(left: SimulationSnapshot | null, right: SimulationSnapshot | null): boolean {
  return left !== null && right !== null && JSON.stringify(left) === JSON.stringify(right);
}

function deterministicMatchId(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const mask = (1n << 64n) - 1n;
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29ce4n;
  for (const byte of bytes) {
    first = ((first ^ BigInt(byte)) * 0x100000001b3n) & mask;
    second = ((second ^ BigInt(byte ^ 0xa5)) * 0x100000001b3n) & mask;
  }
  return `local-${first.toString(16).padStart(16, "0")}${second.toString(16).padStart(16, "0")}`;
}

function snapshotForScenario(
  context: MatchContext,
  player: SenkeiDraft,
  playerProgram: CompileOutcome["program"],
  npc: SenkeiDraft,
  npcProgram: CompileOutcome["program"],
): SimulationSnapshot {
  return {
    attacker: snapshotForDraft(player, playerProgram),
    defender: snapshotForDraft(npc, npcProgram),
    context,
  };
}

function latestRunFromWorkspace(data: LocalSenkeiWorkspaceData): CompletedRun | null {
  const index = Math.min(data.simulation_snapshots.length, data.simulation_outcomes.length) - 1;
  if (index < 0) return null;
  return {
    scenario_id: data.simulation_scenario_ids[index] ?? null,
    snapshot: data.simulation_snapshots[index],
    response: data.simulation_outcomes[index],
  };
}

function activeBaseline(data: LocalSenkeiWorkspaceData): {
  readonly snapshot: SimulationSnapshot | null;
  readonly scenario_id: string | null;
} {
  const index = data.simulation_snapshots.length - 2;
  if (index < 0) return { snapshot: null, scenario_id: null };
  const scenarioId = data.simulation_scenario_ids[index] ?? null;
  return {
    snapshot: scenarioId !== null && scenarioId === data.baseline_scenario_id
      ? data.simulation_snapshots[index]
      : null,
    scenario_id: data.baseline_scenario_id,
  };
}

function App() {
  const [view, setView] = useState<WorkspaceView>("editor");
  const [core, setCore] = useState<CoreClient | null>(null);
  const [ruleset, setRuleset] = useState<RulePackage | null>(null);
  const rulesetRef = useRef<RulePackage | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<readonly LocalPveScenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<EditorDraft>(null);
  const editorDraftRef = useRef<EditorDraft>(null);
  const openedDocumentRef = useRef(false);
  const [compiled, setCompiled] = useState<{ readonly draft_key: string; readonly result: CompileOutcome } | null>(null);
  const [prepared, setPrepared] = useState<PreparedRun | null>(null);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const preparationSequence = useRef(0);
  const [lastRun, setLastRun] = useState<CompletedRun | null>(null);
  const [benchmark, setBenchmark] = useState<LocalSenkeiWorkspaceData["benchmark"]>(null);
  const [workspaceData, setWorkspaceData] = useState<LocalSenkeiWorkspaceData>(EMPTY_WORKSPACE_DATA);
  const [documents, setDocuments] = useState<readonly LocalSenkeiDocumentSummary[]>([]);
  const [activeDocument, setActiveDocument] = useState<LocalSenkeiDocument | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [history, setHistory] = useState<readonly LocalSenkeiRevisionSummary[]>([]);
  const [diff, setDiff] = useState<readonly SenkeiDocumentDiffEntry[] | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const currentDraftKey = draftKey(editorDraft);
  const activeCompilation = currentDraftKey !== null && compiled?.draft_key === currentDraftKey
    ? compiled.result
    : null;

  useEffect(() => {
    const client = createCoreClient();
    let current = true;
    setCore(client);
    void client.initialRuleset().then((packageValue) => {
      if (!current) return;
      let campaign: readonly LocalPveScenario[] = [];
      let starter: SenkeiDraft | null = null;
      try {
        campaign = createCampaignScenarios(packageValue);
        starter = createBeginnerPreset(packageValue);
        setCatalogError(null);
      } catch (error) {
        setCatalogError(error instanceof Error ? error.message : "The bundled campaign package could not be prepared.");
      }
      if (!openedDocumentRef.current || rulesetRef.current === null) {
        rulesetRef.current = packageValue;
        setRuleset(packageValue);
      }
      if (editorDraftRef.current === null && starter !== null) {
        editorDraftRef.current = starter;
        setEditorDraft(starter);
      }
      setScenarios((previous) => previous.length > 0 ? previous : campaign);
      if (campaign.length > 0) {
        setSelectedScenarioId((previous) => previous && campaign.some((scenario) => scenario.id === previous)
          ? previous
          : campaign[0].id);
      }
      setWorkspaceData((previous) => ({
        ...previous,
        rulesets: mergeRuleset(previous.rulesets, packageValue),
        scenarios: previous.scenarios.length > 0 ? previous.scenarios : campaign,
      }));
      setCoreError(null);
    }).catch((error: unknown) => {
      if (!current) return;
      setCoreError(error instanceof Error ? error.message : "The local Rust core could not be loaded.");
    });
    return () => {
      current = false;
      client.dispose();
    };
  }, []);

  useEffect(() => {
    let current = true;
    void listDocuments().then((items) => {
      if (!current) return;
      setDocuments(items);
      setStorageError(null);
    }).catch((error: unknown) => {
      if (!current) return;
      setStorageError(error instanceof Error ? error.message : "The local library could not be opened.");
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (scenarios.length === 0) {
      if (selectedScenarioId !== null) setSelectedScenarioId(null);
      return;
    }
    if (!selectedScenarioId || !scenarios.some((scenario) => scenario.id === selectedScenarioId)) {
      setSelectedScenarioId(scenarios[0].id);
    }
  }, [scenarios, selectedScenarioId]);

  useEffect(() => {
    const sequence = ++preparationSequence.current;
    setPrepared(null);
    setPreparationError(null);
    const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;
    const playerDraft = editorDraft;
    const playerCompile = activeCompilation;
    if (!core || !ruleset || !selectedScenario || !playerDraft || !playerCompile) return;

    let canceled = false;
    void (async () => {
      try {
        if (
          selectedScenario.npc.ruleset.digest !== ruleset.ruleset.digest ||
          playerDraft.ruleset.digest !== ruleset.ruleset.digest
        ) {
          throw new Error("The selected draft or NPC uses a different ruleset package. Select a matching local campaign package.");
        }
        const npcCompilation = await core.compile(coreInput(selectedScenario.npc));
        if (canceled || sequence !== preparationSequence.current) return;
        const attacker = snapshotForDraft(playerDraft, playerCompile.program);
        const defender = snapshotForDraft(selectedScenario.npc, npcCompilation.program);
        const match_id = deterministicMatchId({
          ruleset: ruleset.ruleset,
          scenario_id: selectedScenario.id,
          attacker,
          defender,
        });
        const context = await core.newMatchContext(ruleset.ruleset, match_id);
        if (canceled || sequence !== preparationSequence.current) return;
        const snapshot = snapshotForScenario(
          context,
          playerDraft,
          playerCompile.program,
          selectedScenario.npc,
          npcCompilation.program,
        );
        setPrepared({
          scenario_id: selectedScenario.id,
          draft_key: currentDraftKey ?? "",
          snapshot,
        });
        setWorkspaceData((previous) => ({
          ...previous,
          rulesets: mergeRuleset(previous.rulesets, ruleset),
          scenarios,
          component_versions: context.versions,
        }));
      } catch (error) {
        if (canceled || sequence !== preparationSequence.current) return;
        setPreparationError(error instanceof Error ? error.message : "The selected scenario could not be prepared by the local core.");
      }
    })();
    return () => { canceled = true; };
  }, [activeCompilation, core, currentDraftKey, editorDraft, ruleset, scenarios, selectedScenarioId]);

  const loadSelectedDocument = useCallback(async (documentId: string): Promise<void> => {
    const [snapshot, revisions] = await Promise.all([
      loadDocumentRevision(documentId),
      listDocumentHistory(documentId),
    ]);
    const data = snapshot.workspace_data;
    openedDocumentRef.current = true;
    editorDraftRef.current = snapshot.document.payload;
    setSelectedDocumentId(documentId);
    setSelectedRevision(snapshot.document.revision);
    setActiveDocument(snapshot.document);
    setEditorDraft(snapshot.document.payload);
    setHistory(revisions);
    setDiff(null);
    setWorkspaceData(data);
    setBenchmark(data.benchmark);
    setCompiled(data.compilation
      ? { draft_key: draftKey(snapshot.document.payload) ?? "", result: data.compilation }
      : null);
    setLastRun(latestRunFromWorkspace(data));
    const currentRuleset = data.rulesets.find((saved) => saved.ruleset.digest === snapshot.document.payload.ruleset.digest);
    if (currentRuleset) {
      rulesetRef.current = currentRuleset;
      setRuleset(currentRuleset);
      if (data.scenarios.length > 0 && data.scenarios.every((scenario) =>
        scenario.npc.ruleset.digest === currentRuleset.ruleset.digest)) {
        setScenarios(data.scenarios);
      } else {
        try {
          setScenarios(createCampaignScenarios(currentRuleset));
        } catch {
          if (data.scenarios.length > 0) setScenarios(data.scenarios);
        }
      }
    } else if (data.scenarios.length > 0) {
      setScenarios(data.scenarios);
    }
  }, []);

  const saveWorkspaceData = useCallback((): LocalSenkeiWorkspaceData => ({
    ...workspaceData,
    compiled_program: activeCompilation?.program ?? null,
    compilation: activeCompilation,
    rulesets: mergeRuleset(workspaceData.rulesets, ruleset),
    scenarios,
    benchmark,
  }), [activeCompilation, benchmark, ruleset, scenarios, workspaceData]);

  const onDraftChange = useCallback((next: EditorDraft): void => {
    editorDraftRef.current = next;
    setEditorDraft(next);
    setCompiled(null);
    setWorkspaceData((previous) => ({
      ...previous,
      compiled_program: null,
      compilation: null,
    }));
  }, []);

  const onCompile = useCallback(async (input: TacticalInput): Promise<void> => {
    if (!core) throw new Error("The local Rust core is still loading.");
    const key = draftKey(editorDraftRef.current);
    if (!key) throw new Error("There is no active tactics draft to compile.");
    const outcome = await core.compile(input);
    if (draftKey(editorDraftRef.current) !== key) {
      throw new Error("The draft changed while the local core was compiling it. Compile the current draft again.");
    }
    setCompiled({ draft_key: key, result: outcome });
    setWorkspaceData((previous) => ({
      ...previous,
      compiled_program: outcome.program,
      compilation: outcome,
      rulesets: mergeRuleset(previous.rulesets, ruleset),
    }));
  }, [core, ruleset]);

  const onSelectScenario = useCallback((scenarioId: string): void => {
    setSelectedScenarioId(scenarioId);
  }, []);

  const onSimulate = useCallback(async (
    snapshot: SimulationSnapshot,
    options: { readonly include_diagnostics?: boolean } = {},
  ): Promise<void> => {
    if (!core) throw new Error("The local Rust core is still loading.");
    const selectedId = selectedScenarioId;
    const response = await core.simulate(snapshot, options);
    const run: CompletedRun = { scenario_id: selectedId, snapshot, response };
    const previousIndex = workspaceData.simulation_snapshots.length - 1;
    const baselineScenario = previousIndex >= 0
      ? workspaceData.simulation_scenario_ids[previousIndex] ?? null
      : null;
    setLastRun(run);
    setWorkspaceData((previous) => ({
      ...previous,
      simulation_snapshots: [...previous.simulation_snapshots, snapshot],
      simulation_scenario_ids: [...previous.simulation_scenario_ids, selectedId],
      simulation_outcomes: [...previous.simulation_outcomes, response],
      baseline_scenario_id: baselineScenario,
    }));
  }, [core, selectedScenarioId, workspaceData.simulation_scenario_ids, workspaceData.simulation_snapshots.length]);

  const onBenchmark = useCallback(async (cases: readonly BenchmarkCase[]): Promise<void> => {
    if (!core) throw new Error("The local Rust core is still loading.");
    const outcome = await core.benchmark(cases);
    setBenchmark(outcome);
    setWorkspaceData((previous) => ({
      ...previous,
      benchmark: outcome,
      benchmark_history: [...previous.benchmark_history, outcome],
    }));
  }, [core]);

  const onBenchmarkScenarios = useCallback(async (scenarioIds: readonly string[]): Promise<void> => {
    if (!core || !ruleset || !editorDraft || !activeCompilation) {
      throw new Error("Compile the current player tactics and wait for the matching ruleset before comparing scenarios.");
    }
    if (editorDraft.ruleset.digest !== ruleset.ruleset.digest) {
      throw new Error("The active player draft uses a different ruleset package than the current campaign.");
    }
    const selected = scenarioIds.map((id) => scenarios.find((scenario) => scenario.id === id));
    if (selected.some((scenario) => !scenario)) {
      throw new Error("A requested challenge is no longer available in the local campaign catalog.");
    }
    const playerDraft = editorDraft;
    const playerProgram = activeCompilation.program;
    const cases = await Promise.all(selected.map(async (maybeScenario) => {
      const scenario = maybeScenario!;
      if (scenario.npc.ruleset.digest !== ruleset.ruleset.digest) {
        throw new Error(`Challenge “${scenario.title}” belongs to a different ruleset package.`);
      }
      const npcCompilation = await core.compile(coreInput(scenario.npc));
      const attacker = snapshotForDraft(playerDraft, playerProgram);
      const defender = snapshotForDraft(scenario.npc, npcCompilation.program);
      const matchId = deterministicMatchId({
        ruleset: ruleset.ruleset,
        scenario_id: scenario.id,
        attacker,
        defender,
      });
      const context = await core.newMatchContext(ruleset.ruleset, matchId);
      return { case_id: scenario.id, snapshot: snapshotForScenario(context, playerDraft, playerProgram, scenario.npc, npcCompilation.program) };
    }));
    await onBenchmark(cases);
  }, [activeCompilation, core, editorDraft, onBenchmark, ruleset, scenarios]);

  const persistenceHandlers: PersistenceFeatureProps = useMemo(() => ({
    documents,
    storage_error: storageError,
    active_document: activeDocument,
    active_draft: editorDraft,
    history,
    diff,
    selected_document_id: selectedDocumentId,
    selected_revision: selectedRevision,
    onCreate: async (name) => {
      if (!editorDraft) throw new Error("Open a tactics draft before creating a saved document.");
      const document = await createDocument(name, editorDraft, saveWorkspaceData());
      setActiveDocument(document);
      setSelectedDocumentId(document.id);
      setSelectedRevision(document.revision);
      setDiff(null);
      const [nextDocuments, nextHistory] = await Promise.all([
        listDocuments(),
        listDocumentHistory(document.id),
      ]);
      setDocuments(nextDocuments);
      setHistory(nextHistory);
      setStorageError(null);
    },
    onSelect: async (documentId) => {
      await loadSelectedDocument(documentId);
      setStorageError(null);
    },
    onSave: async (submitted) => {
      const document = await saveDocument(submitted, saveWorkspaceData());
      setActiveDocument(document);
      setSelectedDocumentId(document.id);
      setSelectedRevision(document.revision);
      setDiff(null);
      const [nextDocuments, nextHistory] = await Promise.all([
        listDocuments(),
        listDocumentHistory(document.id),
      ]);
      setDocuments(nextDocuments);
      setHistory(nextHistory);
      setStorageError(null);
    },
    onDelete: async (documentId) => {
      await deleteDocument(documentId);
      setDocuments(await listDocuments());
      setHistory([]);
      setDiff(null);
      if (selectedDocumentId === documentId) {
        setActiveDocument(null);
        setSelectedDocumentId(null);
        setSelectedRevision(null);
      }
      setStorageError(null);
    },
    onCompareRevisions: async (documentId, beforeRevision, afterRevision) => {
      setDiff(await compareDocumentRevisions(documentId, beforeRevision, afterRevision));
      setSelectedDocumentId(documentId);
      setStorageError(null);
    },
    onRestoreRevision: async (documentId, revision) => {
      await restoreDocumentRevision(documentId, revision);
      await loadSelectedDocument(documentId);
      setDocuments(await listDocuments());
      setStorageError(null);
    },
    onImport: async (file) => {
      const document = await importDocumentFile(file);
      setDocuments(await listDocuments());
      await loadSelectedDocument(document.id);
      setStorageError(null);
    },
    onExport: async (documentId) => {
      const json = await exportDocumentJson(documentId);
      const blob = createExportBlob(json);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `senkei-${documentId}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  }), [
    activeDocument,
    diff,
    documents,
    editorDraft,
    history,
    loadSelectedDocument,
    saveWorkspaceData,
    selectedDocumentId,
    selectedRevision,
    storageError,
  ]);

  const completedForSelection = lastRun?.scenario_id === selectedScenarioId ? lastRun : null;
  const currentSnapshot = prepared?.scenario_id === selectedScenarioId &&
    prepared.draft_key === (currentDraftKey ?? "") &&
    prepared.snapshot.attacker.ruleset.digest === ruleset?.ruleset.digest &&
    prepared.snapshot.defender.ruleset.digest === ruleset?.ruleset.digest
    ? prepared.snapshot
    : null;
  const visibleRun = completedForSelection && sameSnapshot(completedForSelection.snapshot, currentSnapshot)
    ? completedForSelection
    : null;
  const visibleOutcome: SimulationOutcome | null = visibleRun
    ? visibleRun.response.outcome
    : null;
  const baseline = activeBaseline(workspaceData);

  return (
    <main className="app-shell" data-testid="app-shell">
      <aside className="sidebar">
        <a className="wordmark" href="#workspace" aria-label="Senkei home">
          <span className="wordmark-mark">S</span>
          <span>
            <strong>SENKEI</strong>
            <small>STRATEGY WORKSHOP</small>
          </span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Workspace" data-testid="workspace-nav">
          {navigation.map((item) => (
            <button
              aria-current={view === item.id ? "page" : undefined}
              className={`nav-item${view === item.id ? " is-active" : ""}`}
              data-testid={`nav-${item.id}`}
              key={item.id}
              onClick={() => setView(item.id)}
              type="button"
            >
              <span className="nav-number">{item.number}</span>
              <span>{item.label}</span>
              <span className="nav-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="local-status"><span /> RUNNING LOCALLY</div>
          <p>Build a strategy.<br />Watch it play.</p>
          <small>NO ACCOUNT · NO SERVER</small>
        </div>
      </aside>

      <section className="workspace" id="workspace">
        <header className="topbar">
          <div className="breadcrumb">SENKEI <span>/</span> {view.toUpperCase()}</div>
          <div className="local-badge"><span /> LOCAL MODE</div>
        </header>

        <div className="page-content" data-testid="workspace-view" data-view={view}>
          <div className="page-heading">
            <div>
              <div className="feature-eyebrow">DESIGN · TEST · REFINE</div>
              <h1>Your strategy, <em>in motion.</em></h1>
              <p>Shape a formation, run a battle, and learn from every result.</p>
            </div>
            <div className="heading-mark" aria-hidden="true">戦</div>
          </div>

          {(coreError || (view === "battle" && (preparationError || catalogError))) && (
            <div className="app-error" role="alert">{coreError ?? preparationError ?? catalogError}</div>
          )}

          <div className="feature-grid">
            <div className="feature-primary">
              {view === "editor" && (
                <EditorFeature
                  ruleset={ruleset}
                  draft={editorDraft}
                  compilation={activeCompilation}
                  onDraftChange={onDraftChange}
                  onParse={(source, rulesetRef) => {
                    if (!core) return Promise.reject(new Error("The local Rust core is still loading."));
                    return core.parseText(source, rulesetRef);
                  }}
                  onFormat={(ast, rulesetRef) => {
                    if (!core) return Promise.reject(new Error("The local Rust core is still loading."));
                    return core.formatAst(ast, rulesetRef);
                  }}
                  onCompile={onCompile}
                />
              )}

              {view === "battle" && (
                <BattleFeature
                  ruleset={ruleset}
                  scenarios={scenarios}
                  selected_scenario_id={selectedScenarioId}
                  snapshot={currentSnapshot}
                  baseline_snapshot={baseline.snapshot}
                  baseline_scenario_id={baseline.scenario_id}
                  outcome={visibleOutcome}
                  benchmark={benchmark}
                  restricted_diagnostics={visibleRun?.response.restricted_diagnostics ?? null}
                  onSelectScenario={onSelectScenario}
                  onSnapshotChange={() => undefined}
                  onSimulate={onSimulate}
                  onBenchmark={onBenchmark}
                  onBenchmarkScenarios={onBenchmarkScenarios}
                />
              )}

              {view === "persistence" && <PersistenceFeature {...persistenceHandlers} />}
            </div>

            <aside className="principle-card">
              <div className="principle-icon" aria-hidden="true">◎</div>
              <div className="feature-eyebrow">THE SENKEI LOOP</div>
              <ol>
                <li><span>01</span> Design your formation</li>
                <li><span>02</span> Let your strategy fight</li>
                <li><span>03</span> Study the replay</li>
                <li><span>04</span> Improve and go again</li>
              </ol>
              <div className="principle-note">Every battle is deterministic and runs on your device.</div>
            </aside>
          </div>

          <footer className="page-footer">
            <span>LOCAL FIRST BY DESIGN</span>
            <span>EDIT → SIMULATE → LEARN</span>
          </footer>
        </div>
      </section>
    </main>
  );
}

export default App;
