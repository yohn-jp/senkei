# PRE-BATTLE-SCREENS — 画面別情報設計・ワイヤフレーム・開始ガード

## 1. 位置づけ

[PLAYER-JOURNEY.md](PLAYER-JOURNEY.md) が「プレイヤーが何を決めるか」、[PRE-BATTLE-FLOWS.md](PRE-BATTLE-FLOWS.md) が「どこからどこへ移動するか」を所有する。本書は**各画面の主目的・表示情報・編集できる設定・操作・ガード・戻る先・Desktop/Mobileの異なる操作モデル**を所有する。

- **画面構成の提案**：Screen ID S00〜S16と下記のワイヤフレーム。「一画面にすべてのフォームを詰め込む」という合意ではない。
- **確定済みドメイン**：Hero 5体固定、初期12種、Skill Plan、7種類のSquad分割、RulePackageとCatalog、Jinrei v0.1、ローカルPvE、自動Enbu、診断の可視権限。詳細は[HERO-ATELIER.md](HERO-ATELIER.md)、[UNITS.md](UNITS.md)、[JINREI-EDITOR.md](JINREI-EDITOR.md)等を優先。
- **未実装の提案画面**：「開始・再開Home」「Quick Preset確認」「シナリオ・NPC選択」「準備確認」「包括的な復旧」は現行の存在を主張しない。**新規UIの見た目・操作はまだ受入未了**。
- **実装の現在値**：現行シェルはTactics / Next / Battle lab / Library、Next内部はFormation(Collection/Detail/Skills/Squads) / Jinrei / Battle / Analysis。Nextには初期5 Heroと相手側Starter、Jinrei compile、LocalStorageの保存・Recovery Copyがある。旧Library(IndexedDB)とは別。以下のワイヤフレームを既実装完了とは扱わない。

## 2. UI領域と永続する情報

すべての編集Screenの共通要素は**現在のSenkei（Draft name/identity）、Ruleset、保存状態、進行状況、戻る・次へ・準備確認**。これらを毎回同じ大きさのパネルに詰め込む意味ではない。

| 共有モデル | UIが見せる事実 | 禁止する表示 |
| --- | --- | --- |
| Senkei Draft | どの5 HeroとJinreiを編集しているか／未保存・保存済み・復旧中 | 保存失敗の後にSavedと表示 |
| Ruleset / World | 名称、版、互換性。詳細digestは必要時に確認可能 | UIの固定値を正式ルールとして表示 |
| Stage / Progress | 必須設定の不足・有効・未検証と次の修復画面 | Screen訪問回数を「設定完了」と扱う |
| Compilation | 現行Draft revisionへ対応した実Compiler結果、CU見積 | 旧SourceのCOMPILEDを新Sourceへ流用 |
| Current Selection | 選択Heroスロット、Skill Plan、Squadが同一Draftを参照 | DetailとSkillで別々のHeroを選択して気付かない |
| Opponent / Scenario | 選ばれたNPC・初期条件、観測許可の範囲 | 未選択の相手をランダムに決めたふり |
| Battle Result | 確定RunのMatch identityと結果。最新Draftとは別 | 古いRunの診断を現在編集中の判断として表示 |

## 3. 全Screenの契約（操作・成功出口・失敗・復帰）

