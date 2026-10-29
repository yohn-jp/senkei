# Enbu Hybrid Execution Engine — 実行アーキテクチャ

> 状態: **合意した設計方針の実装契約案**。本ディレクトリの新しいPlanner/Dispatcher/Scheduler/Strategyは、現行mainに実装済みという意味ではない。実装と検証の成否は各変更のCI結果で判定する。

## 1. 目的と責任境界

Enbuの全Tick・全Entity逐次処理を唯一の物理実行方式とせず、**必要な計算を、同一結果を証明できる方式でだけ実行する**Hybrid Execution Engineへ移行する。狙いは計算速度だけでなく、不要な評価・状態複製・探索・再計画の**計算量**そのものを減らすこと。

既存の [Enbu](../ENBU.md)、[実行/CU](../EXECUTION.md)、[Senritsu](../SENRITSU.md)、[Jinrei](../JINREI.md)、[Replay](../REPLAY.md) が所有するゲーム規則・論理課金・観測・出力・権限は変更しない。同一のRustコアをnative/WASMの両方へコンパイルする。

Hybridは**実行のポートフォリオ**であり、単独の戦闘アルゴリズムではない。TSのSimulation Labにある \`active\`/\`heap\`/\`bucket\`/\`periodic\`/\`hybrid\`/\`adaptive\`/\`arithmetic\`/\`scan\`/\`phase_cache\`/\`planned\` はアルゴリズム研究の出発点である。その合成モデルはJinrei・CU・実際のFog/Replayを含まないため、実測倍率や適用可能性をそのまま本番へ持ち込まない。

## 2. 三つの独立した問い

| 問い | 権威・担当 | 変更してよいこと |
| --- | --- | --- |
| **What — 何を計算するか** | VerifiedRulePlan、Enbuの正本State Transition、Jinrei | Hybrid導入によって**変更しない** |
| **When — いつ計算が必要か** | Execution Planner / Event Scheduler / Execution Frontier | 不変条件を証明した区間の物理評価を省略・集約 |
| **How — どの方法で計算するか** | Execution Dispatcher / Execution Strategy | 等価なActive・Queue・Periodic・Arithmetic・Planned・Referenceを選択 |

計算を省略しても、要求された任意Tickの正規状態、同Tick判定、公開/owner投影、イベント順序、論理CU、診断、失敗は変えない。物理時間の短縮は論理CUの減額理由ではない。

## 3. 正式用語（このディレクトリの表記を統一する）

| 英語（識別上の正名） | 日本語 | 契約上の意味 |
| --- | --- | --- |
| **Hybrid Execution Engine** | 混成実行エンジン | 正本遷移を複数の物理方式で等価実行するEnbu内部の実行基盤 |
| **Reference Tick Executor** | 参照Tick実行器 | 従来の全Tick逐次処理。完全一致のオラクルおよび安全なfallback |
| **Execution Planner** | 実行計画器 | RulePlanと現在状態の依存関係から実行Domain、適用範囲、証明書を構築 |
| **Execution Dispatcher** | 実行振分器 | 証明済みの候補に対して全費用を比較しStrategyを選択・切替 |
| **Execution Strategy** | 実行方式 | 条件を満たす範囲で正規遷移・出力を計算する交換可能な計算カーネル |
| **Event Scheduler** | イベント予定器 | 将来の期限・無効化・Dirty集合・同Tickバッチを管理する機構 |
| **Active Set** | 活性集合 | 現時点で再評価が必要と証明された作用主体/依存ノードの集合 |
| **Execution Frontier** | 実行境界 | 状態・判断・出力が**初めて**変わり得る次の時刻または依存変化境界 |
| **Causal Domain** | 因果領域 | Read/Write依存を検査して、対象区間で他領域と独立と証明した計算単位 |
| **Frontier Certificate** | 境界証明書 | 境界、依存版、適格条件、未処理出力義務を保存する内部証拠 |
| **Dirty Frontier** | 再計画境界 | 変更された依存先から次に検証/再計算が必要になる範囲 |
| **Canonical State Transition** | 正規状態遷移 | 同一のRulePlanとTickフェーズで確定する正本の状態更新 |
| **Observation Projection** | 観測投影 | 正本状態をpublic/owner Replay、Fog、診断などへ認可に従い変換 |
| **Materialization** | 実体化 | 省略/集約した物理区間から必要な正本状態・各Tick出力を正確に生成 |
| **Fallback** | 参照復帰 | 適用証明不能/無効化/コスト不利でReference Tickへ安全に切替 |

\`Hybrid\` と \`Adaptive\` はStrategy IDではなく、**Dispatcherによる組み合わせと選択方針**を指す。\`Heap\`・\`Bucket\`・\`Scan\` はEvent Queueファミリの別カーネル。名称の類似で同一能力と扱わない。

## 4. 処理の全体像

\`\`\`text
VerifiedRulePlan + current WorldState + frozen input / Jinrei authority
                       |
                 Execution Planner
         dependency graph / SCC / window / proof
                       |
            Frontier Certificate
                       |
                Execution Dispatcher
      prove eligibility -> compare TOTAL cost
                       |
     +-----------------+------------------------+
     |                 |                        |
  Active Set       Event Queue             Periodic /
  incremental      Heap/Bucket/Scan        Arithmetic /
                                             Planned
     +-----------------+------------------------+
                       |
    phase-preserving Canonical State Transition
                       |
            Event Scheduler / invalidation
                       |
           Observation Projection
    Public Replay / Owner Fog / CU / Diagnostics
                       |
               next certified frontier
                   or fallback
                    |
          Reference Tick Executor
\`\`\`

「次のイベントまで何もない」はスキップの証明ではない。Jinreiの毎Tick評価、クールダウン、スキル、Minion wave、施設、Fog、スクアッド成熟、診断/CUなどを含むRead/Write・時間依存義務を登録・検証し、証明できない場合はReferenceへ戻る。

## 5. 文書と責任

| 文書 | 契約 |
| --- | --- |
| [SEMANTICS.md](SEMANTICS.md) | 正本Tickフェーズ、観測、スキップできる条件 |
| [PLANNER.md](PLANNER.md) | 因果領域、Read/Write依存、境界証明書 |
| [DISPATCHER.md](DISPATCHER.md) | 適格性、最小総費用の選択、切替 |
| [SCHEDULER.md](SCHEDULER.md) | 期限、活性集合、安定順序、無効化 |
| [STRATEGIES/README.md](STRATEGIES/README.md) | 全Strategyの共通インターフェース・fallback |
| [STRATEGIES/ACTIVE.md](STRATEGIES/ACTIVE.md) | 変更部分だけを物理的に評価 |
| [STRATEGIES/EVENT-QUEUE.md](STRATEGIES/EVENT-QUEUE.md) | Heap、Bucket、Scan |
| [STRATEGIES/PERIODIC.md](STRATEGIES/PERIODIC.md) | 周期計算・位相キャッシュ |
| [STRATEGIES/ARITHMETIC.md](STRATEGIES/ARITHMETIC.md) | 数式集約・最初の致死Tick |
| [STRATEGIES/PLANNED.md](STRATEGIES/PLANNED.md) | 確定窓の先読み、no-work/singleton/first volley |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Replay/Fog/CU/任意Tickの実体化 |
| [CONFORMANCE.md](CONFORMANCE.md) | Rust/WASM全出力一致、性能試験 |
| [MIGRATION.md](MIGRATION.md) | 段階導入とrollback |

## 6. 権威・採用条件・禁止事項

- **確定済み既存仕様**: 上位の [docs/README.md](../README.md) にある文書の権威と実際のVerifiedRulePlanが優先。競合があれば、この設計を修正する。
- **新しい設計契約**: 本ディレクトリのPlanner/Dispatcher/Scheduler/APIはこれから実装する対象。擬似コード/型名は実在するRust APIを意味しない。
- **研究の出所**: [PORTFOLIO-DISPATCH](../simulation-optimization/PORTFOLIO-DISPATCH.md) のTSモデルは数式・反例・探索に利用し、実Enbuの同値性証明に置き換えない。
- **本番採用**: [CONFORMANCE.md](CONFORMANCE.md) の全出力同値と、実Enbu Rust/WASMで総コスト改善を確認するまでは Reference Tick が正本。
- **禁止**: シナリオ名で方式を固定、結果だけ一致させ途中Replayを捨てる、未知の依存を「変化なし」と推定、ゲームCUを物理最適化に連動させる、敵の非公開データを観測に漏らす、シミュレーション機能をOFFにして高速化と称する。

## 7. 成功指標

速さは \`dispatch\` 単独でなく、RulePlan検証/準備、計画、切替、実行、必要な観測/Replay生成、シリアライズ、WASM host転送を区分して**総時間**で測る。併せて判定数、状態コピー量、イベント処理数、実体化Tick数、メモリを測定する。各ケースで「何を飛ばせたか」「何をまだ毎Tick計算する必要があるか」を報告する。

現行 \`crates/enbu/src/lib.rs::simulate_inner\` は \`for tick in 1..=max_ticks\` の参照方式。R/V/T/C/Sの物理最適化やPR内の変更は**Hybrid実行基盤そのものではない**。採用を先取りしない。
