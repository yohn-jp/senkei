# G2 デザイン・アーキテクチャ合意台帳

## 位置づけ

ユーザーが選択したG01–Q03の設計方向・保留事項を記録する。「採用」は**設計方向の採用**であり、Schema・数値・実装・受入テストの完了を意味しない。ゲーム規則はWORLD／BATTLEFIELD／COMBAT／BALANCE、実行IdentityはRUNTIME-INTEGRATION-CONTRACTS、描画はGRAPHICS／BATTLEFIELD-VISUAL、操作はUI-DESIGN／JINREI-EDITORの各責務別正本を優先する。

## 設計方向

| ID | 状態 | 合意内容 |
| --- | --- | --- |
| G01 | 方向性採用 | 既存ルール・NPC・戦術の実測を優先。根拠なく新しい戦力補正を追加せず、PvE局所課題を評価する |
| G02 | **採用** | 探索済み不変地形は残す。敵ユニットは視界外で消す。橋など可変状態は最終観測と現在を分離。[詳細](FOG-OF-WAR.md) |
| G03 | **保留** | 戦闘テンポ・上限Tickは実測後に調整。現行600 Tickは意図的な理想試合時間として決定していない |
| G04 | 方向性採用 | 戦術課題型PvE＋段階的難易度を採用方向とする。適応型NPCは今回の必須範囲外 |
| U01 | 方向性採用 | 既存Replay→Analysis→Jinreiの文脈リンクを優先し、同条件Before/After比較を完成目標にする |
| U02 | 方向性採用 | Preset＋Progressive Disclosure。Source／No-codeは同じJinrei意味論・Catalog |
| U03 | 方向性採用 | 戦型Revisionと不変Experimentを区別。Git型のBranch／Merge UIは不要 |
| U04 | 方向性採用 | MobileではReplay観察と編集を独立画面にし、詳細にSheetを使う。Desktopを縦積みにしない |
| V01 | 方向性採用 | Tactical（可読性）とCinematic（鑑賞）を同じRendererの表示モードとし、情報レイヤーを使い分ける |
| V02 | 方向性採用 | Faceted Low-Poly共通のGenerator／部品／材質＋各Hero固有のシルエット |
| V03 | 方向性採用 | 距離と画面上の占有サイズに応じたLOD。描画と戦闘決定性を分離 |
| A01 | 実装基盤あり | Canonical WorldがBattleMapのsourceとなり、versioned projectionとexact resolver validationを使う。Enbu crossing interval消費の適合検証は残る |
| A02 | 実装基盤あり | Worldはcontent-addressed参照。semantic Behavior extensionはRulePackage digestに束縛し、Presentationは別digest、Replay DTOはpaired World／Ruleset identityを持つ |
| A03 | 方向性採用 | Enbu側でPublic／Owner／Restrictedを分離し、認可済みProjectionを各Consumerに渡す。UIで隠すだけは禁止 |
| A04 | 方向性採用 | 共通Draft／Compiled／Preflight／Frozen Match Snapshotの状態と失効を統一 |
| A05 | 方向性採用 | FrontendのFeature責務を整理し、既存canonical処理を使う。マイクロフロントエンド化しない |
| Q01 | 方向性採用 | 固定ケースの回帰＋多戦型マトリクス。決定論的な同一入力反復を勝率標本としない |
| Q02 | 方向性採用 | Contract／Determinism／Journey／Visual／Performance／Gameplayを別に判定 |
| Q03 | **方針変更** | 不要な旧コード・旧UI・旧ガイドは原則**削除**。履歴のためだけのアーカイブはしない。不採用理由に将来の情報価値がある場合だけ記録 |

## 残る決定と評価

- **G03**：600 Tickを理想時間・新しい合格基準としない。調整前に試合進捗を計測する。
- **複数端末**：PCとMobileで同じReplayを閲覧・操作同期する案は**追加検討のみ**。読取専用副画面／Replay同期／双方向編集の選択肢があり、現時点では採用していない。G2ローカルPvEにログイン・ネットワークを強制しない。
- **未決の意味論**：論理地形遮蔽の形状と境界（DEC-TERRAIN-OCCLUSION-001）、攻撃のTick境界（DEC-ATTACK-TIMING-001）、MIDの方向観測根拠（DEC-MID-DIRECTION-001）は引き続き未決定。
- **優先順**：Identity／可視性整合 → 戦術実測と改善ループ → Battlefield／Hero／Mobileの実画面評価 → 戦術課題・Experimentの拡充。
- ローカルPvEの非目標（公式PvP、課金、アカウント）は変更しない。

詳細：[Fog](FOG-OF-WAR.md)、[戦術改善ループ](TACTICAL-LOOP.md)、[Art](ART-DIRECTION.md)、[品質と削除](QUALITY-AND-RETIREMENT.md)。この台帳はG2完成の証明ではない。
