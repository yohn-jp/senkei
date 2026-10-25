# PRE-BATTLE-FLOWS — ゲーム開始前後の全画面遷移図

## 1. Scope・図の読み方

本書は [PLAYER-JOURNEY.md](PLAYER-JOURNEY.md) で定義した**初回・自由編成・戦役・復帰・エラー・ローカルPvE開始・再戦**の各導線を、Screen IDと条件付き遷移で漏れなく表す。画面の操作とデータ契約は [PRE-BATTLE-SCREENS.md](PRE-BATTLE-SCREENS.md) に定義する。操作文脈・副作用・復帰を具体化する追加合意案は [UX-INTERACTION-CONTRACTS.md](UX-INTERACTION-CONTRACTS.md)。

- **矩形**：画面または独立した主作業面。**ひし形**：分岐・検証状態。**枝のラベル**：その遷移を許す操作／結果。
- S系は製品の論理Screen IDで、React Tab名とは異なる。配置形態はDesktopとMobileで変わるがScreen ID／ユーザーデータは共通。
- E系は画面ではなく**処理状態**。エラーを単純な二次画面として誤認せず、元の作業面と復旧導線を保つ。
- 入力なしで選択できるPresetは**実Rulesetで検証する**。G1「サンプル演武」は本番G2戦と別。
- すべての開始導線は**S10 準備確認 → S11 実行 → S12 戦闘Replay**を通る。準備確認は保存やコード手入力の強制を意味しない。
- 図に存在することは実装・実操作の受入完了を意味しない。追加案はPRで合意してから実装する。

## 2. Screen IDの一覧

| ID | 画面／主作業 | 役割と入出力 |
| --- | --- | --- |
| **S00** | 起動・Local Core読込 | Core／RulePackage／Catalogの実状態を読み、復帰候補を検出 |
| **S01** | 開始・再開（Home） | すぐ戦う／自分で編成／戦役／続きから。サンプルは検証用の別入口 |
| **S02** | ローカル対戦条件 | 実PvEシナリオ・NPCとRuleset確認。閲覧と変更を区別 |
| **S03** | Quick／Campaign出撃確認 | 5 Hero＋Skill＋Squad＋Jinreiと相手の概要、変更箇所へのリンク |
| **S04** | Hero Collection | 5枠にHeroを選ぶ／差し替える。候補の詳細閲覧を区別 |
| **S05** | Hero Detail | 編成中または候補HeroのCatalog能力・外観・Capabilityを閲覧 |
| **S06** | Skill Tree | Heroごとの取得予定・前提を編集 |
| **S07** | Squad Assembly / Deployment | 5体の所属／7分割・初期Squad Nodeを確定 |
| **S08** | Jinrei Workbench | Preset/No-code/Text、Scope・選好、実CompilerとCatalog |
| **S09** | Behavior Coverage | Default/Effective/未証明を調べてS08へ戻る（任意） |
| **S10** | 準備確認（Ready/Preflight） | 全設定・相手・版・バリデーション・CU・開始可否 |
| **S11** | Enbu計算（実行中） | 固定Snapshotの処理。結果／失敗を確認 |
| **S12** | Battle Replay | 全自動の確定試合結果を観測（Fog/Unknownとカメラ） |
| **S13** | Analysis | 勝敗、観測イベント、認可済み診断、比較、次の戦役・改善 |
| **S14** | 保存・ライブラリ | 明示保存／保存範囲の確認／Export／復元元選択（横断導線） |
| **S15** | 互換性・復旧 | 保存の不一致・壊れたデータ・失敗原因を保全し操作可能にする |

対戦条件はS02、Squad開始NodeはS07、Jinrei Skill使用条件はS08が所有する。独立画面を増やすこと自体が目的ではない。S02の編集自由度は実NPC/Scenarioの提供範囲に従う。

## 3. 全体ナビゲーション（ゲーム開始までと戦闘後）

