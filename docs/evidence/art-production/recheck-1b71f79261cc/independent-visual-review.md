# F01/R01 full LOD and motion independent visual review — 1b71f79261cc

Reviewer: `visual_auditor` on `session/art-audit`.

## Evidence and integrity

- Exact rendered source HEAD: `1b71f79261cc69820ff110897ee4760ce012f6f7`; the capture manifest records an empty `dirtyWorktreeAtCapture`.
- Capture manifest: `../lod-visual-1b71f79261cc/manifest.json`; SHA-256 `11d51b84f52409600d24ae50cdb6d0604105f5ec5dba68c943c6463c0c86b0d5`.
- Raw images: `../lod-visual-1b71f79261cc/images/`.
- Chromium `156.0.8078.47` / SwiftShader, 1440 × 1000 viewport at device scale 1; each raw full-canvas PNG is 1200 × 661. Capture URL: `http://127.0.0.1:4188/`.
- Capture uses production `createHeroModelPreview` / `buildBattlefieldHero`, with each requested generated LOD child selected via the inspection-only lab override. It is not Battlefield Replay integration. Each Hero/LOD has 30 images: five idle, five move, five attack, five hit, seven death, and three static angles.
- Independently recalculated PNG SHA-256 values match the manifest for **180/180 unique files**. Manifest `errors`, `consoleErrors`, `httpErrors`, and `failedRequests` are empty.
- The 54 requested cross-LOD action samples use the same default camera; capture telemetry reports maximum joint/root delta 0 radians between levels. Selected children are full/index 0/`true,false,false`, medium/index 1/`false,true,false`, and far/index 2/`false,false,true`. I also inspected original-size images at each level rather than relying on telemetry.

## Scores

The production goal scores Identity (30%), Silhouette/Proportion (25%), Geometry/Material (20%), Animation (15%), and Tactical Readability (10%) from 0–5. Each Hero needs weighted score >=4.0 and each scored axis >=3.5. These are review scores for the visible candidate subset only. Tactical Readability and complete app/Replay acceptance cannot be inferred from isolated model-builder captures. The Animation preview value is the unweighted mean of the five captured actions, not a substitute for the complete Animation Hard Gate.

### Preview action scores by LOD

| Hero | LOD | Idle | Move | Attack | Hit | Death | Animation preview mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| F01 | Full | 3.5 | 4.0 | 3.5 | 3.5 | 4.0 | **3.7** |
| F01 | Medium | 3.5 | 4.0 | 3.5 | 3.5 | 4.0 | **3.7** |
| F01 | Far | 3.5 | 4.0 | 3.5 | 3.5 | 4.0 | **3.7** |
| R01 | Full | 3.5 | 4.0 | 3.5 | 3.5 | 4.0 | **3.7** |
| R01 | Medium | 3.5 | 4.0 | 3.5 | 3.5 | 4.0 | **3.7** |
| R01 | Far | 3.5 | 4.0 | 3.5 | 3.5 | 4.0 | **3.7** |

The action scores are qualitative judgments of the captured image sequences. F01's earlier 30-image provisional scores are confirmed by this 90-image all-LOD review. R01 far attack retains a readable wind-up, staff thrust, and return, but the staff is hidden behind the torso/cape during parts of the wind-up; this is its main far-LOD readability limitation. The sampled actions meet 3.5, but this does not establish the per-axis or weighted product goal.

### Visual-axis scores for the captured subset

| Hero | Identity | Silhouette / Proportion | Geometry / Material | Animation preview | Tactical Readability | Weighted Goal score |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| F01 | 4.0 | 3.5 | 3.5 | 3.7 | NOT_CHECKED | Not calculated |
| R01 | 4.0 | 4.0 | 3.5 | 3.7 | NOT_CHECKED | Not calculated |

These scores apply to the two candidates and captured views only. I do not calculate a weighted result with Tactical Readability missing or claim either Hero is accepted. Geometry/Material is 3.5 due mainly to the broad, stiff cape and reduced cloth detail at far LOD; material response is visible rather than absent.

## Visual observations

### F01

- **Identity/static views:** Helmet/face, sword, shield, and banner distinguish the commander from R01 in front, quarter, and rear views. The chest plate no longer reads as a separate shield; sword remains visibly held. Full, medium, and far preserve the main silhouette and equipment.
- **Idle (3.5):** Head, torso, and arms shift subtly across the five samples; the model does not freeze. Movement is restrained at this preview scale.
- **Move (4.0):** Legs alternate and the shield arm counter-swings. Boots stay near the floor without conspicuous lift. The model stays in place, so this does not establish world translation or moving-scene foot planting.
- **Attack (3.5):** Sword moves through a compact diagonal cut and returns. Hand-to-hilt continuity and blade visibility remain across all three levels; no definite torso penetration appears in the samples.
- **Hit (3.5):** Clear torso/head recoil and arm/shield reaction appear and recover. There is little secondary motion.
- **Death (4.0):** F01 falls onto its side and settles by 0.9 seconds. At 0.9, 1.35, and 1.8 seconds both boots appear at the floor plane without obvious excessive float. The three endpoint PNGs are identical within each LOD and hold. The broad cape has limited follow-through and stays relatively rigid.
- **LOD/material:** Full cape and armor facets are clearest; medium/far lose fine facet and edge detail but keep banner, sword, shield, helmet, and shoulder silhouette. No abrupt visible shape change or definite equipment separation was found.

### R01

