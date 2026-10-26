# F01/R01 fresh LOD and cape follow-through review — e6277a2f5566

Reviewer: `visual_auditor` on `session/art-audit`.

## Capture provenance and integrity

- Captured source HEAD: `e6277a2f55664fd0fd4a8455dae06364c9d66e29`; the manifest reports a clean worktree at capture.
- This capture includes cape follow-through commit `8357c60`, compared against the prior reviewed source `070064fb060bc084a0344b6f9d0c93ed9c26f645`.
- The Art evidence/status package is recorded by commit `f898787`; the rendered source revision remains the exact `e6277a2` SHA above.
- Capture artifact: `/home/sophia/src/senkei-session-art/docs/evidence/art-production/lod-visual-e6277a2f5566/`; manifest SHA-256 `fd6c00efd6ca8d4cb8964a2ea5d218a3e829bdd9b2d8d1bb816591033b73694f`.
- The manifest expects 180 distinct 1200 × 661 PNGs. I recalculated each manifest image SHA-256 against its raw file; all **180/180** match. Full path/hash references are listed below.
- Chromium `156.0.8078.47`, SwiftShader software GPU, viewport 1440 × 1000 at device scale 1, URL `http://127.0.0.1:4189/`. The manifest has zero page, console, HTTP, and failed-request errors.
- Each F01/R01 × full/medium/far set contains static front/quarter/rear and idle, move, attack, hit, and death samples. Each image records the explicitly selected visible LOD child. The manifest reports 54 same-camera cross-LOD action comparisons with zero observed root/joint pose delta.
- I inspected all 180 full-resolution originals, not only contact sheets. This is the production Hero Detail preview builder under an inspection-only LOD override. It is an isolated same-camera preview, not actual Battlefield Replay, expected-size near/mid/far Battlefield presentation, or automatic LOD selection.

## Scoring rubric and provisional results

The production rubric scores 0–5: 0 missing/unassessable, 1 major break, 2 conspicuous defect, 3 functional but needs improvement, 4 adoption quality, 5 beyond target. Goal-axis weights are Identity 30%, Silhouette/Proportion 25%, Geometry/Material 20%, Animation 15%, Tactical Readability 10%; each axis must be at least 3.5 and the weighted score at least 4.0. Tactical Readability is not shown, so a weighted Goal score is **NOT_CALCULATED**. These are candidate preview scores only, not Hard Gate acceptance.

### Visual axes by candidate and selected LOD

| Hero | LOD | Identity | Silhouette / Proportion | Geometry / Material | Evidence-based note |
| --- | --- | ---: | ---: | ---: | --- |
| F01 | Full | 4.0 | 4.0 | 4.0 | Helmet, banner, sword/shield, armor, and tapered cape distinguish the commander. |
| F01 | Medium | 4.0 | 4.0 | 3.5 | Main role silhouette and equipment remain; fine armor facets and trim simplify. |
| F01 | Far | 4.0 | 4.0 | 3.5 | Role silhouette and weapons remain readable in the controlled framing; small details simplify. |
| R01 | Full | 4.0 | 4.0 | 4.0 | Hood, long tunic, cape, staff, and distinct armor response identify the channeler. |
| R01 | Medium | 4.0 | 4.0 | 3.5 | Role silhouette and staff remain; material and cloth detail are reduced. |
| R01 | Far | 4.0 | 4.0 | 3.5 | Hood, tunic, cape, and staff remain visible; folds and cloth response are weaker. |

### Action scores by candidate, LOD, and sampled action

Preview-animation mean is the unweighted mean of the five action scores; it is not a full Animation Hard Gate result.

| Hero | LOD | Idle | Move | Attack | Hit | Death | Animation preview mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| F01 | Full | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |
| F01 | Medium | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |
| F01 | Far | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |
| R01 | Full | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |
| R01 | Medium | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |
| R01 | Far | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |

### Fresh-image findings

#### F01

- **Identity and silhouette:** Front/quarter/rear views retain the helmet, banner, sword and shield, armor, and tapered folded cape at all three LODs. Sword remains visible and connected. No separate-shield chest read or new silhouette break appears.
- **Idle (3.5, all LODs):** Breathing/head and torso shifts are visible but modest. Cape edge movement is slight in this action; it does not become a soft, independently deforming cloth surface.
- **Move (4.0, all LODs):** Alternating leg poses and shield-arm counter-motion read clearly. In the new `F01-*-move-0469ms` images, the cape is more visibly displaced behind and to the side than in the corresponding `070064f` samples. Its follow-through improves the sense of motion without separating from the shoulders. The model remains stationary in this harness, so world translation and continuous foot planting are not established.
- **Attack (4.0, all LODs):** The connected sword remains clear through wind-up, diagonal strike, follow-through, and return. Cape rotation is visible behind the torso during the sampled phases; it does not obscure the sword or create definite body/weapon penetration.
- **Hit (4.0, all LODs):** Torso/head recoil and recovery remain clear. Compared with `070064f`, the cape shows a stronger delayed panel angle around the 0.2–0.4 second recoil, then returns toward its rest position. No definite clipping or detachment is visible.
- **Death (4.0, all LODs):** The side fall settles by 0.9 seconds; 0.9/1.35/1.8 second endpoint PNGs are identical within each LOD. The cape follows the fall but remains a rigid faceted sheet. This isolated preview does not prove collision or a live Replay transition.

#### R01

