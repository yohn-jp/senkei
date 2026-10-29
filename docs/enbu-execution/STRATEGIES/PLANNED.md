# Planned — 有限窓の先読みと直接特殊化

> 状態: 実装予定。TSの \`plannedRun\` / \`buildPlan\` で検証した「群の特徴を一度だけ調べて適切なカーネルへ送る」思想を、因果証明付きのEnbu有限窓へ適用する。

## 1. 役割

\`Planned\` は一つの攻撃実行式というより、**独立Domainの閉じた窓に対して正しい直接カーネルを構成するStrategyファミリ**である。全体のStrategy選択・切替権限は [Execution Dispatcher](../DISPATCHER.md) にある。

事前に双方の命令が確定していても、途中のJinrei判断・Memory・Fog・Bridge・戦闘結果は固定とは限らない。**確定した入力**と**確定した未来の状態**を混同しない。

## 2. まず安い証明ガードを評価する

候補は原則的に以下の順に評価するが、閾値や判定順は実WASMのコストで校正する。

1. **No-work**: その窓内で状態・観測・出力・課金に変化しないことが証明される。Executor/Queueを作成しない。
2. **First volley**: 最初に命中する攻撃群だけで決着し、途中の全依存・効果を復元できる。攻撃時刻だけ直接導出。
3. **Singleton**: actor→targetが証明済みの一対一閉域で、他者と共有効果がない。直接Arithmetic/Periodic。
4. **Small group**: 走査の方が安い独立な小群ならScan候補。
5. **Permanent visibility / monotone**: Arithmetic候補。
6. **Certified periodic**: Periodic/phase cache候補。
7. **General sparse/dense**: Heap/BucketまたはActive Setを比較。
8. **Coupled/unknown**: Reference Tickへfallback。

これは**適用可能性の候補探索**であり、シナリオ名や推測された「平均的な勝者」で分岐しない。すべての候補は独立のEligibility証明を要する。

## 3. 一回走査の計画

\`\`\`text
build_domain_plan(world, dependencies, [a,b], outputs):
  if cheap_guards_prove_no_work(): return IdlePlan
  scan eligible actors ONCE:
    collect stable actor IDs and target membership
    collect first_possible_due, interval, attacks_upper_bound,
            required output count, visibility/lock/target dependencies
    mark coupling and unknown reads
  derive certified domains and their frontiers
  for each independent domain:
    try direct_singleton_or_first_volley
    else emit candidate strategy constraints for Dispatcher
  never publish plan if unresolved dependencies remain
\`\`\`

既存TS研究の \`O(A+G)\` 分類を目標とするが、実EnbuではRead/Writeグラフと各種グローバル判断の費用が追加される。単にactorをID順に束ねただけでは因果独立の証明にはならない。

### 特別な直接経路

- \`bijective\`（actorとtargetの一対一関係が厳密に成立）なら一般的なshared-target group配列の構築を避ける。
- 何も発火しないと証明できる群はExecutorとMutable Actor Objectを作らない。
- 最初の一斉攻撃で終わる群は次期予定Queueを作らず、単発の正規同時効果/出力へ接続。
- 出力Captureが必要なら、結果だけ出す式に切り替えない。必要なイベント実体化の費用を選択時に含める。

## 4. 計画と実行状態を分離

\`\`\`text
ImmutablePlan {
  source_rule_and_world_identity, read_write_certificate,
  stable_actor_indices, target_groups, output_contract, horizon
}
MutableExecution {
  current_tick, actor_clocks, staged_effects,
  materialization_cursor, dirty_dependency_versions
}
\`\`\`

計画は不変で再利用できても、**異なるWorldや異なる時刻のMutableExecutionへそのまま転用できるわけではない**。境界で必ずvalidityを検査する。オリジナル入力のクローン間で共有する場合も内容versionとoutput modeが同じか確認する。

## 5. 先読み可能な範囲の決め方

\`window_end\` は現時点で確定した次のFrontier以下に制限する。

- Next Wave/Respawn、status期限、HP変化/攻撃、Bridge state、capture contest、Squad maturity。
- 双方Jinrei/Behaviorの次の意味的評価（CU/Memory/traceを含む）。
- 次の必要なowner観測/Public Frame、host limit到達可能Tick。
- Dynamic RulePlan phase/terminationが生む未知の早期効果。

初期段階では大半の窓が1 Tickに縮退してもよい。**証明が成立した範囲からのみ圧縮を拡大**する。

## 6. 無効化と実体化

\`\`\`text
plan.execute_window(snapshot):
  require dependency versions unchanged
  prepare staging without committing external effects
  use selected exact kernel for certified subwindows
  at each proven frontier:
    stage all required canonical transition/event/owner/CU/trace records
    validate dependencies and limits
    publish once in stable Tick/phase order
  if unproved change:
    discard unpublished work
    resume Reference Tick from last committed checkpoint
\`\`\`

リプレイが全Tick必要であれば、各TickのOwner Fogやpublic viewを物理生成する必要があることを明示する。予定が同じでもJinreiの評価を省くとは限らない。

## 7. 証明例/反例

| 状況 | 計画 |
| --- | --- |
| 視界も移動もない閉じた2者の固定target | Arithmetic/Singleton候補 |
| HP1のtargetに同Tick複数攻撃が命中 | First-volley候補。ただし全員の攻撃は残す |
| 二群で同じ視界sourceに依存 | SCC/跨り依存があるため独立群にできない |
| Tick 7でSkillにより攻撃周期が変化 | そのTickより先の計画を無効化 |
| 完全Replayとowner TickごとFogが必要 | 出力Materializationなしに窓全体を省略不可 |
| 勝敗確定が予定より早まる | 当該終局境界で停止し、後続予定を発行しない |

## 8. 合格条件

- TS syntheticとは独立した**Reference Enbu**比較で、No-work/First-volley/Singleton/Generic fallback全経路を検査。
- \`plan\` を異なるWorldへ使ったら必ずrejectする。相手命令が同じでもWorld版が違えば有効とみなさない。
- \`classification + execute + materialize + switch + serialize\` の総コストで優位性を判断。
- 終局Tickと同Tickイベント、Owner/公開Replay、CU/診断/host limits、native/WASMが一致。
- 選択理由、証明証跡、失効時刻、skipした物理処理数を内部計測できる。

関連: [PLANNER](../PLANNER.md)、[DISPATCHER](../DISPATCHER.md)、[STRATEGIES](README.md)、[CONFORMANCE](../CONFORMANCE.md)。
