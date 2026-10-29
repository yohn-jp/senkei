# Arithmetic — 閉形式集約・最初の致死Tick

> 状態: 数理研究を実Enbuへ移植する際の**厳密な適格条件付き契約**。TS合成モデルの計測倍率は本番性能ではない。

## 1. 目的と数学モデル

一定周期で一定の有効ダメージ `d_i` を同じ対象へ与える主体 `i` が、時刻 `f_i` から間隔 `Δ_i > 0` で攻撃するとする。時刻 `t` までの**候補攻撃数**は

```text
H_i(t) = 0                          (t < f_i)
       = 1 + floor((t-f_i)/Δ_i)      (t >= f_i)

D(t) = Σ_i d_i H_i(t)
τ = min { t <= horizon | D(t) >= HP_initial }
```

となる。これは**固定Target・永続可視・非減少の正味ダメージ・割込なし・完全に独立な群**に限った式である。自動的にNextCombat一般に適用できる式ではない。Damageに防御/Shield/最低ダメージ/ford倍率などがある場合、それらを正規整数規則により**一定と証明された最終damage**へ変換しなければならない。

`τ` を求めるとき、`D(t)` が単調であることを証明してから二分探索できる。初回/終了Tickは参照と同じ**包括境界**で評価する。`HP <= 0` の初期状態、`d_i <= 0`、`Δ_i = 0`、overflow等を前提通り明示的に処理する。

## 2. 同時攻撃と致死境界

同じTick `τ` に攻撃可能な**全主体**が、参照ルール上の凍結フェーズで選択済みなら、その全攻撃を出力/状態へ反映する。最初の一撃でHPが0になっても残りをキャンセルしない。

```text
first_lethal_tick = binary_search(D(t) >= initial_HP)
active_at_tau = all eligible attackers whose due Tick is tau
stage EVERY hit from frozen precombat state
apply all simultaneous damage with canonical shield/defense order
resolve deaths, rewards, cooldowns, XP and events in reference order
```

重要: `D(τ)` の数値一致だけではReplay/XP/攻撃元の行動ロック/target候補診断まで一致しない。攻撃者ごとに出力・内部clockを復元できる証明が必要。実Enbuは同時選択後のSkill適用→攻撃値/防御値→Shield/HP→Death/XPなどの順序を持つ。式で簡略化するときにも同じ効果順を保持する。

## 3. 安全にEligibleとなる必要条件

- 各actorとTargetが窓内で固定。ターゲットの死亡/スキルによる切替、戦闘からの移動や生存による隊列変化がない（または正確な早期停止境界がある）。
- 攻撃可能性、readiness、range、視界、action lock、damage、defense、shield、ford multiplierなどが**窓全体で一定**、あるいは正確なpiecewise構成を証明できる。
- Heal、regen、shield再付与、XP/Levelによる強化、Skill発動、Squad効果、相手反撃、複数Targetへの波及など単調性/独立性を破る外乱がない。
- RulePlan/Jinrei/BehaviorのTickごとの状態・CU・診断・観測を完全に再構築できる。できなければ最適化可能なのは**非権威の内部計算部分**のみ。
- 撃破時刻、最大Tick、host event cap、reward distributionと整数オーバーフローの意味が一致する。

上記は十分条件の全列挙ではない。RulePlanや拡張Mechanicsを解析できなければEligibleにしない。

### First-volley specialization

最初に攻撃可能となるTick `f` での**全員の合計**が確実に致死なら、次の時刻を繰り返し探索する必要はない。ただしそのTick前の全ての他の書込み/観測/出力と、命中/ダメージ/死後効果を検証する。単に「低HPの敵がいる」ことだけではfast pathに入れない。

### Singleton specialization

独立した一人のactorに対象・周期が固定されているとき、`H(t)` を直接計算できる。複数actorへ共通の前処理を行う必要がなく、Plannedの分類も省ける場合がある。Subject/Targetの一対一関係をID重複のない**全単射として証明**すること。

## 4. Periodicとの差・計算量

Arithmeticは単調な累積関数から**任意Tickの集約値と致死境界**を直接求める。Periodicは周期的な候補列/可視位相を扱い、必ずしも単調ダメージモデルとは限らない。

固定独立群を前提にした致死探索の計算量は概ね `O(A log T + K)`。`A` は群内actor数、`T` はTick窓、`K` は出力として実体化すべき攻撃/イベント/Replay。出力Kの下限を消せない。Plan構築、Eligibility/Dependencyの検証、全Tick観測の必要費用は別途加算する。

整数演算は `i64/i128` の表現と参照のchecked/saturating semanticsを維持する。合成モデルの演算を浮動小数点へ置き換え、僅差の致死Tickを誤らない。

## 5. 禁止する短絡の例

| 状況 | Arithmetic適格性 |
| --- | --- |
| 固定位置、一定damage、独立一人、外乱なし | 候補 |
| 同じ対象へ複数人が同Tick攻撃 | 全員同時採用と報酬配分を正確に復元できる場合のみ候補 |
| Skill Shieldが今Tickから付く | 防御/盾順序を未解析なら不適格 |
| 攻撃可能だが攻撃者が移動中 | 動作排他が変化するなら不適格 |
| ターゲットが視界から外れる | 固定可視仮定が壊れ不適格 |
| 全体Jinreiが毎Tick評価する | 全体区間スキップは不適格。局所集約のみ検討 |
| Full Replayが必須 | Aggregateだけ返す実装は不適格。イベントを正規に実体化する |

## 6. 設計API

```text
ArithmeticPlan {
  group_and_bijection_proof, [a,b], immutable_attack_clocks,
  damage_and_defense_proof, all_external_dependency_versions,
  required_outputs, max_event_limit
}
arithmetic_execute(plan):
  verify proof before commit
  compute H_i(t) and first lethal τ (if any)
  reconstruct per-actor attack_ready/action locks, death/XP/events
  stage canonical ordered effects and intermediary output obligations
  validate & commit or abort-to-reference
```

全体状態に影響するReward/Skill/respawnまで式で閉じていない場合は**そこを境界として止める**。続きは別のStrategyかReferenceで計算する。

## 7. Differentialゲート

- 0/1/複数actor、先頭Tick/最終Tick/致死Tick直前・同時致死。
- 同期/非同期のinterval、HPちょうど、Shieldと防御の境界、integer overflow。
- 自軍/敵軍/中立、複数チーム由来のReward、全員同時死亡でも攻撃が有効。
- 不適格となるHeal/Reveal/movement/bridge/Skill/target switching/Jinrei global dependencies。
- Native/WASM、実際の全Replay/Owner Fog/CU/診断/limitのReference一致。
- plan+materialization+serialization込みの総時間を報告。

研究の数理的証拠: [PORTFOLIO-DISPATCH](../../simulation-optimization/PORTFOLIO-DISPATCH.md)。観測の正本: [SEMANTICS](../SEMANTICS.md) と [OBSERVABILITY](../OBSERVABILITY.md)。
