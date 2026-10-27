# BEHAVIOR — 自律判断・継承選好・Army/Squad/Hero/Minion作用範囲

## 1. 正本の位置づけ

本書はSenkeiの**自律判断とJinreiによる部分上書き**のゲームデザイン正本。Jinreiの文法を再定義しない。[JINREI-GRAMMAR.md](JINREI-GRAMMAR.md) の `senkei / state / action / when / do`、同時評価、三値論理、明示的な `ordered`、論理CUの意味は変更しない。

- [SENRITSU.md](SENRITSU.md) はBehaviorの型、Hero Catalog、Capability、既定選択・競合の意味を所有する。
- [UNITS.md](UNITS.md) はHero・Squad・Minionの主体と所属を所有する。
- [WORLD-DEFINITION.md](WORLD-DEFINITION.md) は合法な経路のWorld情報、[BATTLEFIELD.md](BATTLEFIELD.md) は地形移動と交戦の制約、[COMBAT.md](COMBAT.md) は攻撃・追撃・撤退の処理。
- [DOMAIN-CATALOG.md](DOMAIN-CATALOG.md) はJinreiが使える型付き語彙、[JINREI-EDITOR.md](JINREI-EDITOR.md) は選好／実効判断の可視化正本。
- 複数コンポーネント間のWorld／RulePackage／Catalog identity、Worker/WASM互換性、Coverage/Trace権限の接続正本は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md)。本書はBehaviorの優先関係・作用主体を所有する。

**確定する中心原則**：HeroにはJinreiが何も書かれていなくても有効な既定行動があり、Jinreiは状況に応じてその判断の全体または一部を上書きする。デフォルトの存在はJinreiの空actionや暗黙の構文を要求しない。

## 2. 一つのJinreiと作用範囲

**プログラムは一つ**とし、Senritsuが型付きの作用対象を公開する。Army/Squad/Hero/Minion別の文法・VMを量産しない。

| 作用範囲 | 判断対象 | 実行単位・制約 |
| --- | --- | --- |
| **Army（陣営全体）** | MID/TOP/BOT、資源、重点防衛・攻勢・出撃方針 | Squad/Heroの行動そのものを暗黙に重複発行しない。対象者へ適用する目標・選好を生成 |
| **Squad** | 経路、移動、停止して交戦、撤退、隊列、共通地形適応 | Squadとして一つの移動方針・トラック・進路。メンバーが別々の進軍路を勝手に選ばない |
| **Hero** | 個別Target、攻撃、Skill、HPに応じた生存、Soloの機動 | Squad内では共通の移動／交戦モードに従い、合法な停止・交戦中の個別攻撃対象やSkillのみ選べる |
| **Minion（限定）** | レーン／陣営単位の出撃・進軍・補給／対象の方針 | 自動進軍とCENTER補給を維持。個別MinionへHero並みの自由なJinrei制御を標準提供しない |

Soloは1人Squadであり、Squad用の移動ポリシーを継承しつつ、Solo固有の高機動が有効になる。Heroの死亡・Solo復活・Squad分離／合流時には、**現在の実際の所属**から実効Profileを再合成する。

陣営全体の「MIDを優先」は複数のHeroが同一Tickに実行する強制移動命令ではなく、適用範囲と主体を明示した選好／目標の入力である。Army preferenceからSquad/Hero subjectへの適用写像、作用主体の型・安定ID・対象・多重適用をSenritsuが宣言し、Enbuが調停する。同じHeroへArmyからの共有方針とSquad/個別方針が重なった場合も、単独の暗黙コマンドにせず版付きRulePlanで解決する。

## 3. Behavior Profileの差分合成

Profileは**データ**であり、継承構文や任意の戦術コードではない。

~~~text
Senritsu Common Defaults
    └─ Hero Catalog Default Profile（個体種別ごとの差分）
           └─ Effective Squad Profile（構成Heroの決定論的集約）
                  └─ Jinreiの条件付き選好上書き（対象／フィールドごと）
                         └─ 合法性・競合調停 → Effective Action
