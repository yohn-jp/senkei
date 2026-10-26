# R01 LOD material response — independent visual re-review

Reviewer: `visual_auditor` on `session/art-audit`.

## Capture provenance

- Exact source revision: `770bb02d0c99aa65232950e92a68106d581b343e`.
- Manifest: `/home/sophia/src/senkei-art-fix/test-results/art-production/lod-material/head-770bb02/manifest.json`.
- Manifest SHA-256: `2e77a216dd2d9b5b4c4f94c98f4397fe6bf011fdd8fba3518e2305c51129d8ab`.
- Renderer: Chromium `156.0.8078.47` / SwiftShader software GPU; 1440 × 1000 viewport.
- Capture kind: isolated production-builder LOD comparison, not app integration. All six raw PNG SHA-256 values below were recomputed and match the manifest.
- The captured source worktree had two untracked comparison-harness files (`tools/art/lod-material-compare.html` and `.ts`); the manifest sourceRevision remains the exact source commit above.

## Selected-child and pose verification

All six captures use camera `3.5500,2.6000,5.6500,0.0000,1.0500,0.0000`.

| Pose | Full | Medium | Far |
| --- | --- | --- | --- |
| Idle | index 0, `battlefield-hero-r01.full` | index 1, `battlefield-hero-r01.medium` | index 2, `battlefield-hero-r01.far` |
| Attack | index 0, `battlefield-hero-r01.full` | index 1, `battlefield-hero-r01.medium` | index 2, `battlefield-hero-r01.far` |

For both poses, the selected LOD child changes as requested while the displayed stance and staff angle remain consistent across the three versions. Capture metadata specifies `reducedMotion: true`, idle at 0 seconds, and attack at 0 seconds held at the action peak. This is a static cross-LOD comparison, not a motion-cycle test.

## Effective material response and visual findings

The earlier claim that medium/far lose cloth and armor response was incorrect. It treated the `data-material-responses` entry for the single `baked` fallback material (`metalness=0`, `roughness=1`) as if those were the final per-pixel inputs.

At this source, `packages/renderer/src/battlefield-units.ts` puts `senkeiSurfaceResponse` on the merged geometry and its `BAKED_UNIT_MATERIAL.onBeforeCompile` shader uses the interpolated attribute to override `roughnessFactor`, `metalnessFactor`, and `totalEmissiveRadiance`. The manifest's five `data-response-vectors` values are present on both medium and far idle/attack captures:

- `0.30, 0.10, 1`
- `0.52, 0.36, 0`
- `0.78, 0, 0`
- `0.82, 0.02, 0`
- `0.92, 0.02, 0`

The vector list has no surface labels in the manifest, so this report records the values without assigning individual array positions to specific surfaces. The shader and shared-material source confirm that response data is supplied per vertex. The `data-material-responses` fallback summary alone does not show the effective response.

I inspected all six raw images:

- **Full LOD, idle and attack:** Cloth reads as matte and fold-bearing; armor plates and bracers have harder, brighter facet response. The cloth/armor distinction is plainly visible at this scale.
- **Medium LOD, idle and attack:** A visible but subtler difference remains. Cloth panels retain a matte response and the armor retains brighter, sharper facets. Some of the finer tunic folds are lost with reduced geometry.
- **Far LOD, idle and attack:** The response difference is weaker, and the muted teal surfaces look closer together. The robe still reads from its long hem and panel shape; the remaining armor facets have slightly brighter/harder edges. I do not see complete loss of cloth/armor pixel distinction, but the material separation is subtle at this LOD.
- **Cape:** It remains a rigid, rectangular dark panel across full/medium/far, with little visible drape. Because all captures use reduced motion and only idle/held-peak attack, cloth follow-through is not evaluated. This is a visible shape/motion limitation, not evidence that the shader dropped the per-vertex response.
- **Silhouette and weapon:** Hood, shoulders, long tunic, cape, and staff remain present across all LODs. The staff head and shaft remain continuous and attached to the hand in both poses. The simplified far version loses fine facets and robe folds but shows no major silhouette or weapon discontinuity.

The images show a subtle far-LOD response. They do not isolate the roughness/metalness shader contribution from vertex colors, geometry, and the single fixed light setup. No same-geometry neutral-response A/B or lighting sweep is included. The capture therefore does not prove a material defect that warrants another generator-code iteration; a controlled A/B capture would be needed to attribute any specific pixel difference to the response shader.

## Verdict and limits

**Material response:** effective per-vertex inputs are present. Visual cloth/armor separation is clear at full, subtle at medium, and weaker at far, but not absent. No material-response generator defect is demonstrated by these images.

**LOD:** this is partial R01 evidence only. The overall LOD Hard Gate remains `NOT_CHECKED`; the comparison covers R01 idle and held-peak attack in an isolated builder, with one camera and one lighting setup. It does not cover other Heroes, live action cycles, automatic distance transitions in the Battlefield, application integration, or a neutral-response/lighting A/B. No other Hard Gate is assessed here.

## Raw PNG SHA-256

All paths below are relative to `/home/sophia/src/senkei-art-fix/test-results/art-production/lod-material/head-770bb02/`.

| Image | Selected child | Pose | SHA-256 |
| --- | --- | --- | --- |
| `R01-full-idle.png` | `battlefield-hero-r01.full` | idle | `e01ce5a753c352299ea4549c982c2aeb5cf8ef2885e7901c69a8093e3ff71537` |
| `R01-medium-idle.png` | `battlefield-hero-r01.medium` | idle | `9d42ae670efda2b34607a606f1d60d48908df8c99e5c22771322c21c2b2a13cd` |
| `R01-far-idle.png` | `battlefield-hero-r01.far` | idle | `12bd7a70407c821ccc6e40168eb14aa54196e1e2d59a77a11f2aa90d292294ea` |
| `R01-full-attack.png` | `battlefield-hero-r01.full` | attack | `78eda6d6e67c350db5846e5abb0a43ee5e2f6dd4196d24cc3eb1e9d40272ec6b` |
| `R01-medium-attack.png` | `battlefield-hero-r01.medium` | attack | `b8a05cca4852b5afb80154d0972da97dc8e76491720bef545925fd189538817b` |
| `R01-far-attack.png` | `battlefield-hero-r01.far` | attack | `c26c7d41cb44a8ec42db5aaa5c9c7301ba0890fa2aa3cfc44e4344e7b4b3e59f` |
