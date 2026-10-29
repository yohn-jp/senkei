# Execution Dispatcher — 証明優先の振り分けと総コスト

> 状態: 提案するEnbu内部契約。Dispatcherはゲームルールを解釈し直さない。Strategyの適格性を確認し、物理方式だけを選択する。

## 1. 責任

\`Execution Planner\` のDomainPlan/FrontierCertificateを受け取り、**厳密に同値な候補のみ**を比較し、最小の実行コストが見込めるStrategyを選ぶ。選択単位は原則として**証明済み因果領域と有限窓**。全試合を一つの方式へ固定する必要はない。

\`Hybrid\` は同じ試合で複数の方式を併用する全体設計、\`Adaptive\` は観測した実コストと依存状態に応じて切替する方針を指す。どちらもRulePlan上の新しい戦闘Capabilityではない。

## 2. 共通入出力（概念API）

\`\`\`text
DispatchRequest {
  plan, domain_id, frontier_certificate, required_outputs,
  active_workset, recent_cost_samples, switch_budget
}
Candidate {
  strategy_id, eligibility_proof, guaranteed_next_boundary,
  estimated_cost, memory_bound, fallback_mode
}
Decision {
  strategy_id, bounded_window, estimated_cost, proof_ref,
  rejected: [(strategy_id, guard_reason)],
  execution_generation, fallback_reason?
}
\`\`\`

次の順に処理する。

1. **証明/上限ゲート**: 計画世代・依存版・窓の有効性、全必要出力・メモリ/イベント/診断/CU・errorが一致する候補だけ残す。
2. **cheap guards**: no-work、明白なsingleton、first-volleyなどを、条件が証明されるときだけ調べる。重いPlannerを先に作ると負けるため、guardコストも測る。
3. **候補の費用比較**: 計画構築からProjectionまで含む総予測費用を見積もる。
4. **継続・切替**: 改善幅が切替・invalidate・再構築コストと必要な安全余裕を超える場合のみ切替する。
5. **実行/計測**: 結果と必要なWork/Cost countersを記録し、適格性が失効したら**原子的に**Referenceへ復帰する。

\`\`\`text
if certificate missing/invalid:
    choose ReferenceTick(reason)
else:
    eligible = strategies.filter(verified_guards AND output_and_limit_support)
    if eligible empty: choose ReferenceTick(reason)
    else:
        choose argmin(fully_charged_cost)
        subject to switching_hysteresis AND memory_budget
\`\`\`

同じ入力と同じ版付きモデルに対する選択は決定的でなければならない。端末のCPU時間で選択が変わっても**結果**の決定論は保持されるが、同一条件での診断・再現性を重視し、同版/同測定プロファイル下では固定のtie-breakを用いる。ホストごとの適応パラメータは論理Artifactに混入させない。

## 3. 最小化対象

\`\`\`text
NetCost =
  classify + partition + compile
  + execute + materialize + output_serialize
  + invalidate + replan + switch
  + synchronization_barriers + logical_CU/replay_reconstruction
\`\`\`

単位は**実測したwall time**。副指標にbyte allocation、peak linear memory、論理CU（等価確認用）、visited states、数値演算数、schedulerイベント数を持つ。課金量は目的関数ではなく**等価性制約**。

\`C_plan\` が重ければ実行を速くしても総時間が悪化する。短い試合、少人数、Replayの出力件数が多いケースではReferenceが勝ってよい。

\`C_materialize\` は「あとで必要になったら無料」とみなさない。既存の全TickReplay APIを維持するなら全必要フレームの計算・書出し費用を含める。

## 4. 推奨カスケード（固定の勝者表ではない）

| 最初に検査する特徴 | Strategy候補 | 証明不能なら |
| --- | --- | --- |
| 出力含めて仕事がない閉じた窓 | No-work Planned guard | Reference |
| 最初の同Tick一斉攻撃で決着・外乱なし | First-volley / Arithmetic | Queue/Reference |
| 1主体だけが独立し時計が確定 | Singleton Arithmetic / Periodic | Active/Reference |
| 狭い群で少イベント | Scan | Heap/Reference |
| 疎な未来イベント/長い空白 | Heap | Active/Reference |
| 多数の同時または近接イベント | Bucket | Active/Reference |
| 定周期かつ証明済み不変窓 | Periodic / Arithmetic | Queue/Reference |
| 変更集合が小さく依存が局所 | Active Set | Reference |
| 全体観測/Jinrei/不明な規則や短い窓 | Reference Tick | — |

この表は**候補列挙順**であり、ランタイムが現在すべて実装しているという宣言ではない。\`A<=8\` や \`E<=12\` といったTS研究の閾値はRust/WASMに直接採用しない。実測値から版付きポリシーを決める。

**常にReferenceを候補に含める**。Referenceが最安ならそれを選択し、Hybridの成功を「全ケースで非Reference選択」と定義しない。

## 5. 切替・再計画の規範

- 切替は正規のTick/phase境界または厳密に定義された原子的Domain checkpointでのみ許可する。
- 外部に公開済みのCU/event/diagnostic/Replayを巻き戻して二重生成してはならない。
- Certificateの世代変更またはより早いEvent発生時は当該窓を打切る。部分未公開結果は破棄して、Referenceから整合するCheckpointを再評価する。
- \`predicted_new_cost + switch_cost + safety_margin < predicted_keep_cost\` を基本の切替条件とする。ただし安全性ゲートはこの比較より優先。
- 同じ候補間の行き来が連続する場合はhysteresis/最低継続窓を設定する。ただし証明失効時には**即座に安全なfallback**する。
- 計測・校正は既存Battlefield/RulePlan/CPU/WASMビルドの特性を記録し、古いプロファイルを別条件へ黙って転用しない。

## 6. 監査可能な選択の記録

選択には以下を内部の物理診断として添付できる（提案形）。

\`\`\`text
DispatchTrace {
  source_revision, engine_build, plan_generation, domain_id, tick_window,
  eligible_candidate_ids, rejected_reasons, chosen_id,
  projected_total_cost, observed_total_cost?,
  actual_skipped_work, actual_materialized_outputs,
  invalidation_reason?, fallback_reason?
}
\`\`\`

選択ログは**ゲームのDecision TraceやJinreiのCU課金**と別。性能用デバッグ情報を公開/owner Projectionへ勝手に追加しない。隠れた敵の位置やPrivate Programが漏れない集約形式でのみ公開可能。

## 7. 失敗・反例

- **dense hits**: Heapのイベント数が膨らみArithmetic/Bucketより遅いことがある。
- **very small group**: Priority Queueの生成費用がScanを上回る。
- **non-monotone combat**: Heal/Shield/target変化を含む群をArithmeticに割り当てると誤る。
- **periodic fog**: 研究モデルが周期的でも実Fogは施設/視界/履歴/観測が毎Tick変わり得る。
- **short horizon**: 一般分類自体が参照実行より重いことがある。
- **global Jinrei**: 敵の全体観測・順位比較・Memory更新により独立Domainが証明できない。

失敗時は「次に速そうなアルゴリズムへ推測で移す」のではなく、**対応する新しい適格証明**がある候補だけを再評価する。

## 8. 受入ゲート

- 同じ入力とコストモデルで選択記録と完全Artifactがnative/WASMで一致する。
- すべてのStrategyの採用/拒否/fallback/切替/無効化をテストする。
- Cost構成要素の実測を揃え、短期コスト優位・切替閾値・規則変更時の挙動を検証する。
- 現行の[Reference Tick](SEMANTICS.md)と[Conformance](CONFORMANCE.md)の完全一致ゲートに先行しない。

関連: [PLANNER](PLANNER.md)、[SCHEDULER](SCHEDULER.md)、[STRATEGIES](STRATEGIES/README.md)、[MIGRATION](MIGRATION.md)。
