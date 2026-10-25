# PRE-BATTLE-SCREENS — 画面別情報設計・ワイヤフレーム・開始ガード

## 1. 位置づけ

[PLAYER-JOURNEY.md](PLAYER-JOURNEY.md) が「プレイヤーが何を決めるか」、[PRE-BATTLE-FLOWS.md](PRE-BATTLE-FLOWS.md) が「どこからどこへ移動するか」を所有する。本書は**各画面の主目的・表示情報・編集できる設定・操作・ガード・戻る先・Desktop/Mobileの異なる操作モデル**を所有する。操作文脈と副作用を具体化する追加合意案は [UX-INTERACTION-CONTRACTS.md](UX-INTERACTION-CONTRACTS.md)。

- **画面構成**：Screen ID S00〜S15と下記のワイヤフレーム。「一画面にすべてのフォームを詰め込む」という合意ではない。
- **確定済みドメイン**：Hero 5体固定、初期12種、Skill Plan、7種類のSquad分割、RulePackageとCatalog、Jinrei v0.1、ローカルPvE、自動Enbu、診断の可視権限。詳細は [HERO-ATELIER.md](HERO-ATELIER.md)、[UNITS.md](UNITS.md)、[JINREI-EDITOR.md](JINREI-EDITOR.md) 等を優先。
- **実装と受入の区別**：Home／Quick／NPC選択／Ready／Libraryは製品の論理作業面として定義する。旧シェルのTab名や一時的な未実装状況を規範にしない。画面が存在しても、操作・視覚・復旧の受入済みとは限らない。
- **保存の区別**：Nextの明示保存Setup・Recovery Copy、Completed Experiment、旧形式の保全を分ける。保持範囲は [TACTICAL-LOOP.md](TACTICAL-LOOP.md) に従う。新機能の実装状態は検証記録で報告する。

## 2. UI領域と永続する情報

すべての編集Screenの共通要素は**現在のSenkei（Draft name/identity）、Ruleset、保存状態、進行状況、戻る・次へ・準備確認**。これらを毎回同じ大きさのパネルに詰め込む意味ではない。

| 共有モデル | UIが見せる事実 | 禁止する表示 |
| --- | --- | --- |
| Senkei Draft | どの5 HeroとJinreiを編集しているか／未保存・保存済み・復旧中 | 保存失敗の後にSavedと表示 |
| Ruleset / World | 名称、版、互換性。詳細digestは必要時に確認可能 | UIの固定値を正式ルールとして表示 |
| Stage / Progress | 必須設定の不足・有効・未検証と次の修復画面 | Screen訪問回数を「設定完了」と扱う |
| Compilation | 現行Draft revisionへ対応した実Compiler結果、CU見積 | 旧SourceのCOMPILEDを新Sourceへ流用 |
| Current Selection | 選択スロット・Skill・Squadと、閲覧だけの候補Heroの区別 | 候補を見るために編成を変更する |
| Opponent / Scenario | 選ばれたNPC・初期条件、観測許可の範囲 | 確認画面を開いただけで相手を変更 |
| Battle Result | 確定RunのMatch identityと結果。最新Draftとは別 | 古いRunの診断を現在編集中の判断として表示 |
| Return Context | 呼出元Screen、対象、位置、分析Tick | Backで常にHomeやReadyへ飛ばす |

## 3. 全Screenの契約（操作・成功出口・失敗・復帰）

