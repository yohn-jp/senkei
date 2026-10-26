# F01/R01 full LOD and motion independent visual review — 97cac2e4df86

Reviewer: `visual_auditor` on `session/art-audit`.

## Capture provenance and integrity

- Rendered source HEAD: `97cac2e4df86005f8a9360057d99c19a08570895`; the source worktree was clean at capture time.
- Manifest: `docs/evidence/art-production/lod-visual-97cac2e4df86/manifest.json`; SHA-256 `d31a72a0604dffdfa68ec4542c702a18eeda0a2506a8082ecdc7389dd2439400`.
- Originals: `docs/evidence/art-production/lod-visual-97cac2e4df86/images/`, 180 unique full-canvas PNGs at 1200 × 661. I inspected the original-size images, not only the reduced contact sheets.
- Chromium `156.0.8078.47` / SwiftShader software renderer; viewport 1440 × 1000, device scale 1; URL `http://127.0.0.1:4189/`.
- This is production `createHeroModelPreview` / `buildBattlefieldHero`, with each generated `full`, `medium`, or `far` child explicitly selected through an inspection-only lab control. It is not a Battlefield Replay capture.
- Requested action times: idle 0/0.924/1.848/2.772/3.696s; move 0/0.15625/0.3125/0.46875/0.625s; attack 0/0.3625/0.725/1.0875/1.45s; hit 0/0.2/0.4/0.6/0.8s; death 0/0.225/0.45/0.675/0.9/1.35/1.8s. Static views use front/quarter/rear angles. Each Hero/LOD set has 30 images.
- Manifest image SHA-256 values independently match the raw files for **180/180 images**. `errors`, `consoleErrors`, `httpErrors`, and `failedRequests` are all empty.
- The manifest identifies exactly one visible LOD child per capture and reports 54 same-camera action comparisons with zero observed root/joint pose delta across LODs. This telemetry supports the visual comparison but does not replace the image review.

## Scoring rubric and candidate scores

The committed production rubric rates 0–5 (0 missing/unassessable, 1 major break, 2 conspicuous defect, 3 functional but needs improvement, 4 adoption quality, 5 beyond target). Goal axes are Identity 30%, Silhouette/Proportion 25%, Geometry/Material 20%, Animation 15%, Tactical Readability 10%. Each axis must be at least 3.5 and weighted score at least 4.0. The score table below is limited to what these F01/R01 preview images show. Tactical Readability is not observable here, so no weighted Goal score is calculated.

### Visual axes by candidate and selected LOD

| Hero | LOD | Identity | Silhouette / Proportion | Geometry / Material | Evidence-based note |
| --- | --- | ---: | ---: | ---: | --- |
| F01 | Full | 4.0 | 4.0 | 4.0 | Command role is distinct; separated armor, sword/shield, and tapered folded cape are coherent. |
| F01 | Medium | 4.0 | 4.0 | 3.5 | Main silhouette/equipment remain; edge and small armor detail are reduced. |
| F01 | Far | 4.0 | 4.0 | 3.5 | Role silhouette and weapons remain readable; smallest facets and trim simplify. |
| R01 | Full | 4.0 | 4.0 | 4.0 | Hood/staff/long robe distinguish the channeler; cloth folds and armor response separate visibly. |
| R01 | Medium | 4.0 | 4.0 | 3.5 | Shape and staff continuity remain; tunic fold and response detail are weaker. |
| R01 | Far | 4.0 | 4.0 | 3.5 | Hood, robe, cape, and staff remain readable; reduced cloth/armor response is visible but subtle. |

These are provisional image-review scores, not Hard Gate PASS decisions. The three selected LODs were compared at the same preview framing, rather than at battlefield distances. The whole-Goal weighted score remains **NOT_CALCULATED**.

### Action scores by selected LOD

The Animation preview mean is the unweighted mean of the five sampled actions. It does not stand in for the full Animation Hard Gate.

| Hero | LOD | Idle | Move | Attack | Hit | Death | Animation preview mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| F01 | Full | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |
| F01 | Medium | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |
| F01 | Far | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |
| R01 | Full | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |
| R01 | Medium | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |
| R01 | Far | 3.5 | 4.0 | 4.0 | 4.0 | 4.0 | **3.9** |

### Action observations

#### F01

- **Identity and shape:** Helmet, banner, shield, sword, breastplate, and now the tapered, vertically folded cape distinguish the commander. Front/quarter/rear images show no separate-shield read in the chest and no loss of the sword or shield at far LOD.
- **Idle (3.5):** Head/torso and shield-side pose change modestly through the five samples. It is visible at this framing but remains subtle.
- **Move (4.0):** Alternating leg poses and shield-arm counter-motion are clear at every LOD. Boots stay near the ground in the captured poses; the model is stationary in this harness, so world translation and moving-scene foot planting are not established.
- **Attack (4.0):** The sword remains connected and visible through a stronger wind-up, diagonal cut/follow-through, and return (notably 0.3625, 0.725, and 1.0875s). Shield and torso turn with the strike. No definite sword/body penetration appears.
- **Hit (4.0):** A pronounced torso/head recoil appears at 0.2–0.6s; arms/shield accompany it and return at 0.8s. The response is clearly stronger than an idle sway.
- **Death (4.0):** F01 falls sideways and reaches a settled side-lying pose by 0.9s. At 0.9/1.35/1.8s the boots appear at the floor plane without obvious excessive float. The endpoint images are identical within each LOD and hold.
- **Cape:** The c23c71e tail lift/taper is visible at all LODs: the former broad rectangular read is replaced by deep vertical folds and narrowed pointed tails. It now reads as a shaped low-poly cape and follows the pose through attack/hit/death. It still behaves like a rigid panel with limited independent cloth lag; this is a residual motion/material quality limit, not a visible clipping defect.

#### R01

