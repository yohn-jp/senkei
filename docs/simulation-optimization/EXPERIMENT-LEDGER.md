# 計算方式アイデア・実験・意思決定台帳

> **現状:** ドキュメントだけを作成。計測値なし。未実施をPASSや採用済みに書き換えない。本台帳を将来の検証・追加パターンの入口とする。

## 1. 仮説スタック

| Hypothesis | 関連方式 | 検証したい仮説 | 主な反証ケース | 状態 |
| --- | --- | --- | --- | --- |
| HYP-01 | A01〜A12, H09 | Jinreiの静的解析/共通DAG化は物理評価を減らす | 密なUnknown/ordered評価 | NOT_TESTED |
| HYP-02 | T01〜T07, H01 | 移動と交戦境界の閉形式はTickに対し実行時間を非線形に削減できる | 方向転換・丸め/橋 | NOT_TESTED |
| HYP-03 | Q02/Q03 | Unit-major / Active Setは密度によってGlobal Tickを上回る | 全員active | NOT_TESTED |
| HYP-04 | Q04/Q07/Q12 | 保守的なイベント予測は疎な戦闘で有利 | 毎Tick衝突/頻繁な無効化 | NOT_TESTED |
| HYP-05 | T02/T03/S03, H04 | SCCごとに漸化式を合成すればTick展開より安価 | SCC巨大・非線形 | NOT_TESTED |
| HYP-06 | T08〜T11, H05/H06 | 周期攻撃/Timerをまとめられる | Shield/XP/同時死 | NOT_TESTED |
| HYP-07 | S02/S10/S11, H14 | 依存再評価と視界差分は観測計算を削減する | 全球Buff/全域集合 | NOT_TESTED |
| HYP-08 | Q08/H12/H20 | 疎区間と密区間の自動切替は単独方式を上回る | 頻繁な切替 | NOT_TESTED |
| HYP-09 | P01〜P26 | 数理計画固定後に物理レイアウトが追加利益を生む | 小規模・異種主体 | NOT_TESTED |
| HYP-10 | S15/H10 | Replay要求モードが最適プランを変える | 全Tick/全状態即時出力 | NOT_TESTED |
| HYP-11 | T11/T12/H17/H19 | 周期合成/Jump tableは長い試合で有利 | 生成ID・絶対Tick・累積CU | NOT_TESTED |
| HYP-12 | Q11/H18 | 失効付き予測が単純な保守計算より速い領域がある | 失効率が高い | NOT_TESTED |

候補の出典、式/追加技法、未解決問題は[ALGORITHM-CATALOG.md](ALGORITHM-CATALOG.md)と[MATHEMATICS.md](MATHEMATICS.md)に追記する。採否と速度の大小は実測から記録する。

## 2. 進め方

**Wave 0 — 正本の固定**
- [ ] 現行mainのRun/Rule/World/Program/CostSchedule identityを保存。
- [ ] 全Read/Write/Effectとフェーズの機械可読な台帳作成。
- [ ] ベースライン逐次モデルのTruth/Observation/Intent/CU/Replay golden生成。

**Wave 1 — 数理方式の独立比較**
- [ ] B00〜B09（実装可能な範囲）を同一の軽量化したsemantic kernelで比較。
- [ ] 境界ソルバ・整数丸め・三値条件・相互作用を順に導入。
- [ ] 有望方式をSenritsu/Enbuの実際のRulesへ移植し、差分検証。

**Wave 2 — 物理方式の比較**
- [ ] 有望な意味計画を固定し、Memory/Layout/Queue/Execution Backendを比較。
- [ ] Native/WASM、それぞれcompile/execute/outputを分離計測。
- [ ] ハイブリッドDispatcherを学習/手調整する前に基準計算モデルを記録。

**Wave 3 — 採用判断**
- [ ] ワークロード別WinnerとFallbackを確定（全域の単一Winnerを強制しない）。
- [ ] Peak memory/compile amortization/尾部遅延/出力下限を明記。
- [ ] 実測の再現性と適合性を確認したものだけ実装ロードマップへ移す。

## 3. 追加候補記録テンプレート

```markdown
### [ID] Name
- Kind: symbolic / temporal / spatial / scheduler / backend / hybrid
- Hypothesis:
- Input/Read Set:
- Write/Output Set:
- Required phase & numeric/visibility semantics:
- Validity interval and proof obligations:
- Invalidation trigger:
- Complexity: baseline / expected / worst (including preprocessing/output)
- Failure mode / counterexample:
- Combinations:
- Benchmark scenarios:
- Evidence: NOT_TESTED | ...
- Decision: PROPOSED | REJECTED | ADOPTED (with rationale)
```

## 4. ベンチ結果記録テンプレート

```markdown
### RUN-YYYYMMDD-XXX
- Commit: ...
- Ruleset/World/Jinrei digests: ...
- Host/Toolchain: ...
- Scenario/Seed/Entities/Ticks/Output mode: ...
- Baseline: median/p95/peak_mem/compile/total
- Candidate: median/p95/peak_mem/compile/total
- Ratio: baseline total / candidate total  (higher = faster)
- Exactness: World/Observation/Intent/CU/Trace/Replay/Termination
- Invalidation/fallback/event/guard counters: ...
- Win region / Lose region:
- Reproduction command and fixture:
- Hypothesis verdict: SUPPORTED | REFUTED | INCONCLUSIVE
- Decision: keep / revise / reject / adopt
```

**重要:** `SUPPORT`は性能仮説を支持する測定を意味し、コンパイルされた式の一般的な数学的正しさを証明するものではない。等価性は限定した前提と規範テストの両方で判定する。

## 5. 将来の追加アイデアを歓迎する際のルール

候補を増やす際は、既存IDを再利用せず、新しい技法・ハイブリッド・反例・適用条件を追記する。不要と判明した方式も削除せず、**なぜ不適合だったか**を残す。デザインの正本変更はこの研究台帳だけで行わず、該当するSenritsu/Jinrei/Enbuの正本文書へ別途反映する。

## 6. 初回実測（限定した合成モデル）

[RUN-20261028-001](measurements/2026-10-28-minimal.md) は独立主体の移動・周期攻撃で4方式を比較した。**135ケース差分テストPASS、1,024主体・10,000Tickの実測あり**。これはHYP-02/03/04の限定的な初期証拠であり、Jinrei/Senritsu/Enbu本番での成立は未検証。追加実験で共有ターゲット、Observation、橋の因果境界を扱う。
