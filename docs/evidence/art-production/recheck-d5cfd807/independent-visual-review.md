# F01/R01 独立ビジュアルレビュー — d5cfd807

## 判定

F01/R01の顔面と布造形は前回撮影から改善した。現時点では両候補をGoldenへ昇格できない。F01は胸中央が独立した盾に見え、攻撃姿勢で剣刃と右手の接続を確認できない。R01は布主体の輪郭を得たが、胸の広い面は硬い胸板にも見える。動作周期、LOD、実Battlefield、実戦サイズの視認性はこの撮影から判定できない。

## 対象と出所

- Build HEAD / capture source HEAD: `d5cfd807a5a00e492fd0cbb733b9300e0dc0ed5a`
- `battlefield-units.ts` blob: `da61849e814dd43e44740628856b230a8bd1602c`
- 撮影ツール: `tools/art/capture-lab.mjs` blob `a3d01d65bd7caeb64b313f8231ea18417d993174`; production Hero builderを使う隔離labであり、実アプリ／Battlefield統合撮影ではない。
- clean capture manifest: `/home/sophia/src/senkei-art-hero/test-results/art-production/lab/manifest.json`、SHA-256 `96de6d03021d6e1876b089189284f160486aa106d5e6a3e414741c2ac6b4bc18`。`sourceRevision=d5cfd807...`、`dirtyWorktree=""`、Chromium `156.0.8078.47`、`Chromium/SwiftShader software GPU`、20画像。
- 独立した2回目のmanifest: `/home/sophia/src/senkei-session-art/test-results/art-production/lab/head-d5cfd807/manifest.json`、SHA-256 `22a18cb2853f43ccea1100266cdde21cfea5391b4316dadb3c5ac5bee10bb3f3`。同じsource HEADの20画像すべてclean runとSHA-256が一致した。こちらは撮影中のstatus文書変更をmanifestが記録しているため、主証拠にはclean runを使う。
- 画像は上記worktree内の無視対象PNGとして保存され、同梱manifestとSHA-256で識別する。この文書は原画像の代わりではない。
- 採点基準: `origin/main` の `LOCAL-CODEX-GOAL.md`（origin/main HEAD `224332e70b26dd9e4f31c64dbad21631c6990158`、文書blob `7b6d8f571b3c060d30091768d4ed2ae45102cc46`）。各軸0–5、重みはIdentity 30%、Silhouette/Proportion 25%、Geometry/Material 20%、Animation 15%、Tactical Readability 10%。各Heroは加重4.0以上かつ各軸3.5以上が必要。

manifestは`status=runtime-errors`、`errors=[]`、console errorが1件と記録する。別の同一HEAD lab再実行でURLを特定すると、自動favicon要求 `/favicon.ico` の404だった。これは今回の撮影時点ではfavicon修正前であることを示すUI/tooling上の記録であり、モデル欠陥として採点していない。JavaScript/page errorは確認していない。

## 暫定スコア

軸スコアは隔離labの静止画像で観測できる範囲のレビュー値で、製品受入やGolden認定ではない。AnimationとTactical Readabilityは採点できず、総合加重スコアを計算しない。

| Hero | Identity | Silhouette / Proportion | Geometry / Material | Animation | Tactical Readability | 根拠 |
| --- | ---: | ---: | ---: | --- | --- | --- |
| F01 Bannerhold | 4.0 | 3.5 | 3.0 | NOT_CHECKED | NOT_CHECKED | 兜・盾・旗で指揮役を識別できる。胸中央が別の盾に読める。攻撃時に剣刃が見えず、装備の接続を確認できない。 |
| R01 Tempest | 4.0 | 4.0 | 3.5 | NOT_CHECKED | NOT_CHECKED | フード、杖、長い布裾、布袖がF01と異なる輪郭を作る。胸面は広く硬い胸板に見える余地があり、布主体として境界値。 |

## 個別受入

### F01 Bannerhold