- **Identity and shape:** Hood, staff, long tunic, sleeves, and pointed cape create a distinct role silhouette. The staff head and shaft remain continuous in the static views and action poses.
- **Idle (3.5):** Small head/torso breathing and pose change are visible. The tunic/cape show little independent movement during idle.
- **Move (4.0):** Alternating legs and arm movement are visible, while the long hem hides some lower-leg motion in the middle of the cycle. Staff remains held and follows the moving arm. Boots stay near the floor in these samples; no battlefield translation or continuous foot-plant claim is made.
- **Attack (4.0):** The updated cycle gives a visible staff-led wind-up/thrust/follow-through/return. In far LOD the shaft and crystal are visible at the peak frames, including 0.3625 and 1.0875s, with the grip aligned to the hand; at 0.725s the hand is partly overlapped by the body/cape, but the staff remains visible and the sequence reads as an attack. This resolves the earlier prominent far-LOD staff-hidden read in these captured views. No definite weapon detachment or robe/staff penetration is visible.
- **Hit (4.0):** Torso/head recoil and return are clear. Staff moves with the arms. Cape changes angle with the pose and remains behind the body; it has little soft secondary motion, but no definite sampled collision appears.
- **Death (4.0):** R01 tips, becomes nearly horizontal, and settles on its side by 0.9s. At 0.9/1.35/1.8s both boots appear at/near the floor plane without obvious excessive float. Each LOD's three endpoint PNGs are identical. Staff stays in hand above/behind the body.
- **Cloth/armor response:** Full LOD shows matte tunic folds and visibly harder/brighter staff/armor facets. Medium preserves this distinction more subtly; far retains a matte robe and somewhat brighter/harder hard-surface facets but with much weaker response and fewer folds. The manifest contains baked `senkeiSurfaceResponse` vectors for medium/far; the single baked material's `metalness=0, roughness=1` is only a fallback profile. This image set has one lighting setup and no neutral-response A/B, so it cannot attribute the pixel response to the shader alone.
- **Cape:** The c23c71e shape narrows and splits the lower tails, replacing the prior rectangular slab read at full/medium/far. It follows major pose changes, but still moves as a rigid, faceted sheet rather than cloth with obvious independent lag. The rear view still hides most back detail by design; no new body/staff clipping is visible.

## Death endpoint check

| Hero | LOD | SHA-256 at 0.9/1.35/1.8s | Visual result |
| --- | --- | --- | --- |
| F01 | Full | `40d344153e62f6f77772660acb562b64beb2ffc5463228b8675a2225b2ab12e0` | Side-lying; both boots appear grounded; identical frames hold. |
| F01 | Medium | `fac1e8a3258e4669718c51e485de9aa7b69f62daea6a2f08ee3581bf73177b6e` | Side-lying; both boots appear grounded; identical frames hold. |
| F01 | Far | `5271c1e0281f4aab54467470294fab2a35f03676ad57fb5db12ee8b09c66c713` | Side-lying; both boots appear grounded; identical frames hold. |
| R01 | Full | `829407cbb920e7d6c6059660472036e1682b48a25297e2db0fcd5dfd630ca783` | Side-lying; both boots appear at/near floor; identical frames hold. |
| R01 | Medium | `87e7c7edc5543af0658dbc701bee343b8dbcf7bd22c2f5eec0369cf957e82825` | Side-lying; both boots appear at/near floor; identical frames hold. |
| R01 | Far | `2e72e53a817abb7ea8adf950eba6e69f0971492493357422dc70b94105ac9cb2` | Side-lying; both boots appear at/near floor; identical frames hold. |

Endpoint equality is within each selected LOD, not between LODs. These are static rendered pixels and do not prove physics/collision or a real Replay death transition.

## Hard Gate boundaries

| Hard Gate | Overall status | What this capture establishes / does not establish |
| --- | --- | --- |
| Identity | NOT_CHECKED | Current F01/R01 role distinction is visually strong in the candidate subset. Other Heroes and full production identity approval are outside this set. |
| Geometry | NOT_CHECKED | No definite sampled clipping/detachment found; actual app/Battlefield geometry and collision are not captured. |
| Material | NOT_CHECKED | Visible response is present, weaker at reduced LOD; no controlled shader/lighting A/B or actual app lighting review. |
| Animation | NOT_CHECKED | Five preview actions only. No skill, respawn, live combat-event timing, or actual Battlefield Replay motion. |
| LOD | NOT_CHECKED | LOD children are explicitly selected by a lab override. Automatic distance selection/transitions and battlefield-scale continuity are untested. |
| Integration | NOT_CHECKED | This is an isolated production-builder preview, not actual Battlefield/Replay integration. |
| Determinism | NOT_CHECKED | Manifest and frame hashes verify one capture run; no cross-run Replay image comparison was performed. |
| Reproducibility | NOT_CHECKED | Source, conditions, manifest, and image hashes are recorded, but a clean rebuild/re-capture by another runner was not performed. |

Physical GPU/device performance is also **NOT_CHECKED**: this capture used Chromium SwiftShader software rendering. The preview action scores and visual-axis scores do not promote either candidate to accepted Golden status or establish Goal completion.

## Raw image SHA-256 references

All image paths are relative to `docs/evidence/art-production/lod-visual-97cac2e4df86/`. The 180 raw image hashes below were independently recalculated and match the manifest.

