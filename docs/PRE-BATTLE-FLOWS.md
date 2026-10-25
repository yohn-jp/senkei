# PRE-BATTLE-FLOWS — ゲーム開始前の全画面遷移図

## 1. Scope・図の読み方

本書は [PLAYER-JOURNEY.md](PLAYER-JOURNEY.md) で定義した**初回・自由編成・復帰・エラー・ローカルPvE開始・再戦**の各導線を、Screen IDと条件付き遷移で漏れなく表す。画面の操作とデータ契約は [PRE-BATTLE-SCREENS.md](PRE-BATTLE-SCREENS.md) に定義する。

- **矩形**：画面または独立した主作業面。**ひし形**：分岐・検証状態。**枝のラベル**：その遷移を許す操作／結果。
- S系は**提案する製品ワイヤフレーム上のScreen ID**。現在のNextのReact Tab名とは異なる。配置形態はDesktopとMobileで変わるがScreen ID／ユーザーデータは共通。
- E系は画面ではなく**処理状態**。エラーを単純な二次画面として誤認せず、元の作業面と復旧導線を保つ。
- 入力なしで選択できるPresetは**必ず実Rulesetで検証済み**。従来のG1「サンプル演武」は本番G2戦と別。
- すべての開始導線は**S10 準備確認 → S11 実行 → S12 戦闘Replay**を通る。準備確認は保存やコード手入力の強制を意味しない。

## 2. Screen IDの一覧

| ID | 画面／主作業 | 役割と入出力 |
| --- | --- | --- |
| **S00** | 起動・Local Core読込 | Core／RulePackage／Catalogの実状態を読み、復帰候補を検出 |
| **S01** | 開始・再開（Home） | すぐ戦う／自分で編成／続きから／サンプルの入口 |
| **S02** | ローカル対戦条件 | 実PvEシナリオ・NPCとRuleset確認（選択肢が一つなら確認のみ） |
| **S03** | Quick Preset確認 | 完成した5 Hero＋Skill＋Squad＋Jinreiの実プリセットと変更箇所へのリンク |
| **S04** | Hero Collection | 5枠にHeroを選ぶ／差し替える |
| **S05** | Hero Detail | 1 HeroのCatalog能力・外観・Capabilityを閲覧（任意の寄り道） |
| **S06** | Skill Tree | Heroごとの取得予定・前提を編集 |
| **S07** | Squad Assembly / Deployment | 5 Heroの所属／7分割・初期Squad Nodeを確定 |
| **S08** | Jinrei Workbench | Preset/No-code/Text、Scope・選好、実CompilerとCatalog |
| **S09** | Behavior Coverage | Default/Effective/未証明を調べてS08へ戻る（任意） |
| **S10** | 準備確認（Ready/Preflight） | 全設定・相手・版・バリデーション・CU・開始可否 |
| **S11** | Enbu計算（実行中） | バンドル済みSnapshotの処理。結果／失敗を確認 |
| **S12** | Battle Replay | 全自動の確定試合結果を観測（Fog/Unknownとカメラ） |
| **S13** | Analysis | 勝敗、観測イベント、認可済み診断、前回との比較 |
| **S14** | 保存・ライブラリ | 明示保存／版履歴／Export／復元元選択（横断導線） |
| **S15** | 互換性・復旧 | 保存の不一致・壊れたデータ・失敗原因を保全し操作可能にする |

**対戦相手を編集する場合のデータ**はS02、Squad開始NodeはS07、Jinrei Skill使用条件はS08が所有する。独立画面を増やすこと自体が目的ではない。S02のPvE編集自由度は実NPC/Scenarioの提供範囲に従う。

## 3. 全体ナビゲーション（ゲーム開始までと戦闘後）

~~~mermaid
flowchart TD
    A["S00 起動・Local Core"] --> B{"Core/RulePackageを検証"}
    B -- 読込失敗 --> R["S15 復旧・再試行"]
    R -- 再試行 --> A
    B -- 有効 --> H["S01 開始・再開"]
    H -- すぐ戦う --> P["S02 PvE条件・NPC"]
    H -- 自分で編成 --> P
    H -- 続きから --> L["S14 保存・ライブラリ"]
    L -- 保存物と版が整合 --> Q["S03 Quick Preset・復旧内容確認"]
    L -- 不一致・読み込み不可 --> R
    P -- プリセットで進む --> Q
    P -- 自分で構成 --> C["S04 Hero Collection"]
    Q -- 一部修正 --> C
    Q -- 戦術のみ修正 --> J["S08 Jinrei Workbench"]
    Q -- この内容で確認 --> V["S10 準備確認"]
    C -- 確認 --> D["S05 Hero Detail"]
    D -- Skill計画へ --> K["S06 Skill Tree"]
    C -- 詳細を省略 --> K
    K -- 5体分の取得予定 --> S["S07 Squad Assembly"]
    S -- 戦術へ --> J
    J -- Coverageを確認 --> G["S09 Behavior Coverage"]
    G -- 編集に戻る --> J
    J -- 準備確認へ --> V
    V -- 設定箇所を直す --> C
    V -- Jinreiを直す --> J
    V -- 敵・Scenarioを直す --> P
    V -- 全検証成功＋開始 --> E["S11 Enbu計算"]
    E -- 成功／確定Replay --> F["S12 Battle Replay"]
    E -- 失敗 --> V
    F -- 戦績を見る --> N["S13 Analysis"]
    N -- 同条件再戦 --> V
    N -- 戦術・編成を改善 --> J
    N -- 編成を変更 --> C
    N -- 保存／比較 --> L
    V -. 保存は任意 .-> L
    J -. 保存は任意 .-> L
    S -. 保存は任意 .-> L
    L -. 作業へ復帰 .-> V
