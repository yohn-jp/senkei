# Observation Projection — Replay・Fog・CU・診断・任意Tick

> 状態: 本番移行の設計契約。Enbuの正本の出力を欠落させずに計算だけを圧縮する。投影の公開範囲と認可は [REPLAY](../REPLAY.md)、[ENBU](../ENBU.md)、[EXECUTION](../EXECUTION.md) が上位権威。

## 1. なぜStrategyから独立させるか

物理的にTick `t+1..t+n` を飛ばせたとしても、従来のEnbu `simulate` が全TickのReplay/owner visibilityを返すなら**出力を減らすことはできない**。結果が同じでも、中間のFog、Skill、イベント参照、CU、診断や最終原因が違えば非等価。

`Observation Projection` はStrategyの選択や実行順に依存しない一つの正本出力パイプラインとして定義する。

```text
Certified staged transitions + required logical per-Tick obligations
    -> canonical state by Tick (on demand or materialized)
    -> public / owner restricted projection
    -> ReplayFrames, MatchResult, RestrictedDiagnostics, exact CU
    -> native/WASM ABI serialization
```

既存の `crates/enbu/src/lib.rs` の `presentation_view`、`next_vision::team_view_with_fog`、`project_next_public_event`、`event_references_known`、`project_replay_identities_with`、`next_fog::FogHistory` を実装上の参照点とする。新しい独立した公開情報ロジックを考案しない。

## 2. 出力義務マトリクス

| 出力・内部状態 | 参照実行の例 | Hybridが守る条件 |
| --- | --- | --- |
| `MatchResult` | outcome、reason、final_tick、final_state_digest、cu_spent | 全フィールドと終局Tickが一致 |
| Public `PresentationReplay` | Tick 0および各実行Tickの可視stateとevents | 同じTick系列、順序、表示許可リスト |
| Owner-specific `PresentationReplay` | side別のFog・可視stateとevents | 相手の非公開観測を混ぜず完全一致 |
| `FogHistory` | explored nodes/edges、施設last-known、Tick | 不可視時に施設を更新しない。履歴も同一 |
| `RestrictedDiagnostics` | Jinrei評価、Actor/Behavior/Minion trace、CU等 | 種別・sequence・entity参照・上限・認可が一致 |
| TacticalMemory / CU | Tick別の評価結果、commit時点、論理操作の課金 | 評価を飛ばして論理費用を減らさない |
| Resource/error | event count/diagnostic count/host limits/overflow/abort | 同じ入力で同じエラー・停止時刻を返す |
| Reproduction identity | Rule/World/Program/Snapshot digest | 物理カーネル選択で再現同一性を変えない |

Gameのowner別診断はpublic結果と別。公開Replayに内部ログ全体を入れてクライアントで削る方式を採らない。

## 3. Tick 0と各Tickの投影

参照 `simulate_inner` は初期Public frameとNext時の両OwnerのTick 0 frameを持ち、各Tick後にPublic/Owner framesを付加する。Tick途中の移動やダメージより前の情報を当Tick後のOwner状態として使ってはならない。

- `ObservationSnapshot` は当TickのJinreiへ供給する**遷移前**のside別情報。
- `ReplayFrame.visible_state` は当Tickの公開/owner投影であって、Jinreiの入力観測と同時刻でも同一Snapshotとは限らない。
- FogはEdgeのサンプル、探索済み状態、施設last-knownを更新する。現行 `next_fog.rs` は9 samples/edgeという具体的な本番表現を持つが、Hybridはこれを「変わらないから書かない」と仮定しない。
- `Decision Trace` のイベント参照はownerへ実際に投影されたイベントの順番に対して確定する。投影で非公開イベントが落ちた後のindexを参照すべきときに、内部global indexを残さない。
- 現行コードのPublic/OwnerのEntity identity投影・pseudonym化・Respawn/reveal時の扱いを保持する。

## 4. Canonical State at arbitrary Tick

どの許可されたTick `t` についても、`StateAt(t)` は参照実行の正本状態を一意に再現する。これは外部APIとして既に提供されていると主張するものではない（**新しい内部契約**）。Snapshot保管法は選択可能。

### 実体化方式の候補

