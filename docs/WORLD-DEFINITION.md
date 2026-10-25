# WORLD-DEFINITION — 宣言的World定義・Compiler・不変Runtime契約

## 1. 位置づけ・正本

本書はSenkeiの**World Definition → World Compiler → Canonical World**のアーキテクチャ正本。世界の値とエンジンコードを分離し、複数World、バランス調整、将来のWorld Editor、描画改善を同じ契約で扱う。

- [BATTLEFIELD.md](BATTLEFIELD.md) は初期Worldのノード・エッジ・距離・橋・交戦ルールの正本、[WORLD.md](WORLD.md) は地形・視界のゲームデザイン、[SENRITSU.md](SENRITSU.md) はRulePackage、[ENBU.md](ENBU.md) は実行意味論の正本。各成果物間のID・digest・互換性・変換は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) が横断正本。
- [BATTLEFIELD-VISUAL.md](BATTLEFIELD-VISUAL.md)／[GRAPHICS.md](GRAPHICS.md) は美術・視覚受入、[REPLAY.md](REPLAY.md) は表示投影の権限境界。
- **確定**：コードと値を分離したSchema検証済みの宣言的WorldをCompileする。World定義をRustのノード生成関数としてハードコードし続けない。
- **未固定**：入力ファイルのYAML/JSON等の表層形式、ファイル分割数、Rustの具体的モジュール名、World EditorのUI。新しい独自DSLは要求しない。

## 2. 4つの論理レイヤー

| レイヤー | 典型フィールド | 正本の責務 | 変更の影響 |
| --- | --- | --- | --- |
| **Topology** | worldId、nodeId、edgeId、endpoints、allegiance、固定橋・キャンプ・基地 | 何がどこにつながり、どこから進入できるか | ルール・経路・戦術 |
| **Metric** | logicalLengthWU、edgeProgress、trackSet、交差点・渡河の論理区間 | 距離、射程、移動の合法性、通過位置 | ルール・Tick・戦術 |
| **Terrain semantics** | terrainProfileId、論理遮蔽、索敵領域、地形効果への参照 | 移動・観測・戦闘に影響する型付き地形 | ルール・観測 |
| **Presentation** | viewPosition、curve、elevation、roadVisualWidth、foliage、materials、lighting | 地形の形と画面上の配置 | 表示のみ |

**4レイヤーはSchema上の区別**であり、必ず4ファイルにする意味ではない。Worldの記述は静的なインスタンス定義、Senritsuは有効なRulePlanと遷移・効果を定義する。地形値 `jungle` を参照しても、移動倍率やCUをRendererまたはWorld定義だけが決めてはならない。

特に、Geometryは「論理距離と1:1のスケール」ではない。視覚上の**相対的な比率と地理的な意味**を保つ。ノードの前後関係・レーン分離・川の交差・キャンプの枝道・進軍方向が理解できれば、画面用曲線とWUは同じ実距離でなくてよい。実距離を使った速度・射程・視界の再計算はしない。

## 3. 一方向のデータフロー

~~~text
Authored World Definition (宣言データ)
    ├─ Topology + Metric + Terrain references ──┐
    └─ Presentation definition ─────────────────┤
                                                  ▼
                         World Compiler / Validator
                             ├─ Canonical Simulation World + worldLogicDigest
                             └─ Canonical Presentation World + worldPresentationDigest

Canonical Simulation World + explicit lossless BattleMap projection
    + Senritsu RulePackage bound to WorldIdentity
    → validated RulePlan / observations / Capability catalog
    → Enbu (権威的なTick遷移)
    → authorized PresentationReplay
    → presentation adapter (+ approved static scene definition)
    → Three.js Renderer
~~~

- **Compile**は型検査・正規化・参照解決・構造検証・安定した成果物生成だけを行う。マップ独自の任意コード、Jinrei実行、ゲームTick進行、ルールの暗黙導出をしない。
- **Enbu**はCanonical Simulation WorldとSenritsuのRulePlanで通行・射程・視界を確定する。地形Meshの当たり判定やThree.js Raycastへ依存しない。
- **Renderer**は許可されたReplayとPresentation Worldを表示する。未観測敵・橋状態・目標位置をPresentationから推測しない。
- Compilerの成果物は**明示的な同一World identity**に結び付く。片側だけ別世代の成果物をロードしない。RulePackage/RulePlan、BattleMap投影、PresentationReplayへの受け渡しに必要な参照と変換の正本は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) とする。