~~~

- 各Profileは **Navigation / Engagement / Targeting / Pursuit / Survival / Objective** を最低限サポートする。Senritsuで追加可能な有限・型付きフィールド群とし、`aggressive=true` だけの単一フラグへ集約しない。
- **未指定フィールドは継承**し、指定したフィールドのみ上書き。多重指定・無効値・対象外スコープを黙って解釈しない。
- Hero DefaultはCatalog側に定義し、部隊の継承では**全員の既定選好を規範的に集約**する。単純なリーダー優先・暗黙の多数決・HashMap走査順を避ける。部隊方針がJinreiに明示された場合は、その該当フィールドだけが集約結果に優先する。
- 共通の「移動選好」とHeroごとの「攻撃対象選好」は別。Squad移動が一主体である制約を維持し、個別攻撃・Skillは停止／合法性と現在の観測に従う。
- Heroの選好が合成できないケースでは、Senritsuの全順序・集約法が定義されていなければ**検証エラー**とする。根拠のない仲裁やランダム選択は禁止。

### 推奨スコープ・合成優先度

| 段階 | 意味 |
| --- | --- |
| 1. Senritsu強制制約 | 通行禁止、Cooldown、橋の占有、Combat Domainなどを常に強制 |
| 2. Jinreiの明示的Intent | 合法な明示命令（例：退却・目標移動）を規範的に調停 |
| 3. Jinreiの条件付きPreference | 状態がtrueとなったとき、そのTickに対象フィールドだけ上書き |
| 4. Squad／Armyからの有効な選好 | 適用対象と優先度を定義した部隊／陣営方針 |
| 5. Hero Default／Senritsu Default | 未指定の判断の最終フォールバック |

これは**同一Tickの評価結果から有効な選択を導く優先関係**であり、Jinreiの宣言を上から順番に実行するという意味ではない。ArmyとSquadの競合、同階層での衝突、異なるCapability間の同一Subject／同一Field競合、同点はRulePlanの安定した**全順序**で解決する。RulePackageは競合可能性とTie-breakに必要な安定キーを宣言し、欠落・矛盾時は静的検証・RulePlan検証で拒否する。Capability単位の順位を並べただけでクロスCapability順序が定まらない場合も未定義競合として拒否する。Enbuは列挙順、actor訪問順、HashMap順やスレッド順を優先順位として用いない。

## 4. Jinrei上書きの有効期間

- **条件付きの選好上書きは原則、そのTickのスナップショットにだけ有効**。次Tickに条件がfalse/unknownなら継承値へ戻る。false/unknownを「true」として発火させない。
- **永続的な変更**を認める場合は、効果の持続期間／解除条件／所有主体を定義した**明示的な型付きCapability**によってのみ行う。暗黙にProfileを書き換えない。
- Jinreiの `state` は観測に対する純粋な三値述語、`action ... when ... do ...` はIntent候補の生成。既存のv0.1文法に `extends`／`override`／`super`／代入式を追加しない。
- 上書き対象はSenritsuが公開したCapability／フィールドに限る。引数や名称はDomain Catalogに登録されたものだけが合法。例示した名前は新しい予約語ではない。

## 5. 6つの選好ドメイン

| ドメイン | 例示可能な選好 | 注意点 |
| --- | --- | --- |
| Navigation | fastest / safest / avoid_combat、必要なら明示的な経由ノード | 最短**距離**と最短**所要時間**を混同しない。各Heroの地形適性・橋・渡河・混雑を評価 |
| Engagement | aggressive / defensive / avoid | 攻撃と移動は排他。停止して初めて通常攻撃可能 |
| Targeting | low_hp / nearest / support_priority | 可視で合法な敵だけが対象。同点はStable IDなどの規範Tie-break |
| Pursuit | none / limited / persistent | 視界・交戦Domain・経路の合法性を必ず検証 |
| Survival | HP閾値でretreat / hold | HP等はKnown/Unknownを区別し、非公開値を補完しない |
| Objective | lane_tower / jungle_camp / mid_observation / base | 陣営目標と個別の合法行動を区別 |

