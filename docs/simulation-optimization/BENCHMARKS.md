# 性能・同値性・スケーリング実験仕様

> 実験設計。現段階で**測定値・性能改善・実装完了の主張はない**。比較対象は同じRulePackage/World/双方Jinrei/初期状態/終局上限を固定する。

## 1. 比較対象

**数学的計算モデル:** B00 現行Global Tick、B01 Unit-major Tick、B02 Active Set Tick、B03 Event queue、B04 Dependency-driven dirty graph、B05 Closed form、B06 Piecewise/guard solver、B07 Per-SCC/graph composition、B08 Adaptive Hybrid、B09 Whole-match specialization。

**同一意味計画の物理バックエンド:** P01〜P26（[PHYSICAL-BACKENDS.md](PHYSICAL-BACKENDS.md)）。B01は一般にはB00と同じ`O(TN)`で、反復順序/局所性の比較として評価する。疎イベント方式の見かけの`O(E log E)`も、予測/無効化/相互作用/出力費を加える。

## 2. 受入の優先順位

1. **正しさ:** 各TickのFull World、各陣営Observation（Known/Unknownを含む）、Jinrei Truth/Intent、合法性・調停、論理CU、停止Tick/理由、RulePlan結果、Private/Public/Owner projectionが適合。
2. **安全性:** ルール版、タイムアウト、ホストCPU/メモリ/出力上限、不正Program、Fog秘匿。超過を無視して高速化しない。
3. **性能:** 正しさを満たす候補のみ、compile/setup込み、execution only、full-outputで測定。
4. **一般化:** セルごとに優勝方式と逆転点を記録。単一ケースの高速化を全体へ外挿しない。

## 3. シナリオ行列

| ID | ケース | 変化させる軸・期待する違い |
| --- | --- | --- |
| C01 | 空戦場/待機のみ | 固定オーバーヘッド、最小出力費 |
| C02 | 長距離直線進軍 | Tick数に対する閉形式利益 |
| C03 | 方向転換・複数エッジ | Piecewise境界 |
| C04 | 双方同速/異速の接近 | 接触/射程solver、同Tick判定 |
| C05 | 高速で交差・離脱 | 射程進入/退出が複数 |
| C06 | 一方的定間隔攻撃 | 死亡時刻・攻撃集約 |
| C07 | 同時攻撃/同時死亡 | Snapshotと順序保存 |
| C08 | Shield/回復/攻撃混在 | 非線形/区分変化 |
| C09 | Skill cooldown/効果失効 | Timer boundary |
| C10 | Squad合流・分離・死亡・復活 | 属性/速度/成熟変更 |
| C11 | Minion多wave/長い試合 | 周期と動的Entity |
| C12 | 多数休眠と少数活動 | Active Set vs Global Tick |
| C13 | 全員活動する密集戦 | Event overheadとFallback |
| C14 | 橋の予約・横断待ち | 空間/共有資源依存 |
| C15 | 橋の建設/破壊・経路変更 | 予測失効/リプラン |
| C16 | MID占有/競合/中断 | 単調進捗が破れる境界 |
| C17 | 視界の出入り・未知化 | Known/Unknownと依存再計算 |
| C18 | 探索/最終観測/Reveal | Fog履歴・投影の保存 |
| C19 | 大量のJinrei集合量化 | Query DAG/bitset/論理CU |
| C20 | `ordered and/or`とBudget超過 | 論理短絡、停止の同値 |
| C21 | 全域Buffと頻繁なJinrei切替 | 依存グラフ高密度の最悪ケース |
| C22 | 大規模な独立レーン | Region分割・並列性 |
| C23 | 不均一なイベント時刻 | Heap/calendar/timer wheel比較 |
| C24 | 高頻度キャンセル/予測失効 | イベントキューの最悪例 |
| C25 | 長周期の有限状態反復 | Cycle/jump table/式サイズ |
| C26 | 全TickフルReplay/Diagnostics | 出力下限、遅延復元費 |
| C27 | 結果だけ要求しReplay不要 | 数理的圧縮の純粋効果 |
| C28 | NativeとWASMのgolden集合 | クロスランタイム一致 |
| C29 | 境界不等号/零速度/桁あふれ/丸め | 厳密算術の反例 |
| C30 | 観測されない相手の確定軌道 | 内部予測と陣営秘密の分離 |

