# UX Flow Gap Review — 正本修正の根拠と未検証範囲

## 1. 対象・方法・限界

基準はmain `8cf967954579141f60da9a5e5bc52dcd5a93a6d4`。既存G2のS00〜S15を、入口→操作ハンドラ→変更される状態→実行先→戻り先の順で追い、Issue #5および正本文書と照合した。装備・報酬・関係性は別の将来設計として扱う。

**これはコード経路・文書のレビューであり、実画面を操作・撮影したUX監査ではない。** 同SHAのCI成果物を取得したが、ブラウザ接続が環境ポリシーで遮断されたため、画面寸法・視覚品質・実タッチ・IME・キーボード操作は未検証。過去のスクリーンショットやCI成功を今回の実操作証拠に代用していない。

取得・確認した成果物：Actions run `40210827967`、artifact `12605597393`（production-browser-build）。`dist/browser-build-revision.txt` は基準SHAと一致。`dist/browser-build-sha256.txt` の3項目を照合した。

- 両WASMコピー：`c7a4b58082d3db06111c3e521f0f85a6f5a08b30b717678ada2f742b1fe41319`
- `dist/web/index.html`：`c3a77196666081d9922ba57f3806d8df5796219bafb74a6c41943f3399127c6b`
- ブラウザ到達：`net::ERR_BLOCKED_BY_ADMINISTRATOR`。起動画面も取得できていない。未検証を正常／不合格の視覚判定に変換しない。

この記録のコード所見は基準SHAに限る。後続の実装が変わった場合は再照合する。本PRは文書のみで、以下のコード上の問題を修復しない。

## 2. 分類

- **D：文書不整合／仕様の空白** — 正本間の矛盾、操作の意味・戻り・失敗時の定義不足。新しく具体化する操作水準を既存仕様違反と混同しない。
- **I：コード上の契約未達** — 具体的な操作経路と既存契約の差を確認。ブラウザ再現とは別。
- **F：将来機能の導線不足** — 合意した追加ゲーム要素の画面設計。現在G2の不具合に数えない。
- **V：検証不足** — コードから視覚・実操作の品質を断定できないもの。

## 3. 辿った操作導線

| 段階 | 操作列 | コード・文書からの判断 |
| --- | --- | --- |
| 01 / S00 | 起動→Core／RulePackage→Catalog→Home | 読込処理はある。失敗・復旧の実画面はV |
| 02 / S01–S03 | Home→Quick／Custom／Campaign→条件→Preset | 入口は存在。旧「未実装」記述と矛盾するD01 |
| 03 / S02–S10 | Campaign選択→Ready→条件を確認→戻る | 対戦種別をreviewへ変更するI01 |
| 04 / S02–S11 | 最終課題→Preflight | NPCの同一Squadが複数Nodeに分散しておりI02 |
| 05 / S04–S05 | 候補Heroを調べる→戻る／採用 | カード押下が編成変更。閲覧と採用を分離するD08の合意案 |
| 06 / S06 | Skill分岐→詳細→別Hero→戻る | 前提検査と予定表示はある。分岐の視認性はV |
| 07 / S07 | 7分割→所属→共有Node→Ready | 分割・Node操作はある。Mobile操作品質はV |
| 08 / S08–S09 | No-code／Text→Compile→Coverage→戻る | モード変換と診断は存在。実Source入力・IMEはV |
| 09 / S10–S11 | Preflight問題→修正／実行→失敗復帰 | 一般編集リンクはあるが対象付き修正を具体化するD02 |
| 10 / S12 | 再生・seek・対象選択→Analysis | 分析側に選択Tick等を渡す入口契約が不足I04 |
| 11 / S13 | 後半Trace→Source修正 | Traceが先頭60件のみI05、汎用Editor移動のみI06 |
| 12 / S13–S10 | 完全再実行／変更後再戦→比較 | 不変Snapshot再実行はある。比較分類を明確化するD03 |
| 13 / S14 | 課題を保存→別課題→保存表示→Restore | dirty判定にScenarioが含まれないI03 |
| 14 / S14–S15 | Recovery／Import／Export／不一致 | 保全・確認導線あり。保持範囲・置換影響の説明を補うD04 |
| 15 / 戦役終局 | 勝利→解放／最終課題→継続 | 解放と攻略、最後の出口を分離するD05 |
| 16 / 横断 | Back／Sheet／回転／GPU・Storage失敗 | 戻り文脈と失敗分類を具体化するD06、実操作はV |

