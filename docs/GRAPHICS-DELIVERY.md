# Senkei — グラフィック実装の分割と受入条件

## 1. authorityと分割方針

既存の [COMPONENTS.md](COMPONENTS.md)、[ENBU.md](ENBU.md)、[EXECUTION.md](EXECUTION.md)、[JINREI-GRAMMAR.md](JINREI-GRAMMAR.md) を変更せずに尊重する。描画に関する正本は [GRAPHICS.md](GRAPHICS.md)、[REPLAY.md](REPLAY.md)、[UI-DESIGN.md](UI-DESIGN.md)。

グラフィック実装は**Jinrei・Senritsu・Enbuのローカル実装と独立して進められる**。最初は合成Fixtureから戦場を描画し、Enbuとの実接続は後段とする。初期の目的はサーバーAPIや公式戦を作ることではない。

## 2. 責務に基づくディレクトリ構成案

~~~text
senkei/
├── apps/
│   └── web/                  # UIとユーザーフロー
├── packages/
│   ├── senkei-model/         # 戦型モデル
│   ├── jinrei/               # 戦術コンパイラ・VM
│   ├── senritsu/             # ルールパッケージ
│   ├── enbu/                 # 決定論的シミュレーション
│   ├── replay-contract/      # JSON Schema・fixture・型
│   ├── replay-player/        # デコード・Tick・シーク
│   └── renderer/             # 3D Scene・カメラ・エフェクト
├── assets/
│   ├── sources/              # パラメトリックな生成元
│   ├── generated/            # 生成アセット
│   └── manifests/            # assetKey・出典・ライセンス
├── scenarios/                # NPCと合成の検証用戦闘
├── tools/
│   └── assets/               # 生成・検証ツール
├── tests/
│   ├── conformance/
│   └── visual/
└── docs/
~~~

**言語名でディレクトリを分けない。** package単位の内部実装言語やビルド設定はそのpackageの内部に置く。上記は最終形の責務図であり、初期PRで空ディレクトリを全件追加する指示ではない。

## 3. 依存方向

    (future) Enbu ── PresentationReplay ──┐
    (initial) JSON Fixture ────────────────┤
                                           ▼
                              Replay Contract / Decoder
                                           │
                                           ▼
                                    Replay Player
                                           │
                                           ▼
                                  Read-only View State
                                           │
                                           ▼
                               Scene Adapter / Renderer
                                           │
                                           ▼
                                Desktop / Mobile UI

Rendererの依存元にJinrei・Senritsu・Enbuの内部モジュールを置かない。Replay Contractを唯一の表示データ契約とし、グラフィックの改善によってゲームのルールが変わらないようにする。

## 4. 固定した実装順序

| Stage | 対象 | 完了条件 |
| --- | --- | --- |
| G1 — Vertical Slice | Replay v0.1 JSON Schema＋Fixture、Decoder、最小Replay Player、プロシージャル3D戦場、Pixel 3D、最小操作UI | 合成Fixtureから**実ブラウザ**で3レーン・両陣営・進軍・攻撃・塔破壊を描画。停止・シークが機能 |
| G2 — Art Foundation | 兵科・施設・地形・材質・影の品質、再生成可能なアセットmanifest | 標準俯瞰で各兵科が識別でき、アセット生成・検証が再現可能 |
| G3 — Replay Experience | カメラ追跡、イベント連動演出、タイムライン、戦術オーバーレイ | 選択・巻戻し・速度変更・終局の表示が完全に同期 |
| G4 — Workbench | Desktopの戦場／編集／分析統合とMobile独立UI | 二つの操作モデルで主タスクを完遂できる |
| G5 — Enbu Integration | Enbu出力のAdapter、契約適合・非公開情報の検証 | Fixtureと実出力が同じ契約で描画できる |

**最初のCodexプロンプトはG1のみ。** G2〜G5は同じセッションで開始しない。G1をSchemaだけのPRで終えず、表示される画面・再生操作まで最初の縦断経路として通す。一方、完成版のアート品質、全兵科のモーション、エディタ全体はG1に持ち込まない。

## 5. G1必須の合成Fixtureと表示

- basic-three-lane: TOP/MID/BOT、両本拠地、塔、双方のユニット、最低3種の異なる兵科シルエット、複数Tickの移動。
- clash-and-loss / tower-collapse: 攻撃イベント、確定被害、消滅、塔の損傷・破壊。
- malformed-replay: 不正なschemaVersion、イベント順序、Entity参照を検出。
- dense-armyはG2以降の密集検証対象とし、Fixtureの追加だけならG1で対応してよい。
- 画面には**サンプル戦闘**と明示。Enbu実行済み・正式勝敗・実CUのふりをしない。

最低限の表示操作は、Fixtureロード、再生／停止、シーク、先頭へ戻る、標準カメラへ戻す。未実装の機能を空ボタンとして装飾しない。

## 6. 検証の三つの独立ゲート

**Contract/Correctness**: Schemaの正常/異常Fixture、Tick順、同一Tick全順序、シーク後の表示状態一致をテスト。Enbu依存なし、秘匿情報なし。

**Interaction**: 実ブラウザで再生、停止、シーク、開始へ戻す、カメラ操作、エラー時の復帰を操作。DesktopとMobileで主操作が隠れないこと。

**Visual/Art**: Fixture・Tick・カメラ・描画設定・Viewportを固定し、1920×1080、1440×900、390×844、430×932でスクリーンショットを取得。戦場の主役性、三レーンと陣営の区別、シルエットの識別、ピクセル描画と高解像度UIの分離を目視確認。初期画像を無批判にgolden化しない。

GPU未対応等で描画できない場合は**NOT_CHECKED/BLOCKED_BY_ENVIRONMENT**として明記。ビルド・単体テストが成功してもビジュアル実表示をPASS扱いしない。デザイン確認の指摘は画面位置、観測、影響、最小修正、再確認の証拠で報告する。

## 7. G1のスコープ外

Jinreiの文法・VM、Senritsuの戦闘値やCapability、Enbu本体、公式非同期PvP、認証、ランキング、Cloudflare API、チケット、広告、未許諾アセット、完全なNo-code／Code編集UI。戦闘を実行するふりをするデモ、偽の分析数値、描画結果を戦術計算へフィードバックする構造も対象外。
