# PLAYER-JOURNEY — Senkeiのゲーム開始前UX・プレイヤー導線の正本

## 1. 対象・権限・設計の立場

本書は**戦闘を開始するまでにプレイヤーが行うこと、選択できる導線、正しい開始条件、進行状況の意味**の製品UX正本。個々の画面と戻り先・CTAは [PRE-BATTLE-SCREENS.md](PRE-BATTLE-SCREENS.md)、全画面・例外の遷移図は [PRE-BATTLE-FLOWS.md](PRE-BATTLE-FLOWS.md) を正本とする。

- [PRODUCT.md](PRODUCT.md) の「編集→実戦→観測→分析→改善→再戦」、[GAMEPLAY.md](GAMEPLAY.md) の戦闘は完全自動というゲームループを維持する。
- [UNITS.md](UNITS.md)、[HERO-ATELIER.md](HERO-ATELIER.md) の**5 Hero固定／初期Catalog 12種／Hero Collection・Detail・Skill Tree・Squad Assemblyの独立画面**を守る。
- [JINREI-GRAMMAR.md](JINREI-GRAMMAR.md) の文法を変更しない。Editorの詳細な操作・Coverage・Domain Catalogは [JINREI-EDITOR.md](JINREI-EDITOR.md) を正本とする。
- [SENRITSU.md](SENRITSU.md) の版付きRulePackageと、[ENBU.md](ENBU.md) の完全自動・決定論的実行がゲーム内容と開始可否の権威者。
- Desktop/Mobileは**同じドラフト・検証規則だが独立した画面構成**。[UI-DESIGN.md](UI-DESIGN.md) を優先する。
- 対象は**ローカルPvE / G2 Hero戦**。ログイン、オンラインPvP、ランキング、課金、サーバー準備は開始条件ではない。旧senkei.initialとG1サンプルは正式なG2戦の入口と混同しない。

**確定済み要件**と、本書で具体化する**提案UI**を区別する。画面IDや「開始・再開」ハブはUI構成の提案であり、現在実装済みという主張ではない。能力値・重複選択制約・プリセット内容・敵編成の種類・難易度はSenritsuが決める。ゲームルールにない数値や能力を画面の都合で作らない。

## 2. 何を設定すれば最初の戦闘が始められるか

| 意思決定／入力 | プレイヤーがすること | 必須・自動補完 | 権威・保存先 |
| --- | --- | --- | --- |
| **遊び方** | 「すぐ戦う／自分で編成／続きから」の入口を選ぶ | 入口選択は必要。初回プレイのための新規ログインは不要 | 製品UX |
| **ゲーム種別** | ローカルPvEを選び、利用可能ならシナリオ／対戦相手を選択 | ローカルPvEのみで十分。初期NPC・シナリオは明示して自動選択可 | Scenario / RulePackage |
| **RulePackage** | 対象SenritsuとWorldの版を確認 | 同梱Nextが1つなら自動選択し閲覧可能にする。ユーザーにdigestを入力させない | Senritsu / World identity |
| **5 Hero** | Catalogから5スロットへHeroを設定 | **ちょうど5体必須**。Quick Startは検証済みプリセットで自動入力可。重複可否はルール依存 | Hero Catalog |
| **初期Skill計画** | 各HeroのSkill Treeを見て合法な取得経路を選ぶ | 各Heroの合法な計画が必要。Quick Startはデフォルト計画可。取得は試合内レベル条件で行う | Hero Catalog / Skill Tree |
| **Squad** | 5 Heroを1〜5 Squadへ所属させる | **所属一意**。7つの整数分割を認める。Quick Startは合法な初期所属を投入可能 | Senritsu / Units |
| **初期配置** | Squadごとの出発Nodeを選ぶ | 合法な起点が必要。同一Squad全員の起点は一致。Quick Startは安全な合法値に設定可能 | World / Senritsu |
| **Jinrei** | Preset / No-code / Textのいずれかで自軍戦術を用意 | **コンパイル済み戦術が必要**。プレイヤーがコードを書くこと自体は必須ではない | Jinrei + Catalog |
| **Behaviorの選好** | 必要ならArmy/Squad/Heroの既定方針を上書きする | 任意。未指定は実際に宣言済みのDefaultに従う。未宣言は「既定設定あり」と偽らない | Senritsu Behavior Profile |
| **対戦相手** | 認可されたNPC/Scenarioの内容・側を確認 | 対戦相手の**有効な戦型**は必須。初期固定NPCなら自動入力し、表示上は隠さない | Scenario / NPC Draft |
| **診断取得** | 自軍の詳細診断を取得するか選ぶ | 任意、既定表示は製品判断。相手の非公開情報を公開しない | RestrictedDiagnostics |
| **開始確認** | 設定サマリと検証結果を確認し「戦闘開始」 | **開始時検証が成功**して初めて進行。任意の保存操作は前提にしない | Preflight / Enbu |

