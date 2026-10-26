# F01/R01 fresh LOD and motion visual review — 070064fb060b

Reviewer: `visual_auditor` on `session/art-audit`.

## Capture provenance and integrity

- Captured source HEAD: `070064fb060bc084a0344b6f9d0c93ed9c26f645`; manifest reports a clean source worktree.
- Source changes reviewed relative to the previous `97cac2e4df86` capture include cape drape commit `eeaeb78` and idle-motion clarification `bc6298a`. The cape commit is `eeaeb78` (not `eea8c019`).
- Capture artifact: `/home/sophia/src/senkei-session-art/docs/evidence/art-production/lod-visual-070064fb060b/`; manifest SHA-256 `6583b0d3fd00746ada2b4b3d7fc89699e97ef3db912cee6a2f409c67668f2191`.
- The manifest expects 180 images and records 180 unique original-size PNGs (1200 × 661); every manifest SHA-256 was independently recalculated against the raw file and matched: **180/180**. The per-image paths and hashes are listed below.
- Chromium `156.0.8078.47`, SwiftShader software renderer, viewport 1440 × 1000 at device scale 1, capture URL `http://127.0.0.1:4189/`. Manifest `errors`, `consoleErrors`, `httpErrors`, and `failedRequests` are empty.
- Each F01/R01 × full/medium/far set contains static front/quarter/rear and five sampled actions (idle, move, attack, hit, death). The manifest records a single selected visible LOD child per image. It reports 54 same-camera cross-LOD action comparisons with zero observed root/joint pose delta.
- I inspected all 180 full-resolution originals, not only contact sheets. This is the production Hero Detail preview builder with LOD children selected by an inspection-only control. It is not a Battlefield Replay capture and does not represent the expected near/mid/far battlefield screen sizes.

## Scoring rubric and provisional results

The production contract scores 0–5: 0 missing/unassessable, 1 major break, 2 conspicuous defect, 3 functional but needs improvement, 4 adoption quality, 5 beyond target. Goal-axis weights are Identity 30%, Silhouette/Proportion 25%, Geometry/Material 20%, Animation 15%, Tactical Readability 10%; each axis must be at least 3.5 and the weighted score at least 4.0. Tactical Readability and actual battlefield-scale presentation are absent here, so **no weighted Goal score is calculated**. These are provisional visual scores from this isolated image set, not Hard Gate acceptance.

### Visual axes by candidate and selected LOD

| Hero | LOD | Identity | Silhouette / Proportion | Geometry / Material | Evidence-based note |
| --- | --- | ---: | ---: | ---: | --- |
| F01 | Full | 4.0 | 4.0 | 4.0 | Helmet, banner, sword/shield, armor, and tapered folded cape distinguish the commander. |
| F01 | Medium | 4.0 | 4.0 | 3.5 | Main silhouette and equipment remain; small armor facets and trim simplify. |
| F01 | Far | 4.0 | 4.0 | 3.5 | Role silhouette and weapons remain readable in this controlled framing; fine details simplify. |
| R01 | Full | 4.0 | 4.0 | 4.0 | Hood, long tunic, faceted armor, cape, and staff distinguish the channeler. |
| R01 | Medium | 4.0 | 4.0 | 3.5 | Role silhouette, staff continuity, and robe remain; cloth response is less detailed. |
| R01 | Far | 4.0 | 4.0 | 3.5 | Hood, tunic, cape, and staff remain visible; cloth folds and response are weaker. |

### Action scores by candidate, LOD, and sampled action

The preview-animation mean is the unweighted mean of the five action scores. It is not a full Animation Hard Gate result.

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

