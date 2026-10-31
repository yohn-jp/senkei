# Event Scheduler — 時刻・活性集合・Dirty Frontier

> 状態: **局所実装済み／汎用実行は未完成**。128-Tick周期攻撃候補のScan/Heap/Bucket選択は`execution/arithmetic.rs`から実Enbu戦闘に接続済み（Native実行・WASM比較はこの変更では未検証）。`crates/enbu/src/execution/scheduler.rs` の `EventScheduler` は安定順序、世代つき失効、依存逆引き、最大予約数4096、古い予約の圧縮、正規Tick逐次進行を実装する。`BasicAttackFrontier` と `RevealExpiryFrontier` が実際に使用する。これらは全Tickを飛ばす機構ではなく、入力の厳密な読取集合を各Tick再検査して、証明済みの局所処理だけを省略する。

## 1. データモデル（概念）

```text
EventKey = (tick, phase_order, rule_priority, stable_entity_id, stable_event_id)
ScheduledWork {
  key, kind, domain_id, generation,
  dependency_versions, immutable_payload,
  output_obligations
}
SchedulerState {
  due_queue, active_set_by_phase, reverse_dependency_index,
  generation_by_domain, current_tick, pending_output_bounds
}
```

- `tick`: 正規Tick。非整数/壁時計ベースの時刻を使わない。
- `phase_order`: [SEMANTICS](SEMANTICS.md)で規定した既存RulePlan/Nextフェーズ。
- `rule_priority`: 戦律/調停の規範Tie-breakに由来。Schedulerが勝手に新しい優先順位を発明しない。
- `stable_entity_id/event_id`: 規範順序を保持する安定ID。等時刻のHeap pop順だけを同時攻撃の決定順とみなしてはならない。
- `generation`: 古い予約/キャッシュを破棄する版。動的な変更を受けたイベントを古い計画で実行しない。

イベントは「指定Tickに**再評価が必要な作業**」であり「そのTickに必ず効果が発生する」という意味ではない。例: 攻撃再準備時刻に対象が消えていれば、正規条件に従って不発・再計画される。

## 2. Active Setとの違い

`Active Set` は今のTickで**実行・再評価が必要な主体/関係**を保持する。未来の時刻を管理するQueueとは別。

```text
on_canonical_write(entity.field, tick):
  dirty = reverse_dependencies(entity.field)
  mark_active(dirty, affected_phase, earliest_legal_tick)
  invalidate_future_schedules(dirty)
```

書込みがないからEntityをinactiveにする、は誤り。Tickでエネルギー回復、期限切れ、Jinrei判定、現在地の観測、Fog履歴が生じ得る。**次の仕事が無い証明**と必要な出力Materializationがそろって初めてinactiveにできる。

Active Setの全体走査はDirty集合の局所更新で削減する。規範順序のため、適用時にstable sortまたは安定ordered setで正規順に戻す。

## 3. 期限として登録できるもの

| 候補 | 安全な予約条件 | 予定を無効化する例 |
| --- | --- | --- |
| 攻撃準備 `attack_ready` | Clockとaction lockが不変で、対象選択は次の時刻で再評価 | 移動・新規敵・攻撃強化/停止・死亡 |
| 移動到着 | Edge、速度、track、reservations、途中の停止条件が固定 | Bridge/terrain/追撃/敵接近/Skill |
| 定時間隔のwave | RulePlan由来の確定周期と当該wave生成前提 | RulePlan変更、上限/早期終局 |
| Respawn | `respawn_at` が確定しているMonster | 他のlife-cycle/write、死亡・復活 |
| 効果/Reveal期限 | expiration Tickが固定 | 再付与、取り消し、死亡等 |
| Squad/橋作業 | 成熟/作業期限と相互作用が閉じている | Join/split、combat/contest、補給/占有 |
| Jinrei評価 | **原則毎Tick**。省略は論理評価/CU/Memory/診断まで等価の厳密証明がある場合だけ | 新観測、Memory変更、ordered評価、未知Plan |
| 全体RulePlan phase | そのphaseが何も読まず書かず出力しないと証明したとき | 任意のpredicate/collection/transition/termination |