| Screen | 第1視線／中心タスク | 主要操作と次の画面 | エラー・戻り先 |
| --- | --- | --- | --- |
| **S00 起動** | Core／RulePackage／Catalog／保存の別々の読込状態 | 利用可能ならS01、必要なら保全へ | 不可ならS15。偽の％や保存破損の誤表示なし |
| **S01 Home** | 初戦、編成、戦役、再開 | Quick→S02→S03、Custom→S02→S04、Campaign→S02、Continue→S14 | 未保存Draftを無断で初期化しない |
| **S02 対戦条件** | 何と戦うか・公開可能な相手情報・利用可否 | Scenarioを選択／確認。Readyから来たら同じ文脈のS10へ | 無効NPCは相手側問題として表示、別課題へ |
| **S03 出撃内容** | 5 Hero、Skill、Squad、Jinrei、NPC | 該当箇所へ修正、現在値でS10 | 不正PresetをReadyとせず不足を示す |
| **S04 Collection** | Catalogと現在5枠、閲覧候補と採用先 | 枠へ明示採用／差替え、候補詳細S05、Skill S06 | 制約はSenritsu判定、フィルター0件は解除可能 |
| **S05 Detail** | 同一Heroの外観・3軸・実値・Capability | 閲覧のみ／明示採用を分離。閉じるは呼出元、採用後S06 | GPU不可でもデータ閲覧。偽の完成モデルなし |
| **S06 Skill Tree** | 分岐・取得予定・前提・取得不能 | 合法Branch、Hero切替、S07、戻る | 未知Capability・不正前提を拒否。予定≠取得済み |
| **S07 Squad/Deployment** | 5体の所属、7分割、共通起点／隊列 | 人数分割、所属／Node、S08 | 二重所属・不一致Nodeを対象付きで修正 |
| **S08 Jinrei** | Source/No-code、Scope、構文／CU、分析からの根拠 | 編集・Compile・S09・S10、元の分析へ | 拒否時も入力保持。古いCompileを失効 |
| **S09 Coverage** | Explicit/Inherited/Default/Wait/Not Proven | 絞込、対応ActionへS08、S10 | Unknown・Not Checkedを保証に変えない |
| **S10 Ready** | 開始条件・相手・未検証と問題対象 | 対象付き修正、条件確認、ReadyならS11 | invalid/staleは不可。確認だけで種別を変えない |
| **S11 実行** | 処理対象Snapshot・状態・結果の未確定 | 完了S12、失敗S10、提供される場合のみ取消 | 二重開始なし。移動・遅延≠取消・成功 |
| **S12 Replay** | 実試合・Tick・Fog・対象・再生操作 | 再生/seek、選択文脈付きS13、S10 | GPU失敗はResult/Replayを保ち描画再試行 |
| **S13 Analysis** | 結果・該当Tickの事実／Trace・比較 | Source位置S08、再戦S10、次課題S02、保存S14 | 全提供済みTraceへ到達。未取得・非公開を区別 |
| **S14 Library** | 明示保存／Recovery／最新と直前Runの区別 | 検証後の復元、Export/Import、呼出元へ | 上書き対象と取消、保持範囲、原データ保全 |
| **S15 Recovery** | 対象データ・障害・利用可能な復旧手段 | 再試行・原データExport・明示破棄 | 未提供の版切替を解決済み機能として案内しない |

Hero DetailとCoverageは任意の閲覧面。Quickで入力済みならS04/S06/S07/S08の編集を省略できるが、開始可否は検証済みの実データで導出する。以下のワイヤフレームは配置例であり、現在の実装完了証拠ではない。

## 4. Desktop：低忠実度ワイヤフレーム

### 4.1 開始・再開／Quick Preset

~~~text
┌──────────────────────────────────────────────────────────────────┐
│ SENKEI | 戦型名／状態                         LOCAL PvE / Ruleset│
├──────────────────┬───────────────────────────────────────────────┤
│ ナビゲーション   │ 何から始める？                               │
│ HOME             │                                               │
│ 編成             │ [すぐ戦う] [自分で編成] [戦役] [続きから]    │
│ Jinrei           │                                               │
│ Battle / Analysis│ 選択中NPCと現在のローカル環境                 │
│ Library          │ 明示保存／Recovery／直近Experiment             │
└──────────────────┴───────────────────────────────────────────────┘

Quick確認:
┌──────────────────────────────────────────────────────────────────┐
│ 現在の戦型／初期Preset  |  対戦相手・Ruleset                     │
├──────────────────────────────────────────────────────────────────┤
│ 5 Hero [1][2][3][4][5]    Skill計画     Squad配置                │
│ Jinrei概要                観測・Behavior Defaultの実状態        │
│ [編成を変更] [Jinreiを変更]             [ 準備確認へ ]          │
└──────────────────────────────────────────────────────────────────┘
~~~

