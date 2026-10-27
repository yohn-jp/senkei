# システムアーキテクチャ

## 1. 最優先の境界（確定）

**最初は完全ローカルで動く。** ブラウザ上でPvE・編集・コンパイル・戦闘・デバッグ・ベンチマークが成立し、アカウント・サーバーAPI・ネット接続を必要としない構成を目標とします。静的アセットの初回取得と、その後のオフライン実行は区別します。

Senritsu（戦律）のルール定義、Jinrei（陣令）の戦術コンパイラ・VM、Enbu（演武）の決定論的シミュレーションは異なる責務です。公式PvP追加時は、同じ戦闘意味論を権威的なサーバーで実行します。

## 2. 論理コンポーネント

    Browser (local-first)
      ├─ Visual Tactics Editor ───────┐
      ├─ Text Tactics Editor ─────────┤
      ├─ Army / Lane Editor           │
      ├─ Debugger / Replay / Profiler │
      ├─ Local Persistence            │
      └─ Web Worker                   │
           └─ Rust / WASM Runtime <──────┘
                ├─ Senritsu: Versioned Rules + Domain Schema
                ├─ Jinrei: Parser / Types / Costed IR / VM
                └─ Enbu: Tick / State / Transitions / Results
                            ├─ MatchResult
                            ├─ PresentationReplay
                            └─ RestrictedDiagnostics

    Future only: Cloudflare-hosted official battle authority
      ├─ API / Authentication / Ranked Admission
      ├─ Defender snapshots / Matches / Tickets
      ├─ Authoritative core execution
      └─ Rating, persistence, replay distribution

データフローは Senkei編集 → Jinrei解析・型検査（Senritsuスキーマを参照）→ Typed IR → Costed IR → 専用バイトコード → Jinrei VM（Enbuから呼び出す）→ Enbuのルール遷移 → 結果・リプレイ生成です。UIは勝敗計算を所有せず、コアが唯一のゲーム規則を実装します。Rustで実装したVM自体をWASMへコンパイルするのであって、戦術コードを直接WASMへ変換しません。完全な実行契約は [EXECUTION.md](EXECUTION.md) に定義します。

## 3. 技術選択

| 対象 | 方針 | 状態 |
| --- | --- | --- |
| Jinreiコンパイラ・VM、Enbu実行エンジン | Rust | 推奨 |
| Senritsuルールパッケージ | 型付き・検証済みデータと有限の遷移プリミティブ | 確定方向 |
| ブラウザ内エンジン | RustをWebAssemblyへコンパイル | 確定方向 |
| UI・エディタ | TypeScript / React | 推奨 |
| メインスレッドからの隔離 | Web Worker | 推奨 |
| ローカル永続化 | IndexedDB | 推奨 |
| 静的配信 | Cloudflareの静的アセット配信 | 推奨、初期開発の依存先ではない |
| オンライン公式戦 | サーバー権威実行。ネイティブRust常駐ワーカーを第一候補として測定 | 将来 |
| オンライン管理基盤 | Cloudflareを候補にするがコアはプロバイダ非依存 | 将来 |

Web WorkerとWASMの間のAPIは型付きのバージョン付きデータ契約にします。UIで配列を直接変更してエンジン内部状態を書き換えることは許しません。

## 4. ソース構造（提案。必要に応じて統合可）

    apps/
      web/               # Desktop/Mobileのブラウザアプリ
      server/            # 将来の公式戦だけ（初期には作らない）
    packages/
      senkei-model/      # 戦型データ・不変入力
      jinrei/            # 戦術言語・VM
      senritsu/          # ルールパッケージ
      enbu/              # 決定論的演武
      wasm-adapter/      # ブラウザ用ランタイム境界
      replay-contract/   # 表示データSchemaとFixtures
      replay-player/     # 再生・停止・シーク
      renderer/          # 3D戦場・ユニット・カメラ・演出
    assets/
      sources/           # 生成元と造形パラメータ
      generated/         # 生成物
      manifests/         # 素材の出典・ライセンス
    scenarios/           # NPC戦・合成検証ケース
    specs/               # バージョン別の言語・ルール・CU仕様
    tests/
      determinism/
      conformance/
      visual/
      balance/

ディレクトリは言語別ではなく責務別とし、Cargo workspace・npm workspace等は各パッケージの実装事情で構成します。空のモジュールを最初から量産しません。Senritsuの型付きパッケージをJinreiコンパイラとEnbuがそれぞれ検証・利用し、EnbuはJinreiの実行ポートだけを呼ぶようにします。言語のパーサ／コンパイラとEnbuのワールド遷移を循環依存させず、戦闘コアがブラウザやCloudflareのAPIをインポートしないことを優先します。パッケージ間の詳細契約は [COMPONENTS.md](COMPONENTS.md) が正本です。

## 5. ストレージとバージョン（確定原則）

