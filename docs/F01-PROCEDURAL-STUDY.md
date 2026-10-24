# F01 — Three.js static form study

## Scope

Original code-authored F01 (frontline / defensive / command), isolated at `/f01-study/`.
This is a **static visual experiment**, not an approved production asset, a rigged
character, or proof that twelve characters can be produced at the same quality.
`GRAPHICS.md` and `HERO-ATELIER.md` remain the design authorities. Replay, Enbu,
Senritsu, Jinrei, Catalog, existing G1 rendering and PR #4 assets are not changed.

The model is built entirely in TypeScript with Three.js `BufferGeometry`. No
Blender, Snow, imported character geometry, external texture or model download is
used. The stage's ground and plinth use ordinary Three.js geometry; they are not
part of the character.

## Source and regeneration

- `packages/renderer/src/f01-study/geometry.ts`: explicit polygon faces, matched
  contour sections, bevelled solid panels and swept hair locks.
- `model.ts`: separate named head, face, hair, chest, shoulders, arms, legs, cape,
  shield and sword groups; palette and shape definition; deterministic disposal.
- `viewer.ts`: on-demand WebGL2 inspection, six camera presets, three lighting
  presets, wireframe, orbit, button-based rotation/zoom and context-loss recovery.
- `apps/web/src/f01-study/`: isolated React preview. No fabricated gameplay stats.

```sh
npm ci
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:browser -- tests/visual/f01-static.spec.ts
npm run preview -- --host 127.0.0.1 --port 4173
# Open http://127.0.0.1:4173/f01-study/
```

`buildF01(definition)` takes a uint32 seed, shoulder width, head scale, cape spread
and a ten-color palette. Supported shape multipliers are 0.85–1.15. The seed only
changes the authored hair locks, not the character's gameplay identity. This is
not a general-purpose random character creator. Defaults produce 3,410 triangles,
115 independent meshes and ten materials. Geometry has real panel thickness,
bevels, authored cross-sections, a folded cape and a diamond-section sword blade.

The source is the editable asset. There is no GLB export, skeleton, animation,
LOD generation or game integration in this experiment. The battle-distance
preset draws the **same** mesh farther away; it is not a battle LOD.

## Reproducibility contract

Identical inputs reproduce identical mesh position/normal arrays and materials
within the tested runtime. Canonical snapshots include ordered names, buffers,
world transforms and material values, excluding generated Three.js UUIDs.
Transforms and colors are represented as float32. Transform components whose
absolute value is below `1e-12` are canonicalized to zero: Node and Chromium were
observed to differ by `1.734723475976807e-18` in two rotation-matrix entries while
the actual position and normal buffers matched. This normalization affects the
**identity snapshot only**, not the rendered geometry or scene transforms.

The UI's eight-digit FNV identity is a diagnostic, not a cryptographic guarantee.
The browser test also records a SHA-256 of the Node canonical snapshot, checks
its FNV identity against the browser, and checks same-seed pixel equality inside
the same browser session. Pixel identity across different GPUs, browsers,
Three.js versions or color pipelines is **not** promised. Commit the lockfile
and definition together; do not infer reproducibility from seed alone.

## Verification and evidence

`model.test.ts` checks all ten components, exact repeatability, input immutability,
real seed/proportion changes, finite positions, unit normals, non-degenerate
triangles, outward footwear/cape volumes, shield front-layer ordering, invalid
parameters and single disposal of owned resources.

`f01-static.spec.ts` exercises the production-built page in Chromium/WebGL2:
front, side, back, oblique, face and battle-distance captures; pointer and button
camera controls; actual lighting changes; wireframe; same-seed regeneration;
Node/browser identity; keyboard operation; invalid seed recovery; 320/390/430px
layouts; and actual `WEBGL_lose_context` failure/restart. The separate existing
Graphics G1 workflow also executes the replay browser regressions.

The read-only **F01 static study** Actions workflow uploads
`f01-static-study-evidence`, containing `docs/evidence/f01-procedural/` images,
`browser.json`, and the Playwright report. `browser.json` records the tested source
SHA, image hashes, canonical model hash, WebGL information, mesh/draw-call counts
and browser errors. Use evidence from the exact submitted source, not an older
successful run. The PR links the inspected run. Build/test success is not visual
acceptance. Browser viewport emulation is not physical iPhone or GPU testing.

## Visual assessment

The reference is Synty's [POLYGON Modular Fantasy Hero Characters official
product gallery](https://syntystore.com/products/polygon-modular-fantasy-hero-characters).
It is used to study silhouette, facet placement, armor layering and palette
coherence, not as a mesh/texture source. No reference image is bundled with the
application or represented as our output.

The produced model has an independently recognizable shield/sword silhouette,
silver plate over dark under-armor, blue cloth, restrained gold trim, facial
landmarks and a closed swept-hair cap. Actual first-pass browser images exposed
scalp intersections, an unsuitable beard strip, reversed footwear/cape faces,
floating chest straps and shield-layer penetration. Those causes were corrected
in geometry rather than hidden by camera choice or pixelation.

**This does not establish Synty-equivalent art quality.** Compared with the
reference, this model's face/hair remain geometrically simple, its posture is
rigid, shoulder masses are repetitive, and rear armor/hand-grip detail is limited.
There is no deformation/contact validation for movement. The result demonstrates
an editable code-only static model and inspection workflow; production adoption
and further art direction remain a visual decision, not a test assertion.

The intentionally separate meshes are useful for inspection but are not a
crowd-rendering optimization. The viewer reports draw calls including the stage.
No FPS, mobile GPU, many-unit performance or production memory target is certified.
Vite reports a shared Three.js/OrbitControls chunk above its 500 kB warning limit;
this study does not change the application's dependency/bundling policy.

## Provenance

All F01 geometry definitions, appearance, heraldry, code and UI in this study are
original repository contributions under its Apache-2.0 license. Three.js and its
`RoomEnvironment`/`OrbitControls` are existing MIT dependencies. No Synty asset,
Snow mesh, motion clip or third-party character is incorporated. The temporary
name Aegis Marshal is presentation text, not a Catalog or gameplay declaration.