~~~mermaid
flowchart TD
    A["S00 起動・Local Core"] --> B{"Core/RulePackageを検証"}
    B -- 読込失敗 --> R["S15 復旧・再試行"]
    R -- 再試行 --> A
    B -- 有効 --> H["S01 開始・再開"]
    H -- Quick / Custom / Campaign --> P["S02 PvE条件・NPC"]
    H -- 続きから --> L["S14 保存・ライブラリ"]
    L -- 保存物と版が整合 --> Q["S03 内容確認"]
    L -- 不一致・読み込み不可 --> R
    P -- 現在の戦型で進む --> Q
    P -- 自分で構成 --> C["S04 Hero Collection"]
    Q -- 一部修正 --> C
    Q -- 戦術のみ修正 --> J["S08 Jinrei Workbench"]
    Q -- この内容で確認 --> V["S10 準備確認"]
    C -- 詳細を閲覧 --> D["S05 Hero Detail"]
    D -- 採用してSkill計画へ --> K["S06 Skill Tree"]
    D -- 採用せず戻る --> C
    C -- 詳細を省略 --> K
    K -- 5体分の取得予定 --> S["S07 Squad Assembly"]
    S -- 戦術へ --> J
    J -- Coverageを確認 --> G["S09 Behavior Coverage"]
    G -- 編集に戻る --> J
    J -- 準備確認へ --> V
    V -- 設定箇所を直す --> C
    V -- Jinreiを直す --> J
    V -- 敵・Scenarioを確認／変更 --> P
    P -- 確認元へ・条件を保持 --> V
    V -- 全検証成功＋開始 --> E["S11 Enbu計算"]
    E -- 成功／確定Replay --> F["S12 Battle Replay"]
    E -- 失敗・入力保持 --> V
    F -- 選択Tickと対象を引き継ぐ --> N["S13 Analysis"]
    N -- 再実行／改良比較 --> V
    N -- 戦術・編成を改善 --> J
    N -- 編成を変更 --> C
    N -- 次の解放済み課題へ --> P
    N -- 保存／比較 --> L
    V -. 保存は任意 .-> L
    J -. 保存は任意 .-> L
    S -. 保存は任意 .-> L
    L -. 閲覧を終える .-> O["呼出元のScreenと文脈"]
~~~

この図は**ユーザー主導の遷移**。「全画面を強制的に通過しなければ開始できない」という解釈は禁止する。条件確認、詳細閲覧、Libraryへの寄り道で対戦種別を変更しない。実際の戻り先は呼出元を保持し、常にReadyへ戻すという意味ではない。

## 4. 初回の「すぐ戦う」導線（コード不要）

~~~mermaid
flowchart TD
    S0["S01 新規プレイヤー"] --> P0["S02 初期Local PvE・NPC"]
    P0 --> A{"利用可能なQuick Presetがあるか"}
    A -- ない --> F["S04 自分で編成／使えるPresetなしを説明"]
    A -- ある --> Q["S03 初期5 Hero / Skill / Squad / Jinreiを要約"]
    Q --> B{"内容を変更するか"}
    B -- Hero / Skill / Squadを変更 --> C["S04/S06/S07 該当箇所"]
    B -- Jinreiのみ変更 --> D["S08 Jinrei"]
    C --> Q
    D --> Q
    B -- そのまま --> R["S10 準備確認"]
    R --> V{"双方Program・5枠・配置・RulePackageが合法か"}
    V -- 未完了／不正 --> T["不足項目と対象付き修正リンク"]
    T --> Q
    V -- READY --> E["S11 実Enbu計算"]
    E -- 成功 --> G["S12 勝敗・Replay"]
    E -- エラー --> R
~~~

Presetは5体選択とJinrei作成を**省略する**のであって、合法性検証を省略しない。Catalog未宣言のBehavior Profileを「Defaultで完成」と表示しない。既に作業中のDraftがある場合、Quickの選択だけで初期Presetへ置き換えない。

## 5. 自由編成・Hero専用画面の遷移

~~~mermaid
flowchart TD
    A["S02 Ruleset・PvE条件"] --> C["S04 Hero Collection／5枠"]
    C -- 候補または編成中Heroを見る --> D["S05 読み取り専用の詳細"]
    D -- 戻る・変更なし --> C
    D -- 対象枠へ明示採用 --> I["変更影響と適合性確認"]
    C -- 明示採用 --> I
    I --> T["S06 Skill計画"]
    C -- 既存計画で進む --> T
    T --> P{"5体のSkill計画は有効か"}
    P -- 未設定／前提不成立 --> T
    P -- Hero差替え --> C
    P -- 成立 --> S["S07 Squad Assembly"]
    S --> G{"所属・共通Nodeが合法か"}
    G -- 不整合 --> S
    G -- 成立 --> J["S08 Jinrei"]
    J -- 編成を見直す --> S
    J -- Skillを見直す --> T
    J --> R["S10 準備確認"]
~~~

Hero差替えは全Draft破棄ではない。新Heroで無効になるSkill・Capability・Scopeを示し、合法な値と他の4枠を保持する。未採用Heroを調べる操作は、採用・差替えとは別である。詳細閲覧から帰っただけではCompileやReadyを失効させない。

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
    V -- 改善 --> D
    V -- 続行・任意 --> P["S10 Ready"]
    R -- Coverageを省略 --> P
    P -- 意味に影響する入力変更 --> I["関連する検証を失効"]
    I --> D
