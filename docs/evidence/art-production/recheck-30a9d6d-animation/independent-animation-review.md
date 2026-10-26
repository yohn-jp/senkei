# F01/R01 Hero motion independent review — 30a9d6d

## Evidence and scope

- Exact rendered source HEAD: `30a9d6d2660dc8b120ef2a05ceacd9bd1807a315` (manifest reports a clean source worktree at capture time).
- Capture URL: `http://127.0.0.1:4188/`; production Hero Detail preview using `buildBattlefieldHero`.
- Chromium `156.0.8078.47`, 1440 × 1000 viewport, device scale 1, SwiftShader software GPU, `prefers-reduced-motion: no-preference`.
- Full automatic LOD at the default camera; the manifest reports LOD 0 / full for the initial F01 sample. This capture is not Battlefield integration and does not force other LODs.
- Raw 1200 × 661 full-canvas PNGs: `/home/sophia/src/senkei-art-lod-visual/test-results/art-production/hero-motion-30a9d6d/`.
- Manifest: `/home/sophia/src/senkei-art-lod-visual/docs/evidence/art-production/hero-motion-30a9d6d/manifest.json`; SHA-256 `c26f90ef88290ba912fd068fdf09eb69880fef4d2b05b8129e7ef560f72d0697`.
- I inspected all 54 full-resolution PNGs for F01/R01 idle, move, attack, hit, and death samples. Independently recomputed PNG hashes match the manifest for 54/54 images. `errors`, `consoleErrors`, `httpErrors`, and `failedRequests` are empty.

## Scores

The contract defines the overall Animation axis but does not assign weights among the five actions shown here. For this review, the provisional preview score is their unweighted mean. It evaluates only the captured Hero Detail motion, not all requirements of the Animation Hard Gate.

| Hero | Idle | Move | Attack | Hit | Death | Animation axis (preview) | Animation Hard Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| F01 | 3.5 | 4.0 | 3.5 | 3.5 | 4.0 | **3.7** | **NOT_CHECKED** |
| R01 | 3.5 | 4.0 | 3.5 | 3.5 | 4.0 | **3.7** | **NOT_CHECKED** |

### F01

- **Idle (3.5):** Head, torso, arms, and cape shift subtly but visibly across the five samples. Breathing remains restrained at the full-figure framing; the unit is not entirely static.
- **Move (4.0):** Five samples show a clear alternating gait and counter-swing of the shield arm. Boots stay close to the floor without an obvious excessive lift. Because the preview model stays in place, this does not prove battlefield translation or foot planting against world motion.
- **Attack (3.5):** The sword visibly moves from its lowered ready pose through a raised diagonal cut and down through the follow-through, returning by the final sample. The hand/weapon connection reads consistently; the blade passes across the front of the breastplate without obvious penetration. The swing is readable but compact.
- **Hit (3.5):** The torso and head recoil noticeably to the side in the middle samples, then recover. Shield and arms accompany the lean; it reads as a hit response, though it has little secondary motion.
- **Death (4.0):** The progression is legible: a stagger at 0.225 seconds, a strong sideward fall by 0.45, a near-ground landing by 0.675, then a side-lying terminal body at 0.9 seconds. At 0.9, 1.35, and 1.8 seconds the body remains on the ground; both boots appear at the floor plane without an obvious gap or excessive float. The three endpoint PNGs are pixel-identical, so the settled pose holds. The shield and body overlap naturally in the final side-lying pose. The cape remains fairly rigid and has little visible follow-through.

### R01

