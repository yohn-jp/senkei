# Active Set — 依存関係に基づく増分実行

> 状態: 設計対象。TS \`active\` は別の合成モデルであり、EnbuのEntityをそのまま眠らせられる証拠ではない。

## 1. 目的と最適化対象

現行Enbuでは、\`crates/enbu/src/next_combat.rs::collect_basic_attacks\`、\`next_navigation.rs::advance_inner\`、\`next_vision.rs\` 等が多くの候補Entity/Worldを逐次調べる。**ある作用主体に影響する入力が変わっていない**ことが証明できる場合にのみ、その主体の判定を次の必要時刻まで省略する。

\`\`\`text
ActiveSet[phase, tick] = {
  dependency node | required evaluation is due now or a relevant write invalidated it
}
\`\`\`

「active」は生存と同義ではない。死亡していてもRespawn条件がdueなら対象になる。現在HPが不変でも、JinreiやFog出力が必要なら対象になり得る。

## 2. 必須の依存キー

最低限の追跡粒度：

- \`EntityField(entityId, field)\`: HP、attack_ready、position、skill/lock、vision、goal、owner等。
- \`EntityMembership(type/side/collection)\`: 生死、spawn、塔/Minion構造変化、観測集合。
- \`Spatial/GraphRegion(node/edge)\`: 接近・射程・視界・地形・橋・占有・track。
- \`SquadGroup(side,squad)\`: 成熟、同時移動、連携、発動/攻撃ロック。
- \`GlobalRule/Timeline/Memory/Output\`: RulePlan、Tick、Program、TacticalMemory、CU、Replay/Owner Fog。
- \`UnknownGlobal\`: 影響が限定できないとき、関連領域すべてをactiveへ戻す。

現実のRead/Write情報は [Planner](../PLANNER.md) が所有する。Activeカーネルが独自推論で依存を減らしてはならない。

## 3. 実行擬似コード

\`\`\`text
compile_dependencies(plan, world) -> reverse_index
for each canonical Tick boundary:
  active += due_events(tick)
  active += dirty_frontier
  active += every mandatory phase/observation obligation
  for each phase in canonical order:
    candidates = stable_order(active[phase])
    evaluate candidates with frozen phase snapshot
    stage changes (do not mutate earlier readers)
    commit exactly once
    changed_keys = diff_authoritative_writes()
    active[future_phases_or_ticks] += reverse_index(changed_keys)
    if unknown dependency: expand to reference/full set
  emit materialized outputs and check limits
\`\`\`

最初に高価な全World依存グラフを構築すると、少数Tickでは逆効果になり得る。初期分類/再利用/invalidated再構築の費用を含めてDispatcherが採否を決める。

## 4. 省略可能となる条件

対象actor \`a\` に対して現在のphaseの処理を省略できるのは、次が**すべて**成立するときに限る。

- 当該phaseが読み込む全キーの版が直前に証明したものと同じ。
- 時計/expiration/ready/goal進捗など、Tick経過だけで変化する要素の期限が先にない。
- 相手・中立・Squad・Global/terrain/vision/observationの間接変更が依存グラフで伝播済み。
- 当Tickにそのactorの決定・出力・課金・診断が不要、または厳密に実体化できる。
- チェック対象期間がCertificateの期限内にある。

攻撃する準備がまだ整わないactorの「ターゲット距離判定」は飛ばせても、同TickのJinrei評価・CU・所有者Fogを飛ばせるとは限らない。**最小化単位は必ずしもEntity全体ではなく、phaseの読み取り作業**である。

## 5. 正規性を失いやすい例

| 反例 | 誤った最適化 | 必須対処 |
| --- | --- | --- |
| 敵が射程へ侵入 | 自軍actorは何も書いていないためinactive | 相手の位置/視界Readに反応してactive化 |
| 攻撃者の死亡 | alive falseで過去の同Tick予約を除去 | 凍結フェーズの選択済み攻撃はcommit |
| Siege橋破壊 | 移動goalは同じなので停止予定を維持 | topology/bridge/track dependency invalidate |
| Squad split | 非リーダーだけの状態変化を無視 | 共有速度、行動lock、shieldへ伝播 |
| FogのReveal期限 | visible sourceは静止しているので更新なし | expiry予定でowner投影を更新 |
| JinreiのMemory更新 | 前Tickと同じIntentなので評価なし | 論理評価・課金・診断契約に従う |
| タワー攻撃 | 所属が同じの別targetにも判定必要 | 正しいtarget集合/side/可視性依存 |

## 6. 計算量

活性割合が低いとき、あるPhaseの判定を \`O(A)\` から \`O(|Active| + |invalidated_dependencies|)\` へ近づける。ただし前処理 \`O(A+D)\`、安定順序化、RulePlanのglobal barriers、Replay出力が含まれる。\`A\` 全体に依存する戦術や観測があれば全件へ戻る。これは正しい動作であり性能不具合とは限らない。

## 7. 実装ゲート

1. Snapshotを保存し、当該phaseの全件Reference結果とActive候補結果を比較。
2. 差分のある1属性だけを変更し、dirty伝播する/しない境界を検査。
3. Target、Skill、vision source、bridge/ford、Minion wave、respawn、同Tick死、owner Fogの反例を実行。
4. Normal / aborted / error の完全Artifact、CU/diagnostics、native/WASM equalityを確認。
5. Work counters（判定したEntity、スキャン数、active更新数）と総wall timeを計測。

本Strategyは局所判定の増分化であり、全Tickのスキップを無条件に正当化しない。時間スキップには [Scheduler](../SCHEDULER.md) と [Semantics](../SEMANTICS.md) の別証明を要する。
