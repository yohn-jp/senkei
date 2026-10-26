# f4faad814bf5 Hero motion capture

- Source HEAD: `f4faad814bf51564c1791dbe43544f9db0488d35`. The only dirty path at capture was this new, untracked evidence directory; no renderer source or test file was modified after that commit.
- URL: http://127.0.0.1:4189/; viewport 1440 × 1000, device scale 1.
- Browser: Chromium 156.0.8078.47; WebGL rendered with SwiftShader software GPU.
- Source: production `createHeroModelPreview` / `buildBattlefieldHero`; captured at full-detail camera distance. This lab has no control to force medium/far LOD and does not prove Battlefield integration or hardware performance.
- Motion: `prefers-reduced-motion: no-preference`; 54 actual canvas screenshots across idle, move, attack, hit and death time samples for F01/R01. Exact per-image SHA-256 and pose attributes are in [manifest.json](manifest.json). Raw PNGs are in ignored `test-results/art-production/rig-motion-f4faad8/` in this workspace.
- Runtime: 0 page errors, 0 console errors, 0 HTTP errors, 0 failed requests. See manifest for exact output.
- Review sheets: [F01](F01-motion-contact.jpg), [R01](R01-motion-contact.jpg). Sheets are downscaled overviews; use original PNGs for detailed visual review. No artistic PASS is inferred here.
- Visual LOD remains unverified. CPU geometry regression covers F01/R01 death samples at all 3 generated LODs in `battlefield-unit-rig-motion.test.ts`.
- Reproduction: see [capture.mjs](capture.mjs). First build and serve the isolated lab on port 4189 as described in [tools/art/README.md](../../../../tools/art/README.md), then run `SENKEI_CHROMIUM_EXECUTABLE=/path/to/chromium node docs/evidence/art-production/rig-motion-f4faad8/capture.mjs` from the repository root. The script records full canvas PNG hashes and writes ignored originals under `test-results/`.

## PNG SHA-256