~~~

この図は**ユーザー主導の遷移**。例えばHero Detailへ寄らずSkill Treeへ進める。「全画面を強制的に通過しなければ開始できない」という解釈は禁止する。

## 4. 初回の「すぐ戦う」導線（コード不要）

~~~mermaid
flowchart TD
    S0["S01 新規プレイヤー"] --> P0["S02 初期Local PvE・NPC"]
    P0 --> A{"検証済みQuick Presetがあるか"}
    A -- ない --> F["S04 自分で編成／使えるPresetなしを説明"]
    A -- ある --> Q["S03 初期5 Hero / Skill / Squad / Jinreiを要約"]
    Q --> B{"内容を変更するか"}
    B -- Hero / Skill / Squadを変更 --> C["S04/S06/S07 該当箇所"]
    B -- Jinreiのみ変更 --> D["S08 Jinrei"]
    C --> Q
    D --> Q
    B -- そのまま --> R["S10 準備確認"]
    R --> V{"検証済みRulePackage・双方Program・5枠・配置は合法か"}
    V -- 未完了／不正 --> T["不足項目の一覧と直接修正リンク"]
    T --> Q
    V -- READY --> E["S11 実Enbu計算"]
    E -- 成功 --> G["S12 勝敗・Replay"]
    E -- エラー --> R
~~~

初期Presetは5体選択とJinreiコードの作成を**省略する**のであって、合法性検証を省略しない。Catalog未宣言のBehavior Profileを「Defaultで完成」と表示しない。

## 5. 自由編成・Hero専用画面の遷移

~~~mermaid
flowchart TD
    A["S02 Ruleset・PvE条件"] --> C["S04 Hero Collection／5枠"]
    C --> H{"現在の選択Heroを詳しく見る"}
    H -- はい --> D["S05 Hero Detail／能力・外観・Skill"]
    D -- 別Heroを見る --> C
    D -- 取得予定へ --> T["S06 Skill Tree"]
    H -- 省略 --> T
    T --> P{"5体のSkill計画は有効か"}
    P -- 未設定／前提不成立 --> T
    P -- Heroを差し替え --> C
    P -- 成立 --> S["S07 Squad Assembly"]
    S --> G{"所属・各Squad開始Nodeが合法か"}
    G -- 異なる開始Node／不正所属 --> S
    G -- Heroを変更 --> C
    G -- 成立 --> J["S08 Jinrei Workbench"]
    J -- 編成から見直す --> S
    J -- Skillを見直す --> T
    J -- 自軍の戦術を確定 --> R["S10 準備確認"]
    R -- 変更影響あり --> C
~~~

### 編成変更が他画面へ波及するとき

~~~mermaid
flowchart LR
    C["S04 Heroを差し替え"] --> V["影響範囲の検証"]
    V --> K{"Skill計画は新Heroで合法？"}
    K -- いいえ --> SK["S06 無効経路を提示／再選択"]
    K -- はい --> SQ{"Squad所属と初期Nodeは合法？"}
    SK --> SQ
    SQ -- いいえ --> AS["S07 未整合を修復"]
    SQ -- はい --> JJ{"Jinrei Capability/対象が有効？"}
    AS --> JJ
    JJ -- いいえ --> ED["S08 失効したコンパイルを更新"]
    JJ -- はい --> RE["S10 Readyを再検証"]
    ED --> RE
~~~

Hero変更は全ドラフトを破棄することではない。差分と有効性を見せ、旧設定を保持可能な範囲で維持する。

## 6. Jinrei、Behavior Coverage、コンパイルの遷移

