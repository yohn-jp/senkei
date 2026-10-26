# Battlefield environment production

The environment uses the existing Three.js production renderer and authorized
Replay data. Its authorities are [ART-DIRECTION.md](ART-DIRECTION.md),
[BATTLEFIELD-VISUAL.md](BATTLEFIELD-VISUAL.md), and [GRAPHICS.md](GRAPHICS.md).
World connectivity, travel, combat, bridge authorization, and fog rules remain
owned by their existing contracts.

## Geometry and material grammar

- Fortresses retain their courtyard, keep, walls, corner towers, and faction
  standards. Towers retain their bastions, buttresses, parapets, and watch roofs.
  Bridges retain authored spans, piers, decks, rails, and Replay state changes.
  The observatory retains its island architecture and visible ownership cues.
- Architectural stone and timber use matte, flat-shaded Standard materials.
  Existing low-sided cylinders and cones define actual solid silhouettes.
  Faction cloth now has a sparse raised ridge with five triangles, retaining
  the original swallowtail outline and faction colors. The fold is geometry;
  no facet texture or added ornament supplies it. Cloth roughness is 0.94.
- Terrain maps retain deterministic, tileable sRGB color, mip filtering, world
  tile sizes, and vertex-color support. Broad patches carry the variation;
  high-frequency grain has lower amplitude. Flat-shaded terrain geometry and
  existing elevation remain responsible for relief.
- Ford stones remain instanced detail-zero dodecahedra with matte stone
  materials. River shelves, ripples, and foam remain sparse transparent marks
  without depth writes. Existing ford, bridge, and island exclusions remain
  intact. A ford gains no deck or rail from this work.

## Regeneration and verification

These assets are generated directly by `battlefield-architecture.ts`,
`battlefield-terrain-materials.ts`, and `battlefield-water-details.ts` under
`packages/renderer/src`. No external assets, new licenses, generated binary
files, or screenshot-specific renderer are introduced.

Run the focused checks with:

```sh
npx vitest run packages/renderer/src/battlefield-architecture.test.ts packages/renderer/src/battlefield-terrain-materials.test.ts packages/renderer/src/battlefield-water-details.test.ts
```

The tests cover real nonplanar cloth faces and winding, retained outline and
faction material, restrained texture grain, low-sided ford geometry, deterministic
instance placement, Replay immutability, and the existing bridge/ownership/damage
state behavior. These checks do not establish visual quality or performance.

Visual, interaction, and physical GPU performance status for this environment
change is **NOT_CHECKED** until production-build browser evidence is captured
and inspected. Required inspection includes Overview terrain continuity,
Tactical lane and unit readability, Follow material/cloth detail, bridge states,
fords, observatory ownership, and the desktop/mobile viewports specified by
[BATTLEFIELD-VISUAL.md](BATTLEFIELD-VISUAL.md). Record the submitted HEAD,
Replay/tick, camera, viewport, and Pixel/Smooth setting with every capture.