初戦でコード入力を強制せず、Preset置換の影響とNPCを確認できる。保存は任意。

### 4.2 Hero Collection・Detail・Skill Tree・Squad

~~~text
┌──────────────────────────────────────────────────────────────────┐
│ 戦型 | 5枠 | 保存状態 | Collection · Detail · Skill · Squad      │
├──────────────────────┬───────────────────────────────────────────┤
│ 選択した5枠          │ Hero Catalog: 12体＋3軸フィルター          │
│ [01] [02] [03] [04] │ [候補の詳細を見る] [この枠へ採用]         │
│ [05]                 │ 採用時のSkill/Squad/Jinrei影響              │
├──────────────────────┴───────────────────────────────────────────┤
│ [Skill計画] [Squadへ進む]                        [準備確認]     │
└──────────────────────────────────────────────────────────────────┘

Hero Detail: 閲覧Heroと編成中Heroを区別。実能力と採用先を確認。
Skill Tree: 分岐が主役。Hero切替・取得予定・前提・ノード詳細。
Squad Assembly: 5体の所属関係と7分割、各Squadの共有Nodeが主役。
~~~

4画面を同じ表へ押し込まない。Skill変更でSquadを常に初期化するような連鎖的破棄は禁止。詳細閲覧だけでは編成やCompileを変えない。

### 4.3 Jinrei・Coverage・準備確認

~~~text
┌──────────────────────────────────────────────────────────────────┐
│ Jinrei Workbench   Army / Squad / Hero   COMPILE状態             │
├─────────────────┬────────────────────────────┬─────────────────┤
│ Domain Catalog  │ No-code / Text Editor      │ Behavior        │
│ 型・変数・CU     │ 実Compiler診断             │ Default/Effective│
│                 │ 分析元Match/Tick/Action     │ Not Proven      │
├─────────────────┴────────────────────────────┴─────────────────┤
│ [Compile] [Coverage] [元の分析へ]                [準備確認へ]   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ 準備確認 — 選択Scenario／相手／現在のDraft                      │
├──────────────────────────────────────────────────────────────────┤
│ Hero/Skill    検証状態と対象       [該当Heroへ]                 │
│ Squad/Node    不足と原因            [該当Squadへ]                │
│ Jinrei        現行ProgramとCU       [診断位置へ]                 │
│ 相手/World    選択・適合性          [条件を確認]                 │
│ 診断・保存    任意の状態                                       │
├──────────────────────────────────────────────────────────────────┤
│ [再検証] [保存・任意]                      [戦闘開始／不可理由] │
└──────────────────────────────────────────────────────────────────┘
~~~

表示例の数値や状態は測定値ではない。Readyでは理由と具体的な修正先を示し、「未使用／任意／未証明」を独立させる。未知のエラーを恣意的なHeroへ紐付けない。

## 5. Mobile：Desktop縮小禁止の独立画面

Mobileは同じScreen IDとDraft、異なる操作・ページ遷移・情報密度を持つ。

~~~text
S01 START             S04 HERO SELECT          S06 SKILL
┌────────────────┐   ┌────────────────┐        ┌────────────────┐
│ 始める         │   │ 対象枠と候補   │        │ Skill / Hero 1 │
│ [すぐ戦う]     │   │ [Hero cards]   │        │ Branch Graph   │
│ [自分で編成]   │   │ [絞込] [詳細] │        │ [node] [node]  │
│ [戦役]         │   │ [採用]         │        │ 詳細Sheet      │
│ [続きから]     │   │ 5枠 [1..5]    │        │ [閉じる]       │
│ 条件確認へ     │   │ [Skillへ]      │        │ [Squadへ]      │
└────────────────┘   └────────────────┘        └────────────────┘