**シナリオ、Hero、Skill、Squad、初期Node、Jinrei、敵NPCは独立したものではなく、一つの開始可能なSenkeiドラフト＋対戦条件**を構成する。Quick Startで初期値が入っていることと、プレイヤーが自分で編集したことを混同しない。

## 3. 最小の開始導線と自由編集導線

### A. すぐ戦う — 新規・初回（初心者の第一導線）

1. 開始画面で「すぐ戦う」。
2. **利用可能な初期NPC／Rulesetの検証済みセット**を確認。難易度・敵候補が一つしかなければ無意味な選択画面を挟まない。
3. プリセットの**5 Hero、Skill Plan、初期Squad、開始Node、Jinrei**が自動入力される。内容は「試合に必要なもの」として1画面で確認・変更へ移動できる。
4. 「準備確認」でルール・編成・両陣営の戦術・Catalog/Program identityを検証。Jinreiは**実Coreでコンパイル**する。
5. 「戦闘開始」→実Enbuを実行→確定した勝敗と認可済みReplayを表示。**コード手入力も事前保存も不要**。

初回チュートリアルは使えるなら任意。サンプルG1を真の対戦として扱わない。「簡単に始める」と「内容不明の戦術で出撃する」は異なる。

### B. 自分で編成 — 標準・上級者

1. 有効なローカルPvEシナリオ／ルールを確認する。
2. **Hero Collection**：12体の実Catalogを見ながら5枠を編集。フィルタ、5枠の常時表示、変更後の依存差分を表示。
3. **Hero Detail**：選択Heroの能力とJinrei Capability、外観を確認。閲覧はSkillやSquad作成の必須前提にはしない。
4. **Skill Tree**：各Heroの分岐と前提条件を確認し、5体の合法な取得予定を設定。
5. **Squad Assembly**：7分割の候補または合法な個別編集で所属を確定。各Squadの開始Node、隊列、速度・連携の影響を確認。
6. **Jinrei Workbench**：No-code / Textの同一意味論を編集。Army/Squad/Heroの選好・Capability、Default/Effectiveの差分、Known/Unknownを確認。
7. コンパイル・CU・検証結果を確認して**準備確認**へ進む。
8. 対戦相手の有効なNPC設定、結果取得の権限、バージョンを最終確認して開始。

画面はタスク別に独立させるが、プレイヤーはどこからでも**必要な設定だけ直して準備確認へ戻れる**。すべての画面を毎回強制通過させるWizardにはしない。

### C. 続きから／インポート／再戦

- **続きから**：保存済みSenkeiを選ぶ→対象Ruleset/World/Catalogの互換性を照合→ドラフトを復元→不足または変更された箇所だけ再編集→再コンパイル→準備確認→開始。
- **復旧**：明示保存したRestore Pointと未保存のRecovery Copyを分離。読めない旧設定は**保全・エクスポート・互換性理由表示**し、黙って消さない。
- **再戦**：分析→変更せず同条件を再実行／Hero・Skill・Squad・Jinreiを変更→無効化されたコンパイルを更新→同条件比較の実験へ。
- **保存と共有**：保存・Exportは便利な操作だが、1戦目を始めるための強制Stepではない。
- **旧保存データ**：旧初期RulesetのIndexedDB文書はLegacy Recoveryから一覧・履歴確認・Export・削除できる。Nextでは実行・変換せず、明示的なConverterと検証が用意されるまで原形式を保全する。G1 Fixtureは独立Renderer入口であり、戦型の対戦導線には含めない。