- **Identity and shape:** Front/quarter/rear views retain the commander’s helmet, banner, sword and shield, armor, and tapered cape. The sword stays visible and connected at all three selected LODs. No new chest-plate-as-shield read is visible.
- **Idle (3.5, all LODs):** The new cycle’s head/torso and shield-side movement is easier to see than in `97cac2e`; it reads as controlled breathing with some upper-body sway. It remains a restrained preview motion, not a verified live idle cycle.
- **Move (4.0, all LODs):** Alternating leg poses and shield-arm counter-motion read clearly. The harness keeps the model stationary, so world translation and continuous foot planting are not established.
- **Attack (4.0, all LODs):** The sword stays attached and visible through the wind-up, diagonal strike, follow-through, and return. No definite sword/body penetration appears in the sampled frames.
- **Hit (4.0, all LODs):** Torso/head recoil and return are distinct from the idle pose; shield and arm move with the body.
- **Death (4.0, all LODs):** The fall reaches a settled side-lying pose by 0.9 seconds. The 0.9/1.35/1.8 second endpoint PNGs are byte-identical within each selected LOD and read as a completed held pose. The preview does not establish collision or a Replay death transition.
- **Cape:** The new hang and interior stand-off shaping appear somewhat closer to the back than in `97cac2e`, while keeping the split, tapered folds. It still reads as a stiff faceted panel with little independent cloth lag. No definite sampled clipping is visible.

#### R01

- **Identity and shape:** Front/quarter/rear views preserve the hood, long tunic, sleeves, staff, and tapered cape. Staff head and shaft stay continuous in the static views and sampled actions.
- **Idle (3.5, all LODs):** The new idle motion is more visible than in `97cac2e`: torso/head rock and hand/staff position change through the cycle. The movement remains controlled but has a noticeable side lean; the long cloth pieces show little independent idle lag.
- **Move (4.0, all LODs):** Alternating legs and arm movement are visible. The long hem masks part of the lower-leg motion at some phases. The staff remains in hand; cape motion is limited and somewhat rigid. Because the model does not translate in this harness, gait travel and moving-scene foot planting remain unverified.
- **Attack (4.0, all LODs):** The staff-led wind-up, sweep/follow-through, and return are legible. The crystal and shaft remain readable even at far LOD. At the mid-sweep the grip/shaft visually overlaps the body/cape in projection, but no definite detachment or geometry penetration is visible.
- **Hit (4.0, all LODs):** Torso/head recoil is clearly stronger than idle and returns to the base pose. The staff follows the arm; no sampled staff loss appears.
- **Death (4.0, all LODs):** R01 tips and reaches a near-horizontal side-lying pose by 0.9 seconds. Endpoint images at 0.9/1.35/1.8 seconds are byte-identical within each selected LOD, so the fall reads as complete and held. Shadowing and the isolated ground plane do not prove physical contact or collision.
- **Cape and cloth response:** Relative to `97cac2e`, the cape’s lower folds hang with slightly less stand-off from the back in the new static views. Split tails and vertical folds remain visible at full, medium, and far. The cape still moves as a rigid faceted sheet with little follow-through. Tunic and armor response remains visible in the rendered pixels, is subtle at medium, and is weaker at far; this single lighting setup cannot isolate the shader’s contribution from illumination. No definite new staff/cape clipping is visible.

#### Cross-LOD and endpoint checks

- At this fixed preview camera, F01/R01 pose and equipment remain coherent from the explicitly selected full to medium to far child. Fine cloth folds, trim, and material variation reduce at medium/far. The manifest’s exact child visibility and same-camera metadata support this controlled comparison.
- Each Hero’s death endpoint stays identical at 0.9/1.35/1.8 seconds within each LOD. This verifies image hold for these captures only, not runtime determinism or collision.
- Expected-size near/mid/far views in the actual Battlefield remain a separate acceptance requirement. This capture holds the preview camera constant and does not establish distance-based LOD switching or Tactical readability.

## Hard Gate boundaries

