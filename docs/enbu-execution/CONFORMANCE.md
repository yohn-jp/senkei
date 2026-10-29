# Conformance — Enbuの完全一致と性能計測の受入契約

> 状態: 本番Hybrid採用の**必須検証契約**。現行テストの存在を将来Strategyの検証PASSと混同しない。検証にはRust nativeと**実際のWASMモジュール**を使用する。

## 1. 合格の定義

Hybridの各Strategyは \`Reference Tick Executor\` に対して、同じ入力/バージョン/出力契約で**厳密に同じ結果を返す**こと。

\`\`\`text
Reference = canonical Enbu full Tick execution
Candidate = identical rules, inputs and outputs; only physical execution differs
Pass iff
  canonical outputs match in every public/owner/diagnostic component
  AND execution errors/resource limits occur identically
  AND no unproven shortcut is selected
  AND native/WASM candidate outputs agree
\`\`\`

最終HPや勝敗のみの同一、またはTS syntheticとの一致だけでは合格にしない。

## 2. 比較層

| レイヤ | 比較対象 | 不一致時に記録するもの |
| --- | --- | --- |
| L0 入力/ビルド | Source SHA、RulePlan/World/Program digest、CostSchedule/engine版、WASM SHA256/bytes | 不一致なら測定禁止 |
| L1 中間意味論 | Tick/phaseごとの入力観測、Intent/Memory、依存版、選択/落選ガード | 最初の相違Tick、phase、field、eligibility |
| L2 状態 | WorldState、HP/Shield/XP、locks、position、Effects、MatchResult | 異なるEntity/field、最初の誤ったwrite |
| L3 課金と例外 | CU消費、Diagnostics、ResourceLimit、overflow、abort、発生Tick | 過不足/違うerror code/原因 |
| L4 公開/owner | PresentationReplay全Tick、FogHistory、Owner/敵の秘匿、event order/index | 最初の欠落Frame/field/event |
| L5 ABI | Native dispatcher対WASM moduleの完全応答JSON | 不一致digest、正本出力のdiff |
| L6 性能 | 全費用とメモリ・仕事量、複数Tick/密度/出力モード | ケース別実測と未完走/分散 |

L1の内部計測を外部の公開ABIへ強制追加しない。L2-L5の最終出力を満たした上で、開発時の内部traceを比較に使う。

## 3. 既存の検証基盤

現行リポジトリには次の実測可能な仕組みがある（追加HybridのPASSを意味しない）。

- \`apps/simulation-lab/enbu-conformance.mjs\`: 12種類の実Enbu WASMとNative Rustの7 golden fixturesについて、完全応答digest/bytes/出力順を検証。計測用WASM JSON ABIにはRust parse/serializeが入る。
- \`apps/simulation-lab/enbu-worker.mjs\`: BrowserでWASMを読み、同一revision/digestを検証してから計測。WASM全構成に同じNative goldenを使用。
- \`crates/wasm/tests/preflight_dispatch.rs\`: 本番dispatch経由でNative fixtureをexport。
- \`tests/conformance/compare-adapters.mjs\`: Native/real WASM適合性と既存goldenの検査。
- \`crates/enbu/tests/next_scenarios.rs\` および \`crates/enbu/src/next_*.rs\`: Next実動作と局所差分テスト。
- \`.github/workflows/simulation-lab-pages.yml\`: real WASM構成をビルドし、Native黄金応答一致を出版条件にする。
- \`.github/workflows/ci.yml\`: Rust/ブラウザ/ABIを横断検証。

基準の \`000\`、R/V等の比較は、全Tick構造内の局所最適化であり**Hybrid Strategy導入の完了**ではない。PRやbranchの変更はマージ/公開/CI成功を別途確認する。

## 4. 必須のテスト集合

### 4.1 正常系
- 1/4/16/64/128 Tick、同一Node交戦、5Hero Squad、攻撃/移動/Skill混合。
- 多数の独立候補、実際には結合している候補、空白の長い窓、イベント密集窓、少数actor。
- 既定Behavior + Jinrei/Minion制御 + Route + Squad split/merge + neutral Respawn。
- Result-only候補を導入するならFullReplayとは別に独立の同値試験。

### 4.2 危険な境界
- 相互同Tick致死、同じ標的への集中攻撃、XP報酬配分、Shield/Heal・Defense変更。
- 無効化: 突然の視界、Reveal expiration、橋破壊/修復、目的地/track変更、Spawn/Death。
- Fog/Facility last-known、Owner public/private境界、Decision Traceのevent index。
- Jinreiの三値評価、同一Intentでも異なるMemory/CU/診断、memory commit policy。
- 上限直前: max ticks、events、diagnostics、entity/bytes、host abort、Arithmetic Overflow。
- 途中で計画がstaleになるケース、Heap/Bucket/Scan切替、partial staged writesとrollback。

### 4.3 検証不能の扱い
- 不明なRulePlan transition、未知Capability、外部Tick依存、未対応OutputContractは**必ずReferenceへfallback**。
- 未完走/timeoutはPASSとみなさない。どのTick/Strategyまで検証したか記録。
- 失敗ケースでは遅いからテストをスキップするのではなく、短い最小反例を先に再現し、完全版も保持する。

## 5. 差分ハーネスとOracle

\`\`\`text
fixture = immutable inputs + native source SHA + RulePlan/World/Program IDs
golden = Reference Tick native full canonical response JSON
candidate = Hybrid native response + Hybrid WASM response

for each candidate and case:
  verify build/fixture provenance
  compare full JSON response (including authorized diagnostic side)
  if mismatch:
    rerun diagnostic mode with per-Tick/phase snapshots
    report earliest differing Tick/phase/field/event/CU
  record eligibility, chosen strategy, fallback and proof invalidations
  reject candidate from production promotion
\`\`\`

同じSerialized完全応答のSHA256は強い検査だが、文字列生成/順序に差がある場合の原因解析にはL1-L4の構造比較が必要。正本のJSONシリアライズを変更してHashを合わせるような修正は禁止。goldenは独立したReferenceから生成し、Candidateが生成した値で自己証明しない。

**Differential fuzz**: 安定seedと危険条件のbiased generatorでRead/Write/State/Timingを変更して候補と参照を照合し、shrinkingで最小の再現入力を残す。TSで検証した560 deterministic + 200 seeded casesは合成モデルの証拠であり、本番のfuzz gateを代替しない。

## 6. ベンチマークの測定契約

\`\`\`text
Total =
  input_validation + preflight + classify + plan
  + scheduler + kernel_execute + invalidate + replan + switch
  + canonical_transition + observe/project + replay_materialize
  + serialize + WASM host_input/host_output
\`\`\`

同じ入力・出力・CPU状態でRef/候補を交互/順序入替して計測する。WASM取得・compile・instantiateは**別**フェーズとして報告し、毎戦闘dispatch時間と混ぜない。JIT/GC/cache/ページ負荷を記録する。

| 指標 | 目的 |
| --- | --- |
| \`total_wall_ms\`, median/p95/MAD | 利用者が実際に待つ時間の改善・分散 |
| \`plan/build/validate/execute/commit/materialize/serialize_ms\` | 内訳と律速 |
| \`executed_ticks / certified_skipped_ticks\` | 何を本当に省略したか |
| \`visited_actors / target_checks / visibility_queries / path_queries\` | Active/経路・視界再評価の計算量 |
| \`scheduled/popped/stale_events\`, \`cache_hit/miss\` | Scheduler/Periodicの実効コスト |
| \`plan_invalidation_count / fallback_count / switch_count\` | 計画の現実的な維持費 |
| \`peak_linear_memory / output_bytes / wasm_bytes\` | 資源・転送・ビルドサイズ |
| \`full_json_sha256\` と \`source_revision\` | 同値性と来歴 |

全候補を完走させる必要がある完了検証と、途中結果を保存できる反復研究を区別する。サンプル数/測定閾値を少なくして高速化と称しない。長いシナリオを含む複数Tick horizonの完走能力自体を追う。

## 7. プロモーション・レビュー

採用条件は次の全て。

1. 対応StrategyのEligibility/無効化/Reference fallbackを含む全契約を実装。
2. 代表/反例/seed付きfuzzでNative reference対Hybrid Native/WASMが完全一致。
3. 既存Enbu/Browser/Replay/CUのCIが成功。新しいArtifact版やAPI変更が必要なら別の互換性審査。
4. 実Rust/WASMの総時間と計算量が妥当な負荷で改善し、悪化ケースはDispatcherがReference等へ退避する。
5. Source SHA、Manifest、測定レポートと不合格ケースを保存し、再現できる。

結論: **性能は安全性の次の条件**。単純な1Tick例で遅くても、長期の因果的に閉じた窓で速いことはあり得る。一方、Replayの全出力が支配的なら理論上のTick skip倍率はend-to-end倍率にはならない。

関連: [MIGRATION](MIGRATION.md)、[SEMANTICS](SEMANTICS.md)、[DISPATCHER](DISPATCHER.md)。
