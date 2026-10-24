# Senkei

**Code your strategy. Watch it fight.**

Senkei（戦型）は、プレイヤーが軍備・3レーンへの配置・戦術プログラムを設計し、完全自動の決定論的シミュレーションで戦わせるブラウザ向けストラテジーゲームです。戦術はノーコードでもテキストでも編集でき、敗因の分析・デバッグ・最適化を繰り返すこと自体がゲームプレイになります。

## 提供範囲と状態

この実装の対象は、**ローカル完結のPvE・戦術開発環境**です。ブラウザ内のエディタ、NPCキャンペーン、決定論的な戦闘、公開リプレイとローカル診断、IndexedDBへの保存、キャッシュ済みアセットを使うオフライン再戦を含みます。公式PvP、アカウント、サーバー保存はこの範囲に含みません。

この作業ブランチ `impl/phase-a-d` はまだ `main` にマージされていません。受入条件と検証状況は [コア検証手順](docs/implementation/CORE-VALIDATION.md)、[受入テスト行列](tests/README.md)、[デリバリー計画](docs/DELIVERY.md)を参照してください。ブランチ上に機能があることだけで、全受入項目の完了を示すものではありません。

## ローカルで起動する

必要な環境は Node.js 20.19以上または22.12以上、Rust stable/Cargo、Rust target `wasm32-unknown-unknown`、LLVM LLDの `wasm-ld` です。WASMビルドスクリプトは不足しているRust targetを追加し、Nix環境では不足したLLDを `nix-shell -p lld` で用意します。

リポジトリのルートで、本番ビルドを作ってプレビューします。

```sh
npm ci
bash scripts/wasm/build.sh
npm run build
npm run preview
```

プレビュー画面で一度アセットを読み込むと、サービスワーカーがアプリとWASMをローカルにキャッシュします。オフライン再戦の対象はこの本番プレビューです。`npm run dev` はUI開発用で、オフライン動作の検証対象ではありません。ブラウザ契約とキャッシュ境界は [WEB-API.md](docs/implementation/WEB-API.md)、WASMビルド手順は [scripts/wasm/README.md](scripts/wasm/README.md)を参照してください。

## ヘッドレス実行

同じ初期ルールセット、Jinreiコンパイラ、Enbuシミュレータを使うローカルCLIもあります。

```sh
cargo run --locked -p senkei-runner -- run examples/local-match.json
```

公開結果とリプレイだけを出力するには `--public-only` を追加します。入力と検証の詳細は [CORE-VALIDATION.md](docs/implementation/CORE-VALIDATION.md)を参照してください。

## 設計文書

- [文書索引と合意状況](docs/README.md)
- [製品ビジョン・体験](docs/PRODUCT.md)
- [戦場・ゲームループ](docs/GAMEPLAY.md)
- [システムアーキテクチャ](docs/ARCHITECTURE.md)
- [4コンポーネントの名称と責務（正本）](docs/COMPONENTS.md)
- [Jinrei（陣令）：戦術言語とルールの境界](docs/JINREI.md)
- [Jinrei規範文法・三値論理・集合演算](docs/JINREI-GRAMMAR.md)
- [Senritsu（戦律）：ルールセット契約](docs/SENRITSU.md)
- [Enbu（演武）：シミュレーション契約](docs/ENBU.md)
- [独自言語・共通IR・CUモデル](docs/TACTICS.md)
- [コンパイル・論理CU・戦闘エンジンの入出力境界](docs/EXECUTION.md)
- [決定論的シミュレーション・検証](docs/SIMULATION.md)
- [将来の公式PvP・Cloudflare境界](docs/ONLINE.md)
- [実装の順序・受入条件・未決事項](docs/DELIVERY.md)

## ライセンス

コードとこのリポジトリ内の文書は [Apache License 2.0](LICENSE) を基本とします。将来追加する画像・音楽・商標・第三者素材には個別の権利条件を適用する場合があります。Apache-2.0は名称やロゴの商標使用許諾を意味しません。
