# Senrei / Enbu 計算方式探索台帳

> Status: **研究候補（非規範）**。本ディレクトリの各案は採用決定・実装済み・性能実証を意味しない。戦闘の意味論は [Jinrei文法](../JINREI-GRAMMAR.md)、[Senritsu](../SENRITSU.md)、[Enbu](../ENBU.md)、[実行・CU](../EXECUTION.md)、[決定論](../SIMULATION.md) が優先する。

## 目的と判断軸

Senrei（戦闘シミュレーション高速化の検討対象）で、双方の**確定済みJinrei**と**検証済みSenritsu**および初期状態から決まる時間発展を、意味を変えずに少ない物理演算で求める。イベント駆動だけに固定せず、代数的簡約、時間ジャンプ、依存伝播、ユニット処理、Tick処理、それらの**局所的・時間的な混成**を比較する。Jinrei単体では全依存は決まらない。Senritsuが移動・戦闘・観測・デフォルトBehavior・競合・終局を所有する。

**二段階を混同しない。**
1. **数理的圧縮**: 反復回数、評価対象数、探索空間を減らし、同じ論理遷移を別の計算で表す。
2. **物理実行最適化**: 残った演算をRust/Native/WASMのデータ構造・メモリ・実行計画で高速化する。

「意味のないTick」は「変化がないTick」ではない。区間を逐次実行せずとも**要求される全観測で同値**を保てると証明できる場合、当該Tickの**物理評価**を省ける。計算不要なTickでも論理上のTick、CU、観測、命令候補、履歴は存在する。

## 文書索引

| ファイル | 用途 |
| --- | --- |
| [STATE-INVENTORY.md](STATE-INVENTORY.md) | 状態の分類、実装根拠、依存の棚卸し手法 |
| [ALGORITHM-CATALOG.md](ALGORITHM-CATALOG.md) | 数理・論理・空間・時間の候補技法をID付きで収集 |
| [MATHEMATICS.md](MATHEMATICS.md) | 漸化式、閾値、離散丸め、区分的関数の導出と反例 |
| [TEMPORAL-IR.md](TEMPORAL-IR.md) | 両Jinrei/RulePlanの合成、解析IR、証明証拠、CU |
| [HYBRID-PLANS.md](HYBRID-PLANS.md) | 部分グラフ・時間区間・ワークロード別の混成解法 |
| [PHYSICAL-BACKENDS.md](PHYSICAL-BACKENDS.md) | 同じ計算計画に対する実装方式の比較候補 |
| [BENCHMARKS.md](BENCHMARKS.md) | 正しさ、ケース生成、測定軸、再現可能な比較 |
| [EXPERIMENT-LEDGER.md](EXPERIMENT-LEDGER.md) | 仮説、未検証事項、測定報告テンプレート、採否 |

## 確定済みの不変条件（本台帳が変更してはならない事項）

- すべての戦術は同一Tickの**陣営別・権限内Observation**で論理的に同時評価する。片方の秘密のJinrei/状態をもう片方の観測値へ直接流さない。
- `Observed<T>=Known(T)|Unknown`、強Kleene三値論理、`is known/unknown`の二値検査、`ordered and/or`のみの論理短絡CUを守る。
- Costed Logical IRで規定した**論理CU、要求された論理トレース、Intent、状態遷移、最終結果**を保存する。最適化によってプレイヤーのCUが安くなってはならない。
- Tick内フェーズ、同時攻撃・死亡、全順序とtie-break、整数/固定小数点、丸め・飽和、ルール版・ワールド版を保持する。
- Native/WASM間で結果と論理CUを一致させる。戦闘コアのホスト保護予算（CPU/メモリ/イベント等）を論理CUと別に維持する。
- Public/Owner/Restricted Replayを分離し、任意時刻の再現と秘匿を維持する。間引きは出力契約の黙示的な変更ではない。

## 計算モデル

`X[t]` = World + 個体/陣営 + TacticalMemory + 統計 + タイマーなどの意味論上の完全状態。`O_s[t]=Observe_s(X[t])` は陣営sの認可済み観測、`J_s(O_s[t])` はJinrei結果、`S` はSenritsuのフェーズ付き遷移とする。

```text
F_t = SenritsuPhaseCompose(J_Attacker, J_Defender, WorldRules, DefaultBehavior)
X[t+1] = F_t(X[t])              // 概念上の逐次意味論
G(X[t], Δ) = F_{t+Δ-1} ∘ ... ∘ F_t (X[t]) // 候補実行計画
```

本質的な目標は任意のDeltaについて`G`を安全かつ安価に実装すること。時間・Tick番号・期限・CUが作用する場合、`F_t`は自律系とは限らないため、時間を状態へ含めるか非自律遷移として扱う。

## 採用ではなく「候補を蓄積」

- 各候補は **適用条件・依存入力・等価性条件・失効条件・費用・反例・代替策** を必ず記載する。
- 単独の勝者を探さず、部分問題ごとの組み合わせを含める。最悪例の退行も測る。
- 理論計算量は数理モデルの前提を明記する。イベント件数や出力サイズが大きければ、全体時間の下限は別。
- ベンチ結果を得るまで「高速」「最適」などの断定を避ける。最終決定は[EXPERIMENT-LEDGER.md](EXPERIMENT-LEDGER.md)に証拠付きで記録する。

## 現状と検証範囲

現行 `crates/enbu/src/lib.rs` は`for tick in 1..=max_ticks`で逐次解決し、`next_navigation`、`next_combat`、`next_battlefield`、`next_squads`、`next_vision`などを呼ぶ。Jinreiコンパイラの`CompileOptions.optimize`は確認した実装で利用されていない。これらは**探索開始時点のコード観察**であり、将来のmainでも永続的に真とは限らない。性能改善・全Read/Write抽出・テスト成功は未実施。

本書の`Senrei`は検討テーマ名。新しい独立プロダクトやSenritsu/Enbuの権限変更を意味しない。

## 実測の開始

- [RUN-20261028-001: 4方式の初回実測](measurements/2026-10-28-minimal.md) — 独立主体の合成モデル（**本番Enbuではない**）。[実験コード](../../tools/senrei-bench/README.md)。

- [RUN-20261029-002: 14ケース・7方式の拡張実測](measurements/2026-10-29-extended.md) — 共有ターゲット、周期視認、全攻撃列生成の比較。合成モデルのみ。
