import { useEffect, useRef, useState } from "react";
import type { NextRules, RulePackage, SenkeiDraft } from "../../contracts";

export type JourneyScreen = "home" | "conditions" | "preset" | "ready" | "workspace" | "resume" | "running";
type EditTarget = "collection" | "skills" | "squads" | "jinrei";
interface Props {
  screen: JourneyScreen;
  setScreen: (screen: JourneyScreen) => void;
  entryMode: "quick" | "custom" | "review";
  setEntryMode: (mode: "quick" | "custom" | "review") => void;
  slots: readonly { slot_id: string; catalog_id: string; skill_path: string; squad: string; node: string }[];
  rivalSlots: readonly { catalog_id: string }[];
  nextRules: NextRules;
  packageValue: RulePackage;
  draft: SenkeiDraft | null;
  ready: boolean;
  checking: boolean;
  failure: { status: "invalid" | "unverified" | "failed"; message: string } | null;
  compiled: boolean;
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
}

export function JourneyScreens(p: Props) {
  const [presetHeroIndex, setPresetHeroIndex] = useState(0);
  const screenRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (p.screen !== "workspace") {
      const heading = screenRef.current?.querySelector("h3");
      heading?.focus({ preventScroll: true });
      screenRef.current?.scrollIntoView({ block: "start" });
    }
  }, [p.screen]);
  const missing = !p.draft || p.slots.length !== 5 || p.slots.some(slot => !slot.catalog_id || !slot.squad || !slot.node || !slot.skill_path)
    || (p.draft.program_input.kind === "text" && p.draft.program_input.source.trim().length === 0);
  const start = (mode: "quick" | "custom") => { p.setEntryMode(mode); p.setScreen("conditions"); };
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
    {p.screen !== "home" && p.screen !== "running" && <button className="journey-back" type="button" disabled={p.checking} onClick={() => p.setScreen(p.screen === "preset" ? "conditions" : "home")}>← {p.screen === "preset" ? "対戦条件へ戻る" : "Homeへ戻る"}</button>}
    {p.screen === "home" && <>
      <span className="next-eyebrow">S01 · LOCAL PvE</span><h3 tabIndex={-1}>何から始める？</h3><p>コード入力・保存・ログインなしで最初の戦闘へ。</p>
      <div className="journey-desktop journey-start-grid">
        <article><span>01 / QUICK</span><h4>用意された戦型で始める</h4><p>同梱Catalogの5 HeroとStarter Jinreiを確認し、実Compilerで準備する。</p><button type="button" disabled={!p.coreReady || !p.draft} onClick={() => start("quick")}>すぐ戦う</button></article>
        <article><span>02 / CUSTOM</span><h4>自分の戦型を作る</h4><p>Hero・Skill計画・Squad・Jinreiを同じDraftで編集する。</p><button type="button" disabled={!p.coreReady || !p.draft} onClick={() => start("custom")}>自分で編成</button></article>
        <article><span>03 / CONTINUE</span><h4>編集と保存から再開</h4><p>未保存Recoveryと明示保存したRestore Pointを選ぶ。</p><button type="button" onClick={() => p.setScreen("resume")}>続きから</button></article>
      </div>
      <div className="journey-mobile journey-start-mobile"><article><span>最初の1戦</span><h4>5 Heroで出撃しよう</h4><p>編成と戦術は用意済み。内容を確認して準備へ。</p><button type="button" disabled={!p.coreReady || !p.draft} onClick={() => start("quick")}>すぐ戦う</button></article><details><summary>自分で作る・再開する</summary><button type="button" disabled={!p.coreReady || !p.draft} onClick={() => start("custom")}>自分で編成</button><button type="button" onClick={() => p.setScreen("resume")}>続きから</button></details></div>
      {!p.coreReady && <p role="status">Core / Catalogを確認中です。準備ができると開始できます。</p>}
      <p className="journey-local-note">{p.recoveryRestored ? "未保存Draftを復旧済み。Quick / Customも現在の編集を保持します。" : "現在のDraftを引き継ぎます。新しいPresetへの置換は確認画面で選べます。"}</p>
      <p>旧版Tactics・Battle lab・Library、G1サンプルは別のルールと保存領域です。左の旧版メニューから開けます。</p>
    </>}
    {p.screen === "conditions" && <><span className="next-eyebrow">S02 · 対戦条件</span><h3 tabIndex={-1}>ローカルPvE</h3><div className="journey-condition-grid"><article><h4>同梱Nextルール</h4><p>{p.packageValue.ruleset.id} · {Object.values(p.packageValue.ruleset.version).join(".")}</p><p>WorldはこのRulePackageの同梱Mapを使用します。</p><details><summary>バージョン詳細</summary><code>{p.packageValue.ruleset.digest}</code></details></article><article><h4>対戦相手：同梱Starter</h4><p>既存Next実行経路の固定相手側編成・Starter戦術を使用します。難易度・別NPCは未提供です。</p><p>このローカル対戦の初期相手編成：{p.rivalSlots.map(slot => `${slot.catalog_id} ${p.nextRules.heroes.find(hero => hero.id === slot.catalog_id)?.name ?? "Unknown"}`).join(" / ")}</p><p>戦闘中は公開Replayと自軍に許可された観測だけを表示します。</p></article></div><div className="journey-actions"><button type="button" onClick={() => p.entryMode === "custom" ? p.edit("collection") : p.setScreen(p.entryMode === "review" ? "ready" : "preset")}>この条件で進む</button></div></>}
    {p.screen === "preset" && <><span className="next-eyebrow">S03 · QUICK PRESET</span><h3 tabIndex={-1}>この戦型で始める</h3><p>{p.recoveryRestored ? "復旧した現在のDraft" : "現在のDraft（初回は同梱Starter）"}。Hero・取得予定・所属・起点を確認してください。</p><div className="journey-desktop">{summary}</div>{mobilePreset}<article><h4>Jinrei：{p.draft?.program_input.kind === "text" ? "テキスト戦術" : "構造化戦術"}</h4><p>初回のStarterは各Heroの移動・取得予定Skillの条件を記述済みです。下の内容を実Compilerで検証してから開始します。</p><details><summary>現在の戦術を読む</summary><pre>{p.draft?.program_input.kind === "text" ? p.draft.program_input.source : JSON.stringify(p.draft?.program_input.ast, null, 2)}</pre></details></article>{editLinks}<div className="journey-actions"><button type="button" onClick={() => p.setScreen("ready")}>準備確認へ</button><button type="button" onClick={() => { if (window.confirm("現在の編成とJinreiを同梱Starterに置換します。明示保存した設定は保持されます。続けますか？")) p.newPreset(); }}>初期Presetを使い直す</button></div></>}
    {p.screen === "ready" && <><span className="next-eyebrow">S10 · PREFLIGHT</span><h3 tabIndex={-1}>準備確認</h3><p role="status" data-testid="preflight-status">{p.checking ? "検証中：実CompilerとEnbuの開始時検証" : p.ready ? "開始可能" : p.failure ? p.failure.status === "invalid" ? "不正：開始時検証に失敗しました" : p.failure.status === "unverified" ? "未検証：現在の設定を再検証してください" : "検証失敗：Core・読込状態を確認して再試行してください" : missing ? "不足：Hero・Skill・Squad・起点・戦術を設定してください" : "未検証：現在のSnapshotの開始条件を確認してください"}</p><div className="journey-ready-grid journey-desktop">
      <article><h4>Hero・Skill計画・Squad・起点</h4><p>{p.ready ? "有効：Enbu初期構成検証済み" : "未検証：実Enbuが合法性を確認します"}</p>{summary}{editLinks}</article>
      <article><h4>Jinrei / RulePackage / World / 相手側</h4><p>{p.compiled ? "自軍：現行Draftをコンパイル済み" : p.stale ? "自軍：Compile失効・再コンパイルが必要" : "自軍：未コンパイル"}</p><p>{p.ready ? "両陣営のProgram・構成・実行Context：検証成功" : "両陣営のProgram・構成・実行Context：未検証"}</p><button type="button" onClick={() => { p.setEntryMode("review"); p.setScreen("conditions"); }}>対戦条件を確認</button><p>Coverage：Not Proven。静的な全状態の保証とは別に開始条件を検証します。</p><p>Behavior Profile：同梱Packageの宣言に従います。未宣言のDefaultを適用済みとは扱いません。</p><label><input type="checkbox" checked={p.includeDiagnostics} onChange={event => p.setIncludeDiagnostics(event.target.checked)} /> 自軍のローカルReplay・診断を収集する（任意）</label></article>
    </div><div className="journey-mobile journey-ready-mobile">
      <ol className="journey-checklist">{([["collection", "5 Hero", p.slots.length === 5 ? "5 / 5 設定済み" : "不足"], ["skills", "Skill計画", "取得予定を設定"], ["squads", "Squad・起点", "共有Nodeを確認"], ["jinrei", "Jinrei", p.compiled ? "Compiled" : p.stale ? "Compile失効" : "未コンパイル"]] as const).map(([target, label, detail]) => <li key={target}><button type="button" onClick={() => p.edit(target)}><span><strong>{label}</strong><small>{detail}</small></span><b>{p.ready ? "検証済み" : "修正 →"}</b></button></li>)}</ol>
      <details><summary>編成・取得予定の詳細</summary>{summary}</details>
      <button type="button" onClick={() => { p.setEntryMode("review"); p.setScreen("conditions"); }}>対戦条件を確認</button>
      <p>{p.ready ? "両陣営・Context：Enbu開始時検証済み" : "両陣営・Context：未検証"}</p>
      <details><summary>Coverage・診断オプション</summary><p>Coverage：Not Proven。未宣言のBehavior Defaultを適用済みとは扱いません。</p><label><input type="checkbox" checked={p.includeDiagnostics} onChange={event => p.setIncludeDiagnostics(event.target.checked)} /> 自軍のローカルReplay・診断を収集する（任意）</label></details>
    </div>{p.failure && <div role="alert" className="next-error"><div><strong>{p.failure.status === "invalid" ? "不正・開始拒否" : p.failure.status === "unverified" ? "未検証・再確認が必要" : "検証処理を完了できませんでした"}</strong><p>{p.failure.message}</p>{editLinks}</div></div>}<div className="journey-actions"><button type="button" disabled={p.checking || !p.coreReady || missing} onClick={p.check}>検証・コンパイル</button><button type="button" disabled={!p.ready || p.checking} onClick={p.launch}>戦闘開始</button><button type="button" onClick={() => p.setScreen("resume")}>保存・復旧（任意）</button></div><p>保存は開始条件ではありません。編集すると関連するCompileと開始検証が失効します。</p></>}
    {p.screen === "running" && <><span className="next-eyebrow">S11 · ENBU</span><h3 tabIndex={-1}>ローカル戦闘を実行中</h3><p role="status">確定SnapshotをRust / WASMで計算しています。結果が確定するとReplayへ進みます。</p><p>戦闘は完全自動です。この間に設定を変更せず、完了をお待ちください。</p></>}
    {p.screen === "resume" && <><span className="next-eyebrow">S14 · NEXT SAVE / RECOVERY</span><h3 tabIndex={-1}>続きから</h3><p>{p.recoveryRestored ? "未保存Recoveryを復旧済みです。" : "現在の編集を保持しています。"} {p.saved ? "明示保存したRestore Pointもあります。上のRestore savedで読み込めます。" : "互換性のある明示保存はありません。"}</p><p>保存・Import・Exportは上のNext専用コントロールから操作できます。旧版Libraryとは独立しています。</p><div className="journey-actions"><button type="button" disabled={!p.draft} onClick={() => p.edit("collection")}>編集を続ける</button><button type="button" disabled={!p.draft} onClick={() => p.setScreen("ready")}>準備確認へ</button></div></>}
  </section>;
}