列挙ラベルは設計上の例であり、SenritsuのCapability名や確定Enumではない。**UI/Jinreiには名前付きプリセット**を公開し、内部では版付きのコスト重み付け（移動時間・既知の危険・目標価値）を使用できる。高度な重み編集は、Senritsuが有限値域・コスト・Tie-breakを明示する場合の型付き拡張に限定する。

### 経路の選好と経由地点

- **標準：目的地＋経路方針**。Enbuが合法エッジ列を決める。高速Hero・Jungle専門Heroと通常Heroで最適経路が異なり得る。
- **追加指定：明示的な経由ノード列**。公開されたWorld IDに存在し、現在の行動主体から合法に到達可能な順番で指定する。任意座標移動や未接続ノードへの飛躍はない。
- `fastest` は通行可の予測時間（橋／渡河の状態、地形効果、移動能力）を評価、`safest` と `avoid_combat` は**観測済みのリスクと明示したUnknown取扱ポリシー**だけを使う。
- 非公開の敵配置・戦術・将来位置を、経路候補の隠れたスコアへ混入しない。観測更新、橋破壊、目標変更、ブロック時の再計画契機と安定した同点処理をRulePlanで固定する。

## 6. 特別なWorld判断（合意）

- **ノード**：普通のノードは所有権を持たない。敵Unitの現在の存在による退出先制限は[BATTLEFIELD.md](BATTLEFIELD.md)に従う。MID観測基地など**特殊施設だけ**に占領状態を認める。
- **橋**：建設・拡張・破壊後も**公共施設**で、作業を行った陣営だけに通行帯を専有させない。A/B双方が状態に応じて通行できる。破壊しても渡河可能だが、追加時間と被ダメ不利が発生する。
- **MID観測基地**：全マップを明らかにする施設にはしない。**周辺の局所的な視界強化＋許可された観測から確定できる敵の移動方向**を把握できる。未観測の敵、敵の目的地、Jinrei、未来の移動予測は開示しない。所有権・占領速度・半径は版付き。どの観測列を方向として十分とみなすか、精度と有効期間は未決定で、[RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) の `DEC-MID-DIRECTION-001` で追跡する。不十分な証拠はUnknownである。
- **地形**：視界半径に加え、論理的な遮蔽を定義する。森林・高台・岩場等の機能は[WORLD.md](WORLD.md)とSenritsu Terrain Profileへ置く。Three.jsの可視ピクセルやRaycastでゲーム判断しない。

## 7. Deterministic Decision Pipeline

~~~text
S[t] (同一確定World)
  → 陣営別Observation（Known/Unknown）
  → Jinrei v0.1 同時評価（Intent候補 + 論理CU）
  + Catalog/Army/Squad/HeroのDefault Profile
  → 対象スコープごとの有効Preferenceを合成
  → 強制制約・Capability・優先度・競合を検査
  → Squad共通行動／Hero個別合法アクション／Minion既定進軍
  → EnbuがS[t+1]、イベント、診断を確定
~~~

- 明示命令が不合法なとき、世界を改変して成功させない。拒否理由を記録し、版付きの既定挙動へ移る。
- **行動は必ず決定可能**であり、攻撃・移動が不可能ならRulePlanが選ぶ合法な **HOLD／WAIT等の無動作フォールバック**まで到達できる。最終フォールバックはWAITとする。WAITはWorldを変化させず、CU・Tick処理・診断は既存契約に従う。適用条件を検証済みRulePlanに固定し、未解決の合法性や競合を隠さない。明示的HOLDは通常の宣言的選択候補として区別する。Senritsuが明示的なHOLD／WAIT IntentまたはPreferenceを提供する場合、それは指定された通常の優先関係に参加する。明示的な選択と、合法な行動候補がない場合の最終フォールバックはCoverageで区別する。
- 同じ主体の通常攻撃と自発的移動を同一Tickに重ねず、Squad全体の移動と一部Heroの別移動を同時に発生させない。個別Skillの発動条件と部隊停止状態は規範に従う。
- 既定判断と明示Intentをそれぞれどの程度の論理CUに算入するかは版付きCosted IR／RulePlanの責務。無償のJinrei評価を暗黙に追加しない。

