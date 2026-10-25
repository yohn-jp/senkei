import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { Replay, Event as GraphicsEvent } from "@senkei/replay-contract";
import { NEXT_WORLD_UNITS_PER_RENDER_UNIT } from "@senkei/replay-contract";
import type {
  SimulationResponse,
  SimulationSnapshot,
} from "../../contracts";
import type {
  DomainValue,
  PresentationReplay,
  RestrictedDiagnostics,
} from "../../contracts";
import "./battle-analysis.css";

export interface BattleAnalysisRun {
  readonly snapshot: SimulationSnapshot;
  readonly response: SimulationResponse;
  readonly sourceReplay: PresentationReplay;
  readonly graphicsReplay: Replay;
}

export type BattleAnalysisEditTarget = "collection" | "skills" | "squads" | "jinrei";

export interface BattleAnalysisProps {
  readonly run: BattleAnalysisRun | null;
  readonly baselineRun: BattleAnalysisRun | null;
  /** True when the editable Draft no longer represents the latest completed Run. */
  readonly draftChanged: boolean;
  readonly busy: boolean;
  readonly onReplayEvent: (event: GraphicsEvent) => void;
  readonly onReplayTick: (tick: number) => void;
  readonly onBattle: () => void;
  readonly onEdit: (target: BattleAnalysisEditTarget) => void;
  /** Reopens Ready with the immutable, validated snapshot used for this Run. */
  readonly onExactRematch: () => void;
  /** Reopens Ready with the current editable Draft and sends it through current validation. */
  readonly onRevisedRematch: () => void;
}

interface RunHero {
  readonly slot: string;
  readonly catalogId: string;
  readonly squad: string;
  readonly node: string;
  readonly skillPath: string;
}

interface EntityAttribution {
  readonly slot: RunHero;
  readonly tick: number;
}

interface TimelineRow {
  readonly event: GraphicsEvent;
  readonly index: number;
  readonly summary: string;
  readonly actor: string | null;
  readonly target: string | null;
}

const EVENT_PAGE_SIZE = 24;
const EMPTY_EVENTS: readonly GraphicsEvent[] = [];

function scalar(value: DomainValue | undefined): string | null {
  if (!value) return null;
  if (value.kind === "string" || value.kind === "enum" || value.kind === "entity") return value.value;
  if (value.kind === "integer" || value.kind === "bool") return String(value.value);
  return null;
}

function runHeroes(run: BattleAnalysisRun): RunHero[] {
  const value = run.snapshot.attacker.configuration.heroes;
  if (value?.kind !== "list") return [];
  return value.value.flatMap((entry) => {
    if (entry.kind !== "record") return [];
    const fields = entry.value;
    const slot = scalar(fields.slot_id);
    const catalogId = scalar(fields.catalog_id);
    const squad = scalar(fields.squad);
    const node = scalar(fields.node);
    const skillPath = scalar(fields.skill_path);
    if (!slot || !catalogId || !squad || !node || !skillPath) return [];
    return [{ slot, catalogId, squad, node, skillPath }];
  });
}

function numberValue(value: DomainValue | undefined): number | null {
  if (!value) return null;
  if (value.kind === "integer") return value.value;
  if (value.kind === "fixed") return value.value.coefficient / (10 ** value.value.scale);
  return null;
}

/**
 * Link Graphics IDs to the run's own Hero slots only where the real owner view,
 * catalog, squad, position and entity side form a unique match. Public enemy
 * observations can never grant private owner attribution.
 */
