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
| F01 Bannerhold | 4.0 (preview @e627, all LOD) | 4.0 (preview @e627, all LOD) | 4.0/3.5/3.5 (full/medium/far @e627 preview) | 3.9 (preview mean @e627, all LOD; Idle 3.5, other actions 4.0) | NOT_CHECKED | NOT_CALCULATED | [e6277a2独立レビュー](evidence/art-production/recheck-e6277a2f5566/independent-visual-review.md)。Tactical未採点、加重値未計算。expected-size実戦LOD未評価 |
| F02 Stoneheart | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F03 Breach | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F04 Rook | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F05 Lockstep | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| F06 Pathfinder | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R01 Tempest | 4.0 (preview @e627, all LOD) | 4.0 (preview @e627, all LOD) | 4.0/3.5/3.5 (full/medium/far @e627 preview) | 3.9 (preview mean @e627, all LOD; Idle 3.5, other actions 4.0) | NOT_CHECKED | NOT_CALCULATED | [e6277a2独立レビュー](evidence/art-production/recheck-e6277a2f5566/independent-visual-review.md)。Tactical未採点、加重値未計算。expected-size実戦LOD未評価 |
| R02 Farshot | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R03 Farwatch | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R04 Lifeline | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R05 Conductor | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |
| R06 Aegis | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 未採取 |

| Hero | Identity | Geometry | Material | Animation | LOD | Integration | Determinism | Reproducibility |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F01 Bannerhold | PARTIAL | PARTIAL | PARTIAL | NOT_CHECKED | NOT_CHECKED | PARTIAL | NOT_CHECKED | PARTIAL |
| F02 Stoneheart | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| F03 Breach | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| F04 Rook | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| F05 Lockstep | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| F06 Pathfinder | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R01 Tempest | PARTIAL | PARTIAL | PARTIAL | NOT_CHECKED | PARTIAL | PARTIAL | NOT_CHECKED | PARTIAL |
| R02 Farshot | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R03 Farwatch | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R04 Lifeline | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R05 Conductor | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |
| R06 Aegis | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED |

F01/R01のd5 Visual FAILと`f4faad8` Animation 3.1 FAILは履歴として維持する。`30a9d6d`と`1b71f79261cc`のpreview評価は両者ともIdle 3.5、Move 4.0、Attack 3.5、Hit 3.5、Death 4.0、Animation 3.7だった。独立評価者は`97cac2e4df86`と`070064fb060b`からの各180枚を原寸確認し、manifest PNG SHAを各180/180一致と照合した。両preview sourceの採点は同じで、全3 LODのF01/R01動作はIdle 3.5、Move/Attack/Hit/Death 4.0、Animation preview mean 3.9。Identity/Silhouetteは全LOD 4.0、Geometry/Materialはfull 4.0、medium/far 3.5だった。070 captureではidleの関節運動が前回より読み取りやすくなった一方、capeは依然硬いsheetで独立した遅れが乏しい。R01 staffは全LODの攻撃中に見え続ける。後続`8357c60`は既存tick/action phaseからcapeのlagを増やし、統合後の5 focused suite 50/50とgraphics typecheckはPASS。変更後の`e6277a2f5566`から全LOD・全動作180枚を再撮影し、[原寸画像とmanifest](evidence/art-production/lod-visual-e6277a2f5566/README.md)を保存した。独立評価者はe627の180枚を原寸確認し、manifest hashを180/180照合した。e627のpreview値は候補HEADの暫定visual scoreとして記録し、expected-sizeの実戦LOD採点には使わない。この同camera isolated previewは差分確認用で、実戦想定の近景/中景/遠景サイズ、自動LOD、Tacticalを採点した最終値ではない。実ReplayのAnimation Hard Gateも未判定。全Hard Gate未認定のため、両候補の採用と残り10体への展開は保留する。

## Hero別の状態