~~~mermaid
flowchart TD
    J["S08 Jinrei Workbench"] --> M{"編集する方法"}
    M -- Preset / No-code --> N["型付き操作・同一Jinrei表現"]
    M -- Text --> T["v0.1 sourceの編集"]
    N --> D["更新されたDraft revision"]
    T --> D
    D --> A["Domain Catalogで候補・型・CU確認"]
    A --> C{"実Compilerで検証する"}
    C -- 構文・型・権限不正 --> X["エラー位置・理由／S08で修正"]
    X --> D
    C -- 成功 --> R["現行revisionのCompiled Program"]
    R --> V["S09 Default / Effective / Not Proven"]
    V -- 不足や未証明を確認し改善 --> D
    V -- 続行（任意） --> P["S10 Ready"]
    R -- Coverageを省略 --> P
    P -- Source / Catalog / RulePackage変更 --> I["Compiledを失効"]
    I --> D
~~~

Coverageの解析未証明はCompiler成功と異なる状態。**コンパイル成功をCoverage 100%と表示しない**。Enemy Unknownは不正な既知値へ変えない。実験結果のObservedはS13以降の認可済みTraceに限る。

## 7. Scenario・対戦相手・戦闘開始の実行状態

~~~mermaid
stateDiagram-v2
    [*] --> ScenarioSelection: S02
    ScenarioSelection --> DraftReady: 初期PvEまたは合法NPCを選択
    ScenarioSelection --> ScenarioUnavailable: 利用可能なNPCなし
    ScenarioUnavailable --> ScenarioSelection: 再選択・再試行
    DraftReady --> Validating: S10 準備確認
    Validating --> NeedsChanges: 不足・不正
    NeedsChanges --> DraftReady: 該当画面で修正
    Validating --> Compiling: 有効なRulePackageとCatalog
    Compiling --> CompileRejected: source / capability / CU / identity不一致
    CompileRejected --> NeedsChanges: 修正・再コンパイル
    Compiling --> Ready: 両陣営のcompiled programと初期Snapshotが有効
    Ready --> Validating: Draft / Scenario / Packageを変更
    Ready --> Running: 戦闘開始
    Running --> Completed: Enbuが確定ResultとReplayを返す
    Running --> RunFailed: 検証・資源・Runtime失敗
    RunFailed --> Validating: 入力を保持し再試行
    Completed --> Replay: S12
    Replay --> Analysis: S13
    Analysis --> DraftReady: 戦術修正
    Analysis --> Ready: 同条件再戦（再検証を含む）
~~~

**Runningはローカル計算中**でありリアルタイムPvPではない。UI上のProgressや戦闘結果は実際の計算応答からのみ表示する。Renderer失敗は結果生成失敗と混同しない。

## 8. 保存・復元・インポート・復旧の全分岐

~~~mermaid
flowchart TD
    A["S01 続きから または任意の保存操作"] --> L["S14 Library"]
    L --> I{"入口"}
    I -- 保存済みを開く --> M["保存済みSetup／revision"]
    I -- JSONインポート --> F["ファイル形式・サイズ・Schema検証"]
    I -- 未保存作業の復旧 --> U["Recovery Copy"]
    I -- 明示保存／Export --> S["別名／履歴を保持して保存・出力"]
    S -- 成功 --> L
    S -- Storage不可 --> E["S15 保存失敗／Export・再試行"]
    F -- 不正 --> E
    F -- 有効 --> M
    U --> C{"Ruleset・World・Catalogの互換性"}
    M --> C
    C -- 一致 --> D["現行Draftへ復帰、Compiledは必要なら失効"]
    C -- 不一致 --> R["S15 元データを保全・差異を説明"]
    R -- 対応環境で再試行 --> C
    R -- Export／明示的に別Draft --> L
    D --> J["S03 サマリ確認 または S04/S08 該当編集"]
    E -- 復旧可能 --> L
~~~

旧InitialのIndexedDBドキュメントとNextのブラウザ保存は現在別。**互換性のない内容を黙ってNextへ読み込み、古い保存済み内容を消すことは禁止**。

## 9. 画面移動とシステムエラーの復帰

~~~mermaid
flowchart TD
    X["任意の編集中画面"] --> S{"進行阻害が発生"}
    S -- コア・Package読込失敗 --> A["S15 Core再試行／利用可能なサンプル"]
    S -- 不正Hero/Skill/Node/Squad --> B["該当設定画面に戻り不足箇所を修正"]
    S -- Jinrei compile error --> C["S08 位置・型・CUを示して修正"]
    S -- 保存容量・アクセス不良 --> D["S15 Recovery / Export / 再試行"]
    S -- stale Catalog／互換性不一致 --> E["S15 バージョン差と再検証"]
    S -- 描画GPU不対応 --> F["S12 Replay状態保持・描画再試行"]
    S -- Enbu計算失敗 --> G["S10 入力維持・原因表示・再試行"]
    A --> R["直前の操作可能画面へ戻る"]
    B --> R
    C --> R
    D --> R
    E --> R
    F --> R
    G --> R