~~~

Coverage未証明はCompiler失敗ではない。**コンパイル成功をCoverage 100%と表示しない**。Enemy Unknownを既知値へ変えない。ObservedはS13以降の認可済みTraceに限る。表現変換に失敗した場合は元のSourceを保持し、変換成功を装わない。

## 7. Scenario・対戦相手・戦闘開始の実行状態

~~~mermaid
stateDiagram-v2
    [*] --> ScenarioSelection: S02
    ScenarioSelection --> DraftReady: 合法なNPC／Scenarioを選択
    ScenarioSelection --> ScenarioUnavailable: 利用不可
    ScenarioUnavailable --> ScenarioSelection: 再選択・再試行
    DraftReady --> Validating: S10
    Validating --> NeedsChanges: 不足・不正
    NeedsChanges --> DraftReady: 対象を修正
    Validating --> Compiling: 適合するRulePackageとCatalog
    Compiling --> CompileRejected: source／型／CU／identity不一致
    CompileRejected --> NeedsChanges
    Compiling --> Ready: 双方Programと初期Snapshotが有効
    Ready --> Validating: 関連入力を変更
    Ready --> Running: 戦闘開始
    Running --> Completed: 確定Result／Replay
    Running --> RunFailed: 実行失敗
    RunFailed --> Validating: 入力保持・再試行
    Completed --> Replay: S12
    Replay --> Analysis: S13
    Analysis --> DraftReady: 戦型を改善
    Analysis --> Validating: 元Run Snapshotの再実行
~~~

Runningはローカル計算中であり、リアルタイムPvPではない。進捗と結果は実応答から示す。描画失敗と計算失敗を分離する。画面移動を取消とみなさず、取消機能を提供する場合は停止・応答無効化の確認を必要とする。

## 8. 保存・復元・インポート・復旧の全分岐

~~~mermaid
flowchart TD
    A["S01 Continue または作業中の保存・閲覧"] --> L["S14 Library"]
    L --> I{"対象"}
    I -- 明示保存済み --> M["Pinned Setup"]
    I -- JSON Import --> F["形式・サイズ・Schema検証"]
    I -- 未保存作業 --> U["Recovery Copy"]
    I -- 完了試合 --> E["最新／直前Experiment"]
    I -- 保存／Export --> S["対象・保持範囲を明示して保存／出力"]
    S -- 成功 --> L
    S -- Storage不可 --> X["S15 保存失敗・Export・再試行"]
    F -- 不正 --> X
    F -- 有効 --> C{"完全identityと互換性"}
    M --> C
    U --> C
    E --> C
    C -- 不一致 --> R["S15 原データ保全と差異表示"]
    R -- 実際に利用可能な再試行 --> C
    R -- Export／明示破棄 --> L
    C -- Setupを復元 --> Q["置換対象と未保存差分を確認"]
    Q -- 取消 --> L
    Q -- 復元を承認 --> D["同じDraftへ復帰・必要な検証は失効"]
    D --> J["S03 または呼出元のS04/S08"]
    C -- Experimentを開く --> B["S12/S13 記録された試合"]
    X -- 復旧可能 --> L
    L -- 閲覧を終える --> O["呼出元のScreen・対象・位置"]
~~~

明示保存、Recovery、Experiment、旧形式の保全を区別する。具体的なExperiment保持境界は [TACTICAL-LOOP.md](TACTICAL-LOOP.md) に従い、無制限の履歴があるように表示しない。互換性のない内容を黙ってNextへ読み込み、元の保存内容を消すことは禁止する。

## 9. 画面移動とシステムエラーの復帰

| 障害 | 復帰先と保持するもの |
| --- | --- |
| Core／Package／Catalog読込 | S15で対象を区別して再試行。取得済みの保存原本・Draftを保全 |
| 自軍Hero／Skill／Squad／Node | S04／S06／S07の該当対象へ。無関係な値を保持 |
| 相手NPC／Scenario | S02へ。自軍の設定を変更させて回避しない |
| Jinrei compile | S08の実診断位置・型・CUを提示。Source保持 |
| 保存容量／アクセス | S15でExport・再試行。Savedと偽表示しない |
| 版・identity不一致 | S15で差異と原データExport。未提供の版切替へ誘導しない |
| GPU／Renderer | S12のResult・Replay・Tick保持、描画再試行または分析 |
| Enbu失敗 | S10で不変入力と原因を提示、修正・再試行 |
| 処理結果不明 | 処理対象を保持し状態確認へ。二重確定や架空の成功なし |

