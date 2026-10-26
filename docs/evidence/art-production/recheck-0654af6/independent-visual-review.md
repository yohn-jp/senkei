# F01/R01 独立ビジュアル再レビュー — 0654af6

## 判定

前回の独立レビューで挙げた3点は、このHEADの隔離lab画像で改善を確認した。F01胸中央は独立した盾状の装飾に読めず、攻撃姿勢では剣刃が手元の柄から明瞭に伸びる。R01は胸から裾に続く縦の折りと布袖により、布チュニックとして読める。前回の画像上の欠陥は解消したが、F01/R01は引き続きGolden未認定である。全動作周期、LOD、実アプリとBattlefield統合、実戦の視認性はこのlabでは検証していない。

## 対象と出所

- Build HEAD / capture source HEAD: `0654af6294b5838bf53839be5dd3b28844b03d02`
- clean worktreeのsource file: `packages/renderer/src/battlefield-units.ts` blob `25f4e4f1237a204b2ca589e0505f23aed4f9f5fd`
- capture tool: `tools/art/capture-lab.mjs` blob `a3d01d65bd7caeb64b313f8231ea18417d993174`
- capture manifest: `/home/sophia/src/senkei-art-fix/test-results/art-production/lab/head-0654af6/manifest.json` と reviewed copy `/home/sophia/src/senkei-art-fix/docs/evidence/art-production/recheck-0654af6/manifest.json`。いずれも現在SHA-256 `88dd67deb1588732f62a1381c23f3d6768f37c69baa4894d3b760cbc8eedd734`、`sourceRevision=0654af6...`、`dirtyWorktree=""`、Chromium `156.0.8078.47`、`Chromium/SwiftShader software GPU`、22画像、page/runtime errorsなし。raw capture時に20枚だったmanifestへF01/R01のmedium-closeを追記した保存状態。
- full-resolution PNG: `/home/sophia/src/senkei-art-fix/test-results/art-production/lab/head-0654af6/`。manifestにある22枚すべてを個別に確認した。
- このmanifestは `captureKind=production-preview-isolated-lab-NOT-app-integration` と記録する。撮影は実Battlefield統合やユーザー向け画面の受入ではない。
- 比較した前回記録: [`d5cfd807` 独立レビュー](../recheck-d5cfd807/independent-visual-review.md)。
- 採点基準は前回レビューと同じ `origin/main` の `LOCAL-CODEX-GOAL.md`（HEAD `224332e70b26dd9e4f31c64dbad21631c6990158`、文書blob `7b6d8f571b3c060d30091768d4ed2ae45102cc46`）。Identity 30%、Silhouette/Proportion 25%、Geometry/Material 20%、Animation 15%、Tactical Readability 10%。各Heroの加重平均は4.0以上、全軸3.5以上が必要。

## 暫定スコア

この撮影で直接見える3軸だけを更新した暫定値。AnimationとTactical Readabilityは採点できず、総合加重スコアは計算しない。

| Hero | Identity | Silhouette / Proportion | Geometry / Material | Animation | Tactical Readability | 前回からの変更と根拠 |
| --- | ---: | ---: | ---: | --- | --- | --- |
| F01 Bannerhold | 4.0 | 4.0 | 4.0 | NOT_CHECKED | NOT_CHECKED | chestplateが別の盾に読めた問題を解消。攻撃画像で右手の剣と刃が読め、command装備の輪郭を保つ。前回の3.5 / 3.0から更新。 |
| R01 Tempest | 4.0 | 4.0 | 4.0 | NOT_CHECKED | NOT_CHECKED | 中距離closeと正面で布の縦折り、袖、ローブを確認。鎧の色替えに見えた曖昧さが解消し、前回Geometry/Material 3.5から更新。 |

どの評価値も隔離labの静止画だけに基づく。全AcceptanceやHard GateのPASSを意味しない。

## 個別受入

### F01 Bannerhold