| Screen | 第1視線／中心タスク | 主要操作と次の画面 | エラー・戻り先 |
| --- | --- | --- | --- |
| **S00 起動** | Local Core／RulePackage／Catalogの読込状態 | 利用可能なG2へS01 | 不可ならS15。「偽の読込％」を出さない |
| **S01 Home** | 初戦を始める、編集を続ける、保存から復帰 | Quick→S02→S03、Custom→S02→S04、Continue→S14、Sample→S16 | 未保存Draftがあれば変更/破棄の影響を明示 |
| **S02 対戦条件** | Local PvE・NPC・RulePackageと何を相手に戦うか | 検証済みNPC/Scenarioを確認し、QuickならS03、CustomならS04、Readyから戻るならS10 | 無効NPC／非対応Rulesetなら選択不可・S15 |
| **S03 Quick確認** | 自動入力済み5 Hero、Skill、Squad、Jinrei、NPC | 設定を見る→S04/S06/S07/S08、現在値で準備確認→S10 | Preset欠落・不正なら「すぐ戦う」不可、修正可能な画面へ |
| **S04 Hero Collection** | Catalogの12種類と現在5枠の差分 | 枠の選択→Hero採用／差替え、詳細→S05、Skill→S06 | 未知Hero／重複制約はSenritsu判定、フィルター0件は解除 |
| **S05 Hero Detail** | 同一Heroの外観、3軸、実ステータス／Capability | 戻る→S04、Skill計画→S06、Hero切替→S04/S05 | GPU未対応はデータ閲覧可能。素材不足は架空の完成モデルを表示しない |
| **S06 Skill Tree** | 選択Heroの分岐・取得予定と前提 | 有効Branch選択、別Hero、Squad→S07、Collectionへ戻る | 必須前提なし・未登録Capabilityを拒否。予定を取得済みとしない |
| **S07 Squad/Deployment** | 5体の所属、7分割、共有起点／隊列 | 人数分割、所属／初期Node編集、Jinrei→S08 | 不一致Squad開始Node、同一Hero二重所属、未定義NodeはReady不可 |
| **S08 Jinrei Workbench** | Defaultと明示命令、選択Hero/Squad/Army、構文／CU | No-code/Text/保存、実Compiler、Coverage→S09、Ready→S10 | compile拒否・Catalog不一致なら編集を残し修正。旧Compileを失効 |
| **S09 Coverage** | どの状態クラスにExplicit/Inherited/Default/Wait/Not Provenがあるか | 絞込・差分、選択した該当ActionへS08、ReadyへS10 | Unknown、Not Checkedを「正しい行動保証」と見せない |
| **S10 Ready** | 全必須入力が開始可能か、足りないのは何か | 不足をクリック→該当Screen、Ready→S11、必要なら保存→S14 | invalid/staleは開始不可。エラーの特定先を明示 |
| **S11 Enbu実行** | ローカル計算の進行状況と対象Snapshot | 成功→S12、失敗→S10 | 二重開始しない。中断・失敗を成功結果と混同しない |
| **S12 Battle** | 実Replay、現在Tick、Fog/Unknown、カメラ、再生操作 | 再生/停止/seek、分析→S13、再戦→S10 | Renderer/GPU失敗はReplayを保持して再試行 |
| **S13 Analysis** | 勝敗、観測イベント、Decision Trace、前回との比較 | 同条件再戦→S10、修正→S04/S06/S07/S08、保存→S14 | 診断がRestricted/Not Checkedなら明示、非公開敵情報を出さない |
| **S14 Library** | 保存物、Recovery、Revision、Import/Export | 互換性確認→S03/S04/S08、作業へ戻る | 破損・旧版・容量不足→S15、元データ保全 |
| **S15 Recovery** | なぜ進行不能か、どこへ戻るか | 読込再試行、正しいRuleset再選択、修正画面・Exportへ | 破棄や移行は明示確認、黙って消さない |
| **S16 Sample/Legacy** | G1 Fixture・旧初期Rulesetの独立したサンプル | 実サンプル起動、Homeへ戻ってG2開始 | 初期JinreiデータをNextの5 Heroへ暗黙変換しない |

### Screenを訪れただけではDoneではない

Hero DetailやCoverageは**任意の閲覧面**。S04/S06/S07/S08の各内容はQuick Presetで代入済みなら編集を省略可能。ただし、開始可否は画面訪問フラグではなく**検証済みの実データ**からのみ導出する。

## 4. Desktop：低忠実度ワイヤフレーム

### 4.1 開始・再開／Quick Preset

~~~text
┌──────────────────────────────────────────────────────────────────┐
│ SENKEI | 戦型名／状態                         LOCAL PvE / Ruleset│
├──────────────────┬───────────────────────────────────────────────┤
│ ナビゲーション   │ 何から始める？                               │
│ HOME             │                                               │
│ 編成             │ [ すぐ戦う ] [ 自分で編成 ] [ 続きから ]       │
│ Jinrei           │                                               │
│ Battle / Analysis│ 現在のローカル環境と選択中NPC                 │
│ Library          │ 前回の設定／Recoveryの有無                    │
└──────────────────┴───────────────────────────────────────────────┘