- **Identity and silhouette:** Hood, long tunic, sleeves, staff, and tapered cape remain recognizable in static views and all selected LODs. The staff crystal and shaft remain continuous in sampled poses.
- **Idle (3.5, all LODs):** Head/torso sway is visible; the cape edge moves only modestly with the body. It remains a restrained preview cycle.
- **Move (4.0, all LODs):** Alternating legs and arm movement are visible, although the long robe masks some lower-leg articulation. In `R01-*-move-0469ms`, the cape trails farther to the back/camera side than in the matching `070064f` samples. This is the clearest R01 follow-through change. The staff remains in hand. World travel and gait foot planting are not shown.
- **Attack (4.0, all LODs):** Staff-led wind-up, sweep/follow-through, and return read at full/medium/far. At 0.3625/0.725/1.0875 seconds the staff head and shaft remain visible at far LOD. Cape angular lag is present but less visually prominent than in the walking and hit samples because the robe/body occludes much of the panel during attack. No definite staff/cape collision or loss is visible.
- **Hit (4.0, all LODs):** Torso/head recoil and return are clear; the staff follows the arm. The new cape angle is visibly delayed during the 0.2–0.4 second recoil and settles by 0.6–0.8 seconds. It follows as a rigid panel rather than flexing like cloth.
- **Death (4.0, all LODs):** R01 tips to a near-horizontal side-lying pose by 0.9 seconds. Endpoint images at 0.9/1.35/1.8 seconds are identical within each LOD and read as a completed held fall. Shadow and the preview ground plane do not establish physical contact or collision.

#### Cape follow-through comparison and remaining visual limits

- Direct same-camera comparisons against `070064f` show a stronger angular follow-through, most clearly on F01 and R01 walking at 0.46875 seconds and on hit recoil around 0.2–0.4 seconds. The cape visibly moves behind the Hero rather than staying at one fixed angle. The attack samples also retain visible trailing response, though less clearly for R01 where the body and robe hide the cape.
- No new sampled weapon/cape detachment, body clipping, or loss of F01 sword/R01 staff is visible. This supports a visual improvement to follow-through; it does not establish cloth simulation. The cape still moves as a single stiff faceted panel and shows little local fold deformation or independent tail motion.
- Across full/medium/far at this single preview camera, pose and equipment remain coherent. Cloth facets and small trim simplify with selected LOD. The manifest’s visibility vectors and zero pose-delta checks support the controlled comparison but do not represent automatic selection or battlefield-scale views.
- Expected-size near/mid/far views in actual Battlefield/Tactical remain a separate acceptance requirement. Live Replay integration, automatic LOD transitions, and real GPU performance are outside this artifact.

## Hard Gate boundaries

| Hard Gate | Overall status | What this evidence establishes / does not establish |
| --- | --- | --- |
| Identity | NOT_CHECKED | Visual role distinction is supported for F01/R01 only; full catalog and final production acceptance are outside this review. |
| Geometry | NOT_CHECKED | No definite sampled clipping/detachment appears; Battlefield geometry/collision are not captured. |
| Material | NOT_CHECKED | Surface response remains visible and reduces at lower LOD; no controlled shader/lighting A/B or actual app lighting review. |
| Animation | NOT_CHECKED | Five isolated preview actions only; live Replay timing, skills, respawn, and combat events are untested. |
| LOD | NOT_CHECKED | LOD children are manually selected at one same-camera preview; expected screen sizes, automatic switching, and transitions are untested. |
| Integration | NOT_CHECKED | No actual Battlefield/Replay capture is included. |
| Determinism | NOT_CHECKED | Manifest and hashes verify one capture; no cross-run Replay/image comparison was performed. |
| Reproducibility | NOT_CHECKED | Source, conditions, manifest, and hashes are recorded; another clean recapture was not performed. |

Physical GPU/device performance is **NOT_CHECKED** because capture used Chromium SwiftShader. Tactical Readability is absent; the weighted Goal score is **NOT_CALCULATED**. Preview scores do not establish Golden acceptance or completion of either production Goal.

## Raw image SHA-256 references

Paths are relative to `/home/sophia/src/senkei-session-art/docs/evidence/art-production/lod-visual-e6277a2f5566/`. The hashes below were independently recomputed and matched the manifest for every raw image.