| Hero | 制作段階 | Functional | Visual | Interaction | Performance | 今回の証拠 |
| --- | --- | --- | --- | --- | --- | --- |
| F01 Bannerhold | 先行候補。`c23c71e`でcape形状、`f3ce71a`で攻撃/被弾の荷重移動、`12b1478`/`0759bf1`でtick由来idle、後続`8357c60`でcape lagを実装。`e6277a2`全LOD preview 180枚を撮影・独立評価済み | 部分PASS（`98ee865`実アプリでHero Detail、Jinrei compile、Ready preflight、Battlefield T000を確認） | PARTIAL（e6277a2同camera preview採点済み。expected-size auto-LOD/Tactical、実Replay Animation/Integration/Determinism/Reproducibilityは未確認） | 部分PASS（Hero Detail操作と390×844 overflow確認。実機touch未確認） | NOT_CHECKED（SwiftShaderのみ） | [e6277a2最新capture](evidence/art-production/lod-visual-e6277a2f5566/README.md)、[e6277a2独立レビュー](evidence/art-production/recheck-e6277a2f5566/independent-visual-review.md)、[98ee実アプリ証拠](evidence/art-production/app-recheck-98ee865/README.md) |
| R01 Tempest | 先行候補。`770bb02`材質応答、`c23c71e`cape、`f3ce71a`staff-led attack/被弾、`12b1478`/`0759bf1`tick由来idle、`8357c60`cape lagを実装。`e6277a2`全LOD preview 180枚を撮影・独立評価済み | 部分PASS（`98ee865`実アプリでHero Detail、Jinrei compile、Ready preflight、Battlefield T000を確認） | PARTIAL（e6277a2同camera preview採点済み。expected-size auto-LOD/Tactical、実Replay Animation/Integration/Determinism/Reproducibilityは未確認） | 部分PASS（Hero Detail操作と390×844 overflow確認。実機touch未確認） | NOT_CHECKED（SwiftShaderのみ） | [e6277a2最新capture](evidence/art-production/lod-visual-e6277a2f5566/README.md)、[e6277a2独立レビュー](evidence/art-production/recheck-e6277a2f5566/independent-visual-review.md)、[770bb02 LOD比較](evidence/art-production/recheck-770bb02-lod-material/independent-visual-review.md)、[98ee実アプリ証拠](evidence/art-production/app-recheck-98ee865/README.md) |
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
- `0654af6` はF01 command breastplateを肋骨形状にし、正面の中央稜を細くし、R01 channelerを断面付きcloth shellと浅いfoldへ変更した。F01/R01の13 focused tests、`tsc --noEmit -p tsconfig.graphics.json`、isolated lab buildはPASS。Chromium 156/SwiftShaderのclean 22-image captureに対する独立レビューで、この静止画像から見えるIdentity、Silhouette/Proportion、Geometry/Materialを両Heroとも各4.0と採点した。このHEADのAnimationとTacticalは未評価なので、全体加重平均は計算していない。[撮影manifestと画像SHA](evidence/art-production/recheck-0654af6/manifest.json)を参照。
- [修正後の実アプリcapture `98ee865`](evidence/art-production/app-recheck-98ee865/README.md)は `npm run build` とPlaywright 1件がPASS。Hero Detail、Jinrei compile、Ready preflight、Battlefield T000のTactical/Cinematic描画を確認し、page/console/HTTP errorはすべて0件。実Battlefieldの交戦、橋状態、徒歩渡河、終局、fog、Replayは未検証。
- `98ee865` の死亡終端姿勢をCPU probeした結果、F01は全LODで左boot下端が地面より0.0969低く右bootが0.0588高い。R01は左が0.0634低く右が0.0867高い。`f4faad8`（Art commit `15c5264`）で死亡root tiltを0.5radから0.06radへ下げ、胴体のdeath lean 0.68radを保ったが、独立reviewは3.1/5でFAILと判定した。このFAILは履歴として残す。
- `30a9d6d`（Art code commit `a77bf62`）でHeroの死亡を側臥位まで倒し、geometry boundsから床接触を補正した。F01/R01各3LODの全頂点で死亡7時点の貫通なし・終端胴体bounds 0〜8cm・0.9/1.35/1.8秒の頂点固定をfocusedテストで確認。18 motion/LOD/preview tests、`npm run typecheck`、Art lab build、diff-checkはPASS。Chromium 156/SwiftShaderの実canvas 54枚は全画像SHA照合・実行エラー0件。full-res独立reviewはIdle3.5、Move4.0、Attack3.5、Hit3.5、Death4.0、preview Animation軸3.7。詳細は[独立採点/欠陥位置](evidence/art-production/recheck-30a9d6d-animation/independent-animation-review.md)、[54枚のmanifest/画像/再現script](evidence/art-production/hero-motion-30a9d6d/README.md)。このpreview評価はAnimation Hard GateのPASSを意味しない。
- `1b71f79261cc`はF01/R01のfull/medium/farそれぞれでIdle/Move/Attack/Hitの周期画像、Deathの7時点、正面/斜め/背面を合計180枚採取した。独立評価者が180枚全てを原寸で確認し、manifest hashと照合した。[評価報告](evidence/art-production/recheck-1b71f79261cc/independent-visual-review.md)はF01の視覚軸を4.0/3.5/3.5、R01を4.0/4.0/3.5、両者のAnimationを3.7と採点し、weighted scoreはTactical未評価のため未計算。R01 far attackの杖隠れ、両者の広く硬い背面ケープ、R01 medium/farの布と鎧の弱い応答が未達として記録された。
- `c23c71e`（generatorVersion 6）はF01/R01の背面ケープを絞り、裾を0.72へ上げ、中央を持ち上げた尾と深い縦折りを追加した。generator tests 14/14、graphics typecheck、diff-checkはPASS。`f3ce71a`ではHeroの攻撃/被弾に荷重移動とfollow-throughを加え、F01剣と胴体の交差、R01全LODの杖遮蔽をCPU bounds testsで抑えた。5 focused suites 44/44、graphics typecheck、diff-checkはPASS。
- `12b1478`/`0759bf1`ではidleをHero previewだけに留めずBattlefieldへ接続した。phaseはauthorized Replay integer tick、`tickDurationMs`、安定したentity IDから導出し、renderer wall clockを使わない。同じtickのseek/re-renderは同じ姿勢になり、現在のstateにいない、destroyed、または非Heroのentityにはidle clockを渡さない。5 focused suites 48/48、graphics typecheck、diff-checkはPASS。最新全LOD captureはまだ行っておらず、これらの新姿勢のvisual reviewと実Replay受入は`NOT_CHECKED`。1b71画像は前HEADの証拠としてのみ残す。
- `770bb02`（Art commit `e0e7110`, generatorVersion 4）ではR01のmedium/farをroughness、metalness、emissiveの頂点応答とshared shaderで描画し、従来mesh/draw予算を維持する。focused generator tests 14件とgraphics typecheckはPASS。Full/Medium/FarのIdle/Attack実画像6枚、同一camera、selected-child、各surface応答値、draw callsは[manifest](evidence/art-production/recheck-770bb02-lod-material/manifest.json)に記録する。独立視覚確認では応答差はFullで明瞭、Mediumで控えめ、Farで弱いが一部残り、マテリアル集約の欠落は認められなかった。全動作・全角度の3LOD視覚受入と実戦統合はまだ未確認。
- [合法なNative Enbu scenario probe](evidence/art-production/replay-scenario-probe/v2.0.0/README.md)は `c03854f` の `senkei.next` v2.0.0で、既存のJinrei sourceと3つのcampaign lineupを使い、600 tickの実Replayを保存した。F01は各試合で死亡し、attacker owner Replayでは同じslotの新しい生存entityとしてA.BASEへ復帰する。R01の死亡とF01/R01のpassive skill acquisitionも確認した。この証拠はCoreイベントとowner Replayの範囲で、active `next.skill`/`next.skill_damage`、独立した `next.respawn` event、Battlefield renderer画像は含まない。保存dispatcher/WASMは容量確保時に削除済みのため、Core/Replay 0.4統合後に同じsource/条件で再生成し、現行Rendererの実画像へ結線するまではAnimation Hard Gateを `NOT_CHECKED` に保つ。
- 2026-10-26に同じ3条件をCore/Replay 0.4 Native dispatcherで再生成した。Ruleset digestは`e4c8cd8f…`、Replay schema 1.1.0。各600-tick試合でF01の死亡/同slot復帰を再確認し、final-state/replay digestは旧Coreの結果と全件一致。`read-the-map`の完全な入力を同じdispatcherへ再送した結果、result・public replay・attacker owner replayがそれぞれ完全一致した。[manifest](evidence/art-production/replay-scenario-probe/v2.0.0/captures/core-replay-0.4/manifest.json)と[Native determinism記録](evidence/art-production/replay-scenario-probe/v2.0.0/determinism-core-replay-0.4.json)にhashと条件を保存した。3条件ともactive `next.skill`を含まないため、active-skill視覚受入は未検査。browserの新Core Replay→renderer capture、実サイズLOD/Tactical、画素再現性も未検査のまま。
- `0654af6` の後に共有Core入力と一致するWASM SHA `ae2f786e671bc99b34dea4e97120179380c7bac6aadc1e9068b071f1e1454c2a` でArt checkoutの `npm run build` とtypecheckはPASS。`98ee865` 実アプリ検証にも同WASMを使用した。SwiftShaderは物理GPU性能の証拠にならない。

