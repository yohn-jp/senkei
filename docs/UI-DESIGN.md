# Senkei — UI／UX構成と操作契約

## 1. 中心タスク

Senkeiの中核は「自分が作った戦型がどのように戦ったかを理解し、次の改善を決める」こと。UIは**戦場を観察するゲーム体験**と**戦術の開発環境**を両立する。

- 戦型の作成・編成と陣令の編集。
- NPCとの演武・リプレイで挙動を観察。
- 戦線、イベント、損耗、許可された診断から敗因を調べる。
- 陣令を修正して同条件の演武で再検証。
- 検証用Fixtureはサンプルと明示した独立経路に置き、初回Homeや実Enbuの成功を代替しない。

UIデータの正本は [REPLAY.md](REPLAY.md)。ゲームの意味論は [COMPONENTS.md](COMPONENTS.md)、陣令の表層構文は [JINREI-GRAMMAR.md](JINREI-GRAMMAR.md)。**ゲーム開始までのユーザー行動と必須入力**は [PLAYER-JOURNEY.md](PLAYER-JOURNEY.md)、**画面遷移・戻り・復旧**は [PRE-BATTLE-FLOWS.md](PRE-BATTLE-FLOWS.md)、**画面の情報設計と低忠実度ワイヤフレーム**は [PRE-BATTLE-SCREENS.md](PRE-BATTLE-SCREENS.md) を参照する。操作の文脈・副作用・復帰を具体化する合意案は [UX-INTERACTION-CONTRACTS.md](UX-INTERACTION-CONTRACTS.md)。**陣令の表示例を旧Python風文法で作らない**。実際の陣令編集画面には確定したstate/action/when/do、波括弧、カンマ、三値評価を使う。

## 2. Desktop：Tactical Workbench

最大の面積は3D戦場。固定サイドパネルをすべて強制表示せず、タスク別ワークスペースで密度を変える。

~~~text
┌──────────────────────────────────────────────────────────────────┐
│ SENKEI | 戦型名・実際の保存状態    戦型  陣令  演武  分析          │
├─────────────┬─────────────────────────────────┬────────────────┤
│ 編成・レーン│                                 │ 選択情報       │
│ Heroと軍備  │         Pixel 3D 戦場           │ 戦況・イベント │
│             │         俯瞰／追跡             │ 観測値         │
├─────────────┴───────────────────────────────┴────────────────┤
│ Replay timeline       戻す  再生/停止  速度  Tick / 最終結果     │
└──────────────────────────────────────────────────────────────────┘
~~~

- **演武**: 中央の戦場を最大化。左の編成情報・右の分析は折りたたみ可能で、戦場を全画面にできる。
- **陣令**: コードまたはノーコードのエディタへ主表示を切替。戦場とトレースの参照は残すが、小さな常設コード欄に押し込まない。編集・Domain Catalog・Behavior Coverage・Decision Traceの具体的なUXは [JINREI-EDITOR.md](JINREI-EDITOR.md) が正本。
- **戦型**: 固定5 Hero、Skill計画、Squad分割、配置・レーン配分を編集するワークスペース。任意の兵数を購入・増減する画面ではない。
- **分析**: 選択イベントと戦闘Tickを結合。観測された事実と敗因の推測を区別する。
- ヘッダーの高さや戦場の位置がエラーやサンプル通知によって跳ねないようにする。
- 日本語ラベル、長い戦型名、Tick/CU等の数字が視認できること。数値はtabular-numsを推奨。

## 3. Mobile：独立した戦術コンソール

Desktopを縦積みするだけのレイアウトは禁止。同じドメイン状態を使いながら、操作と画面構成を独立させる。

| 画面 | 操作モデル |
| --- | --- |
| 演武 | 3D戦場を主要表示、下部に再生／停止・シーク・速度、部隊タップで詳細 |
| 戦型 | 5 Heroの選択、Skill、Squad分割と配置を専用面で編集。ドラッグ必須にしない |
| 陣令 | ノーコードを主導線、生コード編集は独立した全画面ワークスペース |
| 分析 | 縦長イベント列、戦闘の指定Tickへ直接戻れる |
| 詳細 | ボトムシートまたは画面内パネル。閉じるボタンを常設 |

