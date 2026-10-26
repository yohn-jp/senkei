# Independent T000 fortress-label before/after review

Reviewer: `visual_auditor` on the dedicated `session/art-audit` review branch.

## Evidence inspected

I compared the full-resolution actual-app owner-view T000 PNGs, rather than contact-sheet reductions. The three PNG hashes below were independently recomputed from the raw files and match their capture manifests.

| Sample | Source HEAD | Capture manifest SHA-256 | Raw PNG path | Raw PNG SHA-256 |
| --- | --- | --- | --- | --- |
| Before fix, Tactical | `98ee8653110da447270c79ae524503eed91ba1fa` | `2fcdae8d2b015f28c9696faea9efa2c70109778f34c18243f739b4fb653756ac` | `/home/sophia/src/senkei-session-art/test-results/art-production/captures/head-98ee865/battlefield-default-t000.png` | `1520585380f8adc1d27a477b3bbbd7dc8f37d5cf2876433785f147f501be5912` |
| After fix, Tactical | `35950b2ff1b59e822f76c4d5dee0cfa8daac95e6` | `3666c1b01a9cb3046edbd20251032000b5c51dacf3de30a14a894c0d74e86a3f` | `/home/sophia/src/senkei-session-art/test-results/art-production/captures/head-35950b2-label/battlefield-default-t000.png` | `0e66b5a47f244b3b116bc0d4fa5c785ac4c781ab45e2c71cacf88901a3458210` |
| After fix, Cinematic | `35950b2ff1b59e822f76c4d5dee0cfa8daac95e6` | `3666c1b01a9cb3046edbd20251032000b5c51dacf3de30a14a894c0d74e86a3f` | `/home/sophia/src/senkei-session-art/test-results/art-production/captures/head-35950b2-label/battlefield-cinematic-t000.png` | `a455956df85af65128d14f2e26fa5cdab0486aef2eec07a3840d401d17a5252c` |

Both runs used Chromium `156.0.8078.47` with SwiftShader at 1440 × 1000. The post-fix manifest marks the scene rendered at Tick 0 in the actual application, with authorized owner-view fog metadata. This review is limited to the fortress label in these captured views.

## Visual result

- **Before:** The two-line `AZURE FORTRESS / Visible fortress` tile is readable, but it sits over the fortress footprint. It obscures the courtyard interior and overlaps the central keep/building shapes, including detail and units in that area. This is the reported obstruction.
- **After, Tactical:** Both title and status remain legible. The tile is below the projected fortress footprint, clear of the courtyard and keep. The fortress walls and central structures are visible without the label covering them.
- **After, Cinematic:** The same label placement remains readable and below the footprint. The courtyard and keep remain clear in this sibling view as well.
- **New obstruction:** I see no new obstruction of the fortress, courtyard, keep, or the visible road/approach in either post-fix image. The label occupies open ground below the fortress, covering terrain pixels only.

**Specific T000 fortress-label defect: PASS in the two inspected post-fix views.** The pre-fix Tactical image confirms the defect, and both post-fix views show the label moved out of the structure footprint without losing title/status readability.

## Acceptance boundary

This is only a before/after review of the T000 fortress-label defect. **Full Battlefield visual acceptance remains PARTIAL.** Other geography, bridge states, camera angles, ticks, labels, responsive/mobile framing, tactical topology, combat, and performance are not checked by this review. No general Battlefield visual PASS is implied.
