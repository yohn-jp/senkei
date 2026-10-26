import { useEffect, useRef, useState } from "react";
import { campaignScenarioStatus, campaignCompletionSummary, type CampaignProgress } from "./campaign-progress";
import type { PreflightProblem, PreflightRepairTarget } from "./preflight-problem";
import "./campaign-progress.css";
import type { LocalPveScenario, NextRules, RulePackage, SenkeiDraft } from "../../contracts";

export type JourneyScreen = "home" | "conditions" | "preset" | "ready" | "workspace" | "resume" | "running";
type EditTarget = "collection" | "skills" | "squads" | "jinrei";
interface Props {
  screen: JourneyScreen;
  setScreen: (screen: JourneyScreen) => void;
  entryMode: "quick" | "custom" | "campaign";
  setEntryMode: (mode: "quick" | "custom" | "campaign") => void;
  slots: readonly { slot_id: string; catalog_id: string; skill_path: string; squad: string; node: string }[];
  rivalSlots: readonly { catalog_id: string }[];
  nextRules: NextRules;
  packageValue: RulePackage;
  draft: SenkeiDraft | null;
  ready: boolean;
  checking: boolean;
  failure: PreflightProblem | null;
  onRepair: (target: PreflightRepairTarget) => void;
  scenarioRepairFocus: { readonly requestId: string; readonly scenarioId: string | null } | null;
  compiled: boolean;
  compilationCU: number | null;
  stale: boolean;
  coreReady: boolean;
  includeDiagnostics: boolean;
  setIncludeDiagnostics: (value: boolean) => void;
  check: () => void;
  launch: () => void;
  edit: (target: EditTarget) => void;
  recoveryRestored: boolean;
  saved: boolean;
  newPreset: () => void;
  scenarios: readonly LocalPveScenario[];
  selectedScenarioId: string;
  onScenarioChange: (scenarioId: string) => void;
  unlockedScenarioIds: readonly string[];
  campaignProgress: CampaignProgress | null;
  latestScenarioFeedback: { scenarioId: string; status: "victory" | "defeat" | "draw" | "incomplete"; headline: string; detail: string } | null;
}

function preflightTargetLabel(problem: PreflightProblem): string {
  const side = problem.side === "attacker" ? "自軍" : problem.side === "defender" ? "相手側" : problem.side === "shared" ? "共通" : "未特定";
  switch (problem.target.kind) {
    case "hero": return `${side} Hero · ${problem.target.slotId ?? `record ${problem.target.recordIndex ?? "?"}`} · ${problem.target.field ?? "対象field未特定"}`;
    case "program": return `${side} Jinrei · ${problem.target.path ?? "source location未特定"}`;
    case "scenario": return `Campaign scenario · ${problem.repair.kind === "scenario" ? problem.repair.scenarioId ?? "選択中の課題" : "選択中の課題"}`;
    case "compatibility": return `${side} · RulePackage / schema compatibility`;
    case "runtime": return `${side} · runtime / Core`;
    case "unknown": return `${side} · 対象を安全に特定できません`;
  }
}

function preflightRepairLabel(target: PreflightRepairTarget): string {
  switch (target.kind) {
    case "own_hero": return `Hero Atelier · ${target.screen} · slot ${target.slotId} · ${target.field}`;
    case "own_jinrei": return `Jinrei Workbench · ${target.path ?? "source location unavailable"}`;
    case "scenario": return `Campaign scenario selection · ${target.scenarioId ?? "select a compatible scenario"}`;
    case "ready": return "Ready · run the current check again";
    case "recovery": return "Library recovery · inspect the saved input or retry the Core";
  }
}

function preflightRepairAction(target: PreflightRepairTarget): string {
  switch (target.kind) {
    case "own_hero": return `Slot ${target.slotId} · ${target.field} を修正`;
    case "own_jinrei": return "Jinreiの修正位置を開く";
    case "scenario": return "該当Scenarioを確認して選び直す";
    case "ready": return "Readyを再検証";
    case "recovery": return "Library recoveryを開く";
  }
}