## 4. Authoring ModelとValidator

World Definitionには最低限以下を要求する。

1. World ID／schemaVersion／compatibility、静的ノードとエッジの一意ID、端点の存在と属性、有限な距離、合法なregion/terrain参照。
2. ルール上許された進入・退出、橋サイトと河川交差、トラック範囲、観測遮蔽の型・参照、到達不能領域と意図しないショートカットの検出。論理遮蔽の具体的な形状・問い合わせ意味論は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) の `DEC-TERRAIN-OCCLUSION-001` が未決定として管理し、Presentation形状から補完しない。
3. コンテンツは**固定された有限集合**。同じDefinitionでコンパイル順・HashMap列挙順・OS・Rust/WASM実行環境に依存しない。
4. Worldの静的所属と動的占領／Unit位置を分ける。静的なNノードをMID占領によって別属性へ書き換えない。
5. Presentation側の全ノード・全経路の参照整合、意図した河川と固定渡河との交差、画面外への逸脱・視覚交差による架空の経路の検出。
6. 双方の対称性や3レーン・キャンプ数のような**初期World固有の規範**は [BATTLEFIELD.md](BATTLEFIELD.md) の版付きWorld Validation Profileで検査する。汎用Compilerに「常に3レーン」とハードコードしない。

不正DefinitionはCompilerのエラーとする。黙って不足ノードを作成、経路を自動接続、仕様外の値を推定、既定パラメータで上書きすることは禁止する。

### 記述形式の概念例（正式なシリアライズSchemaではない）

~~~yaml
world:
  id: senkei-battlefield
topology:
  nodes:
    A.TOP.J: { allegiance: A, kind: lane_junction }
    N.A.UJ: { allegiance: N, kind: jungle_junction }
  edges:
    - { id: jungle.a.top-upper, from: A.TOP.J, to: N.A.UJ }
metric:
  edgeLengthsWU: { jungle.a.top-upper: 325 }
terrain:
  edgeProfiles: { jungle.a.top-upper: jungle }
presentation:
  nodePositions: { A.TOP.J: [120, 230], N.A.UJ: [155, 190] }
  visualRegions: { upperJungle: forest_region }
~~~

例中の座標、ID構造、ファイル形式は設計説明であり、実行可能な現在のファイル・完成Schemaを主張しない。

## 5. ルール数値とWorld値の分離

- `edge.length=325 WU` のような**World固有の論理距離**はMetricへ置く。
- `terrain=jungle` はWorldの地形分類。**速度×0.80、被ダメ倍率、Minion視界×1.20、Skill適応**の演算式と係数はSenritsuの版付きTerrain/Skill Profileに置く。既存合意の値は[BALANCE.md](BALANCE.md)に従う。
- 森林の樹木密度・川面の色・曲線の制御点はPresentationへ置く。描画用の変化はRulePlanと戦闘結果を変更しない。
- **視界の遮蔽や高台の索敵補正**はゲーム上の観測を変えるので、装飾でなくTerrain semanticsとRulePlanの入力。Presentationへだけ書いてもルールには影響しない。
- コードには生成・検証・解釈のアルゴリズムを置き、個々のWorldノード・距離・地形を重複した定数テーブルとして埋め込まない。

## 6. 識別子・Digest・互換性

| 成果物 | 内容に含むもの | 影響 |
| --- | --- | --- |
| **worldLogicDigest** | Topology、Metric、Terrain semantics、地形Profile等の安定した参照ID（RulePackage digestは含めない） | Enbu再現性・戦術適合性 |
| **worldPresentationDigest** | 描画用座標・曲線・地形形状・外観パラメータ | Renderer・視覚回帰 |
| **RulePackage digest** | Senritsuの完全な規則と、それが消費する検証済みLogic identity | 対戦・CU・観測の同一性 |