| Hard Gate | Overall status | What this evidence establishes / does not establish |
| --- | --- | --- |
| Identity | NOT_CHECKED | F01/R01 role distinction is visually supported for this subset; full catalog and final production approval remain outside this review. |
| Geometry | NOT_CHECKED | No definite clipping/detachment appears in sampled images; Battlefield geometry and collision are not captured. |
| Material | NOT_CHECKED | Visible response is present and weakens at reduced LOD; no controlled shader/illumination A/B or app lighting review. |
| Animation | NOT_CHECKED | Five isolated preview actions only; no live combat timing, skill, respawn, or Battlefield Replay motion. |
| LOD | NOT_CHECKED | Children were explicitly selected at one preview camera; expected screen sizes, automatic distance selection, and transitions are untested. |
| Integration | NOT_CHECKED | No actual Battlefield/Replay capture is included. |
| Determinism | NOT_CHECKED | This manifest and its hashes verify one capture; there is no cross-run Replay/image comparison. |
| Reproducibility | NOT_CHECKED | Source, conditions, manifest, and hashes are recorded; a second clean recapture was not performed. |

Physical GPU/device performance is **NOT_CHECKED** because rendering used Chromium SwiftShader software GPU. Tactical Readability is not shown, so the weighted Goal score is **NOT_CALCULATED**. These preview scores do not promote F01/R01 to accepted Golden status or establish either full Goal.

## Raw image SHA-256 references

Paths below are relative to `/home/sophia/src/senkei-session-art/docs/evidence/art-production/lod-visual-070064fb060b/`. Hashes were independently recomputed against the raw PNGs and matched the manifest for all 180 images.

