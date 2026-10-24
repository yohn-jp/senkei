import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type {
  BenchmarkCase,
  BenchmarkOutcome,
  SimulationOutcome,
  SimulationSnapshot,
} from "../../contracts/core";
import type {
  DiagnosticEvent,
  DomainValue,
  EntityStateView,
  ReplayFrame,
  RestrictedDiagnostics,
  RulePackage,
} from "../../contracts/core-model";
import type { BattleFeatureProps } from "../../contracts/features";
import type { LocalPveScenario } from "../../contracts/workspace";
import "./battle-feature.css";

const PLAYBACK_INTERVAL_MS = 500;
const PLAYBACK_RATES = [0.5, 1, 2, 4] as const;

type PlaybackRate = (typeof PLAYBACK_RATES)[number];

interface LaneDescriptor {
  readonly id: string;
  readonly label: string;
}

interface CuRow {
  readonly tick: number;
  readonly side: "attacker" | "defender";
  readonly lane: string | null;
  readonly action_id: string | null;
  readonly entity_id: string | null;
  readonly operation: string;
  readonly amount: number;
}

/**
 * The feature renders core-owned public replay values. It never advances or
 * interprets the simulation itself.
 */
type BattleFeaturePropsWithRules = BattleFeatureProps & {
  readonly ruleset?: RulePackage | null;
  readonly baseline_snapshot?: SimulationSnapshot | null;
  readonly baseline_scenario_id?: string | null;
  onBenchmarkScenarios?(scenario_ids: readonly string[]): Promise<void>;
};

type CampaignScenario = Omit<LocalPveScenario, "campaign_id" | "campaign_title" | "order" | "objective" | "criteria" | "snapshot" | "npc" | "difficulty"> & {
  readonly campaign_id?: string;
  readonly campaign_title?: string;
  readonly order?: number;
  readonly objective?: string;
  readonly difficulty?: "beginner" | "standard" | "expert";
  readonly criteria?: readonly { readonly id: string; readonly label: string }[];
};

interface ScenarioGroup {
  readonly id: string;
  readonly title: string;
  readonly scenarios: readonly CampaignScenario[];
}

type DiagnosticEventWithLinks = DiagnosticEvent & {
  readonly action_id?: string | null;
  readonly entity_id?: string | null;
};

type ComparableBenchmarkCase = BenchmarkOutcome["cases"][number] & {
  readonly case_role?: "before" | "current";
};