- **Idle (3.5):** Head/torso breathing and small arm/cape changes are visible over the five samples, although subdued at this distance.
- **Move (4.0):** Alternating steps and arm swing are clear. Staff stays connected to the hand and follows the arm without an obvious tunic/cape collision; boots remain near the ground in the sampled poses. As with F01, world translation and moving-scene foot contact are outside this preview.
- **Attack (3.5):** The staff arcs from upright behind the shoulder through a diagonal forward/down strike and returns. The hand remains visibly attached to the shaft. It passes close to the sleeve and robe but no definite penetration is visible from this front-quarter view. The long tunic and cape have limited follow-through.
- **Hit (3.5):** A distinct torso/head recoil appears in the middle samples and recovers by the final sample. The staff shifts with the upper body and does not visibly detach.
- **Death (4.0):** R01 tips sideways by 0.225 seconds, is nearly horizontal by 0.45, and settles along the ground by 0.675–0.9. At 0.9, 1.35, and 1.8 seconds both boots appear grounded with no conspicuous float; the terminal images are pixel-identical and hold. The staff remains in hand and lies diagonally above/behind the body, while the cape/robe remain relatively rigid. The fall reads as completed, with the held staff as a stylized but slightly stiff detail.

## Death endpoint check

| Hero | 0.9 s | 1.35 s | 1.8 s | Fall reads completed? | Endpoint holds? |
| --- | --- | --- | --- | --- | --- |
| F01 | Both boots at floor plane; no visible excessive lift | Same grounded pose | Same grounded pose | Yes, body lands on its side | Yes; all three PNGs have SHA-256 `f44d79f8c7194653d9cb1b63ff28d2e2ad722e5b7bf98c1ccd5e325399104fea` |
| R01 | Both boots at floor plane; no visible excessive lift | Same grounded pose | Same grounded pose | Yes, body settles nearly horizontal | Yes; all three PNGs have SHA-256 `89d24a4cceb3567e60f8665872a5b664116cf5ea886d9c6c6491b062be89ee17` |

The death result is materially improved from the earlier leaning-in-place capture: both candidates visibly fall to the floor, and the terminal image is stable. This is a visual judgment from the default-camera full-canvas images, not a claim of physics simulation or all-LOD grounding.

## Acceptance boundary

Both sampled-preview Animation scores exceed the 3.5 axis floor. The **Animation Hard Gate remains `NOT_CHECKED` overall** because this capture has no skill or respawn action and does not prove actual combat-event timing or Battlefield integration. The result supports the five captured preview actions only; do not treat it as a full action-contract or integration pass.

No other Hero Hard Gate is evaluated or marked PASS here. This review does not assess Identity, Geometry, Material, LOD beyond the single automatically selected full-LOD view, Integration, Determinism, Reproducibility, Tactical Readability, or physical-GPU performance. Motion and garment comments are limited to this camera and these sampled times.

## Raw image SHA-256 references

All raw paths below are relative to `/home/sophia/src/senkei-art-lod-visual/test-results/art-production/hero-motion-30a9d6d/`. These 54 full PNG hashes were independently matched against the manifest above.

### F01

