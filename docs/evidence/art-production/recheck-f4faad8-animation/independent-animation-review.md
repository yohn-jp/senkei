# F01/R01 production Hero Detail animation review

## Evidence and scope

- Source HEAD rendered: `f4faad814bf51564c1791dbe43544f9db0488d35`.
- Capture URL: `http://127.0.0.1:4189/` (isolated production Hero Detail preview).
- Capture: Chromium `156.0.8078.47`, 1440 × 1000 viewport, device scale 1, SwiftShader software GPU, `prefers-reduced-motion: no-preference`.
- Capture type: production `createHeroModelPreview` / `buildBattlefieldHero`; no Battlefield integration or LOD override.
- Raw full-resolution PNG directory: `/home/sophia/src/senkei-art-rig/test-results/art-production/rig-motion-f4faad8/`.
- Curated manifest: `/home/sophia/src/senkei-art-rig/docs/evidence/art-production/rig-motion-f4faad8/manifest.json`; SHA-256 `58cf7b79949a88419905bdc646e0a0feb7ef99a2edc1ed25289f65e32c769213`.
- The manifest lists 54 screenshots (F01 and R01 × idle/move/attack/hit/death samples). I inspected every raw PNG at full resolution. Independently recomputing the PNG hashes found 54/54 exact matches to the manifest. Manifest `errors`, `consoleErrors`, `httpErrors`, and `failedRequests` are empty.
- The manifest records an untracked evidence directory at capture time; the rendered source revision is the HEAD above. This review evaluates only the rendered animation presentation, not broader art acceptance.

## Scores and observed actions

The Animation axis score is the unweighted mean of the five visible action scores below; the contract does not assign weights among these action types. Per-axis scores remain subject to the 3.5 minimum, independently of the art-wide weighted average.

| Hero | Idle | Move | Attack | Hit | Death | Animation axis | Animation Hard Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| F01 | 3.0 | 4.0 | 3.5 | 3.0 | 2.0 | **3.1** | **FAIL** |
| R01 | 3.0 | 4.0 | 3.5 | 3.0 | 2.0 | **3.1** | **FAIL** |

### F01

- **Idle (3.0):** Five time samples show small head/torso changes. Breathing is present but reads weakly at the full-figure Hero Detail framing; the stance is close to static.
- **Move (4.0):** Alternating leg swing and a modest counter-sway in the arms/shield are legible across the five samples. No excessive foot lift is apparent. This stationary preview does not establish world translation, foot planting over a moving battlefield, or tactical-scale readability.
- **Attack (3.5):** The sword moves from its lowered ready position through a clear diagonal raised/forward pose and back down. The sword remains visibly attached to the hand; the shield and cape do not show an obvious cycle-time collision in this camera. The sequence reads as a compact swing, although the strongest poses are brief and the torso reaction is limited.
- **Hit (3.0):** A small torso/arm flinch is visible in the middle samples, then returns to rest. It is subtle at this framing and not strongly distinct from idle.
- **Death (2.0):** The body leans diagonally while the hips, legs, and boots remain nearly in their standing arrangement. The terminal image reads as a held stagger/lean rather than a completed fall and settled death pose. At 0.9, 1.35, and 1.8 seconds both boot soles appear to meet the floor; neither foot is visibly suspended and there is no excessive lift. The rendered `rootZ = 0.06` therefore preserves visible foot contact, but the resulting upper-body-to-leg relationship looks unnatural: the upper body is folded far to one side while the lower body stays upright. The 0.9/1.35/1.8 screenshots are pixel-identical, so no further settling is visible after the 0.9-second terminal sample.

### R01