| Hero | LOD | Pose / view | Time (s) | PNG | SHA-256 |
| --- | --- | --- | ---: | --- | --- |
| F01 | full | idle | 0 | `images/F01-full-idle-0000ms.png` | `f362a9a212a3a8d594cccb9a5a0d8e53f0a159f69599193530b851bc3cb0afd7` |
| F01 | full | idle | 0.924 | `images/F01-full-idle-0924ms.png` | `d2ed8403a2ef2583c126a04e62a94b98aeb41809450a315108ce99df65ae076e` |
| F01 | full | idle | 1.848 | `images/F01-full-idle-1848ms.png` | `68e2126b3fad8fb8a825edcdd328d4ba91d8bfc15d078c6c22fb42eefb2b3f4e` |
| F01 | full | idle | 2.772 | `images/F01-full-idle-2772ms.png` | `3add260b33d689910cb153387f9377f8ef5a2ec8ed2f836b56bd598986bac227` |
| F01 | full | idle | 3.696 | `images/F01-full-idle-3696ms.png` | `95e22118cae74afe57624325f104445d35f25aa5484b1adac3f2d1bd4487ee7f` |
| F01 | full | move | 0 | `images/F01-full-move-0000ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | move | 0.15625 | `images/F01-full-move-0156ms.png` | `2f1004987e8e683d8fff0332f0f8acd7489683df1b5ea8a95b1a26461f1a3bda` |
| F01 | full | move | 0.3125 | `images/F01-full-move-0313ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | move | 0.46875 | `images/F01-full-move-0469ms.png` | `776566d7a76b73f31b8f5a3f56a42e9abfc5f85a1cbf052188afba96d7166904` |
| F01 | full | move | 0.625 | `images/F01-full-move-0625ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | attack | 0 | `images/F01-full-attack-0000ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | attack | 0.3625 | `images/F01-full-attack-0363ms.png` | `2c7e5be9fdcbe2c7c063e69d58655d0d574459a7c1bcfeeff995e36739e29ff7` |
| F01 | full | attack | 0.725 | `images/F01-full-attack-0725ms.png` | `50d960af7d7b3b4397aebbf2eecfb862f8059067f39a58b04ae2b26726fd9f25` |
| F01 | full | attack | 1.0875 | `images/F01-full-attack-1088ms.png` | `ce40104050ee406ecd04cf51dbad621cb77e2f56d388cf7b55b9a847f53913d4` |
| F01 | full | attack | 1.45 | `images/F01-full-attack-1450ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | hit | 0 | `images/F01-full-hit-0000ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | hit | 0.2 | `images/F01-full-hit-0200ms.png` | `811a71af44529f022397cb78887119fdc16a3f859fa021d025c3e20888b524fa` |
| F01 | full | hit | 0.4 | `images/F01-full-hit-0400ms.png` | `77110cd9305eae6b8c1f8ca90f6fbba1317bfac427e4da6f194ef3552b47e6dd` |
| F01 | full | hit | 0.6 | `images/F01-full-hit-0600ms.png` | `713558385288da45bb60274115473daaa573ba4f3a24df68950ccc112af1ae5c` |
| F01 | full | hit | 0.8 | `images/F01-full-hit-0800ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | death | 0 | `images/F01-full-death-0000ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | death | 0.225 | `images/F01-full-death-0225ms.png` | `04a0abb3a2a42ecb4d76e07ebf3333c6bb501fce17dfc836bd2969d8c8c69024` |
| F01 | full | death | 0.45 | `images/F01-full-death-0450ms.png` | `ebcbecd21795ba3cd7aa4b2a7a2d714bd68af34261c1fbd154f74612bd153312` |
| F01 | full | death | 0.675 | `images/F01-full-death-0675ms.png` | `422c511fbc5c4c51c5ff6ba8e5ccf9fc4367cd236e8e80b4e9dd6b9beacf20e9` |
| F01 | full | death | 0.9 | `images/F01-full-death-0900ms.png` | `e876a6bbee89e8fcec314261b4e4e45f04cac24c31de0c191f931138e7ae6913` |
| F01 | full | death | 1.35 | `images/F01-full-death-1350ms.png` | `e876a6bbee89e8fcec314261b4e4e45f04cac24c31de0c191f931138e7ae6913` |
| F01 | full | death | 1.8 | `images/F01-full-death-1800ms.png` | `e876a6bbee89e8fcec314261b4e4e45f04cac24c31de0c191f931138e7ae6913` |
| F01 | full | static/front | 0 | `images/F01-full-static-front.png` | `1a18aded0893de947183780b8431ffbdbfe481500accf10b8eb6a26204bd23df` |
| F01 | full | static/quarter | 0 | `images/F01-full-static-quarter.png` | `fc7ff83ddd03e1894238c2f5186bf6c65f67d95e8759784c08feeecff6d5659f` |
| F01 | full | static/rear | 0 | `images/F01-full-static-rear.png` | `a697d6e0abdaafe4de023db4cea140ebf0d6bfa3adf87ad2c5ac03068eafb5e0` |
| F01 | medium | idle | 0 | `images/F01-medium-idle-0000ms.png` | `9c4a1383f60a4fe62f8c1cb699ee02b38da8d1e16acd3460e28f1fb68709b68e` |
| F01 | medium | idle | 0.924 | `images/F01-medium-idle-0924ms.png` | `d2c43a4a88ac4476e0570866284f52aae638f4f5228d554e66015d5c337a77c9` |
| F01 | medium | idle | 1.848 | `images/F01-medium-idle-1848ms.png` | `43ea10597364bd2f6c755c791873913dee47d601c0bbacca261704a55cc5a6a8` |
| F01 | medium | idle | 2.772 | `images/F01-medium-idle-2772ms.png` | `ffbd2c15fca843ac43636efc843b7d2f00f61e1ade19d34397e797e630e21008` |
| F01 | medium | idle | 3.696 | `images/F01-medium-idle-3696ms.png` | `2f83b5402d22f7b4dabacea9615bfc4de7786c1ddf8289d0ad082aa8bf1ba99b` |
| F01 | medium | move | 0 | `images/F01-medium-move-0000ms.png` | `98f0d41f6b3f6c32eaa39f9ee1d54295c739892c6769aad7b44c6bf8f8d2ec4e` |
| F01 | medium | move | 0.15625 | `images/F01-medium-move-0156ms.png` | `8d1765746c805fc790b4d6feebe2c1188703660a549b6e2262289b3315965abd` |
| F01 | medium | move | 0.3125 | `images/F01-medium-move-0313ms.png` | `98f0d41f6b3f6c32eaa39f9ee1d54295c739892c6769aad7b44c6bf8f8d2ec4e` |
| F01 | medium | move | 0.46875 | `images/F01-medium-move-0469ms.png` | `178635d4df5fccba5cf32c9b6d5236341750720678c7dcda7908bda6c73ef30a` |
| F01 | medium | move | 0.625 | `images/F01-medium-move-0625ms.png` | `98f0d41f6b3f6c32eaa39f9ee1d54295c739892c6769aad7b44c6bf8f8d2ec4e` |
| F01 | medium | attack | 0 | `images/F01-medium-attack-0000ms.png` | `98f0d41f6b3f6c32eaa39f9ee1d54295c739892c6769aad7b44c6bf8f8d2ec4e` |
| F01 | medium | attack | 0.3625 | `images/F01-medium-attack-0363ms.png` | `76dfaf22707697b0fdac8b44f83ae33b7bf810e0be4b53c879e923394f5a77c4` |
| F01 | medium | attack | 0.725 | `images/F01-medium-attack-0725ms.png` | `78c5bda6e475cae1bf63c908c0a48d68d92f3cf5c6f70502031be6eb26f962d4` |
| F01 | medium | attack | 1.0875 | `images/F01-medium-attack-1088ms.png` | `3d456f5d73f05f2938c6ecc7f422e1d60cff95901c1c25cbf27d4d48b5dca3d6` |
| F01 | medium | attack | 1.45 | `images/F01-medium-attack-1450ms.png` | `98f0d41f6b3f6c32eaa39f9ee1d54295c739892c6769aad7b44c6bf8f8d2ec4e` |
| F01 | medium | hit | 0 | `images/F01-medium-hit-0000ms.png` | `98f0d41f6b3f6c32eaa39f9ee1d54295c739892c6769aad7b44c6bf8f8d2ec4e` |
| F01 | medium | hit | 0.2 | `images/F01-medium-hit-0200ms.png` | `274c510094b5774cd860a12345d48fcfc7da07f33d27ea25bc88e9da4289d287` |
| F01 | medium | hit | 0.4 | `images/F01-medium-hit-0400ms.png` | `7b60e3965e131533c16ed3449a30ec4591964d54c3c4b0539a473eef045154ee` |
| F01 | medium | hit | 0.6 | `images/F01-medium-hit-0600ms.png` | `ad251b3ba2f3f042da998b77009b8c8f7560fc240b9a854ed73e65f60ff57c82` |
| F01 | medium | hit | 0.8 | `images/F01-medium-hit-0800ms.png` | `98f0d41f6b3f6c32eaa39f9ee1d54295c739892c6769aad7b44c6bf8f8d2ec4e` |
| F01 | medium | death | 0 | `images/F01-medium-death-0000ms.png` | `98f0d41f6b3f6c32eaa39f9ee1d54295c739892c6769aad7b44c6bf8f8d2ec4e` |
| F01 | medium | death | 0.225 | `images/F01-medium-death-0225ms.png` | `d9b45bd84a3d46a6be8c51564d12ac1e27d1442d11fb9e5cd17d7e7dd7d34403` |
| F01 | medium | death | 0.45 | `images/F01-medium-death-0450ms.png` | `38533c20417f3837dfb0b0c086d06f7153ec840dbf9ec97c13ef2abaac0d1f48` |
| F01 | medium | death | 0.675 | `images/F01-medium-death-0675ms.png` | `54f7367d9ff4cc17212a9c47c255806573fa39e15a9438c4a414fdc714a6ce2c` |
| F01 | medium | death | 0.9 | `images/F01-medium-death-0900ms.png` | `ad9a4ff88fe242e0df3d8ae6214b1334b93852a4e1378be6d65d2f7f0b130253` |
| F01 | medium | death | 1.35 | `images/F01-medium-death-1350ms.png` | `ad9a4ff88fe242e0df3d8ae6214b1334b93852a4e1378be6d65d2f7f0b130253` |
| F01 | medium | death | 1.8 | `images/F01-medium-death-1800ms.png` | `ad9a4ff88fe242e0df3d8ae6214b1334b93852a4e1378be6d65d2f7f0b130253` |
| F01 | medium | static/front | 0 | `images/F01-medium-static-front.png` | `ef903ba37f9b01946d476fd5901b85164c9364c5f89eee43b4a89f9a714953a3` |
| F01 | medium | static/quarter | 0 | `images/F01-medium-static-quarter.png` | `7fd390332c541c8c75d79af15c41ff0bccede80434507243e85d0635dd7fd87a` |
| F01 | medium | static/rear | 0 | `images/F01-medium-static-rear.png` | `25667e56af1db3e3ebdd7ac60739af8cacdd18fb4e06419d002429c0dca61274` |
| F01 | far | idle | 0 | `images/F01-far-idle-0000ms.png` | `ab97a8c7cd28265ff8130f39c7da7fa03fb44bfec9bf6292dc748b7e7cca5f83` |
| F01 | far | idle | 0.924 | `images/F01-far-idle-0924ms.png` | `07cff47a7bfd0e91ebd216a100e4608aaf380c81615aeae9d4222d6fce512147` |
| F01 | far | idle | 1.848 | `images/F01-far-idle-1848ms.png` | `3e6a7c6fdda79e3099bac3ccbe8ecc7efb632228bc3ab3493a6001f78f4e37f3` |
| F01 | far | idle | 2.772 | `images/F01-far-idle-2772ms.png` | `af05b13f20027a5ee69da2369848201905e2b30041a6a950cb9ba856b2f8014a` |
| F01 | far | idle | 3.696 | `images/F01-far-idle-3696ms.png` | `d70371d4c36b4cb7a925b02a6c3f1da1ec389a6ee7b29d0bc887f0d72276fba5` |
| F01 | far | move | 0 | `images/F01-far-move-0000ms.png` | `0e847170659676d74ebb94c95ef2895de2937c6cfcf819a49de86a6f694a88da` |
| F01 | far | move | 0.15625 | `images/F01-far-move-0156ms.png` | `aebfb40efb579903c71cceaffe96beda5436c947a40ddf52065ab4c24db184bd` |
| F01 | far | move | 0.3125 | `images/F01-far-move-0313ms.png` | `0e847170659676d74ebb94c95ef2895de2937c6cfcf819a49de86a6f694a88da` |
| F01 | far | move | 0.46875 | `images/F01-far-move-0469ms.png` | `ff1a6c689613bd67082475871eb390b1bb83684c3527235375ac7907e23128d0` |
| F01 | far | move | 0.625 | `images/F01-far-move-0625ms.png` | `0e847170659676d74ebb94c95ef2895de2937c6cfcf819a49de86a6f694a88da` |
| F01 | far | attack | 0 | `images/F01-far-attack-0000ms.png` | `0e847170659676d74ebb94c95ef2895de2937c6cfcf819a49de86a6f694a88da` |
| F01 | far | attack | 0.3625 | `images/F01-far-attack-0363ms.png` | `0c54cbafa212ad8bdb566918c44bb195bc94a2a05e0e1effd82d4056e3be73db` |
| F01 | far | attack | 0.725 | `images/F01-far-attack-0725ms.png` | `387c74a18c9b8b49ad5d99e50477fd1a1c326005ad01cc8efa118a9c8d38bf78` |
| F01 | far | attack | 1.0875 | `images/F01-far-attack-1088ms.png` | `90568032dcb54f189aba5c078068ab1c1ba4492b3f61621e2b66755f5c2dbc8b` |
| F01 | far | attack | 1.45 | `images/F01-far-attack-1450ms.png` | `0e847170659676d74ebb94c95ef2895de2937c6cfcf819a49de86a6f694a88da` |
| F01 | far | hit | 0 | `images/F01-far-hit-0000ms.png` | `0e847170659676d74ebb94c95ef2895de2937c6cfcf819a49de86a6f694a88da` |
| F01 | far | hit | 0.2 | `images/F01-far-hit-0200ms.png` | `7211552b0fdb529e6943628e3011860c150b86fd6dd7e923c4a1f38d69b80f94` |
| F01 | far | hit | 0.4 | `images/F01-far-hit-0400ms.png` | `7c09829bbbaec62926d8922e008dc6af4b210207f98f578c2268a8523d160470` |
| F01 | far | hit | 0.6 | `images/F01-far-hit-0600ms.png` | `c20f170f291e002054f45e2b443d75fc8e020394dc67082a9d948dbdd3372ef5` |
| F01 | far | hit | 0.8 | `images/F01-far-hit-0800ms.png` | `0e847170659676d74ebb94c95ef2895de2937c6cfcf819a49de86a6f694a88da` |
| F01 | far | death | 0 | `images/F01-far-death-0000ms.png` | `0e847170659676d74ebb94c95ef2895de2937c6cfcf819a49de86a6f694a88da` |
| F01 | far | death | 0.225 | `images/F01-far-death-0225ms.png` | `51ca4adb0768b5cbed1be80dbbb2ce62f1a533c2cd5b26ad781ba2f5bee32c76` |
| F01 | far | death | 0.45 | `images/F01-far-death-0450ms.png` | `cac7948749e992cb433a5bffdc830e8c831177200a8a07abbcf2c425188196f0` |
| F01 | far | death | 0.675 | `images/F01-far-death-0675ms.png` | `e4ca4324cb0b0cf34229338b051facdc5d77aff4e53defd4decd26cd3f2e463f` |
| F01 | far | death | 0.9 | `images/F01-far-death-0900ms.png` | `b10ed983b4cea5d66906649f18962f59cc892ed583eed60c1aea26b99dc7f689` |
| F01 | far | death | 1.35 | `images/F01-far-death-1350ms.png` | `b10ed983b4cea5d66906649f18962f59cc892ed583eed60c1aea26b99dc7f689` |
| F01 | far | death | 1.8 | `images/F01-far-death-1800ms.png` | `b10ed983b4cea5d66906649f18962f59cc892ed583eed60c1aea26b99dc7f689` |
| F01 | far | static/front | 0 | `images/F01-far-static-front.png` | `ab69d58043afd35cc9c4a51dc94f1b8eee06027cc4a3fa8bffc09314f194397f` |
| F01 | far | static/quarter | 0 | `images/F01-far-static-quarter.png` | `e757bd727de2df3c37991b3d0064499b6c201690c3ee1051f57c041dfeac14c3` |
| F01 | far | static/rear | 0 | `images/F01-far-static-rear.png` | `6aa809af8a5cc0958e6ae6ec6317e2d9ebe9e34d460d093edaaae28784e81000` |
| R01 | full | idle | 0 | `images/R01-full-idle-0000ms.png` | `e4a748e9a066187a5b37475bb1eedc306dfc150a3176cc97528bacbe0488e18e` |
| R01 | full | idle | 0.924 | `images/R01-full-idle-0924ms.png` | `184df9aa43ad5357b8c3d9748ff20edda651a07f537b1e2786a0ff02f0c84346` |
| R01 | full | idle | 1.848 | `images/R01-full-idle-1848ms.png` | `4d855d2d116ed60080b04a8fab46ee11aaf59d6b7fca67e6a5c97456882cc639` |
| R01 | full | idle | 2.772 | `images/R01-full-idle-2772ms.png` | `f9f79215adbe26f2970a70a7fcf44e89e89e4ce7ec385042a9ceeabf30e1051d` |
| R01 | full | idle | 3.696 | `images/R01-full-idle-3696ms.png` | `cc5447e60a890867288a99e3ab54fa213e617f4d59f199aab6bfc6fc3e211c6d` |
| R01 | full | move | 0 | `images/R01-full-move-0000ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | move | 0.15625 | `images/R01-full-move-0156ms.png` | `15dbd703dbee5c2a7a5474ecd495cd28edbefc9de292bd7dd90fc38a266e186c` |
| R01 | full | move | 0.3125 | `images/R01-full-move-0313ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | move | 0.46875 | `images/R01-full-move-0469ms.png` | `bc95da2c6f09deefa1c8d688b237f5e00426843c8d40d62da1183401f174199e` |
| R01 | full | move | 0.625 | `images/R01-full-move-0625ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | attack | 0 | `images/R01-full-attack-0000ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | attack | 0.3625 | `images/R01-full-attack-0363ms.png` | `4828486ed49775c5dae998c6af7c04cea796ea0c4c8ce7bc6df5034625457637` |
| R01 | full | attack | 0.725 | `images/R01-full-attack-0725ms.png` | `67e16c4a1588468b462e4cf152aca7b729fd78b2d76278edaf4dfd2cc600e5f4` |
| R01 | full | attack | 1.0875 | `images/R01-full-attack-1088ms.png` | `4cbeea93ed7fdd8659cf221cb3cc66ba068f32571532326248c82a66a377743d` |
| R01 | full | attack | 1.45 | `images/R01-full-attack-1450ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | hit | 0 | `images/R01-full-hit-0000ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | hit | 0.2 | `images/R01-full-hit-0200ms.png` | `3ebd05dc97cd92ad46706f4360bc76c44dba5f58d2f232aa0e93313166bd0f5c` |
| R01 | full | hit | 0.4 | `images/R01-full-hit-0400ms.png` | `e1da5f308acbd72a2a0e571c3e8fc95ff803c1250d3bb5c9c0765d1573b41b37` |
| R01 | full | hit | 0.6 | `images/R01-full-hit-0600ms.png` | `225de198928c93cf1276ede6b7542ae48703e7636dfc6177146292b7c52f64df` |
| R01 | full | hit | 0.8 | `images/R01-full-hit-0800ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | death | 0 | `images/R01-full-death-0000ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | death | 0.225 | `images/R01-full-death-0225ms.png` | `d5e7e52539367cb10ddb3056e4141082533d294df9853a4c21ddd722ebb7f092` |
| R01 | full | death | 0.45 | `images/R01-full-death-0450ms.png` | `96b9672f10e8f8b049412192f6527ab729828c84dd07acd6dd17f9371641325b` |
| R01 | full | death | 0.675 | `images/R01-full-death-0675ms.png` | `6bca06fe08f20ca616363ab9f4a2f78cb8a2ab454440df54161ecb706837eb7d` |
| R01 | full | death | 0.9 | `images/R01-full-death-0900ms.png` | `2d8c6dd3e28632f14572622eb2297287aedad791fece58a112e34519b29a429d` |
| R01 | full | death | 1.35 | `images/R01-full-death-1350ms.png` | `2d8c6dd3e28632f14572622eb2297287aedad791fece58a112e34519b29a429d` |
| R01 | full | death | 1.8 | `images/R01-full-death-1800ms.png` | `2d8c6dd3e28632f14572622eb2297287aedad791fece58a112e34519b29a429d` |
| R01 | full | static/front | 0 | `images/R01-full-static-front.png` | `bcce7722143ab701a3fd0bc4290a03bbccd95b25e29b9983892770ad0c5929fb` |
| R01 | full | static/quarter | 0 | `images/R01-full-static-quarter.png` | `9009d69be7c070550ac6c70c2fe4291ea4b055df5305aa8bdef506cf5fc8a18c` |
| R01 | full | static/rear | 0 | `images/R01-full-static-rear.png` | `83024e2524fc2a29228196b3aeb0ad85505606c041e0cb7e55477e3163678af6` |
| R01 | medium | idle | 0 | `images/R01-medium-idle-0000ms.png` | `4aaf1a572bea18c5194aadc86dea698f2192c34e6e69f4b2218ffbe0f19b3b27` |
| R01 | medium | idle | 0.924 | `images/R01-medium-idle-0924ms.png` | `b0f4fff96c5f6385c04081c4ed5977e48e1effe98896dec99e62ed278776eb53` |
| R01 | medium | idle | 1.848 | `images/R01-medium-idle-1848ms.png` | `5807f14d5958251274863b24ebaed86f8a92dd8fa750b1beb13ca20acb9cc067` |
| R01 | medium | idle | 2.772 | `images/R01-medium-idle-2772ms.png` | `87cfaf6152f51fca38a759c2b18e897a54e6376a3f800ea14dcd63c48b5ae88f` |
| R01 | medium | idle | 3.696 | `images/R01-medium-idle-3696ms.png` | `ccfdf866368cdf0529696a4f0c692748d07ee7719a2df39f17d6dc3282834e18` |
| R01 | medium | move | 0 | `images/R01-medium-move-0000ms.png` | `57f72ec0156b4598c66cabcd8df0ff01f6f602f1366bc4f92eb95016d822fc49` |
| R01 | medium | move | 0.15625 | `images/R01-medium-move-0156ms.png` | `12c270c02ec793d1109ee248f57ffdf3c9c74035ec895c0620cccab502c5391f` |
| R01 | medium | move | 0.3125 | `images/R01-medium-move-0313ms.png` | `57f72ec0156b4598c66cabcd8df0ff01f6f602f1366bc4f92eb95016d822fc49` |
| R01 | medium | move | 0.46875 | `images/R01-medium-move-0469ms.png` | `f080eb90ab75bb456eef2270272ebc179a583244453aad2ac48dc3dcb9b2d2de` |
| R01 | medium | move | 0.625 | `images/R01-medium-move-0625ms.png` | `57f72ec0156b4598c66cabcd8df0ff01f6f602f1366bc4f92eb95016d822fc49` |
| R01 | medium | attack | 0 | `images/R01-medium-attack-0000ms.png` | `57f72ec0156b4598c66cabcd8df0ff01f6f602f1366bc4f92eb95016d822fc49` |
| R01 | medium | attack | 0.3625 | `images/R01-medium-attack-0363ms.png` | `00733812426c9cce968da01f61e425e3cc7c079d5ebbd6e244181649ef7aadf7` |
| R01 | medium | attack | 0.725 | `images/R01-medium-attack-0725ms.png` | `5105f57196dae1235b159a74cde53a221beba019818ba55b10878441131eefb5` |
| R01 | medium | attack | 1.0875 | `images/R01-medium-attack-1088ms.png` | `11f725c9f18aa37f83551d0a50791ab30121d2c0fd40fd21c1d5d3cafe7fc044` |
| R01 | medium | attack | 1.45 | `images/R01-medium-attack-1450ms.png` | `57f72ec0156b4598c66cabcd8df0ff01f6f602f1366bc4f92eb95016d822fc49` |
| R01 | medium | hit | 0 | `images/R01-medium-hit-0000ms.png` | `57f72ec0156b4598c66cabcd8df0ff01f6f602f1366bc4f92eb95016d822fc49` |
| R01 | medium | hit | 0.2 | `images/R01-medium-hit-0200ms.png` | `678e53ac18059625d5a189edb1daadc12b57323a9663e47abaf8e479b44082fa` |
| R01 | medium | hit | 0.4 | `images/R01-medium-hit-0400ms.png` | `adbc4fd94ed72983a8c4fe4714f62667c7497a00e37b34af882902fff69b3756` |
| R01 | medium | hit | 0.6 | `images/R01-medium-hit-0600ms.png` | `4ae78f55185809c7dcf0bbdb5c7dc712b64a6d9249b14f8b986bd4d5a5205476` |
| R01 | medium | hit | 0.8 | `images/R01-medium-hit-0800ms.png` | `57f72ec0156b4598c66cabcd8df0ff01f6f602f1366bc4f92eb95016d822fc49` |
| R01 | medium | death | 0 | `images/R01-medium-death-0000ms.png` | `57f72ec0156b4598c66cabcd8df0ff01f6f602f1366bc4f92eb95016d822fc49` |
| R01 | medium | death | 0.225 | `images/R01-medium-death-0225ms.png` | `82b8f8bd8cfa9129799593b5f84a3080d8f721c4799b0936b4d39eb32bb44203` |
| R01 | medium | death | 0.45 | `images/R01-medium-death-0450ms.png` | `daa8adb76c313cbf9723ce188ec8367b0f5907308c6d007f18e4ff8d62c6d680` |
| R01 | medium | death | 0.675 | `images/R01-medium-death-0675ms.png` | `315395e42052392253db671cbe6b77332e2a75658f4eb5379a8d4cc5c56ee85b` |
| R01 | medium | death | 0.9 | `images/R01-medium-death-0900ms.png` | `adb3a3f412d989b8cefa0f58fec7fbef46af9d680a19e54b2b4c57b9e7975edf` |
| R01 | medium | death | 1.35 | `images/R01-medium-death-1350ms.png` | `adb3a3f412d989b8cefa0f58fec7fbef46af9d680a19e54b2b4c57b9e7975edf` |
| R01 | medium | death | 1.8 | `images/R01-medium-death-1800ms.png` | `adb3a3f412d989b8cefa0f58fec7fbef46af9d680a19e54b2b4c57b9e7975edf` |
| R01 | medium | static/front | 0 | `images/R01-medium-static-front.png` | `fddd783d7444f16a348dd56f97c0e5a9b9f4222299f3523f121dc3bcd4d4ea66` |
| R01 | medium | static/quarter | 0 | `images/R01-medium-static-quarter.png` | `6c6157b3c395ec2af8dd7023b170acc4c97317a17b4f08b2ba1f2c2feb1ad633` |
| R01 | medium | static/rear | 0 | `images/R01-medium-static-rear.png` | `26560add4327742258b3c1c5f0b8f71f56b3ad6bdef314fd47ffe1a9748680c4` |
| R01 | far | idle | 0 | `images/R01-far-idle-0000ms.png` | `147f4a8155014a13e40b7242b1b763b23d0590f064c1ee0e27c163d13f0e1efe` |
| R01 | far | idle | 0.924 | `images/R01-far-idle-0924ms.png` | `6a94a3c8ef3e50c58184be3983c8ddf2f3c3b4a19566b45c46be96de6a4145db` |
| R01 | far | idle | 1.848 | `images/R01-far-idle-1848ms.png` | `74ee19f52ace7fcfabb634de253efd83594b04e4059a97fd98140a93bab14594` |
| R01 | far | idle | 2.772 | `images/R01-far-idle-2772ms.png` | `80b355f2f3a248ae9c29337867fe40538463b9b36289cbccb8465a3a17b3c75f` |
| R01 | far | idle | 3.696 | `images/R01-far-idle-3696ms.png` | `fb2b2b31b50f8c2d0e4ad54690bfe56a6ba6d0bca37c05cd9f5b7fe2f7f543a3` |
| R01 | far | move | 0 | `images/R01-far-move-0000ms.png` | `b5dd967841929cb85654cc4d98bcc1388da34d19e425a5770491ca777a7b28e3` |
| R01 | far | move | 0.15625 | `images/R01-far-move-0156ms.png` | `52e1d9a601e80f5c89980706ccbe981d8a8f7b14ba46961ef198f5bef5d61db5` |
| R01 | far | move | 0.3125 | `images/R01-far-move-0313ms.png` | `b5dd967841929cb85654cc4d98bcc1388da34d19e425a5770491ca777a7b28e3` |
| R01 | far | move | 0.46875 | `images/R01-far-move-0469ms.png` | `4d99a6ca35a22bbbdce9d117277d8dca73fabdf573628a9bf09f791cc5a27d21` |
| R01 | far | move | 0.625 | `images/R01-far-move-0625ms.png` | `b5dd967841929cb85654cc4d98bcc1388da34d19e425a5770491ca777a7b28e3` |
| R01 | far | attack | 0 | `images/R01-far-attack-0000ms.png` | `b5dd967841929cb85654cc4d98bcc1388da34d19e425a5770491ca777a7b28e3` |
| R01 | far | attack | 0.3625 | `images/R01-far-attack-0363ms.png` | `5cc463e091da712fd2a10c85ac1c806ef4c217cc1051c2cd5389f29105d147ca` |
| R01 | far | attack | 0.725 | `images/R01-far-attack-0725ms.png` | `02fb5af917779d0e093041ed555f51e2fdf3e26250e5deea84d68cec5be78805` |
| R01 | far | attack | 1.0875 | `images/R01-far-attack-1088ms.png` | `a08bd178e9ff36a4a630cd0de2acfad8eb4f5741b87b9e4d501e49daedd5d492` |
| R01 | far | attack | 1.45 | `images/R01-far-attack-1450ms.png` | `b5dd967841929cb85654cc4d98bcc1388da34d19e425a5770491ca777a7b28e3` |
| R01 | far | hit | 0 | `images/R01-far-hit-0000ms.png` | `b5dd967841929cb85654cc4d98bcc1388da34d19e425a5770491ca777a7b28e3` |
| R01 | far | hit | 0.2 | `images/R01-far-hit-0200ms.png` | `90b164c3a5de0759cd9db1115f6f7fbadbf34b1ae74edf08622eba9a40e337cb` |
| R01 | far | hit | 0.4 | `images/R01-far-hit-0400ms.png` | `7d1b4911bc80dceab89e9890fec0fa70953410a6a0a52f058c91163160844019` |
| R01 | far | hit | 0.6 | `images/R01-far-hit-0600ms.png` | `7022f46226c812b636e5cfd4d9c10535f31ecb9cdaa22d51353a6153aeda2bde` |
| R01 | far | hit | 0.8 | `images/R01-far-hit-0800ms.png` | `b5dd967841929cb85654cc4d98bcc1388da34d19e425a5770491ca777a7b28e3` |
| R01 | far | death | 0 | `images/R01-far-death-0000ms.png` | `b5dd967841929cb85654cc4d98bcc1388da34d19e425a5770491ca777a7b28e3` |
| R01 | far | death | 0.225 | `images/R01-far-death-0225ms.png` | `f124dde71b73bd29769919a35a9deadaa3b9f0a8ccc4347b0bcc263c29d5262b` |
| R01 | far | death | 0.45 | `images/R01-far-death-0450ms.png` | `25be739a32675e1510b3098d19480a564ecdb002fa2d1cccddcd3e0f26399175` |
| R01 | far | death | 0.675 | `images/R01-far-death-0675ms.png` | `1753536385df60a7c7251607a31056f86d0dac4cc26f22d4c273fc523801f64d` |
| R01 | far | death | 0.9 | `images/R01-far-death-0900ms.png` | `83d59156385c867b7fc2d5c81ec044e3ed5891c3b683ff1b81a578688dff8f51` |
| R01 | far | death | 1.35 | `images/R01-far-death-1350ms.png` | `83d59156385c867b7fc2d5c81ec044e3ed5891c3b683ff1b81a578688dff8f51` |
| R01 | far | death | 1.8 | `images/R01-far-death-1800ms.png` | `83d59156385c867b7fc2d5c81ec044e3ed5891c3b683ff1b81a578688dff8f51` |
| R01 | far | static/front | 0 | `images/R01-far-static-front.png` | `8a4d09d5dd11126a68af230188144d0b77ee72797c5bce48eb9718716c6e5a26` |
| R01 | far | static/quarter | 0 | `images/R01-far-static-quarter.png` | `c1a109cd3d8b4784d7bb0ff1a195eedb215e1da88421f990c3b5273c299c1f35` |
| R01 | far | static/rear | 0 | `images/R01-far-static-rear.png` | `c24624c064acbd6504f2262e7cf6db94e5d86cc298a78a1b0a6c0e63771a7143` |
