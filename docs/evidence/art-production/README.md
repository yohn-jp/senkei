# Golden-candidate inspection, 2026-10-26

**F01 and R01 are not accepted goldens. The remaining ten Heroes are not accepted by this evidence.** This records the current candidates at source `d5c57e89e1188b4fdc80f7ffb435d8a8ec16347f`; later renderer changes invalidate affected judgments. The worktree contained only untracked capture infrastructure/evidence during capture. No numeric art score is assigned.

## Captured scope

[Lab F01](lab/F01-contact.jpg), [lab R01](lab/R01-contact.jpg), and [lab provenance](lab/manifest.json) show the production Hero Detail builder in an isolated built Vite page. They cover front, 45° quarter, side, rear; idle/move/attack/hit/death; closest supported zoom; and 390 × 844 viewport. Reduced motion fixes one sample of each action, so these images do not prove live animation timing, ground contact across a cycle, or a terminal death pose.

Full PNGs remain reproducible in ignored `test-results/art-production/`; the committed sheets are reductions. Manifest hashes identify their source PNGs. Head/face details were also inspected in the original closest-zoom PNGs. Source references were the existing role/silhouette definitions, not a separately approved character concept. No unrelated character reference was used.

## Observed art defects

| Candidate | Evidence | Observation and next correction |
| --- | --- | --- |
| F01 | Closest zoom and front/quarter views in lab sheet | The mouth is a thick dark rectangular projection; eye/brow pieces protrude as separate slabs. Shape the mouth into the face volume and seat eyes/brows within the sockets before detail expansion. |
| R01 | Closest zoom and front/side views in lab sheet | Light rectangular eye pieces read as plaques on the face, with the same projecting mouth block. Correct eye/face integration and mouth depth. |
| R01 versus F01 | Both front/quarter sheets | Staff and head shape differ, but broad plate shoulders, shield-like chest applique and segmented armored skirt repeat the frontliner's construction. Strengthen channeler body/garment silhouette and the torso/shoulder distinction before expanding the roster. |
| Both | Rear/side views | Capes read as rigid nearly rectangular slabs; garment thickness and silhouette need deliberate side/rear shaping. No cloth-motion quality is claimed. |
| Both | Death sample | The fixed sample is a diagonal whole-body lean with feet still near the ground. It is readable as tipping, but cannot establish a completed fall or settled corpse. Capture the full trajectory before accepting death motion. |
| R01 | Closest zoom | Maximum supported zoom cuts the upper head/staff at this viewport. This limits face/hair inspection; provide a framing-aware close view before claiming face acceptance. |

## Acceptance by category

| Category | F01 | R01 | Meaning |
| --- | --- | --- | --- |
| Silhouette | UNVERIFIED | FAIL | F01 command identity is visible, but no approved comparison or combat-scale acceptance; R01 needs stronger channeler separation. |
| Facial anatomy | FAIL | FAIL | Protruding slab-like face parts described above. |
| Hair volume | UNVERIFIED | UNVERIFIED | Helmet/hood and available framing limit inspection. |
| Body anatomy | UNVERIFIED | UNVERIFIED | Multi-view samples show no earlier inverted shell holes; joint movement over a full cycle still needs review. |
| Garments | FAIL | FAIL | Rigid cape construction; R01 armor language needs revision. |
| Side/rear validity | UNVERIFIED | UNVERIFIED | Captured, with garment defects; not blanket approval. |
| Material readability | UNVERIFIED | UNVERIFIED | Faceted light/dark planes visible under one production lighting setup; neutral clay and Pixel/Smooth comparison absent. |
| Lab startup/control smoke | PASS | PASS | Actual WebGL canvas, hero switch, five pose buttons, orbit/reset and zoom captured without JavaScript runtime errors; console contains one unresolved resource 404. |
| Responsive layout | UNVERIFIED | UNVERIFIED | One narrow lab canvas captured; five required app widths and actual touch are outside this run. |
| Export | UNVERIFIED | UNVERIFIED | No model PNG-export UI in this preview. |
| Performance/LOD | UNVERIFIED | UNVERIFIED | No physical GPU, triangle/draw-call telemetry, or controlled LOD selection. SwiftShader is software rendering. |

Build verification: `npx vite build --config tools/art/vite.config.ts` and `npm run build` passed. Chromium `154.0.8037.57`, device scale 1, software SwiftShader. This is a partial inspection record, not production completion or user art approval.

## Actual application integration result

[App F01](app/F01-contact.jpg), [app R01](app/R01-contact.jpg), and [app manifest](app/manifest.json) record 20 actual Hero Detail captures. Both candidates passed canvas identity/readiness assertions, all five pose controls, orbit/reset, wheel zoom and a 390 px document-overflow assertion. Images were inspected separately from test completion. The same facial and garment defects remain; the lab art findings are not changed by app startup.

Real Jinrei compile and Ready preflight succeeded with WASM SHA `8ec4c1b4dcb9b5acb6fa59322aa6e8398db72fdd4ed1632af6dcb122326f59ea`. The run then remained on S11 computing the local battle and produced no battlefield canvas within 60 seconds. Therefore the combined Playwright test **failed**; actual battlefield integration is **UNVERIFIED**, not PASS. No JavaScript exception was recorded; console contains one unresolved resource 404. The timeout is not attributed to a renderer defect without further evidence. Tactical/Cinematic, actual Replay identity, live combat motion, scene performance and fog/privacy validation were not established by this run.