- Worldのpaired identityは `world_id`、schema version、compiler compatibility bounds、任意のvalidation-profile ID/version、`worldLogicDigest`、`worldPresentationDigest`で成立する。個々のdigest単独ではWorld ID・schema・compatibilityを代用しない。
- DigestはCanonical Serializationで計算し、識別に入力ファイルのコメント・key順・無関係な書式差を使わない。World LogicはRulePackageの完全Digestへ依存させず、RulePackageがWorld Logic identityを参照する一方向の関係とする。RulePackageをRulePlanへ検証・正規化した後も、その完全なpackage identityとWorld referenceを保持する。
- **Presentation-onlyの変更ではworldLogicDigestと同じ試合の結果・CU・論理軌跡を変えてはならない。** Presentation変更によりworldPresentationDigestは変わる。
- Logic変更は適合性確認とRulePackageの互換性識別を更新する。古いJinreiを同じルールとして黙って流用しない。WorldからBattleMapへの変換はID・橋／河川の範囲・経路・施設の意味を失う場合に成功扱いせず、明示的な版付きマッピングを要求する。exact identityと損失のない変換条件は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) が正本。
- 公開Replayは許可されたWorld identityと**公開可能な**静的地理・確定イベントだけを含む。個体の非公開位置や敵の戦術実体は含まない。
- 現行`next_package()`は宣言的World Compilerの出力から生成する。旧コード生成Mapは互換性差分を検証するテスト内だけに存在し、実行時のWorld生成には使用しない。

## 7. 自律移動と経路計算の関係

Worldは進路候補とコストを提供するが**戦術の選好**までは決定しない。詳細は[BEHAVIOR.md](BEHAVIOR.md)。

- **Senritsu**は通行制約、地形／橋／渡河・Hero適性を用いた到着時間と合法性を定義する。
- **Jinrei**は目的地、`fastest`／`safest`／`avoid_combat`などの名前付き選好、必要なら型付き経由ノードを選ぶ。
- **Enbu**は合法な隣接エッジ列を決定論的に選び、現在の観測と規範Tie-breakに従う。敵の非公開位置を用いた「最適な経路」の先読みは禁止。
- 動的な橋状態やブロック、視界更新による再計画契機はRulePackageで明示する。Jinreiのソースへ毎Tick経路探索アルゴリズムを書かせない。

## 8. 受入条件

1. 宣言的Definitionから現行Battlefieldと同じID／35ノード／42エッジ／合法距離を生成でき、実測試合結果とルールDigestが安定する。
2. ID重複、不正端点、未定義Terrain Profile、無関係な橋、図上だけの接続、循環する参照、不正数値を拒否する。
3. Presentationだけ変更した二つのWorldで、同一入力のEnbu native/WASM結果・CU・論理軌跡が一致し、表示Digestだけが変わる。
4. Terrain semantics／経路長の変更ではLogic identityが変わり、必要なSenritsu互換性更新が要求される。
5. 初期Worldの地理的公平性・進軍線・ジャングルの短絡距離・固定橋・河上基地が実画面と論理グラフで対応する。
6. Rendererはトポロジー以外の描画要素から通行／観測／攻撃結果を発生させず、非公開データを漏らさない。

## 9. 現行実装と残る選択

現行Compilerは `senkei-world::VerifiedWorld` とpaired `WorldIdentity` を生成する。初期Battlefield Worldは論理ノード座標、bases、lane routes、tower placementsをLogic projectionに保持し、node／edgeの表示座標・path・material等を別Presentation projectionに保持する。Logic digestとPresentation digestは独立している。

`senritsu::next_world::project_verified_world` は `RuntimeBattleMapProjection` を生成する。versioned `BattleMapWorldProjection` がsource World identity、全node／edge ID、track ranges、river-crossing progress subranges、bridge site、terrain／observation semanticsと、完全なcanonical Presentation payloadを保持する。Senritsuはpayloadをresolved paired Worldと完全一致で検証する。`BattleMap.nodes.x/y` は論理座標、`presentation_x/y` は表示座標とし、Presentation payloadはsimulation RulePackage digestに含めない。canonical `next_package()` はこのCompiler出力を使い、別のRust地形テーブルからmap topologyを作らない。

Senritsuの既定 `validate` はbuilt-in Battlefieldをcontent-addressed `WorldResolver` から解決する。`validate_with_world_resolver` は呼び出し側の不変artifact storeを受け取り、参照欠落、identity mismatch、package内projectionとresolved Worldの差を`VerifiedRulePlan`生成前に拒否する。API／projection Schemaの互換移行は引き続きversionedにする。観測遮蔽の幾何と表示補間は引き続き未確定で、Presentation geometryから論理規則を推測しない。
