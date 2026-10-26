# Golden-candidate inspection, 2026-10-26

**F01 and R01 are not accepted goldens. The remaining ten Heroes are not accepted by this evidence.** This records the current candidates at source `d5c57e89e1188b4fdc80f7ffb435d8a8ec16347f`; later renderer changes invalidate affected judgments. The worktree contained capture infrastructure/evidence additions during capture; no model modifications. No numeric art score is assigned.

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
| Performance/LOD | UNVERIFIED | UNVERIFIED | No physical GPU or controlled LOD selection. Battlefield telemetry is recorded below; SwiftShader is software rendering. |

Build verification: `npx vite build --config tools/art/vite.config.ts` and `npm run build` passed. Chromium `154.0.8037.57`, device scale 1, software SwiftShader. This is a partial inspection record, not production completion or user art approval.

## Actual application integration result

[App F01](app/F01-contact.jpg), [app R01](app/R01-contact.jpg), and [app manifest](app/manifest.json) record 20 actual Hero Detail captures. Both candidates passed canvas identity/readiness assertions, all five pose controls, orbit/reset, wheel zoom and a 390 px document-overflow assertion. Images were inspected separately from test completion. The same facial and garment defects remain; the lab art findings are not changed by app startup.

Real Jinrei compile and Ready preflight succeeded with WASM SHA `8ec4c1b4dcb9b5acb6fa59322aa6e8398db72fdd4ed1632af6dcb122326f59ea`. The first attempt remained on S11 computing the local battle beyond its 60-second battlefield wait. With a bounded 240-second battle wait and 360-second overall limit, the combined Playwright test **passed 1/1 in 1.9 minutes**. The timeout was not a demonstrated renderer defect.

[Battlefield sheet](app/battlefield-contact.jpg) contains actual T000 renderer pixels from this locally compiled battle, then the same run after the Cinematic presentation control. Both report `data-rendered=true`, Tick 0 and `authorized-graph-samples` fog metadata. The screenshots show the visible base area; they do not demonstrate a readable Hero face at combat scale, all three lanes, combat animation, or hidden-information correctness. These remain unverified. The harness records UI attributes but does not export/hash the complete Replay; this run is not a canonical fixed-scenario replay comparison.

| T000 sample | Draw calls | Triangles | Full / medium / far LOD count | Renderer CPU sample | FPS sample |
| --- | ---: | ---: | --- | ---: | ---: |
| Default Tactical | 1,078 | 147,822 | 1 / 4 / 13 | 31.60 ms | 5.8 |
| Cinematic presentation, Tactical camera | 1,373 | 159,726 | 5 / 0 / 13 | 11.00 ms | 5.7 |

These are single canvas telemetry samples under **software SwiftShader**, including scene geometry. They are not physical GPU benchmarks, steady-state averages or a performance pass. Different LOD counts are observed, but no controlled LOD-distance test was performed. No JavaScript exception was recorded; console contains one unresolved resource 404. Overall art acceptance remains **FAIL**, with Performance and full battlefield visual acceptance **UNVERIFIED**.