- **Idle (3.0):** Head/torso variation is slight across the five samples; the idle reads nearly static at this distance.
- **Move (4.0):** Alternating steps and arm swing are clear across the cycle. The boots stay near the floor in the sampled poses, with no conspicuous floating. Staff and cape move only modestly; this preview cannot establish their clearances from unseen sides or a moving battlefield camera.
- **Attack (3.5):** The staff moves from upright behind the shoulder through a diagonal forward/down swing and returns. The hand remains on the staff in the sampled poses. No gross staff/tunic/cape penetration is visible from this camera, though the shaft passes close to the sleeve and robe during the swing.
- **Hit (3.0):** The upper body and staff shift slightly through the middle samples, then return; this response is visible but weak and resembles a small recoil.
- **Death (2.0):** The upper body and head tip sharply back/sideways while the robe-covered hips and legs remain upright. At 0.9, 1.35, and 1.8 seconds both soles visibly remain on the ground without excessive lift. As with F01, `rootZ = 0.06` keeps the feet planted but does not make the torso-to-leg pose look like a settled corpse. The staff and cape remain elevated behind the body, reinforcing a frozen recoil rather than a completed death. The 0.9/1.35/1.8 screenshots are pixel-identical.

### Collision and action coverage

Across the sampled F01 sword/shield and R01 staff/robe/cape frames, I found no definite mesh penetration or prop detachment in this front-quarter camera. F01's blade passes in front of the torso during the swing; R01's shaft passes close to the sleeve/robe. The capes/long garments remain visually rigid or move only slightly, so this evidence does not establish cloth motion or clearance from rear and side views. The hit actions are weak. The captured controls cover idle, move, attack, hit, and death only: **skill, respawn, actual combat-event timing, and full live cycles in the Battlefield are not checked here.**

## Acceptance boundary

The per-Hero Animation score is below the required 3.5/5 minimum. Both Animation Hard Gates are **FAIL** on the observed death terminal: the boots are grounded, but the upper body remains in an exaggerated lean and does not settle into a convincing completed death pose. Hit readability is also a material weakness. A low score or a grounded-boot observation does not offset this gate failure.

This capture does not assess the other Hero Hard Gates; for this review they remain `NOT_CHECKED`: Identity, Geometry, Material, LOD, Integration, Determinism, and Reproducibility. It also does not score Identity, Silhouette/Proportion, Geometry/Material, or Tactical Readability. The renderer is SwiftShader; no physical-GPU performance, application integration, all-LOD behavior, skill, respawn, or tactical-camera motion claim is made.

## Raw image SHA-256 references

All paths below are relative to `/home/sophia/src/senkei-art-rig/test-results/art-production/rig-motion-f4faad8/`. These are the full image hashes independently matched against the manifest above.

### F01