S07 SQUAD             S08 JINREI               S10 READY
┌────────────────┐   ┌────────────────┐        ┌────────────────┐
│ 5 Hero分割     │   │ No-code       │        │ 対戦条件       │
│ [分割形式]     │   │ [対象] [条件] │        │ [Hero 状態]    │
│ 所属 Hero 1..5 │   │ [行動]         │        │ [Squad 原因]   │
│ 共通Node       │   │ Textは独立面  │        │ [該当修正へ]   │
│ [戻る]         │   │ [Compile]     │        │ [再検証]       │
│ [Jinreiへ]     │   │ [元の分析へ]  │        │ [戦闘開始]     │
└────────────────┘   └────────────────┘        └────────────────┘
~~~

- 戻るとき、スクロール・編集中Text・対象Hero・フィルター・画面状態を保持する。
- No-codeを入口とし、Textでは同じDraftを編集。IMEとキーボードが編集・保存・戻るを隠さない。
- Squadは分割→所属→共有Nodeの段階操作。Skill詳細はSheetで、ピンチなしでも選択可能。
- Readyは320pxでも原因と修正先、開始と戻るが使える。
- Tab横スクロールだけをMobile独立設計とみなさない。Sheetの閉じると画面Back、フォーカス復帰を区別する。

## 6. 画面状態と次の一手

| 状態コード | 適用画面 | 表示する事実 | CTA |
| --- | --- | --- | --- |
| EMPTY | S04/S06/S07/S08/S12/S13 | 入力不足または試合なし。検索0件と区別 | 設定／対戦準備 |
| DEFAULTED | S03/S04/S06/S07/S08 | 値の由来（Preset/RulePackage） | 現在値で確認／変更 |
| DIRTY | 編集・S14 | 保存対象全体との差分。Scenario変更も含む | 続ける／保存 |
| VALIDATING | S08/S10 | 対象の実検証中。偽の残秒数なし | 状態確認・実装される取消のみ |
| INVALID | 編集・S10 | 陣営・対象・原因・修正先 | 該当場所へ |
| STALE | S08/S10 | 旧入力へのCompile／検証 | 必要な再検証 |
| READY | S10 | 開始条件を満たす現在Snapshot | 戦闘開始 |
| RUNNING | S11 | 計算対象、結果未確定、二重実行不可 | 実行状態へ復帰 |
| FAILED | S11/S15 | 実失敗と復旧方法、入力保持 | 修復／再試行 |
| INDETERMINATE | 長い処理 | 成功・失敗・取消をまだ確定できない | 状態確認。架空の成功なし |
| COMPLETED | S12/S13 | 確定Matchと勝敗・終了理由 | 分析／再戦／戦役継続 |
| NOT_PROVEN | S09/S10 | Coverage未証明、Compileと独立 | 確認／継続 |
| RESTRICTED | S09/S13 | 権限のない情報は提供されない | 許可情報を見る |

INVALID／STALEがある場合は開始不可。NOT_PROVENだけで常に開始を禁止しない。読み取れない保存物はKEEP／EXPORTでき、消去を強制しない。未取得の診断と、権限で非公開の診断を混同しない。

## 7. validationの責務と修正リンク

| 判定 | 正本となる入力・Owner | 修正先 |
| --- | --- | --- |
| Ruleset/Catalog/World identity | Senritsu・World・Catalog producer | S02/S15 |
| 5 HeroのID、重複／スロット | Senritsu Hero Catalog | S04の対象枠 |
| Skill branch・前提・Capability | Senritsu Skill Tree／Jinrei Catalog | S06の対象Hero |
| 一意所属・partition・共通Node | Senritsu／Enbu初期構成検証 | S07の対象Squad |
| Source・CU・revision | Jinrei compiler | S08の実診断位置 |
| 有効化されたBehavior Binding | Senritsu。未宣言はNot Declared | S08/S09/S15 |
| 相手NPC／Scenario | シナリオ定義とEnbu | S02の相手側問題 |
| 診断オプション・開始Snapshot | 実行Coordinator | S10 |
| 公開／非公開区分 | Enbu Observation/Replay | S12/S13 |