function attributeOwnHeroes(run: BattleAnalysisRun): Map<string, EntityAttribution> {
  const roster = new Map(runHeroes(run).map((hero) => [hero.slot, hero]));
  const attributed = new Map<string, EntityAttribution>();
  const graphicsEntities = new Map<string, { catalogId: string | null; side: string; archetype: string; x: number; y: number }>();
  for (const entity of run.graphicsReplay.initialView) {
    graphicsEntities.set(entity.id, { catalogId: entity.catalogId ?? null, side: entity.side, archetype: entity.archetype, x: entity.position.x, y: entity.position.y });
  }
  let eventIndex = 0;
  for (const frame of run.sourceReplay.frames) {
    while (eventIndex < run.graphicsReplay.timeline.length && run.graphicsReplay.timeline[eventIndex].tick <= frame.tick) {
      const event = run.graphicsReplay.timeline[eventIndex++];
      if (event.type === "spawn") {
        graphicsEntities.set(event.entity.id, { catalogId: event.entity.catalogId ?? null, side: event.entity.side, archetype: event.entity.archetype, x: event.entity.position.x, y: event.entity.position.y });
      } else if (event.type === "disappear" || event.type === "destroy") {
        graphicsEntities.delete(event.entityId);
      } else if (event.type === "move") {
        const prior = graphicsEntities.get(event.entityId);
        if (prior) graphicsEntities.set(event.entityId, { ...prior, x: event.position.x, y: event.position.y });
      }
    }
    for (const entity of Object.values(frame.visible_state?.entities ?? {})) {
      if (entity.owner !== "attacker" || entity.entity_type !== "hero") continue;
      const slotId = scalar(entity.fields.slot_id);
      const squad = scalar(entity.fields.squad);
      const catalogId = scalar(entity.fields.catalog_id);
      const x = numberValue(entity.fields.x);
      const y = numberValue(entity.fields.y);
      if (!slotId || !squad || !catalogId || x === null || y === null) continue;
      const configured = roster.get(slotId);
      if (!configured || configured.catalogId !== catalogId || configured.squad !== squad) continue;
      const matches = [...graphicsEntities.entries()].filter(([, candidate]) =>
        candidate.side === "azure" && candidate.archetype === "hero" && candidate.catalogId === catalogId
        && Math.abs(candidate.x - x / NEXT_WORLD_UNITS_PER_RENDER_UNIT) < 0.0001
        && Math.abs(candidate.y - y / NEXT_WORLD_UNITS_PER_RENDER_UNIT) < 0.0001);
      // Multiple identical Heroes at one position cannot be assigned safely.
      if (matches.length !== 1) continue;
      attributed.set(matches[0][0], { slot: configured, tick: frame.tick });
    }
  }
  return attributed;
}

function eventEntityIds(event: GraphicsEvent): { actor: string | null; target: string | null } {
  if (event.type === "spawn") return { actor: event.entity.id, target: null };
  if (event.type === "match-end") return { actor: null, target: null };
  if (event.type === "attack" || event.type === "skill") return { actor: event.entityId, target: event.targetId };
  if (event.type === "move" || event.type === "damage" || event.type === "destroy" || event.type === "disappear" || event.type === "vitals" || event.type === "facility-state") {
    return { actor: event.entityId, target: null };
  }
  return { actor: null, target: null };
}

function eventTitle(event: GraphicsEvent): string {
  switch (event.type) {
    case "spawn": return `${event.entity.archetype} joined the visible field`;
    case "move": return "Movement";
    case "attack": return "Attack";
    case "damage": return "Damage";
    case "destroy": return "Unit removed";
    case "disappear": return "Visibility ended";
    case "match-end": return "Match ended";
    case "vitals": return "Vitals changed";
    case "skill": return `Skill · ${event.skillKey}`;
    case "facility-state": return "Facility changed";
  }
}

function eventSummary(event: GraphicsEvent): string {
  switch (event.type) {
    case "spawn": return `${event.entity.catalogId ?? event.entity.archetype} · ${event.entity.side}`;
    case "move": return `${event.entityId} · X ${event.position.x.toFixed(2)} / Y ${event.position.y.toFixed(2)}`;
    case "attack": return `${event.entityId} → ${event.targetId}`;
    case "damage": return `${event.entityId} · ${event.hp} HP remaining`;
    case "destroy": return event.entityId;
    case "disappear": return `${event.entityId} · hidden or out of view`;
    case "match-end": return `${event.result.winner} · ${event.result.reason}`;
    case "vitals": return `${event.entityId} · ${event.hp}/${event.maxHp} HP`;
    case "skill": return `${event.entityId} → ${event.targetId}`;
    case "facility-state": return `${event.entityId} · ${event.battlefield.facilityOwner ?? "owner unknown"}`;
  }
}

function resultLabel(value: string): string {
  if (value === "attacker_victory") return "勝利";
  if (value === "defender_victory") return "敗北";
  if (value === "draw") return "引き分け";
  return value.replaceAll("_", " ");
}

function formatStamp(value: string): string {
  return `T${String(value).padStart(3, "0")}`;
}

function diagnosticsForAttacker(value: RestrictedDiagnostics | undefined) {
  return value?.events.filter((event) => event.side === "attacker") ?? [];
}

function diagnosticTitle(kind: string): string {
  return kind.replaceAll("_", " ");
}