export function BattleFeature(props: BattleFeatureProps): ReactElement {
  const battleProps = props as BattleFeaturePropsWithRules;
  const {
    scenarios,
    selected_scenario_id,
    snapshot,
    outcome,
    benchmark,
    restricted_diagnostics,
    onSelectScenario,
    onSimulate,
    onBenchmark,
    onBenchmarkScenarios,
  } = battleProps;
  const ruleset = battleProps.ruleset ?? null;
  const baselineScenarioId = battleProps.baseline_scenario_id ?? null;
  const baselineSnapshot = baselineScenarioId === selected_scenario_id
    ? battleProps.baseline_snapshot ?? null
    : null;

  const selectedScenario = scenarios.find((scenario) => scenario.id === selected_scenario_id) ?? null;
  const campaignScenarios = scenarios as readonly CampaignScenario[];
  const campaignGroups = useMemo(() => groupScenariosByCampaign(campaignScenarios), [campaignScenarios]);
  const [lastCompletedRun, setLastCompletedRun] = useState<{ readonly scenario_id: string | null; readonly snapshot: SimulationSnapshot } | null>(null);
  const [localBaseline, setLocalBaseline] = useState<{ readonly scenario_id: string; readonly snapshot: SimulationSnapshot } | null>(null);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
  const [frameIndex, setFrameIndex] = useState(0);
  const [beforeCaseId, setBeforeCaseId] = useState("");
  const [afterCaseId, setAfterCaseId] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const snapshotToRun = snapshot;
  const replay = outcome?.presentation_replay ?? null;
  const frames = replay?.frames ?? [];
  const selectedFrame = frames.length > 0
    ? frames[Math.min(frameIndex, frames.length - 1)]
    : null;
  const lanes = useMemo(() => discoverLanes(ruleset), [ruleset]);
  const caseIds = benchmark?.cases.map((item) => item.case_id) ?? [];
  const comparableCases = (benchmark?.cases ?? []) as readonly ComparableBenchmarkCase[];
  const beforeCurrentSnapshot = baselineSnapshot ?? (
    selected_scenario_id && localBaseline?.scenario_id === selected_scenario_id
      ? localBaseline.snapshot
      : null
  );

  useEffect(() => {
    setFrameIndex(0);
    setIsPlaying(false);
  }, [replay]);

  useEffect(() => {
    if (!isPlaying || frames.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        if (current >= frames.length - 1) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, PLAYBACK_INTERVAL_MS / playbackRate);
    return () => window.clearInterval(timer);
  }, [frames.length, isPlaying, playbackRate]);

  useEffect(() => {
    if (caseIds.length === 0) {
      setBeforeCaseId("");
      setAfterCaseId("");
      return;
    }
    const beforeRole = comparableCases.find((item) => item.case_role === "before");
    const currentRole = comparableCases.find((item) => item.case_role === "current");
    setBeforeCaseId(beforeRole?.case_id ?? caseIds[0]);
    setAfterCaseId(currentRole?.case_id ?? caseIds[caseIds.length - 1]);
    // A new benchmark result replaces the choices; case IDs are stable within it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseIds.join("\u0000")]);

  const handleScenarioSelect = (scenarioId: string) => {
    onSelectScenario(scenarioId);
    setErrorMessage(null);
  };

  const runSimulation = async () => {
    if (!snapshotToRun) return;
    setErrorMessage(null);
    setIsSimulating(true);
    try {
      await onSimulate(snapshotToRun, { include_diagnostics: includeDiagnostics });
      if (
        selected_scenario_id &&
        lastCompletedRun?.scenario_id === selected_scenario_id &&
        lastCompletedRun.snapshot !== snapshotToRun
      ) {
        setLocalBaseline({ scenario_id: selected_scenario_id, snapshot: lastCompletedRun.snapshot });
      }
      setLastCompletedRun({ scenario_id: selected_scenario_id, snapshot: snapshotToRun });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Simulation could not be completed.");
    } finally {
      setIsSimulating(false);
    }
  };

  const runBenchmark = async () => {
    setErrorMessage(null);
    setIsBenchmarking(true);
    try {
      if (onBenchmarkScenarios) {
        await onBenchmarkScenarios(campaignScenarios.map((scenario) => scenario.id));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Scenario comparison could not be completed.");
    } finally {
      setIsBenchmarking(false);
    }
  };

  const runBeforeCurrentComparison = async () => {
    if (!beforeCurrentSnapshot || !snapshotToRun || beforeCurrentSnapshot === snapshotToRun) return;
    const cases = [
      { case_id: "before", case_role: "before", snapshot: beforeCurrentSnapshot },
      { case_id: "current", case_role: "current", snapshot: snapshotToRun },
    ] as unknown as readonly BenchmarkCase[];
    setErrorMessage(null);
    setIsBenchmarking(true);
    try {
      await onBenchmark(cases);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Before/current comparison could not be completed.");
    } finally {
      setIsBenchmarking(false);
    }
  };

  const seekTick = (tick: number) => {
    if (frames.length === 0) return;
    const closestFrameIndex = frames.reduce((bestIndex, frame, index) => {
      const bestDistance = Math.abs(frames[bestIndex].tick - tick);
      const distance = Math.abs(frame.tick - tick);
      return distance < bestDistance ? index : bestIndex;
    }, 0);
    setFrameIndex(closestFrameIndex);
  };

  return (
    <section className="battle-feature" aria-label="Battle and replay analysis">
      <header className="battle-header">
        <div>
          <div className="battle-eyebrow">ENBU · LOCAL BATTLE LAB</div>
          <h2>Replay <em>analysis</em></h2>
          <p>Run a campaign scenario, inspect the public battle replay, then compare outcomes.</p>
        </div>
        <div className="battle-header-mark" aria-hidden="true">戦</div>
      </header>

      {errorMessage && (
        <div className="battle-error" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage(null)} aria-label="Dismiss error">×</button>
        </div>
      )}

      <div className="battle-workbench">
        <aside className="battle-setup battle-panel">
          <div className="battle-panel-heading">
            <div>
              <span className="battle-eyebrow">01 · CHOOSE A CHALLENGE</span>
              <h3>Campaign scenarios</h3>
            </div>
            <span className="battle-count">{String(scenarios.length).padStart(2, "0")}</span>
          </div>

          {scenarios.length > 0 ? (
            <div className="scenario-list" role="list" aria-label="Available scenarios">
              {campaignGroups.map((group) => (
                <div className="campaign-group" key={group.id}>
                  <div className="campaign-group-heading">
                    <span className="campaign-icon" aria-hidden="true">▧</span>
                    <div><strong>{group.title}</strong><small>{group.scenarios.length} SCENARIO{group.scenarios.length === 1 ? "" : "S"}</small></div>
                  </div>
                  {group.scenarios.map((scenario, index) => (
                    <ScenarioCard
                      key={scenario.id}
                      scenario={scenario}
                      index={scenario.order ?? index + 1}
                      selected={scenario.id === selected_scenario_id}
                      onSelect={() => handleScenarioSelect(scenario.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="battle-empty battle-empty-compact">
              <span className="battle-empty-icon" aria-hidden="true">◇</span>
              <p>No NPC scenarios are available yet.</p>
            </div>
          )}

          {selectedScenario && (
            <div className="scenario-brief">
              <div className="battle-eyebrow">SCENARIO BRIEF</div>
              <h4>{selectedScenario.title}</h4>
              <div className="scenario-campaign-line">{(selectedScenario as CampaignScenario).campaign_title ?? "NPC Campaign"}</div>
              {(selectedScenario as CampaignScenario).difficulty && (
                <span className={`difficulty-chip difficulty-${(selectedScenario as CampaignScenario).difficulty}`}>
                  {humanize((selectedScenario as CampaignScenario).difficulty!)}
                </span>
              )}
              <p className="scenario-objective"><strong>Objective</strong>{(selectedScenario as CampaignScenario).objective || selectedScenario.description || "No objective was provided."}</p>
              <p className="scenario-description">{selectedScenario.description || "No scenario brief was provided."}</p>
              {(selectedScenario as CampaignScenario).criteria && (selectedScenario as CampaignScenario).criteria!.length > 0 && (
                <div className="scenario-criteria">
                  <span>CHALLENGE CRITERIA</span>
                  <ul>{(selectedScenario as CampaignScenario).criteria!.map((criterion) => <li key={criterion.id}>{criterion.label}</li>)}</ul>
                </div>
              )}
              <div className="scenario-meta">
                <span>SCENARIO ID</span>
                <code>{selectedScenario.id}</code>
              </div>
            </div>
          )}

          <div className="battle-run-box">
            <label className="diagnostics-switch">
              <input
                checked={includeDiagnostics}
                onChange={(event) => setIncludeDiagnostics(event.target.checked)}
                type="checkbox"
              />
              <span className="switch-track" aria-hidden="true"><span /></span>
              <span>
                <strong>Include tactical diagnostics</strong>
                <small>Local-only conditions, intents and CU trace</small>
              </span>
            </label>
            <button
              className="battle-primary-button"
              disabled={!snapshotToRun || isSimulating}
              onClick={() => void runSimulation()}
              type="button"
            >
              <span aria-hidden="true">{isSimulating ? "◌" : "▶"}</span>
              {isSimulating ? "Running simulation" : "Run simulation"}
            </button>
            <p className="battle-run-note">The Enbu result is authoritative. Replay controls only affect presentation.</p>
          </div>
        </aside>

        <div className="battle-main-column">
          <ResultStrip outcome={outcome} />

          <section className="replay-panel battle-panel" aria-label="Battle replay">
            <div className="battle-panel-heading replay-heading">
              <div>
                <span className="battle-eyebrow">02 · PUBLIC PRESENTATION REPLAY</span>
                <h3>Three-lane battlefield</h3>
              </div>
              {selectedFrame && <span className="tick-pill">TICK {selectedFrame.tick}</span>}
            </div>

            {replay && frames.length > 0 ? (
              <>
                <div className="replay-controls">
                  <div className="replay-button-group">
                    <button
                      className="replay-play-button"
                      type="button"
                      disabled={frames.length < 2}
                      onClick={() => {
                        if (frameIndex >= frames.length - 1) setFrameIndex(0);
                        setIsPlaying((playing) => !playing);
                      }}
                      aria-label={isPlaying ? "Pause replay" : "Play replay"}
                    >
                      {isPlaying ? "Ⅱ" : "▶"}
                    </button>
                    <button
                      className="replay-step-button"
                      type="button"
                      disabled={frameIndex === 0}
                      onClick={() => { setIsPlaying(false); setFrameIndex((index) => Math.max(0, index - 1)); }}
                      aria-label="Previous replay frame"
                    >←</button>
                    <button
                      className="replay-step-button"
                      type="button"
                      disabled={frameIndex >= frames.length - 1}
                      onClick={() => { setIsPlaying(false); setFrameIndex((index) => Math.min(frames.length - 1, index + 1)); }}
                      aria-label="Next replay frame"
                    >→</button>
                  </div>
                  <label className="replay-speed">
                    <span>SPEED</span>
                    <select
                      aria-label="Replay speed"
                      value={playbackRate}
                      onChange={(event) => setPlaybackRate(Number(event.target.value) as PlaybackRate)}
                    >
                      {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
                    </select>
                  </label>
                  <span className="replay-position">FRAME {frameIndex + 1} / {frames.length}</span>
                </div>

                <div className="tick-seek">
                  <input
                    aria-label="Seek to replay tick"
                    type="range"
                    min={frames[0].tick}
                    max={frames[frames.length - 1].tick}
                    step={1}
                    value={selectedFrame?.tick ?? frames[0].tick}
                    onChange={(event) => { setIsPlaying(false); seekTick(Number(event.target.value)); }}
                    disabled={frames[0].tick === frames[frames.length - 1].tick}
                  />
                  <div className="tick-range-labels"><span>Tick {frames[0].tick}</span><span>Tick {frames[frames.length - 1].tick}</span></div>
                </div>

                <BattlefieldView
                  frame={selectedFrame}
                  lanes={lanes}
                  ruleset={ruleset}
                />
                <PublicEventLog frame={selectedFrame} />
              </>
            ) : (
              <div className="battle-empty replay-empty">
                <span className="battle-empty-icon" aria-hidden="true">⌁</span>
                <p>{outcome ? "This replay contains no presentation frames." : "Run a scenario to inspect its battle replay."}</p>
                <small>Only Enbu-provided events and visible state appear here.</small>
              </div>
            )}
          </section>

          <DiagnosticsPanel
            diagnostics={restricted_diagnostics}
            selectedFrame={selectedFrame}
            frames={frames}
            result={outcome?.result ?? null}
            ruleset={ruleset}
          />

          <BenchmarkPanel
            scenarios={scenarios}
            isRunning={isBenchmarking}
            beforeCaseId={beforeCaseId}
            afterCaseId={afterCaseId}
            baselineAvailable={Boolean(beforeCurrentSnapshot)}
            currentSnapshotAvailable={Boolean(snapshotToRun)}
            comparableCases={comparableCases}
            scenarioBenchmarkReady={Boolean(onBenchmarkScenarios)}
            onBeforeCaseChange={setBeforeCaseId}
            onAfterCaseChange={setAfterCaseId}
            onRun={() => void runBenchmark()}
            onRunBeforeCurrent={() => void runBeforeCurrentComparison()}
          />
        </div>
      </div>
    </section>
  );
}

function ScenarioCard({
  scenario,
  index,
  selected,
  onSelect,
}: {
  readonly scenario: CampaignScenario;
  readonly index: number;
  readonly selected: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      className={`scenario-card${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
      type="button"
    >
      <span className="scenario-index">{String(index).padStart(2, "0")}</span>
      <span className="scenario-card-copy">
        <strong>{scenario.title}</strong>
        <small>{scenario.description || "Open scenario briefing"}</small>
      </span>
      {scenario.difficulty && <span className={`scenario-difficulty difficulty-${scenario.difficulty}`}>{humanize(scenario.difficulty)}</span>}
      <span className="scenario-arrow" aria-hidden="true">↗</span>
    </button>
  );
}

function groupScenariosByCampaign(scenarios: readonly CampaignScenario[]): readonly ScenarioGroup[] {
  const groups = new Map<string, { title: string; scenarios: CampaignScenario[] }>();
  scenarios.forEach((scenario, index) => {
    const id = scenario.campaign_id ?? "npc-campaign";
    const group = groups.get(id) ?? {
      title: scenario.campaign_title ?? "NPC Campaign",
      scenarios: [],
    };
    group.scenarios.push({ ...scenario, order: scenario.order ?? index + 1 });
    groups.set(id, group);
  });
  return Array.from(groups.entries()).map(([id, group]) => ({
    id,
    title: group.title,
    scenarios: [...group.scenarios].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
  }));
}

function ResultStrip({ outcome }: { readonly outcome: SimulationOutcome | null }): ReactElement {
  if (!outcome) {
    return (
      <div className="result-strip result-strip-empty">
        <span className="result-icon" aria-hidden="true">◌</span>
        <div><strong>No battle result</strong><span>Choose a challenge and run your strategy to create a replay.</span></div>
      </div>
    );
  }

  const { result } = outcome;
  return (
    <div className={`result-strip result-${result.outcome}`}>
      <span className="result-icon" aria-hidden="true">{outcomeMark(result.outcome)}</span>
      <div className="result-main">
        <span className="battle-eyebrow">ENBU MATCH RESULT</span>
        <strong>{humanize(result.outcome)}</strong>
        <span>{humanize(result.termination_reason)}</span>
      </div>
      <div className="result-metrics">
        <Metric label="FINAL TICK" value={String(result.final_tick)} />
        <Metric label="ATTACKER CU" value={formatNumber(result.cu_spent.attacker)} />
        <Metric label="DEFENDER CU" value={formatNumber(result.cu_spent.defender)} />
      </div>
      {Object.keys(result.statistics).length > 0 && (
        <details className="result-statistics">
          <summary>Result stats</summary>
          <ValueGrid values={result.statistics} />
        </details>
      )}
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return <div className="result-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function BattlefieldView({
  frame,
  lanes,
  ruleset,
}: {
  readonly frame: ReplayFrame | null;
  readonly lanes: readonly LaneDescriptor[];
  readonly ruleset: RulePackage | null;
}): ReactElement {
  const visibleState = frame?.visible_state ?? null;
  if (!frame || !visibleState) {
    return (
      <div className="battlefield-empty-state">
        <div className="battlefield-empty-grid" aria-hidden="true">{lanes.map((lane) => <span key={lane.id} />)}</div>
        <p>{frame ? "No visible state was recorded for this tick." : "No tick selected."}</p>
      </div>
    );
  }

  const entries = Object.entries(visibleState.entities);
  const laneBuckets = lanes.map((lane) => ({
    lane,
    entities: entries.filter(([, entity]) => getEntityLane(entity, ruleset) === lane.id),
  }));
  const unassigned = entries.filter(([, entity]) => !laneBuckets.some(({ lane }) => getEntityLane(entity, ruleset) === lane.id));

  return (
    <div className="battlefield-wrap">
      <div className="battlefield-meta">
        <span>VISIBLE AT TICK {frame.tick}</span>
        <span>{entries.length} ENTIT{entries.length === 1 ? "Y" : "IES"}</span>
      </div>
      <div className="battlefield-grid">
        {laneBuckets.map(({ lane, entities }, index) => (
          <section className={`lane-column lane-column-${index + 1}`} key={lane.id} aria-label={`${lane.label} lane`}>
            <div className="lane-heading">
              <div><span className="lane-number">0{index + 1}</span><h4>{lane.label}</h4></div>
              <span className="lane-entity-count">{entities.length}</span>
            </div>
            <div className="lane-track" aria-hidden="true"><span /><span /><span /></div>
            {entities.length > 0 ? (
              <div className="lane-entities">
                {entities.map(([id, entity]) => (
                  <EntityCard key={id} id={id} entity={entity} />
                ))}
              </div>
            ) : (
              <div className="lane-vacant">No visible entities</div>
            )}
          </section>
        ))}
      </div>

      {Object.keys(visibleState.global_fields).length > 0 && (
        <div className="world-globals">
          <span className="battle-eyebrow">GLOBAL STATE</span>
          <ValueGrid values={visibleState.global_fields} />
        </div>
      )}

      {unassigned.length > 0 && (
        <section className="unassigned-entities">
          <div className="battle-eyebrow">OTHER VISIBLE ENTITIES · NOT ASSIGNED TO A LANE</div>
          <div className="unassigned-grid">
            {unassigned.map(([id, entity]) => <EntityCard key={id} id={id} entity={entity} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function EntityCard({
  id,
  entity,
}: {
  readonly id: string;
  readonly entity: EntityStateView;
}): ReactElement {
  const category = categoryForEntity(entity.entity_type);
  return (
    <article className={`entity-card entity-${category.toLowerCase()}`}>
      <div className="entity-card-heading">
        <span className={`entity-kind kind-${category.toLowerCase()}`}>{category}</span>
        <span className={`entity-owner owner-${entity.owner ?? "neutral"}`}>{entity.owner ? humanize(entity.owner) : "Neutral"}</span>
      </div>
      <strong className="entity-type">{humanize(entity.entity_type)}</strong>
      <span className="entity-id">{id}</span>
      <ValueGrid values={entity.fields} />
    </article>
  );
}

function ValueGrid({ values }: { readonly values: Readonly<Record<string, DomainValue>> }): ReactElement {
  const entries = Object.entries(values);
  if (entries.length === 0) return <span className="no-entity-fields">No visible fields</span>;
  return (
    <dl className="value-grid">
      {entries.map(([name, value]) => (
        <div className="value-pair" key={name}>
          <dt>{humanize(name)}</dt>
          <dd title={formatDomainValue(value)}>{formatDomainValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PublicEventLog({ frame }: { readonly frame: ReplayFrame | null }): ReactElement {
  if (!frame) return <></>;
  return (
    <section className="event-log">
      <div className="event-log-heading">
        <div><span className="battle-eyebrow">PUBLIC REPLAY EVENTS</span><h4>Tick {frame.tick} activity</h4></div>
        <span className="battle-count">{String(frame.events.length).padStart(2, "0")}</span>
      </div>
      {frame.events.length > 0 ? (
        <ol className="event-list">
          {frame.events.map((event, index) => (
            <li className="event-row" key={`${event.event}-${event.entity ?? "world"}-${index}`}>
              <span className="event-sequence">{String(index + 1).padStart(2, "0")}</span>
              <div className="event-copy">
                <strong>{humanize(event.event)}</strong>
                <span>{event.entity ? `Entity ${event.entity}` : "World event"}</span>
                {Object.keys(event.payload).length > 0 && <ValueGrid values={event.payload} />}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="event-log-empty">No public presentation events were recorded for this tick.</p>
      )}
    </section>
  );
}

function DiagnosticsPanel({
  diagnostics,
  selectedFrame,
  frames,
  result,
  ruleset,
}: {
  readonly diagnostics: RestrictedDiagnostics | null;
  readonly selectedFrame: ReplayFrame | null;
  readonly frames: readonly ReplayFrame[];
  readonly result: SimulationOutcome["result"] | null;
  readonly ruleset: RulePackage | null;
}): ReactElement {
  if (!diagnostics) {
    return (
      <section className="diagnostics-panel battle-panel">
        <div className="battle-panel-heading">
          <div><span className="battle-eyebrow">03 · LOCAL DEBUGGER</span><h3>Tactics &amp; CU trace</h3></div>
          <span className="private-badge">PRIVATE</span>
        </div>
        <div className="diagnostics-empty">
          <span aria-hidden="true">⌘</span>
          <div><strong>Private diagnostics are not attached</strong><p>Enable tactical diagnostics before running to inspect truth values, intent decisions, and logical CU.</p></div>
        </div>
      </section>
    );
  }

  const tick = selectedFrame?.tick;
  const tickEvents = diagnostics.events.filter((event) => tick === undefined || event.tick === tick);
  const cuRows = buildCuRows(diagnostics.events, frames, ruleset);
  const tickCuRows = cuRows.filter((row) => tick === undefined || row.tick === tick);

  return (
    <section className="diagnostics-panel battle-panel">
      <div className="battle-panel-heading">
        <div><span className="battle-eyebrow">03 · LOCAL DEBUGGER</span><h3>Tactics &amp; CU trace</h3></div>
        <span className="private-badge"><span /> PRIVATE · LOCAL</span>
      </div>

      <div className="diagnostics-totals">
        {(["attacker", "defender"] as const).map((side) => (
          <div className="diagnostic-total" key={side}>
            <span>{humanize(side)} CU</span>
            <strong>{formatNumber(diagnostics.cu_by_side[side] ?? result?.cu_spent[side] ?? 0)}</strong>
          </div>
        ))}
        <div className="diagnostic-total diagnostic-scope">
          <span>TRACE SCOPE</span>
          <strong>{tick === undefined ? "All ticks" : `Tick ${tick}`}</strong>
        </div>
      </div>

      <div className="trace-attribution-note">
        CU uses core-reported tick and side. Lane resolves from a correlated entity in that tick's public visible state; tactic shows the correlated action ID. Missing correlations stay marked unknown.
      </div>

      <div className="diagnostic-columns">
        <section className="diagnostic-column">
          <div className="diagnostic-column-heading"><h4>Conditions &amp; intents</h4><span>{tickEvents.length}</span></div>
          {tickEvents.length > 0 ? (
            <ol className="diagnostic-event-list">
              {tickEvents.map((event) => <DiagnosticRow key={`${event.tick}-${event.side}-${event.sequence}`} event={event} />)}
            </ol>
          ) : (
            <p className="diagnostic-no-events">No diagnostic records for this tick.</p>
          )}
        </section>

        <section className="diagnostic-column">
              <div className="diagnostic-column-heading"><h4>Logical CU profiler</h4><span>{tickCuRows.length}</span></div>
          {tickCuRows.length > 0 ? (
            <div className="cu-table-wrap">
              <table className="cu-table">
                <thead><tr><th>Tick</th><th>Side</th><th>Lane</th><th>Tactic</th><th>Operation</th><th>CU</th></tr></thead>
                <tbody>
                  {tickCuRows.map((row, index) => (
                    <tr key={`${row.tick}-${row.side}-${row.operation}-${index}`}>
                      <td>{row.tick}</td>
                      <td>{humanize(row.side)}</td>
                      <td>{row.lane ? humanize(row.lane) : "Unknown"}</td>
                      <td title={row.entity_id ?? undefined}>{row.action_id ? humanize(row.action_id) : "Unknown"}</td>
                      <td>{humanize(row.operation)}</td>
                      <td>{formatNumber(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="diagnostic-no-events">No per-operation CU records for this tick.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function DiagnosticRow({ event }: { readonly event: DiagnosticEvent }): ReactElement {
  const { record } = event;
  const links = event as DiagnosticEventWithLinks;
  if (record.kind === "state_evaluated") {
    return (
      <li className="diagnostic-row">
        <span className={`truth-chip truth-${record.value.result}`}>{record.value.result}</span>
        <div><strong>{record.value.state}</strong><small>{humanize(event.side)} · tick {event.tick}{links.action_id ? ` · ${links.action_id}` : ""}</small></div>
      </li>
    );
  }
  if (record.kind === "intent_proposed" || record.kind === "intent_accepted" || record.kind === "intent_rejected") {
    const status = record.kind === "intent_accepted" ? "accepted" : record.kind === "intent_rejected" ? "rejected" : "proposed";
    return (
      <li className="diagnostic-row">
        <span className={`intent-status status-${status}`}>{status}</span>
        <div>
          <strong>{record.value.intent.action_id || humanize(record.value.intent.capability)}</strong>
          <small>{record.value.intent.capability} · {humanize(event.side)} · tick {event.tick}{record.value.intent.actor ? ` · actor ${record.value.intent.actor}` : ""}{record.value.intent.target ? ` · target ${record.value.intent.target}` : ""}</small>
          {record.kind === "intent_rejected" && <em>Reason: {humanize(record.value.reason)}</em>}
        </div>
      </li>
    );
  }
  if (record.kind === "cost_charged") {
    return <li className="diagnostic-row diagnostic-cost"><span className="intent-status status-cost">CU</span><div><strong>{humanize(record.value.operation)}</strong><small>{humanize(event.side)} · tick {event.tick} · {formatNumber(record.value.amount)}{links.action_id ? ` · ${links.action_id}` : ""}{links.entity_id ? ` · ${links.entity_id}` : ""}</small></div></li>;
  }
  if (record.kind === "runtime_notice") {
    return <li className="diagnostic-row"><span className="intent-status status-notice">NOTE</span><div><strong>{record.value.code}</strong><small>{humanize(event.side)} · tick {event.tick}</small></div></li>;
  }
  if (record.kind === "memory_read" || record.kind === "memory_written") {
    const value = record.value;
    return <li className="diagnostic-row"><span className="intent-status status-memory">MEM</span><div><strong>{value.state}</strong><small>{humanize(record.kind)} · {humanize(event.side)} · tick {event.tick}</small></div></li>;
  }
  return <></>;
}

function BenchmarkPanel({
  scenarios,
  isRunning,
  beforeCaseId,
  afterCaseId,
  baselineAvailable,
  currentSnapshotAvailable,
  comparableCases,
  scenarioBenchmarkReady,
  onBeforeCaseChange,
  onAfterCaseChange,
  onRun,
  onRunBeforeCurrent,
}: {
  readonly scenarios: readonly LocalPveScenario[];
  readonly isRunning: boolean;
  readonly beforeCaseId: string;
  readonly afterCaseId: string;
  readonly baselineAvailable: boolean;
  readonly currentSnapshotAvailable: boolean;
  readonly comparableCases: readonly ComparableBenchmarkCase[];
  readonly scenarioBenchmarkReady: boolean;
  onBeforeCaseChange(caseId: string): void;
  onAfterCaseChange(caseId: string): void;
  onRun(): void;
  onRunBeforeCurrent(): void;
}): ReactElement {
  const cases = comparableCases;
  const before = cases.find((item) => item.case_id === beforeCaseId) ?? null;
  const after = cases.find((item) => item.case_id === afterCaseId) ?? null;
  const scenarioTitles = new Map(scenarios.map((scenario) => [scenario.id, scenario.title]));
  const hasTaggedPair = cases.some((item) => item.case_role === "before") && cases.some((item) => item.case_role === "current");
  const scenarioCount = (scenarios as readonly CampaignScenario[]).length;

  return (
    <section className="benchmark-panel battle-panel">
      <div className="battle-panel-heading">
        <div><span className="battle-eyebrow">04 · BENCHMARK &amp; REGRESSION</span><h3>Case comparison</h3></div>
        <div className="benchmark-actions">
          <button
            className="battle-secondary-button"
            type="button"
            disabled={scenarioCount === 0 || !scenarioBenchmarkReady || isRunning}
            onClick={onRun}
          >
            {isRunning ? "Comparing…" : "Compare NPCs"}
          </button>
          <button
            className="battle-secondary-button benchmark-before-current-button"
            type="button"
            disabled={!baselineAvailable || !currentSnapshotAvailable || isRunning}
            onClick={onRunBeforeCurrent}
          >
            Compare before / current
          </button>
        </div>
      </div>
      <p className="benchmark-intro">Run distinct NPC scenarios, or compare a saved baseline with the current snapshot under the same rules.</p>
      {!scenarioBenchmarkReady && scenarios.length > 0 && (
        <p className="benchmark-baseline-note">NPC benchmark inputs are being prepared by the workspace.</p>
      )}
      {!baselineAvailable && (
        <p className="benchmark-baseline-note">Run this scenario twice with an updated snapshot to establish a before/current baseline.</p>
      )}

      {cases.length > 0 ? (
        <>
          <div className="benchmark-case-list">
            {cases.map(({ case_id, outcome: caseOutcome }, index) => (
              <div className="benchmark-case" key={case_id}>
                <span className="benchmark-case-number">{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{scenarioTitles.get(case_id) ?? case_id}</strong><small>{case_id}</small></div>
                {cases[index].case_role && <span className={`benchmark-role role-${cases[index].case_role}`}>{cases[index].case_role === "before" ? "BEFORE" : "CURRENT"}</span>}
                <span className={`benchmark-outcome outcome-${caseOutcome.result.outcome}`}>{humanize(caseOutcome.result.outcome)}</span>
                <span className="benchmark-tick">T{caseOutcome.result.final_tick}</span>
              </div>
            ))}
          </div>

          {cases.length >= 2 && (
            <div className="before-after-compare">
              <div className="compare-selectors">
                <label><span>{hasTaggedPair ? "BEFORE SNAPSHOT" : "CASE A · REFERENCE"}</span><select value={beforeCaseId} onChange={(event) => onBeforeCaseChange(event.target.value)}>{cases.map((item) => <option key={item.case_id} value={item.case_id}>{item.case_role === "before" ? "Before · " : item.case_role === "current" ? "Current · " : ""}{scenarioTitles.get(item.case_id) ?? item.case_id}</option>)}</select></label>
                <span className="compare-arrow" aria-hidden="true">→</span>
                <label><span>{hasTaggedPair ? "CURRENT SNAPSHOT" : "CASE B · COMPARISON"}</span><select value={afterCaseId} onChange={(event) => onAfterCaseChange(event.target.value)}>{cases.map((item) => <option key={item.case_id} value={item.case_id}>{item.case_role === "before" ? "Before · " : item.case_role === "current" ? "Current · " : ""}{scenarioTitles.get(item.case_id) ?? item.case_id}</option>)}</select></label>
              </div>
              {before && after && <CompareSummary before={before.outcome} after={after.outcome} roleAware={hasTaggedPair} />}
            </div>
          )}
        </>
      ) : (
        <div className="benchmark-empty">
          <span aria-hidden="true">⊞</span>
          <p>Scenario results will appear here in input order. No wall-clock timing is treated as game data.</p>
        </div>
      )}
    </section>
  );
}

function CompareSummary({
  before,
  after,
  roleAware,
}: {
  readonly before: SimulationOutcome;
  readonly after: SimulationOutcome;
  readonly roleAware: boolean;
}): ReactElement {
  const beforeResult = before.result;
  const afterResult = after.result;
  const statisticIds = Array.from(new Set([
    ...Object.keys(beforeResult.statistics),
    ...Object.keys(afterResult.statistics),
  ])).sort();
  return (
    <div className="compare-summary">
      <div className="compare-metric"><span>{roleAware ? "BEFORE → CURRENT RESULT" : "CASE A → CASE B RESULT"}</span><strong>{humanize(beforeResult.outcome)} <i>→</i> {humanize(afterResult.outcome)}</strong></div>
      <div className="compare-metric"><span>FINAL TICK</span><strong>{beforeResult.final_tick} <i>→</i> {afterResult.final_tick} <em>{formatDelta(afterResult.final_tick - beforeResult.final_tick)}</em></strong></div>
      {(["attacker", "defender"] as const).map((side) => (
        <div className="compare-metric" key={side}>
          <span>{humanize(side)} CU</span>
          <strong>{formatNumber(beforeResult.cu_spent[side])} <i>→</i> {formatNumber(afterResult.cu_spent[side])} <em>{formatDelta(afterResult.cu_spent[side] - beforeResult.cu_spent[side])}</em></strong>
        </div>
      ))}
      <div className="compare-metric compare-reason"><span>TERMINATION</span><strong>{humanize(beforeResult.termination_reason)} <i>→</i> {humanize(afterResult.termination_reason)}</strong></div>
      {statisticIds.map((id) => {
        const beforeValue = beforeResult.statistics[id];
        const afterValue = afterResult.statistics[id];
        const beforeNumber = beforeValue ? numericDomainValue(beforeValue) : null;
        const afterNumber = afterValue ? numericDomainValue(afterValue) : null;
        const delta = beforeNumber !== null && afterNumber !== null ? formatDelta(afterNumber - beforeNumber) : null;
        return (
          <div className="compare-metric" key={id}>
            <span>{humanize(id)}</span>
            <strong>
              {beforeValue ? formatDomainValue(beforeValue) : "—"} <i>→</i> {afterValue ? formatDomainValue(afterValue) : "—"}
              {delta && <em>{delta}</em>}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

function discoverLanes(ruleset: RulePackage | null): readonly LaneDescriptor[] {
  const laneDomain = findLaneDomain(ruleset);
  if (ruleset && laneDomain) {
    const values = ruleset.domain.symbol_domains[laneDomain.id] ?? laneDomain.values;
    if (values.length >= 3) {
      return values.slice(0, 3).map((id) => ({ id, label: humanize(id) }));
    }
  }
  return [1, 2, 3].map((number) => ({ id: `lane-${number}`, label: `Lane ${number}` }));
}

function findLaneDomain(ruleset: RulePackage | null): { readonly id: string; readonly values: readonly string[] } | null {
  if (!ruleset) return null;
  const domainEntry = Object.entries(ruleset.domain.symbol_domains).find(([id]) => normalizeId(id) === "lane");
  if (domainEntry) return { id: domainEntry[0], values: domainEntry[1] };

  for (const [typeId, entityType] of Object.entries(ruleset.world.entity_types)) {
    if (!normalizeId(typeId).includes("unit") && !normalizeId(typeId).includes("tower") && !normalizeId(typeId).includes("core")) continue;
    for (const [fieldId, schema] of Object.entries(entityType.fields)) {
      if (normalizeId(fieldId) !== "lane") continue;
      if (schema.value_type.kind === "enum") {
        return { id: schema.value_type.value.domain, values: schema.value_type.value.values };
      }
    }
  }
  return null;
}

function getEntityLane(entity: EntityStateView, ruleset: RulePackage | null): string | null {
  if (!ruleset) return null;
  const entitySchema = ruleset.world.entity_types[entity.entity_type];
  if (!entitySchema) return null;
  const laneDomain = findLaneDomain(ruleset)?.id;
  if (!laneDomain) return null;
  for (const [fieldId, fieldValue] of Object.entries(entity.fields)) {
    const fieldSchema = entitySchema.fields[fieldId];
    if (!fieldSchema || fieldSchema.value_type.kind !== "enum") continue;
    if (fieldSchema.value_type.value.domain !== laneDomain || fieldValue.kind !== "enum") continue;
    return fieldValue.value;
  }
  return null;
}

function categoryForEntity(entityType: string): "Unit" | "Tower" | "Base" | "Entity" {
  const normalized = normalizeId(entityType);
  if (normalized.includes("tower")) return "Tower";
  if (normalized.includes("core") || normalized.includes("base") || normalized.includes("headquarters")) return "Base";
  if (normalized.includes("unit") || normalized.includes("troop")) return "Unit";
  return "Entity";
}

function buildCuRows(
  events: readonly DiagnosticEvent[],
  frames: readonly ReplayFrame[],
  ruleset: RulePackage | null,
): readonly CuRow[] {
  return events.flatMap((event) => {
    if (event.record.kind !== "cost_charged") return [];
    const links = event as DiagnosticEventWithLinks;
    const entity = links.entity_id
      ? frames.find((frame) => frame.tick === event.tick)?.visible_state?.entities[links.entity_id]
      : undefined;
    return [{
      tick: event.tick,
      side: event.side,
      action_id: links.action_id ?? null,
      entity_id: links.entity_id ?? null,
      lane: entity ? getEntityLane(entity, ruleset) : null,
      operation: event.record.value.operation,
      amount: event.record.value.amount,
    }];
  });
}

function formatDomainValue(value: DomainValue): string {
  switch (value.kind) {
    case "null": return "null";
    case "bool": return value.value ? "true" : "false";
    case "integer": return formatNumber(value.value);
    case "fixed": return String(value.value.coefficient / (10 ** value.value.scale));
    case "string": return value.value;
    case "enum": return humanize(value.value);
    case "entity": return value.value;
    case "list": return `[${value.value.map(formatDomainValue).join(", ")}]`;
    case "record": return `{${Object.entries(value.value).map(([key, item]) => `${humanize(key)}: ${formatDomainValue(item)}`).join(", ")}}`;
  }
}

function numericDomainValue(value: DomainValue): number | null {
  if (value.kind === "integer") return value.value;
  if (value.kind === "fixed") return value.value.coefficient / (10 ** value.value.scale);
  return null;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value) : "—";
}

function formatDelta(value: number): string {
  if (value === 0) return "±0";
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function outcomeMark(value: string): string {
  if (value === "attacker_victory") return "↑";
  if (value === "defender_victory") return "↓";
  if (value === "draw") return "=";
  return "·";
}