1. **Full materialization**: 従来どおり必要な全Tickを逐次投影。結果の忠実性が最優先。計算スキップのメリットが小さくてもよい。
2. **Bounded checkpoint + ordered event log**: 正規Checkpointと全必要状態遷移を記録し、指定Tickへ決定論的に再生。
3. **Certified formula reconstruction**: Periodic/Arithmeticの閉式を、依存証明付きの時間窓へ適用して状態と必要出力を計算。
4. **Streaming**: 既存ABIの互換性を壊さない**別の明示的な出力契約**が導入された場合だけ、生成済みの順序付きFrameを逐次返す。

任意の方式も `WorldState` に加え、TacticalMemory、CU、Behavior/route/relation状態、FogHistory、diagnostic sequence、pending events、ResourceLimit、Id projectionなど必要な**全内部状態**をチェックポイントへ含めなければならない。

```text
StateAt(t):
  locate last certified checkpoint c <= t
  verify RulePlan/Program/World/PlanGeneration
  replay certified transitions in reference phase order
  materialize all side effects and owner-observation obligations through t
  if interval is invalid/unknown: re-execute Reference Tick from c
  return canonical state at t, or exact reference error
```

同じsnapshotでも出力モード/owner/RulePlanが異なればキャッシュを共有してよいとは限らない。認可境界をCache keyへ組み込む。

## 5. Output mode と下限

`FullCapture`: 現行simulate相当。フレーム・診断/owner projectionを省略しない。個別イベント `K` 件が必要なら書込みは少なくとも `Ω(K)`。TickごとのVisibleState `T` 件を要求する場合は、その物理書出しにも少なくとも `Ω(T)` の下限がある。**内部演算が速くなっても全出力生成/JSON化の下限は残る。**

`ResultOnly`: 将来の**明示した別契約**として検討可能。全TickFrameを返すAPIと同じベンチマーク母集団で比較しない。受理されたルール・CU・正規終局などの結果を変える手段には使用しない。

`OnDemand`: 現行TS Tick Inspectorの発想を参考にできるが、実Enbuへ導入するにはStateAt(t)証明と認可済み取得境界が必要。勝手に途中Tickを想像・補間した状態として出さない。

## 6. Fogと秘密情報の不変条件

- publicとattacker/defender ownerが知る内容の集合が異なる。Ownerごとに独立した履歴/Last-knownのライフタイムを守る。
- Visibleだった施設は後にExplored/last-knownへ変わっても最後に**観測された内容と時刻**のみ保持し、非表示の最新HPや状態を更新しない。
- 敵Unitは未観測中の現在位置/状態が分からない。Last-known施設の扱いをUnitへ無条件拡張しない。
- 敵Program/Jinrei Memory、内部CUトレース、非公開意思決定を公開Replayへ流さない。
- 同TickのOwner可視性をPublicから逆算しない。既存 `team_view_with_fog` の正本ロジックを使う。

## 7. エラー/中断/原子的コミット

出力が必要な範囲を物理的に圧縮するとき、同Tickの途中で `ResourceLimit` や `BudgetExceeded` が起こる場合を検出できなければならない。区間末尾で「結果は同じ」として通してはならない。

```text
staged state + staged observables
  -> verify per-Tick limit/error and owner authorization
  -> stable canonical ordering
  -> commit once
  -> serialize public / separately authorized owner view
```

途中失敗は未公開のstagingだけを破棄。公開済み出力、CU、Memoryの二重commit禁止。完全なロールバック手段がないカーネルはスキップを禁止。

## 8. 検証

- Tick 0/1/途中/最終、最初の可視Tick、消失Tick、再発見Tick、施設last-known Tick。
- Fog探索済みEdge/Node、橋・渡河/破壊/復旧、同Tickの攻撃と移動。
- Owner public/nonownerの秘匿、Actor decision traceの正しいReplay event index。
- ResultOnly候補とFullCaptureの違いを明示した、同じRulesetでの状態・終局/CU比較。
- 各ケースで完全JSON・StateAt(t)・native/WASMがReferenceと一致し、未証明の区間ではfallbackする。

関連: [SEMANTICS](SEMANTICS.md)、[CONFORMANCE](CONFORMANCE.md)、[STRATEGIES](STRATEGIES/README.md)。
