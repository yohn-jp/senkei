# 戦術改善ループ — Replay・分析・編集・Experiment

## 中心体験

Senkeiのプレイヤー操作は**設計→実行→観測→原因検討→Jinrei修正→同条件再戦**。試合中の直接操作はない。[PRODUCT](PRODUCT.md)・[UI-DESIGN](UI-DESIGN.md)の横断UX、[PRE-BATTLE-FLOWS](PRE-BATTLE-FLOWS.md)の開始前導線、[JINREI-EDITOR](JINREI-EDITOR.md)のCoverage・Trace規範を維持する。

## U01 — 戦闘から戦術変更まで

1. Replayで選択Tick・Hero／Squad・可視イベントを特定する。
2. Analysisで観測された値、実際の行動と結果を確認し、事実と敗因の**推定**を明示的に分ける。
3. 認可されたDecision Traceが存在するときだけ、選択候補・採否・CU・Unknownを表示する。敵の非公開Jinreiや隠れた観測値を推測補完しない。
4. 対応するSource／No-code EditorのJinrei条件へ文脈付き遷移し、同じDraftを修正。元のMatchは不変のまま。
5. Compile／Preflightをやり直し、固定した相手・World・RulePackage・初期配置・版で再戦する。
6. Before/Afterは勝敗だけでなく、戦線進捗、塔・橋、Heroの損失、視界、CU等を比較。**条件が違う場合は違いを開示**する。

優先順位は既存画面間のリンク強化（案A）→同条件比較の専用UX（案C）。Desktopの巨大な常設多ペイン画面を必須としない。

## U02 — Presetと段階的編集

初回は合法Presetで戦える。通常編集は条件・対象・Actionから入り、Domain Catalog、Scope、継承、Coverage、CU、Traceは必要なときだけ開く（Progressive Disclosure）。Source／No-codeは**同じJinrei言語・Catalog・型と意味論**を使い、片方で表現できない内容を黙って削除しない。Unknown／Not Proven／NOT_CHECKED／Permission Denied／Compiler Errorを区別し、根拠なくCoverage 100%と表示しない。

## U03・A04 — Revision／Experiment／状態

- **Revision**：保存された戦型の版。Hero・Skill・Squad・Jinreiを含む。
- **Experiment**：不変の両Senkei Snapshot、World／RulePackage／Behavior／Programのidentity、初期条件、Enbu／Compiler版、結果・許可済み診断の参照。
- Draft → Validation → Compiled → Preflight READY → Frozen Match Snapshot → Running → Completed／Failed の失効条件を統一する。状態名を固定API名と解釈しない。
- Jinrei、Catalog、World、Hero、Squad、NPC変更では関連するCompile／Preflightを失効させる。純粋な表示設定でEnbu結果を失効させない。
- 実行中にDraftを変更しても、確定したMatchへ混ぜない。保存・Import・Offline・戻りの失敗でDraftを黙って失わない。
- Git型Branch／Merge UI、全面イベントソーシング、マイクロフロントエンドは今回採用しない。既存のFeatureとWorker／WASMを活かす。

## U04・複数端末の扱い

- **Desktop**：戦場を中心にReplay→分析→Jinreiへ文脈付きで遷移。全Paneの常時固定は不要。
- **Mobile Replay**：大きな戦場、再生・停止、シーク、Follow。Details／TimelineはSheetまたは専用画面。
- **Mobile Editor**：No-code中心。SourceはIME／Safe Area／戻る操作を考慮した独立画面。Desktop縮小は禁止。
- Tick・対象・編集中Draftを遷移後も保持する。
- **将来検討のみ**：PC＋Mobileで同じReplayカーソルと選択を同期するセカンドスクリーン。認証・ペアリング・同時編集の競合は未決で、ローカルPvEの開始条件にはしない。

## G01／G03／G04と受入

既存の合法戦型・NPCの差を先に実測し、戦術課題（視界獲得、橋突破、Squad分割等）のPvEと難易度進行を設計する。コアの本拠地破壊条件を局所課題UIの都合で変更しない。試合テンポは**保留**であり、600 Tickは意図した目標値でない。

Quick→実Enbu→Replay→Tick選択→認可済み分析→Jinrei修正→再Compile／Preflight→同条件再戦が実操作で成立すること。元Matchは不変、比較条件の同一性を確認、Mobileの独立操作を検証する。実装・証明のない画面は未完了とする。
