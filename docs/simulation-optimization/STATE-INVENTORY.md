# 状態・依存関係・更新点の棚卸し

> 状態: **一次調査済み／網羅性未検証**。下表はmainの代表実装から抽出した実在フィールドと主要ロジックを主とする。型・意味・更新箇所の完全性は自動スキャンと実行トレースで確認する必要がある。

## 1. 何を数えるか

1. **不変入力**: RulePlan、World topology、Terrain、Hero/Skill Catalog、配備・装備・初期Jinrei、数値演算契約、上限。
2. **可変な意味状態**: World`entities`/`global_fields`/`collections`、陣営/個体/Squad状態、TacticalMemory、進捗、タイマー、スポーン/死亡、統計。
3. **導出値**: 認可済みObservation、射程/視界、経路候補、ターゲット順位、Behaviorスコア、Jinrei state、Intent候補。
4. **一時状態**: 同TickのSnapshot、合法性・競合調停、PendingHit/Effect、キュー予約、同時解決用集約。
5. **出力/監査**: CUと残予算、診断、状態ダイジェスト、PresentationReplay、Owner視点のFog履歴、勝敗。
6. **物理キャッシュ**: 空間索引、依存グラフ、計算済み式、イベント予測。これは意味状態と混同しない。

Derived/Cacheが物理的に変わらなくても、論理的な評価要求を削除できるとは限らない。

## 2. コードで確認した状態フィールド（抜粋だが実フィールド名）

| 領域 | 確認したフィールド例 | 変化を生む処理・主要依存 | 主要出典 |
| --- | --- | --- | --- |
| 時間・行動 | `attack_ready`, `action_lock_until`, `prepared_action_tick`, `move_intent_tick`, `track_intent_tick`, `moved_tick` | Tick、命令受理、移動/攻撃排他、スキル | `next_combat.rs`, `next_tactics.rs` |
| 位置/経路 | `x`, `y`, `node`, `edge_to`, `edge_progress`, `goal`, `lane`, `track`, `track_goal` | 速度、経路、地形、集団、橋、対象、Jinrei目標 | `next_navigation.rs` |
| 橋横断 | `cross_remaining`, `ford_remaining`, `ford_active`, `track_wait_ticks`, `track_cross_from`, `track_cross_to` | 幅/予約/混雑/橋状態、横断Tick、経路 | `next_navigation.rs` |
| 戦闘 | `hp`, `max_hp`, `shield`, `attack`, `defense`, `range`, `attack_interval` | 被害/回復/攻撃選択/レベル/パッシブ | `next_combat.rs` |
| リソース・効果 | `energy`, `haste`, `haste_until`, `slow`, `slow_until`, `reveal_attacker_until`, `reveal_defender_until` | スキル発火、期限、視界、移動速度 | `next_combat.rs`, `next_vision.rs` |
| 成長/生死 | `xp`, `level`, `xp_reward`, `death_tick`, `respawn_at`, `life_generation`, `passive_generation`, `skill_path` | 死亡、XP分配、レベルアップ、復活、スキル取得 | `next_combat.rs`, `next_squads.rs` |
| Squad | `squad`, `formation`, `maturity`, `slot_id`, `catalog_id` | 合流/分離/死亡、結束条件、初期編成 | `next_squads.rs` |
| 設備 | `bridge_state`, `build_remaining`, `build_kind`, `build_started_tick`, `build_lock_until`, `builder_side`, `builder_squad` | 建設/破壊命令、作業、妨害、橋の利用 | `next_battlefield.rs` |
| 目標 | `capture_progress`, `capture_progress_side`, `capture_owner` | 同時占有、競合、所定Tick継続 | `next_battlefield.rs` |
| 戦術判断 | `retreating`, Intent、Behavior Profile、Jinrei `state`のTruth値 | 観測、優先関係、Jinrei判定、競合 | `next_tactics.rs`, `next_behavior.rs`, `jinrei/src/vm.rs` |

**注:** この表のフィールド名は現行コードで確認した代表例であり、完全な状態スキーマではない。単一フィールドが複数の関数で読み書きされる。パスを単なる文字列で扱う現行Entityフィールドと、Senritsu Domainの型付きFieldIdは解析時に対応付ける。

## 3. 物理状態とは別に数えるべき対象