| Pose | Requested time | Raw PNG | SHA-256 |
| --- | ---: | --- | --- |
| idle | 0s | `F01-idle-0000ms.png` | `1f81b7b22ee8b3c25238fe3b14b13c4bcba702c595ea023de7cab52170b2da84` |
| idle | 0.924s | `F01-idle-0924ms.png` | `f2d3d4f55862b10bea7f58a547290a16762794090fff0835d6443c14796a968a` |
| idle | 1.848s | `F01-idle-1848ms.png` | `b000e5693e382c60cd08793ad45737bcee46f71bbc90747fca089df832ebedff` |
| idle | 2.772s | `F01-idle-2772ms.png` | `251588936837a910f9a51c0bcd5002698f8d03247ce6133adf6160187719cffa` |
| idle | 3.696s | `F01-idle-3696ms.png` | `e74a7874c5eec33eeeef5f35e10e7910c8d3e74b039952a5ca651f1d8dd69787` |
| move | 0s | `F01-move-0000ms.png` | `0920716e8a9cd69e619c2702b732e3e81d446d62bf9645d6f59d7e57177c964f` |
| move | 0.15625s | `F01-move-0156ms.png` | `25e7d176008250466dca24722741760bcb9b53bc4242d708e9f8aab081b06a55` |
| move | 0.3125s | `F01-move-0313ms.png` | `7b05d54fa17a2204053f4d88b08a43105ce6ad5ed6e0a696dd40213c53cb6384` |
| move | 0.46875s | `F01-move-0469ms.png` | `30905bcbe5c0ba7122818c99788ed8f48cbc6b8040b242c5a225cf1791fdc550` |
| move | 0.625s | `F01-move-0625ms.png` | `a2f42e7231f37ca2b03d0c12087267c4cfc9279624af3b670d9f8a69173dd42d` |
| attack | 0s | `F01-attack-0000ms.png` | `a2c2dc6fe59a68c18bf3ad3d3a04489b45278971edd32b0602c3264dd8adae71` |
| attack | 0.3625s | `F01-attack-0363ms.png` | `2969ea1cd9453ff089705b95d00bbaa0ce4c6f6682f3cbecddb202f2b02508c7` |
| attack | 0.725s | `F01-attack-0725ms.png` | `d06bec65f6adc53292e81c0ad20a0ef3bcefc1a71c82574448d4f93d53f5ba77` |
| attack | 1.0875s | `F01-attack-1088ms.png` | `732afe206813ce8a3667202c3ebfb9ac3430db152d8a8ad574caabcbe71754bc` |
| attack | 1.45s | `F01-attack-1450ms.png` | `0212834c0ee82d376a5fcf3e8dc388932442bd96a7da5b99477773c8090bd327` |
| hit | 0s | `F01-hit-0000ms.png` | `ca54867e2a2c11f3d82fca48402d0832f9d0e076cf1b393d1bea6629f155919d` |
| hit | 0.2s | `F01-hit-0200ms.png` | `983d58ecd7cf6bdcb37cf17fc54ed3247d0c96abe7956afe455c99c705cfb7dc` |
| hit | 0.4s | `F01-hit-0400ms.png` | `7dd0948fac371272d56e663fd270eaeaa2919ade55b039324db34e7569689035` |
| hit | 0.6s | `F01-hit-0600ms.png` | `d164fd451dccfb793f047b46403ef5901e1a35536af9ca5c11c9e884bc59012e` |
| hit | 0.8s | `F01-hit-0800ms.png` | `57a57f831696a2a46da881b007e638d8a1e884556b6cd7e3ae952350430b0c90` |
| death | 0s | `F01-death-0000ms.png` | `80fe8d849c159a33d5097aab9dd51b988b2fa72eb8126594d9859acac51624b2` |
| death | 0.225s | `F01-death-0225ms.png` | `e1b529302747b524d983d78fda080eb376a69d843dc119c598381ce7d4270644` |
| death | 0.45s | `F01-death-0450ms.png` | `dc1b9761ba932d356e855b5e503fd1eb905e153f9629c96cf823c942c5d195c6` |
| death | 0.675s | `F01-death-0675ms.png` | `dc1b9761ba932d356e855b5e503fd1eb905e153f9629c96cf823c942c5d195c6` |
| death | 0.9s | `F01-death-0900ms.png` | `dc1b9761ba932d356e855b5e503fd1eb905e153f9629c96cf823c942c5d195c6` |
| death | 1.35s | `F01-death-1350ms.png` | `dc1b9761ba932d356e855b5e503fd1eb905e153f9629c96cf823c942c5d195c6` |
| death | 1.8s | `F01-death-1800ms.png` | `dc1b9761ba932d356e855b5e503fd1eb905e153f9629c96cf823c942c5d195c6` |

### R01

