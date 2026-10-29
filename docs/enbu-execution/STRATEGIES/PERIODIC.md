# Periodic — 周期計算と位相キャッシュ

> 状態: 研究からの移植設計。合成Simulation Labの `periodic` / `phase_cache` は厳密なEnbu/Jinrei/Fogの周期性を証明していない。適格な閉区間でだけ導入する。

## 1. 何を圧縮するか

繰り返す予定（一定周期の攻撃可能Tick、閉じた周期的可視性、周期wave等）を毎Tick調べる代わりに、**一つの位相サイクルの構造を作り、必要な区間へ移動・積算する**。

同じ攻撃周期 `Δ` と初期位相 `f`、視界周期 `P` が固定されている独立actorであれば、発火可能時刻は

```text
Eligible(t) = t >= f
           AND (t - f) mod Δ == 0
           AND VisiblePhase(t mod P)
```

となる。ただし本式は**候補列の式**であり、実際の攻撃成立にはターゲット/HP/防御/Skill/通常攻撃との排他・既存Nextフェーズ等の証明が必要。

位相サイクルの周期は `lcm(Δ, P)` となり得るが、巨大化・overflow・キャッシュ作成費用がある。実際には必要窓・残り試合長・位相数の上限を確認し、構築価値がなければ直接周期反復やReferenceにする。

## 2. 周期証明書

最低限含めるもの。

```text
PeriodicCertificate {
  source_version, window=[a,b], actors, target_ids,
  period, first_due, phase_vector_or_formula,
  fixed_input_fields, fixed_visibility_semantics,
  excludes_external_writes, output_obligations,
  expiration_tick, required_rechecks
}
```

証明条件:

- Tick依存が解析済みの周期状態として閉じ、途中のRulePlan/Jinrei/Behavior/Memory/施設/視界の外乱が**ない**。
- actor/targetのID、生死、位置、side、射程、interval、lock、HP/Shield/防御/命中判定の依存が閉じている。死亡による中断が可能ならその境界で必ず計算を停止。
- フルReplay/CU/diagnostics/Owner Fog等に必要な各Tickの事象が復元可能で、隠れた未評価ロジックがない。
- 周期性は「名前」や観察された繰返し回数ではなく、**依存が不変である証明**から導く。

実WorldのFogは通常、表示だけでなく探索済み履歴とFacilityの最終観測Tickを更新する。視界の幾何学的周期が一致しても履歴が完全に同じとは限らない。自動的にPeriodicへ入れない。

## 3. 位相コンパイルとShift

時刻 `t_0` のサイクルにおける攻撃時刻を `e_1...e_k` とする。これを周期 `P` だけずらしたサイクルの時刻は `e_i + P`。イベント数と時間和は、

```text
count'(cycle + qP) = count(cycle)
sum_ticks'(cycle + qP) = sum_ticks(cycle) + count(cycle) * qP
last_tick'(cycle + qP) = last_tick(cycle) + qP
```

`q` 周期分の集約は必要に応じて整数式で計算する。初端/終端が途中の周期のときはprefix rangeを計算し、時刻を含む境界（`<= b`）を参照と完全一致させる。和・掛算のchecked overflow / saturating semanticsも参照に合わせる。

### Phase Cache

キーは `(RulePlan/World/dependency version, target/actor identity, interval, initial phase, visibility cycle, window shape, output contract)` 等、**結果へ影響する全要素**。研究では `(interval, firstVisible mod period)` を含む位相コンパイルを共有したが、実Enbuではより多い依存キーが必要。

```text
get_or_compile_phase(certificate)
  if proof invalid: reject
  if cache hit with identical dependency versions: reuse
  else: build exact cycle within bounded memory/time
  evaluate interval using prefix counts and shifts
  materialize required ordered outputs
```

キャッシュは純粋な高速化道具であり、ゲームの権威ではない。cache miss/hitで出力・CUが異なってはならない。

## 4. 使い分けと費用

| 状況 | 候補 |
| --- | --- |
| 周期が短く頻繁に再利用される | 位相キャッシュ + 集約 |
| 周期が長く1回しか使わない | 直接Periodic計算 |
| 攻撃回数が多いが固定可視性 | Arithmeticが安い可能性 |
| 不規則な視界/計画外変更 | Event Queue / Active / Reference |
| Full Replayが必要で攻撃数が多い | 再構築費用 `Ω(K)` を足して比較 |

計算量の目安は `O(P + K)` のサイクル構築/出力（`P` はサイクル長、`K` は物理出力個数）から、再利用時の `O(1)` 前後の累積計算へ移る。実際は可視性計算とphase lookup費用があり、`P` が巨大だとReferenceより悪化する。これは総コストの候補であって性能保証ではない。

## 5. 即時無効化するもの

- Move/Pursue/Retreat/bridge/ford/track、位置・速度・経路・視界source・Reveal/消失。
- Hero/SquadのSplit/Merge/成熟/Skill/Lock/Shield/Heal、XP/level、ターゲット切替。
- Minion wave/neutral respawn、施設Capture、データ/RulePlan変更。
- Jinreiの観測/Memoryが周期の外側の状態を読む、CU/診断/出力義務が追加される。
- 同Tickの別Domain書込み、終局確定、host limitの早期到達。

失効時は**まだcommitしていない区間**を破棄し、最も近い正規Checkpointから再計画またはReferenceへ戻る。無効な位相を1Tickだけ継続してはならない。

## 6. 検証の強制項目

- `f = b`、`f > b`、初期位相/周期の非整除、負の位相調整、`P` 周期ちょうどの境界。
- `count`・`sum_ticks`・`last_tick` のshiftとprefix、checked整数overflow。
- キャッシュなし/あり/当Tickで無効化の三経路、単独/複数actor。
- 攻撃者死亡、視界消失、Fog記憶、Shield再付与などで適格性が正しく拒否される。
- Native Rustと**実WASM**、Reference TickのFull Replay/CU/diagnostics/Owner出力まで一致。
- 測定はcache生成・検証・Replay実体化・シリアライズ費用を含める。

関連: [ARITHMETIC](ARITHMETIC.md)、[PLANNED](PLANNED.md)、[Scheduler](../SCHEDULER.md)、[Conformance](../CONFORMANCE.md)。