| Hero | LOD | Pose / view | Time (s) | PNG | SHA-256 |
| --- | --- | --- | ---: | --- | --- |
| F01 | full | idle | 0 | `images/F01-full-idle-0000ms.png` | `4d69bd2132767cfe13ab531187c3ccc5961547a1a4b40aa03a5766f13289d0dd` |
| F01 | full | idle | 0.924 | `images/F01-full-idle-0924ms.png` | `e85467260ea109a5c15f62b1f7317eae8dc7fd4dc5c650f7da321fcabee60dbc` |
| F01 | full | idle | 1.848 | `images/F01-full-idle-1848ms.png` | `29641f65584ad99e7b3e2302a08aaf2a76754ee1438d695ea9312f9889cc4c63` |
| F01 | full | idle | 2.772 | `images/F01-full-idle-2772ms.png` | `bb192bee07594d7d6fe485a28633212bdd5cf7f6311ab360752bde61683d0d71` |
| F01 | full | idle | 3.696 | `images/F01-full-idle-3696ms.png` | `dfdef5229e3f76ac1a739e828193f7b945ccb9d6ec1f72a839a634c979cc9878` |
| F01 | full | move | 0 | `images/F01-full-move-0000ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | move | 0.15625 | `images/F01-full-move-0156ms.png` | `b23663c7983ce94625b2d1d349fe67e5ce9f6638f241f953b1342d246201e7f1` |
| F01 | full | move | 0.3125 | `images/F01-full-move-0313ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | move | 0.46875 | `images/F01-full-move-0469ms.png` | `ec72e1d0b1f6a587da2af0caa3a056934a2a36a25bb899f5c40f9e4af0c75aaa` |
| F01 | full | move | 0.625 | `images/F01-full-move-0625ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | attack | 0 | `images/F01-full-attack-0000ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | attack | 0.3625 | `images/F01-full-attack-0363ms.png` | `d1b9c7f1d3e49085fa714e4514ee6c9c2d981aebb932c193677fad409287fedf` |
| F01 | full | attack | 0.725 | `images/F01-full-attack-0725ms.png` | `15aa6bce83c5e1b3a2d07b549e2cb386addfb2eaa5cec85d92c5c5b23e6094b7` |
| F01 | full | attack | 1.0875 | `images/F01-full-attack-1088ms.png` | `6b15698c0668edd5613f995c16080c36fe77868c22efd32417ecc00b3f458bc7` |
| F01 | full | attack | 1.45 | `images/F01-full-attack-1450ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | hit | 0 | `images/F01-full-hit-0000ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | hit | 0.2 | `images/F01-full-hit-0200ms.png` | `56ece309d185de1ca22ca9f1c1a7831e24749ddbde2fb85c9f21469469a79de6` |
| F01 | full | hit | 0.4 | `images/F01-full-hit-0400ms.png` | `01a0a2d77d9a9815e72f83d3b5473655032009f664d68b1370290f7b02176eed` |
| F01 | full | hit | 0.6 | `images/F01-full-hit-0600ms.png` | `0fd1db0bb3c4244c6403e5b59a88a78530a6869df416792a80779aea7701e391` |
| F01 | full | hit | 0.8 | `images/F01-full-hit-0800ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | death | 0 | `images/F01-full-death-0000ms.png` | `91d4c87a62bd459f2bc9438622e14e84c06e1b898bf66fb65770c7304be21402` |
| F01 | full | death | 0.225 | `images/F01-full-death-0225ms.png` | `04a0abb3a2a42ecb4d76e07ebf3333c6bb501fce17dfc836bd2969d8c8c69024` |
| F01 | full | death | 0.45 | `images/F01-full-death-0450ms.png` | `ebcbecd21795ba3cd7aa4b2a7a2d714bd68af34261c1fbd154f74612bd153312` |
| F01 | full | death | 0.675 | `images/F01-full-death-0675ms.png` | `422c511fbc5c4c51c5ff6ba8e5ccf9fc4367cd236e8e80b4e9dd6b9beacf20e9` |
| F01 | full | death | 0.9 | `images/F01-full-death-0900ms.png` | `e876a6bbee89e8fcec314261b4e4e45f04cac24c31de0c191f931138e7ae6913` |
| F01 | full | death | 1.35 | `images/F01-full-death-1350ms.png` | `e876a6bbee89e8fcec314261b4e4e45f04cac24c31de0c191f931138e7ae6913` |
| F01 | full | death | 1.8 | `images/F01-full-death-1800ms.png` | `e876a6bbee89e8fcec314261b4e4e45f04cac24c31de0c191f931138e7ae6913` |
| F01 | full | static/front | 0 | `images/F01-full-static-front.png` | `c947b0fe2692671632ec8b14fc1780c620a08385c49e0d414ed79e555f521d58` |
| F01 | full | static/quarter | 0 | `images/F01-full-static-quarter.png` | `c4c2b98fd186fa07d03d30eefad21d191388f800f7704b36c11334bb1c75558e` |
| F01 | full | static/rear | 0 | `images/F01-full-static-rear.png` | `03555bcc951b44e6fb919eb12adab2c62c040a8b2343ae871fc02cad9fcfe0eb` |
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
| R01 | full | idle | 0 | `images/R01-full-idle-0000ms.png` | `90947aea9c6cc6ab56dc9b46e1bbcecc8e9998fe03cdefa6122241d4b6b5ad75` |
| R01 | full | idle | 0.924 | `images/R01-full-idle-0924ms.png` | `507f90b7b3f42439376955a8603e4c94b634283a6f0017235e2870345ef6b029` |
| R01 | full | idle | 1.848 | `images/R01-full-idle-1848ms.png` | `e3f2d8447290c3b80e019f2c51cf6a87aad2cd5d87a0c8709299e2e73e3806c6` |
| R01 | full | idle | 2.772 | `images/R01-full-idle-2772ms.png` | `267a4ef3551b9d429f8db8c9dbdf3e38f3f0568c564942163e45347ceb32a681` |
| R01 | full | idle | 3.696 | `images/R01-full-idle-3696ms.png` | `5da36be45a7f746aacb26ba01d34e13fdef37435869bb03c5739485fc1d04d47` |
| R01 | full | move | 0 | `images/R01-full-move-0000ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | move | 0.15625 | `images/R01-full-move-0156ms.png` | `465ee9872c8672f62e92bfa0cf1607908d75aadf5c11ef3cd7508d6f2a0e6dd3` |
| R01 | full | move | 0.3125 | `images/R01-full-move-0313ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | move | 0.46875 | `images/R01-full-move-0469ms.png` | `fc07ef57a41fc5298ddfaef39757f1ef90de4f1dba644c80846514c5965b4d6f` |
| R01 | full | move | 0.625 | `images/R01-full-move-0625ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | attack | 0 | `images/R01-full-attack-0000ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | attack | 0.3625 | `images/R01-full-attack-0363ms.png` | `5cd4ce00dc0c03730200c2c6559fe4f8df73107758a230e004e332e556301e3b` |
| R01 | full | attack | 0.725 | `images/R01-full-attack-0725ms.png` | `9256d0b7f9a2fb4a89d258b31ffed3823defb129d88ff527459955a1c6b019a7` |
| R01 | full | attack | 1.0875 | `images/R01-full-attack-1088ms.png` | `9f2a2f38edaccb0a17eaf0eb3064717f23f41c2835c1d58e0a44b9e16922a3e4` |
| R01 | full | attack | 1.45 | `images/R01-full-attack-1450ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | hit | 0 | `images/R01-full-hit-0000ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | hit | 0.2 | `images/R01-full-hit-0200ms.png` | `6a048b319fdbb384712f2a3afdbc22a481a2282043c0474a435f60f17f686512` |
| R01 | full | hit | 0.4 | `images/R01-full-hit-0400ms.png` | `d8c1338ca077ef91d99496e6c3449cac904557555f23cf91de3eca2ae1e1c777` |
| R01 | full | hit | 0.6 | `images/R01-full-hit-0600ms.png` | `e585454d499b2b25ef45115a5756f4fc2239d16e234d0b8afa56e7689fea0a82` |
| R01 | full | hit | 0.8 | `images/R01-full-hit-0800ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | death | 0 | `images/R01-full-death-0000ms.png` | `1a674abee6e3ef32ab1447c3bc9ba3790decc369e40c9e4943c563f96324da18` |
| R01 | full | death | 0.225 | `images/R01-full-death-0225ms.png` | `d5e7e52539367cb10ddb3056e4141082533d294df9853a4c21ddd722ebb7f092` |
| R01 | full | death | 0.45 | `images/R01-full-death-0450ms.png` | `96b9672f10e8f8b049412192f6527ab729828c84dd07acd6dd17f9371641325b` |
| R01 | full | death | 0.675 | `images/R01-full-death-0675ms.png` | `6bca06fe08f20ca616363ab9f4a2f78cb8a2ab454440df54161ecb706837eb7d` |
| R01 | full | death | 0.9 | `images/R01-full-death-0900ms.png` | `2d8c6dd3e28632f14572622eb2297287aedad791fece58a112e34519b29a429d` |
| R01 | full | death | 1.35 | `images/R01-full-death-1350ms.png` | `2d8c6dd3e28632f14572622eb2297287aedad791fece58a112e34519b29a429d` |
| R01 | full | death | 1.8 | `images/R01-full-death-1800ms.png` | `2d8c6dd3e28632f14572622eb2297287aedad791fece58a112e34519b29a429d` |
| R01 | full | static/front | 0 | `images/R01-full-static-front.png` | `403652a8f63d5c002e1b541eedaa2c0a39ac9ee8196dce21d42bcfab37b30263` |
| R01 | full | static/quarter | 0 | `images/R01-full-static-quarter.png` | `c0532394013ff053342fd9fc55ac0aad54a25af84d1af1d17fc6fcb161f68879` |
| R01 | full | static/rear | 0 | `images/R01-full-static-rear.png` | `209bcb4a7619c341b5299f9c3cce1d1a7b9095da4bfc7fb384be9bd8798a1ba7` |
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
