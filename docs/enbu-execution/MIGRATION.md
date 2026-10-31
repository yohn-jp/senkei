# Hybrid Engine移行計画 — 文書から本番へ

> 状態: **部分実装／残工事あり**。PR #71はmainへマージ済み。2026-10-31 のHybrid構成はP/A/I/Bに加えS（Attack/Reveal Scheduler）、W（MovementWindow）、パッシブ規則の試合単位コンパイルを実際のRust Next実行経路で組み合わせる。これは未検証の実装構成であり、Production Promotionの認証・性能ゲートを通過したという意味ではない。F/G/O/I/B、P/AとPhase-local Hは既存Tickで物理演算を削減する候補だが、有限窓の攻撃/Reveal処理スキップと正本Frame連続性ゲートは実装済み。全Tick短絡と、集約区間の状態・Jinrei/CU/診断を完全再構築する一般機構は未達。機能を停止して数字だけ速くすることは許さない。

## 1. ゴール

現行の `crates/enbu/src/lib.rs::simulate_inner` にある全Tick逐次処理を**Reference Tick Executor**として安全に残し、同じRustソース・既存の戦闘規則で、適格な有限因果領域だけをActive Set / Event Queue / Periodic / Arithmetic / Plannedカーネルで進める。

**最終合格**は、主に以下を同時に達成すること。

1. フル出力でReferenceと**完全同一**、NativeとWASMで一致。
2. 変更されない計算を本当に省き、計算量・wall time・memoryを定量検証。
3. Dispatcherが短い/複雑な戦闘や証明不能時に適切な方式・Referenceへfallback。
4. Replay/owner Fog/Jinrei/CU/診断/ResourceLimit/終局の意味を保護。
5. 本番WASM/Nativeの利用経路が実際にHybridを選択する。Labの合成JSだけを直して終了しない。

## 2. 今あるものと、まだ無いもの

| 現行の事実 | Hybridの未実装契約 |
| --- | --- |
| EnbuのRust参照Tickループ | Event-drivenな有限窓実行と境界証明 |
| R/V（経路/視界）等のfeature実験、WASM変種比較 | 因果領域に応じた複数StrategyのDispatcher |
| Native golden fixturesと28-WASM SHA/完全応答比較（最新mainのLabゲートで検証） | Native/WASM両方のHybrid独立同値検証 |
| TS Simulation Labの11種・14研究ケースと研究文書、RustのPhase-local H | 各合成アルゴリズムの実Enbu意味論への条件付き移植、有限窓スキップ・完全出力再構成 |
| Public/Owner ReplayとRestrictedDiagnostics | 物理スキップ中の全出力の正規Materialization |

局所最適化（経路/視界、メモリコピー、Shield/Cohort等）は採用できるなら引き続き有効だが、**Tickを飛ばすアルゴリズムの採用証明ではない**。

## 3. 実装順と並列化できる境界

| Wave | 実装成果物 | 事前条件 | 受入の意味 |
| --- | --- | --- | --- |
| **0: Baseline** | 参照Executor境界、計測と完全JSON Oracle、短/長Tick実Fixture | 既存Enbu・現行CONFORMANCE | 何が重いか・何が同じかを可視化 |
| **1: Semantics** | RulePlan Read/Write依存解析、証明書/版、Dirty Frontier | [SEMANTICS](SEMANTICS.md)、[PLANNER](PLANNER.md) | 使えない高速経路を確実に拒否 |
| **2: Scheduler** | 期限/Active Set、同Tick安定バッチ、abort/fallback | Wave 1、[SCHEDULER](SCHEDULER.md) | 少数の依存変更だけを正しく再評価 |
| **3a: Event Queue** | Heap / Bucket / Scan独立カーネル | Waves 1–2、[EVENT-QUEUE](STRATEGIES/EVENT-QUEUE.md) | 疎/密/小群の実務量削減 |
| **3b: Periodic** | 周期/phase_cache、期限超過時invalidate | Waves 1–2、[PERIODIC](STRATEGIES/PERIODIC.md) | 周期計算の閉窓集約 |
| **3c: Arithmetic** | monotone累積、first lethal Tick、singleton | Waves 1–2、[ARITHMETIC](STRATEGIES/ARITHMETIC.md) | 集計数式の正本同値 |
| **4: Planned** | 一回分類とno-work/first-volley/bijection | Waves 1,3、[PLANNED](STRATEGIES/PLANNED.md) | 真に独立した群でだけ直接式を選ぶ |
| **5: Dispatcher** | Eligibility→Cost→hysteresis選択、観測可能なfallback | Waves 1–4、[DISPATCHER](DISPATCHER.md) | 「どれが速いか」を**総費用**で判断 |
| **6: Materialization** | Replay/Fog/CU/diagnostics/任意Tickの実体化 | 段階的にWaves 2–5と並行、[OBSERVABILITY](OBSERVABILITY.md) | 全出力一致でしかfast pathを認可しない |
| **7: Promotion** | Production Rust/WASM設定、CI gate、revert | 全Wave、[CONFORMANCE](CONFORMANCE.md) | 本番とLab両方で実測/同値を満たす |