| Hero | LOD | Pose / view | Time (s) | PNG | SHA-256 |
| --- | --- | --- | ---: | --- | --- |
| F01 | full | idle | 0 | `images/F01-full-idle-0000ms.png` | `e5944c635e4dd72b5e17bda6117ae72ea325144ffdb6c8bd365ccb4e2f3a7407` |
| F01 | full | idle | 0.924 | `images/F01-full-idle-0924ms.png` | `3b814bee04a0c873ff5ad8032e5e96eaca5be799fefb883e3b746bffe6e64b5f` |
| F01 | full | idle | 1.848 | `images/F01-full-idle-1848ms.png` | `39ed5f1d662fa185eb93ab24cde1133756223fe9bfda7a8825dee96ade0ac9e5` |
| F01 | full | idle | 2.772 | `images/F01-full-idle-2772ms.png` | `8ea095359219a50144d7090a89ba82f60da66ddf4fd5f32a3f8f2d69c904044b` |
| F01 | full | idle | 3.696 | `images/F01-full-idle-3696ms.png` | `0490c340ab8423f324c12fb8bb802f83a7b4c0a895ff65d0ff04ae9a154bd222` |
| F01 | full | move | 0 | `images/F01-full-move-0000ms.png` | `b64ed0daada6bdb012d058ad0024934829fc30a96ea322fe0baa7965b45cbee8` |
| F01 | full | move | 0.15625 | `images/F01-full-move-0156ms.png` | `642c3db88eb2e556665ccaaddd89cbf12dd7ba3dde9d5695cfe1925577b5d82f` |
| F01 | full | move | 0.3125 | `images/F01-full-move-0313ms.png` | `b64ed0daada6bdb012d058ad0024934829fc30a96ea322fe0baa7965b45cbee8` |
| F01 | full | move | 0.46875 | `images/F01-full-move-0469ms.png` | `70045a50607b7f132543d74a530ceead030d90e1c7f2883b0b68abc25318d74e` |
| F01 | full | move | 0.625 | `images/F01-full-move-0625ms.png` | `b64ed0daada6bdb012d058ad0024934829fc30a96ea322fe0baa7965b45cbee8` |
| F01 | full | attack | 0 | `images/F01-full-attack-0000ms.png` | `b64ed0daada6bdb012d058ad0024934829fc30a96ea322fe0baa7965b45cbee8` |
| F01 | full | attack | 0.3625 | `images/F01-full-attack-0363ms.png` | `e4ff26efdbcf2142cd9af073cea273073f0407bd5d21a106dc0e13be6c5a978c` |
| F01 | full | attack | 0.725 | `images/F01-full-attack-0725ms.png` | `4269332af6300b32b3525c789240c1098050374eeed92fd3c9dab496ecd3e1cd` |
| F01 | full | attack | 1.0875 | `images/F01-full-attack-1088ms.png` | `a7f396ec97cb650e663f16acc05e046829807c2c0bbd16f326b73150c01ff4bd` |
| F01 | full | attack | 1.45 | `images/F01-full-attack-1450ms.png` | `b64ed0daada6bdb012d058ad0024934829fc30a96ea322fe0baa7965b45cbee8` |
| F01 | full | hit | 0 | `images/F01-full-hit-0000ms.png` | `b64ed0daada6bdb012d058ad0024934829fc30a96ea322fe0baa7965b45cbee8` |
| F01 | full | hit | 0.2 | `images/F01-full-hit-0200ms.png` | `7c1e5c2f1d9d32c45a42f575737af35aff538b9d41ab417a81b1eaffb92c504e` |
| F01 | full | hit | 0.4 | `images/F01-full-hit-0400ms.png` | `2ed5a41c615e179bc58880b78ac20394fc1c70887b3d704332e368a0f8b18c9c` |
| F01 | full | hit | 0.6 | `images/F01-full-hit-0600ms.png` | `3fc02559c0808f9e5b0e1ef33950373600ce6fef8204015cd933e9b06fe7c057` |
| F01 | full | hit | 0.8 | `images/F01-full-hit-0800ms.png` | `b64ed0daada6bdb012d058ad0024934829fc30a96ea322fe0baa7965b45cbee8` |
| F01 | full | death | 0 | `images/F01-full-death-0000ms.png` | `b64ed0daada6bdb012d058ad0024934829fc30a96ea322fe0baa7965b45cbee8` |
| F01 | full | death | 0.225 | `images/F01-full-death-0225ms.png` | `6666a0483039916f9c975f9591631b12b8a65f746fbdb0b567558025887d0ff8` |
| F01 | full | death | 0.45 | `images/F01-full-death-0450ms.png` | `10eb7baa4313caf0e2eb56dd4b21138a68353b97ff112ffb6f23069fde9a9a97` |
| F01 | full | death | 0.675 | `images/F01-full-death-0675ms.png` | `85d4adcf564e97e955f6e53dd9cf3833a7427ed678e38d548c243089a6a70c61` |
| F01 | full | death | 0.9 | `images/F01-full-death-0900ms.png` | `40d344153e62f6f77772660acb562b64beb2ffc5463228b8675a2225b2ab12e0` |
| F01 | full | death | 1.35 | `images/F01-full-death-1350ms.png` | `40d344153e62f6f77772660acb562b64beb2ffc5463228b8675a2225b2ab12e0` |
| F01 | full | death | 1.8 | `images/F01-full-death-1800ms.png` | `40d344153e62f6f77772660acb562b64beb2ffc5463228b8675a2225b2ab12e0` |
| F01 | full | static/front | 0 | `images/F01-full-static-front.png` | `ec1bdd055a6e26ba6a6414fb448b51f1352ecea6a6140b546e95d51f84282d54` |
| F01 | full | static/quarter | 0 | `images/F01-full-static-quarter.png` | `995cddf959c307d3f47a154bd498897967bca5962e5f325b0438449a7dfacb22` |
| F01 | full | static/rear | 0 | `images/F01-full-static-rear.png` | `9e3d2a999e35bcd39c79ff2920c602f55e90a10ece418288a2880c23c896aca8` |
| F01 | medium | idle | 0 | `images/F01-medium-idle-0000ms.png` | `bd8fac79d24a1fe9d59332c9d974c17d413c3b363013397850b11fa7f7a0e66a` |
| F01 | medium | idle | 0.924 | `images/F01-medium-idle-0924ms.png` | `4912fe8e198a803eb6ce60cbf0fa2c06551698bddb4bff6ac6ad19f9d842e2b3` |
| F01 | medium | idle | 1.848 | `images/F01-medium-idle-1848ms.png` | `f84c11684cafed693c9aff18c9a8e6bf12576d38ba7651705de061f2580abe7f` |
| F01 | medium | idle | 2.772 | `images/F01-medium-idle-2772ms.png` | `7bd086887465194eeaeb7128a74a3d65d74f77a4484097793c50300ad2a1d33f` |
| F01 | medium | idle | 3.696 | `images/F01-medium-idle-3696ms.png` | `606e8062d709340dcbfce522fa4766b23530f6669d22ea6ff93e5a46c3c17564` |
| F01 | medium | move | 0 | `images/F01-medium-move-0000ms.png` | `c817e4a8305ad149f4bb459191c0dfdd36d3f744762086efc704b601394409ec` |
| F01 | medium | move | 0.15625 | `images/F01-medium-move-0156ms.png` | `add7dc37730c4c614b1b078c3d2beb00dc6393af9d48ecf8551c8e5790dfcc92` |
| F01 | medium | move | 0.3125 | `images/F01-medium-move-0313ms.png` | `c817e4a8305ad149f4bb459191c0dfdd36d3f744762086efc704b601394409ec` |
| F01 | medium | move | 0.46875 | `images/F01-medium-move-0469ms.png` | `802986d52e131d1c657321b6b6da6fcca3579c70b2a1e4831ccb75581106f0ce` |
| F01 | medium | move | 0.625 | `images/F01-medium-move-0625ms.png` | `c817e4a8305ad149f4bb459191c0dfdd36d3f744762086efc704b601394409ec` |
| F01 | medium | attack | 0 | `images/F01-medium-attack-0000ms.png` | `c817e4a8305ad149f4bb459191c0dfdd36d3f744762086efc704b601394409ec` |
| F01 | medium | attack | 0.3625 | `images/F01-medium-attack-0363ms.png` | `29f68ce5def6e850e0724464de68277e529b8288a770b9c423bfc93e9e94ada9` |
| F01 | medium | attack | 0.725 | `images/F01-medium-attack-0725ms.png` | `2f277daedcddfc6a892a9884edafb9c5080676d79e988b4bcf7905f39f96c9c6` |
| F01 | medium | attack | 1.0875 | `images/F01-medium-attack-1088ms.png` | `1bed28d04d76836d4526f1ededadb611eac7ed6cf59fb9d647a183ccbdfb90a0` |
| F01 | medium | attack | 1.45 | `images/F01-medium-attack-1450ms.png` | `c817e4a8305ad149f4bb459191c0dfdd36d3f744762086efc704b601394409ec` |
| F01 | medium | hit | 0 | `images/F01-medium-hit-0000ms.png` | `c817e4a8305ad149f4bb459191c0dfdd36d3f744762086efc704b601394409ec` |
| F01 | medium | hit | 0.2 | `images/F01-medium-hit-0200ms.png` | `8eecf490ffb59e6bcf2526177849e4dcfbec88bd8556deedb2acc754ca702ee4` |
| F01 | medium | hit | 0.4 | `images/F01-medium-hit-0400ms.png` | `990803de23f81aab517e11cf9bfc9861a429411b359fa3302a39607c526a0d2c` |
| F01 | medium | hit | 0.6 | `images/F01-medium-hit-0600ms.png` | `bcdfb4693e2ef923d3feb33b9857a184d30c6f7511bc1376b0a76935999e5321` |
| F01 | medium | hit | 0.8 | `images/F01-medium-hit-0800ms.png` | `c817e4a8305ad149f4bb459191c0dfdd36d3f744762086efc704b601394409ec` |
| F01 | medium | death | 0 | `images/F01-medium-death-0000ms.png` | `c817e4a8305ad149f4bb459191c0dfdd36d3f744762086efc704b601394409ec` |
| F01 | medium | death | 0.225 | `images/F01-medium-death-0225ms.png` | `9c129ca24e081d75295005d9cbe484fb4785384219c34a1db425d4c654d4fb0a` |
| F01 | medium | death | 0.45 | `images/F01-medium-death-0450ms.png` | `356833706d0a69bbedc00ab1987ae32b451f5c974ac1ead7f0e6a0d4e09de075` |
| F01 | medium | death | 0.675 | `images/F01-medium-death-0675ms.png` | `21cdcd43b33e95e8a68a313168b09e671d22f971ae3e6186de84bcd9f8215dea` |
| F01 | medium | death | 0.9 | `images/F01-medium-death-0900ms.png` | `fac1e8a3258e4669718c51e485de9aa7b69f62daea6a2f08ee3581bf73177b6e` |
| F01 | medium | death | 1.35 | `images/F01-medium-death-1350ms.png` | `fac1e8a3258e4669718c51e485de9aa7b69f62daea6a2f08ee3581bf73177b6e` |
| F01 | medium | death | 1.8 | `images/F01-medium-death-1800ms.png` | `fac1e8a3258e4669718c51e485de9aa7b69f62daea6a2f08ee3581bf73177b6e` |
| F01 | medium | static/front | 0 | `images/F01-medium-static-front.png` | `b906ee527b42a59d146e1ccf5c20d4da4c9fecba7d4db7b5e73ea71b4c5ee7fc` |
| F01 | medium | static/quarter | 0 | `images/F01-medium-static-quarter.png` | `33346cece9cff60e5fcfff0610a3b1e6290842e3ec6f4ececd8279937f20e1e6` |
| F01 | medium | static/rear | 0 | `images/F01-medium-static-rear.png` | `a24df2882a969d3c977c046701ebe8bb495b2706e1cfbd6a7e0d99c920aad21d` |
| F01 | far | idle | 0 | `images/F01-far-idle-0000ms.png` | `6895997ecde68b6ba12fb5ba4b0d143ba7dafb39e9dc15743808a76c18086722` |
| F01 | far | idle | 0.924 | `images/F01-far-idle-0924ms.png` | `4b6da38a587e45fa63d99e4d6fee131b3cc45e9aaccdf2897e0d18c72bcec1ba` |
| F01 | far | idle | 1.848 | `images/F01-far-idle-1848ms.png` | `02b7f8ae6f7c573cb5181b72cfb7034ebca8815be8871b13ea49586e2337a6a2` |
| F01 | far | idle | 2.772 | `images/F01-far-idle-2772ms.png` | `3840861acdf24e8e110376e19f1fd346b17a6ef1c256cb255b6113c951d08a29` |
| F01 | far | idle | 3.696 | `images/F01-far-idle-3696ms.png` | `cc71f4b646cdd84226643e4353492d60ebea70ac979a248459aea087d6b1a530` |
| F01 | far | move | 0 | `images/F01-far-move-0000ms.png` | `a78c5e465dfc2297aa864e04f44d2c8e3fada9271d0d4764dfc41a3b2032bf8c` |
| F01 | far | move | 0.15625 | `images/F01-far-move-0156ms.png` | `99369035b5caf7d3d1b71fb3033caa426065cab9af6d3e8990b988d789ee5189` |
| F01 | far | move | 0.3125 | `images/F01-far-move-0313ms.png` | `a78c5e465dfc2297aa864e04f44d2c8e3fada9271d0d4764dfc41a3b2032bf8c` |
| F01 | far | move | 0.46875 | `images/F01-far-move-0469ms.png` | `5a884a8290a58409ee497946957a12a6d5967f6d97ad8eb5c28b1b56614288fe` |
| F01 | far | move | 0.625 | `images/F01-far-move-0625ms.png` | `a78c5e465dfc2297aa864e04f44d2c8e3fada9271d0d4764dfc41a3b2032bf8c` |
| F01 | far | attack | 0 | `images/F01-far-attack-0000ms.png` | `a78c5e465dfc2297aa864e04f44d2c8e3fada9271d0d4764dfc41a3b2032bf8c` |
| F01 | far | attack | 0.3625 | `images/F01-far-attack-0363ms.png` | `6319b9b8d4169ff0e49cc7342f4c686003657f05c69117a9257b369978caf950` |
| F01 | far | attack | 0.725 | `images/F01-far-attack-0725ms.png` | `e8318a7eabd4ef9f25bebb96c1365509b4d7e3a455d50c8e157b11bb3a93affa` |
| F01 | far | attack | 1.0875 | `images/F01-far-attack-1088ms.png` | `33e17209d1bb2c247d8e20ddf77abbaa6ec2f5cfa299d687fc160f4487814c88` |
| F01 | far | attack | 1.45 | `images/F01-far-attack-1450ms.png` | `a78c5e465dfc2297aa864e04f44d2c8e3fada9271d0d4764dfc41a3b2032bf8c` |
| F01 | far | hit | 0 | `images/F01-far-hit-0000ms.png` | `a78c5e465dfc2297aa864e04f44d2c8e3fada9271d0d4764dfc41a3b2032bf8c` |
| F01 | far | hit | 0.2 | `images/F01-far-hit-0200ms.png` | `748186e80bcef4a8a4e6d6c90b435b6b3e4360ab2d18c6d736a816a7384dc4f2` |
| F01 | far | hit | 0.4 | `images/F01-far-hit-0400ms.png` | `2f18b2645664050f2187ec3735a99dd7269b050e581a054e86854081963c7920` |
| F01 | far | hit | 0.6 | `images/F01-far-hit-0600ms.png` | `1312012a4ab88cd6178101fa7278fd2a37418ebc496c1bf4fb5b957bd70bc6eb` |
| F01 | far | hit | 0.8 | `images/F01-far-hit-0800ms.png` | `a78c5e465dfc2297aa864e04f44d2c8e3fada9271d0d4764dfc41a3b2032bf8c` |
| F01 | far | death | 0 | `images/F01-far-death-0000ms.png` | `a78c5e465dfc2297aa864e04f44d2c8e3fada9271d0d4764dfc41a3b2032bf8c` |
| F01 | far | death | 0.225 | `images/F01-far-death-0225ms.png` | `62dc1fd939c5914da13e78c6bd6ca66228e440929647d1a4bd12b9a3b66fbdea` |
| F01 | far | death | 0.45 | `images/F01-far-death-0450ms.png` | `5ec240bfadbd95ca803dbe07dfbf87dc6694702f1c4d6ba03c61f82f27e8ea49` |
| F01 | far | death | 0.675 | `images/F01-far-death-0675ms.png` | `1369c20b703ad0b059a69c3035bdc008e1b4c89f39da9f86cc4a744bcac7456e` |
| F01 | far | death | 0.9 | `images/F01-far-death-0900ms.png` | `5271c1e0281f4aab54467470294fab2a35f03676ad57fb5db12ee8b09c66c713` |
| F01 | far | death | 1.35 | `images/F01-far-death-1350ms.png` | `5271c1e0281f4aab54467470294fab2a35f03676ad57fb5db12ee8b09c66c713` |
| F01 | far | death | 1.8 | `images/F01-far-death-1800ms.png` | `5271c1e0281f4aab54467470294fab2a35f03676ad57fb5db12ee8b09c66c713` |
| F01 | far | static/front | 0 | `images/F01-far-static-front.png` | `5422d0635d6291c765affa5bc86a25a7d4bdee5269b3d45b5080857bf2cae050` |
| F01 | far | static/quarter | 0 | `images/F01-far-static-quarter.png` | `50009d8a074899f0a34be5361d5ce063326e76af1c54a8c7b951caf69ce71182` |
| F01 | far | static/rear | 0 | `images/F01-far-static-rear.png` | `9573706237cec3d515df5642538f7f709cc398ca1d56b3aeaee64824e48a4441` |
| R01 | full | idle | 0 | `images/R01-full-idle-0000ms.png` | `40eb4b3c82f7ef9db5498ea4d3af8974b58dd1193ed8d8c90b6912957a9546bc` |
| R01 | full | idle | 0.924 | `images/R01-full-idle-0924ms.png` | `d7364b75e12d45223ab68abf7a74c7cbeb03f3464b1f05dca472d73c0ed784d4` |
| R01 | full | idle | 1.848 | `images/R01-full-idle-1848ms.png` | `a23a9322b868b0cc624da86740a45c5d13cabd65d209282d4b53573e4fd253aa` |
| R01 | full | idle | 2.772 | `images/R01-full-idle-2772ms.png` | `75a065322da80128da107b433deb4ad3639ff9f245fdf2ab3c9bebba7eec0544` |
| R01 | full | idle | 3.696 | `images/R01-full-idle-3696ms.png` | `f40d14a7b4a18303fdc027dbec1bd45b04bc6240402aa989d55806e883bdd51a` |
| R01 | full | move | 0 | `images/R01-full-move-0000ms.png` | `e4d2edc169e3dc739d66bc9532c09bf4bbdf3edaa5305b3f0ab078c65bfa2653` |
| R01 | full | move | 0.15625 | `images/R01-full-move-0156ms.png` | `f0f3380fa41e1831ab3177bdd5193fe2fc02bdff1a4f536c0da8e056c244342e` |
| R01 | full | move | 0.3125 | `images/R01-full-move-0313ms.png` | `e4d2edc169e3dc739d66bc9532c09bf4bbdf3edaa5305b3f0ab078c65bfa2653` |
| R01 | full | move | 0.46875 | `images/R01-full-move-0469ms.png` | `30debc317a8edfab1d542e8d78af46112a18df0f31c55a07056161982f5cc830` |
| R01 | full | move | 0.625 | `images/R01-full-move-0625ms.png` | `e4d2edc169e3dc739d66bc9532c09bf4bbdf3edaa5305b3f0ab078c65bfa2653` |
| R01 | full | attack | 0 | `images/R01-full-attack-0000ms.png` | `e4d2edc169e3dc739d66bc9532c09bf4bbdf3edaa5305b3f0ab078c65bfa2653` |
| R01 | full | attack | 0.3625 | `images/R01-full-attack-0363ms.png` | `c586e59e4fb6615fbf392fb40a0cbcdf8ec7e55a6036c710a340600f7dea7a16` |
| R01 | full | attack | 0.725 | `images/R01-full-attack-0725ms.png` | `7dcb37458f62014d6bdf403bf15b4986f57b79ba2116fbd1a177331ad9df0ab8` |
| R01 | full | attack | 1.0875 | `images/R01-full-attack-1088ms.png` | `ac8932a8cfa402ea8ac9b682353a8db47ed5924b965d2dac8574c07cd9197c0b` |
| R01 | full | attack | 1.45 | `images/R01-full-attack-1450ms.png` | `e4d2edc169e3dc739d66bc9532c09bf4bbdf3edaa5305b3f0ab078c65bfa2653` |
| R01 | full | hit | 0 | `images/R01-full-hit-0000ms.png` | `e4d2edc169e3dc739d66bc9532c09bf4bbdf3edaa5305b3f0ab078c65bfa2653` |
| R01 | full | hit | 0.2 | `images/R01-full-hit-0200ms.png` | `80da90dc979c368cb707723889f98f270bd131fd10b41bf05ab6cca68b6d7cc7` |
| R01 | full | hit | 0.4 | `images/R01-full-hit-0400ms.png` | `b6dc30e22fa857157b9b882d9ff09dd997ab066b1142cdc2fe84f5ce9b7d8e83` |
| R01 | full | hit | 0.6 | `images/R01-full-hit-0600ms.png` | `d4497edc83de41163d0d3af50d578a87cee4a8951fbd5d01bdaf26e5e8e82556` |
| R01 | full | hit | 0.8 | `images/R01-full-hit-0800ms.png` | `e4d2edc169e3dc739d66bc9532c09bf4bbdf3edaa5305b3f0ab078c65bfa2653` |
| R01 | full | death | 0 | `images/R01-full-death-0000ms.png` | `e4d2edc169e3dc739d66bc9532c09bf4bbdf3edaa5305b3f0ab078c65bfa2653` |
| R01 | full | death | 0.225 | `images/R01-full-death-0225ms.png` | `3159607b7dd7f1076066b0217e27ed8c324d12af2d593295e595f51d4d9c9045` |
| R01 | full | death | 0.45 | `images/R01-full-death-0450ms.png` | `3a60b6066af7f0ee596dfebeb25de7e00451077845effd538940cb064d623533` |
| R01 | full | death | 0.675 | `images/R01-full-death-0675ms.png` | `f01ced40e3cd6c248c3905b573f0d620ace31050803a09ea5756e8064e445658` |
| R01 | full | death | 0.9 | `images/R01-full-death-0900ms.png` | `829407cbb920e7d6c6059660472036e1682b48a25297e2db0fcd5dfd630ca783` |
| R01 | full | death | 1.35 | `images/R01-full-death-1350ms.png` | `829407cbb920e7d6c6059660472036e1682b48a25297e2db0fcd5dfd630ca783` |
| R01 | full | death | 1.8 | `images/R01-full-death-1800ms.png` | `829407cbb920e7d6c6059660472036e1682b48a25297e2db0fcd5dfd630ca783` |
| R01 | full | static/front | 0 | `images/R01-full-static-front.png` | `4cf918c8b0b013269bdc38bb9c5ca921b6257e75960d9ace2d18b195e97aeee7` |
| R01 | full | static/quarter | 0 | `images/R01-full-static-quarter.png` | `8e619c7e1d9b1b18bb471c8e9a141990fabec2b75cdd4b065ec1c3790d60e16e` |
| R01 | full | static/rear | 0 | `images/R01-full-static-rear.png` | `f8825fba2a212cb25a3dcb404d1dfd15fbfbaa3f3656c45632b5039dd5bfcbb6` |
| R01 | medium | idle | 0 | `images/R01-medium-idle-0000ms.png` | `a90958d1a7735c749d0ed685e0e150b28423ec2ee6258347d8005ef80d8612ae` |
| R01 | medium | idle | 0.924 | `images/R01-medium-idle-0924ms.png` | `575caba39d4c3f30846fc76b5614639b971fb48051aa47381192db7ef1741170` |
| R01 | medium | idle | 1.848 | `images/R01-medium-idle-1848ms.png` | `fd0189e903f804dc4eab7026ede4daed392fb2d65b9a8c3e44093338feeb28f8` |
| R01 | medium | idle | 2.772 | `images/R01-medium-idle-2772ms.png` | `680e4345c994e0c22125e3331092a61cbedf7a0dff9925f986887e0708fb502a` |
| R01 | medium | idle | 3.696 | `images/R01-medium-idle-3696ms.png` | `8cd0875727dec7151e8e26de74add03ce1723faaf5a6ca9a70a3acdc0b8ef697` |
| R01 | medium | move | 0 | `images/R01-medium-move-0000ms.png` | `adc5138a7d6e6ca9ca64b99eba287e477ff4f06eb442eba941b27513f935b1cf` |
| R01 | medium | move | 0.15625 | `images/R01-medium-move-0156ms.png` | `70fdb41f3ed1f57215cf85443c8ed2222b44a0efb2e670fae60ae3a6dc18b9dd` |
| R01 | medium | move | 0.3125 | `images/R01-medium-move-0313ms.png` | `adc5138a7d6e6ca9ca64b99eba287e477ff4f06eb442eba941b27513f935b1cf` |
| R01 | medium | move | 0.46875 | `images/R01-medium-move-0469ms.png` | `eca45a74daea781f584e0698e9eedbaaaf2a6feee40d29caf69ca4cba49bda38` |
| R01 | medium | move | 0.625 | `images/R01-medium-move-0625ms.png` | `adc5138a7d6e6ca9ca64b99eba287e477ff4f06eb442eba941b27513f935b1cf` |
| R01 | medium | attack | 0 | `images/R01-medium-attack-0000ms.png` | `adc5138a7d6e6ca9ca64b99eba287e477ff4f06eb442eba941b27513f935b1cf` |
| R01 | medium | attack | 0.3625 | `images/R01-medium-attack-0363ms.png` | `69e59b55682e1c829123ef3ae977410693ae5f42074d0d835eb2042c641792cc` |
| R01 | medium | attack | 0.725 | `images/R01-medium-attack-0725ms.png` | `379e5587aa6d02d885b7d08ac7b3296d9494e18fce8b5f54fb941cf7811da5be` |
| R01 | medium | attack | 1.0875 | `images/R01-medium-attack-1088ms.png` | `fadb53db6e347e54fe411c18005989d5c6e309c89d3ca62e94fe0035613188d8` |
| R01 | medium | attack | 1.45 | `images/R01-medium-attack-1450ms.png` | `adc5138a7d6e6ca9ca64b99eba287e477ff4f06eb442eba941b27513f935b1cf` |
| R01 | medium | hit | 0 | `images/R01-medium-hit-0000ms.png` | `adc5138a7d6e6ca9ca64b99eba287e477ff4f06eb442eba941b27513f935b1cf` |
| R01 | medium | hit | 0.2 | `images/R01-medium-hit-0200ms.png` | `b430333495ebe996a8319da17123e9b26afcf4e72c3da59e47e96c6cc2b2fcbd` |
| R01 | medium | hit | 0.4 | `images/R01-medium-hit-0400ms.png` | `6b97236557829b244d2e2a3724608c48ad758ea01f28d659309be29284b26ed6` |
| R01 | medium | hit | 0.6 | `images/R01-medium-hit-0600ms.png` | `e36035c408d0b2f96eda7a4ce5bfe25e8420b6a1ae5a2778bf4b9affd629ea04` |
| R01 | medium | hit | 0.8 | `images/R01-medium-hit-0800ms.png` | `adc5138a7d6e6ca9ca64b99eba287e477ff4f06eb442eba941b27513f935b1cf` |
| R01 | medium | death | 0 | `images/R01-medium-death-0000ms.png` | `adc5138a7d6e6ca9ca64b99eba287e477ff4f06eb442eba941b27513f935b1cf` |
| R01 | medium | death | 0.225 | `images/R01-medium-death-0225ms.png` | `526a438b08860fdd6d7f0ffe8ed198e08359df70c3a2f89c414fa06c5008db13` |
| R01 | medium | death | 0.45 | `images/R01-medium-death-0450ms.png` | `6176fda459be8d529c34a0bc1a5ca83d7042a3070432846ce7c07d7bd36b7de7` |
| R01 | medium | death | 0.675 | `images/R01-medium-death-0675ms.png` | `dc4849d0e83b7c06d73bc09135817ddcdb512dfc4ee7a2247f8997daafe6daef` |
| R01 | medium | death | 0.9 | `images/R01-medium-death-0900ms.png` | `87e7c7edc5543af0658dbc701bee343b8dbcf7bd22c2f5eec0369cf957e82825` |
| R01 | medium | death | 1.35 | `images/R01-medium-death-1350ms.png` | `87e7c7edc5543af0658dbc701bee343b8dbcf7bd22c2f5eec0369cf957e82825` |
| R01 | medium | death | 1.8 | `images/R01-medium-death-1800ms.png` | `87e7c7edc5543af0658dbc701bee343b8dbcf7bd22c2f5eec0369cf957e82825` |
| R01 | medium | static/front | 0 | `images/R01-medium-static-front.png` | `48901e15cf206dcd120659f4fb70adb05c86f00b427f7798d4117bac65e0f9be` |
| R01 | medium | static/quarter | 0 | `images/R01-medium-static-quarter.png` | `978eb491968b073d5f745aefa4fcf56ae84c832acdd1b324c61d54272b1d86e1` |
| R01 | medium | static/rear | 0 | `images/R01-medium-static-rear.png` | `34ede4d4a3ba334e8cab4a1006eb70c077dadfc43d465faa1e86d62debd3ea0c` |
| R01 | far | idle | 0 | `images/R01-far-idle-0000ms.png` | `e80c91f0b2ed34551ff63d3b1ed59d37440e94f7290e16db5a0f2636659026d3` |
| R01 | far | idle | 0.924 | `images/R01-far-idle-0924ms.png` | `c74b972243649f9ef43abe1f9d4a28fbf31fdf488409e51dfd99fe4ddc6c68be` |
| R01 | far | idle | 1.848 | `images/R01-far-idle-1848ms.png` | `d5a5e9f7b13a2cc295e7c5f7566746e0c6de670dece8e61862f113ae2d94339f` |
| R01 | far | idle | 2.772 | `images/R01-far-idle-2772ms.png` | `1d18a48b4cb1f2e1abc49682baff01595285ab49ad6644ffb9bc1948fc66f590` |
| R01 | far | idle | 3.696 | `images/R01-far-idle-3696ms.png` | `cd92c321bf3732064f3d1de5eee1447454b87ced7217e9520b755efb8cf60ccb` |
| R01 | far | move | 0 | `images/R01-far-move-0000ms.png` | `313177290129164c122a81bb7c73cbec8c2d758bb124307a5cda90c367f20127` |
| R01 | far | move | 0.15625 | `images/R01-far-move-0156ms.png` | `6e5b9aab8dbcd24be805fe53755c73db9911e84eb4eb8aafe7210d598f4e2037` |
| R01 | far | move | 0.3125 | `images/R01-far-move-0313ms.png` | `313177290129164c122a81bb7c73cbec8c2d758bb124307a5cda90c367f20127` |
| R01 | far | move | 0.46875 | `images/R01-far-move-0469ms.png` | `3710762182c156d64345a2d5aff2461ba824c98556049b556c15e01ed9ccfdf3` |
| R01 | far | move | 0.625 | `images/R01-far-move-0625ms.png` | `313177290129164c122a81bb7c73cbec8c2d758bb124307a5cda90c367f20127` |
| R01 | far | attack | 0 | `images/R01-far-attack-0000ms.png` | `313177290129164c122a81bb7c73cbec8c2d758bb124307a5cda90c367f20127` |
| R01 | far | attack | 0.3625 | `images/R01-far-attack-0363ms.png` | `13739fdb7fabc86849129b3f8b94bcf33b4525c73209712831c52d6fa2f8b9a5` |
| R01 | far | attack | 0.725 | `images/R01-far-attack-0725ms.png` | `cc70ea9995b06064ff3dad801d1f3028de0e1b3ad9e69141d60941b9dc5101f6` |
| R01 | far | attack | 1.0875 | `images/R01-far-attack-1088ms.png` | `ecd096b9b1b00236ec7e8ce9a23eb629d96da3da449bf6092158abf27e377f9d` |
| R01 | far | attack | 1.45 | `images/R01-far-attack-1450ms.png` | `313177290129164c122a81bb7c73cbec8c2d758bb124307a5cda90c367f20127` |
| R01 | far | hit | 0 | `images/R01-far-hit-0000ms.png` | `313177290129164c122a81bb7c73cbec8c2d758bb124307a5cda90c367f20127` |
| R01 | far | hit | 0.2 | `images/R01-far-hit-0200ms.png` | `d85efeedda1550ddee5139e120924f6195ab35b06fe578149daeadc578cf7d46` |
| R01 | far | hit | 0.4 | `images/R01-far-hit-0400ms.png` | `61f95981960a7bfd6eac0140c17d6a89b89ff0a59044d2c3385ab8a62c3e5fb9` |
| R01 | far | hit | 0.6 | `images/R01-far-hit-0600ms.png` | `efb600d4ec4aecea437f2c390a94dea8fab39aad279878394134465257fbef72` |
| R01 | far | hit | 0.8 | `images/R01-far-hit-0800ms.png` | `313177290129164c122a81bb7c73cbec8c2d758bb124307a5cda90c367f20127` |
| R01 | far | death | 0 | `images/R01-far-death-0000ms.png` | `313177290129164c122a81bb7c73cbec8c2d758bb124307a5cda90c367f20127` |
| R01 | far | death | 0.225 | `images/R01-far-death-0225ms.png` | `6b011f4e574e60c9157238826842fe9897424368b00df8ba34e35928fc6cff56` |
| R01 | far | death | 0.45 | `images/R01-far-death-0450ms.png` | `bd29cf6485cc349347eaf1264c0fa4d4896115228b53972e7e1754f1489636db` |
| R01 | far | death | 0.675 | `images/R01-far-death-0675ms.png` | `777723be9fdc7185dd05d084a9872a7fd6f2ab90f8e7a097303d7d674bb28fe7` |
| R01 | far | death | 0.9 | `images/R01-far-death-0900ms.png` | `2e72e53a817abb7ea8adf950eba6e69f0971492493357422dc70b94105ac9cb2` |
| R01 | far | death | 1.35 | `images/R01-far-death-1350ms.png` | `2e72e53a817abb7ea8adf950eba6e69f0971492493357422dc70b94105ac9cb2` |
| R01 | far | death | 1.8 | `images/R01-far-death-1800ms.png` | `2e72e53a817abb7ea8adf950eba6e69f0971492493357422dc70b94105ac9cb2` |
| R01 | far | static/front | 0 | `images/R01-far-static-front.png` | `cefe18afece06863d1c18b7e9df8466db488d66c5830661a671cea0820450869` |
| R01 | far | static/quarter | 0 | `images/R01-far-static-quarter.png` | `0f4a79a5854f57e91c7fab5446327b4cb49ed294d2fde34748c4c6d262eea71b` |
| R01 | far | static/rear | 0 | `images/R01-far-static-rear.png` | `fb0324aa84c7892b4ed22365c55c735841682ac1e31a684d44ea2c4dba110da1` |