| Pose | Requested time | Raw PNG | SHA-256 |
| --- | ---: | --- | --- |
| idle | 0s | `F01-idle-0000ms.png` | `27b2be556c45d5e5d271bf40b45a6e48f30a82eeb4b849b3ade8217810ee94d9` |
| idle | 0.924s | `F01-idle-0924ms.png` | `bd2354da50109913c41d2b9a64687afc27992ba606f7aa35928a13546dfca338` |
| idle | 1.848s | `F01-idle-1848ms.png` | `02bdfeeab6763c66ef88c05163e5520eac6434ffd8dc6bf019503cb484227a93` |
| idle | 2.772s | `F01-idle-2772ms.png` | `a02496b572f28b736b82bb00dabe286d097a4549908c8421459baec1c52d02de` |
| idle | 3.696s | `F01-idle-3696ms.png` | `94ea32767a6df4312f826357e8d4f3134122561f2d148a41c8554aa7508ef90c` |
| move | 0s | `F01-move-0000ms.png` | `d0186d13237acce6580cf553317ef7f1ef97032b3c3ab89cf956b74ca3a4e825` |
| move | 0.15625s | `F01-move-0156ms.png` | `8788818369f412cc9eff6484513b05a330f3a3364249a6a1443fa2e5d58bab66` |
| move | 0.3125s | `F01-move-0313ms.png` | `b087daf3b3021b145970733e695b807a14b5e55a9879bdcd93960c5310cf028c` |
| move | 0.46875s | `F01-move-0469ms.png` | `9e4f3b2f00bf31218fe635496c74ad36f372f5e42bb62cc2e6bfada7d4761442` |
| move | 0.625s | `F01-move-0625ms.png` | `a37939ddb4f1732b84148fdd25db69c5d01046867389a37e9657448310e1724a` |
| attack | 0s | `F01-attack-0000ms.png` | `2fc0dd5bd6a150b0a7105d9f773d8cf112305d1af78646b9c7a6d1ac9d532771` |
| attack | 0.3625s | `F01-attack-0363ms.png` | `0d37e02a173230fdc765dbe1367ad4679280730631121f4f97ddc46867ab2bf5` |
| attack | 0.725s | `F01-attack-0725ms.png` | `c42e122020dbf0b9be8dc6ee7d83659075adf412084f8792a2e2abac18242b12` |
| attack | 1.0875s | `F01-attack-1088ms.png` | `83095d1431ab7b4172b88facf8b770aafa2c43956e17bd37d0ef88e42f509777` |
| attack | 1.45s | `F01-attack-1450ms.png` | `0bae24f817d523e42a889727244f27d0e684c68b19577da062d744f5637c915a` |
| hit | 0s | `F01-hit-0000ms.png` | `2c0c2b2ca282aa6fe72fda5548f882ce6b91da14745bd8da95992332955bf742` |
| hit | 0.2s | `F01-hit-0200ms.png` | `069d68df8c6c7529e7d8f60eb0c68ca99652e3abbf00221f991845d6ceb8ef1a` |
| hit | 0.4s | `F01-hit-0400ms.png` | `463886e34022f5b08344a9916dc6ca404d1da84149e067de87667be6e6adecea` |
| hit | 0.6s | `F01-hit-0600ms.png` | `1d680d1aea1dc45f2eb0f112d2ba26c12224c138dcd231e2d0aae5c674d3668c` |
| hit | 0.8s | `F01-hit-0800ms.png` | `f336bb693e9a3ea312d9d1b777dea8420394cf2e9fd61f3ce826b57dfa7fd132` |
| death | 0s | `F01-death-0000ms.png` | `1d6152dba444bf7228f9dcd82d45c507b68a32883b605c16aaed433bc6950470` |
| death | 0.225s | `F01-death-0225ms.png` | `45416f721176188d110c54d2dbd8729df1a51cb2601ae20ecc2732d02f648edd` |
| death | 0.45s | `F01-death-0450ms.png` | `ea39ddc698cecb679d7241d4f3ab20f33410e7b430d21a6dde9d80c01c689bc8` |
| death | 0.675s | `F01-death-0675ms.png` | `6ccc08aa2a173b4b4d12eedca215d5b3f56832fc8fa25ac67f6f101e9ba14acd` |
| death | 0.9s | `F01-death-0900ms.png` | `f44d79f8c7194653d9cb1b63ff28d2e2ad722e5b7bf98c1ccd5e325399104fea` |
| death | 1.35s | `F01-death-1350ms.png` | `f44d79f8c7194653d9cb1b63ff28d2e2ad722e5b7bf98c1ccd5e325399104fea` |
| death | 1.8s | `F01-death-1800ms.png` | `f44d79f8c7194653d9cb1b63ff28d2e2ad722e5b7bf98c1ccd5e325399104fea` |

### R01

