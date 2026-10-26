# Hero motion capture at 30a9d6d2660d

- Source HEAD: `30a9d6d2660dc8b120ef2a05ceacd9bd1807a315`; dirty worktree at capture: none.
- URL: http://127.0.0.1:4188/; viewport 1440 × 1000, device scale 1.
- Browser: Chromium 156.0.8078.47; SwiftShader software renderer.
- Source: committed production `createHeroModelPreview` / `buildBattlefieldHero`; automatic LOD at default camera, verified as full in every capture. This does not prove Battlefield integration or physical GPU performance.
- Motion: no reduced-motion preference. Captured 54 actual canvas PNGs across the five poses for F01 and R01; per-image SHA-256, elapsed request and pose/rootY/LOD attributes are in [manifest.json](manifest.json). The 1200 × 661 full-resolution originals are committed under [images](images/); their bytes match the ignored raw capture files at `test-results/art-production/hero-motion-30a9d6d/`.
- Runtime: 0 page errors, 0 console errors, 0 HTTP errors and 0 failed requests. Exact values are in the manifest.
- Review sheets: [F01](F01-motion-contact.jpg), [R01](R01-motion-contact.jpg). They are reduced overviews; use the committed full-resolution PNGs for detailed review. No visual acceptance is inferred here.
- All-LOD geometry contact is covered by the focused CPU regression tests; visual medium/far LOD remains unverified.
- Reproduction: build and serve the isolated lab at port 4188, then run `SENKEI_CHROMIUM_EXECUTABLE=/path/to/chromium SENKEI_ART_LAB_URL=http://127.0.0.1:4188/ node docs/evidence/art-production/hero-motion-30a9d6d/capture.mjs` from the repository root. The script stores source-revision metadata and writes raw canvases to ignored `test-results/`.

## PNG SHA-256

