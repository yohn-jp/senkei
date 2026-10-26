# 3D制作契約

## 対象と正本

本制作は既存のFaceted Low-Poly Stylized 3Dを、Hero展示と実Battlefieldで共通に使える品質へ改善する。
単一PR内でF01/R01の先行2体の造形と実画面を評価してから、残り10体へ展開する。
ユーザーの追加指示により、既存役割、装備、シルエット、画風規則から具体的な造形を進める。
本書は制作順序と確認方法を具体化するもので、未確定のキャラクターデザインを確定する権限を持たない。

| 正本 | 制作で守る内容 |
| --- | --- |
| [GRAPHICS](GRAPHICS.md)、[ART-DIRECTION](ART-DIRECTION.md) | Faceted Low-Poly、実形状の面構成、共通Generator、Pixel/Smooth、Tactical/Cinematic |
| [HERO-ATELIER](HERO-ATELIER.md) | 同じHero identity、装備、材質、動作を展示と戦場LODで共有 |
| [BATTLEFIELD-VISUAL](BATTLEFIELD-VISUAL.md) | 地理の読みやすさ、造形、カメラ、Mobile、実試合の視覚受入 |
| [GRAPHICS-DELIVERY](GRAPHICS-DELIVERY.md) | 再生成可能な資産と独立した品質判定。過去のG1限定順序を現在の全体制作へ転用しない |
| [UNITS](UNITS.md) | 前衛6／後衛6の役割。固有名と詳細キャラクター設定には未確定部分がある |
| [BATTLEFIELD](BATTLEFIELD.md)、[WORLD-DEFINITION](WORLD-DEFINITION.md) | 35ノード／42エッジ、3トラック、橋、渡河、Logic/Presentationの分離 |
| [QUALITY-AND-RETIREMENT](QUALITY-AND-RETIREMENT.md)、[README](../README.md) | 品質証拠の分離、実依存のない旧実装の整理、既存証拠の限界 |

## 既存Hero identityの根拠と確定度