- 標準カメラへ戻して3レーンを俯瞰できる明示操作を用意する。タッチのピンチズーム・ドラッグは機能する場合に限って表示し、ジェスチャー以外の操作も用意する。
- ソフトウェアキーボードが開いた際、入力欄・編集位置・保存／戻る操作が隠れないこと。
- 画面切替後も再生Tick、カメラ、対象選択、未保存陣令を保持する。DesktopとMobileで戦術データの正本を分けない。
- Safe Area、縦画面、片手操作、横スクロール、長い日本語、端末回転を検証する。
- タッチターゲットは44 CSS px前後を快適操作の開始目標とする（WCAG AAの必須寸法という意味ではない）。

## 4. 実際の状態と操作

| 状態 | 画面に必要な情報／動作 |
| --- | --- |
| 初回 | HomeでQuick／Custom／Campaign／Continueの実際に利用できる入口を示す。架空の試合を初戦として表示しない |
| 読込中 | Core・Catalog・保存読込の実状態。偽の進捗を表示しない |
| 試合なし | Battle／Analysisの空状態から対戦準備へ進める。Fixtureを過去Runへ代入しない |
| 停止 | Tickと戦場が一致。シーク・部隊選択・カメラ操作が可能 |
| 再生 | 3D戦場・イベント表示・タイムラインが同じTickを共有 |
| 終局 | Enbuの確定結果と分析・再戦・戦役継続。サンプルの場合はその区分を保持 |
| 契約不正 | 対象のSchema／入力／Replayのエラーを示し、原データを保全して修正・Export・再試行へ |
| 描画失敗 | WebGL非対応・GPUエラーを明示し、Result／Replayを保持して描画だけ再試行 |
| 未観測 | Unknownをゼロやfalseに変えず、対象を隠す・非公開として扱う |
| 未確定 | 処理対象と確認可能な状態を示す。タイムアウトや応答待ちを成功・取消済みと断定しない |

検証用Fixtureで保存やPvPなど未実装の機能を「成功」と表示しない。ボタンは実際に機能するか、利用できない理由を明示する。Replay Playerが再生カーソルの唯一の管理者であり、UIのカメラ状態・パネル状態とは別に扱う。

## 5. 再生と分析

- 再生／停止、1倍・2倍・4倍、任意Tickへのシーク、先頭へ戻るを初期操作として用意。
- 部隊選択で表示するのはReplayで与えられた可視データのみ。敵の非公開JinreiやCU内訳は表示しない。
- イベント選択でタイムラインを移動して該当する位置をハイライトできる。
- Replay→Analysisは選択したMatch・視点・Tick・対象の文脈を渡す。Analysis→Sourceの対応位置は実際のProgramと診断に基づく。詳細と合意対象の受入は [UX-INTERACTION-CONTRACTS.md](UX-INTERACTION-CONTRACTS.md) C06／C07を参照。
- 光、攻撃エフェクト、パーティクルは結果を描画するだけで、実際のダメージや勝敗の判断を変えない。
- 減速モーション設定では激しい動きを抑えても、出来事・停止位置・終局の意味が保持される。

## 6. 描画と編集の情報階層

**第1視線**は戦場・選択した戦型・現在Tick、**第2視線**は戦況の理由・次の操作、**第3視線**は技術的メタデータ・設定。装飾的なダッシュボードを優先しない。

- 地形・Hero・陣営の識別は色に加えシルエット・模様・ラベルを併用。
- Pixel処理は戦場のみ。高解像度UIは読みやすいタイポグラフィ・明確なフォーカス表示を維持。
- タイムライン、再生速度、エラー、保存状態の意味を色だけに頼らない。
- ローカル戦闘と将来の公式戦を混同しない。サンプルは明示ラベルを持つ。

## 7. 画面検証

実Battlefieldの地理・造形・戦闘可読性・Tactical/Overview/Followの画面受入は [BATTLEFIELD-VISUAL.md](BATTLEFIELD-VISUAL.md) に従う。

- Desktop: 1920×1080 / 1440×900。Mobile: 390×844 / 430×932、狭幅320pxでも主要導線を確認。
- 各デバイスでHome、試合なし、実戦初期、再生途中、施設破壊、終局、契約不正、描画不可を確認。
- 再生／停止／シーク、カメラ操作、部隊選択、画面の移動と復帰をPlaywright等で実操作する。
- スクリーンショットを縮小しても戦場が主役であること、Heroと陣営がわかること、主要操作が隠れないことを目視判定。
- 実機のタッチ／IMEはエミュレーションによる検証とは区別し、未実施ならNOT_CHECKEDと報告。
- 自動visual regressionはレイアウト回帰の検出手段であり、完成度の高いデザインであることの証明ではない。

## 8. Hero専用ワークスペース

