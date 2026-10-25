# Senkei

**Code your strategy. Watch it fight.**

Senkei（戦型）は、プレイヤーが軍備・3レーンへの配置・戦術プログラムを設計し、完全自動の決定論的シミュレーションで戦わせるブラウザ向けストラテジーゲームです。戦術はノーコードでもテキストでも編集でき、敗因の分析・デバッグ・最適化を繰り返すこと自体がゲームプレイになります。

## 提供範囲と状態

この実装の対象は、**ローカル完結のPvE・戦術開発環境**です。ブラウザ内のエディタ、NPCキャンペーン、決定論的な戦闘、公開リプレイとローカル診断、IndexedDBへの保存、キャッシュ済みアセットを使うオフライン再戦を含みます。公式PvP、アカウント、サーバー保存はこの範囲に含みません。

Phase A–DのローカルPvE実装は `main` に取り込み済みです。受入条件と検証状況は [コア検証手順](docs/implementation/CORE-VALIDATION.md)、[受入テスト行列](tests/README.md)、[デリバリー計画](docs/DELIVERY.md)を参照してください。ブランチ上に機能があることだけで、全受入項目の完了を示すものではありません。

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

## Next Senritsu を遊ぶ

ワークスペースの **Next** を開き、12種類（前衛6・後衛6）から5体を選択します。Squad、初期位置、戦闘前のSkill Treeを設定し、既存のJinreiエディタでコンパイルして **Launch local battle** を実行します。3Dリプレイのシーク、HeroのXP・スキル・自分の診断、編成修正、再戦までローカルで完結します。**Save setup** は既存戦型と別の保存領域を使い、JSONの入出力とオフライン復元にも対応します。

`senkei.next` 2.0.0はBattlefield mechanics 2.0.0を要求し、Enbu 1.2.0の有限プリミティブを既存のシミュレーション経路で実行します。35ノード／42エッジの斜めマップ、3トラック、固定橋と渡河、MID観測基地、ノード・エッジ上の戦闘を含みます。`senkei.initial` の結果は既存の回帰ケースで維持しています。規範仕様と統合検証は [Battlefield仕様](docs/BATTLEFIELD.md) と [Battlefield実装・検証記録](docs/implementation/BATTLEFIELD-CANONICAL.md)、暫定値は [Nextパラメータ](docs/implementation/NEXT-PARAMETERS.md) を参照してください。

## ヘッドレス実行

同じバージョン付きルール、Jinreiコンパイラ、Enbuシミュレータを使うローカルCLIもあります。

```sh
cargo run --locked -p senkei-runner -- run examples/local-match.json
cargo run --release --locked -p senkei-runner -- run examples/next-match.json --public-only > next-replay.json
bash scripts/balance/run-next.sh
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
- [次期Senritsu：MOBA型マップ・Minion視界・中立領域](docs/WORLD.md)
- [World Definition／Compiler／Logic・Presentation分離](docs/WORLD-DEFINITION.md)
- [Battlefieldの規範トポロジーと移動・交戦](docs/BATTLEFIELD.md)
- [自律行動・Hero Default／Squad・Army継承](docs/BEHAVIOR.md)
- [Senritsuの自己記述Domain Catalog](docs/DOMAIN-CATALOG.md)
- [Jinrei Editor・Coverage・Decision Trace](docs/JINREI-EDITOR.md)
- [次期Senritsu：Hero・Squad・死亡復活・12体Catalog](docs/UNITS.md)
- [次期Senritsu：通常戦闘・経験値・Skill Tree](docs/COMBAT.md)
- [次期Senritsu：合意済み係数とバランス検証](docs/BALANCE.md)
- [Enbu（演武）：シミュレーション契約](docs/ENBU.md)
- [独自言語・共通IR・CUモデル](docs/TACTICS.md)
- [コンパイル・論理CU・戦闘エンジンの入出力境界](docs/EXECUTION.md)
- [Pixel 3D・プロシージャルアセット・描画設計](docs/GRAPHICS.md)
- [EnbuとRendererのPresentationReplay契約](docs/REPLAY.md)
- [デスクトップ／モバイルUIの情報設計](docs/UI-DESIGN.md)
- [グラフィック実装の分割と検証](docs/GRAPHICS-DELIVERY.md)
- [決定論的シミュレーション・検証](docs/SIMULATION.md)
- [将来の公式PvP・Cloudflare境界](docs/ONLINE.md)
- [実装の順序・受入条件・未決事項](docs/DELIVERY.md)

Hero／Squad／Battlefieldの規範は `senkei.next` 2.0.0に実装しています。旧 `senkei.initial` と `/graphics/` の合成Fixtureは別に維持しています。Battlefield v2の接続・遷移・検証範囲は [統合記録](docs/implementation/BATTLEFIELD-CANONICAL.md)、初期Rulesetの暫定パラメータは [NEXT-PARAMETERS.md](docs/implementation/NEXT-PARAMETERS.md) を参照してください。

## ライセンス

コードとこのリポジトリ内の文書は [Apache License 2.0](LICENSE) を基本とします。将来追加する画像・音楽・商標・第三者素材には個別の権利条件を適用する場合があります。Apache-2.0は名称やロゴの商標使用許諾を意味しません。

## Graphics G1 — サンプル演武

Node.js 24とnpmで起動できます。

```sh
npm ci
npm run dev
```

`http://localhost:5173/graphics/`で固定Replay Fixtureを再生します。サーバーAPI、Enbu、Jinreiは実行しません。WebGL2が必要です。地形・施設・兵士はすべてコードで生成しています。

```sh
npm run contract:types  # JSON Schemaから型を再生成
npm test                # Contract / Player
npm run build           # 型検査 + production build
npx playwright install --with-deps chromium
npm run test:browser    # 実ブラウザ操作・4サイズの画面取得
```

責務は`packages/replay-contract`（Schema・Decoder・Fixture）、`packages/replay-player`（表示状態とカーソル）、`packages/renderer`（Three.js / WebGL2）、`apps/web`（Desktop / Mobile UI）に分離しています。契約の詳細は[Replay v0.1](packages/replay-contract/README.md)、検証結果と画面証拠は[G1検証記録](docs/G1-VERIFICATION.md)を参照してください。Nextワークベンチは実際のEnbu出力を同じRendererへ渡します。[Next画面証拠](docs/evidence/next/README.md) と [12モデルのFixture証拠](docs/evidence/w7/README.md) を参照してください。ハードウェアGPUや実機モバイル性能の検証とは区別しています。新しい [G2 Hero Atelier](docs/HERO-ATELIER.md) の専用展示画面・展示用LODは別の追加トラックで、今回のNextワークベンチだけで完成したとは扱いません。

## G2デザイン・アーキテクチャ合意

G01–Q03の設計方向と保留、探索済みFog、Replay→Jinrei改善ループ、Faceted Low-Poly、旧実装廃止は[設計判断台帳](docs/DESIGN-DECISIONS.md)および[文書索引](docs/README.md)を参照。設計方向の記述は機能完成を意味しない。
