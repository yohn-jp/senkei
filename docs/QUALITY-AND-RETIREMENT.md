# G2 品質ゲート・旧実装廃止方針

## Q01・Q02 — 別々の品質証拠

| ゲート | 検証対象 | 代用できないもの |
| --- | --- | --- |
| Contract | Schema、Identity、認可、互換性 | 実際の戦術の面白さ |
| Determinism | Native／WASM、repeat、CU／結果Digest | 別戦型間の相性 |
| Journey | Quick、Custom、Preflight、保存、Replay、再戦 | 美術完成 |
| Visual | Battlefield、Hero、Fogの実画面での見え方 | green CIだけの美観PASS |
| Performance | Tick性能、FPS、メモリ、実GPU | SwiftShaderのPASS |
| Gameplay | 固定ケース＋多戦型マトリクスのトレードオフ | 同一入力の反復を勝率とみなすこと |

既存CI／Playwright／Rust／WASM検証を再利用し、重いBrowserテストは検証単位で分割し、共有ビルドを活用する。Assertionや権限チェックを緩めて高速化しない。未実施の実機GPU／タッチ／IME／造形の目視評価はNOT_CHECKED。

CIの証拠は次の単位で読む。`Native Rust build and tests`と`Web application build`はContract／型・ロジック回帰、`Native and real WebAssembly conformance`はDeterminism、browser shardの`journeys`はJourney、`verification-*`と`visual-*`はそれぞれ実行・画面の別証拠、Next scenario reportはGameplayの固定ケース証拠である。Visual shardはChromium/SwiftShaderのソフトウェア描画を用いるため、GPU性能の根拠にしない。CIはハードウェア性能受入を行わず、その判定はNOT_CHECKED。

**G01**：合法戦型の結果差をまず計測。**G03保留**：現行の600 TickとDraw600は単なる観測値であり、意図的な理想試合時間と解釈しない。**G04**：戦術課題型PvEと難易度進行を組み合わせる。数値調整にはSenritsuの版／Digestと複数シナリオの実測が必要。

## Q03 — 原則削除

**以前実装した、という理由やアーカイブのためだけに旧コード・旧画面・旧Fixture・旧ガイドを残さない。**

1. 現行Ruleset、製品導線、Runtime、生成器、受入条件から実依存を照合する。
2. 必要性を具体的に証明できない旧互換・旧画面・旧レシピは削除対象にする。
3. 現在の正本と矛盾する旧ガイドを、優先順位注記だけで永続的に保持しない。
4. 削除には依存修正と回帰検証が必要。本書は**削除済みを意味しない**。今回の文書変更ではコードを削除しない。

## 例外：不採用判断に情報価値がある場合

残すのは成果物のアーカイブではなく、**不採用案／拒否した具体的な理由／採用した代替／再検討条件**のみ。

例：Desktopを縦積みにしたMobile UIは独立した操作体験を満たさない。内部秘密を全部送ってUIだけで隠す方法は認可境界に反する。初期G1ジオラマを広い三レーン戦場の最終品質として採用しない。

検証していない案を「失敗した」と断定しない。単なる経緯や旧ファイル全体を保管せず、Gitの変更履歴に委ねる。記録自体が将来の意思決定に役立たない場合は保存しない。

## 完了判定

設計方向、実装、動作検証、視覚・実機受入を別々に報告する。文書の完成をコード完成やリリース可否の根拠にしない。