Hero Collection、Hero Detail、Skill Tree、Squad Assemblyは [HERO-ATELIER.md](HERO-ATELIER.md) の専用デザイン契約に従う。DesktopのHero展示・成長経路・Squad構成は別々の主役を持ち、Mobileでは独立した操作画面を用いる。戦闘前に設定するスキル取得予定と、戦闘中の取得済みスキルを混同しない。Heroのモデルは戦場と同じidentityを用いる。

候補Heroの閲覧と編成への採用を分ける追加案は [UX-INTERACTION-CONTRACTS.md](UX-INTERACTION-CONTRACTS.md) C03。閲覧面を増やすために別のHero CatalogやDraftを作らない。

## 9. Jinrei Editor・Coverage・診断の専用導線

[JINREI-EDITOR.md](JINREI-EDITOR.md) をJinrei Workbenchの**独立した製品体験の正本**とする。DesktopはSource/No-code、Domain Catalog、Hero/Squad/Army別のBehavior Coverage、認可済みDecision Traceを横断できる。MobileはDesktopの縮小ではなく、編集／Catalog／Coverage／Traceを各専用面として提供する。

「何も書かなければどう行動するか」「Squad/Armyから何を継承したか」「Jinreiの上書きによって何が変わるか」「実戦の採用・拒否理由」を同じRulePackageで提示する。画面の100%表示は全実世界状態を証明したかのように誤認させず、解析対象の状態同値クラス、Unknown、未証明の範囲を併記する。全ての変数・定数・CapabilityはSenritsu [DOMAIN-CATALOG.md](DOMAIN-CATALOG.md) から取得し、Editor専用の重複辞書を持たない。

## 10. ゲーム開始までのユーザーフロー

G2の実プレイヤー導線は [PLAYER-JOURNEY.md](PLAYER-JOURNEY.md)、[PRE-BATTLE-FLOWS.md](PRE-BATTLE-FLOWS.md)、[PRE-BATTLE-SCREENS.md](PRE-BATTLE-SCREENS.md) を横断して設計する。本書はDesktop/Mobileの体験・表示階層に責務を持ち、開始に必要な5 Hero・Skill計画・Squad／初期Node・Jinreiコンパイル・NPC・RulePackage適合性を画面ごとに分離して検証する。

Hero Collection／Detail／Skill Tree／Squad Assemblyは独立した主画面だが、**初回Presetの全画面強制通過はしない**。Quickは実Presetを確認して開始でき、Customは編集し、Continueは保存物と版を照合して再開する。Campaignは明示的に選んだ課題を使う。すべて同じReady/Preflightを通り、コンパイル失効・開始不能の理由と修正先を提示する。

Home／Library／Recoveryは製品の入口・保全導線として定義する。NextのSetup・Recovery・Experimentと旧形式データは対象を区別し、互換性のない旧データを実行しない。シェルの一時的なTab名や「未実装」といった時点説明を、恒久的な画面契約として扱わない。実装状況は検証記録で判断する。

DesktopではHero/Skill/Jinrei/Battleをそれぞれ主役にし、Mobileでは専用画面・シートと戻り導線を持たせる。ワイヤフレームやコードの存在だけで実操作の受入済みとしない。

## 11. 戦術改善ループ・Fog・Mobileの追加合意

[TACTICAL-LOOP.md](TACTICAL-LOOP.md) に従い、ReplayのTick・対象→認可済み分析→Jinrei修正→再Compile／Preflight→同条件比較をつなぐ。Presetと段階的開示、RevisionとExperimentの区別を維持。MobileではReplayと編集を独立画面にし、Desktopの縮小を避ける。[FOG-OF-WAR.md](FOG-OF-WAR.md) に従って視界外の敵を消し、橋の過去観測と現在不明を区別する。PC／Mobile同時利用は検討のみで、現行ローカルPvEへ認証・同期の必須依存を追加しない。

## 12. 操作水準を合意するための追加仕様

[UX-INTERACTION-CONTRACTS.md](UX-INTERACTION-CONTRACTS.md) は閲覧と変更、対戦条件と戻り先、対象付きPreflight修正、分析・診断・Sourceの接続、再戦の比較条件、保存範囲、戦役終局を操作単位で具体化する合意案。既存の受入条件を緩和せず、UX-C01〜C16で結果を検証する。

[PROGRESSION-UX.md](PROGRESSION-UX.md) は装備・ガチャ・Libra市場・関係グラフ・会話を追加する段階の画面導線案。現在G2の完成条件とは分離し、オンライン基盤・資源・内政の保留を変更しない。
