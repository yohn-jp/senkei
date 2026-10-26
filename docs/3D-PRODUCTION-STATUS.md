# 3D制作状態

## 記録の範囲

初期調査基準は `54011ea0d04cbfbb4400daa065af0681affad3d5`（2026-10-26）。
[制作契約](3D-PRODUCTION-CONTRACT.md)の正本と既存Generator、現行Catalog、過去のHero一覧画像を照合した。
この初期記録は今回の実装や提出HEADの視覚品質を判定しない。
過去のスクリーンショットと過去のCI結果は今回のPASSへ引き継がない。

## Hero別の状態

| Hero | 制作段階 | Functional | Visual | Interaction | Performance | 今回の証拠 |
| --- | --- | --- | --- | --- | --- | --- |
| F01 Bannerhold | ユーザー指定の先行golden候補、既存剣盾とcommand体型を参照 | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R01 Tempest | 先行golden候補、既存杖とchanneler体型を参照 | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
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

初期調査ではビルド、実試合撮影、GPU計測を実施していない。
現時点のVisual判定は全件 `NOT_CHECKED` であり、goldenの完成や制作完了を宣言しない。