Quick確認:
┌──────────────────────────────────────────────────────────────────┐
│ 検証済み初期Preset  |  対戦相手・Ruleset                         │
├──────────────────────────────────────────────────────────────────┤
│ 5 Hero [1][2][3][4][5]    Skill計画     Squad配置                │
│ Jinrei preset概要         観測・Behavior Defaultの実状態       │
│ [編成を変更] [Jinreiを変更]             [ 準備確認へ ]          │
└──────────────────────────────────────────────────────────────────┘
~~~

初戦では「コードを入力してください」と迫らない。Preset名・適用先・NPC・内容を読まずに不可逆な対戦へ進む設計にもならない。保存は任意。

### 4.2 Hero Collection・Detail・Skill Tree・Squad

~~~text
┌──────────────────────────────────────────────────────────────────┐
│ 戦型  |  5枠  |  保存状態 | Collection · Detail · Skill · Squad  │
├──────────────────────┬───────────────────────────────────────────┤
│ 選択した5枠          │ Hero Collection: 12体＋3軸の絞込         │
│ [01] [02] [03] [04] │ 変更後のSkill/Squad/Jinrei影響           │
│ [05]                 │                                           │
├──────────────────────┴───────────────────────────────────────────┤
│ [詳細を見る] [Skill計画] [Squadへ進む]       [準備確認]          │
└──────────────────────────────────────────────────────────────────┘

Hero Detail: Hero 3D/identityを主役にし、能力/Role/Capabilityは隣接。
Skill Tree: 分岐キャンバスが主役。5 Heroの切替と取得予定・前提。
Squad Assembly: 5体の所属関係と7分割、各Squadの共有Nodeが主役。
~~~

「Hero 5枠」はどの専用画面でも同期するが、**4画面を同じ表に押し込まない**。Skillを変えたらSquadを常に初期化するような連鎖的破棄は禁止。

### 4.3 Jinrei・Coverage・準備確認

~~~text
┌──────────────────────────────────────────────────────────────────┐
│ Jinrei Workbench       Army / Squad / Hero     COMPILE状態       │
├─────────────────┬────────────────────────────┬─────────────────┤
│ Domain Catalog  │ No-code / Text Editor       │ Behavior         │
│ 型・変数・CU     │ v0.1 / 実Compiler診断       │ Default/Effective│
│                 │                            │ Not Proven      │
├─────────────────┴────────────────────────────┴─────────────────┤
│ [Compile] [Coverage全画面で確認]      [ 準備確認へ ]             │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ 準備確認 — 未設定 1件 / 要再コンパイル 1件 / 検証成功 5件       │
├──────────────────────────────────────────────────────────────────┤
│ [Hero 5枠]    有効        [Skill]      有効                     │
│ [Squad/起点]  問題へ戻る  [Jinrei]     コンパイルが古い         │
│ [NPC]         選択済み    [RulePackage] 一致                    │
│ [診断取得]    任意        [保存]       任意                     │
├──────────────────────────────────────────────────────────────────┤
│ [修正] [保存（任意）]       [戦闘開始: 検証未達のため無効]       │
└──────────────────────────────────────────────────────────────────┘
~~~

画面例の件数はワイヤフレーム説明用。実データや実行の測定値ではない。Ready時は**各行の理由と具体的な戻り先**を主情報にする。全部を必ず緑にするのではなく「未使用／任意／未証明」も独立表示。

## 5. Mobile：Desktop縮小禁止の独立画面

Mobileは**同じScreen IDと同じDraft**、別の操作・ページ遷移・情報密度。

~~~text
S01 START             S04 HERO SELECT           S06 SKILL
┌────────────────┐   ┌────────────────┐         ┌────────────────┐
│ 始める         │   │ Hero 01 / 05   │         │ Skill / Hero 1 │
│                │   │ [Hero cards]   │         │  Branch Graph  │
│ [すぐ戦う]     │   │ [filter]       │         │ [node] [node]  │
│ [自分で編成]   │   │ ...            │         │                │
│ [続きから]     │   │                │         │ [Node details] │
│                │   │ 5枠 [1..5]    │         │ sheet          │
│          [次へ]│   │      [Skillへ] │         │      [Squadへ] │
└────────────────┘   └────────────────┘         └────────────────┘