S02は同梱Starterと提供される実Scenarioの値だけを扱う。名前だけの架空NPC、任意の非公開相手Jinrei閲覧、将来PvP・課金・ランクを追加しない。利用可能として提示するNPCはCoreと同じ制約で検証する。

## 8. 主な編集イベントの失効／復元ルール

| イベント | 保持するもの | 失効または再検証 |
| --- | --- | --- |
| 詳細・条件・Libraryを閲覧 | Draft、対戦種別、Scenario、検証済み入力 | 閲覧のみでは失効なし |
| Hero明示差替 | 他4枠の合法値、保存済みRun | 関連Skill・Squad・Jinrei参照・Compile |
| Skill Plan変更 | 5枠・Squad・Hero ID | 関連Skill・Capability・構成依存Compile |
| Squad/起点変更 | Hero/SkillとSource | 所属・Node・Scope・構成依存Compile |
| Source変更／表現変換 | Hero/Skill/Squad、保存版、既存Run | 意味に影響するProgram／Coverage・Ready |
| Scenario/NPC変更 | 自軍の合法な選択とSource | 相手Program／初期条件・比較条件・保存dirty |
| Package/World/Catalogの意味変更 | 未保存Draftと原データ | 型・行動・World・Compile/Ready適合性 |
| 明示保存 | 現在Draft、既存の不変Run | Compile成功とは別。保存対象全体で一致判定 |
| Resume / Import | 確認前の元データと未保存編集 | 未確認Compile、版をまたぐReady |
| Enbu開始 | 固定Snapshot、編集Draft、既存Run | 二重開始を防止。失敗時もDraft保持 |
| 描画失敗 | Result、Replay、Tick、入力 | Rendererだけ再初期化 |

変更の波及は関連項目だけ。毎回5 Hero・NPC・保存Runを初期化しない。[RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) のIdentity・互換性を維持する。

## 9. Evidence-driven screen acceptance

| テストID | 完走シナリオ | 証明すること |
| --- | --- | --- |
| UX-ENTRY-01 | 初回Quick→Ready→Enbu→Replay | コード・保存・ログインを強制せず実戦 |
| UX-ENTRY-02 | Custom→Hero/Skill/Squad/Jinrei→Ready | 同じDraftで接続 |
| UX-HERO-01 | 絞込→候補Detail→戻る→明示採用 | 閲覧と変更の分離、Catalog・選択保持 |
| UX-SKILL-01 | 不合法経路→拒否→合法経路 | 前提と予定／取得済みを区別 |
| UX-SQUAD-01 | 7分割・再編・Node不一致→修正 | 一意所属と位置制約 |
| UX-JINREI-01 | No-code→Text→無効式→修正→Coverage | 同じ意味論・失効・Unknown |
| UX-READY-01 | 不正→対象付き修正→同じReady | 具体的な原因と戻り先 |
| UX-NPC-01 | NPC変更→Ready→条件閲覧→復帰 | 双方入力検証、閲覧で相手不変 |
| UX-RESUME-01 | 明示保存→再読込→復元→検証 | 古いSource／digestを流用しない |
| UX-RESUME-02 | Recovery／不正Import／版不一致 | 原本保全、Export、明示破棄 |
| UX-ERROR-01 | Core／Storage／Enbuの各失敗 | 失敗を分類し原画面から復帰 |
| UX-ERROR-02 | GPU失敗→描画再試行 | Result／Replay／CU／Tick不変 |
| UX-LOOP-01 | Replay→Trace→Source→修正→比較 | 元Run保持、文脈と比較条件の一致 |
| UX-MOBILE-01 | 320/390/430幅で主要導線 | 専用操作、戻る、Safe Area。実機IMEは別検証 |
| UX-DESKTOP-01 | 1440/1920幅で各主画面 | 情報階層と主操作 |

追加合意案の詳細ケース [UX-C01〜C16](UX-INTERACTION-CONTRACTS.md) を併用する。未実装・未検証を明記し、図やテスト件数だけでUXを認定しない。装備・ガチャ・関係性等の追加画面は [PROGRESSION-UX.md](PROGRESSION-UX.md) の別範囲であり、現在G2へ自動追加しない。