- **Identity/static views:** Hood, staff, long tunic, and cape make a distinct silhouette from front, quarter, and rear. Staff shaft/head remain connected across levels. The back cape occupies most of the rear silhouette and reads as a wide, faceted panel.
- **Idle (3.5):** Small head/torso breathing is visible. Long tunic/cape have little independent movement.
- **Move (4.0):** Alternating gait and arm movement read at all LODs; staff follows the hand. Boots stay near floor in sampled poses. Long tunic and cape are stiff with little follow-through; world translation/foot planting are outside this preview.
- **Attack (3.5):** Arm and staff travel into a forward/down thrust and return. During parts of the wind-up, staff is substantially occluded by the body and rear cape, especially at far LOD; it becomes visible again when the arm extends. The pose sequence remains discernible but is less clear than F01's sword cut. No definite weapon detachment or cloth/body penetration is visible.
- **Hit (3.5):** Torso/head recoil is distinct and recovers. Staff follows the arm. Cape swings outward in middle samples but behaves like a broad rigid piece rather than flowing cloth; no definite collision is visible from this camera.
- **Death (4.0):** R01 falls onto its side by 0.675–0.9 seconds. At 0.9, 1.35, and 1.8 seconds both boots appear at/near floor without obvious excessive float; each LOD's endpoint PNGs are identical and hold. Staff remains in hand above/behind the body. This is visual contact in an isolated builder, not physics/collision proof.
- **Cloth/armor response:** Full LOD tunic folds read matte while shoulder/cuff armor has harder, brighter facets. Difference remains visible but subtler in medium; at far it is weaker and fewer folds survive, though robe remains matte and armor edges remain somewhat brighter/harder. The manifest records per-vertex `senkeiSurfaceResponse` tuples. The single baked material's `metalness=0, roughness=1` is only fallback, not the final response. One light/camera does not isolate shader contribution from color/geometry, so this is a visual observation, not an A/B shader result.
- **Cape/clearance:** In idle, move, attack, hit, and death, the rear cape remains broad and relatively stiff. In hit it projects outward; sampled PNGs show no definite penetration into body or staff. Its width hides rear equipment and remains the main cloth-shape limitation. Full/medium/far retain the role silhouette; far simplifies folds and small armor facets without a major contour break.

## Settled death endpoints

| Hero | LOD | 0.9 s / 1.35 s / 1.8 s SHA prefix | Grounded appearance | Endpoint hold |
| --- | --- | --- | --- | --- |
| F01 | Full | `97d1528769...` / same / same | Both boots at floor; no obvious excessive float | Yes, identical PNGs per LOD |
| F01 | Medium | `0410f87769...` / same / same | Both boots at floor; no obvious excessive float | Yes, identical PNGs per LOD |
| F01 | Far | `0107ed3def...` / same / same | Both boots at floor; no obvious excessive float | Yes, identical PNGs per LOD |
| R01 | Full | `b727df3f7e...` / same / same | Both boots at/near floor; no obvious excessive float | Yes, identical PNGs per LOD |
| R01 | Medium | `b1bbeb2456...` / same / same | Both boots at/near floor; no obvious excessive float | Yes, identical PNGs per LOD |
| R01 | Far | `dac7767e29...` / same / same | Both boots at/near floor; no obvious excessive float | Yes, identical PNGs per LOD |

Full endpoint hashes are in the raw-image table below. Equality is within each selected LOD, not between different LODs.

## Gate status and limits

| Gate / area | Review status | Boundary |
| --- | --- | --- |
| Identity | VISUAL SUBSET PASS | F01 and R01 remain distinguishable across captured static views and three selected LODs. Does not accept remaining Heroes or the full goal. |
| Geometry | VISUAL SUBSET PASS | No definite sampled clipping/detachment found; cape width/stiffness and far detail loss remain limits. Not collision/physics proof. |
| Material | VISUAL SUBSET PASS | Cloth/armor separation remains at full/medium and is weaker at far; no lighting/A-B sweep. |
| Animation Hard Gate | NOT_CHECKED | Samples cover idle/move/attack/hit/death only. Skill, respawn, live combat-event timing, Battlefield integration, continuous cycles, and runtime transitions are absent. |
| LOD Hard Gate | NOT_CHECKED | Each child was manually selected. Automatic distance transitions, battlefield-scale silhouette, transition popping, and runtime switching are untested. |
| Integration | NOT_CHECKED | Isolated Hero Detail/model-builder canvas, not Battlefield Replay or the actual app scene. |
| Determinism | NOT_CHECKED | One capture is hash-verified; no independent repeat run/cross-session comparison was made. |
| Reproducibility | NOT_CHECKED | Source, manifest, conditions, and hashes are recorded; clean rebuild/replay by another runner was not performed. |
| Tactical Readability | NOT_CHECKED | No battlefield context, enemy/background contrast, team colors, camera-distance sweep, or tactical UI. |
| Performance | NOT_CHECKED | Chromium used SwiftShader software rendering; physical GPU/device performance was not measured. |

No overall F01/R01 acceptance or Goal completion is claimed by this visual review. Preview action means meet 3.5, but full weighted scores and Hard Gates depend on the product evidence above.

## Raw image SHA-256 references

Paths are relative to `../lod-visual-1b71f79261cc/images/` from this report. All 180 values below were independently matched against the capture manifest.

