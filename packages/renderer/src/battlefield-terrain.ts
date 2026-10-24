import * as THREE from "three";
import type { Replay, WorldPoint } from "@senkei/replay-contract";

type Point2 = { x: number; y: number };
type ScenicInstance = {
  position: [number, number, number];
  color: number;
  scale?: [number, number, number];
  rotation?: [number, number, number];
};
type GroveSite = {
  x: number;
  z: number;
  axisX: number;
  axisZ: number;
  longRadius: number;
  shortRadius: number;
  seed: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (a: number, b: number, value: number) => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + 41.73) * 43758.5453;
  return value - Math.floor(value);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), sx);
  const bottom = THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx);
  return THREE.MathUtils.lerp(top, bottom, sy);
}

function terrainNoise(x: number, z: number): number {
  return (
    (valueNoise(x * 0.045 + 8, z * 0.045 - 3) - 0.5) * 1.12 +
    (valueNoise(x * 0.13 - 2, z * 0.13 + 12) - 0.5) * 0.46 +
    (valueNoise(x * 0.34 + 19, z * 0.34 + 4) - 0.5) * 0.12
  );
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function distanceToLines(point: Point2, lines: readonly (readonly WorldPoint[])[]): number {
  let nearest = Infinity;
  for (const line of lines)
    for (let i = 1; i < line.length; i++)
      nearest = Math.min(nearest, distanceToSegment(point, line[i - 1], line[i]));
  return nearest;
}

function pathSets(replay: Replay) {
  return {
    lanes: replay.scene.lanes.map((lane) => lane.points),
    jungle: (replay.scene.routes ?? [])
      .filter((route) => route.region === "jungle")
      .map((route) => route.points),
    camps: replay.scene.camps ?? [],
  };
}

function distanceToCamps(point: Point2, camps: Replay["scene"]["camps"]): number {
  return (camps ?? []).reduce(
    (nearest, camp) => Math.min(nearest, Math.hypot(point.x - camp.position.x, point.y - camp.position.y)),
    Infinity,
  );
}

function groveCoordinates(point: Point2, site: GroveSite): [number, number] {
  const dx = point.x - site.x, dz = point.y - site.z;
  return [dx * site.axisX + dz * site.axisZ, -dx * site.axisZ + dz * site.axisX];
}

function groveRadius(point: Point2, site: GroveSite): number {
  const [along, across] = groveCoordinates(point, site);
  const angle = Math.atan2(across / site.shortRadius, along / site.longRadius);
  const warp = 1 + Math.sin(angle * 3 + site.seed * 0.071) * 0.085 + Math.sin(angle * 5 - site.seed * 0.037) * 0.045;
  return Math.hypot(along / site.longRadius, across / site.shortRadius) / warp;
}

function groveInfluence(point: Point2, sites: readonly GroveSite[]): number {
  let influence = 0;
  for (const site of sites)
    influence = Math.max(influence, 1 - smoothstep(0.72, 1.16, groveRadius(point, site)));
  return influence;
}

function buildGroveSites(replay: Replay): GroveSite[] {
  const { lanes, jungle, camps } = pathSets(replay);
  const sites: GroveSite[] = [];
  let seed = 1;
  const addSite = (
    x: number,
    z: number,
    axisX: number,
    axisZ: number,
    longRadius: number,
    shortRadius: number,
    sourceSeed: number,
  ) => {
    const axisLength = Math.hypot(axisX, axisZ) || 1;
    const candidate: GroveSite = {
      x,
      z,
      axisX: axisX / axisLength,
      axisZ: axisZ / axisLength,
      longRadius,
      shortRadius,
      seed: sourceSeed,
    };
    if (sites.some((site) => Math.hypot(site.x - x, site.z - z) < 5.2)) return;
    sites.push(candidate);
  };

  // Each grove grows beside an authored jungle edge. Its long axis follows the
  // real edge while the road and its endpoints stay open. These patches are
  // scenery over the map's existing jungle regions, never new routes.
  for (const route of jungle) {
    for (let segment = 1; segment < route.length; segment++) {
      const start = route[segment - 1], end = route[segment];
      const dx = end.x - start.x, dz = end.y - start.y;
      const length = Math.hypot(dx, dz);
      if (length < 6.2) continue;
      const tx = dx / length, tz = dz / length;
      const nx = -tz, nz = tx;
      const t = length > 12 ? 0.48 : 0.5;
      const mx = start.x + dx * t, mz = start.y + dz * t;
      for (const side of [-1, 1]) {
        const localSeed = seed++;
        const offset = 5.0 + hash(localSeed, 13) * 1.05;
        const x = mx + nx * offset * side;
        const z = mz + nz * offset * side;
        const point = { x, y: z };
        if (
          distanceToLines(point, lanes) < 4.1 ||
          distanceToLines(point, jungle) < 4.35 ||
          distanceToCamps(point, camps) < 5.6
        ) continue;
        addSite(x, z, tx, tz, 4.1, 3.55, localSeed);
      }
    }
  }

  // Fill the broad spaces between lanes with connected woodland regions. The
  // candidate grid is clipped by every authored lane, jungle edge and camp;
  // it never adds a road or obstacle. Each cell chooses its safest open center
  // so groves form masses across the whole battlefield instead of isolated
  // trees along a perimeter.
  const { min, max } = replay.scene.bounds;
  const cellWidth = 7.6, cellDepth = 6.4;
  for (let z0 = min.y + 2.8; z0 < max.y - 2.8; z0 += cellDepth) {
    for (let x0 = min.x + 2.8; x0 < max.x - 2.8; x0 += cellWidth) {
      let best: { x: number; z: number; angle: number; score: number } | null = null;
      for (let row = 0; row <= 3; row++) {
        for (let column = 0; column <= 3; column++) {
          const localSeed = 5000 + Math.floor(x0 * 17 + z0 * 31) + row * 7 + column * 13;
          const x = x0 + 0.7 + (cellWidth - 1.4) * column / 3 + (hash(localSeed, 29) - 0.5) * 1.15;
          const z = z0 + 0.6 + (cellDepth - 1.2) * row / 3 + (hash(localSeed, 31) - 0.5) * 0.95;
          const point = { x, y: z };
          const laneClearance = distanceToLines(point, lanes);
          const routeClearance = distanceToLines(point, jungle);
          const campClearance = distanceToCamps(point, camps);
          if (laneClearance < 3.9 || routeClearance < 3.35 || campClearance < 4.8) continue;
          const score = Math.min(laneClearance - 3.3, routeClearance - 2.8, campClearance - 4.5)
            + hash(localSeed, 37) * 0.35;
          if (!best || score > best.score)
            best = { x, z, angle: hash(localSeed, 41) * Math.PI, score };
        }
      }
      if (best)
        addSite(
          best.x,
          best.z,
          Math.cos(best.angle),
          Math.sin(best.angle),
          4.25,
          3.7,
          Math.floor(x0 * 11 + z0 * 13),
        );
    }
  }

  // Select up to two open flanks around each true camp. This leaves a broad
  // neutral clearing at the authored node and gives the space a forest edge.
  for (let campIndex = 0; campIndex < (camps?.length ?? 0); campIndex++) {
    const camp = camps![campIndex];
    const candidates: { x: number; z: number; angle: number; score: number; seed: number }[] = [];
    for (let spoke = 0; spoke < 36; spoke++) {
      const localSeed = 3000 + campIndex * 97 + spoke;
      const angle = (spoke / 36) * Math.PI * 2 + hash(localSeed, 17) * 0.08;
      const radius = 6.15 + hash(localSeed, 19) * 0.75;
      const x = camp.position.x + Math.cos(angle) * radius;
      const z = camp.position.y + Math.sin(angle) * radius;
      const point = { x, y: z };
      const laneClearance = distanceToLines(point, lanes);
      const routeClearance = distanceToLines(point, jungle);
      const otherCampClearance = camps!.reduce(
        (nearest, other, otherIndex) => otherIndex === campIndex
          ? nearest
          : Math.min(nearest, Math.hypot(x - other.position.x, z - other.position.y)),
        Infinity,
      );
      if (laneClearance < 4.0 || routeClearance < 4.1 || otherCampClearance < 6.2) continue;
      candidates.push({
        x,
        z,
        angle,
        score: Math.min(laneClearance, routeClearance) + hash(localSeed, 23) * 1.1,
        seed: localSeed,
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const selected: typeof candidates = [];
    for (const candidate of candidates) {
      if (selected.length >= 2) break;
      if (selected.some((site) => Math.hypot(site.x - candidate.x, site.z - candidate.z) < 6.4)) continue;
      if (sites.some((site) => Math.hypot(site.x - candidate.x, site.z - candidate.z) < 5.2)) continue;
      selected.push(candidate);
      addSite(
        candidate.x,
        candidate.z,
        -Math.sin(candidate.angle),
        Math.cos(candidate.angle),
        4.05,
        3.5,
        candidate.seed,
      );
    }
  }
  return sites;
}

function colorAt(
  point: Point2,
  elevation: number,
  laneDistance: number,
  campDistance: number,
  forest: number,
  grove: number,
): THREE.Color {
  const texture = valueNoise(point.x * 0.16, point.y * 0.16);
  const moss = valueNoise(point.x * 0.052 - 5, point.y * 0.052 + 7);
  const soil = new THREE.Color(0x797d59).lerp(new THREE.Color(0x8c8963), moss * 0.58);
  soil.lerp(new THREE.Color(0x49664e), forest * 0.78);
  soil.lerp(new THREE.Color(0x354f41), grove * 0.7);
  soil.lerp(new THREE.Color(0x89815d), 1 - smoothstep(1.8, 4.8, laneDistance));
  soil.lerp(new THREE.Color(0xa69a73), 1 - smoothstep(3.0, 5.8, campDistance));
  soil.offsetHSL(0, (texture - 0.5) * 0.13, (texture - 0.5) * 0.15);
  soil.lerp(new THREE.Color(0xa5a074), smoothstep(0.24, 0.85, elevation) * 0.16);
  return soil;
}

function buildGround(
  scene: THREE.Scene,
  replay: Replay,
  sites: readonly GroveSite[],
): (x: number, z: number) => number {
  const { min, max } = replay.scene.bounds;
  const minX = min.x - 54, maxX = max.x + 54;
  const minZ = min.y - 54, maxZ = max.y + 54;
  const width = maxX - minX, depth = maxZ - minZ;
  const segmentsX = Math.ceil(width / 1.8), segmentsZ = Math.ceil(depth / 1.8);
  const position: number[] = [], colors: number[] = [], indices: number[] = [];
  const { lanes, jungle, camps } = pathSets(replay);
  const terrainAt = (x: number, z: number): number => {
    const point = { x, y: z };
    const routeDistance = Math.min(distanceToLines(point, lanes), distanceToLines(point, jungle));
    const campDistance = distanceToCamps(point, camps);
    const forest = smoothstep(2.6, 6.6, distanceToLines(point, lanes));
    const grove = groveInfluence(point, sites);
    const relief = -0.14 + terrainNoise(x, z) * 0.56 + forest * 0.18 + grove * 0.58;
    // Flatten the whole authored campsite glade before terrain relief starts;
    // otherwise the colored glade surface can sink beneath a surrounding hill.
    const campsiteRimDistance = Math.max(0, campDistance - 5.8);
    const nearbyPath = Math.min(routeDistance, campsiteRimDistance);
    const approach = smoothstep(2.15, 7.2, nearbyPath);
    return THREE.MathUtils.lerp(-0.045, THREE.MathUtils.clamp(relief, -0.58, 1.02), approach);
  };

  for (let iz = 0; iz <= segmentsZ; iz++) {
    const z = minZ + (depth * iz) / segmentsZ;
    for (let ix = 0; ix <= segmentsX; ix++) {
      const x = minX + (width * ix) / segmentsX;
      const point = { x, y: z };
      const laneDistance = distanceToLines(point, lanes);
      const campDistance = distanceToCamps(point, camps);
      const forest = smoothstep(2.6, 6.6, laneDistance);
      const grove = groveInfluence(point, sites);
      const elevation = terrainAt(x, z);
      position.push(x, elevation, z);
      const color = colorAt(point, elevation, laneDistance, campDistance, forest, grove);
      colors.push(color.r, color.g, color.b);
      if (ix < segmentsX && iz < segmentsZ) {
        const a = iz * (segmentsX + 1) + ix;
        const b = a + segmentsX + 1;
        if ((ix + iz) % 2 === 0) indices.push(a, b, a + 1, b, b + 1, a + 1);
        else indices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, flatShading: true }),
  );
  ground.name = "continuous-battlefield-ground";
  ground.receiveShadow = true;
  scene.add(ground);
  return terrainAt;
}

function bandGeometry(points: readonly WorldPoint[], width: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  if (points.length < 2) return new THREE.BufferGeometry();
  const half = width / 2;
  for (let i = 0; i < points.length; i++) {
    const previous = points[Math.max(i - 1, 0)];
    const current = points[i];
    const next = points[Math.min(i + 1, points.length - 1)];
    const beforeLength = Math.hypot(current.x - previous.x, current.y - previous.y) || 1;
    const afterLength = Math.hypot(next.x - current.x, next.y - current.y) || 1;
    const before = { x: (current.x - previous.x) / beforeLength, y: (current.y - previous.y) / beforeLength };
    const after = { x: (next.x - current.x) / afterLength, y: (next.y - current.y) / afterLength };
    const n1 = { x: -before.y, y: before.x }, n2 = { x: -after.y, y: after.x };
    let nx = n1.x + n2.x, ny = n1.y + n2.y;
    const normalLength = Math.hypot(nx, ny) || 1;
    nx /= normalLength; ny /= normalLength;
    const denominator = Math.max(0.62, Math.abs(nx * n1.x + ny * n1.y));
    const miter = Math.min(half / denominator, half * 1.55);
    positions.push(current.x + nx * miter, y, current.y + ny * miter);
    positions.push(current.x - nx * miter, y, current.y - ny * miter);
    if (i < points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function mergeBands(bands: readonly { points: readonly WorldPoint[]; width: number; y: number }[]): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  for (const band of bands) {
    const geometry = bandGeometry(band.points, band.width, band.y);
    const offset = positions.length / 3;
    positions.push(...(geometry.getAttribute("position").array as Float32Array));
    for (const index of geometry.getIndex()?.array ?? []) indices.push(index + offset);
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

function addRoads(scene: THREE.Scene, replay: Replay): void {
  const laneShoulders: { points: readonly WorldPoint[]; width: number; y: number }[] = [];
  const laneTracks: typeof laneShoulders = [];
  for (const lane of replay.scene.lanes) {
    laneShoulders.push({ points: lane.points, width: 2.95, y: Math.max(-0.005, lane.elevation - 0.09) });
    laneTracks.push({ points: lane.points, width: 2.05, y: lane.elevation - 0.045 });
  }
  const routeShoulders: typeof laneShoulders = [];
  const routeTracks: typeof laneShoulders = [];
  for (const route of replay.scene.routes ?? []) {
    if (route.region !== "jungle") continue;
    routeShoulders.push({ points: route.points, width: 2.25, y: 0.008 });
    routeTracks.push({ points: route.points, width: 1.18, y: 0.037 });
  }
  const batches = [
    ["lane-earth-banks", laneShoulders, 0x64684f, 1],
    ["lane-earth-tracks", laneTracks, 0xa3956e, 0.96],
    ["jungle-edge-earth", routeShoulders, 0x586b51, 1],
    ["jungle-tracks-from-map-edges", routeTracks, 0x8c8063, 1],
  ] as const;
  for (const [name, bands, color, roughness] of batches) {
    if (!bands.length) continue;
    const mesh = new THREE.Mesh(
      mergeBands(bands),
      new THREE.MeshStandardMaterial({ color, roughness, flatShading: true, side: THREE.DoubleSide }),
    );
    mesh.name = name;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function addSceneryInstances(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  items: ScenicInstance[],
): void {
  if (!items.length) {
    geometry.dispose();
    return;
  }
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
    items.length,
  );
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const transform = new THREE.Object3D();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    transform.position.set(...item.position);
    transform.rotation.set(...(item.rotation ?? [0, 0, 0]));
    transform.scale.set(...(item.scale ?? [1, 1, 1]));
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, new THREE.Color(item.color));
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  parent.add(mesh);
}

function addJungleMasses(
  scene: THREE.Scene,
  replay: Replay,
  sites: readonly GroveSite[],
  terrainAt: (x: number, z: number) => number,
): void {
  const { lanes, jungle, camps } = pathSets(replay);
  const trunks: ScenicInstance[] = [];
  const canopies: ScenicInstance[] = [];
  const canopyTops: ScenicInstance[] = [];
  const understory: ScenicInstance[] = [];
  const roots: Point2[] = [];
  const spacing = 1.72;
  const cap = 260;

  for (const site of sites) {
    const stepsLong = Math.ceil((site.longRadius * 2) / spacing);
    const stepsShort = Math.ceil((site.shortRadius * 2) / spacing);
    for (let row = 0; row <= stepsShort && roots.length < cap; row++) {
      const across = -site.shortRadius + (2 * site.shortRadius * row) / stepsShort;
      for (let column = 0; column <= stepsLong && roots.length < cap; column++) {
        const along = -site.longRadius + (2 * site.longRadius * column) / stepsLong;
        const localSeed = site.seed * 101 + row * 37 + column * 17;
        const jitterAlong = (hash(localSeed, 31) - 0.5) * 0.7;
        const jitterAcross = (hash(localSeed, 37) - 0.5) * 0.7;
        const u = along + jitterAlong, v = across + jitterAcross;
        const angle = Math.atan2(v / site.shortRadius, u / site.longRadius);
        const edgeWarp = 1 + Math.sin(angle * 3 + site.seed * 0.071) * 0.09 + Math.sin(angle * 5 - site.seed * 0.037) * 0.045;
        if (Math.hypot(u / site.longRadius, v / site.shortRadius) > edgeWarp) continue;
        if (hash(localSeed, 41) < 0.11) continue;
        const x = site.x + u * site.axisX - v * site.axisZ;
        const z = site.z + u * site.axisZ + v * site.axisX;
        const point = { x, y: z };
        if (
          distanceToLines(point, lanes) < 2.85 ||
          distanceToLines(point, jungle) < 2.55 ||
          distanceToCamps(point, camps) < 5.0 ||
          roots.some((root) => Math.hypot(root.x - x, root.y - z) < 1.28)
        ) continue;
        roots.push(point);
        const ground = terrainAt(x, z);
        const size = 0.9 + hash(localSeed, 43) * 0.3;
        const green = hash(localSeed, 47);
        const darkLeaf = green > 0.7 ? 0x587158 : green > 0.34 ? 0x45624b : 0x395943;
        trunks.push({
          position: [x, ground + 0.51 * size, z],
          scale: [0.24 * size, 0.98 * size, 0.27 * size],
          color: hash(localSeed, 53) > 0.48 ? 0x665e46 : 0x76694d,
        });
        canopies.push({
          position: [x, ground + 1.11 * size, z],
          scale: [1.42 * size, 1.02 * size, 1.32 * size],
          color: darkLeaf,
          rotation: [0, hash(localSeed, 59) * Math.PI, 0],
        });
        if (hash(localSeed, 61) > 0.18)
          canopyTops.push({
            position: [x + (hash(localSeed, 67) - 0.5) * 0.5, ground + 1.89 * size, z + (hash(localSeed, 71) - 0.5) * 0.42],
            scale: [0.89 * size, 0.82 * size, 0.9 * size],
            color: green > 0.47 ? 0x62805b : 0x527353,
          });
        if (hash(localSeed, 73) > 0.66)
          understory.push({
            position: [x + (hash(localSeed, 79) - 0.5) * 0.55, ground + 0.34 * size, z + (hash(localSeed, 83) - 0.5) * 0.55],
            scale: [0.92 * size, 0.49 * size, 0.84 * size],
            color: green > 0.5 ? 0x637751 : 0x536d50,
          });
      }
    }
  }

  addSceneryInstances(scene, "jungle-grove-trunks", new THREE.CylinderGeometry(0.18, 0.25, 1, 5), trunks);
  addSceneryInstances(scene, "jungle-canopy-masses", new THREE.IcosahedronGeometry(0.72, 0), canopies);
  addSceneryInstances(scene, "jungle-upper-canopy-masses", new THREE.IcosahedronGeometry(0.68, 0), canopyTops);
  addSceneryInstances(scene, "jungle-understory-masses", new THREE.IcosahedronGeometry(0.7, 0), understory);

  // Natural vegetation continues beyond the authored bounds. This sparse
  // perimeter softens the distant edge; it is kept away from all actual paths.
  const { min, max } = replay.scene.bounds;
  const perimeterTrunks: ScenicInstance[] = [], perimeterCanopies: ScenicInstance[] = [];
  let perimeterSeed = 9000;
  for (let row = 0, z = min.y - 15; z <= max.y + 15; row++, z = min.y - 15 + row * 5.4) {
    for (let column = 0, x = min.x - 15; x <= max.x + 15; column++, x = min.x - 15 + column * 5.7) {
      const seed = perimeterSeed++;
      if (x > min.x - 4 && x < max.x + 4 && z > min.y - 4 && z < max.y + 4) continue;
      const px = x + (hash(seed, 89) - 0.5) * 1.8, pz = z + (hash(seed, 97) - 0.5) * 1.8;
      if (hash(seed, 101) < 0.46 || distanceToLines({ x: px, y: pz }, [...lanes, ...jungle]) < 6.2) continue;
      const ground = terrainAt(px, pz), size = 0.8 + hash(seed, 103) * 0.45;
      perimeterTrunks.push({ position: [px, ground + 0.49 * size, pz], scale: [0.23 * size, 0.92 * size, 0.25 * size], color: 0x6e654b });
      perimeterCanopies.push({ position: [px, ground + 1.15 * size, pz], scale: [1.12 * size, 0.91 * size, 1.08 * size], color: hash(seed, 107) > 0.5 ? 0x526d53 : 0x425f4b });
    }
  }
  addSceneryInstances(scene, "natural-perimeter-trunks", new THREE.CylinderGeometry(0.18, 0.24, 1, 5), perimeterTrunks);
  addSceneryInstances(scene, "natural-perimeter-canopy", new THREE.IcosahedronGeometry(0.72, 0), perimeterCanopies);
}

/** Procedural terrain follows the Replay's real lanes, camps and traversable edges. */
export function buildBattlefieldTerrain(scene: THREE.Scene, replay: Replay): void {
  const sites = buildGroveSites(replay);
  const terrainAt = buildGround(scene, replay, sites);
  addRoads(scene, replay);
  addJungleMasses(scene, replay, sites, terrainAt);
}
