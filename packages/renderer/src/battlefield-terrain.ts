import * as THREE from "three";
import type { Replay, WorldPoint } from "@senkei/replay-contract";

type Point2 = { x: number; y: number };
type ScenicInstance = {
  position: [number, number, number];
  color: number;
  scale?: [number, number, number];
  rotation?: [number, number, number];
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
    (valueNoise(x * 0.045 + 8, z * 0.045 - 3) - 0.5) * 0.56 +
    (valueNoise(x * 0.13 - 2, z * 0.13 + 12) - 0.5) * 0.22 +
    (valueNoise(x * 0.34 + 19, z * 0.34 + 4) - 0.5) * 0.07
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

function colorAt(x: number, z: number, routeDistance: number, campDistance: number): THREE.Color {
  const texture = valueNoise(x * 0.22, z * 0.22);
  const moss = valueNoise(x * 0.075 - 5, z * 0.075 + 7);
  const color = new THREE.Color(0x71805f).lerp(new THREE.Color(0x828b67), moss * 0.66);
  color.lerp(new THREE.Color(0x596b54), (texture - 0.44) * 0.36);
  color.lerp(new THREE.Color(0x999171), 1 - smoothstep(2.7, 4.8, campDistance));
  color.lerp(new THREE.Color(0x78785c), 1 - smoothstep(2.2, 4.1, routeDistance));
  color.offsetHSL((hash(Math.floor(x * 2), Math.floor(z * 2)) - 0.5) * 0.018, 0, 0);
  return color;
}

function buildGround(scene: THREE.Scene, replay: Replay): (x: number, z: number) => number {
  const { min, max } = replay.scene.bounds;
  const minX = min.x - 54, maxX = max.x + 54;
  const minZ = min.y - 54, maxZ = max.y + 54;
  const width = maxX - minX, depth = maxZ - minZ;
  const segmentsX = Math.ceil(width / 2.2), segmentsZ = Math.ceil(depth / 2.2);
  const position: number[] = [], colors: number[] = [], indices: number[] = [];
  const lanes = replay.scene.lanes.map((lane) => lane.points);
  const routes = (replay.scene.routes ?? []).filter((route) => route.region === "jungle").map((route) => route.points);
  const allLines = [...lanes, ...routes];
  const camps = replay.scene.camps ?? [];
  const heightAt = (x: number, z: number): number => {
    const routeDistance = distanceToLines({ x, y: z }, allLines);
    const campDistance = camps.reduce(
      (nearest, camp) => Math.min(nearest, Math.hypot(x - camp.position.x, z - camp.position.y)),
      Infinity,
    );
    const relief = -0.12 + terrainNoise(x, z);
    const approach = smoothstep(2.3, 7.2, Math.min(routeDistance, campDistance * 0.94));
    return THREE.MathUtils.lerp(-0.085, relief, approach);
  };

  for (let iz = 0; iz <= segmentsZ; iz++) {
    const z = minZ + (depth * iz) / segmentsZ;
    for (let ix = 0; ix <= segmentsX; ix++) {
      const x = minX + (width * ix) / segmentsX;
      const routeDistance = distanceToLines({ x, y: z }, allLines);
      const campDistance = camps.reduce(
        (nearest, camp) => Math.min(nearest, Math.hypot(x - camp.position.x, z - camp.position.y)),
        Infinity,
      );
      position.push(x, heightAt(x, z), z);
      const color = colorAt(x, z, routeDistance, campDistance);
      colors.push(color.r, color.g, color.b);
      if (ix < segmentsX && iz < segmentsZ) {
        const a = iz * (segmentsX + 1) + ix;
        const b = a + segmentsX + 1;
        // Alternate the diagonal to keep a uniform grid from reading as a tile.
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
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      flatShading: true,
    }),
  );
  ground.name = "continuous-battlefield-ground";
  ground.receiveShadow = true;
  scene.add(ground);
  return heightAt;
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
      // Quads terminate on every authored point; the road never cuts a corner.
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
    laneShoulders.push({ points: lane.points, width: 3.35, y: Math.max(-0.005, lane.elevation - 0.09) });
    laneTracks.push({ points: lane.points, width: 2.42, y: lane.elevation - 0.045 });
  }
  const routeShoulders: typeof laneShoulders = [];
  const routeTracks: typeof laneShoulders = [];
  for (const route of replay.scene.routes ?? []) {
    if (route.region !== "jungle") continue;
    routeShoulders.push({ points: route.points, width: 2.55, y: 0.008 });
    routeTracks.push({ points: route.points, width: 1.45, y: 0.037 });
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

function addNaturalPerimeter(
  scene: THREE.Scene,
  replay: Replay,
  heightAt: (x: number, z: number) => number,
): void {
  const { min, max } = replay.scene.bounds;
  const lanes = replay.scene.lanes.map((lane) => lane.points);
  const routes = (replay.scene.routes ?? []).filter((route) => route.region === "jungle").map((route) => route.points);
  const lines = [...lanes, ...routes];
  const camps = replay.scene.camps ?? [];
  const trunks: ScenicInstance[] = [];
  const crowns: ScenicInstance[] = [];
  const crownsUp: ScenicInstance[] = [];
  const shrubs: ScenicInstance[] = [];
  const stones: ScenicInstance[] = [];

  // A loose, seeded forest matrix forms wooded pockets around the clearings.
  // Broad excluded margins follow actual road geometry, so canopies never sit
  // on top of a playable route. No scenery is given collision or LOS meaning.
  let index = 0;
  const stepX = 3.85, stepZ = 3.55;
  for (let row = 0, z = min.y - 10; z <= max.y + 10; row++, z = min.y - 10 + row * stepZ) {
    for (let column = 0, x = min.x - 10; x <= max.x + 10; column++, x = min.x - 10 + column * stepX) {
      const seed = index++;
      const jitterX = (hash(seed, 7) - 0.5) * 1.45;
      const jitterZ = (hash(seed, 19) - 0.5) * 1.3;
      const px = x + jitterX + (row % 2) * 0.7;
      const pz = z + jitterZ;
      const point = { x: px, y: pz };
      const laneDistance = distanceToLines(point, lanes);
      const routeDistance = distanceToLines(point, routes);
      const campDistance = camps.reduce(
        (nearest, camp) => Math.min(nearest, Math.hypot(px - camp.position.x, pz - camp.position.y)),
        Infinity,
      );
      if (laneDistance < 4.2 || routeDistance < 3.5 || campDistance < 4.0) continue;
      const cluster = valueNoise(px * 0.105 + 14, pz * 0.105 - 8);
      const perimeter = px < min.x - 1 || px > max.x + 1 || pz < min.y - 1 || pz > max.y + 1;
      const chance = perimeter ? 0.38 : 0.51;
      if (cluster < chance || hash(seed, 27) < 0.34) continue;
      const ground = heightAt(px, pz);
      const size = 0.68 + hash(seed, 13) * 0.47;
      const green = hash(seed, 31);
      if (hash(seed, 41) > 0.17) {
        trunks.push({
          position: [px, ground + 0.48 * size, pz],
          scale: [0.26 * size, 0.9 * size, 0.28 * size],
          color: green > 0.53 ? 0x655d47 : 0x75664b,
        });
        crowns.push({
          position: [px, ground + 1.15 * size, pz],
          scale: [0.79 * size, 0.84 * size, 0.77 * size],
          color: green > 0.68 ? 0x587258 : green > 0.35 ? 0x496850 : 0x3f604f,
          rotation: [0, hash(seed, 47) * Math.PI, 0],
        });
        if (hash(seed, 53) > 0.26)
          crownsUp.push({
            position: [px + (hash(seed, 59) - 0.5) * 0.2, ground + 1.72 * size, pz],
            scale: [0.55 * size, 0.61 * size, 0.56 * size],
            color: green > 0.47 ? 0x617d59 : 0x516f54,
          });
      } else if (hash(seed, 61) > 0.42) {
        shrubs.push({
          position: [px, ground + 0.31 * size, pz],
          scale: [0.61 * size, 0.42 * size, 0.58 * size],
          color: green > 0.5 ? 0x6d8058 : 0x5c7355,
          rotation: [0, hash(seed, 71) * Math.PI, 0],
        });
      } else {
        stones.push({
          position: [px, ground + 0.2 * size, pz],
          scale: [0.62 * size, 0.4 * size, 0.5 * size],
          color: hash(seed, 73) > 0.5 ? 0x82836a : 0x747b68,
          rotation: [0.05, hash(seed, 79) * Math.PI, 0.12],
        });
      }
    }
  }

  // Low, broken rock shelves sit well outside any authored corridor. Their
  // uneven spacing suggests the hills continuing beyond the map, not a rim.
  const centerX = (min.x + max.x) / 2, centerZ = (min.y + max.y) / 2;
  for (let i = 0; i < 46; i++) {
    const angle = (i / 46) * Math.PI * 2 + (hash(i, 101) - 0.5) * 0.16;
    const x = centerX + Math.cos(angle) * ((max.x - min.x) * 0.5 + 10 + hash(i, 103) * 5);
    const z = centerZ + Math.sin(angle) * ((max.y - min.y) * 0.5 + 9 + hash(i, 107) * 4);
    if (distanceToLines({ x, y: z }, lines) < 7.1) continue;
    if (hash(i, 109) < 0.48) continue;
    const ground = heightAt(x, z);
    const scale = 0.8 + hash(i, 113) * 1.2;
    stones.push({
      position: [x, ground + 0.24 * scale, z],
      scale: [1.5 * scale, 0.48 * scale, 0.84 * scale],
      rotation: [0, angle + 0.7, 0.06],
      color: hash(i, 127) > 0.5 ? 0x7c806d : 0x696f61,
    });
  }

  addSceneryInstances(scene, "perimeter-grove-trunks", new THREE.CylinderGeometry(0.19, 0.27, 1, 5), trunks);
  addSceneryInstances(scene, "perimeter-grove-canopies", new THREE.IcosahedronGeometry(0.72, 0), crowns);
  addSceneryInstances(scene, "perimeter-upper-canopies", new THREE.IcosahedronGeometry(0.7, 0), crownsUp);
  addSceneryInstances(scene, "jungle-understory", new THREE.IcosahedronGeometry(0.72, 0), shrubs);
  addSceneryInstances(scene, "natural-rock-shelves", new THREE.DodecahedronGeometry(0.7, 0), stones);
}

/** Procedural low-poly land around the authored map; no navigation is inferred. */
export function buildBattlefieldTerrain(scene: THREE.Scene, replay: Replay): void {
  const heightAt = buildGround(scene, replay);
  addRoads(scene, replay);
  addNaturalPerimeter(scene, replay, heightAt);
}