現行の `next_vision::lifecycle`、`next_combat::objective_lifecycle`、`next_squads::lifecycle_with_relationships` は毎Tickの意味を持ち得る。最初のHybrid実装ではこれらを**保守的バリア**として残してよい。

## 4. 同Tickの処理

```text
advance_to(f):
  require certified window (t,f)
  materialize all obligated intermediate outputs
  t = f
  for phase in canonical RulePlan/Enbu order:
    freeze the phase's prescribed snapshot
    collect all due and newly dirtied work for that phase
    validate generations/versions and eligibility
    decide simultaneous actions from frozen snapshot
    resolve ties and commit in canonical order
    propagate writes to future-phase/next-Tick dirty sets
    enforce limits and emit required projections
  return next frontier or fallback
```

フェーズにより同Tick書込みを読む/読まない規則が異なる。Priority Queueのpopを即状態変更とすると、**死ぬ攻撃者もそのTickに選択済み攻撃を行う**という既存ルールを壊す。選択→同時効果集計→commitのバリアを守る。

同Tick中に新しい予約が発生した場合は、当該フェーズより前へ戻して実行してはならない。既存参照順序で今のTickの合法な後続フェーズへ属する場合のみ取り込み、それ以外は次の合法Tickまで延期。循環・再帰挿入は上限と進捗条件を検証し、失敗したらReferenceへ戻す（定義済みResourceLimitは同時点で返す）。

## 5. Queue実装と境界管理

Strategyの内部Queueは [EVENT-QUEUE](STRATEGIES/EVENT-QUEUE.md) に定義する。Schedulerが所有するのは**統一した期限/無効化の契約**。

| 構造 | 計算特性 | 適用上の注意 |
| --- | --- | --- |
| Binary min-heap | `O(log Q)` insert/pop、疎な未来予定に有利 | cancellation世代とstale popコスト |
| Bounded buckets | `O(1)` に近いslot登録/取出（窓の長さ/衝突に依存） | 大きい空窓ではメモリ/初期化の無駄 |
| Small-group scan | `O(A)` で次のdueを探す | 少人数ならheap構築より安いが密イベントでは不利 |
| Active Set | 変更依存の集まりを順序付きに保つ | 全体バリアに当たればほぼ全員を再評価 |

`Q`: 予定件数。`A`: 同一証明領域内の作用主体数。不要なqueue配列やEntityコピーを各Tick構築しない。時刻が最大Tickを超える予約は省くか上限付きで保持する。時刻の加算は参照と同じchecked/saturating契約を用いる。

### Staleエントリ

予定を論理削除した際、Queueから即物理削除するとは限らない。pop時に世代/依存版を検査し、古ければcommitせず破棄する。`stale / live` の割合が上限を超えたら安全に再構築する。古いエントリの破棄は正規のゲームイベントを破棄する行為ではない。

## 6. 不変条件・fallback

- current_tickは単調増加。同Tickフェーズは既存規範順序で実行。
- まだ実体化されていないReplay/Owner/CU義務があれば、その前を飛び越えて外部へ観測可能な状態を進めない。
- Domain証明失効、未知Read/Write、より早い期限、上限未証明の場合、**未確定の高速経路を破棄してReference Tickへ切替**。
- Schedulerの再計画コストを無視しない。大量のキャンセル/再予約がある戦闘ではReferenceが合理的。
- コピー削減・キャッシュ再利用はWorld/RulePlan/Output契約の版付き境界でしか許さない。

## 7. 検証シナリオ

1. 隙間が長い攻撃準備、最後のTickちょうどの攻撃、no-event窓。
2. 同Tickに相手を殺す二陣営の相互攻撃、同一ターゲット複数攻撃の安定順。
3. 未来の予約時刻より早くReveal/施設破壊/移動/Healが発生する無効化。
4. Queueのstale世代/ダブル挿入/同Tick再挿入/容量超過。
5. Attack/Move排他、橋待ち、Squad、死体/Respawn、Minion wave。
6. Fog、Jinrei memory、CU、diagnostics、Public/Owner Replayの同一Tick再構築。

全ケースは [CONFORMANCE](CONFORMANCE.md) の完全出力比較が必須。実験の成功条件はQueue操作が速いことではなく、**参照と同値な総実行時間・計算量削減**である。
