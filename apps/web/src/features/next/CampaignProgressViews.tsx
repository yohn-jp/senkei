import "./campaign-progress.css";
export interface CampaignRunActionsProps {
  readonly title: string;
  readonly status: "victory" | "defeat" | "draw" | "incomplete";
  readonly finalScenario: boolean;
  readonly allRecordedComplete: boolean;
  readonly nextTitle: string | null;
  readonly busy: boolean;
  readonly onNext: () => void;
  readonly onRetry: () => void;
  readonly onImprove: () => void;
  readonly onResult: () => void;
  readonly onHome: () => void;
  readonly resultLabel?: string;
}
export function CampaignRunActions(p: CampaignRunActionsProps) {
  return <section className="campaign-run-actions" aria-label="Campaign next actions">
    <strong>{p.title} · 戦後の操作</strong>
    {p.status === "victory" && p.finalScenario && <p>最終課題を攻略しました。{p.allRecordedComplete ? "全課題の攻略を記録済みです。" : "以前の課題の攻略記録が揃っていないため、全課題攻略済みとは表示しません。"}</p>}
    {p.status !== "victory" && <p>今回の結果で新たな攻略・解放は記録しません。編成やJinreiを改善して再挑戦できます。</p>}
    <div className="campaign-action-buttons">
      {p.status === "victory" && p.nextTitle && <button disabled={p.busy} onClick={p.onNext} type="button">次の課題を準備 · {p.nextTitle}</button>}
      <button disabled={p.busy} onClick={p.onRetry} type="button">同じ課題を再挑戦</button>
      <button disabled={p.busy} onClick={p.onImprove} type="button">この課題のJinreiを改善</button>
      <button disabled={p.busy} onClick={p.onResult} type="button">{p.resultLabel ?? "結果を分析"}</button>
      <button disabled={p.busy} onClick={p.onHome} type="button">Homeへ戻る</button>
    </div>
  </section>;
}