C01〜C30は**テストケース構想**。実装されていないルール/データを現行Enbuの実在機能と誤認しない。生成可能なシナリオだけを`implemented`と表示する。

## 4. 規模と負荷軸

- Entity数: 1、8、32、128、512、2048（現行HostLimits/RulePackage内で合法な値に限定）。
- Tick: 100、1,000、10,000、100,000（最大Tickと出力上限内）。長さは他の因子と独立に変える。
- 活動率: 0%、1%、10%、50%、100%。
- 依存密度: 独立、局所、全域結合。
- Event率: 毎100Tick未満／数Tickに1回／毎Tick多数。
- Guard変化率: なし／閾値のみ／多頻度/Unknown切替。
- Outputモード: 結果のみ（意味同値検査は別途フル実行）、必要Tickスナップショット、全Tick公開Replay、Owner/Restricted Diagnostics。
- workload: Small/Medium/Largeと、実ゲームに近い分布、生成した敵対的最悪例。

全組合せを総当たりするのではなく、まず直交軸と交互作用を意識した実験計画（factorial/subset、Latin hypercube等）で代表点を選び、逆転領域を精査する。

## 5. 測定する数値

| 種類 | 項目 |
| --- | --- |
| Latency | compile、plan build、warm-up、execute、reconstruction、serialize、end-to-end の時間 |
| Throughput | completed matches/sec、平均とp50/p95/p99 |
| Work | 実行したTick/Guard/Unit更新、solver呼出し、依存再評価、Event push/pop、キャンセル、Fallback回数 |
| Memory | peak RSS/heap、plan bytes、queue/cache、Replay bytes |
| Quality | 全状態・全Tick・CU・結果・Replay/Diagnosticsの一致率（不一致ならfail、順位付け対象外） |
| Scalability | Tick/Entity/依存密度/出力件数ごとの時間、推定次数と反転点 |
| Economics | compile償却回数、コールド/ウォーム差、Native/WASM差、低スペックブラウザでの停止頻度 |

## 6. 測定環境と統計

- CPUモデル、メモリ、OS、Rust compiler/profile、WASM runtime/browser、commit SHA、Rule/World/Program digest、scenario seedを記録。
- 各候補を同じハードウェア・プロセス条件で、ランダム化した順序で測定。温度/CPU周波数/バックグラウンド負荷を管理。
- ウォームアップと測定反復（例: 5 warm-ups + 30 runs。これは実験設定候補）を区別。median、分位、MAD/95%信頼区間を報告。
- 結果に`compile excluded`/`included`、`output excluded`/`included`を明示。コードによる計測器のオーバーヘッドも測る。
- ベースラインと候補で同じ出力を要求。全Tick出力を省く候補と全Tickを出す候補を同列のEnd-to-end比較にしない。
- 差分検証はベースライン逐次モデルをoracleとし、Native/WASMにgolden。ベースライン自身にも独立境界テストを追加する。

## 7. 最小結果行フォーマット

```text
run_id, commit, ruleset_digest, world_digest, attacker_program_digest,
defender_program_digest, scenario_id, seed, entities, ticks,
dependency_density, output_mode, optimizer_id, backend_id,
compile_ms, execute_ms, materialize_ms, total_ms, median_ms, p95_ms,
peak_bytes, evaluated_ticks, guard_checks, invalidations,
fallback_count, logical_cu_attacker, logical_cu_defender,
result_digest, trace_match, observation_match, replay_match, status
```

機械可読CSV/JSONLだけでなく、各シナリオに**速くなった理由と遅くなった反例**を文章で記録。採用判定は[実験台帳](EXPERIMENT-LEDGER.md)へ。

## 8. 最低受入条件

- 典型・境界・敵対的ケースで正しさが完全一致。Native/WASMの結果・CU一致。
- 物理最適化による意味変更なし。テスト未実装範囲は`NOT_TESTED`。
- Fallback経路に成功例と失敗例の両方がある。
- 比較対象の実行モード、測定条件、出力サイズが明記。
- Winner宣言は`total_ms`、Memory、Tail、Compiler費用込みで評価した条件付きのもの。
