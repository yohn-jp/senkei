# Execution Planner — 因果領域と境界証明

> 状態: 実装予定の内部設計契約。既存Enbuは本書の \`ExecutionPlan\` 等の型を提供していない。既存のVerifiedRulePlan/Jinrei/WorldStateを意味論上の正本として用いる。

## 1. 所有する責務

Plannerは **何が互いに影響するか** と **次に意味のある変化が起こり得る最短境界** を求める。高速な実行Strategyを選ぶのは [Dispatcher](DISPATCHER.md) の責務。イベント予約を実際に維持するのは [Scheduler](SCHEDULER.md) の責務。

Plannerは以下の入力の不変IDと版を受ける。

- \`VerifiedRulePlan\` とRulePackage/World logic identity、phase/order、termination、host limits。
- 両Program/Behavior/Route/Relation bindings、Jinrei cost schedule、memo/Memoryの依存版。
- 現在のWorldState、直近の確定Tick、最大Tick、Entity集合の世代。
- 利用者に要求された出力契約（public+owner Replay、診断、CU、任意Tick等）。
- Schedulerが既知の期限と、変更済み/未知の依存集合。

結果は以下の**概念型**。実装時にRust型名・持ち方は選べるが、フィールドの意味を失ってはならない。

\`\`\`text
ExecutionPlan {
  input_identity: (rule_digest, world_logic_digest, program_digests,
                   behavior_digest, cost_schedule_version, engine_version),
  base_tick, horizon,
  domains: [DomainPlan],
  global_barriers: [Barrier],
  output_contract,
  version: PlanGeneration
}
DomainPlan {
  domain_id, ordered_members, read_set, write_set,
  proved_independence, eligible_strategies,
  bounded_window: [from_tick, frontier_tick],
  certificate, output_obligations
}
FrontierCertificate {
  plan_generation, input_identity, source_tick, expires_before,
  dependencies: [(key, version, required_value_or_constraint)],
  scheduled_boundaries, invalidation_triggers, checked_host_limits,
  proof_kind, assumptions, required_materialization
}
\`\`\`

**重要:** \`expires_before\` は「そのTickまで何も起きない」という単独の主張ではない。独立性、各属性の変化式、観測/課金出力を再現できる条件とセットで初めて有効。

## 2. Read/Write依存の分類

Plannerは \`EntityId + field\` に加え集合形状/陣営/時間/全体集約を表せるキーを使用する。

| 依存種別 | 代表的なRead | 代表的なWrite/無効化要因 |
| --- | --- | --- |
| 戦術/Behavior | owner observation、Memory、RulePlan、CU、現在Tick | Intent/Memory/診断、次Tickの行動・対象 |
| 移動/経路 | node/edge/progress、goal、速度、障害、橋、Squad | 位置、move marker、予約、視界の基点、経路 |
| 戦闘 | 攻撃間隔、ready、射程、視界、target、damage/defense/shield | HP、shield、death、XP、level、lock、effect、event |
| 視界/Fog | 位置/視界半径/Reveal、map graph、side、施設観測履歴 | owner/public visibility mask、explored、last-known施設 |
| ライフサイクル | Tick、spawn/wave周期、respawn_at、効果期限 | Entity集合、alive、energy、status、cooldown |
| 施設/環境 | Bridge/Ford/track、周辺Hero、支配状態 | 橋状態、捕捉/contest、移動合法性 |
| 任意RulePlan | phase条件、宣言的expression/collection/transition | Global/Entity fields、イベント、終局、競合/エラー |
| 出力/安全 | 上限、CU/diagnosticsカウンタ、Replay/owner履歴 | 出力配列、エラー時点、host-abort/結果 |

次の**非局所依存**は対象IDが異なっても接続する。

- 一つのHeroの移動が複数敵の視界と攻撃対象選択を変える。
- 同じSquadの別Heroが行動ロック/速度/盾/成熟を変える。
- 中立施設のCaptureが相手の経路合法性を変える。
- 共通Resource、終局条件、全体Collection/ordered transitionが複数Domainへ書き込む。
- Jinreiの観測集合や順位/集約が戦場全体を参照する。
- FogHistory・Replay・diagnosticsの時刻順序がDomain間の出力を統合する。

\`read_set\` と \`write_set\` が現在のRulePlanまたは拡張Capabilityで列挙できないときは \`UnknownGlobalDependency\` とし、最適化不能としてReferenceへ戻す。知らないものを空集合と扱わない。

## 3. 因果グラフと独立性

概念上はactor/transition/output義務をノード、以下を有向辺とする。

1. 同Tickの先行 phase が後続 phase で読まれる（Read after Write）。
2. 同じfield/集合の複数Write、同じ対象の競合とtie-break。
3. あるノードのWriteが将来TickのRead/decision/observationを変え得る。
4. global host limits/termination/CU/Replay orderingなどの全体障壁。

SCC（強連結成分）は候補分割の**必要な解析道具**だが、SCCが異なるだけで独立性を証明できたことにはならない。結合する有向辺・全体障壁・時間依存が残る場合は、その境界で同期する。全体をまたぐJinrei観測が存在すれば一つの大きいDomainに縮退してよい。

\`\`\`text
derive_dependencies(verified_plan, concrete_world, output_mode)
  -> graph with every unknown/implicit global edge
  -> SCC and barrier analysis
  -> candidate domains
  -> prove no cross-domain causal or observable interference in [t,f)
  -> certificate | Reference-only
\`\`\`

**安全な候補例:** 同じ固定対象に攻撃する二つのactorが独立し、他のRead/Writeがなく、全体出力を再構築できると証明された有限窓。対象数だけでこの結論を出してはならない。

**不安全な反例:** 異なる二つの対象を攻撃するHeroが同じ視界sourceを共有。source死亡で両対象の可視性が変化するため独立ではない。

## 4. Frontierと証明の寿命

Plannerは最初に **cheap guard**（入力ゼロ、作用主体ゼロ、明らかな不能条件）を試す。guardの判定そのものが正規の決定/課金/出力を省けるかが前提である。次に必要なときだけ一度の状態走査からdependencyと統計を同時収集する。

境界 \`f\` は、少なくとも次の最小値を下回らないよう保守的に選択する。

\`\`\`text
f <= min(
  next_known_scheduled_change,
  earliest_possible_dynamic_interference,
  next_unproved_Jinrei_or_RulePlan_evaluation,
  next_required_observation_or_event_boundary,
  output/host_limit_boundary,
  requested_horizon + 1
)
\`\`\`

「変化の**可能性**」がある時刻へ進む前に再検証する。不確かな境界の値を推測して前倒し/先延ばししない。

### 依存証明の無効化

- RulePlan/World topology/Program/Behavior/成本表/host limitsの版変更。
- Entity生成・削除、所属/位置/HP/効果/ターゲット変更、施設・視界・Reveal/Memory変更。
- Schedulerイベントの追加/取消/時刻短縮、予定外の新しい同Tick行動。
- 出力要求（full replay/owner diagnostics、seek対象Tick）の変更。
- 証明書のtick上限超過、乱れたgeneration、未解析phase/plugin。

逆方向の依存グラフでDirty Frontierを伝播し、影響するDomainだけinvalidateする。ただしglobal barrierなら全体をinvalidateする。

\`\`\`text
on_commit(writes, new_tick):
  dirty = reverse_dependencies(writes)
  for each impacted domain:
    bump_versions()
    revoke_future_schedule_entries()
    invalidate_eligible_window()
  if unknown_global_write: invalidate_all()
\`\`\`

CacheはIDだけでなく**内容/論理版と依存世代**で照合する。ポインタ/アドレスが一致するだけでは再利用できない。

## 5. 計算量と限界

新規の任意Worldに対する一般的なactor・target分類は最低限 \`Ω(A+G)\` の初回検査が必要。全体走査の後で同じ項目を再走査しないよう、メンバー集約・read/write統計・時間境界を一度に構築する。

| 処理 | 目標計算量（条件付き） |
| --- | --- |
| 一般的な初回分類 | \`O(A+G+dependency_edges)\` + RulePlan解析 |
| 再利用時の有効性確認 | 変更された依存数/版参照に比例 |
| Dirty伝播 | 到達した依存辺数に比例 |
| 未知のグローバル依存 | 参照へfallback（計算削減保証なし） |

\`A\` は作用主体、\`G\` は候補因果領域数。これらは**目標**であり、現行Enbuの達成済み性能ではない。観測負荷・全体集計が支配的ならPlannerでの投資自体が損になる。[Dispatcher](DISPATCHER.md) はこの費用も評価する。

## 6. 実装・検証ゲート

- stable iteration orderと計画identityはnative/WASMで一致させる。
- 依存版を1つだけ変え、該当DomainのみDirtyになる肯定例と、全球へ伝播する反例をテストする。
- 未知Read/Write、Fog横断、全員対象のJinrei、同Tick更新、HP変化/死亡とBridge変更、RulePlan差替で誤選択を起こさない。
- 差分比較は証明・選択だけでなく最終Artifactの各Tick・CU・owner観測まで必須。
- Plannerの失敗/不完全計画は世界を変更せずにReferenceへ戻す。

関連: [SEMANTICS](SEMANTICS.md)、[SCHEDULER](SCHEDULER.md)、[DISPATCHER](DISPATCHER.md)、[CONFORMANCE](CONFORMANCE.md)。
