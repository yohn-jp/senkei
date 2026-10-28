# ハイブリッド実行計画 — 部分グラフ別・区間別の組合せ

> ここに「唯一の最適解」はない。混成は計算モデルの**局所的切替**であって意味論上のTick/Phaseを混ぜない。各候補は[ベンチ](BENCHMARKS.md)で選別する。

## 1. 分割単位

- **時間**: Guard/Timer/交戦/目標変更の境界間を一つの区間とする。
- **状態グラフ**: 強連結成分(SCC)と独立なDAG成分を単位とし、1Unit=1partitionとは限らない。
- **空間**: Region/Lane/Bridge/視界が独立した局所集合。ただしGlobal Buff、陣営資源、Minion視界共有は横断Edgeを張る。
- **観測**: Actual WorldとAttacker/DefenderのObservationは別の依存表現。内部の未来情報をJinreiのKnownへ持ち込まない。
- **出力**: 結果だけ必要な用途と、全Tick Replay/Diagnosticsが必要な用途は同じ式でも物理出力コストが異なる。

## 2. 混成候補

| ID | 組合せ | 狙い | 切替・不適用条件 |
| --- | --- | --- | --- |
| H01 | Closed-form movement + pairwise range solver + synchronous combat | 長距離移動中のTickを消す | 曲がり角/橋/新規視界/経路変更 |
| H02 | Sparse Active Set + Global Tick barrier | 少数の能動主体だけ処理、意味論はTick基準 | 全域更新/高密度active |
| H03 | Per-region event queue + global interaction rendezvous | 疎な複数レーンを独立処理 | 横断的目標/共有資源/観測 |
| H04 | Matrix/recurrence solver per SCC + incremental DAG propagation | 連立進捗計算と局所波及を統合 | 非線形分岐・SCC巨大化 |
| H05 | Periodic attack bulk + exact death boundary + XP/level recalc | 同型攻撃を圧縮 | Shield/Heal/Effect/target選択が変わる |
| H06 | Timer wheel + direct arithmetic for far expiry | 多数CD/Respawn/Revealの期間管理 | 巨大で偏った期限分布 |
| H07 | Spatial index + analytic crossing + invalidation | 近接可能なペアだけ候補生成 | 密集/長射程/同時多発 |
| H08 | Cached routing + dynamic bridge triggers + fallback Dijkstra | 静的経路を長く再利用 | 橋破壊/視界不明/混雑でルート変化 |
| H09 | Query/DAG sharing + bitset collection + logical CU emulator | 同じJinrei観測・集合をまとめる | 集合が小さい/Unknown伝播/ordered評価 |
| H10 | Lazy replay materialization + checkpoint + temporal seek | 任意Tickの描画取得を効率化 | 全Tick全状態の即時出力要求 |
| H11 | Offline symbolic segment compilation + runtime dirty graph | 確定した両Jinreiの反復を減らす | 計画生成費用が単発実行を超過 |
| H12 | Conservative event jumps + dense Tick fallback | 疎区間だけジャンプ、密区間は走査 | 切替頻発/戻しコスト大 |
| H13 | Deterministic actor batching + SoA SIMD + phase barrier | 同型大量Minionの物理演算削減 | 不均一な個別Effectと分岐 |
| H14 | Precomputed observation candidates + exact Fog projection | 視界候補の絞込み | FogHistory・Reveal・遮蔽変更 |
| H15 | Monotone capture-progress formula + contested guard | 無競合占有Tickの集約 | 同Tick到着/死亡/移動/陣営変更 |
| H16 | Interval-proved stable Behavior + Jinrei state cache + boundary recheck | 繰返し意思決定の物理実行削減 | CU評価パス・Knownness・Profile変更 |
| H17 | Cycle fast-forward + cumulative aggregate summaries | 繰返し戦況の圧縮 | 生成ID、絶対Tick、統計/ログが非周期 |
| H18 | Speculative jumps + versioned cancellation + exact fallback | 予測が高精度な戦闘で高速化 | 失効率高/再計算・rollback高価 |
| H19 | Finite-state automaton + binary lifting + sparse effects | 少数モードの長い制御系列 | 状態空間爆発/外部Read多い |
| H20 | Adaptive portfolio optimizer: per-SCC & per-time-window dispatch | 複数方式の勝つ領域を使い分け | コスト推定誤り、計画変更の負担 |

## 3. Dispatcherの考え方

候補プランpの区間推定費用を

```text
Cost(p,w) =
  C_compile_amortized + C_guard_check + C_predict + C_execute
  + C_invalidation + C_barrier + C_logical_reconstruction
  + C_materialize + C_memory_penalty + C_switch
```

とする。単位は実測で定義し、`predicted event count`、active ratio、Read/Write密度、SCCサイズ、出力要求量、履歴の失効率、Tick残数から推定する。最適化の目的は最終的なwall time（必要ならtail latency/メモリ）であり、単なる`イベント件数最小`ではない。

**安全な切替:** 現在の確定Tick境界でCanonical Stateを保持し、候補の前提条件が成り立つか検査し、失敗時は逐次tickへfallbackする。途中に発生すべきイベントを失ったまま先へ進まない。各候補に上限（式サイズ/予測数/メモリ/無効化回数）を置く。

## 4. 例: 三つの相互依存領域

```text
Region A: Hero移動      -> 解析的進入時刻を予測
Region B: Minion波      -> 周期生成 + 疎な到達予測
Region C: Bridge工事    -> Timer解析 + 通行状態Guard
                    \      |       /
                     dependency frontier
                           |
                     Shared Tick Barrier
                           |
                  Snapshot -> Both Jinrei
                           |
                  Combat / Arbitration
```

A/B/Cが独立に未来へジャンプできるわけではない。予測された最小の**全局的に影響する境界**で同期し、そこから影響範囲のGuardを再予測する。観測やJinreiの全域依存を発見した場合、共通区間が短くなり、Hybridが自動的にGlobal Tickへ退避する。

## 5. 切替の悪例と設計上の注意

- **毎Tick全員戦闘**: Event queue処理がGlobal Tickの単純配列走査より高コストになる。
- **局所的に疎でも全域Jinrei**: `count all visible`が全ユニット依存なら、局所分割を安全に完全独立とみなせない。
- **式を先に膨らませる**: 複合Guardの記号展開は指数的になり得る。DAG共有と予算上限が必要。
- **1人ずつ最後まで実行**: 他の主体とのTick途中の相互作用を見逃す。
- **予測だけ正しいが出力が膨大**: Replayの全Tick全状態生成要求なら、その転送・シリアライズが支配的。

## 6. 実装に反映する順序（研究優先度）

まずH02/H12/H01でTickとActive Setの差、次にH05/H07/H09で交戦・視界・集合の密度差、最後にH04/H11/H20で数理的合成と自動選択の費用対効果を調べる。この順序は採用順位ではない。局所的な成功を全試合の高速化と混同しない。