3a/3b/3cは共通インターフェースが固定された後に**独立した変更経路で並列実装可能**。ただし同じ `simulate_inner` を複数変更で競合させず、各カーネルを新たなprivate moduleとして作り、統合境界を一本化する。

Wave 6の出力契約は最後に付け足すのではなく、Wave 0のOracle設計から常に受入条件とする。新しいfast pathがFull Replayで一致しないならWave 3の段階で不合格。

## 4. 実装モジュールの推奨分割

これは**候補ファイル構成**であって現在存在するものではない。

```text
crates/enbu/src/
  execution/
    mod.rs               # mode selection / canonical boundary
    reference.rs         # existing Tick flow adapter
    planner.rs           # Read/Write, SCC, bounded certificates
    dispatcher.rs        # eligibility, cost and hysteresis
    scheduler.rs         # stable due queue and dirty frontier
    projection.rs        # canonical materialization protocol
    strategies/
      mod.rs             # typed Strategy interface
      active.rs
      event_heap.rs
      event_bucket.rs
      event_scan.rs
      periodic.rs
      arithmetic.rs
      planned.rs
```

- RulePlanが所有する遷移は同じ`next_*`系と現行`apply_transitions`を再利用し、ゲームルールをコピーして別実装を並立させない。
- 状態はcommit境界で`WorldState`を正本へ反映。高速なSoA/typed indexは非権威の内部表現として使ってよい。
- 参照実行が将来のAPI改修で変化する場合は、ReferenceとHybridの両方の検証を同時に更新する。
- ルールに応じたEligibilityはRulePlanと実状態から導出。ゲーム固有のscenario-name switchを作らない。
- Strategyの追加は共通Trait、検証ケース、計測を伴う。新しいものを追加しても既存を無理に削除しない。

## 5. 実装時の原子的な進め方

各Waveは以下の順序を守る。

1. 既存RulePlanの権威的な読み取り/書込み、Tick phaseとOwner出力への影響を分類。
2. 参照実行の最小かつ**実際の**対照Fixtureを先に作成。
3. Counterexampleを作り、誤った高速化をrejectすることを確認。
4. Strategy/Planner/Schedulerをprivate moduleへ実装し、参照結果のgolden比較を固定。
5. Native Rustと実WASMの同値性を確認し、cost modelに計画/出力/再計算を含めて計測。
6. 証明と性能が十分な範囲だけproduction modeで選択可能にする。大半がfallbackでも受入可能。
7. 既存コードを消すのは上位契約の移行完了後。Reference Tickは消さずテスト/緊急fallbackとして保持。

「とりあえず一括でHybridへ置き換え、動かない機能を一時OFF」は禁止。

## 6. デプロイ、比較、rollback

- Build provenance: Native dispatcher / WASMのSource SHA、Feature set、RulePlan/World/Program identity、golden digest、版を明示する。
- 同版のA/Bで `Reference` と `Hybrid` を選べる**内部検証用の切替**を用意する。公開APIを変更しない形が優先。
- 受入: [Conformance](CONFORMANCE.md) の同値性が全対象でPASSし、フル出力条件で実戦的な計測が改善し、悪化条件は適切にfallbackする。
- 不一致/エラー/新RulePlan依存の未対応時はReferenceで再実行し、結果やCUを修正して辻褄を合わせない。
- 既に試合内の観測/診断を発行した場合はcheckpointの整合性を確認し、重複発行しない。
- デプロイ後に正本出力が1件でも不一致ならHybridを無効化してReferenceへ戻す。再現Fixtureを保存し、復帰は修正・完全検証後のみ。

## 7. 統計的な性能判断と受入基準

想定より高速化できなくても根拠なくstrategyを有効化しない。必要なのは**改善した計算の実体**と根拠付きの数値である。

- 必須: 同じFullReplay/diagnostics/CUで1/4/16/64/128 Tick等の複数実戦ケース。
- 必須: 処理時間だけでなく、re-evaluated Actors、visited targets、skipped certified ticks、queue operations、Fog/Replay bytes、WASM memory、fallback reasons。
- 必須: Replay/materializationの出力下限が性能を支配するケースを別に表示。
- 必須: ネイティブと実WASMの両方、同じSource SHA、意味論・出力完全一致。
- 閾値は実測から定める。TS researchの「〇〇倍」を本番の必達倍率やコード内閾値として固定しない。

## 8. ドキュメントの更新・受入完了

現行 [ENBU](../ENBU.md)、[EXECUTION](../EXECUTION.md)、[SIMULATION](../SIMULATION.md)、[REPLAY](../REPLAY.md) は正本のまま。新規Hybrid実装が完了したときだけ、本ディレクトリを「実装済み」のStatusへ更新し、具体的なSHA・CI・測定結果の参照を付ける。

**完成とは**: 各Strategyの実装/不適格時fallback、因果証明、Dispatcher実選択、Replay/CU全出力、Native/WASM同値性、実測で改善、再現可能なrollbackが揃っていること。設計書作成だけ・issue起票だけ・TSベンチだけでは完成しない。