```text
F01-idle 0.000s 27b2be556c45d5e5d271bf40b45a6e48f30a82eeb4b849b3ade8217810ee94d9
F01-idle 0.924s bd2354da50109913c41d2b9a64687afc27992ba606f7aa35928a13546dfca338
F01-idle 1.848s 02bdfeeab6763c66ef88c05163e5520eac6434ffd8dc6bf019503cb484227a93
F01-idle 2.772s a02496b572f28b736b82bb00dabe286d097a4549908c8421459baec1c52d02de
F01-idle 3.696s 94ea32767a6df4312f826357e8d4f3134122561f2d148a41c8554aa7508ef90c
F01-move 0.000s d0186d13237acce6580cf553317ef7f1ef97032b3c3ab89cf956b74ca3a4e825
F01-move 0.156s 8788818369f412cc9eff6484513b05a330f3a3364249a6a1443fa2e5d58bab66
F01-move 0.313s b087daf3b3021b145970733e695b807a14b5e55a9879bdcd93960c5310cf028c
F01-move 0.469s 9e4f3b2f00bf31218fe635496c74ad36f372f5e42bb62cc2e6bfada7d4761442
F01-move 0.625s a37939ddb4f1732b84148fdd25db69c5d01046867389a37e9657448310e1724a
F01-attack 0.000s 2fc0dd5bd6a150b0a7105d9f773d8cf112305d1af78646b9c7a6d1ac9d532771
F01-attack 0.362s 0d37e02a173230fdc765dbe1367ad4679280730631121f4f97ddc46867ab2bf5
F01-attack 0.725s c42e122020dbf0b9be8dc6ee7d83659075adf412084f8792a2e2abac18242b12
F01-attack 1.087s 83095d1431ab7b4172b88facf8b770aafa2c43956e17bd37d0ef88e42f509777
F01-attack 1.450s 0bae24f817d523e42a889727244f27d0e684c68b19577da062d744f5637c915a
F01-hit 0.000s 2c0c2b2ca282aa6fe72fda5548f882ce6b91da14745bd8da95992332955bf742
F01-hit 0.200s 069d68df8c6c7529e7d8f60eb0c68ca99652e3abbf00221f991845d6ceb8ef1a
F01-hit 0.400s 463886e34022f5b08344a9916dc6ca404d1da84149e067de87667be6e6adecea
F01-hit 0.600s 1d680d1aea1dc45f2eb0f112d2ba26c12224c138dcd231e2d0aae5c674d3668c
F01-hit 0.800s f336bb693e9a3ea312d9d1b777dea8420394cf2e9fd61f3ce826b57dfa7fd132
F01-death 0.000s 1d6152dba444bf7228f9dcd82d45c507b68a32883b605c16aaed433bc6950470
F01-death 0.225s 45416f721176188d110c54d2dbd8729df1a51cb2601ae20ecc2732d02f648edd
F01-death 0.450s ea39ddc698cecb679d7241d4f3ab20f33410e7b430d21a6dde9d80c01c689bc8
F01-death 0.675s 6ccc08aa2a173b4b4d12eedca215d5b3f56832fc8fa25ac67f6f101e9ba14acd
F01-death 0.900s f44d79f8c7194653d9cb1b63ff28d2e2ad722e5b7bf98c1ccd5e325399104fea
F01-death 1.350s f44d79f8c7194653d9cb1b63ff28d2e2ad722e5b7bf98c1ccd5e325399104fea
F01-death 1.800s f44d79f8c7194653d9cb1b63ff28d2e2ad722e5b7bf98c1ccd5e325399104fea
R01-idle 0.000s d257b33ac375b8624c06cd1343e6462b6ff0ee06c9d2177d7c99ab911874594d
R01-idle 0.924s 901d2d477b7b59e6380c7853d4f1e56485fd3dcba91011e95c8abedeeae1bd69
R01-idle 1.848s efcc73e1c2b10243c3ca512d02af8bed42956294a1defc9d7e0f6f1a5fe2af31
R01-idle 2.772s 1414b3023e065b44355c3b834f582872db8c13bfb3dfb9dedbf014a0bc8e41e2
R01-idle 3.696s 14eb60c7161424c521377b1dd26d509d994bf7f543e46f79e043974ef9385273
R01-move 0.000s 025d8a4bdc90005f44ef19f014c7b422bdf51a007b3994ab015528a59bbef126
R01-move 0.156s 96bf6b95202c4f96984c561bb291a0dd81098a2a4242e6260fc0790238eaabaf
R01-move 0.313s 310e4d733bf233ed3a957f023aee517420f79e042ff6e37108c3310481ed6e3f
R01-move 0.469s c455a3f7b398982b93a90f92bb50183d1aa6af2e5b9a8596fd7fe50f49ec9f14
R01-move 0.625s 75dd6d83f674f06c9b77a8fdbddd2dd3faca80461548b168589ce2e178393a08
R01-attack 0.000s 5acd5364ea8df760f874fc762eee4d09004c85f50f5ab76a23d301c6e916570c
R01-attack 0.362s 97ebee8adaa571f40fff19b645824aad8a8a834d35196b7a2b83110aaeebce3a
R01-attack 0.725s 76812342bc976a8a16f8dc5510dfd0c297d2bad6e481b7e4360b51a2ff844a79
R01-attack 1.087s 7ba894dc6fece9d5d29f1fd605ba2dd32aa2b84b4f724ade2b20e683f8371896
R01-attack 1.450s f99882468333972f78db7d7bc7e0d98c53b35aa41c1bc04029d6ef8cd28db454
R01-hit 0.000s 196084d17faed88ffc3160d4b2aab0230c2a8033ea11aa12e07dc04121b57cf7
R01-hit 0.200s bd8aee8504a948ff50e94ef770cd3584d3f35217a020544baed2afec8dc9a42f
R01-hit 0.400s d0f9376c079c28640ec6d6df94c2c18641005db5cd9add9d9cd9dee17e556f29
R01-hit 0.600s 2ea31efe32cd65b5636edfbeea5807bb07d88056031cc38942bacf231ae0335f
R01-hit 0.800s 1e07a9a7fd42f7dd0987f9bc3a3cc26e48e3d70d0a8b5ac3cce487a6bfcb89fa
R01-death 0.000s 1d49acddccb5849cab50430360421a206bd5fd5fd94b21e06db5387d4def6b7f
R01-death 0.225s ff761a5ae96bd0f9ef43a5d5b47940610a8996171483bd560919564d13dfca6b
R01-death 0.450s a14a2ab8e194653ebd1e8f8cecae6143b89095c58b459dbd59be00e06cf88761
R01-death 0.675s 85455ebe2d577d33be3b5250f2214fee1d579d8377d1bc79d29477ed25b59f92
R01-death 0.900s 89d24a4cceb3567e60f8665872a5b664116cf5ea886d9c6c6491b062be89ee17
R01-death 1.350s 89d24a4cceb3567e60f8665872a5b664116cf5ea886d9c6c6491b062be89ee17
R01-death 1.800s 89d24a4cceb3567e60f8665872a5b664116cf5ea886d9c6c6491b062be89ee17
```