function diagnosticSummary(event: RestrictedDiagnostics["events"][number]): string {
  const { record } = event;
  switch (record.kind) {
    case "state_evaluated": return `${record.value.state} · ${record.value.result}`;
    case "intent_proposed": return `${record.value.intent.capability} · proposed`;
    case "intent_accepted": return `${record.value.intent.capability} · accepted`;
    case "intent_rejected": return `${record.value.intent.capability} · rejected (${record.value.reason})`;
    case "cost_charged": return `${record.value.operation} · ${record.value.amount} CU`;
    case "memory_read": return `${record.value.state} · memory read`;
    case "memory_written": return `${record.value.state} · memory updated`;
    case "runtime_notice": return record.value.code;
  }
}

function fullIdentity(run: BattleAnalysisRun): string {
  return JSON.stringify(run.snapshot);
}

function changedInputs(previous: BattleAnalysisRun, current: BattleAnalysisRun): string[] {
  const oldSnapshot = previous.snapshot;
  const newSnapshot = current.snapshot;
  const changes: string[] = [];
  if (JSON.stringify(oldSnapshot.attacker.configuration) !== JSON.stringify(newSnapshot.attacker.configuration)) changes.push("自軍の5 Hero・Skill・Squad・Node設定");
  if (oldSnapshot.attacker.program.content_digest !== newSnapshot.attacker.program.content_digest) changes.push("自軍のJinrei Program");
  if (JSON.stringify(oldSnapshot.defender.configuration) !== JSON.stringify(newSnapshot.defender.configuration)
    || oldSnapshot.defender.program.content_digest !== newSnapshot.defender.program.content_digest) changes.push("Opponent setup identity");
  if (JSON.stringify(oldSnapshot.context.initial_world) !== JSON.stringify(newSnapshot.context.initial_world)) changes.push("Worldの初期状態");
  if (JSON.stringify(oldSnapshot.context.versions) !== JSON.stringify(newSnapshot.context.versions)
    || JSON.stringify(oldSnapshot.context.ruleset) !== JSON.stringify(newSnapshot.context.ruleset)) changes.push("Ruleset / Engine identity");
  if (oldSnapshot.context.match_id !== newSnapshot.context.match_id && changes.length === 0) changes.push("Match identity");
  return changes;
}

function compareLabel(previous: BattleAnalysisRun, current: BattleAnalysisRun): string {
  return fullIdentity(previous) === fullIdentity(current) ? "同じEnbu Snapshot" : "入力を変更したRun";
}

function ownEventCount(events: readonly GraphicsEvent[], id: string, attribution: Map<string, EntityAttribution>): number {
  return events.filter((event) => {
    const ids = eventEntityIds(event);
    return [ids.actor, ids.target].some((candidate) => candidate && attribution.get(candidate)?.slot.slot === id);
  }).length;
}