S07 SQUAD             S08 JINREI                 S10 READY
┌────────────────┐   ┌────────────────┐         ┌────────────────┐
│ 5 Hero分割    │   │ No-code       │         │ 準備確認       │
│ [1+1+1+1+1] ...│   │ [対象]         │         │ [✓ Hero]      │
│ 所属 Hero 1..5 │   │ [条件]         │         │ [! Squad 起点]│
│ 起点Node       │   │ [行動]         │         │ [? Coverage]   │
│                │   │ Text編集は別面 │         │ [修正]         │
│       [Jinrei] │   │   [Compile]    │         │ [戦闘開始]     │
└────────────────┘   └────────────────┘         └────────────────┘
~~~

- 戻るとき、スクロール・編集中のテキスト・選択Hero・フィルター・画面状態を保持する。
- No-codeを最初の入口にするが、Textに移動すれば同じDraftを編集できる。IMEとソフトウェアキーボードが操作を隠さない。
- Squadは**分割 → 所属 → 共有開始Node**の段階的操作。Skillの詳細はボトムシート、ピンチが効かなくてもNode選択可。
- Readyは幅320pxでも理由と修正先が表示され、戦闘開始と戻るが操作できる。
- Desktopから単純にTabを横スクロールさせたUIをMobile独立設計と見なさない。

## 6. 画面状態と次の一手

| 状態コード | 適用画面 | UIが表示すること | CTA |
| --- | --- | --- | --- |
| EMPTY | S04/S06/S07/S08 | 何が不足か、選択対象と必要枠数 | 設定する |
| DEFAULTED | S03/S04/S06/S07/S08 | 誰が入力したか（検証済みPreset/RulePackage） | この値で確認／変更 |
| DIRTY | 全編集 | 前回保存・前回Compileとの差分／失効範囲 | 続ける、保存 |
| VALIDATING | S08/S10 | 実Catalog／Compilerへの検証中。偽の残秒数を出さない | 待機・必要なら取消 |
| INVALID | 全編集/S10 | 失敗項目、原因、修正できるScreen/対象Hero | 該当場所へ移動 |
| STALE | S08/S10 | 旧Draft/RulePackageに対するCompile/既定値。再検証必須 | 再コンパイル |
| READY | S10 | 完全な開始条件を満たす現在のSnapshot | 戦闘開始 |
| RUNNING | S11 | 二重実行不可、計算結果未確定 | 実行状態を見る |
| FAILED | S11/S15 | 実エラーと再試行方法、入力は保持 | 修復・再試行 |
| COMPLETED | S12/S13 | 確定したMatch／勝敗／許可されたReplay | 分析・再戦 |
| NOT_PROVEN | S09/S10 | Coverageは未証明、実Compile成功と独立 | 条件を確認／継続 |
| RESTRICTED | S09/S13 | 認可がなくTraceを表示できない | 公開可能なデータだけ見る |

**優先順位**：禁止・不整合（INVALID、STALE）がある場合は開始不可。CoverageのNOT_PROVENは自動的にコンパイル失敗とはみなさない。読み取れない保存物はKEEP/EXPORTでき、消去を強制しない。

## 7. 開始可否に関する画面別validationの責務

| 判定 | Owner / authoritative input | UIが持つべきリンク |
| --- | --- | --- |
| 初期Ruleset/Catalog/World identityが整合 | Senritsu・World・Catalog producer | S02/S15 |
| 5 HeroのID、重複／スロット制約 | Senritsu Hero Catalog | S04 |
| HeroごとのSkill branchと前提、該当Capability | Senritsu Skill TreeとJinrei Catalog | S06 |
| 所属一意と合法なSquad partition、共通Node | SenritsuとEnbu初期構成検証 | S07 |
| 自軍Jinrei v0.1 compile、CU、Source revision一致 | Jinrei compiler | S08 |
| Profile利用時のみ、BehaviorのDefault/Bindingが現在のRulePackageと整合するか | Senritsuの正式なRulePackage Binding。未宣言の場合はNot Declaredと表示 | S08/S09/S15 |
| 相手のScenario／戦術／初期構成が検証済み | PvE ScenarioとEnbu | S02 |
| 監査オプションとSnapshot、重複実行防止 | Game launch coordinator | S10 |
| 関連する公開・非公開情報の区分 | Enbu Observation/Replay | S12/S13 |

