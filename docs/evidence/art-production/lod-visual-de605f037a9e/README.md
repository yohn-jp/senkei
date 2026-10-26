# Hero visual LOD capture at de605f037a9e

- Source HEAD: `de605f037a9e55e682e6ab75fd6becc47ed5fa7f`; dirty worktree at capture: none.
- URL: http://127.0.0.1:4188/; fixed viewport 1440 × 1000, device scale 1; all same-action views assert a fixed camera across full/medium/far.
- Browser: Chromium 156.0.8078.47; SwiftShader software renderer.
- Source: production `createHeroModelPreview` and `buildBattlefieldHero`. The inspection control explicitly selects generated `full`, `medium`, or `far` child and records child name, index and visibility vector. This does not prove Battlefield integration or physical GPU performance.
- Captures: 41 actual 1200×661 canvas PNGs; requested set is 54 action/time samples per LOD across F01/R01 plus 18 static front/quarter/rear angles (180 total). SHA-256, camera, inspection azimuth, pose, rootY, selected-child identity, material profile and baked `senkeiSurfaceResponse` vector counts/values are in [manifest.json](manifest.json). Portable originals are in [images/](images/); identical raw copies are in ignored `test-results/art-production/lod-visual-de605f037a9e/`.
- R01 material comparison: use the full, medium and far contact sheets and original front/rear/move frames to compare cloth tunic/cape against armor. Baked response vectors are recorded without assigning surface labels. No visual pass is inferred.
- Runtime: 0 page errors, 0 console errors, 0 HTTP errors and 0 failed requests. Exact values are in the manifest.
- Contact sheets: [F01-full](F01-full-contact.jpg), [F01-medium](F01-medium-contact.jpg), [F01-far](F01-far-contact.jpg), [R01-full](R01-full-contact.jpg), [R01-medium](R01-medium-contact.jpg), [R01-far](R01-far-contact.jpg). They are overviews; independent review should use full-resolution originals.

## PNG SHA-256

```text
F01-full-idle-0.000s cda8e590c97ccb2cacfcec1ae664a100180ca3edc8c7eb12e363e9c69f6b7677
F01-full-idle-0.924s fd738c7d5a7a2b573692c350e8ba0586d91d5fb07790219a6fe25ee29c1406bd
F01-full-idle-1.848s 15acc341802755c31745384f5fc811249538e81193c42d3f413b26b7b45d73fe
F01-full-idle-2.772s 91ad7a22bbd49a193c4598b0973aa3dc897c94cfab4fcccc6e2746fdea9c8758
F01-full-idle-3.696s cbaeb1292219e506c08151d07a345b5b681192b64fc2d0601fd44eb4d9d62e89
F01-full-move-0.000s a2c28d6bd086bdc784b2ee47daf34205be130871dbe3d3de7ee4789be4871898
F01-full-move-0.156s 573fcc94674ae9076d9e887a779d5c2bfebfcf05a752c472701593a346ae427a
F01-full-move-0.313s eafb9cc66709839f6ac885bde1f891d197ddc7c5b1229244c2c324e18f1147fa
F01-full-move-0.469s d51cea3b044f555e52c925e4d77b23a1142cd1f00648e51187ee7b04cc21089a
F01-full-move-0.625s 7fa7d46c72e1d7da59a275501ae7b727a758f6c223f8f5edb7de7319a8e36735
F01-full-attack-0.000s 883046475f9c44eaba8162d34927145b0e1fc230e34c27e7526a74868b3e051f
F01-full-attack-0.362s 2d368d379497d5115a67df470649c33747f129b92d0ee8e3ce83e414469dd595
F01-full-attack-0.725s 63a9e216442295b625374c11e69f4d76fdd07eaeb861980d8418ee34fe01fa36
F01-full-attack-1.087s 0bbf039a77f2aebfba5de11a39dd6f1f30afa5d490f14d0c33f664d701c47ff6
F01-full-attack-1.450s 632eee30d397af276cd5b4867ea08cfb9618d4b02e57d8dd8bafa480f3a7ffed
F01-full-hit-0.000s 564ce2445670679b5c7be2aa16049953269105df0f89197a897ea90409606d6a
F01-full-hit-0.200s 06fdcb18f1993e29da4c8b86039d412eeb49848c6f9f96869f16f2db4f65dae7
F01-full-hit-0.400s 9105d10f234c371b7938f96586a287ac2c254d07381c9bf69a99685126f1db66
F01-full-hit-0.600s d603bf5cee005dbfcaf315f08f11c42e58ea50081ed8304f37dbe9a5b86b8d44
F01-full-hit-0.800s 04e76113acfd8b88a168e3122f96e2a0d270041f55e02deb18292c6c99f25c09
F01-full-death-0.000s c2f425231e51e2f59f8fc3bcc930578a960f094416c61c7f6e8132f5e6579106
F01-full-death-0.225s 4db67d0044146f519180231b2400eb662f724fd7460e78099707405f5a2826c0
F01-full-death-0.450s a0690b491d4e46e47c16b0972998350a9bf633f217aec85e9ef970b12bffd65c
F01-full-death-0.675s f139cfe1e1a9133f059cefc73f11aa5592619cf62cdca20378d6645ed3c07b2a
F01-full-death-0.900s 97d152876bbdf28a81a131452632f1ed30cb217ef5c8e17862bc0ddacd2196ab
F01-full-death-1.350s 97d152876bbdf28a81a131452632f1ed30cb217ef5c8e17862bc0ddacd2196ab
F01-full-death-1.800s 97d152876bbdf28a81a131452632f1ed30cb217ef5c8e17862bc0ddacd2196ab
F01-full-front e18032b9935cb9348f460d98ca22a59d8b16ed47d89feeede1d6051cac4fa8da
F01-full-quarter d2aa5198eef842364fa640aa147179d555c17c1474765762f2a6d3542643696d
F01-full-rear 82c48cb79d66d77d8cdde81c0b4ecb9e91cd05baa4e3c5f04a83992269f5409a
F01-medium-idle-0.000s eff45ab23ff499ff331fd16eb81116e65f37e2305855fda71d199fb5b6c429e3
F01-medium-idle-0.924s 7e3324fd36fdb0645ecfb2f9e97aa3702f951d72d931cde9c95030faab85c6ea
F01-medium-idle-1.848s 1c8242fad8bc896d982e32b5bc9152858de74491b3ad5957da87446853236187
F01-medium-idle-2.772s 5fb328246d82d5daeb3ef11321887be2004b7e5591db746628ba876d210bbea2
F01-medium-idle-3.696s fc340310d482fb88142f1216073c6b7f05fb1c3530feab6b4c433cfed0e165aa
F01-medium-move-0.000s 3354f1d5803725cfbe1ea0cba30fcf79a5c84a8a71ea760f5afee29481d16b72
F01-medium-move-0.156s 0898a3ad8a0b160bb98760d67bcf9727f6255598f1055e2d951ac33f490529e3
F01-medium-move-0.313s ce771f0c8fb3f527b8ed8a7553555e232a8bedf4fb237e60aa40540358065a09
F01-medium-move-0.469s 804cab9ab8506d1bfe489f70fe302f98bb76fbabe4880ede7b1471cfab4680fc
F01-medium-move-0.625s 2c79f03157abff198d851021404015b7caa2f46591a8a88a2702a5575e67ba3e
F01-medium-attack-0.000s 1f0d7059688361dbc3515960ea659c13556dfd43a9dfe599b588091e95821419
```