| 契約項目 | 判定 | 観測 |
| --- | --- | --- |
| 金縁・バイザーが目を浮いた板にせず、斜め近景で顎と鼻を読める | PASS（撮影された角度の範囲） | 目・眉・鼻・口は頬面に沿って見え、以前の板状の突出は見えない。逆側近景や別表示モードは未確認。 |
| 剣と盾が両手へ接続し、攻撃中も盾が腕や胸を不自然に切らない | FAIL | `F01-default-attack`でも剣刃が胴・盾・腰布に隠れ、右手から刃までの接続を目視できない。条件全体は合格にできない。 |
| 旗とマントの折り襞が別の奥行きにあり、側面で一枚板に潰れない | PARTIAL | 背面画像ではマントの折り稜線と裾形状が見える。manifestには側面1方向しかなく、反対側や複数斜めから旗とマントの層を検査できない。 |

### R01 Tempest

| 契約項目 | 判定 | 観測 |
| --- | --- | --- |
| 目・口が頬面に沿い、フード開口・髪・耳に干渉しない | PARTIAL | 正面・斜め・close画像では顔面と目鼻口がつながって見える。一方、close画像の頭頂と杖先が上端で切れ、フード全体、内側の髪、後頭部の厚みを判定できない。 |
| F01と並べたとき肩・胸・裾が布主体に読め、鎧の色替えに見えない | PARTIAL | 布袖と長い裾により全体シルエットはF01から分かれる。正面・closeでは胸の大面積が硬い胸板にも見えるため、布主体の受入は保留する。 |
| 裾・袖・マントに厚みと別輪郭があり、移動時に手・杖・ブーツを不自然に切らない | PARTIAL | 後面の折りと裾の厚み、攻撃静止ポーズでの杖は見える。歩行は一時点のみで、布層、杖、手、ブーツの周期中の干渉・接地を判定できない。 |

## 画像ごとの識別子とレビュー根拠

SHA-256はclean capture manifestの値。指摘は画像名とこのハッシュに対応する。

| 画像 | SHA-256 | このレビューで参照した内容 |
| --- | --- | --- |
| `F01-front-idle.png` | `524310365725a305cce24754f179f06f915d4d97ac26ceb8ab770c4df0c9c667` | 顔、正面シルエット、胸中央、盾と剣の見え方 |
| `F01-quarter-idle.png` | `f40e9a8f46a626162fe4c66b99e33b04ba87e42575718b1a0d5fab9ad1bddfdc` | 斜め顔、胸板の盾状輪郭、盾と旗の位置 |
| `F01-side-idle.png` | `4e3192b1e7566c054e0f5d261820454364a963b934eb17aa7c9b7678a56d033f` | 側面の武器・マント厚み。側面は1方向のみ。 |
| `F01-rear-idle.png` | `ba9bd7a39ceeff50379f2e35d3185745849a42fc3f1dff80b97a240734d9b737` | マント折りと旗の後面形状 |
| `F01-default-move.png` | `88469e444585e89b9ccdd4f53d727c8c341898accb65a0254e9f721d4b8624f5` | moveの単一静止sample。周期・接地判定には不足。 |
| `F01-default-attack.png` | `5c4712fb34452a7df80f0c68d4109cb747508997f3281aacd4d140cf38a01445` | 攻撃姿勢で剣刃が見えず、武器接続を確認できない。 |
| `F01-default-hit.png` | `8d7b6c86897c27dca7fe6cb73cae3d91da736e30ec42260cb2c4d129b8b7bb91` | hitの単一静止sample。 |
| `F01-default-death.png` | `20d20126bc365cfd9b1c8af1958b126c98424a266f2ffb784934d653f1e92df9` | 中間の傾斜姿勢。足が地面から浮いて見え、終端姿勢を示さない。 |
| `F01-closest-available.png` | `375d38f692e1eea213694f554f9363a7296ea9c103d11e312f316c127801ed9a` | 顔面改善、胸中央の盾状板、頭頂のcrop、手と剣の接点。 |
| `F01-mobile.png` | `54b21d0861b356e7f92c8c3714fa55dc7c1d833e5b15e3d97f6343e58bd0fe11` | narrow viewportのstatic preview。実機タッチやBattlefield操作ではない。 |
| `R01-front-idle.png` | `f7fbf5c7736caf00482c54d1559db57b96890ead5f9f36c39a664986227afcb5` | 正面でのフード、胸面、布袖・裾とF01との差。 |
| `R01-quarter-idle.png` | `7ad593c72b71117578df998c3cc9b7454b5ca59453cbed6b60a74117cbd7a125` | 斜め顔、胸面、杖・マントの重なり。 |
| `R01-side-idle.png` | `6ed28009970a6394c52d42e7b9fa2fe9b2e664a70a493df05707183a7dcb6fda` | 側面でのローブ、杖、背面布。逆側はmanifestに含まれない。 |
| `R01-rear-idle.png` | `1c987a0a38528cd183aafc3719a3444796ddc9ede0fab228f6b5da130cb60e5d` | hood、後ろ髪、マント折り、裾の後面形状。 |
| `R01-default-move.png` | `1abf56c627a62466f4e3fbfa94170e05d76ef0842718c69651294356714c6511` | moveの単一静止sample。歩行周期と脚の布抜けは未評価。 |
| `R01-default-attack.png` | `2aee2f3f80a44247767498bde6d2536f27a91b2ad68fe998a71f453c5ee38411` | 攻撃静止姿勢での杖方向と腕の位置。両手の周期中接点は未評価。 |
| `R01-default-hit.png` | `136403bfe5d5abbc81ba60bcae692fe42451ad709f82f153b67f6b57674b4a42` | hitの単一静止sample。 |
| `R01-default-death.png` | `ac408cca16f41f3c3f3916c290c90579f3305a4811e8575d65743fb3f4e2e47b` | 中間の傾斜姿勢。足が地面から浮いて見え、終端姿勢を示さない。 |
| `R01-closest-available.png` | `f88486ce637fa4314cdffe535513e3aa225f1c46237b25f5bee2d7fe6f0cf594` | 顔面、胸面の硬さ、cropされた頭頂と杖先。 |
| `R01-mobile.png` | `8d04012bee4b3571e1614182d8a83188876fb40e01eef57e95c1757f273b2f04` | narrow viewportのstatic preview。実機タッチやBattlefield操作ではない。 |