| 契約項目 | 判定 | 観測 |
| --- | --- | --- |
| 金縁・バイザーが目を浮いた板にせず、斜め近景で顎と鼻を読める | PASS（撮影角度の範囲） | medium-close画像で兜の稜を含む頭部全体と顔を確認できる。目・鼻・口は顔面に沿う。 |
| 胸中央の稜が独立した盾に見えない | PASS | front、quarter、closest、medium-closeで、胸甲は肩から腹へ続く輪郭と細い金色の中央リブに見える。前回の中央の尖った大板は残っていない。 |
| 剣と盾が両手へ接続し、攻撃中も盾が腕や胸を不自然に切らない | PASS（単一攻撃姿勢の範囲） | `F01-default-attack`では刃、鍔、柄の方向が右手から連続して見える。左盾と腕・胸にも明白な貫通は見えない。周期中の接触は未確認。 |
| 旗とマントの折り襞が別の奥行きにあり、側面で一枚板に潰れない | PARTIAL | rearではマントの折りと裾、旗の別形状が見える。側面は一方向の静止画だけなので、両側からの層の分離は未確認。 |

### R01 Tempest

| 契約項目 | 判定 | 観測 |
| --- | --- | --- |
| 目・口が頬面に沿い、フード開口・髪・耳に干渉しない | PASS（撮影角度の範囲） | medium-closeでフード全体、顔、見える髪と耳を確認できる。顔面の目鼻口に浮いた板は見えない。 |
| F01と並べて肩・胸・裾が布主体に読め、鎧の色替えに見えない | PASS（静止外観の範囲） | 正面、quarter、medium-closeで布の縦折り、長いチュニック、袖が連続して見える。F01の肩鎧・胸甲・分割腰とは異なる布主体の輪郭。 |
| 裾・袖・マントに厚みと別輪郭があり、移動時に手・杖・ブーツを不自然に切らない | PARTIAL | rear/side/medium-closeで複数層と布の厚みが見える。moveは単一静止sampleのため周期中の脚抜け、杖や手との接触、足の接地は評価できない。 |

## 画像ごとの識別子

SHA-256は上記22画像manifestの値。前回から変化した外観の判定は、対応する画像を組み合わせて行った。

F01/R01それぞれの正面・斜め・背面・攻撃時・medium-closeの10枚は、manifestのSHAと一致する全解像度PNGを [`images/`](images/) に保持した。残り12枚は上記manifestのハッシュを維持し、独立レビュー当時のcapture worktreeにある。