| Pose | Requested time | Raw PNG | SHA-256 |
| --- | ---: | --- | --- |
| idle | 0s | `R01-idle-0000ms.png` | `00b3af8d936db12533d37571bac394a3c286fad6af9ef1349b701497b67f9de8` |
| idle | 0.924s | `R01-idle-0924ms.png` | `722c61a2714e88449686e243cf791c5a4b410ae73d9db004addb2d00ba7cc684` |
| idle | 1.848s | `R01-idle-1848ms.png` | `ff0c4819c10d1174343f8bc7da289a7739efa6684967e0dd32b7b180e0f84147` |
| idle | 2.772s | `R01-idle-2772ms.png` | `267596e5bdd92f54d7f9506b32b8e4894c2fdcc7834d1ef06d36d86bda0dc1e6` |
| idle | 3.696s | `R01-idle-3696ms.png` | `24bf91e3c588f543464af079d6ca2b8c1cb86e9f9393f7d428f00885f52fa46a` |
| move | 0s | `R01-move-0000ms.png` | `b90a6e889e359fdafb02ec66b03906a80748b057277b59759c0780daa25fe5bc` |
| move | 0.15625s | `R01-move-0156ms.png` | `245e4dd629c65ed65d0139bd2d2cccff612eb11f3222a2ef2e1258232dd88aa0` |
| move | 0.3125s | `R01-move-0313ms.png` | `bde176f0de70e015b821b5b8ffda38240f4e1006abbb899ebdf5cc31887d1e5e` |
| move | 0.46875s | `R01-move-0469ms.png` | `b8ebbc60b05bc2eb146e74c16816f1f0528696517cb29cdf8e7c13ad00a1fe23` |
| move | 0.625s | `R01-move-0625ms.png` | `613b5b837b9286ee58704729a5df70a99bbddd20903da51ed2a26f06d315c941` |
| attack | 0s | `R01-attack-0000ms.png` | `3474148ed9dfb992b8980c4d80d3d7cfcf49aafad0c7b6b83adfd85d6cfb6d5b` |
| attack | 0.3625s | `R01-attack-0363ms.png` | `e55b84031119fa2a56a0f299035cdf8ed955587624d521a4c306ce38709a4d05` |
| attack | 0.725s | `R01-attack-0725ms.png` | `9a71473c22fb2e72a95e90ce82cecdf6d30e2c0533ef4d4a13e81b30b9bba73a` |
| attack | 1.0875s | `R01-attack-1088ms.png` | `481e3703f4bbe7b886111bc39133b0c8516d7ff65127adb6691f06a09768b0b1` |
| attack | 1.45s | `R01-attack-1450ms.png` | `247efd426ce7bd3544d0806aa7ec4a38badaf90fbfcf6f3bc0804cdbfb5c6129` |
| hit | 0s | `R01-hit-0000ms.png` | `48db9c1d00868fc23cb8999071aed455f813a8279fc3938581f1a0e4d356cb93` |
| hit | 0.2s | `R01-hit-0200ms.png` | `26d8271b6762ebebc9fac275ae5354ad52a3f178cc0f46f53eef655901b4dca1` |
| hit | 0.4s | `R01-hit-0400ms.png` | `93684bd8b5ca377e5940f53335d38e7b6ee190bd66483a4aed3bab4832b34d07` |
| hit | 0.6s | `R01-hit-0600ms.png` | `dff0daa90a7ee39450fc502d462de42762429fa586ff161f28844e85488a9b60` |
| hit | 0.8s | `R01-hit-0800ms.png` | `032dfc1cfe620c3c07a8a8d1ef846d7a3b1832a31e34cf0a578609279936bb14` |
| death | 0s | `R01-death-0000ms.png` | `e88e8fac4c55233d01f2bb97fc3b4c4c4bf21dfb2c6d0a57a908e4315c596b66` |
| death | 0.225s | `R01-death-0225ms.png` | `d2d194a2ae6084d593083abe837c19ed11594abc3ea5422b089f2533a756aeeb` |
| death | 0.45s | `R01-death-0450ms.png` | `8e8c7540c35fe94a8bf4cf05b4d88f21c6a52d4f93a7f425659dab442c09b374` |
| death | 0.675s | `R01-death-0675ms.png` | `8e8c7540c35fe94a8bf4cf05b4d88f21c6a52d4f93a7f425659dab442c09b374` |
| death | 0.9s | `R01-death-0900ms.png` | `8e8c7540c35fe94a8bf4cf05b4d88f21c6a52d4f93a7f425659dab442c09b374` |
| death | 1.35s | `R01-death-1350ms.png` | `8e8c7540c35fe94a8bf4cf05b4d88f21c6a52d4f93a7f425659dab442c09b374` |
| death | 1.8s | `R01-death-1800ms.png` | `8e8c7540c35fe94a8bf4cf05b4d88f21c6a52d4f93a7f425659dab442c09b374` |