- Entityの追加/削除、ID・所有者・型、動的Collectionの要素数・順序。
- マップエッジの通行可能性、橋状態、競合予約、同一トラックの占有と退出。
- 陣営別観測の**Known↔Unknown**、可視集合のメンバー変化、並び順・同点選択。
- Jinrei名前付き`state`のTruth、通常/ordered論理の評価パス、集合量化の論理評価要素数。
- TacticalMemoryは入力/次値契約を持つが、Jinrei文法v0.1の`state`は**副作用なし**。メモリへの代入と混同しない。
- CU: `per_tick_budget`と累積残量、評価済み操作ごとのlogical charge、overrun後の扱い。
- リプレイ: Tick内順序、Owner/Public投影、FogHistory、診断、スナップショット、バイト容量。
- 能動的主体でなくても施設、地形、陣営共有の情報や終局条件が時間遷移を生む。

## 4. 更新点と観測の境界

`crates/enbu/src/lib.rs`の`simulate_inner`を基準とすると、現在の主要処理には、Tick先頭のlifecycle、両陣営Observation、Jinrei VM呼出し・CU計上、Intent validation/arbitration、Goal/Squad/Skillの準備、Navigation、Combat、Battlefield、Squad lifecycle、Replay/terminationがある。**正確な前後関係はコードと各RulePlanの契約から検査し、グラフにフェーズを必須記録する。**単に「ユニットAがBを読む」の矢印では、同一TickのSnapshotか遷移後値かを表現できない。

## 5. Dependency Edgeの型

| Edge種別 | 例 | 必須メタデータ |
| --- | --- | --- |
| data | 敵位置→射程判定→通常攻撃可否 | 読取版、主体、観測権限 |
| control | HP閾値→撤退Intent | 真偽/Unknown、ガード |
| temporal | cooldown_until→次の攻撃候補Tick | 期限、tick境界、単調性 |
| spatial | 位置→視界/射程/通行・占有 | 座標系、計量、トポロジー |
| aggregation | 生存者集合→対象選択・XP分配 | Membership、決定的順序 |
| resource | energy→技能合法性→新energy | 同Tick競合・失敗条件 |
| phase | Combat Snapshot→同時被害集約→HP確定 | 相、commit点、tie-break |
| epistemic | World→許可済みObservation→Jinrei Truth | 所有陣営、Knownness |
| output | State/Event→Replay/Diagnostics/CU | 投影権限・必要Tick |

## 6. 全件棚卸しの実施手順（次の実験準備）

- `senkei-model`の`EntityState`, `WorldState`, `NextRules`, `ObservationSnapshot`, `TacticalMemory`と`senritsu`のDomain/Capability定義から**スキーマ由来リスト**を生成する。
- `enbu`の`set_int`, `set_string`, `fields.insert/remove`, `entities.insert/remove`, `global_fields`, `collections`, FogHistory、CU/Replay writesを静的に列挙。間接呼出し・動的Key・多段関数経由は「動的/未解決」に記録。
- Read側（`int`, `string`, Pattern Match、BTreeMap get、RulePlan lookup、Jinrei observation、Behavior/Default）も収集。
- 型付きの `(phase, scope, field, reader/writer, guard, effect, rule version)` をキーに統合。可能ならコンパイラ型情報で実体確認。
- サンプルと本番相当のシナリオから実行トレースを採り、静的抽出との差集合を表示。実行カバレッジだけで完全性を宣言しない。
- 最終的に **全Writeに1つ以上の宣言済みeffect**、全Readに解決可能な状態/Observation参照、全Effectに逆向きのinvalidation索引、未解決箇所に安全なTick fallbackを要求する。

## 7. 研究上の分類ラベル

各変数/遷移を `constant` / `affine` / `polynomial` / `periodic` / `piecewise` / `monotone` / `finite-state` / `nonlinear` / `coupled` / `opaque` の**複数ラベル**で表す。`opaque`は推測で閉形式化しない。静的に証明した範囲・観測の射影・時間区間を添える。

## 8. 原則的な最小性と失効

初期状態が同じでも、別のJinrei／RulePlanでは依存グラフが変わる。グラフは **World logic identity + RulePackage/CostSchedule/Compiler version + 双方Program digest + relevant runtime policy** をキーにコンパイルし、残りの入力値により実行時特殊化する。位置やHPが変わっただけで静的なグラフ全体を再コンパイルせず、guardの証明区間とdirty subgraphを失効させる設計を候補とする。