| Hero | LOD | Pose / view | Time (s) | PNG | SHA-256 |
| --- | --- | --- | ---: | --- | --- |
| F01 | full | idle | 0 | `F01-full-idle-0000ms.png` | `8850221d9559a62d03b1e027befd3f9e9afc37fb688cf5c3823d42d0516d4818` |
| F01 | full | idle | 0.924 | `F01-full-idle-0924ms.png` | `7718eaa613ef201943d854600ce8f1d8b3e37674df62332947496dd26a871457` |
| F01 | full | idle | 1.848 | `F01-full-idle-1848ms.png` | `05ec0defd995c40e50831c6a791d792844e4e20fca904c82521832ea0747da74` |
| F01 | full | idle | 2.772 | `F01-full-idle-2772ms.png` | `18ba2a91bbc698271f7431d504753e08c1d43310d56704a13b040f18a79f3604` |
| F01 | full | idle | 3.696 | `F01-full-idle-3696ms.png` | `fc1155a7ba3941762e2c0ec361ac42e1118b79e0e8043f4255c493ed5c765f8e` |
| F01 | full | move | 0 | `F01-full-move-0000ms.png` | `164579488cc682eecd4e2998feb4241d4e882ff0ca8f397a7eba9637d405c92f` |
| F01 | full | move | 0.15625 | `F01-full-move-0156ms.png` | `bb1490a9319ef672cd2aa8eee3eec2f5de65519a73267add0268442affd110c4` |
| F01 | full | move | 0.3125 | `F01-full-move-0313ms.png` | `164579488cc682eecd4e2998feb4241d4e882ff0ca8f397a7eba9637d405c92f` |
| F01 | full | move | 0.46875 | `F01-full-move-0469ms.png` | `7a6f6a3a734a811083a0f8c8d35b209ce57b46ebd25cb34af19eb56d2681f2d4` |
| F01 | full | move | 0.625 | `F01-full-move-0625ms.png` | `164579488cc682eecd4e2998feb4241d4e882ff0ca8f397a7eba9637d405c92f` |
| F01 | full | attack | 0 | `F01-full-attack-0000ms.png` | `164579488cc682eecd4e2998feb4241d4e882ff0ca8f397a7eba9637d405c92f` |
| F01 | full | attack | 0.3625 | `F01-full-attack-0363ms.png` | `254ed9730e643a316c2e53a821896d91f091ae5a9e58f72bb4b5d88f3a0ebe41` |
| F01 | full | attack | 0.725 | `F01-full-attack-0725ms.png` | `490ebe52f1051e28f90ae214b222c466bde6437c03e0d52e85195dda66ac0c92` |
| F01 | full | attack | 1.0875 | `F01-full-attack-1088ms.png` | `7567cdf1544e00eaf787c6ae3586f229feb26498940fb86ff2f9066c068cc45a` |
| F01 | full | attack | 1.45 | `F01-full-attack-1450ms.png` | `164579488cc682eecd4e2998feb4241d4e882ff0ca8f397a7eba9637d405c92f` |
| F01 | full | hit | 0 | `F01-full-hit-0000ms.png` | `164579488cc682eecd4e2998feb4241d4e882ff0ca8f397a7eba9637d405c92f` |
| F01 | full | hit | 0.2 | `F01-full-hit-0200ms.png` | `fec82feb7d5e4dd37c58f41ea29139535f2b2d422243e1cc690fc4f103833d6c` |
| F01 | full | hit | 0.4 | `F01-full-hit-0400ms.png` | `8796b5f720f6e19eb60573a268c37bf3c869e65050b8319ce90d4b81823cf546` |
| F01 | full | hit | 0.6 | `F01-full-hit-0600ms.png` | `b9bbecc10044eab7e7781338d7b6c816cc044914a9f68ad1999c01e4aa0e81b1` |
| F01 | full | hit | 0.8 | `F01-full-hit-0800ms.png` | `164579488cc682eecd4e2998feb4241d4e882ff0ca8f397a7eba9637d405c92f` |
| F01 | full | death | 0 | `F01-full-death-0000ms.png` | `164579488cc682eecd4e2998feb4241d4e882ff0ca8f397a7eba9637d405c92f` |
| F01 | full | death | 0.225 | `F01-full-death-0225ms.png` | `a80ac15b704147c0beb8a245ce040171b6fd3247aaedec8f4e112f978b7df848` |
| F01 | full | death | 0.45 | `F01-full-death-0450ms.png` | `4e3c807f4d1a8026b6e4a0f43890b470e4e93575aa4a861164e6ef09e006c609` |
| F01 | full | death | 0.675 | `F01-full-death-0675ms.png` | `226d90a3b940c4a9736ecaf10a31ade5d920d9ed63e733644e111a70eba7bbc8` |
| F01 | full | death | 0.9 | `F01-full-death-0900ms.png` | `97d152876bbdf28a81a131452632f1ed30cb217ef5c8e17862bc0ddacd2196ab` |
| F01 | full | death | 1.35 | `F01-full-death-1350ms.png` | `97d152876bbdf28a81a131452632f1ed30cb217ef5c8e17862bc0ddacd2196ab` |
| F01 | full | death | 1.8 | `F01-full-death-1800ms.png` | `97d152876bbdf28a81a131452632f1ed30cb217ef5c8e17862bc0ddacd2196ab` |
| F01 | full | static/front | 0 | `F01-full-static-front.png` | `47eb4d8a5936bea42fbf1d805fb848ce190c69b3160974cf817dbd64f5a91368` |
| F01 | full | static/quarter | 0 | `F01-full-static-quarter.png` | `058cc361495c4595a775623a3d7d1de5d1ed2e2504dbe1b9136c9fabea5b1492` |
| F01 | full | static/rear | 0 | `F01-full-static-rear.png` | `0a4f101e57c620b1c78def89ae21356763be16a96d995d06b5d6541cdb7b25ce` |
| F01 | medium | idle | 0 | `F01-medium-idle-0000ms.png` | `18b50cc87dfb0e839387a6cf95f12b1c560343e8cd87cba2dee081c44cf81137` |
| F01 | medium | idle | 0.924 | `F01-medium-idle-0924ms.png` | `366fc514008dd496dd3eaf5b35474eb8e65b56d847da6a763d6246495991e870` |
| F01 | medium | idle | 1.848 | `F01-medium-idle-1848ms.png` | `8520664871bdf173de8ddc6c6b8de66d23d0db09686c1e425d4ee7dc2c478517` |
| F01 | medium | idle | 2.772 | `F01-medium-idle-2772ms.png` | `807366697dc42dcc867356112b78da2a93fd7e5fd4fd86329b9cf9fa25ef3a68` |
| F01 | medium | idle | 3.696 | `F01-medium-idle-3696ms.png` | `c5965e71673fbe8ed5de3742890b00992c8ff31da72f8ab2d64058021b0775b4` |
| F01 | medium | move | 0 | `F01-medium-move-0000ms.png` | `18b50cc87dfb0e839387a6cf95f12b1c560343e8cd87cba2dee081c44cf81137` |
| F01 | medium | move | 0.15625 | `F01-medium-move-0156ms.png` | `3b677070c52e240acfad12efccd23b3b9f429de8a8a2f69100aad4990d0bd828` |
| F01 | medium | move | 0.3125 | `F01-medium-move-0313ms.png` | `18b50cc87dfb0e839387a6cf95f12b1c560343e8cd87cba2dee081c44cf81137` |
| F01 | medium | move | 0.46875 | `F01-medium-move-0469ms.png` | `d108e79dc3e2c2d52b943bdf9c22ad22f5c42775d7839a0842f92677f39b0749` |
| F01 | medium | move | 0.625 | `F01-medium-move-0625ms.png` | `18b50cc87dfb0e839387a6cf95f12b1c560343e8cd87cba2dee081c44cf81137` |
| F01 | medium | attack | 0 | `F01-medium-attack-0000ms.png` | `18b50cc87dfb0e839387a6cf95f12b1c560343e8cd87cba2dee081c44cf81137` |
| F01 | medium | attack | 0.3625 | `F01-medium-attack-0363ms.png` | `47ca4e63391d712cc2d2f5c781914d5478258d831c62c27030098bf69d4d00e8` |
| F01 | medium | attack | 0.725 | `F01-medium-attack-0725ms.png` | `67564c233455d0abe7e2c27f86a7916c2a20aa27cc14b70d11138a938d25e04e` |
| F01 | medium | attack | 1.0875 | `F01-medium-attack-1088ms.png` | `41a6e74de1f98f92c350009ba0ed3e9030f7eff5f7ea161c95b925d87a530b70` |
| F01 | medium | attack | 1.45 | `F01-medium-attack-1450ms.png` | `18b50cc87dfb0e839387a6cf95f12b1c560343e8cd87cba2dee081c44cf81137` |
| F01 | medium | hit | 0 | `F01-medium-hit-0000ms.png` | `18b50cc87dfb0e839387a6cf95f12b1c560343e8cd87cba2dee081c44cf81137` |
| F01 | medium | hit | 0.2 | `F01-medium-hit-0200ms.png` | `5567e41edd3a01938fadcbee113b68c5e7daa0d91004bf62f77e92ff4b3dedd6` |
| F01 | medium | hit | 0.4 | `F01-medium-hit-0400ms.png` | `8bf227151a5fb51406bfdf97d09604460c4f1c8d218b57d08afcdd9d8ad9d0fb` |
| F01 | medium | hit | 0.6 | `F01-medium-hit-0600ms.png` | `4b4da508514279d161d8c716f9ec13e0a3f6fd57165da8d044e44a2f9db20667` |
| F01 | medium | hit | 0.8 | `F01-medium-hit-0800ms.png` | `18b50cc87dfb0e839387a6cf95f12b1c560343e8cd87cba2dee081c44cf81137` |
| F01 | medium | death | 0 | `F01-medium-death-0000ms.png` | `18b50cc87dfb0e839387a6cf95f12b1c560343e8cd87cba2dee081c44cf81137` |
| F01 | medium | death | 0.225 | `F01-medium-death-0225ms.png` | `a803b9f327f50d0e2710598714fca64d9131e1b4dfbc0c86e3bc04b78a339b8e` |
| F01 | medium | death | 0.45 | `F01-medium-death-0450ms.png` | `1baa71d9f4339554be7946222b3b61f445074b08ccec8ab63d51cc6c48a89cde` |
| F01 | medium | death | 0.675 | `F01-medium-death-0675ms.png` | `a9530a40c1099a8998719d3a357b831f961a8cdb1511fb9b85d55f1cf5e2e49a` |
| F01 | medium | death | 0.9 | `F01-medium-death-0900ms.png` | `0410f87769d9781d53b0014691d32cbce7f54b47ae2383ab038ed0a12d471b87` |
| F01 | medium | death | 1.35 | `F01-medium-death-1350ms.png` | `0410f87769d9781d53b0014691d32cbce7f54b47ae2383ab038ed0a12d471b87` |
| F01 | medium | death | 1.8 | `F01-medium-death-1800ms.png` | `0410f87769d9781d53b0014691d32cbce7f54b47ae2383ab038ed0a12d471b87` |
| F01 | medium | static/front | 0 | `F01-medium-static-front.png` | `81fc6e787743b2a3012191a548e6ab476feaac44ae0a789ea4160ea61a39244a` |
| F01 | medium | static/quarter | 0 | `F01-medium-static-quarter.png` | `cfa515c3d1d8e24eb10708c354067f848eb26450d13e100c38cca6f73df33d0d` |
| F01 | medium | static/rear | 0 | `F01-medium-static-rear.png` | `598eaab6cd6670b6e28beb41e11367548daeb9939381e138bb6700d149b98f3a` |
| F01 | far | idle | 0 | `F01-far-idle-0000ms.png` | `55e30f6912b141861c5e94b4244ffffbc45d7757dedfe8d240bc01bdb7688e13` |
| F01 | far | idle | 0.924 | `F01-far-idle-0924ms.png` | `7c2962b86d9eb8e93eb47b47703fc9b900640fa2bbc097a8ff0b5857c6e9be9d` |
| F01 | far | idle | 1.848 | `F01-far-idle-1848ms.png` | `b4e238478e995158bf1071a28cc5836a4e7c8d0f48cb8ac58aa2c496e6eb173c` |
| F01 | far | idle | 2.772 | `F01-far-idle-2772ms.png` | `bb06fe83c1c166c9c1b71b53afe79f3af2d1f8a7bc92d91fd86b804b0283870a` |
| F01 | far | idle | 3.696 | `F01-far-idle-3696ms.png` | `fc0b6f634a6f4cd917a468e8fd444f5cd0eb3eb3ecf18818edae0fcb05ace354` |
| F01 | far | move | 0 | `F01-far-move-0000ms.png` | `55e30f6912b141861c5e94b4244ffffbc45d7757dedfe8d240bc01bdb7688e13` |
| F01 | far | move | 0.15625 | `F01-far-move-0156ms.png` | `8b5ef364ebdb248346d5c51e843d669d59f8bdba435985edf604cfdd48455e20` |
| F01 | far | move | 0.3125 | `F01-far-move-0313ms.png` | `55e30f6912b141861c5e94b4244ffffbc45d7757dedfe8d240bc01bdb7688e13` |
| F01 | far | move | 0.46875 | `F01-far-move-0469ms.png` | `f6bce10e1ecaa3d29780c208ee546f4b3e5a73059db3c7f8612243a2667497ce` |
| F01 | far | move | 0.625 | `F01-far-move-0625ms.png` | `55e30f6912b141861c5e94b4244ffffbc45d7757dedfe8d240bc01bdb7688e13` |
| F01 | far | attack | 0 | `F01-far-attack-0000ms.png` | `55e30f6912b141861c5e94b4244ffffbc45d7757dedfe8d240bc01bdb7688e13` |
| F01 | far | attack | 0.3625 | `F01-far-attack-0363ms.png` | `f1d91292a482941154da8404cf5f6c7245b5d9315e83ed88df85d22c692bbf36` |
| F01 | far | attack | 0.725 | `F01-far-attack-0725ms.png` | `424fc93d120093cfb4b3a47506b4069a2b87eb9e3c1a0597c3c9834eadf9fcc3` |
| F01 | far | attack | 1.0875 | `F01-far-attack-1088ms.png` | `4fd5ce0bed555ddffecbd7e51e66727ccf94fe2e75fd77e97811d39cfe662828` |
| F01 | far | attack | 1.45 | `F01-far-attack-1450ms.png` | `55e30f6912b141861c5e94b4244ffffbc45d7757dedfe8d240bc01bdb7688e13` |
| F01 | far | hit | 0 | `F01-far-hit-0000ms.png` | `55e30f6912b141861c5e94b4244ffffbc45d7757dedfe8d240bc01bdb7688e13` |
| F01 | far | hit | 0.2 | `F01-far-hit-0200ms.png` | `dd6727a38a81089667a419fee568a67a3a580b4e91bb7e85d4844da0f9308568` |
| F01 | far | hit | 0.4 | `F01-far-hit-0400ms.png` | `3030c0788583d1d150cd6afd6bcdfea6d2a53b1a05cd55c172d0b25e673a98e0` |
| F01 | far | hit | 0.6 | `F01-far-hit-0600ms.png` | `15c38466f61d542944c502378931ac7469b4d7467df5c0ee49fac31c2cc758e9` |
| F01 | far | hit | 0.8 | `F01-far-hit-0800ms.png` | `55e30f6912b141861c5e94b4244ffffbc45d7757dedfe8d240bc01bdb7688e13` |
| F01 | far | death | 0 | `F01-far-death-0000ms.png` | `55e30f6912b141861c5e94b4244ffffbc45d7757dedfe8d240bc01bdb7688e13` |
| F01 | far | death | 0.225 | `F01-far-death-0225ms.png` | `94659622d2d7cc3fd21b3461699fc02c426023dd7f4641cbe29bcde66537fc5f` |
| F01 | far | death | 0.45 | `F01-far-death-0450ms.png` | `f3573d5a5d4f1d95976904a39ac45887b19cd02c2b51c24d65645977023b018c` |
| F01 | far | death | 0.675 | `F01-far-death-0675ms.png` | `aaf8d0027a107dc62c2721006f49a467f5f9a529916bc2382921a263e4273749` |
| F01 | far | death | 0.9 | `F01-far-death-0900ms.png` | `0107ed3def3d8979030bfe5778f6dab89ba5dc0c5a2dc48163ff5be8332390a2` |
| F01 | far | death | 1.35 | `F01-far-death-1350ms.png` | `0107ed3def3d8979030bfe5778f6dab89ba5dc0c5a2dc48163ff5be8332390a2` |
| F01 | far | death | 1.8 | `F01-far-death-1800ms.png` | `0107ed3def3d8979030bfe5778f6dab89ba5dc0c5a2dc48163ff5be8332390a2` |
| F01 | far | static/front | 0 | `F01-far-static-front.png` | `78f6858ed6cde40b01d89802c471af3f24d41f42c812732c30f8cd796454270f` |
| F01 | far | static/quarter | 0 | `F01-far-static-quarter.png` | `ea4a6c1007d8d3e64dde6b7a6fc5d2346250a74f4c7421318322020e0680a64f` |
| F01 | far | static/rear | 0 | `F01-far-static-rear.png` | `a33f0eb976d620544e0f9a0457abced430fdfbd7f74b6ef67510303824ebae67` |
| R01 | full | idle | 0 | `R01-full-idle-0000ms.png` | `2fc798772e26f7185c6c52a1ae897f596f9a66427ce09527d687ca550b5ec2ec` |
| R01 | full | idle | 0.924 | `R01-full-idle-0924ms.png` | `0e3d5aa1bf7cc211d9387329e632a64f063f8a36453931e16773422ea2a1e5d4` |
| R01 | full | idle | 1.848 | `R01-full-idle-1848ms.png` | `0dcd0e8d1a0a440d0957067cebbacc7298cb43ddb7074af889c558685ca7e9fe` |
| R01 | full | idle | 2.772 | `R01-full-idle-2772ms.png` | `b15c167eec32f459c627dc731036ef4d84005ee39ec4b6a93ba5c3ab1f06b919` |
| R01 | full | idle | 3.696 | `R01-full-idle-3696ms.png` | `bbdb13285a7fc3b264ac5f397383680954e6ca504f86bbc86a23658c676d437e` |
| R01 | full | move | 0 | `R01-full-move-0000ms.png` | `d20369d2ca79ade1ae80cc4c79f404013dc4d1c1bd63faf5668f5828f1517bf2` |
| R01 | full | move | 0.15625 | `R01-full-move-0156ms.png` | `92b8cbe6fe012f160f5f478af41961625f89ae695ec740e726932a47736d67b5` |
| R01 | full | move | 0.3125 | `R01-full-move-0313ms.png` | `d20369d2ca79ade1ae80cc4c79f404013dc4d1c1bd63faf5668f5828f1517bf2` |
| R01 | full | move | 0.46875 | `R01-full-move-0469ms.png` | `47ea0c2142e1e0b14738a2211439dea09ce1d9f5f5f3c4054eb1079addc5c387` |
| R01 | full | move | 0.625 | `R01-full-move-0625ms.png` | `d20369d2ca79ade1ae80cc4c79f404013dc4d1c1bd63faf5668f5828f1517bf2` |
| R01 | full | attack | 0 | `R01-full-attack-0000ms.png` | `d20369d2ca79ade1ae80cc4c79f404013dc4d1c1bd63faf5668f5828f1517bf2` |
| R01 | full | attack | 0.3625 | `R01-full-attack-0363ms.png` | `11e119f9fb75eb024a55a8131c36566f6c19991c3e2b57897b00cc934b2e87bf` |
| R01 | full | attack | 0.725 | `R01-full-attack-0725ms.png` | `a1c14ecac8b80e7485aa60abaddb8be35a85369aedd5884a85de05432e49942b` |
| R01 | full | attack | 1.0875 | `R01-full-attack-1088ms.png` | `78b4c5f0fc32e43a7c7d2fd22360c75ad07440f0de34be2bb4c12220c405a7a8` |
| R01 | full | attack | 1.45 | `R01-full-attack-1450ms.png` | `d20369d2ca79ade1ae80cc4c79f404013dc4d1c1bd63faf5668f5828f1517bf2` |
| R01 | full | hit | 0 | `R01-full-hit-0000ms.png` | `d20369d2ca79ade1ae80cc4c79f404013dc4d1c1bd63faf5668f5828f1517bf2` |
| R01 | full | hit | 0.2 | `R01-full-hit-0200ms.png` | `4b9d70c9f1b80bd41021bed39c32feef2d1b81e329d023bbd846b1e4d202a3cf` |
| R01 | full | hit | 0.4 | `R01-full-hit-0400ms.png` | `c72a040bcb141be90eda071161b6aa047261dccb6dfad9e8806f6cc4882a1d74` |
| R01 | full | hit | 0.6 | `R01-full-hit-0600ms.png` | `a41cb159d052049bb6dd0372f6623e385cb776c79e49da6230e870bef541e828` |
| R01 | full | hit | 0.8 | `R01-full-hit-0800ms.png` | `d20369d2ca79ade1ae80cc4c79f404013dc4d1c1bd63faf5668f5828f1517bf2` |
| R01 | full | death | 0 | `R01-full-death-0000ms.png` | `d20369d2ca79ade1ae80cc4c79f404013dc4d1c1bd63faf5668f5828f1517bf2` |
| R01 | full | death | 0.225 | `R01-full-death-0225ms.png` | `900d921890c95ac5ff0e9613b21a2e4ecc549b30917a22c2f408c4f788086b3c` |
| R01 | full | death | 0.45 | `R01-full-death-0450ms.png` | `1d76698e0cc7cef97784cac9b3462876a9038c48ba3bb69866cbe1a50838e065` |
| R01 | full | death | 0.675 | `R01-full-death-0675ms.png` | `311adeeec2328d31f45f1831e6a6c44673a4b9c47971788e8ccc78a3a41ee7c2` |
| R01 | full | death | 0.9 | `R01-full-death-0900ms.png` | `b727df3f7ebdf73d99545b6d90c12ade6cb59092b187af778a8cb40808c2ba14` |
| R01 | full | death | 1.35 | `R01-full-death-1350ms.png` | `b727df3f7ebdf73d99545b6d90c12ade6cb59092b187af778a8cb40808c2ba14` |
| R01 | full | death | 1.8 | `R01-full-death-1800ms.png` | `b727df3f7ebdf73d99545b6d90c12ade6cb59092b187af778a8cb40808c2ba14` |
| R01 | full | static/front | 0 | `R01-full-static-front.png` | `e77665a906ff65f7eccdb37e9c5934d41d05475c1b646ff5861ef3ff494e1162` |
| R01 | full | static/quarter | 0 | `R01-full-static-quarter.png` | `e491fb824847b51623af9e8ae96f29f7e6d7e96e29a56230c3daf55ff9735da8` |
| R01 | full | static/rear | 0 | `R01-full-static-rear.png` | `d974264583500e557e2a917654ce3d83719be9122a40d42d5f6843a4d0157a70` |
| R01 | medium | idle | 0 | `R01-medium-idle-0000ms.png` | `da7fc61cb6a2549cd5d77d5cfad37844ec117f251862c1d2cf515be382858b00` |
| R01 | medium | idle | 0.924 | `R01-medium-idle-0924ms.png` | `d28e5868e5ffb35425f967d270ff016a414eaeb2e96f7a2152fe9df8caf54c4e` |
| R01 | medium | idle | 1.848 | `R01-medium-idle-1848ms.png` | `cd8e61019671718dfbd9bacd86ef4dd7d09ffcf713507a0aea5fc3fa83154601` |
| R01 | medium | idle | 2.772 | `R01-medium-idle-2772ms.png` | `7cdbb7da22a9ac876eed47363db2792fa712949a44554e2b9d82d705cd75b2c2` |
| R01 | medium | idle | 3.696 | `R01-medium-idle-3696ms.png` | `843e1c58fa0dcd3781b93babbfb2e30d32f51c27f0c089d5acd690cbf1b06868` |
| R01 | medium | move | 0 | `R01-medium-move-0000ms.png` | `da7fc61cb6a2549cd5d77d5cfad37844ec117f251862c1d2cf515be382858b00` |
| R01 | medium | move | 0.15625 | `R01-medium-move-0156ms.png` | `d4724c3a4e8ce0f8f7c5453af1a39de91aefb18cfef9bd59ab49c59f6ede5972` |
| R01 | medium | move | 0.3125 | `R01-medium-move-0313ms.png` | `da7fc61cb6a2549cd5d77d5cfad37844ec117f251862c1d2cf515be382858b00` |
| R01 | medium | move | 0.46875 | `R01-medium-move-0469ms.png` | `dc5d9665f76376eda7038a0225b50c20a3253b74f5d68e564f803303d887d109` |
| R01 | medium | move | 0.625 | `R01-medium-move-0625ms.png` | `da7fc61cb6a2549cd5d77d5cfad37844ec117f251862c1d2cf515be382858b00` |
| R01 | medium | attack | 0 | `R01-medium-attack-0000ms.png` | `da7fc61cb6a2549cd5d77d5cfad37844ec117f251862c1d2cf515be382858b00` |
| R01 | medium | attack | 0.3625 | `R01-medium-attack-0363ms.png` | `4afb22974c7489664c432cb078007e04525e9f7c26afb181e8a1fd89cb90aa90` |
| R01 | medium | attack | 0.725 | `R01-medium-attack-0725ms.png` | `154867d5642e1fa06371b474b741f238b829f1b2e830312ad69bf51fe79db3ab` |
| R01 | medium | attack | 1.0875 | `R01-medium-attack-1088ms.png` | `382005ea2b92d595324d2603551e82fa3b5ce77fa4334e1c890d0f538980da0f` |
| R01 | medium | attack | 1.45 | `R01-medium-attack-1450ms.png` | `da7fc61cb6a2549cd5d77d5cfad37844ec117f251862c1d2cf515be382858b00` |
| R01 | medium | hit | 0 | `R01-medium-hit-0000ms.png` | `da7fc61cb6a2549cd5d77d5cfad37844ec117f251862c1d2cf515be382858b00` |
| R01 | medium | hit | 0.2 | `R01-medium-hit-0200ms.png` | `a509f1ca44ed28e1317f6858aafefac39e90d976e5d5ae48b1a8334a208cee03` |
| R01 | medium | hit | 0.4 | `R01-medium-hit-0400ms.png` | `ee4039979d22e3f826b2b0a4a26e985c8b5935f674ae2e41eac1cc69baa6e2c6` |
| R01 | medium | hit | 0.6 | `R01-medium-hit-0600ms.png` | `bf51e5b4e7816722ddadf7e7e10b8a750d5e4697f814704f93fbee53a6af7677` |
| R01 | medium | hit | 0.8 | `R01-medium-hit-0800ms.png` | `da7fc61cb6a2549cd5d77d5cfad37844ec117f251862c1d2cf515be382858b00` |
| R01 | medium | death | 0 | `R01-medium-death-0000ms.png` | `da7fc61cb6a2549cd5d77d5cfad37844ec117f251862c1d2cf515be382858b00` |
| R01 | medium | death | 0.225 | `R01-medium-death-0225ms.png` | `2afa673b387b779bac30a6762d3f266b57d5414fccca8c7255146a777d0c67f9` |
| R01 | medium | death | 0.45 | `R01-medium-death-0450ms.png` | `dce40d66ed0ab88e58d6bef2a1690e08d60194f22d6f4593c93c5e8e7c536f65` |
| R01 | medium | death | 0.675 | `R01-medium-death-0675ms.png` | `4fcc6ff0d8cc79ad716b001e426d20b242170fa2ce01646677ab0b38f2d141d6` |
| R01 | medium | death | 0.9 | `R01-medium-death-0900ms.png` | `b1bbeb2456640519645ec942842f8b7ee8628d9a24d6734d97b7522576f92392` |
| R01 | medium | death | 1.35 | `R01-medium-death-1350ms.png` | `b1bbeb2456640519645ec942842f8b7ee8628d9a24d6734d97b7522576f92392` |
| R01 | medium | death | 1.8 | `R01-medium-death-1800ms.png` | `b1bbeb2456640519645ec942842f8b7ee8628d9a24d6734d97b7522576f92392` |
| R01 | medium | static/front | 0 | `R01-medium-static-front.png` | `4ac9ea615f27f664fae445053a2c6f51076939515466bce6e02f433a059aa498` |
| R01 | medium | static/quarter | 0 | `R01-medium-static-quarter.png` | `9973bf7f9bdbd3466de53d10202b2a538debe0068af2fed9481a76d8e58c2cc5` |
| R01 | medium | static/rear | 0 | `R01-medium-static-rear.png` | `6ac8594952f05529872d643fef3eb9b2770a5a4057eb8ca75e0135a6662b15b3` |
| R01 | far | idle | 0 | `R01-far-idle-0000ms.png` | `0546496c67d46a1771adfd95b3d7889b1b6d5d99caa69a3f5764e421bae5a405` |
| R01 | far | idle | 0.924 | `R01-far-idle-0924ms.png` | `680796a89769bae4aaf4e763b241c9551c021904ffe1a185038e65827016a2e0` |
| R01 | far | idle | 1.848 | `R01-far-idle-1848ms.png` | `396ae5076a917054498a14a820a8861e2dfcb61732b941618ca29946e2395a08` |
| R01 | far | idle | 2.772 | `R01-far-idle-2772ms.png` | `e39b4fb6ddf3dee713eee5d841c36312960ba93a2c553b62bf96b48b41a4fee9` |
| R01 | far | idle | 3.696 | `R01-far-idle-3696ms.png` | `8d94f98a3b6cca3da6ebd40ceeb8113dc4bea665cb3ff60ec9764b0cc517142a` |
| R01 | far | move | 0 | `R01-far-move-0000ms.png` | `0546496c67d46a1771adfd95b3d7889b1b6d5d99caa69a3f5764e421bae5a405` |
| R01 | far | move | 0.15625 | `R01-far-move-0156ms.png` | `2b2baccea0aec17557dc12de94d2305850950b06ebdbe4e6ce76bfef89ab4d99` |
| R01 | far | move | 0.3125 | `R01-far-move-0313ms.png` | `0546496c67d46a1771adfd95b3d7889b1b6d5d99caa69a3f5764e421bae5a405` |
| R01 | far | move | 0.46875 | `R01-far-move-0469ms.png` | `7468637b78f92aae655208697a97f3772957c45ebb073cac1950dfdfe519b3be` |
| R01 | far | move | 0.625 | `R01-far-move-0625ms.png` | `0546496c67d46a1771adfd95b3d7889b1b6d5d99caa69a3f5764e421bae5a405` |
| R01 | far | attack | 0 | `R01-far-attack-0000ms.png` | `0546496c67d46a1771adfd95b3d7889b1b6d5d99caa69a3f5764e421bae5a405` |
| R01 | far | attack | 0.3625 | `R01-far-attack-0363ms.png` | `3fd0b9551813e5c5001f1b594f773db00bbbcbc1f919b44043be8bbaffe48806` |
| R01 | far | attack | 0.725 | `R01-far-attack-0725ms.png` | `75330a36bfe6632457dfcd82a242b72f0576717e853753966b782fd4fb931959` |
| R01 | far | attack | 1.0875 | `R01-far-attack-1088ms.png` | `076d90af7dd7b5356b20ed1cdec9e6311818097ab5f16c3cd0a56e5f5e11fe2c` |
| R01 | far | attack | 1.45 | `R01-far-attack-1450ms.png` | `0546496c67d46a1771adfd95b3d7889b1b6d5d99caa69a3f5764e421bae5a405` |
| R01 | far | hit | 0 | `R01-far-hit-0000ms.png` | `0546496c67d46a1771adfd95b3d7889b1b6d5d99caa69a3f5764e421bae5a405` |
| R01 | far | hit | 0.2 | `R01-far-hit-0200ms.png` | `e76db2448eb29ab0ed90fdb5c7fd76618c18de1fdac8e89a5e00ae64d00fd25c` |
| R01 | far | hit | 0.4 | `R01-far-hit-0400ms.png` | `dd908670d4aabbf1670946406c024936ea38f800c6141ad968f8d7bfe06f113e` |
| R01 | far | hit | 0.6 | `R01-far-hit-0600ms.png` | `c7321b6196075a2dc548f2f48933375f02108c2548d597511eaf8de3b4f047b5` |
| R01 | far | hit | 0.8 | `R01-far-hit-0800ms.png` | `0546496c67d46a1771adfd95b3d7889b1b6d5d99caa69a3f5764e421bae5a405` |
| R01 | far | death | 0 | `R01-far-death-0000ms.png` | `0546496c67d46a1771adfd95b3d7889b1b6d5d99caa69a3f5764e421bae5a405` |
| R01 | far | death | 0.225 | `R01-far-death-0225ms.png` | `83eb25fd49b76b75c942977017caaad87f81daf85a15ee6189b71ff3fbb714d0` |
| R01 | far | death | 0.45 | `R01-far-death-0450ms.png` | `12ed9a60418a2eeb11746bd3ad40b26b5c4bb58a7bdd3a3cfc3f3ce6664bacfb` |
| R01 | far | death | 0.675 | `R01-far-death-0675ms.png` | `49373f06ce87fc5dae2209efb9122875a8209ad0826992d6fa26d845cb9a2818` |
| R01 | far | death | 0.9 | `R01-far-death-0900ms.png` | `dac7767e29de0b69ced47e3e8f6f2c81914c62336cdd47f45622aa45c9e7b1c7` |
| R01 | far | death | 1.35 | `R01-far-death-1350ms.png` | `dac7767e29de0b69ced47e3e8f6f2c81914c62336cdd47f45622aa45c9e7b1c7` |
| R01 | far | death | 1.8 | `R01-far-death-1800ms.png` | `dac7767e29de0b69ced47e3e8f6f2c81914c62336cdd47f45622aa45c9e7b1c7` |
| R01 | far | static/front | 0 | `R01-far-static-front.png` | `fbc49a521ffab603539b115d3ee299ccb726241d86fbcfcebad72ed9e8cd6a52` |
| R01 | far | static/quarter | 0 | `R01-far-static-quarter.png` | `d099485ed64bb20503c4ae406d7824dadb4f224f8df314b952506b769c9f984b` |
| R01 | far | static/rear | 0 | `R01-far-static-rear.png` | `b0e071a566dbe94ba31b6b202fed8a79aa2d6c6d786934bdcce513652f6ec97a` |
