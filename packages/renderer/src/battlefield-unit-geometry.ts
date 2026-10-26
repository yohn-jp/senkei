import * as THREE from "three";

export type UnitSurface = "armor" | "cloth" | "leather" | "skin" | "glow";

/** Projected CSS-pixel thresholds keep nearby untracked units on bounded LODs. */
export function battlefieldUnitLodLevel(projectedHeight: number, focused: boolean, hero: boolean): 0 | 1 | 2 {
  if (focused || projectedHeight >= (hero ? 48 : 128)) return 0;
  if (projectedHeight >= (hero ? 18 : 50)) return 1;
  return 2;
}

export interface ProfileRing {
  y: number;
  x?: number;
  z?: number;
  radiusX: number;
  radiusZ: number;
}

/** Closed low-poly swept volume used for anatomy, boots, hafts and organic gear. */
export function profileGeometry(rings: readonly ProfileRing[], sides = 9): THREE.BufferGeometry {
  if (rings.length < 2 || sides < 5) throw new Error("A profile needs two rings and at least five sides");
  // Limbs are authored shoulder-to-wrist / hip-to-sole, while torsos and
  // weapons run upward. Normalize the sweep so both expose outward faces.
  rings = rings[0].y > rings[rings.length - 1].y ? [...rings].reverse() : rings;
  const positions: number[] = [];
  for (const ring of rings) {
    if (!(ring.radiusX > 0) || !(ring.radiusZ > 0)) throw new Error("Profile radii must be positive");
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2 + Math.PI / sides;
      positions.push(
        (ring.x ?? 0) + Math.cos(angle) * ring.radiusX,
        ring.y,
        (ring.z ?? 0) + Math.sin(angle) * ring.radiusZ,
      );
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rings.length - 1; row++) {
    for (let side = 0; side < sides; side++) {
      const a = row * sides + side;
      const b = row * sides + (side + 1) % sides;
      const c = (row + 1) * sides + (side + 1) % sides;
      const d = (row + 1) * sides + side;
      indices.push(a, d, b, b, d, c);
    }
  }
  const bottomCenter = positions.length / 3;
  positions.push(rings[0].x ?? 0, rings[0].y, rings[0].z ?? 0);
  const topCenter = positions.length / 3;
  const last = rings[rings.length - 1];
  positions.push(last.x ?? 0, last.y, last.z ?? 0);
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    indices.push(bottomCenter, side, next);
    const top = (rings.length - 1) * sides;
    indices.push(topCenter, top + next, top + side);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Bevelled, solid silhouette panel for cloth, tassets, shields and armor. */
export function panelGeometry(
  outline: readonly (readonly [number, number])[],
  depth = 0.055,
  bevel = 0.045,
): THREE.BufferGeometry {
  if (outline.length < 3 || depth <= 0) throw new Error("Panel needs a contour and positive depth");
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (let index = 1; index < outline.length; index++) shape.lineTo(outline[index][0], outline[index][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSegments: 1,
    bevelThickness: Math.min(bevel, depth * 0.4),
    bevelSize: bevel,
    curveSegments: 2,
    steps: 1,
  });
  geometry.translate(0, 0, -depth * 0.5);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Merge geometry by moving part and surface, retaining per-face palette colors. */
export function mergeColoredGeometry(
  geometries: readonly THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  for (const geometry of geometries) {
    const expanded = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = expanded.getAttribute("position");
    const normal = expanded.getAttribute("normal");
    const color = expanded.getAttribute("color");
    if (!position || !normal || !color) throw new Error("Colored unit geometry lacks a required vertex attribute");
    for (let index = 0; index < position.count; index++) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index));
      normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
      colors.push(color.getX(index), color.getY(index), color.getZ(index));
    }
    if (expanded !== geometry) expanded.dispose();
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export function setVertexColor(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const value = new THREE.Color(color);
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) {
    colors[index * 3] = value.r;
    colors[index * 3 + 1] = value.g;
    colors[index * 3 + 2] = value.b;
  }
  source.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  source.computeVertexNormals();
  source.computeBoundingBox();
  source.computeBoundingSphere();
  if (source !== geometry) geometry.dispose();
  return source;
}