## Hard Gateと未検証範囲

| Hard Gate / 領域 | 判定 | 根拠と残件 |
| --- | --- | --- |
| Identity | PARTIAL | 同じproduction Hero builderでカタログ形状は識別できる。実Hero Detailと実BattlefieldでAppearance identity一致を未確認。 |
| Geometry | FAIL / PARTIAL | F01の胸中央板は個別条件に反する。R01の布主体の胸面は硬く見える。片側面・近景の一部のみ撮影。 |
| Material | NOT_CHECKED | SwiftShader・単一lighting setupのみ。Pixel/Smooth、Tactical/Cinematic、neutral-clay、画面サイズ別可読性を未比較。 |
| Animation | NOT_CHECKED | move/attack/hit/death各1枚。manifestの値はF01: move `(0,0)`, attack `(0.16,0)`, hit `(0,0.12)`, death `(0.5,0.68)`、R01: move `(0,0)`, attack `(0.16,0)`, hit `(0,0.12)`, death `(0.5,0.68)`。全周期、死亡終端、床接地未確認。 |
| LOD | NOT_CHECKED | LabにLOD overrideがなく、3段すべての形状・動作・材質を撮影していない。 |
| Integration | NOT_CHECKED | 実アプリのHero Detail、Replay、Battlefield実戦を撮影していない。攻撃・橋・破壊・終局も未確認。 |
| Determinism | PASS（限定） | 同一source/browser条件の独立captureで20/20 image SHA-256が一致。 |
| Reproducibility | PASS（限定） | HEAD、browser、renderer、個別image SHA-256をmanifestで固定。ただし証拠はisolated labかつSwiftShaderに限る。 |

manifestの4つのidle角度はfront、片側quarter、片側side、rear。反対側のside/quarter、接地を含む動作周期、実戦カメラ、12体の残り10体、物理GPU性能、全Hard Gateの統合結果は未確認。未確認をPASSや加重点に置き換えず、F01/R01はGolden候補のまま維持する。