export function BattleAnalysis({
  run,
  baselineRun,
  draftChanged,
  busy,
  onReplayEvent,
  onReplayTick,
  onBattle,
  onEdit,
  onExactRematch,
  onRevisedRematch,
}: BattleAnalysisProps): ReactElement {
  const [heroFilter, setHeroFilter] = useState("all");
  const [squadFilter, setSquadFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const roster = useMemo(() => run ? runHeroes(run) : [], [run]);
  const attribution = useMemo(() => run ? attributeOwnHeroes(run) : new Map<string, EntityAttribution>(), [run]);
  const result = run?.response.outcome.result;
  const events = run?.graphicsReplay.timeline ?? EMPTY_EVENTS;
  const diagnostics = run?.response.restricted_diagnostics;
  const ownDiagnostics = useMemo(() => diagnosticsForAttacker(diagnostics), [diagnostics]);
  const squads = useMemo(() => [...new Set(roster.map((hero) => hero.squad))].sort(), [roster]);
  const rows = useMemo<TimelineRow[]>(() => events.map((event, index) => {
    const ids = eventEntityIds(event);
    return { event, index, actor: ids.actor, target: ids.target, summary: eventSummary(event) };
  }).filter((row) => {
    if (eventFilter !== "all" && row.event.type !== eventFilter) return false;
    const participants = [row.actor, row.target].filter((id): id is string => id !== null);
    if (heroFilter !== "all" && !participants.some((id) => attribution.get(id)?.slot.slot === heroFilter)) return false;
    if (squadFilter !== "all" && !participants.some((id) => attribution.get(id)?.slot.squad === squadFilter)) return false;
    const query = search.trim().toLocaleLowerCase();
    if (query && !`${eventTitle(row.event)} ${row.summary} ${formatStamp(String(row.event.tick))}`.toLocaleLowerCase().includes(query)) return false;
    return true;
  }), [attribution, eventFilter, events, heroFilter, search, squadFilter]);
  const pageCount = Math.max(1, Math.ceil(rows.length / EVENT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * EVENT_PAGE_SIZE, (currentPage + 1) * EVENT_PAGE_SIZE);
  const comparedRun = baselineRun && run ? baselineRun : null;
  const comparisonIsExact = comparedRun ? fullIdentity(comparedRun) === fullIdentity(run!) : false;
  const comparisonChanges = comparedRun && run && !comparisonIsExact ? changedInputs(comparedRun, run) : [];
  const countsByHero = useMemo(() => new Map(roster.map((hero) => [hero.slot, ownEventCount(events, hero.slot, attribution)])), [attribution, events, roster]);
  const timelineAttributionCount = attribution.size;

  const chooseEvent = (event: GraphicsEvent): void => {
    onReplayEvent(event);
    onReplayTick(event.tick);
  };

  if (!run || !result) {
    return <section aria-label="戦闘分析" className="battle-analysis" data-testid="battle-analysis">
      <header className="battle-analysis-header"><div><span className="battle-analysis-eyebrow">S13 · 実戦結果と改善</span><h3>戦績を <em>分析</em></h3><p>実際のEnbu結果と許可されたReplayだけを表示します。</p></div></header>
      <section className="battle-analysis-empty"><span aria-hidden="true">⌁</span><h4>分析できる試合がありません</h4><p>Local PvEを実行すると、確定した勝敗・Replay Event・認可済みDiagnosticsをここで確認できます。</p><button type="button" onClick={onBattle}>Battleへ戻る</button></section>
    </section>;
  }

  return (
    <section aria-label="戦闘分析" className="battle-analysis" data-testid="battle-analysis">
      <header className="battle-analysis-header">
        <div><span className="battle-analysis-eyebrow">S13 · RESULT / OBSERVED REPLAY</span><h3>戦績を <em>分析</em></h3><p>この分析は{run.graphicsReplay.header.view === "attacker" ? "自軍の所有者視点" : "公開Replay"}に含まれる実データに基づきます。現在の編集Draftは別に表示します。</p></div>
        <div className="battle-analysis-header-actions"><span className={run.graphicsReplay.header.view === "attacker" ? "battle-analysis-owner-tag" : "battle-analysis-public-tag"}>{run.graphicsReplay.header.view === "attacker" ? "OWNER REPLAY" : "PUBLIC REPLAY"}</span><button type="button" onClick={onBattle}>Battle Replayへ</button></div>
      </header>

      <section aria-label="確定した試合結果" className="battle-analysis-result">
        <div className={`battle-analysis-result-mark result-${result.outcome}`} aria-hidden="true">{result.outcome === "attacker_victory" ? "勝" : result.outcome === "defender_victory" ? "敗" : "―"}</div>
        <div className="battle-analysis-result-copy"><span>CONFIRMED · {result.match_id}</span><strong>{resultLabel(result.outcome)}</strong><small>{result.termination_reason} · {result.final_tick} ticks · {result.cu_spent.attacker} CU spent by your side</small></div>
        <div className="battle-analysis-result-identity"><small>FINAL STATE DIGEST</small><code>{result.final_state_digest}</code><small>Replay {run.graphicsReplay.schemaVersion} · {run.graphicsReplay.timeline.length} authorized presentation events</small></div>
      </section>

      <div className="battle-analysis-run-status" role="status">
        <span><strong>Analyzed run</strong> · {run.snapshot.attacker.id} / {run.snapshot.attacker.revision}</span>
        <span className={draftChanged ? "is-changed" : "is-current"}>{draftChanged ? "現在のDraftに変更があります。結果の入力はこの記録に固定されています。" : "現在のDraftはこのRunの入力内容です。"}</span>
      </div>

      <section aria-label="実戦Runからの編成" className="battle-analysis-roster">
        <header><div><span className="battle-analysis-eyebrow">SUBMITTED RUN ROSTER</span><h4>試合時のHero・Squad</h4></div><small>{timelineAttributionCount} Hero attribution confirmed from owner-view observations</small></header>
        {roster.length ? <div className="battle-analysis-roster-grid">{roster.map((hero) => {
          const count = countsByHero.get(hero.slot) ?? 0;
          const found = [...attribution.values()].some((item) => item.slot.slot === hero.slot);
          return <article key={hero.slot} className="battle-analysis-hero-card">
            <span>{hero.slot}</span><strong>{hero.catalogId}</strong><small>{hero.squad} · start {hero.node}</small><small>Skill plan · {hero.skillPath.replaceAll("_", " ")}</small>
            <b>{found ? `${count} visible replay events attributed` : "Hero replay attribution not proven"}</b>
          </article>;
        })}</div> : <p className="battle-analysis-unavailable">This run's submitted Hero roster is unavailable in its snapshot; no current Draft values were substituted.</p>}
        <div className="battle-analysis-edit-actions" aria-label="編成を改善">
          <button onClick={() => onEdit("collection")} type="button">Heroを変更</button>
          <button onClick={() => onEdit("skills")} type="button">Skillを変更</button>
          <button onClick={() => onEdit("squads")} type="button">Squad・起点を変更</button>
          <button onClick={() => onEdit("jinrei")} type="button">Jinreiを変更</button>
        </div>
      </section>

      <div className="battle-analysis-grid">
        <section aria-label="Replay event timeline" className="battle-analysis-card">
          <header><div><span className="battle-analysis-eyebrow">REPLAY EVENT</span><h4>観測Timeline</h4></div><small>{rows.length} events · page {currentPage + 1}/{pageCount}</small></header>
          <div className="battle-analysis-filters">
            <label><span>Hero</span><select aria-label="HeroでTimelineを絞り込む" onChange={(event) => { setHeroFilter(event.currentTarget.value); setPage(0); }} value={heroFilter}><option value="all">全て</option>{roster.map((hero) => <option key={hero.slot} value={hero.slot}>{hero.slot} · {hero.catalogId}</option>)}</select></label>
            <label><span>Squad</span><select aria-label="SquadでTimelineを絞り込む" onChange={(event) => { setSquadFilter(event.currentTarget.value); setPage(0); }} value={squadFilter}><option value="all">全て</option>{squads.map((squad) => <option key={squad} value={squad}>{squad}</option>)}</select></label>
            <label><span>Event</span><select aria-label="Event typeでTimelineを絞り込む" onChange={(event) => { setEventFilter(event.currentTarget.value); setPage(0); }} value={eventFilter}><option value="all">全Event</option>{["spawn", "move", "attack", "skill", "damage", "destroy", "disappear", "facility-state", "vitals", "match-end"].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label className="battle-analysis-search"><span>検索</span><input aria-label="Timelineを検索" onChange={(event) => { setSearch(event.currentTarget.value); setPage(0); }} placeholder="event / entity / tick" type="search" value={search} /></label>
          </div>
          {rows.length ? <>
            <ol className="battle-analysis-timeline">{pageRows.map(({ event, index, summary }) => <li key={`${event.tick}-${event.order}-${index}`}><button onClick={() => chooseEvent(event)} type="button"><span className="battle-analysis-tick">{formatStamp(String(event.tick))}</span><span className="battle-analysis-event-mark">{event.type === "match-end" ? "◆" : event.type === "damage" ? "×" : event.type === "move" ? "→" : "•"}</span><span className="battle-analysis-event-copy"><strong>{eventTitle(event)}</strong><small>{summary}</small></span><span className="battle-analysis-open">Replay ↗</span></button></li>)}</ol>
            <nav aria-label="Timeline pages" className="battle-analysis-pages"><button disabled={currentPage <= 0} onClick={() => setPage(Math.max(0, currentPage - 1))} type="button">前のEvents</button><span>{currentPage + 1} / {pageCount}</span><button disabled={currentPage >= pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} type="button">次のEvents</button></nav>
          </> : <p className="battle-analysis-unavailable">条件に一致する可視Replay Eventはありません。絞込を変えるか、公開Replayの範囲を確認してください。</p>}
          <p className="battle-analysis-boundary">Fogで非公開の対象・位置・行動はこのTimelineへ補われません。Eventを選ぶと実Replayの同じTickへ移動します。</p>
        </section>

        <aside className="battle-analysis-side-column">
          <section aria-label="Decision Trace and restricted diagnostics" className="battle-analysis-card battle-analysis-diagnostics">
            <header><div><span className="battle-analysis-eyebrow">RESTRICTED LOCAL CHANNEL</span><h4>Decision Trace / Diagnostics</h4></div><span>ATTACKER ONLY</span></header>
            {diagnostics ? <>
              <div className="battle-analysis-cu"><span><small>自軍 CU</small><strong>{diagnostics.cu_by_side.attacker}</strong></span><span><small>自軍 Trace Events</small><strong>{ownDiagnostics.length}</strong></span></div>
              {ownDiagnostics.length ? <ol className="battle-analysis-diagnostic-list">{ownDiagnostics.slice(0, 60).map((entry, index) => <li key={`${entry.tick}-${entry.sequence}-${index}`}><button onClick={() => onReplayTick(entry.tick)} type="button"><span>{formatStamp(String(entry.tick))}</span><div><strong>{diagnosticTitle(entry.record.kind)}</strong><small>{diagnosticSummary(entry)}</small></div><b>Replay ↗</b></button></li>)}</ol> : <p className="battle-analysis-unavailable">Enbu supplied authorized RestrictedDiagnostics, but emitted no attacker-side trace events for this run.</p>}
              {ownDiagnostics.length > 60 && <p className="battle-analysis-boundary">Showing the first 60 of {ownDiagnostics.length} authorized attacker-side events.</p>}
            </> : <p className="battle-analysis-unavailable" role="status">RestrictedDiagnostics were not supplied for this Run. Decision Trace is unavailable; no Observed result is inferred from the Jinrei source or Coverage.</p>}
            {run.sourceReplay.perspective === "attacker" && <p className="battle-analysis-boundary">The trace is a local-only Enbu channel. Defender diagnostics, private enemy Jinrei and hidden enemy state are not shown.</p>}
          </section>

          <section aria-label="Previous and current match comparison" className="battle-analysis-card battle-analysis-comparison">
            <header><div><span className="battle-analysis-eyebrow">PREVIOUS RUN · CURRENT RUN</span><h4>試合を比較</h4></div></header>
            {comparedRun ? <>
              <p className="battle-analysis-comparison-label">{compareLabel(comparedRun, run)}</p>
              <div className="battle-analysis-comparison-values">
                <div><small>PREVIOUS</small><strong>{resultLabel(comparedRun.response.outcome.result.outcome)}</strong><span>{comparedRun.response.outcome.result.final_tick} ticks · {comparedRun.response.outcome.result.cu_spent.attacker} CU</span></div>
                <span aria-hidden="true">→</span>
                <div><small>CURRENT</small><strong>{resultLabel(result.outcome)}</strong><span>{result.final_tick} ticks · {result.cu_spent.attacker} CU</span></div>
              </div>
              {comparisonIsExact ? <p className="battle-analysis-boundary">Both completed Runs used the same complete SimulationSnapshot identity.</p> : comparisonChanges.length ? <ul className="battle-analysis-change-list">{comparisonChanges.map((change) => <li key={change}>{change}</li>)}</ul> : <p className="battle-analysis-boundary">Run identity differs. No more specific change was exposed by the submitted snapshots.</p>}
              <p>Tick差 {result.final_tick - comparedRun.response.outcome.result.final_tick > 0 ? "+" : ""}{result.final_tick - comparedRun.response.outcome.result.final_tick} · 自軍CU差 {result.cu_spent.attacker - comparedRun.response.outcome.result.cu_spent.attacker > 0 ? "+" : ""}{result.cu_spent.attacker - comparedRun.response.outcome.result.cu_spent.attacker}</p>
            </> : <p className="battle-analysis-unavailable">比較可能な前回Runはありません。現在のDraftや保存版を過去の試合結果として扱いません。</p>}
          </section>
        </aside>
      </div>

      <section aria-label="次の改善・再戦" className="battle-analysis-next-step">
        <div><span className="battle-analysis-eyebrow">NEXT ACTION</span><h4>{draftChanged ? "編集Draftから新しい試合を検証" : "この試合の条件を選んで再戦"}</h4><p>{draftChanged ? "同条件再戦は保存済みRun Snapshotを使い、変更後再戦は現在DraftをReadyで再検証してから実行します。" : "同条件再戦は今回のSnapshotを再検証します。Hero・Skill・Squad・Jinreiを編集すると変更後再戦が選べます。"}</p></div>
        <div className="battle-analysis-rematch-actions"><button disabled={busy} onClick={onExactRematch} type="button">同条件で再戦 · Run Snapshot</button><button disabled={busy || !draftChanged} onClick={onRevisedRematch} type="button">変更後の条件を検証 · 現在Draft</button></div>
      </section>
    </section>
  );
}

export { attributeOwnHeroes, changedInputs, fullIdentity, runHeroes };