| 画像 | SHA-256 | 確認内容 |
| --- | --- | --- |
| `F01-front-idle.png` | `a88b4fe02ee86de66accb4b4831ac43d43c75224b77c4097899e65633e224cd5` | 正面胸甲、盾、旗、装備輪郭 |
| `F01-quarter-idle.png` | `0e83b03e7ea51207a9ef44a1a6adedd777500aca3b4aa899bcbc7baae4675b1c` | 斜め胸甲の深さ、顔、盾・旗 |
| `F01-side-idle.png` | `1839f443c68aca26a3fd53904ac44ea07ffe56aa1c5957ad23e2e146131f72ba` | 側面厚み、武器とマントの重なり |
| `F01-rear-idle.png` | `50b3ae25b04d258b344eb6dcbf38895d7785f09035ca1736aa92e804c9c517c4` | 旗とマント折りの背面 |
| `F01-default-move.png` | `142a3138cfc06272764f94f4ca935ead84c8dddb3c56621378eef38a4d75fec6` | moveの一時点。連続動作の証拠ではない。 |
| `F01-default-attack.png` | `77e670959f8f7c5ea5b94c9e028e3d22bb1038e1748cd6a0c30cf79d156e860d` | 右手から鍔・剣刃の見え方、盾の静止時干渉 |
| `F01-default-hit.png` | `f3d894dbff5954dd21a6cc14b00b7d8e3b55db7ca20629c3ed55a4ae68a89e32` | hitの一時点 |
| `F01-default-death.png` | `140a731f24dbb810c131d7521a761dadb24944825b2d0c299a4c672e10c1ca9c` | 中間の傾き姿勢。終端・接地は未確認。 |
| `F01-closest-available.png` | `28fb1ea01371a3997c558f20e7e372ae866d1ff9adec8ebc7bb4de88c645d9c8` | 胸甲、顔、盾、手元の武器 |
| `F01-mobile.png` | `24ee18523d8129b910db567b1b5fcec0b7864d151544e0e4ecc151f94e7b0ccb` | narrow viewportのstatic preview |
| `F01-medium-close.png` | `c0d85ad49cb70901050827dda1b4baf047e2ab11d12501d0bb6c285fa69e4003` | 頭部全体と中央リブを確認した補助close |
| `R01-front-idle.png` | `493c19135282c31fc58e4fe82fcb4feb6e8cd68902ae635f8c60d7e86bc8de9a` | チュニック、袖、裾が布主体に見える正面 |
| `R01-quarter-idle.png` | `63506a36357905d52e2db1cd24f5c79f99c51c12f578f51622b934e51bd8b31c` | 胸の縦折り、袖とマントの層 |
| `R01-side-idle.png` | `d40f89a6956967501bb6cfed8f55f9e9e0f4ee167c2469e31eebad5ea098f39d` | ローブ、杖、背面布の側面 |
| `R01-rear-idle.png` | `bb39eda48a88e0990165f3e46d1633371714e3d7663c187f26806647361be268` | フード、後ろ髪、マント折り、裾 |
| `R01-default-move.png` | `061a81308feb71b3c6ae1cdbdbd41ad42aef0452a033b39b5a535f09e2db549c` | moveの一時点。周期中の布・脚干渉は未評価。 |
| `R01-default-attack.png` | `78eda6d6e67c350db5846e5abb0a43ee5e2f6dd4196d24cc3eb1e9d40272ec6b` | 杖・腕と縦折りの静止姿勢 |
| `R01-default-hit.png` | `516e956d7713e2195ec1d4c933e061f311be378a357c25b30028b216cba2a46e` | hitの一時点 |
| `R01-default-death.png` | `92aaac7a68787b43a4ae01ccd4dd9322a9ecdcf6f6bd16e3321561a5a7f699a7` | 中間の傾き姿勢。終端・接地は未確認。 |
| `R01-closest-available.png` | `5bfbff503214e35ffa67dbf51aa6352eefb54d6d9674847ab088d7b232cf2fa2` | 顔と布の胸面、頭上と杖先のcrop |
| `R01-mobile.png` | `872bac3bbc32237ad64e32489cae84e644c26042cc2665df91cccedd9c7172a6` | narrow viewportのstatic preview |
| `R01-medium-close.png` | `7b8692dd27dfd9d2b59854d2981dec5a774fd89a28b89f6dab1ae69ceca72018` | フード、顔、布の縦折りと袖を確認した補助close |

## Hard Gateと未検証範囲

| Hard Gate / 領域 | 判定 | 根拠と残件 |
| --- | --- | --- |
| Identity | PARTIAL | F01/R01の役割と装備は静止labで識別できる。実Hero DetailとBattlefieldでAppearance identityの一致は未確認。 |
| Geometry | PARTIAL | 胸中央の盾読み、F01の攻撃時剣可視性、R01の布主体の胸面はこの静止画像で改善。逆側、周期中の貫通、全LODは未確認。 |
| Material | PARTIAL | このレンダー条件ではFaceted Low-PolyとR01の布折りが見える。Pixel/Smooth、Tactical/Cinematic、neutral clay、サイズ別可読性は未比較。 |
| Animation | NOT_CHECKED | move/attack/hit/deathは各1枚。全周期、死亡終端、床接地と実Replayイベントを検証していない。 |
| LOD | NOT_CHECKED | labにLOD切替がなく、3段の形状・動作・材質を確認していない。 |
| Integration | NOT_CHECKED | captureはisolated labで、実アプリ、Hero Detail、Replay、Battlefield実戦を示さない。 |
| Determinism | NOT_CHECKED | このHEADで独立した二度目の全画像captureとのハッシュ比較はない。 |
| Reproducibility | PARTIAL | source HEAD、browser、renderer、全画像SHAはmanifestで固定。独立再撮影の一致は未確認。 |

このHEADの死に姿勢も中間の斜め傾斜sampleであり、停止した終端姿勢や地面への接触を示さない。表示mode、戦場サイズ、物理GPU性能、残り10Hero、Battlefield全要素も未検証である。3軸のスコアが基準を超えても、未検証軸とHard GateをPASSに置き換えない。
