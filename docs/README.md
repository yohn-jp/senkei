# Senkei アーキテクチャ文書

## 正本の範囲

本ディレクトリは、実装に先立って合意された製品・実行モデルの設計正本を保存します。現時点でコードは未実装です。文書内の区分を混同しないでください。

- **確定**: 本プロジェクトの設計制約。変更する場合は文書の意思決定として見直す。
- **推奨**: 実装開始時の合理的な候補。実測・検証で変更可能。
- **未決定**: 会話上まだ確定していないゲームバランス、API、語彙、文法など。勝手に仕様化しない。

## 文書一覧

| 文書 | 担当する設計領域 |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | ユーザー、体験、非目標、学習の導線 |
| [GAMEPLAY.md](GAMEPLAY.md) | 3レーン戦略・兵力・攻守・戦闘ループ |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Local-first、コンポーネント・境界・データ |
| [COMPONENTS.md](COMPONENTS.md) | **名称・責務の正本**: Senkei / Jinrei / Senritsu / Enbu |
| [JINREI.md](JINREI.md) | Jinrei言語コアとルール依存の区別 |
| [SENRITSU.md](SENRITSU.md) | Senritsuのルールパッケージ、拡張と型付きCapability |
| [ENBU.md](ENBU.md) | Enbuの状態遷移、実行境界と結果 |
| [TACTICS.md](TACTICS.md) | ノーコードと生コード、型付きIR、戦術VM、CU |
| [EXECUTION.md](EXECUTION.md) | コンパイル方式、論理CU、物理最適化、戦闘エンジンの入出力・秘匿境界 |
| [SIMULATION.md](SIMULATION.md) | 決定論、実行順序、再現、デバッグ・安全性 |
| [ONLINE.md](ONLINE.md) | 将来の非同期PvP、公式戦、ランキング、Cloudflare |
| [DELIVERY.md](DELIVERY.md) | 実装順・各段階の完了条件・未決定事項 |

## 優先順位

1. 明示的に合意した製品原則と現在の実装範囲。
2. ドメイン・言語・シミュレーションに関する正本。
3. Web UIやインフラの推奨技術。
4. 例示した兵科、数値、名前、アルゴリズム。

数値・コード例は、明示的に確定と書かない限り仕様値ではありません。4名称と責務は [COMPONENTS.md](COMPONENTS.md) を正本とします。Jinreiの表層構文とCU単価は次の設計議論で決めます。

## 変更の作法

契約を変更する実装は、該当する文書も更新します。実装と設計上の将来案を混在させず、将来のAPIやPvPを初期MVPの必須依存として導入しません。仕様文書には日付を埋め込まず、履歴はGitで追跡します。