役割は[UNITSの12種類の構成案](UNITS.md#初期12種類の役割定義合意した構成案)にある。
現在の実行Catalogの名前とキーは[next_content.rs](../crates/senritsu/src/next_content.rs)、外観の実装値は[battlefield-units.ts](../packages/renderer/src/battlefield-units.ts)の `HERO_SHAPES` にある。
以下の装備と体型は既存実装から継続する参照であり、作者承認済みの最終キャラクター設定とは区別する。
全行の `appearanceKey` は `senkei.next.hero.<小文字ID>`、既存assetKeyは `hero.<小文字ID>` である。

| ID／現行名 | 正本の役割 | 既存武器／頭装備 | 既存bodyProfile／mantle | 既存cloth／armor／accent |
| --- | --- | --- | --- | --- |
| F01 Bannerhold | 前衛、防御、指揮 | sword-shield／helm | command／あり | #365a66／#8c9b9c／#c7a966 |
| F02 Stoneheart | 前衛、防御、継戦 | tower-shield／bastion | bastion／あり | #465963／#75868c／#b99760 |
| F03 Breach | 前衛、火力、強襲 | spear／crest | breacher／なし | #705d43／#9a9a88／#d1af6d |
| F04 Rook | 前衛、火力、遊撃 | twin-blades／duelist | duelist／なし | #566b70／#8e9893／#c4a879 |
| F05 Lockstep | 前衛、支援、制圧 | katana／hat | controller／あり | #61504b／#85857e／#c6aa6d |
| F06 Pathfinder | 前衛、支援、偵察 | two-hand-maul／winged | pathfinder／あり | #485f58／#9c9b86／#d2b370 |
| R01 Tempest | 後衛、火力、制圧 | staff／hood | channeler／あり | #445e6d／#71858c／#94a8a5 |
| R02 Farshot | 後衛、火力、強襲 | crossbow／marksman | marksman／あり | #657362／#929386／#c7aa6d |
| R03 Farwatch | 後衛、火力、偵察 | dual-daggers／shadow | stalker／あり | #3e4d58／#68787c／#b6a47b |
| R04 Lifeline | 後衛、支援、継戦 | halo-staff／oracle | oracle／あり | #777050／#aaa38d／#d8c182 |
| R05 Conductor | 後衛、支援、指揮 | siege-launcher／engineer | engineer／なし | #59645d／#848d86／#c3a66a |
| R06 Aegis | 後衛、防御、遊撃 | bow／ranger | ranger／あり | #536c57／#899588／#c2ab70 |

上記の色は陣営色の混色前の生成値である。
体型の数値、関節の初期姿勢、武器の配置は既存Generatorにあり、変更時は差分と理由を記録する。
既存武器を役割名だけから別武器へ置き換えない。
たとえばR03の「長射程、索敵」と既存dual-daggersの関係は、制作側だけで弓へ変更して解決しない。

全12体について、固有の顔や髪、最終頭身、面数の承認済み個別資料は今回確認した正本にない。
ユーザーの追加指示により、既存の役割、装備、輪郭、画風から顔の立体、頭装備、体型、衣装を具体化してよい。
制作上の造形選択は生成値と比較画像に記録し、正本に以前から存在した設定と混同しない。
新しい伝承、性格、世界設定は下記のDECISION_REQUIREDに残す。
別プロジェクトのキャラクターは本制作の対象外とし、参照、対応付け、探索を行わない。

## 先行2体と展開条件

先行対象はユーザー指定の **F01 BannerholdとR01 Tempest** とする。
F01の指揮役の体幹、剣、盾、旗と、R01の縦方向の体幹、フード、杖を対比し、金属主体と布主体の共通材質、武器を持つ手、近景と遠景の識別を検証する。
この選定は既存資産を使った工程上の選定であり、2体の品質を承認するものではない。

Beforeには[既存F01](evidence/next/atelier/hero-model-contact-sheet/f01.png)、[既存R01](evidence/next/atelier/hero-model-contact-sheet/r01.png)、[全12体の一覧](evidence/next/atelier/hero-model-contact-sheet/contact-sheet.png)を使える。
[既存metadata](evidence/next/atelier/hero-model-contact-sheet/metadata.json)のbuildRevisionは `a7eeca56bcc8af2e14f65d41ea4d1b534c63fafb`、capture-testのsourceRevisionは `3e494c1b7d168713c7b3957aa75b75836df43a04` であり、今回の提出HEADの証拠とは別に扱う。
既存画像をそのままgolden画像へ昇格させない。

1. F01/R01を同じ本番Generatorから生成し、変更した部品と材質を特定する。
2. 同条件のBefore/After、正面、背面、左右側面、斜め近景、戦場Follow、Tacticalを実ブラウザで確認する。
3. 剣と盾、杖、頭装備、体幹、姿勢が判別でき、手と武器の接続、接地、顔と頭装備の重なり、装備の貫通を確認する。
4. Smoothで面の向きと陰影が成立し、Pixelで輪郭が潰れず、展示と全LODが同じ個体として読めることを評価する。
5. 具体的な未達を修正して再撮影し、2体のVisual判定と採用した共通部品を状態表へ記録してから残り10体へ展開する。

残り10体へ適用するのは評価済みの生成手法と材質規則であり、同一の体型や顔のコピーを成果として数えない。
先行2体の未達はその対象に留め、地形や証拠収集等の独立作業を停止する理由にしない。

## 共通制作と描画の契約

- 顔、鎧、布、革、武器の体積と面方向を実Geometryで作る。三角模様やPixel処理だけでfaceted表現を代替しない。
- Hero展示と戦場は同じ `buildBattlefieldHero` 系列、appearance identity、材質、動作意味を使う。撮影専用の別モデルを作らない。
- Generator名と版、assetKey、appearanceKey、材質、LOD、アニメーション、生成元、ライセンスを追跡する。形状を変更した場合は対応する生成版を更新する。
- LODは近景の詳細、遠景の輪郭、画面占有サイズを考慮する。武器、頭装備、主要装備を保持し、切替時の姿勢や接地の飛びを確認する。
- Minionは現行Catalogのmelee/ranged、Monsterはgrove-brute/iron-warden/storm-stalkerを対象とする。Rendererにsiegeの実装があっても、現行Catalogに存在するMinionとして追加しない。
- 地形は3レーン、2ジャングル、4キャンプ、斜行河川、橋3、橋なし渡河2、河上MID基地、両本拠地を立体で読み分ける。既存Worldの公開Presentationと整合させる。
- 塔、拠点、橋、基地は基礎と上部構造、材質、旗、損傷の意味が形で伝わるようにする。装飾で架空の通路や橋を作らない。
- 全表示モードとLODは同じ認可済みReplayを使い、未知状態を補完しない。攻撃、被害、破壊、復活は確定イベントに同期する。
- Presentation変更で論理距離、worldLogicDigest、試合結果、CU、権限を変えない。UI文字は高解像度で保つ。

## 実画面の証拠と判定

各証拠にはbuildのHEAD SHA、capture source SHA、URL、Viewport、Tick、カメラ、Pixel/Smooth、Tactical/Cinematic、Replay/scenario identityを記録する。
同一試合の初期、交戦、横断、通常橋、拡張橋、破壊橋、徒歩渡河、基地争奪、終局を既存の実Jinrei→Enbu/WASM→PresentationReplay→Rendererで検証する。
Fixtureは再現と造形確認を補助するが、本番実戦の証拠を代替しない。

| 確認 | 証拠と判定条件 |
| --- | --- |
| Hero近景とLOD | 先行2体の各方向、全12体の一覧、個別近景、Follow/Tactical。同一identity、輪郭、装備、面構成、材質、貫通、接地を目視 |
| 地形と建築 | Overview/Tactical/Follow。BATTLEFIELD-VISUALの各地理要素と橋状態を実画面で確認 |
| UIと操作 | 1440×900、1920×1080、390×844、430×932、幅320px。再生、停止、シーク、速度、選択、カメラ、Details/Timeline往復 |
| 描画方式 | Pixel/Smooth、Tactical/Cinematic、情報レイヤー切替。視認性と認可状態が一致 |
| 動作 | idle、移動、停止攻撃、被弾、skill、死亡、復活。確認可能な実イベントに限定し、欠けたイベントは未確認 |
| 性能 | FPS、メモリ、draw call、密集時のLODを計測。SwiftShaderと物理GPUを区別し、実機タッチは別記録 |

Functional、Visual、Interaction、CI、Performanceは別列で判定する。
証拠の存在、メッシュ数、build成功、テスト成功だけでVisualをPASSにしない。
未確認は `NOT_CHECKED`、確認した具体的未達は `FAIL`、実行環境の不足は `BLOCKED_BY_ENVIRONMENT` とする。
VisualのPASSには評価対象、観測結果、既知の制約を併記する。

## DECISION_REQUIRED

| ID | 不足または不整合 | 対応と影響範囲 |
| --- | --- | --- |
| DR-LORE-01 | 新しい伝承、性格、世界設定の根拠がない | 新規設定の追加だけを保留。既存役割と装備を基にした顔、体型、衣装の具体化はユーザー承認の範囲で進める |
| SHAPE-02（制作判断） | 最終頭身、面数、全方向の個別資料がない | 制作側で具体化し、生成値と各方向の証拠を残す。未決定による停止条件にしない |
| DR-ROLE-03 | R03の長射程役割と短剣、F06の偵察と大槌など、役割だけでは既存武器の意図を説明できない | 武器を維持し、ゲーム変更や新武器で黙って整合させない |
| DR-NAME-04 | UNITSの固有名未確定記述と現行Catalogの名前の確定度が異なる | 現行Catalogの表示名を保持し、世界設定上の正式名の承認とは区別 |

未決定事項は担当範囲と必要資料を明記して報告する。
全制作を止める承認工程は追加せず、確定済みの役割、既存identity、描画境界に基づく制作と検証を続ける。

## 作業所有と外部PR

関連する未統合PR #40、#39、#23の所有範囲を尊重し、担当外の変更を混在させない。
本契約の文書担当は `docs/3D-PRODUCTION-CONTRACT.md` と `docs/3D-PRODUCTION-STATUS.md` のみを所有する。
他PRの未統合差分を完成済みの根拠に使わず、競合が発生した場合は対象パスと担当を確認する。
