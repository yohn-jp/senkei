# Execution Strategies — 共通カーネル契約

> 状態: 設計API案。現時点で以下のRust trait/データ型が実装済みであるとは主張しない。全Strategyは正本のRulePlan/Enbuを別実装へ置き換えるものではなく、**物理的な計算方法のみ**を交換する。

## 1. Strategyの定義

一つのStrategyは、**証明済みの因果領域・有限Tick窓に限り**、参照逐次実行と同一の状態変化と外部観測義務を満たす計算方式である。共通の責務は以下に限定する。

- 適格性を証明/拒否する。拒否は理由付きで、状態を一切変更しない。
- 認可済みの読み取り状態・計画世代と出力要求から bounded executionを準備する。
- Strategyの実行結果を **Canonical State Transition** に渡す。直接、他の領域やPrivate Ownerの公開出力を書き換えない。
- 出力/ResourceLimit/CU/診断などを確実に実体化する責務を列挙する。
- 証明無効化時にcommitしていない部分を破棄しReference Tickへ安全に戻る。

## 2. 概念上の共通API

\`\`\`rust
// Pseudocode only — not a committed Rust API.
trait ExecutionStrategy {
    fn id(&self) -> StrategyId;
    fn certify(&self, scope: &DomainPlan, snapshot: &CanonicalSnapshot,
               obligations: &OutputContract) -> Eligibility;
    fn estimate(&self, certificate: &FrontierCertificate,
                measurements: &CostProfile) -> CostEstimate;
    fn prepare(&self, certificate: &FrontierCertificate) -> PreparedWindow;
    fn execute(&mut self, prepared: PreparedWindow,
               immutable_input: &CertifiedInput) -> StagedTransitions;
    fn validate(&self, staged: &StagedTransitions,
                current_versions: &DependencyVersions) -> ValidationResult;
    fn invalidate(&mut self, dirty: &DirtyFrontier);
}
\`\`\`

\`StagedTransitions\` は「実装が好きな順でWorldStateを書き換えた結果」ではない。正規Tick/phase/ActorIdの順序でcommitできる状態差分、Event/Replay/CU/診断義務、精度・整数/overflow状態、未処理の依存変化を保持する**未公開の中間結果**。途中で証明失効したら副作用なしで破棄できなければならない。

具体的なRust ownership/borrow設計、内部イベント型、ライフタイムは実装段階で決める。外部ABIに任意のStrategy IDを勝手に追加しない。

## 3. 共通のEligibility / Certificate

\`\`\`text
Eligible iff
  plan and input versions match
  AND dependency closure contains every possible read/write/exogenous change
  AND candidate guarantees exact canonical transitions and stable tie order
  AND every required Replay/owner/Fog/CU/diagnostic effect can be materialized
  AND the window ends no later than the earliest unproved frontier
  AND resource/termination/error semantics are identical
\`\`\`

- \`Known invalid\`: 使ってはならない。該当時点からReferenceへ戻す。
- \`Unknown\`: 無理に選ばない。Referenceへ戻す。
- \`Eligible\`: Certificateの範囲だけ有効。出力実体化費用も見積もりに含める。

「計算量を減らせる」という性能予測はEligibilityの代わりにならない。

## 4. カーネル一覧と研究名の対応

| 本番設計上の分類 | TS研究での名前 | 役割 |
| --- | --- | --- |
| **Reference Tick** | \`tick\`（研究上の参照） | Enbuの実際の全Tick実行器を別途オラクルとする。TSの\`tick\`を本番オラクルにしない |
| [Active Set](ACTIVE.md) | \`active\` | 依存が変わった作用主体のみを再評価 |
| [Event Queue](EVENT-QUEUE.md) | \`heap\`, \`bucket\`, \`scan\` | 疎/密/小群の未来イベントを最小費用で処理 |
| [Periodic](PERIODIC.md) | \`periodic\`, \`phase_cache\` | 周期が証明済みの計算を位相/前処理で簡略化 |
| [Arithmetic](ARITHMETIC.md) | \`arithmetic\` | 条件付きの累積処理、致死境界探索 |
| [Planned](PLANNED.md) | \`planned\` | 閉じた区間のno-work/singleton/first-volley特殊化 |
| **Execution Dispatcher** | \`hybrid\`, \`adaptive\` | **Strategyではない**。候補選択/切替の仕組み |

複数のカーネルを同一窓へ重ねて物理実行した場合の二重更新・二重CUを避ける。DomainPlanは各効果のcommit責任を**ちょうど1つ**の経路に割り当てる。

## 5. Strategy仕様書の必須項目

各ファイルは次を明示する。

1. **目的と計算量**: \`A\` actor、\`E\` 物理イベント、\`T\` 窓Tick、\`K\` 実体化する外部イベント、\`G\` Domain数などを定義。
2. **適格条件**: 必要なRead/Write証明、Window上限、既知の未対応依存。
3. **擬似コード/式**: フェーズ・同Tick順序・整数/round/overflow。
4. **出力実体化**: Capture、Public/Owner Replay、Fog、CU、diagnostics、エラー/limit。
5. **無効化**: 何が早いFrontierを生むか、古い計画の廃棄とFallback。
6. **反例**: 安易な最適化が誤結果を出す具体例。
7. **検証**: 独立Native/WASM・Reference一致、時間/仕事量/メモリ/出力サイズ。

## 6. 受入上の共通不変条件

- 同じpre-stateから同Tickのactor選択が終わるまで、攻撃/Skill/Moveの優先関係を破らない。
- ResourceLimit/Overflow/Errorは同じTick・同じエラーで停止する。エラーを後から検出して違う試合結果を返さない。
- 優先順位やtie-breakは既存のRulePlan/EntityId/phaseに従う。Heapの内部順序で決めない。
- 独立して見える領域もFogやJinreiの観測集合で結合し得る。未証明の連携はReference。
- 物理最適化のためにJinreiの論理CU/課金可能な診断を省かない。
- Full Replayが要求される場合は\`Ω(K)\`件の出力実体化下限がある。結果のみとの比較を混ぜない。

## 7. Fallbackの安全な手順

\`\`\`text
before_execute:
  verify certificate and source snapshot generation
execute:
  stage changes in private buffer or verified disjoint state
before_commit:
  revalidate touched dependencies, global barriers and output limits
if valid:
  commit once, preserving canonical order
else:
  discard only unpublished effects
  resume Reference Tick from last canonical committed checkpoint
\`\`\`

既にpublish済みのowner Replay/diagnostic/CUを二重に生成してはならない。rollbackが証明できない方式は開始前に拒否する。実装の切替は外部のゲーム結果へ影響させない。

関連: [SEMANTICS](../SEMANTICS.md)、[PLANNER](../PLANNER.md)、[DISPATCHER](../DISPATCHER.md)、[CONFORMANCE](../CONFORMANCE.md)。