GPUエラーと戦闘の失敗を同じ「開始失敗」にしない。未保存の成功・不明な遅延に対する架空の完了通知は禁止する。

## 10. Desktopのナビゲーション構造

Homeから編成、Jinrei、対戦条件、Libraryへ移動できる。Hero Collection・Detail・Skill Tree・Squad Assembly・Jinrei・Battleはそれぞれ異なる主役を持ち、すべてのPaneを常設しない。Readyへのショートカットは不正設定を無視する抜け道ではない。

S12→S13は選択文脈を保持する。S13→S08は解決できたAction／Scope／Source位置へ移動し、対応不明ならその限界を示す。Library・Detail・Coverage等の寄り道は実際の呼出元へ戻す。

## 11. Mobileの専用画面遷移

~~~mermaid
flowchart TD
    H["S01 Mobile Start"] --> Q{"開始方法"}
    Q -- Quick / Campaign --> P["S02 対戦条件"]
    P --> C0["S03 出撃内容要約"]
    Q -- Custom --> P2["S02 対戦条件"]
    P2 --> C["S04 Hero一覧・5枠"]
    Q -- Continue --> L["S14 復元元確認"]
    L -- 互換・復元承認 --> C0
    C -- 閲覧 --> D["S05 Hero詳細"]
    D -- 変更せず戻る --> C
    D -- 採用・Skillへ --> T["S06 Skill Tree・詳細Sheet"]
    C --> T
    T --> S["S07 分割・所属・共通Node"]
    S --> J["S08 No-code／Text独立面"]
    J --> G["S09 Coverage・任意"]
    G --> J
    J --> R["S10 対象付き問題修正・Ready"]
    C0 --> R
    R --> E["S11 実行"]
    E -- 確定 --> B["S12 戦場・再生操作"]
    B -- 同Tick・同対象 --> A["S13 Analysis"]
    A -- 文脈付き編集 --> J
    A -- 再戦条件を確認 --> R
    A -- 次の解放課題 --> P
~~~

MobileでもS02の条件確認とS10の開始検証を省略しない。独立したScreenまたはSheetで完走し、ドラッグ・ピンチは補助入力に留める。Back・Sheetの閉じる・IME・Safe Area・回転で同じDraftと閲覧文脈を保持する。

## 12. 画面間を横断する保存・更新の規範

| Origin → Destination | 遷移の成立条件／失敗時 |
| --- | --- |
| S01 → S02/S03/S04 | CoreとRulePackageが利用可能。不可ならS15。初期Presetへの無断置換なし |
| S04 → S05 | 閲覧対象がCatalogに存在。候補閲覧だけでは編成しない |
| S05 → S06 | 編成中または明示採用した対象のSkill計画。閲覧取消なら元の枠を保持 |
| S06 → S07 | 5体のSkill Planと前提が有効。欠落は対象を示す |
| S07 → S08 | 一意所属・合法な共通開始Node。無効ならS07で修正 |
| S08 → S10 | Readyで現行revisionを検証し、失敗は該当位置へ |
| S10 → S02 → S10 | 確認だけなら条件を保持。変更した場合だけ関連する検証を失効 |
| S02 → S10 | NPC／Scenarioの実値を固定し、無効なら相手側問題として戻す |
| S14 → 編集 | 保存対象・互換性・置換影響を確認し、取消可能 |
| S10 → S11 | PLAYER-JOURNEYのReadyToLaunch成立。二重起動禁止 |
| S11 → S12 | 実Enbuの有効なResult／Replayのみ。未確定は成功にしない |
| S12 → S13 → S08 | 同じMatch・視点・Tick・対象・実診断を保持。元Runは不変 |
| S13 → S10 | 完全再実行／改良比較／別条件の対戦を区別して再検証 |

## 13. ワイヤフロー受入

全Screenと各分岐に少なくとも1つの実操作シナリオを紐付ける。初回・Custom・Campaign・復元／不一致・変更後の失効・保存失敗・Enbu拒否・終局後再戦をDesktop／Mobile双方で完走する。元のUX-ENTRY等に加え、合意案の [UX-C01〜C16](UX-INTERACTION-CONTRACTS.md) を検証する。

装備・市場・関係性・会話のX系追加導線は [PROGRESSION-UX.md](PROGRESSION-UX.md) に分離する。未採用の機能をG2未達として数えない。画面図や静的コードの確認だけを実ブラウザ受入の証明にしない。