現行実装の相手側Starterは内部で自動生成される。**「対戦相手を選べるUI」の存在はまだ未実装**。S02はNPCの実Scenarioが提供する値だけを編集可能にし、将来のPvP、課金、公式ランク、任意の相手Jinrei閲覧などを導入しない。

## 8. 主な編集イベントの失効／復元ルール

| イベント | 保持するもの | 失効または再検証するもの |
| --- | --- | --- |
| Hero差替 | 他の4枠の合法な値、保存した実行履歴 | 該当Skill Plan、Squad制約、Hero参照のJinrei、該当Compile |
| Skill Plan変更 | 5枠・Squad・Hero ID | 該当SkillとCapability合法性、構成依存Compile |
| Squad/起点変更 | 5 Hero/SkillとJinreiソース | Squad/初期Node検証、作用Scope・構成依存Compile |
| Jinrei編集／No-code↔Text | Hero/Skill/Squad、保存版と既存Run | 現行SourceのCompiled Program、Coverageキャッシュ |
| Scenario/NPC変更 | 自軍の有効な選択とSource | 相手Programと初期条件、比較対象identity |
| RulePackage/World/Catalogの意味論的変更 | 未保存ドラフト（検査・Exportできる形） | 型・Skill・行動・World・全Compile/Ready適合性 |
| 明示保存 | 現在のDraftと以前のimmutable revision | なし。コンパイル成功とは別 |
| Resume / Import | 元の保存ファイルや旧Restore Point | 互換性未確認のCompile、RulePackageをまたぐReady |
| Enbu開始 | 編集中Draft、既存比較Run | 実行中の対象Snapshotを固定。失敗時にDraftを失わない |
| Replay描画失敗 | Result、Replay、現在Tickと入力設定 | Rendererのみ再初期化。Enbu再実行の必要はない |

変更の波及は**影響する項目だけ**とし、毎回5 Hero全員・NPC・保存履歴を初期化しない。正本の上書き優先順位と互換性は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) に従う。

## 9. Evidence-driven screen acceptance

| テストID | 完走シナリオ | 証明すること |
| --- | --- | --- |
| UX-ENTRY-01 | 初回・Quick→Ready→Enbu→Replay | コード入力、保存、ログインを強制せず本物の試合が完了する |
| UX-ENTRY-02 | Customで5 Hero→Skill→Squad→Jinrei→Ready | 一つのDraftで全データがつながる |
| UX-HERO-01 | 12 Heroの絞込・5枠選択→Detailへ→戻る | 選択の保持・Catalogの正当性 |
| UX-SKILL-01 | 不合法経路選択→拒否→合法経路 | Skill前提と取得予定／取得済の分離 |
| UX-SQUAD-01 | 7分割・自由再編・Nodeミスマッチ→修復 | 所属一意性と位置制約 |
| UX-JINREI-01 | No-code→Text→無効式→修正→Compile→Coverage | 同一意味論・旧Compile失効・Unknown |
| UX-READY-01 | 不足/不正→修正リンク→Readyへ復帰 | 原因と戻り先が明確、虚偽READYなし |
| UX-NPC-01 | 初期NPC→実Scenarioの変更→Ready | 両陣営入力の再検証。相手秘匿を維持 |
| UX-RESUME-01 | 明示保存→再読込→復元→再コンパイル | 古いSourceやdigestを流用しない |
| UX-RESUME-02 | 未保存Recoveryと旧版／不正Import | 入力保全・Export・明示破棄・互換性判定 |
| UX-ERROR-01 | WASM/Core読込失敗、Storage障害、Enbu拒否 | 進行を偽らず原画面から復旧 |
| UX-ERROR-02 | GPU描画失敗→再試行→同Tick再開 | Result/Replay/CUが変わらない |
| UX-LOOP-01 | Replay→Analysis→Jinrei修正→同条件再戦 | 元Run保存、完全identity比較 |
| UX-MOBILE-01 | 320/390/430pxでQuick／Custom／復旧を完走 | 専用タッチ導線、IME/戻る・Safe Area |
| UX-DESKTOP-01 | 1440/1920pxで各主画面の情報階層とCTA | Hero/Skill/Squad/Jinrei/Battleの主役分離 |

**未実装の画面が一つでもあれば、テスト未実施・未達を明記**。画面遷移図ができたこと自体をUX実装の完成証拠としない。
