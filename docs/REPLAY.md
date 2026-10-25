# PresentationReplay — Enbuと描画の契約

## 1. 境界とauthority

Enbuは二つのSenkeiとSenritsuから戦闘結果を決定論的に計算し、**描画を許可された戦場状態・イベントだけ**をPresentationReplayに投影する。この文書はその意味・時間・可視性の契約であってHTTP APIの設計ではない。

- **Producer**: Enbuの許可リスト方式のPresentation Projection。
- **Consumers**: Replay Decoder、Replay Player、Scene Adapter、Renderer。いずれも戦闘の再計算をしない。
- **除外**: Jinreiソース／IR／バイトコード、RestrictedDiagnostics、秘密の戦術メモリ、ReproductionContext。
- **初期開発**: Enbuを待たず、仕様に従う合成Fixtureを入力にRendererを実装する。
- 設計の上位契約は [COMPONENTS.md](COMPONENTS.md)、[ENBU.md](ENBU.md)、[ONLINE.md](ONLINE.md)、[EXECUTION.md](EXECUTION.md)。

## 2. 言語非依存のSchema

初期の採用方式は**JSON Schemaをデータ契約の正本としたJSON Fixture**。必要なRust／TypeScriptの型はスキーマとの一致を検証し、言語ごとに意味が異なる独自モデルを作らない。JSON Schema単独では表現できない整列・状態復元・権限の意味は規範テストで保証する。

| 論理セクション | 必要情報 |
| --- | --- |
| Header | schemaVersion、出力由来（sample／official等）、Enbu版、RulePackageのID／version／digest、paired World identity、観測ビュー種別 |
| Scene | 描画に許可された地形、レーン、中立地点、Senritsuの通行可能経路、施設、本拠地等の初期構造 |
| InitialView | プレゼンテーションID、所属、表示種別、位置、見えている初期状態 |
| Timeline | Tick、同一Tickの全順序キー、許可されたイベント |
| Checkpoints | 任意Tickの表示状態（必要に応じて） |
| Result | 公開可能な勝敗、終局理由、終局Tick |
| Presentation metadata | 表示の座標規約、appearanceKey、アセットカタログ版 |

Replay 0.3では、`header.ruleset` が `ruleset_id`／version／digestを持ち、`header.world` がWorld ID、schema/compiler compatibility、validation profile、logic digest、presentation digestを持つ。Enbu Replay、RulePackage、BattleMapのpaired World identityが完全一致しないNext Replayは拒否する。旧sample Fixtureはidentityを持たない形でも読み込めるが、official／local Replay 0.3では省略できない。

## 3. 座標・時間とイベント

- 論理的なWorldPoint（戦場平面上の位置）を、Renderer側のScene AdapterがThree.jsの3D座標・高度へ変換する。戦律の射程や命中をRendererで再計算しない。
- 3レーンは最初のSenritsuのScene内容であり、Replay Schema自体へ「3本しかない」をハードコードしない。
- Nextの `scene.routes` はSenritsuの通行可能なMap edgeと実World node座標の投影である。Rendererはこのグラフを移動ルールとして再計算せず、存在しない橋・近道・経路をSceneへ追加しない。旧Replayでは任意項目として省略できる。
- 任意の `scene.baseSites` は公開Worldの本拠地所在地（id・陣営・座標）だけを投影する。所在地の既知性は施設の生存・HP・視認を意味しない。未観測時は状態不明の地図注記に限り、施設の現在状態・破壊確認は観測可能なReplayの事実から表示する。旧Replayは省略でき、非公開の敵状態をこの項目に入れない。
- 時刻は**整数Tick＋同一Tick内の規範的順序**。描画FPS、演出ミリ秒、再生速度と切り離す。
- 再生、巻き戻し、直接シークは同じ確定状態へ戻る。Checkpointの使用有無によって結果を変えない。
- 出現・移動・攻撃Cue・被害による確定状態変化・破壊・非表示化・終局を意味イベントとして提供する。
- イベントにモデルのGLBファイル名やTypeScript関数、未観測の座標、Jinrei内部ルールIDを埋め込まない。

| イベント群 | 表示で担う役割 |
| --- | --- |
| spawn / appear | 観測可能なEntityの生成／登場 |
| move / position | 位置の変更・補間可能な移動区間 |
| attack / act | 行動・攻撃の演出Cue（ダメージの再計算なし） |
| damage / state | 実際に確定した耐久値等の可視状態 |
| destroy / disappear | 破壊・死亡・視界外などを区別して表示 |
| match-end | 許可された終局結果 |

