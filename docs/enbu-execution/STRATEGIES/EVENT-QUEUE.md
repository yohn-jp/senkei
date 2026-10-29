# Event Queue — Heap / Bucket / Scan

> 状態: 独立した3つの**計算カーネル設計**。Event QueueはFuture Workをスケジュールする物理データ構造であり、RulePlanのイベント意味論を所有しない。

## 1. 共通仕様

- \`Key = (tick, canonical_phase, rule_order, stable_actor_id, stable_event_id)\` を規範順序として扱う。
- 同Tickの複数候補は**先に凍結状態から選択し、後で規範順序で同時commit**する。Queueから取り出した順に個別のHPを書き換えない。
- 将来の \`attack_ready\`、\`effect_until\`、wave/respawn、到着などを予約しても、対象/視界/合法性は正本のTickフェーズで確認する。
- GenerationとDependencyVersionが異なるエントリはstaleとして破棄し、未来の旧予定を実行しない。
- 出力義務を捨てた「イベント数の少なさ」は性能比較の根拠にならない。

\`\`\`text
kernel.next_due() -> earliest (Tick, Phase) or None
kernel.push(schedule)
kernel.invalidate(domain_generation)
kernel.drain_same_tick_phase() -> stable batch
  -> validate snapshot & eligibility
  -> phase-preserving canonical transition
  -> materialize/public projection
\`\`\`

## 2. Heap: 疎なイベント列

二分min-heapなどで次の期限を管理する。

- \`push/pop O(log Q)\`、peekは \`O(1)\`、stale entryの検査・破棄は追加費用。
- 非常に長いTick空白で予定が少なければ、毎Tick全actorを巡回するより有利。
- 永続的な期限がないものや、外部依存で予定時刻が短縮され得るものには**通知/invalidated契約**が必要。
- \`Q\` のサイズ上限、同Tickバッチの全件取得、深い未来時刻のoverflowを扱う。

**反例**: 毎Tick全actorが攻撃する密集戦では大量push/popが発生し、直接ScanやArithmeticより遅いことがある。

## 3. Bucket: 密な既知範囲

固定/移動窓 \`[t, t+W)\` をTick番号で配列/循環バケット化する。

- 事前割当 \`O(W)\` のコスト。push/popは平均的には小さくできるが、各slot内の安定整列と世代確認費用が残る。
- 小さい確定窓で同Tickイベントが多数ある場合の候補。
- 外部の未知の早期変化をカレンダーから排除してはならない。時間の折返し（ring）でgenerationが違う古いイベントを混同しない。

**反例**: Tick 1から100万までにイベントが一度しかないのに100万バケットを確保すると、Heapより悪い。

## 4. Scan: 小さな独立群

各actorの次回期限を保持し、未完了群の最小dueを線形走査する。

\`\`\`text
while within_window:
  t = min(next_due_for_actor)
  due = all actors where next_due == t
  stage simultaneous actions for due with reference predicates
  commit exactly once
  recompute schedules only for impacted actors
\`\`\`

- 群サイズ \`A\`、発火回数 \`E\` に対し \`O(AE)\`。Heap生成/メモリ費用が相対的に高い**小規模な群**で検討する。
- 走査のたびに全WorldのEntityStateを構築しない。必要な属性だけを持つ小さいランタイム構造を使う。
- SchedulerやRead/Write証明の外では、Scan自体が安全性を提供しない。

**反例**: actorが多く頻繁に発火する場合 \`O(AE)\` が支配的になる。

## 5. 同Tickの原子的な窓

\`\`\`text
t = next_due_tick()
freeze canonical pre-selection snapshot for t
collect every due event of the same authoritative phase at t
if stale/unproved: fallback before any publish
select all permitted actions with reference priority/tie-break
accumulate simultaneous damage/effects
commit in canonical phase order
emit scheduled/unscheduled canonical output obligations
invalidate and schedule new dependent work
\`\`\`

入力到着順やQueue実装順が違っても出力順/攻撃結果が一致すること。死亡者の同Tick攻撃はキャンセルしない。TargetのShield/Heal/反撃、同時基地破壊、Skillで優先順が変わるケースは単純なQueueカーネルでは不適格となり得る。

## 6. Crossoverと費用モデル

| 要素 | Heap | Bucket | Scan |
| --- | --- | --- | --- |
| 初期化 | \`O(Q)\` もしくはpushで \`O(Q log Q)\` | \`O(W)\` | \`O(A)\` |
| 次時刻取得 | \`O(1)\` peek | 空slot探索/ビットマスクの構造に依存 | \`O(A)\` |
| 期限更新 | \`O(log Q)\` | 期日内はslot更新 | actor clock更新 |
| 同Tickバッチ | \`O(B log Q)\` + 整列 | \`O(B)\` + 整列 | \`O(A)\` で抽出 |
| Memory | \`O(Q)\` | \`O(W+Q)\` | \`O(A)\` |

\`B\`: 同Tickの処理対象、\`W\`: Bucket幅。各処理には**共通のPlanner/Certificate/Materialization費用**が加算される。閾値はTSベンチの固定値を流用せず、実Rust/WASMで校正する。

## 7. 適格性・無効化・検証

Eligibility: 窓内で全ての意味のある未来イベント/影響を予約できること、書込みと再予約が完全に追跡されること、出力義務が実体化できること。条件に合わないときは [Reference Tick](../SEMANTICS.md) または別の証明済みStrategyを選ぶ。

必須検証は以下。

- 同Tick複数対象/同一対象、相互致死、Hero/Minion/Tower/Monster、Skill/Shieldが介在。
- \`attack_ready\` のちょうどのTick、終了Tick、効果期限切れ、Respawn予定の変更。
- 重複イベント・取消・旧generation・バケット再利用・clock overflow。
- WorldState、OwnerFog、Replay、CU、診断、エラーと上限までReferenceと完全一致。
- queue生成・バッチ化・invalidate・出力まで含む実WASM総コスト比較。

参照: [SCHEDULER](../SCHEDULER.md)、[STRATEGY CONTRACT](README.md)、[CONFORMANCE](../CONFORMANCE.md)。