## 4. 開始可否の単一契約（Preflight）

**本番開始ボタンの有効性は、見かけの「5枠」「COMPILED」表示だけで決めない。**

~~~text
ReadyToLaunch =
  localCoreAvailable
  AND verifiedRulePackageAndWorld
  AND compatibleDomainCatalogAndAnyEnabledBehaviorBinding
  AND validSelectedScenarioAndOpponent
  AND exactlyFiveValidHeroSlots
  AND validSkillPlanForEachSlot
  AND validSquadPartitionAndStartNodes
  AND currentPlayerProgramCompiledAndMatched
  AND validOpponentProgramAndConfiguration
  AND allStartValidationPasses
  AND NOT simulationInFlight
~~~

- **同一のRulePackage／World／Catalog／有効化されたBehavior／Jinreiと双方の初期条件**を試合Snapshotへ固定する。World/Behaviorの意味論的束縛が現在未実装なら完了したふりをせず、実装差分を明示する。**現行RulePackageにBehavior Profileがまだ存在しないことだけでは試合開始を拒否しない**。ただし存在しないDefaultを「適用済み」と表示しない。RulePackageがBehaviorの実行を宣言した場合、その完全Identity照合を開始条件にする。
- Heroの重複選択可否・初期Nodeの合法集合・Skill条件などの**判定実体**はSenritsuとEnbuが所有する。フロントはその結果を示すだけ。
- Compiled ProgramとドラフトSourceは別状態。Jinrei変更、Hero変更に伴うStarter戦術変更、Ruleset/Catalog/Behaviorの意味を変える変更、構成依存の変更時に**影響する検証を失効**させ、必要時再コンパイルする。無関係なビジュアル操作で失効させない。
- Default Coverageの実効行動に曖昧さがあればエラー。**Not Provenという未証明だけで常に戦闘開始を禁止する仕様ではない**。静的証明範囲を表示し、実合法性と分離する。
- ボタンの状態は「準備不足・編集中・検証中・開始可能・実行中・失敗・完了」を区別。対象が未検証なのにREADYと表示しない。
- 実Enbuの要求が拒否された場合はRunが成立していない。直前の入力を維持し、エラーを該当画面に紐付ける。成功したときだけ確定したReplay/Resultへ遷移する。

実装するワイヤ／API名・遷移ガードの詳細は [PRE-BATTLE-SCREENS.md](PRE-BATTLE-SCREENS.md)。画面遷移の列挙は [PRE-BATTLE-FLOWS.md](PRE-BATTLE-FLOWS.md)。

## 5. 同一ドラフトを横断する情報モデル

プレイヤーの主語は一つの**編集中Senkei**。各画面が別々に5 HeroやSkillを持つことを禁止する。

| 論理データ | 所有者 | 各画面での用途 |
| --- | --- | --- |
| Draft / revision / dirty / savedRevision | ローカルDraft Repository | 全画面で現在の編集状態・保存/回復 |
| RulePackage/World/Catalog identity | Verified Senritsu/World Producer | Hero/Skill/Capability/Scenarioの選択合法性 |
| 5 Hero slots | Formation draft | Collection、Detail、Skill Tree、Squad、Ready |
| Skill acquisition plan | Hero別配置データ | Skill TreeとReady。実戦取得済みとは別 |
| Squad membership / initial location | Squad/Deployment draft | Assembly、Jinreiの作用範囲、Ready |
| Jinrei source/AST + compilation | Jinrei Compiler | Workbench、Coverage、Ready。最新revisionのみ有効 |
| Opponent/Scenario configuration | PvE Scenario | 入口、Ready、Enbuの敵側初期入力 |
| Launch Snapshot / Match Result | Enbu | 完了した試合の比較・Replay/Analysis。Draftと独立 |
| Authorized Observation / Trace | Enbu認可済み出力 | 勝敗観測、Coverage/Decision Trace。非公開敵のJinreiを漏らさない |

