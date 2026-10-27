# Replay placement: production browser comparison

This record covers the renderer and Replay Player at source and production
build revision `986dcad`. The WASM module was rebuilt from that revision;
SHA-256: `d79505cae8cebba56f593203549ee4958e157c8e9f7efe3daa04104ad38c9fbe`.
Chromium 156.0.8078.47 used SwiftShader, reduced motion, and a real local
Jinrei → Enbu/WASM battle with an authorized attacker Replay. The match ended
at Tick 577. Captures show Tick 13 in the same Overview camera at each width.

For each viewport, direct seek 0→13, successive steps 0→13, and rewind 14→13
were compared. Vision was enabled; Lanes and Engagements were disabled through
the application controls to isolate the rendered scene from DOM annotations.
At 320×740, 390×844, 430×932 and 1440×900 the three canvas-region captures were
byte-identical within each viewport and had identical camera/target metadata;
the browser reported no page errors. [report.json](report.json) records each
hash and camera. The four `*-direct-*` PNGs are representative; all three
320px images are retained as an example.

An earlier 320px run with labels enabled held the same final camera but the
`BOT` DOM label appeared in the direct capture and not the stepped capture.
[Direct](320-labels-on-direct-tick13.png) and
[stepped](320-labels-on-stepped-tick13.png) images are retained for diagnosis.
The difference came from synchronous collision measurements during an
unintended CSS transition: the reduced-motion stylesheet set a short duration
on all elements, while their default transition property remained `all`.
The renderer now disables transitions for the labels it measures.

## Labels enabled after the fix

The integrated production build at `c8b04c8`, with WASM SHA-256
`859a67bb03c7f76473d9cd7f544765bcbbca42234690acc6226b72ba314bc1fa`,
was compared with Lanes and Engagements both explicitly confirmed enabled.
It used the same Chromium, reduced-motion setting, four viewports, real local
battle, Overview camera, and Tick 13. The battle ended at Tick 577.
For all four viewports, direct, stepped, and rewind captures had the same
camera/target and the same visible label and minimap-legend DOM contents,
bounding rectangles, and colors. The original 320px label mismatch no longer
appeared. The [320px captures](labels-on-c8b04c8/320-direct-tick13.png)
include direct, stepped, and rewind examples; the complete metadata and
hashes are in [the report](labels-on-c8b04c8/report.json).

The screenshot hashes matched exactly at 320px and 430px. At 390px, the
direct and stepped screenshots differed at one HUD pixel `(358, 16)`, with a
maximum channel difference of one; at 1440px they differed at six pixels in
`(1281–1283, 208–213)` on the neutral minimap-legend dot, with a maximum
channel difference of three. Coordinates refer to each captured canvas region.
The corresponding direct and
stepped images are retained under `labels-on-c8b04c8`. The runner therefore
reported a strict pixel-comparison failure; the DOM and camera agreement above
is narrower than an all-pixel pass. A separate `2255d3b` production rerun at
1440px produced six identical images across two repetitions of each route and
identical label/legend DOM state, supporting a transient raster difference.
Neither comparison establishes behavior for every Tick, scene, or device.

The standalone capture runner is
[`scripts/graphics/verify-issue51.mjs`](../../../scripts/graphics/verify-issue51.mjs).
It requires a production preview URL, expected source revision, and output
directory; it runs a real local battle rather than substituting Replay data.

This is scoped evidence for one real Replay, Tick, camera and display mode at
the listed source revisions; it does not establish final integrated-HEAD,
all-scene visual/art, physical GPU, memory or touch acceptance. The synthetic
placement benchmark and unit-test coverage are described in the
[placement proposal](../../implementation/ISSUE51-PLACEMENT-INDEX-PROPOSAL.md).