function preflightRevalidationLabel(value: PreflightProblem["revalidation"]): string {
  switch (value) {
    case "compile_and_preflight": return "自軍Jinreiを再Compileし、両陣営のSnapshotを再検証します。";
    case "snapshot_preflight": return "元Runの不変SnapshotをCoreで再検証します。";
    case "reload_and_preflight": return "Core / RulePackageを再読込してからPreflightを再実行します。";
  }
}

export function JourneyScreens(p: Props) {
  const [presetHeroIndex, setPresetHeroIndex] = useState(0);
  const [conditionsReturn, setConditionsReturn] = useState<"home" | "ready">("home");
  const inspectConditions = () => { setConditionsReturn("ready"); p.setScreen("conditions"); };
  const screenRef = useRef<HTMLElement>(null);
  const consumedScenarioRepair = useRef<string | null>(null);
  useEffect(() => {
    if (p.screen !== "workspace") {
      const heading = screenRef.current?.querySelector("h3");
      heading?.focus({ preventScroll: true });
      screenRef.current?.scrollIntoView({ block: "start" });
    }
  }, [p.screen]);
  useEffect(() => {
    const request = p.scenarioRepairFocus;
    if (p.screen !== "conditions" || !request || consumedScenarioRepair.current === request.requestId) return;
    consumedScenarioRepair.current = request.requestId;
    const frame = requestAnimationFrame(() => {
      const scenario = request.scenarioId === null ? null
        : [...(screenRef.current?.querySelectorAll<HTMLButtonElement>("[data-scenario-id]") ?? [])]
          .find(button => button.dataset.scenarioId === request.scenarioId) ?? null;
      const target = scenario && !scenario.disabled ? scenario : screenRef.current?.querySelector<HTMLElement>("h3");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [p.screen, p.scenarioRepairFocus?.requestId]);
  const missing = !p.draft || p.slots.length !== 5 || p.slots.some(slot => !slot.catalog_id || !slot.squad || !slot.node || !slot.skill_path)
    || (p.draft.program_input.kind === "text" && p.draft.program_input.source.trim().length === 0);
  const start = (mode: "quick" | "custom" | "campaign") => { setConditionsReturn("home"); p.setEntryMode(mode); p.setScreen("conditions"); };
  const selectedScenario = p.scenarios.find(scenario => scenario.id === p.selectedScenarioId) ?? null;
  const selectedScenarioUnlocked = Boolean(selectedScenario && p.unlockedScenarioIds.includes(selectedScenario.id));
  const completion = p.campaignProgress && p.scenarios.length ? campaignCompletionSummary(p.campaignProgress, p.scenarios.map(scenario => scenario.id)) : null;
  const scenarioFeedback = selectedScenario && p.latestScenarioFeedback?.scenarioId === selectedScenario.id ? p.latestScenarioFeedback : null;
  const summary = <ul className="journey-heroes">{p.slots.map(slot => {
    const hero = p.nextRules.heroes.find(item => item.id === slot.catalog_id);
    const skills = (hero?.skill_paths[slot.skill_path] ?? []).map(id => hero?.skills.find(skill => skill.id === id)?.name ?? id);
    return <li key={slot.slot_id}><strong>{slot.catalog_id} · {hero?.name}</strong><small>取得予定 {slot.skill_path}：{skills.join(" → ")}</small><small>Squad {slot.squad} · 起点 {slot.node}</small></li>;
  })}</ul>;
  const mobilePreset = <div className="journey-mobile journey-preset-mobile">
    <div className="journey-hero-pager"><button type="button" aria-label="前のHero" disabled={presetHeroIndex === 0} onClick={() => setPresetHeroIndex(index => index - 1)}>←</button><strong>Hero {presetHeroIndex + 1} / 5</strong><button type="button" aria-label="次のHero" disabled={presetHeroIndex >= p.slots.length - 1} onClick={() => setPresetHeroIndex(index => index + 1)}>→</button></div>
    <article>{p.slots.slice(presetHeroIndex, presetHeroIndex + 1).map(slot => {
      const hero = p.nextRules.heroes.find(item => item.id === slot.catalog_id);
      const skills = (hero?.skill_paths[slot.skill_path] ?? []).map(id => hero?.skills.find(skill => skill.id === id)?.name ?? id);
      return <div key={slot.slot_id}><h4>{slot.catalog_id} · {hero?.name}</h4><p>取得予定：{skills.join(" → ")}</p><p>Squad {slot.squad} / 起点 {slot.node}</p></div>;
    })}</article><details><summary>5 Heroの全体を確認</summary>{summary}</details>
  </div>;
  const editLinks = <div className="journey-edit-links">{([["collection", "Heroを変更"], ["skills", "Skill計画を変更"], ["squads", "Squad・起点を変更"], ["jinrei", "Jinreiを変更"]] as const).map(([target, label]) => <button key={target} type="button" onClick={() => p.edit(target)}>{label}</button>)}</div>;
  if (p.screen === "workspace") return null;
  return <section ref={screenRef} className="journey-screen" data-testid={`journey-${p.screen}`} aria-busy={p.checking || p.screen === "running"}>
    {p.screen !== "home" && p.screen !== "running" && <button className="journey-back" type="button" disabled={p.checking} onClick={() => p.setScreen(p.screen === "preset" ? "conditions" : p.screen === "conditions" ? conditionsReturn : "home")}>← {p.screen === "preset" ? "対戦条件へ戻る" : p.screen === "conditions" && conditionsReturn === "ready" ? "準備確認へ戻る" : "Homeへ戻る"}</button>}
    {p.screen === "home" && <>
      <span className="next-eyebrow">S01 · LOCAL PvE</span><h3 tabIndex={-1}>何から始める？</h3><p>コード入力・保存・ログインなしで最初の戦闘へ。</p>
      <div className="journey-desktop journey-start-grid">
        <article><span>01 / QUICK</span><h4>用意された戦型で始める</h4><p>同梱Catalogの5 HeroとStarter Jinreiを確認し、実Compilerで準備する。</p><button type="button" disabled={!p.coreReady || !p.draft} onClick={() => start("quick")}>すぐ戦う</button></article>
        <article><span>02 / CUSTOM</span><h4>自分の戦型を作る</h4><p>Hero・Skill計画・Squad・Jinreiを同じDraftで編集する。</p><button type="button" disabled={!p.coreReady || !p.draft} onClick={() => start("custom")}>自分で編成</button></article>
        <article><span>03 / CONTINUE</span><h4>編集と保存から再開</h4><p>未保存Recoveryと明示保存したRestore Pointを選ぶ。</p><button type="button" onClick={() => p.setScreen("resume")}>続きから</button></article>
        <article><span>04 / CAMPAIGN</span><h4>戦役に挑む</h4><p>同梱ルールで解放済みのローカル課題を順に攻略する。</p><button type="button" disabled={!p.coreReady || !p.draft || p.scenarios.length === 0} onClick={() => start("campaign")}>戦役を始める</button></article>
      </div>
      <div className="journey-mobile journey-start-mobile"><article><span>最初の1戦</span><h4>5 Heroで出撃しよう</h4><p>編成と戦術は用意済み。内容を確認して準備へ。</p><button type="button" disabled={!p.coreReady || !p.draft} onClick={() => start("quick")}>すぐ戦う</button></article><details><summary>戦役・自由編成・再開</summary><button type="button" disabled={!p.coreReady || !p.draft || p.scenarios.length === 0} onClick={() => start("campaign")}>戦役を始める</button><button type="button" disabled={!p.coreReady || !p.draft} onClick={() => start("custom")}>自分で編成</button><button type="button" onClick={() => p.setScreen("resume")}>続きから</button></details></div>
      {!p.coreReady && <p role="status">Core / Catalogを確認中です。準備ができると開始できます。</p>}
      <p className="journey-local-note">{p.recoveryRestored ? "未保存Draftを復旧済み。Quick / Customも現在の編集を保持します。" : "現在のDraftを引き継ぎます。新しいPresetへの置換は確認画面で選べます。"}</p>
      <p>Graphics G1のサンプル演武は検証用Fixtureです。Nextの戦型や戦績には読み込まれません。</p>
    </>}
    {p.screen === "conditions" && <><span className="next-eyebrow">S02 · 対戦条件</span><h3 tabIndex={-1}>{p.entryMode === "campaign" ? "戦役の課題を選ぶ" : "ローカルPvE"}</h3><div className="journey-condition-grid"><article><h4>同梱Nextルール</h4><p>{p.packageValue.ruleset.id} · {Object.values(p.packageValue.ruleset.version).join(".")}</p><p>WorldはこのRulePackageの同梱Mapを使用します。</p><details><summary>バージョン詳細</summary><code>{p.packageValue.ruleset.digest}</code></details></article>{p.entryMode !== "campaign" && <article><h4>対戦相手：同梱Starter</h4><p>既存Next実行経路の固定相手側編成・Starter戦術を使用します。難易度・別NPCは未提供です。</p><p>このローカル対戦の初期相手編成：{p.rivalSlots.map(slot => `${slot.catalog_id} ${p.nextRules.heroes.find(hero => hero.id === slot.catalog_id)?.name ?? "Unknown"}`).join(" / ")}</p><p>戦闘中は公開Replayと自軍に許可された観測だけを表示します。</p></article>}</div>{p.entryMode === "campaign" && <section className="journey-campaign" aria-label="ローカル戦役"><header><div><span className="next-eyebrow">LOCAL CAMPAIGN · {p.scenarios.length} CHALLENGES</span><h4>課題を選ぶ</h4><p>ローカルPvEの確定結果で次の課題が解放されます。各課題の見どころは目標の確認用で、個別の達成条件ではありません。</p></div><span className="journey-campaign-progress">{p.unlockedScenarioIds.length} 解放</span></header>{p.campaignProgress && <div className="journey-campaign-summary" role="region" aria-label="Campaign completion records"><p>攻略記録 {p.campaignProgress.completed_scenario_ids.length} / {p.scenarios.length} · 解放 {p.unlockedScenarioIds.length}</p>{p.campaignProgress.history_incomplete && <p className="journey-campaign-history">旧形式の解放情報から攻略を推定しません。攻略履歴不明は「未プレイ」とは異なります。以降の実際の勝利から攻略を記録します。</p>}{completion?.finalScenarioCompleted && <p>最終課題：攻略記録あり。{completion.allRecordedComplete ? "全課題の攻略を記録済みです。" : "以前の全課題の攻略までは確認できません。"}</p>}</div>}<div className="journey-campaign-list">{p.scenarios.map(scenario => {
      const unlocked = p.unlockedScenarioIds.includes(scenario.id);
      const current = scenario.id === p.selectedScenarioId;
      const status = p.campaignProgress ? campaignScenarioStatus(p.campaignProgress, scenario.id) : "locked";
      const label = status === "completed" ? "攻略済み" : status === "completion_unknown" ? "解放済み・攻略履歴不明" : status === "uncompleted" ? "解放済み・未攻略" : "未解放";
      return <button aria-current={current ? "true" : undefined} aria-pressed={current} className={`journey-campaign-card${current ? " is-selected" : ""}${unlocked ? "" : " is-locked"}`} data-scenario-id={scenario.id} disabled={!unlocked} key={scenario.id} onClick={() => p.onScenarioChange(scenario.id)} type="button"><span className="journey-campaign-card-top"><small>課題 {String(scenario.order).padStart(2, "0")} · {scenario.difficulty.toUpperCase()}</small><b>{label}</b></span><strong>{scenario.title}</strong><span>{scenario.objective}</span><small>{scenario.description}</small><span className="journey-campaign-criteria"><b>見どころ</b> {scenario.criteria.map(item => item.label).join(" · ")}</span></button>;
    })}</div>{scenarioFeedback && <article className={`journey-campaign-feedback is-${scenarioFeedback.status}`} role="status"><span className="next-eyebrow">前回の課題結果</span><h4>{scenarioFeedback.headline}</h4><p>{scenarioFeedback.detail}</p></article>}{selectedScenario && !selectedScenarioUnlocked && <p role="alert">選択した課題はまだ解放されていません。解放済みの課題を選んでください。</p>}</section>}<div className="journey-actions"><button type="button" disabled={p.entryMode === "campaign" && (!selectedScenario || !selectedScenarioUnlocked)} onClick={() => conditionsReturn === "ready" ? p.setScreen("ready") : p.entryMode === "custom" ? p.edit("collection") : p.setScreen("preset")}>{conditionsReturn === "ready" ? "準備確認へ戻る" : p.entryMode === "campaign" ? "この課題で準備する" : "この条件で進む"}</button></div></>}
    {p.screen === "preset" && <><span className="next-eyebrow">{p.entryMode === "campaign" ? "S02 · CAMPAIGN DEPLOYMENT" : "S03 · QUICK PRESET"}</span><h3 tabIndex={-1}>{p.entryMode === "campaign" ? "この課題に出撃" : "この戦型で始める"}</h3><p>{p.entryMode === "campaign" && selectedScenario ? `課題 ${String(selectedScenario.order).padStart(2, "0")} · ${selectedScenario.title}。${selectedScenario.objective}` : `${p.recoveryRestored ? "復旧した現在のDraft" : "現在のDraft（初回は同梱Starter）"}。Hero・取得予定・所属・起点を確認してください。`}</p>{p.entryMode === "campaign" && selectedScenario && <article className="journey-scenario-summary"><span className="next-eyebrow">SELECTED CHALLENGE · {selectedScenario.campaign_title}</span><h4>{selectedScenario.title}</h4><p>{selectedScenario.description}</p><p><strong>対戦相手：</strong>この課題に登録されたNPC編成を使います。</p><small>見どころは目標の確認用です。個別の達成条件としては判定しません。</small></article>}<div className="journey-desktop">{summary}</div>{mobilePreset}<article><h4>Jinrei：{p.draft?.program_input.kind === "text" ? "テキスト戦術" : "構造化戦術"}</h4><p>{p.entryMode === "campaign" ? "現在の自軍Jinreiを保持したまま、選択した課題のNPCと対戦します。" : "初回のStarterは各Heroの移動・取得予定Skillの条件を記述済みです。"} 下の内容を実Compilerで検証してから開始します。</p><details><summary>現在の戦術を読む</summary><pre>{p.draft?.program_input.kind === "text" ? p.draft.program_input.source : JSON.stringify(p.draft?.program_input.ast, null, 2)}</pre></details></article>{editLinks}<div className="journey-actions"><button type="button" onClick={() => p.setScreen("ready")}>準備確認へ</button>{p.entryMode !== "campaign" && <button type="button" onClick={() => { if (window.confirm("現在の編成とJinreiを同梱Starterに置換します。明示保存した設定は保持されます。続けますか？")) p.newPreset(); }}>初期Presetを使い直す</button>}</div></>}
    {p.screen === "ready" && <><span className="next-eyebrow">S10 · PREFLIGHT</span><h3 tabIndex={-1}>準備確認</h3>{p.entryMode === "campaign" && selectedScenario && <article className="journey-ready-challenge"><span className="next-eyebrow">SELECTED CAMPAIGN CHALLENGE</span><strong>{selectedScenario.title}</strong><p>{selectedScenario.objective} · 課題に登録されたNPCと対戦します。</p><button type="button" disabled={p.checking} onClick={inspectConditions}>課題を変更</button></article>}<p role="status" data-testid="preflight-status">{p.checking ? "検証中：実CompilerとEnbuの開始時検証" : p.ready ? "開始可能" : p.failure ? p.failure.status === "invalid" ? "不正：開始時検証に失敗しました" : p.failure.status === "unverified" ? "未検証：現在の設定を再検証してください" : "検証失敗：Core・読込状態を確認して再試行してください" : missing ? "不足：Hero・Skill・Squad・起点・戦術を設定してください" : "未検証：現在のSnapshotの開始条件を確認してください"}</p><div className="journey-ready-grid journey-desktop">
      <article><h4>Hero・Skill計画・Squad・起点</h4><p>{p.ready ? "有効：Enbu初期構成検証済み" : "未検証：実Enbuが合法性を確認します"}</p>{summary}{editLinks}</article>
      <article><h4>Jinrei / RulePackage / World / 相手側</h4><p>{p.compiled ? `自軍：現行Draftをコンパイル済み / 見積 CU ${p.compilationCU}` : p.stale ? "自軍：Compile失効・再コンパイルが必要" : "自軍：未コンパイル"}</p><p>{p.ready ? "両陣営のProgram・構成・実行Context：検証成功" : "両陣営のProgram・構成・実行Context：未検証"}</p><button type="button" onClick={inspectConditions}>対戦条件を確認</button><p>Coverage：Not Proven。静的な全状態の保証とは別に開始条件を検証します。</p><p>Behavior Profile：同梱Packageの宣言に従います。未宣言のDefaultを適用済みとは扱いません。</p><label><input type="checkbox" checked={p.includeDiagnostics} onChange={event => p.setIncludeDiagnostics(event.target.checked)} /> 自軍のローカルReplay・診断を収集する（任意）</label></article>
    </div><div className="journey-mobile journey-ready-mobile">
      <ol className="journey-checklist">{([["collection", "5 Hero", p.slots.length === 5 ? "5 / 5 設定済み" : "不足"], ["skills", "Skill計画", "取得予定を設定"], ["squads", "Squad・起点", "共有Nodeを確認"], ["jinrei", "Jinrei", p.compiled ? `Compiled / 見積 CU ${p.compilationCU}` : p.stale ? "Compile失効" : "未コンパイル"]] as const).map(([target, label, detail]) => <li key={target}><button type="button" onClick={() => p.edit(target)}><span><strong>{label}</strong><small>{detail}</small></span><b>{p.ready ? "検証済み" : "修正 →"}</b></button></li>)}</ol>
      <details><summary>編成・取得予定の詳細</summary>{summary}</details>
      <button type="button" onClick={inspectConditions}>対戦条件を確認</button>
      <p>{p.ready ? "両陣営・Context：Enbu開始時検証済み" : "両陣営・Context：未検証"}</p>
      <details><summary>Coverage・診断オプション</summary><p>Coverage：Not Proven。未宣言のBehavior Defaultを適用済みとは扱いません。</p><label><input type="checkbox" checked={p.includeDiagnostics} onChange={event => p.setIncludeDiagnostics(event.target.checked)} /> 自軍のローカルReplay・診断を収集する（任意）</label></details>
    </div>{p.failure && <div role="alert" className="next-error" data-testid="preflight-problem"><div><strong>{p.failure.status === "invalid" ? "不正・開始拒否" : p.failure.status === "unverified" ? "未検証・再確認が必要" : "検証処理を完了できませんでした"}</strong>
      <dl className="next-problem-contract"><div><dt>陣営・対象</dt><dd>{preflightTargetLabel(p.failure)}</dd><dt>原因</dt><dd><code>{p.failure.apiError?.code ?? p.failure.workerCode ?? p.failure.stage}</code> · {p.failure.message}</dd><dt>修正場所</dt><dd>{preflightRepairLabel(p.failure.repair)}</dd><dt>再検証</dt><dd>{preflightRevalidationLabel(p.failure.revalidation)}</dd></div></dl>
      <button type="button" className="next-preflight-repair" onClick={() => p.onRepair(p.failure!.repair)}>{preflightRepairAction(p.failure.repair)}</button>{editLinks}</div></div>}<div className="journey-actions"><button type="button" disabled={p.checking || !p.coreReady || missing} onClick={p.check}>検証・コンパイル</button><button type="button" disabled={!p.ready || p.checking} onClick={p.launch}>戦闘開始</button><button type="button" onClick={() => p.setScreen("resume")}>保存・復旧（任意）</button></div><p>保存は開始条件ではありません。編集すると関連するCompileと開始検証が失効します。</p></>}
    {p.screen === "running" && <><span className="next-eyebrow">S11 · ENBU</span><h3 tabIndex={-1}>ローカル戦闘を実行中</h3><p role="status">確定SnapshotをRust / WASMで計算しています。結果が確定するとReplayへ進みます。</p><p>戦闘は完全自動です。この間に設定を変更せず、完了をお待ちください。</p></>}
    {p.screen === "resume" && <><span className="next-eyebrow">S14 · NEXT SAVE / RECOVERY</span><h3 tabIndex={-1}>続きから</h3><p>{p.recoveryRestored ? "未保存Recoveryを復旧済みです。" : "現在の編集を保持しています。"} {p.saved ? "明示保存したRestore Pointもあります。上のRestore savedで読み込めます。" : "互換性のある明示保存はありません。"}</p><p>保存・Import・Exportは上のNext専用コントロールから操作できます。旧版Libraryとは独立しています。</p><div className="journey-actions"><button type="button" disabled={!p.draft} onClick={() => p.edit("collection")}>編集を続ける</button><button type="button" disabled={!p.draft} onClick={() => p.setScreen("ready")}>準備確認へ</button></div></>}
  </section>;
}