```text
F01-idle 0.000s 1f81b7b22ee8b3c25238fe3b14b13c4bcba702c595ea023de7cab52170b2da84
F01-idle 0.924s f2d3d4f55862b10bea7f58a547290a16762794090fff0835d6443c14796a968a
F01-idle 1.848s b000e5693e382c60cd08793ad45737bcee46f71bbc90747fca089df832ebedff
F01-idle 2.772s 251588936837a910f9a51c0bcd5002698f8d03247ce6133adf6160187719cffa
F01-idle 3.696s e74a7874c5eec33eeeef5f35e10e7910c8d3e74b039952a5ca651f1d8dd69787
F01-move 0.000s 0920716e8a9cd69e619c2702b732e3e81d446d62bf9645d6f59d7e57177c964f
F01-move 0.156s 25e7d176008250466dca24722741760bcb9b53bc4242d708e9f8aab081b06a55
F01-move 0.313s 7b05d54fa17a2204053f4d88b08a43105ce6ad5ed6e0a696dd40213c53cb6384
F01-move 0.469s 30905bcbe5c0ba7122818c99788ed8f48cbc6b8040b242c5a225cf1791fdc550
F01-move 0.625s a2f42e7231f37ca2b03d0c12087267c4cfc9279624af3b670d9f8a69173dd42d
F01-attack 0.000s a2c2dc6fe59a68c18bf3ad3d3a04489b45278971edd32b0602c3264dd8adae71
F01-attack 0.362s 2969ea1cd9453ff089705b95d00bbaa0ce4c6f6682f3cbecddb202f2b02508c7
F01-attack 0.725s d06bec65f6adc53292e81c0ad20a0ef3bcefc1a71c82574448d4f93d53f5ba77
F01-attack 1.087s 732afe206813ce8a3667202c3ebfb9ac3430db152d8a8ad574caabcbe71754bc
F01-attack 1.450s 0212834c0ee82d376a5fcf3e8dc388932442bd96a7da5b99477773c8090bd327
F01-hit 0.000s ca54867e2a2c11f3d82fca48402d0832f9d0e076cf1b393d1bea6629f155919d
F01-hit 0.200s 983d58ecd7cf6bdcb37cf17fc54ed3247d0c96abe7956afe455c99c705cfb7dc
F01-hit 0.400s 7dd0948fac371272d56e663fd270eaeaa2919ade55b039324db34e7569689035
F01-hit 0.600s d164fd451dccfb793f047b46403ef5901e1a35536af9ca5c11c9e884bc59012e
F01-hit 0.800s 57a57f831696a2a46da881b007e638d8a1e884556b6cd7e3ae952350430b0c90
F01-death 0.000s 80fe8d849c159a33d5097aab9dd51b988b2fa72eb8126594d9859acac51624b2
F01-death 0.225s e1b529302747b524d983d78fda080eb376a69d843dc119c598381ce7d4270644
F01-death 0.450s dc1b9761ba932d356e855b5e503fd1eb905e153f9629c96cf823c942c5d195c6
F01-death 0.675s dc1b9761ba932d356e855b5e503fd1eb905e153f9629c96cf823c942c5d195c6
F01-death 0.900s dc1b9761ba932d356e855b5e503fd1eb905e153f9629c96cf823c942c5d195c6
F01-death 1.350s dc1b9761ba932d356e855b5e503fd1eb905e153f9629c96cf823c942c5d195c6
F01-death 1.800s dc1b9761ba932d356e855b5e503fd1eb905e153f9629c96cf823c942c5d195c6
R01-idle 0.000s 00b3af8d936db12533d37571bac394a3c286fad6af9ef1349b701497b67f9de8
R01-idle 0.924s 722c61a2714e88449686e243cf791c5a4b410ae73d9db004addb2d00ba7cc684
R01-idle 1.848s ff0c4819c10d1174343f8bc7da289a7739efa6684967e0dd32b7b180e0f84147
R01-idle 2.772s 267596e5bdd92f54d7f9506b32b8e4894c2fdcc7834d1ef06d36d86bda0dc1e6
R01-idle 3.696s 24bf91e3c588f543464af079d6ca2b8c1cb86e9f9393f7d428f00885f52fa46a
R01-move 0.000s b90a6e889e359fdafb02ec66b03906a80748b057277b59759c0780daa25fe5bc
R01-move 0.156s 245e4dd629c65ed65d0139bd2d2cccff612eb11f3222a2ef2e1258232dd88aa0
R01-move 0.313s bde176f0de70e015b821b5b8ffda38240f4e1006abbb899ebdf5cc31887d1e5e
R01-move 0.469s b8ebbc60b05bc2eb146e74c16816f1f0528696517cb29cdf8e7c13ad00a1fe23
R01-move 0.625s 613b5b837b9286ee58704729a5df70a99bbddd20903da51ed2a26f06d315c941
R01-attack 0.000s 3474148ed9dfb992b8980c4d80d3d7cfcf49aafad0c7b6b83adfd85d6cfb6d5b
R01-attack 0.362s e55b84031119fa2a56a0f299035cdf8ed955587624d521a4c306ce38709a4d05
R01-attack 0.725s 9a71473c22fb2e72a95e90ce82cecdf6d30e2c0533ef4d4a13e81b30b9bba73a
R01-attack 1.087s 481e3703f4bbe7b886111bc39133b0c8516d7ff65127adb6691f06a09768b0b1
R01-attack 1.450s 247efd426ce7bd3544d0806aa7ec4a38badaf90fbfcf6f3bc0804cdbfb5c6129
R01-hit 0.000s 48db9c1d00868fc23cb8999071aed455f813a8279fc3938581f1a0e4d356cb93
R01-hit 0.200s 26d8271b6762ebebc9fac275ae5354ad52a3f178cc0f46f53eef655901b4dca1
R01-hit 0.400s 93684bd8b5ca377e5940f53335d38e7b6ee190bd66483a4aed3bab4832b34d07
R01-hit 0.600s dff0daa90a7ee39450fc502d462de42762429fa586ff161f28844e85488a9b60
R01-hit 0.800s 032dfc1cfe620c3c07a8a8d1ef846d7a3b1832a31e34cf0a578609279936bb14
R01-death 0.000s e88e8fac4c55233d01f2bb97fc3b4c4c4bf21dfb2c6d0a57a908e4315c596b66
R01-death 0.225s d2d194a2ae6084d593083abe837c19ed11594abc3ea5422b089f2533a756aeeb
R01-death 0.450s 8e8c7540c35fe94a8bf4cf05b4d88f21c6a52d4f93a7f425659dab442c09b374
R01-death 0.675s 8e8c7540c35fe94a8bf4cf05b4d88f21c6a52d4f93a7f425659dab442c09b374
R01-death 0.900s 8e8c7540c35fe94a8bf4cf05b4d88f21c6a52d4f93a7f425659dab442c09b374
R01-death 1.350s 8e8c7540c35fe94a8bf4cf05b4d88f21c6a52d4f93a7f425659dab442c09b374
R01-death 1.800s 8e8c7540c35fe94a8bf4cf05b4d88f21c6a52d4f93a7f425659dab442c09b374
```