| Pose | Requested time | Raw PNG | SHA-256 |
| --- | ---: | --- | --- |
| idle | 0s | `R01-idle-0000ms.png` | `d257b33ac375b8624c06cd1343e6462b6ff0ee06c9d2177d7c99ab911874594d` |
| idle | 0.924s | `R01-idle-0924ms.png` | `901d2d477b7b59e6380c7853d4f1e56485fd3dcba91011e95c8abedeeae1bd69` |
| idle | 1.848s | `R01-idle-1848ms.png` | `efcc73e1c2b10243c3ca512d02af8bed42956294a1defc9d7e0f6f1a5fe2af31` |
| idle | 2.772s | `R01-idle-2772ms.png` | `1414b3023e065b44355c3b834f582872db8c13bfb3dfb9dedbf014a0bc8e41e2` |
| idle | 3.696s | `R01-idle-3696ms.png` | `14eb60c7161424c521377b1dd26d509d994bf7f543e46f79e043974ef9385273` |
| move | 0s | `R01-move-0000ms.png` | `025d8a4bdc90005f44ef19f014c7b422bdf51a007b3994ab015528a59bbef126` |
| move | 0.15625s | `R01-move-0156ms.png` | `96bf6b95202c4f96984c561bb291a0dd81098a2a4242e6260fc0790238eaabaf` |
| move | 0.3125s | `R01-move-0313ms.png` | `310e4d733bf233ed3a957f023aee517420f79e042ff6e37108c3310481ed6e3f` |
| move | 0.46875s | `R01-move-0469ms.png` | `c455a3f7b398982b93a90f92bb50183d1aa6af2e5b9a8596fd7fe50f49ec9f14` |
| move | 0.625s | `R01-move-0625ms.png` | `75dd6d83f674f06c9b77a8fdbddd2dd3faca80461548b168589ce2e178393a08` |
| attack | 0s | `R01-attack-0000ms.png` | `5acd5364ea8df760f874fc762eee4d09004c85f50f5ab76a23d301c6e916570c` |
| attack | 0.3625s | `R01-attack-0363ms.png` | `97ebee8adaa571f40fff19b645824aad8a8a834d35196b7a2b83110aaeebce3a` |
| attack | 0.725s | `R01-attack-0725ms.png` | `76812342bc976a8a16f8dc5510dfd0c297d2bad6e481b7e4360b51a2ff844a79` |
| attack | 1.0875s | `R01-attack-1088ms.png` | `7ba894dc6fece9d5d29f1fd605ba2dd32aa2b84b4f724ade2b20e683f8371896` |
| attack | 1.45s | `R01-attack-1450ms.png` | `f99882468333972f78db7d7bc7e0d98c53b35aa41c1bc04029d6ef8cd28db454` |
| hit | 0s | `R01-hit-0000ms.png` | `196084d17faed88ffc3160d4b2aab0230c2a8033ea11aa12e07dc04121b57cf7` |
| hit | 0.2s | `R01-hit-0200ms.png` | `bd8aee8504a948ff50e94ef770cd3584d3f35217a020544baed2afec8dc9a42f` |
| hit | 0.4s | `R01-hit-0400ms.png` | `d0f9376c079c28640ec6d6df94c2c18641005db5cd9add9d9cd9dee17e556f29` |
| hit | 0.6s | `R01-hit-0600ms.png` | `2ea31efe32cd65b5636edfbeea5807bb07d88056031cc38942bacf231ae0335f` |
| hit | 0.8s | `R01-hit-0800ms.png` | `1e07a9a7fd42f7dd0987f9bc3a3cc26e48e3d70d0a8b5ac3cce487a6bfcb89fa` |
| death | 0s | `R01-death-0000ms.png` | `1d49acddccb5849cab50430360421a206bd5fd5fd94b21e06db5387d4def6b7f` |
| death | 0.225s | `R01-death-0225ms.png` | `ff761a5ae96bd0f9ef43a5d5b47940610a8996171483bd560919564d13dfca6b` |
| death | 0.45s | `R01-death-0450ms.png` | `a14a2ab8e194653ebd1e8f8cecae6143b89095c58b459dbd59be00e06cf88761` |
| death | 0.675s | `R01-death-0675ms.png` | `85455ebe2d577d33be3b5250f2214fee1d579d8377d1bc79d29477ed25b59f92` |
| death | 0.9s | `R01-death-0900ms.png` | `89d24a4cceb3567e60f8665872a5b664116cf5ea886d9c6c6491b062be89ee17` |
| death | 1.35s | `R01-death-1350ms.png` | `89d24a4cceb3567e60f8665872a5b664116cf5ea886d9c6c6491b062be89ee17` |
| death | 1.8s | `R01-death-1800ms.png` | `89d24a4cceb3567e60f8665872a5b664116cf5ea886d9c6c6491b062be89ee17` |
