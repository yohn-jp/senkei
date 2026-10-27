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
The label difference is not covered by the annotation-disabled comparison.

The standalone capture runner is
[`scripts/graphics/verify-issue51.mjs`](../../../scripts/graphics/verify-issue51.mjs).
It requires a production preview URL, expected source revision, and output
directory; it runs a real local battle rather than substituting Replay data.

This is scoped evidence for one real Replay, Tick, camera and display mode at
`986dcad`; it does not establish final integrated-HEAD, all-scene visual/art,
physical GPU, memory or touch acceptance. The synthetic placement benchmark
and unit-test coverage are described in the
[placement proposal](../../implementation/ISSUE51-PLACEMENT-INDEX-PROPOSAL.md).
