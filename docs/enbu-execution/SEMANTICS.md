# Hybrid実行の意味論と厳密なTick契約

> 状態: 設計契約。既存RulePlanとEnbuの正規動作を**変えずに**物理実行だけ圧縮する。最新実装上の順序を確認した基点は `crates/enbu/src/lib.rs::simulate_inner`。本書は新しいゲームルールを追加しない。

## 1. 参照実行の数学的定義

入力全体（両戦型、署名/版付きRulePlan、World identity、Program/Behavior設定、初期状態、上限）を `I` とする。参照実行のTickごとの内部状態を `S_t`、Jinrei/メモリ/観測および出力を `O_t` とすると、

```text
(S_t, O_t, E_t) = ReferenceStep(I, S_(t-1), t)
Artifact = CanonicalAssemble(I, O_0...O_final, E_0...E_final)
```

`S` はWorldStateだけではない。双方のTacticalMemory、CU消費量、diagnostics sequence、FogHistory、Behavior/route/relation runtime、イベントカウント、outcome、Replay公開/owner蓄積、ホスト上限評価など**次のTickの結果へ影響する全可変状態**を含める。`O_t` は公共・陣営別の**認可済み観測**、公開/owner ReplayFrame、診断参照、論理CU、終局/失敗など外部から区別できる情報を含む。

Hybridの区間実行 `FastStep(S_a, [a+1,b])` は、参照逐次実行した場合の `S_b` と、必要な `O_(a+1)..O_b`・`E_(a+1)..E_b` を**同じ順序で再現できる**場合のみ採用可能。同じ最終HPだけでは不十分。エラー発生Tick、上限超過、Jinrei状態評価や課金が異なれば不合格。

### 正規出力を減らさない

APIが全Tick `ReplayFrame` を要求するなら、戦闘イベントのないTickにも有効なフレームと適切なFog/状態が必要。結果のみの軽量モードを将来定義する場合は**別の明示API契約**とする。既存APIの出力省略で性能改善としない。

## 2. 現行EnbuのTickフェーズ（参照順序）

次は現行main `simulate_inner` の処理を**便宜上の意味フェーズ**に区切ったもの。新しいフレームワークの実装済みステップ名ではない。

| フェーズ | 主な現在の処理 | 厳密に保持する境界 |
| --- | --- | --- |
| P0: 初期化 | `initialize_match`、初期Owner Fogフレーム、Tick 0終局 | World/RulePlan/Program/CU/Version identity、初期観測 |
| P1: Tick開始ライフサイクル | `objective_lifecycle`、`next_vision::lifecycle` | リスポーン、パッシブ・wave、Reveal期限切れ、当Tickの観測に間に合う副作用 |
| P2: 同時観測 | 双方の `observation` を先に生成 | 両陣営は同一のP1後Worldを観測。敵への未認可アクセス禁止 |
| P3: Jinrei/Behavior | 両側 `call_executor`、CU/診断/上限/overrun | 実際に評価される論理操作、メモリ候補と命令候補、失敗処理 |
| P4: 検証/調停 | capability合法性、Behavior、Minion Control、`arbitrate`、Squad/goal conflict | 同Tickの候補と安定順序、拒否・受理理由、メモリcommit |
| P5: 宣言的遷移 | `apply_transitions` | RulePlan phase/order、原子的更新、競合/overflow/構造変更、条件付き終局 |
| P6: Next事前準備 | `next_squads::intents`、`next_tactics::apply`、Battlefield/skill reserve | アクションロック、同Tickの命令確定順、action_start/skill_start/adjudication_startの区別 |
| P7: 移動・攻撃・施設 | `next_navigation::advance`、`next_combat::resolve_from_snapshot`、Battlefield resolve、Squad lifecycle | 移動先Worldと**移動前の凍結攻撃判定**、同Tick攻撃、視界、施設占拠 |
| P8: 検証/観測/投影 | `validate_world`、trace境界、public/owner `ReplayFrame`、`FogHistory` 更新 | public/owner非対称性、正しいイベント参照、Tickごとの出力、上限 |
| P9: 終局 | Next base破壊、`evaluate_termination`、最大Tick上限 | 同Tick全効果後の終局、理由・時刻・引き分け裁定 |

`next_*`の詳細フェーズはRulePlanと既存実装の契約に従い、表の名称より優先される。初期SenritsuとNextには異なる条件分岐があるため、Next固有の最適化を一般RulePlanへ無条件適用しない。

## 3. 観測と行動の厳密性

