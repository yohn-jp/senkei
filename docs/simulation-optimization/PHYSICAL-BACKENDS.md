# 第2段階：物理実行方式とバックエンド候補

> **前提:** 同じ意味論と論理CUを持つ状態遷移計画に限定して比較する。物理実行で論理仕様/計算課金を変更しない。第1段階の数学的圧縮とA/Bテストを分離。

## 1. データ表現

| ID | 実装方式 | 有利になり得るケース | 代償/検証点 |
| --- | --- | --- | --- |
| P01 | AoS `Entity{...}` | 小規模・個体ごとの全フィールドアクセス | 不要フィールドのcache汚染 |
| P02 | SoA `hp[]`, `pos[]` | 大量同質Minionの一括数値演算 | 動的Entity/異質Schemaの管理 |
| P03 | Chunked/Archetype storage | 型/Capability単位で処理 | Layout移行費用と間接参照 |
| P04 | Dense index + ID map | BTreeMapアクセスの削減 | ID整列・安定tie-break |
| P05 | Sparse Set / Generation Handle | Active集合・消滅が頻繁 | Handle失効検査 |
| P06 | Cache-friendly adjacency CSR | 静的依存グラフ・World | 動的辺更新が高価 |
| P07 | Arena/DAG interning | 式共有と計算計画の局所性 | メモリ寿命・上限 |
| P08 | Bitset/SIMD truth masks | 大量同型三値判定/視界候補 | 三値演算と論理CU保存 |

## 2. タイムライン管理

| ID | 方式 | 有利条件 | 測るもの |
| --- | --- | --- | --- |
| P09 | Binary heap | 一般的な疎イベント | push/pop、失効比、メモリ |
| P10 | Indexed heap | 予測更新が多い | decrease-key/取消負担 |
| P11 | Timing wheel | 有界Tickの短いTimer多数 | bucket偏り、overflow管理 |
| P12 | Calendar queue | 分布が安定した期限 | 分布変化・再構築 |
| P13 | Sorted vector/batch | 少数・ほぼソート済み | 増分挿入、メモリ走査 |
| P14 | Direct arithmetic next-tick | 周期・固定期限 | Guard条件変更時の再導出 |

## 3. 演算・スケジューラ

| ID | 方式 | 期待する改善 | 適用条件 |
| --- | --- | --- | --- |
| P15 | Scalar fused loop | ループ・呼出しのオーバーヘッド削減 | 同じフェーズ意味論 |
| P16 | SIMD vector batch | 多数の同型整数演算 | Overflow/Saturation互換 |
| P17 | Small matrix specialized kernel | 小さい連立系・固定構造 | 行列形式化費用が小さい |
| P18 | Sparse matvec/fast power | 依存が疎な反復 | 疎性が累乗でも保たれるか |
| P19 | Precomputed jump table | 定常遷移の多回反復 | Program/Ruleのキー一致 |
| P20 | Bytecode VM optimized dispatch | Jinrei物理実行のみ改善 | CUの論理命令列を維持 |
| P21 | Specialized interpreter / threaded dispatch | 反復Jinreiを軽量化 | 実行環境・WASM差 |
| P22 | Native JIT/AOT specialization | 同じ式を大量試行 | コンパイル費/セキュリティ/移植性 |
| P23 | Work-stealing parallel SCC | 独立領域が多数 | 決定的Barrier/集約 |
| P24 | GPU bulk kernels | 大規模で均質な数値計算 | CPU↔GPU転送、分岐/同期、整数一致 |
| P25 | WASM Web Worker | UIと計算分離 | 初期化/メモリ/ブラウザ上限 |
| P26 | Cached serialization/checkpoint | Replay・seekの生成費削減 | 透過性、メモリ、バイト量 |

## 4. 比較の分離

```text
Stage 1: identical data representation; vary mathematical algorithm only
Stage 2: fix semantic plan; vary layout / queue / evaluator / parallelism
Stage 3: select combinations; measure compilation + full runtime + output
```

すべての実装は同じ最終結果・各Tickの正本世界状態・Intent・観測・CU・Replay投影に合格してから性能比較対象とする。バイナリ表現や内部キャッシュは比較に含めない。

## 5. GPUとWASM

GPUに適するかは主体数・式の均質性・独立性・バッチ長・転送/同期回数による。全主体を毎Tick GPUに送る方式は、数理的圧縮で演算を減らした後より遅い可能性がある。GPUを選ぶ場合もSenritsuの整数/固定小数点と丸め・飽和を厳密に実装し、Native/WASM/他Backendのcross-checkを要求する。

既存正本はRustコアのNative/WASM同値性を要求する。GPU専用計算経路は追加研究候補であり、既存配布要件ではない。