不明なschemaVersion、同一Tick順序キーの衝突、存在しない対象への参照、前後関係が不正なイベントは検証エラーにする。表示用識別子は内部Entity IDや秘密のJinrei状態を含まない。

## 4. Replay Playerの責務

- 初期表示状態とイベント列から、指定Tickの**read-only Display State**を構築する。
- 再生／一時停止、速度変更、任意Tickへのシーク、開始位置へ戻る操作を扱う。
- 任意Tickへシークした表示状態が、0から順再生した同Tickと一致することを保証する。
- シーク・再生中の選択対象消失を安全に扱い、描画側へ不正なEntity参照を残さない。
- 描画の補間やパーティクルの時間はRendererが扱う。Replay Playerが戦闘判定を再計算しない。
- 未対応データのときは勝手に修正せず、理由を示して再生を停止する。

## 5. 秘匿性

**探索記憶と情報鮮度**は [FOG-OF-WAR.md](FOG-OF-WAR.md) に従う。現在Visible、探索済み不変地形、未探索を分離し、視界外の敵ユニットを表示しない。橋の最終観測は現在Knownではない。順再生と直接シークで同Tickの探索記憶・現在Viewが一致すること。公開される静的施設位置は現在HP／破壊／所有を意味しない。



公開Replayは**許可リスト方式で生成**する。内部診断トレースをまるごと出力してからクライアント側で隠す方式は禁止する。相手の非公開Jinreiソース、IR、条件、戦術メモリ、内部CU内訳、未観測状態を含めない。

EnbuはPublic Replayと、Attacker／Defender別のOwner Replayを分けて生成する。Owner Replayはその陣営の現在認可済みViewとFog履歴を持つ。Public ReplayはFog履歴やOwner-only fieldを持たない。RestrictedDiagnosticsは別の認可経路であり、ローカルworkerではOwner Replayの返却をRestrictedDiagnosticsを要求したsimulation responseに限定する。

自軍のCU・ルール発火等の分析は別のRestrictedDiagnostics契約を経由し、可視権限を検証する。Default/Inherited/Explicitの行動根拠、候補の採否、拒否理由、CU等を含むDecision Traceは [BEHAVIOR.md](BEHAVIOR.md) で定義する**認可済み内部診断**であり、公開PresentationReplayへ埋め込まない。Editorへの現在観測値も同じ権限境界を維持する。リプレイの挙動から相手の戦術を推測される可能性は残るが、直接ソースを配布してはならない。

## 6. 最初に実装するFixtureと適合テスト

| Fixture | 意図 |
| --- | --- |
| basic-three-lane | 三レーン・双方の本拠地・塔・複数兵科・移動 |
| clash-and-loss | 同Tickの攻撃・被害・消失、確定順序 |
| tower-collapse | 塔の段階的な損傷と破壊 |
| dense-army | 100体相当の表示・性能検証 |
| malformed-replay | 不正schemaVersion、順序、参照、必須値 |

すべて**合成のサンプルデータ**であり、正式なSenritsuの兵科数値・Enbuの勝敗計算結果ではない。

実装受入: Schema正常例を受理し異常例を拒否、同Tick順序を固定、シークと順再生のDisplay State一致、RendererはEnbuから独立してFixtureで動作、公開Replayに内部情報フィールドがない、再生をHTTP/Cloudflareへ結びつけない。

## 7. Jinrei Editor / Decision Coverageとの境界

- [DOMAIN-CATALOG.md](DOMAIN-CATALOG.md) は観測フィールド・型・可視性の静的な正本。実際の値は同じRulePackageとTickの**陣営別Observation**からのみ取得する。
- [JINREI-EDITOR.md](JINREI-EDITOR.md) のDefault／Effective／Observed比較のうち、Observedは正しいMatch／Tick／Program digestを持つ**認可済みRestrictedDiagnostics**から取得する。
- 敵側の非公開Jinrei、内部Decision Trace、予定目的地、観測できなかった現在位置を、ReplayのEntityやUIの補間から推定して公開しない。
- World Presentationは [WORLD-DEFINITION.md](WORLD-DEFINITION.md) の専用Digestで識別できるが、描画位置・LOD・CameraによってReplayの確定戦闘結果が変わってはならない。
