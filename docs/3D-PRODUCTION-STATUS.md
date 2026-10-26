# 3D制作状態

## 記録の範囲

初期調査基準は `54011ea0d04cbfbb4400daa065af0681affad3d5`（2026-10-26）。
[制作契約](3D-PRODUCTION-CONTRACT.md)の正本と既存Generator、現行Catalog、過去のHero一覧画像を照合した。
部位別制作仕様は `bfb0428` のGeneratorと照合した。
12体の頭と髪、胴と骨盤、腕と脚、衣服、武器、装飾、輪郭の境界、個別受入項目を[制作契約](3D-PRODUCTION-CONTRACT.md#12体の部位別制作仕様)へ追記した。
既存形状と制作案を分けて記録し、個別受入チェックは未完了のまま残す。
過去のスクリーンショットと過去のCI結果は今回のPASSへ引き継がない。

## Hero採点とHard Gate

各Heroを個別に採点する。制作担当とは別の評価者が、対象HEADから撮影した実画像と動作を見て根拠を記録する。0は欠落または評価不能、1は重大な破綻、2は目立つ欠陥、3は成立しているが要改善、4は採用品質、5は基準を超える品質を表す。Identity 30%、Silhouette/Proportion 25%、Geometry/Material 20%、Animation 15%、Tactical Readability 10%で加重平均を計算する。合格には各軸3.5/5以上かつ加重平均4.0/5以上が必要で、Hard Gateの不合格を点数で相殺しない。

各HeroはIdentity、Geometry、Material、Animation、LOD、Integration、Determinism、Reproducibilityの8項目をすべてPASSする必要がある。各評価にはbuild HEAD、撮影元HEAD、画像SHA-256、評価者、観測した欠陥位置と理由を残す。古いHEADの画像、静止pose、縮小画像だけで合格させず、未検証は `NOT_CHECKED` とする。

| Hero | Identity 30% | Silhouette/Proportion 25% | Geometry/Material 20% | Animation 15% | Tactical Readability 10% | 加重平均 | 独立評価証拠 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F01 Bannerhold | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 修正後の撮影を待つ |
| F02 Stoneheart | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F03 Breach | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F04 Rook | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F05 Lockstep | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F06 Pathfinder | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R01 Tempest | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 修正後の撮影を待つ |
| R02 Farshot | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R03 Farwatch | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R04 Lifeline | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R05 Conductor | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R06 Aegis | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |

| Hero | Identity | Geometry | Material | Animation | LOD | Integration | Determinism | Reproducibility |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F01 Bannerhold | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| F02 Stoneheart | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| F03 Breach | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| F04 Rook | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| F05 Lockstep | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| F06 Pathfinder | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R01 Tempest | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R02 Farshot | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R03 Farwatch | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R04 Lifeline | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R05 Conductor | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R06 Aegis | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |

F01/R01の修正前Visual FAILは履歴として維持する。最新画像と独立評価が揃うまで、両候補の採用判定と残り10体への展開を保留する。

## Hero別の状態

| Hero | 制作段階 | Functional | Visual | Interaction | Performance | 今回の証拠 |
| --- | --- | --- | --- | --- | --- | --- |
| F01 Bannerhold | 先行候補、顔と折り襞をbfb0428で修正、再判定待ち | 部分PASS（旧撮影） | 旧撮影FAIL／修正後NOT_CHECKED | 部分PASS（旧撮影） | NOT_CHECKED | [撮影と未達](evidence/art-production/README.md) |
| R01 Tempest | 先行候補、顔、折り襞、布の胸袖裾をbfb0428で修正、再判定待ち | 部分PASS（旧撮影） | 旧撮影FAIL／修正後NOT_CHECKED | 部分PASS（旧撮影） | NOT_CHECKED | [撮影と未達](evidence/art-production/README.md) |
| F02 Stoneheart | 残り10体への展開待ち | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F03 Breach | 展開待ち | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F04 Rook | 展開待ち | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F05 Lockstep | 展開待ち | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F06 Pathfinder | 展開待ち | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R02 Farshot | 展開待ち | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R03 Farwatch | 展開待ち、DR-ROLE-03あり | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R04 Lifeline | 展開待ち | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R05 Conductor | 展開待ち | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R06 Aegis | 展開待ち | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |

先行2体の各方向、近景、LOD、Smooth/Pixel、Tactical/Followの比較と修正結果を記録してから残り10体へ展開する。
ユーザーの追加指示により、既存役割、装備、シルエット、画風から顔の立体、体型、衣装の具体化を進める。
新しい伝承、性格、世界設定だけを [DR-LORE-01](3D-PRODUCTION-CONTRACT.md#decision_required) として保留する。
別プロジェクトのキャラクターは参照対象から除外する。

## 先行2体の撮影と修正の履歴

[既存の撮影報告](evidence/art-production/README.md)、[lab manifest](evidence/art-production/lab/manifest.json)、[app manifest](evidence/art-production/app/manifest.json)のsourceRevisionは `d5c57e89e1188b4fdc80f7ffb435d8a8ec16347f`。
現行 `bfb0428` の画像として転用しない。
撮影時は顔の浮いた板状の目と口、硬いマント、R01の鎧主体の輪郭をVisual FAILとして記録した。
`bfb0428` は顔面に沿う目と口、鼻の楔、F01/R01の閉じた折り襞、R01の布胸当て、袖、広がる長い裾へ変更した。
これらはコード上の修正であり、修正後のVisual PASSは未取得である。
残り10体への展開は先行2体の再撮影と判定待ちを維持する。

旧撮影では実アプリのHero Detailにて両候補のcanvas identity、5ポーズ操作、orbit/reset、wheel zoom、幅390pxのoverflow assertionを通過した。
表の「部分PASS」はこの範囲だけを指す。
JavaScript例外は記録されず、未解決のresource 404が1件ある。
正面、斜め、片側面、背面と静止した5ポーズは採取済みだが、左右両側面、全動作周期、死亡の終端、制御した全LOD、全表示モード、契約の5画面幅、実機タッチは未確認。

実Jinrei compileとReady preflightを経たWASM SHAは `8ec4c1b4dcb9b5acb6fa59322aa6e8398db72fdd4ed1632af6dcb122326f59ea`。
実BattlefieldのT000とCinematic切替は撮影済みで、修正前の統合経路の動作証拠として扱う。
交戦、橋状態、徒歩渡河、基地争奪、終局の受入はこの2枚では成立しない。
完全なReplayのexport/hashも未採取。
SwiftShaderの単発telemetryはTactical 1,078 draw calls／147,822 triangles／5.8 FPS、Cinematic presentation 1,373／159,726／5.7 FPSで、物理GPUのPerformance PASSではない。

## 共通資産と実戦の状態

| 対象 | Functional | Visual | Interaction | Performance | 必要な確認 |
| --- | --- | --- | --- | --- | --- |
| 共通Generator、材質、LOD | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 生成版とmanifest、近遠景、面と陰影、切替 |
| Minion melee/ranged | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | Heroとの差、密集、進軍と停止攻撃 |
| Monster 3種 | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 種別の輪郭、4キャンプ配置、実Replay |
| 地形、川、ジャングル | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 3レーン、2ジャングル、河岸、枝道、4キャンプ |
| 橋、渡河、MID基地、塔、拠点 | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 橋3状態と徒歩渡河、建築、所属、損傷 |
| 実試合の各カメラと表示モード | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 同じ認可済みReplay、確定イベント、Fog |
| Desktop/Mobile操作 | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 契約の5画面幅、選択とパネル往復、状態保持 |
| 物理GPU、実機タッチ | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | ソフトウェア描画の証拠から区別 |
| 今回のCI | NOT_CHECKED | 対象外 | 対象外 | 対象外 | 提出HEADに対応するcheck結果 |

## 証拠の追記形式

各実施結果は次の形式で追記し、該当する表の判定とリンクを更新する。
HEAD更新後は変更が影響する確認をやり直し、古いHEADを今回の証拠と混同しない。

```text
対象:
build HEAD SHA / capture source SHA:
URL / scenario / Replay identity / WASM SHA:
Viewport / Tick / camera / Pixel-Smooth / Tactical-Cinematic:
画像または動画:
実施した操作:
Functional / Visual / Interaction / CI / Performance:
観測した成立条件:
具体的な未達と修正:
再確認の証拠:
環境と未確認範囲:
```

初期調査後に上記の撮影と修正が追加された。
F01/R01の旧撮影のVisual FAILは履歴として保持し、影響する修正後の判定は `NOT_CHECKED` とする。
残り10体は未展開で、goldenの完成や制作完了を宣言しない。
本更新は文書と既存ソースの照合であり、新たなブラウザ撮影やGPU計測は実施していない。
