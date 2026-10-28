# Temporal Dependency IR とコンパイル計画

> Status: **設計候補**。新しいJinrei構文やRulePlanの規範的意味を追加する提案ではない。現行Typed/Costed Logical IRと専用Bytecode/VMを前提に、物理実行計画を追加する。

## 1. コンパイル階層

```text
Attacker Jinrei -> parse/type/validate -> Costed Logical IR -+
Defender Jinrei -> parse/type/validate -> Costed Logical IR -+-> Temporal Dependency IR
Verified Senritsu -> Domain/Effect/Phase summaries ---------+
World logic + fixed configuration + initial state -----------+
                              |
                   Analyze read/write/guards
                              |
           SCC / invariants / exact arithmetic / observer
                              |
           Partition into independently solvable regions
                              |
          Simplify recurrences / guards / periodicity
                              |
     Cost models -> mixed physical execution plan + fallback
                              |
           Enbu semantic reconstruction / replay / CU
```

構文上の`state`は副作用のない**名前付き述語**。`TacticalMemory`とは別物。SenritsuのDefaultBehaviorとJinreiによるOverride、非主体の施設/目標・Waveも導入して初めて完全な遷移となる。

## 2. 最小ノード形式（擬似Schema、未実装）

```text
FieldRef   {scope, entity_or_group, field_id, version/phase}
ValueExpr  {type, op, args, numeric_semantics, provenance}
Guard      {truth: True|False|Unknown, expr, observation_side, phase}
Effect     {reads[], writes[], expression, guard, phase, order_key}
Schedule   {time_domain, next_boundary, interval_invariant, expiry}
Output     {intent, logical_cu, diagnostic, replay_projection, termination}
Proof      {preconditions, formula, invalidators, arithmetic_domain}
PlanNode   {method, state_region, guard_region, time_window, fallback}
```

**必須:** 1Tick内の複数Snapshot/Commit境界を区別するMVCC的なVersion付与。`phase=observation`のReadが、同Tick遷移後のWorldを誤って読むことを型/検証で防ぐ。Read/Writeの集合と観測の権限は別の軸として記録。

## 3. 静的・動的パス

- 静的: Domain Schema/RulePlanと両Costed IRを検証し、Read/Write、Capability Effect、型、演算意味論、Guard、CUイベントを抽出する。
- Static Abstract Interpretationで不変・範囲・単調・周期・Knownnessの可能状態を解析。SCC/因果分割を構成する。
- 固定RulePackage/Program digestを使うPartial Evaluation。非公開の敵情報は**実行計画の内部入力**には使用できても、相手Jinreiの観測意味を変更する最適化には使用しない。
- 動的: 初期Worldで特殊化し、Tickの局所条件を照合、境界時刻を導出、実行結果に合わせ依存部分だけ再計算する。
- 任意のRulePrimitiveでeffect summary未宣言、数値Domain未証明、観測伝播を証明できない場合は **opaque + per-Tick fallback**。

## 4. `NextBoundary`の契約

```text
predict(node, current_state, t, horizon) ->
  {earliest_candidate_tick, proof_of_no_earlier_change, dependents, generation}
```

候補には「この時刻に必ず変化」だけでなく「この時刻以前に条件変化を否定できない」を含む。優先キューから最小Tickを選ぶ場合も、**他の未列挙Guard/全域Effect**がそれ以前に作用しない証明が必要。

再計算の契機: Read Setへの書込み、Entity生成/消滅、Collection membership、視界Knownness変化、Global Buff、World Edge/Bridge更新、命令/行動モード変更、Tick境界でのTimer/CU変化。予測には世代番号を振り、古いイベントをスキップする（ただしキューに蓄積した失効候補のメモリ上限を持つ）。

## 5. 同時相互作用のcommit

同時Tickを複数ユニットで順次コミットしない。各Tickの合法Snapshotで双方のObservation・Jinrei・DefaultBehaviorを確定し、Senritsuの規範的優先度とコンフリクト解決順を適用してから状態をcommitする。独立SCC/リージョンのみ物理的に並列化できるが、合流点では同期Barrierを設ける。

## 6. CUと論理トレースを消さない

計算を物理的に1回へ畳み込んでも`Costed Logical IR`が要求した論理評価イベントは維持する。
- 論理CUは`ordered`短絡の有無、コレクションの実際の対象数、未参照stateの有無、budget overrunに依存する。単純な`perTickCost*k`とみなすのは**区間内で論理評価パスが不変と証明した場合のみ**。
- 全TickのRestrictedDiagnosticsを要求する場合、論理的な各記録を**遅延復元**またはスキップせず物理生成する。出力件数の下限を認める。
- Public/Owner/Restricted投影は同じ意味状態から、権限別に再構成する。秘密のJinrei/未観測HPをPublic Replayへ載せない。
- 物理キャッシュの共有によって論理CUが変化するなら不適合。消せるのは物理ロード/演算であって意味上の評価ではない。

## 7. Compiler pass の候補順

1. Typed Semantic IR & Costed Logical IR（現行の権威）
2. Domain/Capability/DefaultBehavior effect elaboration
3. Read/Write/Phase/Observation graph構築
4. Numeric semantics + exactness annotation
5. SCC、Reachability、Unchanged Guard、Cost provenance分析
6. Constant/partial evaluation、DAG sharing
7. 区間/周期/閾値/相互作用式の候補作成
8. Proof obligation + cost estimation（予測失効・式サイズも含む）
9. Optimal *estimated* plan selection + fallback挿入
10. Native/WASM両方のコンフォーマンス検証

## 8. 規模と安全予算

Compilation cost `C_compile`、Plan bytes `M_plan`、Runtime evaluations `C_run`、Replay bytes `B_out`。単発戦闘で`C_compile + C_run + B_out`が現行Tick実行より悪化するなら採用しない。コンパイル結果をキャッシュして複数試合へ再利用する場合は、World/Rule/Program/CostSchedule版と秘密境界を完全に識別する。式展開深度、SCCサイズ、予測数、メモリ、事前計算時間には限度を置く。

## 9. 証明の粒度

数学的に厳密なProof Engineを最初から作る必要はない。限定した変換に**型付き事前条件と機械的検証器**を持たせ、満たさなければ遷移を逐次実行する。受入はgoldenケースと差分検証で行うが、テスト一致だけを一般の数学的証明とは呼ばない。