## 4. 既存G2の具体的な問題

### I01 / P2 — 条件の閲覧でCampaignがStarterへ変わる

[JourneyScreens.tsx:90–99](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/JourneyScreens.tsx#L90-L99) のDesktop／Mobile「対戦条件を確認」は `setEntryMode("review")` を行う。[NextWorkspace.tsx:1576–1630](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/NextWorkspace.tsx#L1576-L1630) はcampaign時だけ登録NPCを使う。閲覧から戻った後の再検証で相手が変わる経路が成立する。

契約：選択Scenarioと相手をSnapshotへ固定すること。修正方向：ナビゲーション理由と対戦種別を分離。追加受入 `UX-C01`。

### I02 / P1 — 最終NPCの初期配置がCore契約違反

[campaign.ts:114–130](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/scenarios/next/campaign.ts#L114-L130) の `protect-the-core` は3+2で、同じSquadの開始Nodeが異なる。[next_squads.rs:340–354](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/crates/enbu/src/next_squads.rs#L340-L354) はこれを拒否する。UIはこのNPCを選択対象として用意している。

契約：同梱NPCも実Preflightを通ること。修正方向：NPCを合法な配置へ直し、失敗する場合はS02へ原因を返す。Coreの制約を緩めない。追加受入 `UX-C02`。

### I03 / P2 — Scenario変更が保存状態へ反映されない

[NextWorkspace.tsx:1030–1044](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/NextWorkspace.tsx#L1030-L1044) の保存比較はDraft／slots／rivalSlots／formationShapeだけ。`campaign_scenario_id` は保存対象だが比較対象でない。課題だけ変更しても「保存済み」になり得る。

契約：保存表示は保存対象との一致を表すこと。修正方向：保存する値と同じ意味的対象でdirtyを導出。追加受入 `UX-C09`。

### I04 / P2 — Replay選択の文脈がAnalysisへ渡らない

[BattleAnalysis.tsx:27–42](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/BattleAnalysis.tsx#L27-L42) はRunと操作callbackを受け取るが、選択Tick・対象・イベントを受け取る契約がない。[同:251–295](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/BattleAnalysis.tsx#L251-L295) の分析フィルターは独立した初期値である。AnalysisからReplayへの移動はあるが、その逆の分析文脈を同等に保持していない。

契約：U01の選択Tickから原因調査へ進む経路。追加受入 `UX-C06`。

### I05 / P1 — 先頭60件より後の診断へ到達できない

[BattleAnalysis.tsx:365–370](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/BattleAnalysis.tsx#L365-L370) は `ownDiagnostics.slice(0, 60)` のみを描画し、残りは件数の注記だけ。診断が60件を超えた試合で後半の判断を調べる操作がない。観測Timelineのページ分割はこの診断列には適用されない。

契約：実際の転機の判断を調べられること。修正方向：Tick／対象の絞込またはページ分割で全提供済み診断へ到達させる。追加受入 `UX-C06`。

### I06 / P2 — Traceから該当Actionへの編集経路がない

[BattleAnalysis.tsx:330–344](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/BattleAnalysis.tsx#L330-L344) は `onEdit("jinrei")` の一般リンク、診断行はReplay Tickへの移動のみ。[JinreiWorkbench.tsx:23–44](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/JinreiWorkbench.tsx#L23-L44) にもRun／Action／Source位置の受渡し契約がない。

契約：U01の該当条件へ文脈付き遷移。Producerに位置対応がない場合はそれを明示し、推測で行番号を作らない。追加受入 `UX-C07`。

## 5. 文書の空白・水準を明確にする事項

| ID | 現状の根拠／空白 | 正本へ加える案 |
| --- | --- | --- |
| D01 | UI-DESIGN §4が初期Fixture中心、§10とPRE-BATTLE-SCREENS §1・§7が旧シェル／NPC未提供を現在値として記述。[App.tsx](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/App.tsx) と不整合 | 製品Home／実Enbuと検証Fixtureを分離。時点依存の実装説明を規範から外す |
| D02 | Readyは一般的な編集リンク中心。エラーの陣営・対象・復帰先が操作契約として弱い | C04の問題所有者と直接修正先を固定 |
| D03 | 比較は完全Snapshot一致／入力変更の二分類。[BattleAnalysis.tsx:212–239](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/BattleAnalysis.tsx#L212-L239) | 完全再実行、変更範囲以外を固定した改良比較、別条件の参考比較を区別 |
| D04 | 最新／直前2件保存はTACTICAL-LOOPに定義済み。Library通常表示はRecent experimentsで、2件の説明は削除確認にある。[NextLibrary.tsx:270–325](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/NextLibrary.tsx#L270-L325) | 通常面で保持範囲・置換・Exportを説明。Restoreの置換対象と取消を明示 |
| D05 | 戦役進行はunlocked IDを保存、最終課題の次は存在しない。[NextWorkspace.tsx:1664–1676](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/NextWorkspace.tsx#L1664-L1676) | 解放／攻略／最終完了と戦後の次の操作を定義。報酬仕様を追加しない |
| D06 | 戻る保持の一般原則はあるが、寄り道のorigin、Sheetと画面Back、実行中の移動・取消、結果不明の扱いが不足 | C01／C05／C12で操作の意味を明示。実際に止めていない処理を取消済みにしない |
| D07 | Recoveryで対応RulePackageが必要と説明される一方、Appの取得経路は同梱Next。[NextLibrary.tsx:290–311](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/NextLibrary.tsx#L290-L311) | 使える復旧手段と未提供の版切替を区別。元データExportを保持 |
| D08 | [HeroAtelier.tsx:110–124](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/HeroAtelier.tsx#L110-L124) のchangeHeroが選択枠を更新。[同:190–220](https://github.com/yohn-jp/senkei/blob/8cf967954579141f60da9a5e5bc52dcd5a93a6d4/apps/web/src/features/next/HeroAtelier.tsx#L190-L220) はカード採用と現在枠のDetailを接続し、未採用候補を読む独立対象がない | 候補閲覧と明示採用を分離するC03を新たに合意する。既存仕様が独立候補閲覧まで明示していたとは断定しない |

## 6. 将来拡張の空白

| ID | 対象 | 現行の設計から不足していた接続 |
| --- | --- | --- |
| F01 | 勝利→ガチャ→取得 | 試合完了と報酬確定、演出と抽選、結果不明と再試行の分離 |
| F02 | 装備庫→装着→Ready | 閲覧／プレビュー／明示適用、同じDraftへの反映、過去Run不変 |
| F03 | 重複品→市場／最低保証→Libra | 出品と売却確定、プレイヤー取引とMM買取、発行と移転の区別 |
| F04 | Hero→関係グラフ→ペア→Squad | 非対称な感情と対称な連携、閲覧だけで編成を変更しない導線 |
| F05 | ペア→会話→戻る／再閲覧 | 解放・既読・中断・性能取得の分離、再閲覧による二重更新の禁止 |

F01〜F05は [PROGRESSION-UX.md](../PROGRESSION-UX.md) の提案に接続する。G2の未実装バグとしては扱わない。資源・内政・オンライン権威の保留を解除していない。

## 7. 合意と検証の出口

合意対象は操作契約と戻り・状態表示・受入シナリオ。選択肢は、既存の一般原則だけでコード修正を続ける案と、追加契約を先に固定して実装する案。今回の依頼に従い後者をPRとして提示する。新しい画面装飾やフレームワーク変更は提案しない。

6件のI、8件のD、5件のFを整理した。Vは全画面に残る横断的な検証限界であり、未観測の視覚不具合を件数に加えない。受入ケースUX-C01〜C16／UX-X01〜X08は未実施。コード修正、mainへの直接反映、マージ、G2完成の認定は本PRに含めない。
