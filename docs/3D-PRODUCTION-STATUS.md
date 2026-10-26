# 3D制作状態

## 記録の範囲

初期調査基準は `54011ea0d04cbfbb4400daa065af0681affad3d5`（2026-10-26）。
[制作契約](3D-PRODUCTION-CONTRACT.md)の正本と既存Generator、現行Catalog、過去のHero一覧画像を照合した。
部位別制作仕様は `bfb0428` のGeneratorと照合した。
12体の頭と髪、胴と骨盤、腕と脚、衣服、武器、装飾、輪郭の境界、個別受入項目を[制作契約](3D-PRODUCTION-CONTRACT.md#12体の部位別制作仕様)へ追記した。
既存形状と制作案を分けて記録し、個別受入チェックは未完了のまま残す。
過去のスクリーンショットと過去のCI結果は今回のPASSへ引き継がない。

## Hero採点とHard Gate

各Heroを個別に採点する。制作担当とは別の評価者が、対象HEADから撮影した実画像と動作を見て根拠を記録する。0は欠落または評価不能、1は重大な破綻、2は目立つ欠陥、3は成立しているが要改善、4は採用品質、5は基準を超える品質を表す。Identity 30%、Silhouette/Proportion 25%、Geometry/Material 20%、Animation 15%、Tactical Readability 10%で加重平均を計算する。合格には各軸3.5/5以上かつ加重平均4.0/5以上が必要で、Hard Gateの不合格を点数で相殺しない。部分画像で確認した軸は暫定点として記録し、AnimationやTactical Readability等が未評価の間は総合加重平均を計算しない。

各HeroはIdentity、Geometry、Material、Animation、LOD、Integration、Determinism、Reproducibilityの8項目をすべてPASSする必要がある。各評価にはbuild HEAD、撮影元HEAD、画像SHA-256、評価者、観測した欠陥位置と理由を残す。古いHEADの画像、静止pose、縮小画像だけで合格させず、未検証は `NOT_CHECKED` とする。

| Hero | Identity 30% | Silhouette/Proportion 25% | Geometry/Material 20% | Animation 15% | Tactical Readability 10% | 加重平均 | 独立評価証拠 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F01 Bannerhold | 4.0 | 3.5 | 3.0 (FAIL) | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | [d5独立レビュー](evidence/art-production/recheck-d5cfd807/independent-visual-review.md)、`0654af6` の修正後画像待ち |
| F02 Stoneheart | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F03 Breach | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F04 Rook | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F05 Lockstep | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F06 Pathfinder | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R01 Tempest | 4.0 | 4.0 | 3.5 (暫定) | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | [d5独立レビュー](evidence/art-production/recheck-d5cfd807/independent-visual-review.md)、`0654af6` の修正後画像待ち |
| R02 Farshot | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R03 Farwatch | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R04 Lifeline | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R05 Conductor | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R06 Aegis | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |

| Hero | Identity | Geometry | Material | Animation | LOD | Integration | Determinism | Reproducibility |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F01 Bannerhold | NOT_CHECKED | FAIL | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
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

F01/R01のd5修正前Visual FAILは履歴として維持する。`0654af6` の最新画像の独立採点とHard Gate再確認が終わるまで、両候補の採用判定と残り10体への展開を保留する。

## Hero別の状態

| Hero | 制作段階 | Functional | Visual | Interaction | Performance | 今回の証拠 |
| --- | --- | --- | --- | --- | --- | --- |
| F01 Bannerhold | 先行候補、d5で確認した胸板と攻撃時の剣可読性を `0654af6` で修正。再撮影・独立再評価待ち | 部分PASS（`39742e6` 実アプリcapture、修正前コード） | FAIL（d5、胸中央が別の盾に見え、攻撃時に剣刃の接続が見えない）。`0654af6` のVisualは未検証 | 部分PASS（旧撮影と `39742e6`） | NOT_CHECKED | [d5独立レビュー](evidence/art-production/recheck-d5cfd807/independent-visual-review.md)、[実アプリbaseline](evidence/art-production/app-recheck-39742e6/README.md) |
| R01 Tempest | 先行候補、d5の布胸面の懸念に `0654af6` で断面付きshellを追加。再撮影・独立再評価待ち | 部分PASS（`39742e6` 実アプリcapture、修正前コード） | NOT_CHECKED（d5のGeometry/Material暫定3.5。硬い胸板にも見え、修正後未検証） | 部分PASS（旧撮影と `39742e6`） | NOT_CHECKED | [d5独立レビュー](evidence/art-production/recheck-d5cfd807/independent-visual-review.md)、[実アプリbaseline](evidence/art-production/app-recheck-39742e6/README.md) |
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

## 再開後の実装・検証

- d5 `a3d01d6` production builderのisolated captureを独立レビューし、具体的なF01胸中央の盾状輪郭とattack時の剣刃隠れ、R01胸布の硬さを記録した。[画像ごとのSHAと暫定採点](evidence/art-production/recheck-d5cfd807/independent-visual-review.md)を参照。F01/R01の修正前Visual FAILは上の表に反映済み。
- `0654af6` はF01 command breastplateを肋骨形状にし、正面の中央稜を細くし、R01 channelerを断面付きcloth shellと浅いfoldへ変更した。F01/R01の13 focused tests、`tsc --noEmit -p tsconfig.graphics.json`、isolated lab buildはPASS。Chromium 156/SwiftShaderのclean 22-image captureがあり、faviconを含むconsole/page errorは0件。独立visual reviewは進行中で、まだ採用判定にはしていない。
- [`39742e6` actual app baseline](evidence/art-production/app-recheck-39742e6/README.md)ではHero Detail、Jinrei compile、Ready preflight、Battlefield T000のTactical/Cinematic描画までPlaywright 1件がPASS。これは`0654af6`より前のGenerator image evidenceであり、現在の修正後モデル受入には使わない。実Battlefieldの交戦・橋・終局・Replayは未検証。
- `0654af6` の後に共有Core入力と一致するWASM SHA `ae2f786e671bc99b34dea4e97120179380c7bac6aadc1e9068b071f1e1454c2a` でArt checkoutの `npm run build` とtypecheckはPASS。アプリ再captureは修正後の専用ブラウザ検証として続ける。SwiftShaderは物理GPU性能の証拠にならない。

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

初期調査後に上記の撮影と修正が追加された。残り10体は未展開で、F01/R01の採用も未完了のまま保持する。