- 別の地形／施設担当が `98ee865` のT000両モード画像を実寸で確認した。[初回独立visual report](evidence/art-production/reviews/battlefield-t000-98ee865-review.md)は局所地形、Fortress、2塔を部分判定し、中央ラベルの遮蔽を指摘した。修正後 `35950b2` の両モード実画像を独立レビューし、[T000 label defectはPASS](evidence/art-production/recheck-35950b2-label/independent-visual-review.md)へ更新した。地形起伏は弱く、河岸、全3レーン、両ジャングル、キャンプ、橋・渡河・損傷状態はこの視野では未検証のため、Battlefield全体VisualはPARTIALに保持する。

## 共通資産と実戦の状態

| 対象 | Functional | Visual | Interaction | Performance | 必要な確認 |
| --- | --- | --- | --- | --- | --- |
| 共通Generator、材質、LOD | NOT_CHECKED | PARTIAL | NOT_CHECKED | NOT_CHECKED | 生成版とmanifest、近遠景、面と陰影、切替。R01の固定カメラIdle/Attack比較のみ独立確認済み |
| Minion melee/ranged | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | Heroとの差、密集、進軍と停止攻撃 |
| Monster 3種 | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | NOT_CHECKED | 種別の輪郭、4キャンプ配置、実Replay |
| 地形、川、ジャングル | NOT_CHECKED | PARTIAL | NOT_CHECKED | NOT_CHECKED | [T000独立レビュー](evidence/art-production/reviews/battlefield-t000-98ee865-review.md): ローカル地形面と地図端の崖は見えるが、中央の高低差は弱い。中央河岸、3レーン全景、2ジャングル、4キャンプは未確認 |
| 橋、渡河、MID基地、塔、拠点 | NOT_CHECKED | PARTIAL | NOT_CHECKED | NOT_CHECKED | T000のFortressラベル衝突は[修正後の独立レビュー](evidence/art-production/recheck-35950b2-label/independent-visual-review.md)でPASS。Fortress/Tower状態と橋3状態、徒歩渡河、MID基地、損傷段階は未確認 |
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
