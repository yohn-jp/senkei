# Independent review: Core 0.4 Battlefield replay capture

**Evaluator:** independent Art visual auditor  
**Capture app revision:** `6478dc9ee754f95e5554df1b44bd995496f0ee9c`  
**WASM SHA-256:** `c90f6902c97d0603567bf0e7997f5460fdf1916688365da75d6680f62d29f91e`  
**Replay digest:** `fa6c3eb29849b66c81e55635286cb1dbde7f9f702d72ef9b5716d91451a2cdc8`  
**Capture:** 1440×900, Chromium 156 with SwiftShader; output remains local and ignored.

The evaluator checked the full-resolution T000 Tactical, F01 Follow at tick 50, generic Hero death at tick 37, generic Hero respawn at tick 57, and F01 active-skill tick 146. All five PNG hashes match the capture metadata (5/5). The current browser run also verified that the real worker `reproduce` response and public/attacker owner replay digests match the Native run.

At T000, the visible Azure Fortress walls and courtyard are separated from the two-line label below them. In this view the label does not obscure the keep, wall, courtyard, or another visible structure. This finding is limited to this one view and tick.

The battlefield figure identified as F01 is too small and mixed with surrounding units to inspect its identity, face, equipment, silhouette, cloth, or material. R01 is not independently identifiable in these selected images. No defensible Hero visual score can be assigned from them.

The stills show replay moments, including an active-skill cue, but do not show a continuous action cycle, readable weapon contact, cloth motion, or settled holds. The death/respawn stills are F03, not F01 or R01. This set does not pass the Animation visual gate. A single camera scale does not establish near/mid/far LOD continuity or pass the LOD gate.

**Gate result:** real Replay→Renderer routing is verified by the passing browser run; visual Identity, Geometry, Material, Animation, and LOD for F01/R01 remain `NOT_CHECKED`. The existing `e627` preview score is still preview-only. No images or video are committed.

## Reviewed image SHA-256

| Capture | SHA-256 |
| --- | --- |
| `tactical-t000.png` | `560f879e116191d310eda5d3817945c9f1c01d0c7912abf0c0d8961d58597d27` |
| `follow-t050.png` | `84e23d342a920fb4bca8254b1e67c280c883f141ba9388e1deb82ed8be7ec94b` |
| `hero-death-t037.png` | `2bdba725229b512d1ab59a61a45d7ba6985f9e37ea505fc46027fdf14758c44e` |
| `hero-respawn-t057.png` | `102d36561d66c7eb5aa02c3e9c599ecfc8104e593c6538456fd3c9c2f474e20b` |
| `skill-t146.png` | `2d0a568009e143f4c377d06647ebf2aa5a57bc511f4aa6a3478cdb1ece9965a8` |

The complete screenshot, video, and replay bundle remain under the ignored local path `test-results/art-production/core-replay-0.4-active-skill-browser/capture/`.
