# Senkei

**Code your strategy. Watch it fight.**

Senkei（戦型）は、プレイヤーが軍備・3レーンへの配置・戦術プログラムを設計し、完全自動の決定論的シミュレーションで戦わせるブラウザ向けストラテジーゲームです。戦術はノーコードでもテキストでも編集でき、敗因の分析・デバッグ・最適化を繰り返すこと自体がゲームプレイになります。

## プロジェクトの現在の範囲

最初の製品は**ローカル完結のPvE・戦術開発環境**です。オフラインのブラウザ内で戦術を編集し、NPCに何度でも挑戦し、リプレイとCU（戦術計算資源）のプロファイルを確認できることを目指します。オンラインの公式非同期PvP、チケット、レートは将来の追加機能であり、初期段階の依存要件ではありません。

- Senkei（戦型）・Jinrei（陣令）・Senritsu（戦律）・Enbu（演武）に責務分離したRust製コア
- WebAssemblyで実行するブラウザ内シミュレーション
- TypeScriptを中心とするノーコード／テキストの戦術編集UI
- IndexedDB等へのローカル保存と戦術バージョン管理
- 後日、公式戦のみをサーバーで権威的に実行できる独立した境界

**本リポジトリは設計段階です。READMEや設計文書は実装済み機能を意味しません。**

## 設計文書

- [文書索引と合意状況](docs/README.md)
- [製品ビジョン・体験](docs/PRODUCT.md)
- [戦場・ゲームループ](docs/GAMEPLAY.md)
- [システムアーキテクチャ](docs/ARCHITECTURE.md)
- [4コンポーネントの名称と責務（正本）](docs/COMPONENTS.md)
- [Jinrei（陣令）：戦術言語とルールの境界](docs/JINREI.md)
- [Senritsu（戦律）：ルールセット契約](docs/SENRITSU.md)
- [Enbu（演武）：シミュレーション契約](docs/ENBU.md)
- [独自言語・共通IR・CUモデル](docs/TACTICS.md)
- [コンパイル・論理CU・戦闘エンジンの入出力境界](docs/EXECUTION.md)
- [決定論的シミュレーション・検証](docs/SIMULATION.md)
- [将来の公式PvP・Cloudflare境界](docs/ONLINE.md)
- [実装の順序・受入条件・未決事項](docs/DELIVERY.md)

## ライセンス

コードとこのリポジトリ内の文書は [Apache License 2.0](LICENSE) を基本とします。将来追加する画像・音楽・商標・第三者素材には個別の権利条件を適用する場合があります。Apache-2.0は名称やロゴの商標使用許諾を意味しません。