## 8. Decision Provenance / Trace

行動を説明するため、**選択理由を記録する内部の型付きDecision Trace**を定義する。これは[REPLAY.md](REPLAY.md)の公開PresentationReplayとは別の**RestrictedDiagnostics**。

各Tick／主体について最低限：

| 項目 | 説明 |
| --- | --- |
| identity | match/RulePackage/World/Program digest、Tick、Army/Squad/Heroなど対象の安定ID |
| context | 公開が許された観測スナップショット参照、Known/Unknownの別、選択対象 |
| candidate | 該当したJinrei action、適用されたDefault/Squad/Army Profile、RulePlan候補 |
| arbitration | 採否、上書きされたフィールド、優先順位／Tie-break、衝突・Capability拒否理由 |
| effective | 合法な実効行動、停止・移動・攻撃・待機などの理由 |
| result | そのTickで確定した結果と結び付けるイベント参照。意図と確定結果を混同しない |

内部トレースは有限・上限付き・安定順序であり、照会するprincipalとpurposeに対応した所有者／運営者の認可、保存期間・診断上限を持つ。診断データが存在することは閲覧権限を与えない。相手の非公開判断を公開Replayや敵プレイヤー向けEditorへ流出させない。自軍側が知らなかった事実を「なぜ選んだか」の根拠として示さない。認可と一貫した情報開示は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) が横断正本。

## 9. 受入・将来の実装

1. Jinreiなしでも全Heroに合法な実効行動があり、Hero固有の既定選好による差が再現される。
2. Hero Defaultの一部の選好をSquad・Army・Jinreiで上書きした場合、**その他のフィールドは継承**される。Jinrei条件解除時は次Tickからデフォルトへ復帰する。
3. Solo／Squad構成変更後も行動主体とProfile集約が整合し、個別Heroが部隊から黙って逸脱しない。
4. fastest/safest/avoid_combatと経由ノード指定は、合法な経路・地形適性・観測済みリスク・橋の状態を評価し、非公開敵位置を参照しない。
5. MinionのCENTER自動補給／進軍をHeroと同じ任意ターゲティングで破壊しない。
6. Jinreiの同時評価／三値／明示的順序／CUと一致し、Conflictで未定義の優先順位があれば検証時に拒否する。
7. Profileのみ・Jinrei上書きあり・実戦結果の三者をDecision Traceで照合できる。Native/WASMのIntent、CU、結果と認可境界が一致する。

**未確定の数値**：各プリセットのスコア重み、追撃距離／HP閾値、集約時の数値式、MID観測半径、攻撃準備・硬直のTick。値を変えても継承構造と既存Jinrei文法は変えない。

## 本番評価とIntent確定

6領域のProfileはSenritsuが所有する有限・型付き定義とし、有限値の宣言的な式・重み・安定したTie-breakで評価する。任意スクリプト、浮動小数点の不安定な評価、列挙順依存を導入しない。合法な観測・対象・候補を型検査し、重み・閾値・Capability対応の未定義値を推測しない。

一つのIntentが複数fieldへ作用するとき、field別の勝者だけで部分実行しない。同Tickの候補集合に対しRulePlanの安定した全順序で行動単位の整合性を解決し、未定義競合を拒否する。Jinrei候補からProfile候補、合法性、競合、最終決定、World遷移、確定Eventまで同じ識別系列で追跡する。Owner diagnosticsはpublic Replayと分離し、敵の非公開判断・Program・観測を公開しない。