- 戦術コードだけでなく、構造化された戦術表現・設定・軍備・テストケースを保存する。
- ローカルに戦術のバージョンを持ち、差分、復元、テスト結果を関連付ける。
- シリアライズはスキーマ版を明示し、不明な版を暗黙に受け入れない。
- エンジン版、ルールセット版、言語版、CUコスト表版を分けて管理可能にする。
- 他ブラウザや将来の公式サーバーへ運べる可搬なインポート／エクスポート形式を設ける。

## 6. 依存性とセキュリティ

- PvE実行時にネットワークAPIや認証を要求しない。
- テキスト戦術は外部コードとして評価せず、定義されたDSLをコンパイル・検証・実行する。
- DOM、ネットワーク、ホスト時刻、ファイルシステム、任意乱数、システム呼出しへの戦術プログラムからのアクセスは提供しない。
- データ入力のサイズ、構造深度、式評価回数、状態領域、最大Tickを検証する。
- ブラウザ内の対戦結果は自動的に公式ランキングの根拠としない。

## 7. 性能上の実務判断

大量のローカルテストをUIスレッドで同期実行しない。再現可能なイベントログと戦闘状態のスナップショットを分け、ログ全量保持によるメモリ肥大を回避する。性能と表示忠実度は計測して選ぶ。GPU計算・並列化は決定論を損なわない範囲で検討し、初期必須条件にはしません。

## 8. エンジンの境界（確定）

Enbuは、検証済み攻撃戦型・防衛戦型と不変のSenritsu／戦場定義を入力し、完全自動で計算を完了して結果と描画用イベントを返す。対戦申請、チケット、レーティング、データ永続化、描画は担当しない。内部戦闘状態は試合中だけ保持し、永続的なネットワークセッションは要求しない。

ブラウザ側はローカルPvEでは同じWASMコアを実行する。将来の公開戦はサーバーが同じ意味論を権威実行し、クライアントは戦闘結果と表示を許されたイベントを再生する。対戦相手の非公開IRを描画のために配布しない。内部トレースと公開リプレイは別データ契約にする。

## 9. 表示系の独立コンポーネント（確定境界）

Enbuの結果から、ゲームロジックと分離したバージョン付きの`PresentationReplay`を生成し、`Replay Decoder → Replay Player → read-only View State → Scene Adapter → Renderer`の順に消費する。**これはHTTP APIではなくデータ契約**。RendererはEnbu、Jinrei、Senritsuの内部実装に依存せず、勝敗やダメージを再計算しない。

画風はプロシージャル3D＋Pixel 3D（[GRAPHICS.md](GRAPHICS.md)）を第一候補とし、データ契約は [REPLAY.md](REPLAY.md)、Desktop/Mobile UIは [UI-DESIGN.md](UI-DESIGN.md) に分離する。Replay Schemaと固定Fixtureにより、Enbu完成前でも描画を独立実装・テストできる。初期のG1範囲は [GRAPHICS-DELIVERY.md](GRAPHICS-DELIVERY.md) による。

## 10. 宣言的World・Behavior・自己記述Catalogの契約

本製品における追加の長期責務境界は次のとおり。

~~~text
World Definition → Validator / Compiler
                    ├─ Canonical Simulation World + Logic Digest → Senritsu / Enbu
                    └─ Canonical Presentation World + Presentation Digest → Renderer

Senritsu RulePackage → Typed Public Domain Catalog → Jinrei Compiler / Editor
                    → RulePlan → Enbu

Hero Default + Army/Squad profiles + Jinrei Intent → Senritsu arbitration → Enbu
Enbu authorized Observation → Editor current values
Enbu restricted Decision Trace → owner/editor analysis
Enbu PresentationReplay → public-authorized Renderer
~~~

[WORLD-DEFINITION.md](WORLD-DEFINITION.md)、[BEHAVIOR.md](BEHAVIOR.md)、[DOMAIN-CATALOG.md](DOMAIN-CATALOG.md)、[JINREI-EDITOR.md](JINREI-EDITOR.md) が詳細正本。定義ファイルと実行コードを分離するが、**新しいゲームルール用スクリプト言語は導入しない**。Jinrei v0.1を変えず、RulePackageのCatalogから型とCapabilityを共有する。

Worldの表示だけが変更された場合はLogic Digest・Enbu結果・CUを維持し、Presentation Digestだけ変化させる。非公開の状態／戦術TraceをRenderer・他陣営のEditorへ送ることは禁止する。

## ローカル試行資産と公式資産

ローカルPvEはオフラインで自由実行できる。ローカル試行資産はExperimentと独立した版付きRepositoryに保存し、公式資産の所有・取得・決済とは権威を分離する。公式資産は将来の権威サービスが検証したレコードだけを取り込む。サービス未接続を成功と表示せず、署名形式・認証基盤・Cloudflare実装の新規採用を前提にしない。