### Persistence／戻るの原則

- **戻る／別画面／Mobile画面復帰**は入力を破棄しない。未保存ドラフトと保存済みスナップショットを分ける。
- 離脱・再読込・Tab終了・IndexedDB/LocalStorage失敗は、消去ではなく**復旧導線**へ。実保存の失敗を成功と表示しない。
- 新しいHeroへ差し替えたとき、旧Skill Planや特有のBehavior設定が適用不能なら**影響範囲を表示して修正を要求**。黙って無関係な設定を消さない。
- 対戦相手変更は相手側のバインディングと比較条件を失効する。自軍HeroやJinreiを不要にリセットしない。
- 新しい戦闘を開始しても、過去Matchの分析・基準値は識別子付きで参照可能。新しいRunの情報を古いRunへ差し込まない。

## 6. UXの受入条件

1. 初回ユーザーが**コードを1文字も入力せず**、存在するRulePackageとNPCプリセットだけでローカルPvEを開始できる。
2. Customで5 Hero、合法Skill Plan、全Squadの一意所属・初期Node、Jinreiと敵NPCを設定でき、設定漏れはReady画面から該当箇所へ戻れる。
3. Collection→Detail→Skill Tree→Squad→Jinrei→Ready→実戦→Analysis→再編集→再戦を、**Desktop/Mobileそれぞれの画面遷移**として全て操作できる。
4. いずれの画面でも対象Senkei/Ruleset、保存状況、最短の「次の操作」、戻る先が分かる。プレイヤーに旧Next/Tacticsなどの技術用語の差を推測させない。
5. 未コンパイル・エラー・互換性不一致・保存失敗・オフライン・GPU不対応・中断・復旧の各導線を実操作で検証。未復旧を「成功」と表示しない。
6. Previewでは既知の地形や施設の公知情報と、試合中のFog/Unknownを分離。敵の隠れた位置・非公開戦術を開始前のプレビューや実Replayへ漏らさない。
7. Heroの変更、復旧、Ruleset変更、再戦からの戻りで、同一ドラフトとコンパイル／Scenarioのidentityが正しく更新される。
8. 最終の受入は情報設計／操作／契約／実ブラウザの個別判定。ワイヤフレーム・Mermaid図だけで製品UXが実装済みと判断しない。

## 7. 現行実装との比較（開発者向け事実・規範ではない）

- 現行シェルは **Tactics / Next / Battle lab / Library**、G1サンプルの別導線を持つ。Nextの内部は **Formation / Jinrei / Battle / Analysis** で、Formation内にCollection / Detail / Skill Tree / Squad Assemblyを持つ。S02条件選択／S10 Ready画面とWorkspaceへの接続はソース上実装されている。ただし一続きの導線についてDesktop／Mobile実操作の受入は別に必要。
- Nextは実Catalogから5スロットと各Skill Planを初期生成し、Squad分割と共有開始Node、Jinreiの実コンパイル、相手側Starter戦術、保存／復旧、Enbu実行を提供する。シナリオ・NPCと開始条件の専用画面は実装されているが、全遷移・入力保持・失敗復旧・実ブラウザの受入完了は意味しない。
- 旧Tacticsは初期Rulesetの初心者Preset・Campaign scenarioを提供するが、これをG2 Nextの対戦相手UIが完成した証拠にしない。
- Nextの明示保存先はブラウザStorageの専用領域、旧Libraryは別のIndexedDB上の旧戦型ドキュメント。本書の統一UXは**明示的な互換変換なしに既存データを統合済みとは扱わない**。

個々のコンポーネント名、CSS、Router、実装作業リストは本書の正本にしない。**Screen ID、ユーザー意図、データ責務、開始条件、戻り・復旧の契約**を固定する。