1. P2で双方の観測を確定してからJinrei VMを順次呼び出す。呼出し順が他方の観測を変えてはならない。
2. 強KleeneのKnown/Unknown、Jinreiの同時評価、明示的なordered評価、各論理操作のCUは [JINREI-GRAMMAR](../JINREI-GRAMMAR.md) および [EXECUTION](../EXECUTION.md) に従う。「命令が変化しなかった」ことはJinrei評価を飛ばす根拠ではない。
3. 両側のIntentは検証・調停後に確定する。スキル、通常攻撃、移動は既存の衝突・ロック規則を守る。
4. 基本攻撃・スキルは同Tick開始時点の凍結状態から選択し、その後の同時ダメージを合算する。被撃で死亡する攻撃者も同Tickに選択済みの攻撃を行う。
5. 終局、XP/レベル、Shield、Heal、Cooldown、Respawn、Squad maturity、橋・渡河・占拠、ノード退出の判定は整数・安定順序のまま扱う。
6. Public ReplayとOwner Replayは等価なデータではない。Fog/最後の施設観測、非公開Actor/Skill/Program、decision traceの隠蔽は [OBSERVABILITY.md](OBSERVABILITY.md) に従う。

## 4. Execution Frontierの有効性

時点 `t` から `f > t` へ物理的に進めるには、区間 `(t,f)` の**すべての参照義務**を検証する。次のうち1つでも未解明なら範囲を短縮またはReferenceへ戻す。

- **時間依存**: attack_ready、action_lock、移動進捗、Skill効果期限、energy再生、wave、Monster respawn、Squad maturity、cooldown、期限付きReveal、終局/timeout。
- **状態依存**: HP/Shield/Target/地形/橋状態/同Tickの占有と経路、スキル効果・範囲、死亡・生成・消滅による集合形状変更。
- **観測依存**: 双方のObservationSnapshot、Jinrei/Behaviorの評価、Owner Fogの探索履歴、Facility記憶、公開イベントと診断。
- **全体依存**: RulePlanの任意transition/termination/上限検査、Costed IRの論理操作、外部へ返すReplayFrameやOwner trace。
- **未登録/動的参照**: 未知のRead/Write、正規化しない比較や拡張Capability、古い依存証明書。

この時刻/依存の「最初の変化可能点」を**Execution Frontier**と呼ぶ。証明書は「前回と同じだった」という経験則ではない。特定の検証済みPlan・World/Memory版・出力モード・上限・区間に対して有効な演繹結果である。

### 具体例

- **安全候補**: 動的観測/遷移の存在しない閉じた独立領域で、攻撃間隔と対象HPが不変、次の攻撃まで他の書込みがなく、区間途中の完全Replayを再生成できる。Arithmeticで次の致死境界を求められる。
- **危険例1**: Tick 5で相手が視界へ入る。事前に「Tick 20まで攻撃なし」と記録していても、視界更新で予定は無効。
- **危険例2**: Tick 10で橋が壊れ進路と渡河時間が変わる。既存移動予定/到着時刻を再計画する。
- **危険例3**: Tick 11にJinreiが同じIntentを返したとしても、評価操作数・メモリ更新・診断が発生する。評価を無条件省略できない。
- **危険例4**: Tick 12に死亡しても、同Tickに選択された攻撃を消してはならない。
- **危険例5**: 同一最終HPでも、途中のOwner Fogやイベント順が違うなら不一致。

## 5. 証明義務・数値契約

```text
PermitFastWindow(plan, state, [a+1,b], required_outputs) iff
  VerifiedRulePlan identity matches
  AND every read is versioned and every possible write is accounted for
  AND no earlier observation/decision/host limit can distinguish the window
  AND the selected kernel reconstructs the exact per-Tick ordered obligations
  AND switch/fallback preserves the full mutable reference state.
```

- 参照の整数演算・丸め・saturation/checked overflow、イベント/EntityIdのタイブレーク、最大イベント数/CU/診断数/メモリ上限を保持する。
- 正規比較は単なるSHA同値だけでなく、最初に差異が発生したTick・フェーズ・要素と、native/WASMの最終完全JSON同値を含む。
- 証明失敗は高速化失敗であってゲームの失敗ではない。物理実行をReferenceへ戻して同じ入力から継続する。部分的に副作用を確定した後で再実行・二重CU課金することは禁止する。

関連: [PLANNER](PLANNER.md)、[SCHEDULER](SCHEDULER.md)、[OBSERVABILITY](OBSERVABILITY.md)、[CONFORMANCE](CONFORMANCE.md)。