~~~

失敗時は**元のDraft、選択中Hero、Skill/Squad、編集中Jinrei、保存済みRestore Pointを原則保持**。GPUエラーと戦闘の失敗を同じ「開始失敗」にしない。未保存の成功・不明な遅延に対する架空の完了通知は禁止する。

## 10. Desktopのナビゲーション構造

~~~mermaid
flowchart LR
    H["S01 Home"] --> C["編成ワークスペース"]
    C --> HC["S04 Collection"]
    C --> HD["S05 Detail"]
    C --> ST["S06 Skill Tree"]
    C --> SQ["S07 Squad/配置"]
    H --> J["戦術ワークスペース S08"]
    J --> CV["S09 Coverage"]
    H --> P["対戦条件 S02"]
    H --> LIB["S14 Library"]
    HC --> READY["S10 Ready"]
    HD --> READY
    ST --> READY
    SQ --> READY
    J --> READY
    P --> READY
    READY --> ENBU["S11 Enbu"]
    ENBU --> B["S12 Battle"]
    B --> A["S13 Analysis"]
    A --> J
    A --> C
    A --> READY
~~~

同一画面に全サイドパネルを常設しない。Hero Detail・Skill Tree・Squad Assembly・Jinrei・Battleは**それぞれ異なる主役**を持つ。Readyへのショートカットは**不正設定を無視する抜け道ではない**。

## 11. Mobileの専用画面遷移

~~~mermaid
flowchart TD
    H["S01 Mobile Start"] --> Q{"開始方法"}
    Q -- Quick --> P["S03 Preset要約 1画面"]
    Q -- Custom --> C["S04 Hero一覧／5枠下部固定"]
    Q -- Continue --> L["S14 保存から復元"]
    L --> P
    C --> D["S05 Hero詳細 フルスクリーン"]
    D --> T["S06 Skill Tree 全画面＋ノード詳細Sheet"]
    C --> T
    T --> S["S07 Squad人数分割"]
    S --> N["S07 所属の割当と共通Node選択"]
    N --> J["S08 No-code優先／Textは独立編集画面"]
    J --> G["S09 Coverage独立画面（任意）"]
    G --> J
    J --> R["S10 Ready カード単位で問題箇所へ戻る"]
    P --> R
    R -- 修正 --> C
    R -- 開始 --> E["S11 実行中"]
    E -- 成功 --> B["S12 全面Battle／再生操作"]
    B --> A["S13 Analysis独立画面"]
    A --> J
    A --> C
    A --> R
~~~

MobileではHero一覧・Skill・Squad・JinreiをDesktopの縦積みへ変換せず、**専用Screenまたは全面Sheet**で完走する。ドラッグ・ピンチは便利な補助入力に留める。戻る／IME／Safe Area／端末回転で同一Draftを保持する。

## 12. 画面間を横断する保存・更新の規範

| Origin → Destination | 遷移の成立条件／失敗時 |
| --- | --- |
| S01 → S02/S03/S04 | 初期CoreとRulePackageが検証済み。不可ならS15 |
| S04 → S05/S06 | 対象Heroスロットが実Catalogへ結び付く。欠落ならS04 |
| S06 → S07 | 5体のSkill Planと前提が有効。欠落ならS06へ問題表示 |
| S07 → S08 | 5体の一意所属、初期NodeがSenritsuと一致。欠落ならS07 |
| S08 → S10 | ドラフト編集は常に可能。Readyで現行revisionをコンパイル・検証、失敗はS08へ |
| S02 → S10 | NPC/Scenarioは妥当な現在のRuleset。変更時は敵戦術バインディングを無効化 |
| S03 → S10 | Preset完全入力を再検証。Presetが欠落・不適合なら不足箇所へ |
| S14 → S03/S04 | 保存形式と完全RulePackage/World identityが互換。旧形式はS15 |
| S10 → S11 | [PLAYER-JOURNEY.md](PLAYER-JOURNEY.md) §4 のReadyToLaunch成立。二重起動禁止 |
| S11 → S12 | 実Enbuが完了し有効なResult/Replayを返した場合のみ |
| S12 → S13 → S08/S04/S10 | 結果・観測は記録として固定し、編集は新しいDraft revisionへ。比べるRunは完全identityで識別 |

## 13. ワイヤフロー受入

全Screen IDと各分岐に少なくとも1つの実操作シナリオを紐付ける。**初回（コードなし）・Custom・復元／不一致・変更後のコンパイル失効・保存失敗・Enbu拒否・完了後再戦**をDesktop/Mobile双方で完走させること。これらは将来のテストケースであり、この文書が実ブラウザ実装を証明するものではない。
