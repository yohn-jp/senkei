import * as THREE from "three";
import type { Replay, WorldPoint } from "@senkei/replay-contract";
import { scenicRiverCourse } from "./battlefield-geography";

type Point2 = { x: number; y: number };
type Polyline = readonly WorldPoint[];
type ScenicInstance = {
  position: [number, number, number];
  color: number;
  scale?: [number, number, number];
  rotation?: [number, number, number];
};
type ForestRegion = {
  id: string;
  polygon: Point2[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  boundaries: readonly Polyline[];
};
type TerrainData = {
  at: (x: number, z: number) => number;
  forest: (x: number, z: number) => number;
  regions: ForestRegion[];
};

const ROAD_LEVEL = 0.015;
const CAMP_LEVEL = -0.045;
const TRACK_LEVEL = 0.055;
const RIVER_WATER_HALF_WIDTH = 2.025;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (a: number, b: number, value: number) => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + 41.73) * 43758.5453;
  return value - Math.floor(value);
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), sx);
  const bottom = THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx);
  return THREE.MathUtils.lerp(top, bottom, sy);
}

function distanceToSegment(point: Point2, start: WorldPoint, end: WorldPoint): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const t = clamp01(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function distanceToLines(point: Point2, lines: readonly Polyline[]): number {
  let nearest = Infinity;
  for (const line of lines)
    for (let index = 1; index < line.length; index++)
      nearest = Math.min(nearest, distanceToSegment(point, line[index - 1], line[index]));
  return nearest;
}

function distanceToCamps(point: Point2, camps: Replay["scene"]["camps"]): number {
  return (camps ?? []).reduce(
    (nearest, camp) => Math.min(nearest, Math.hypot(point.x - camp.position.x, point.y - camp.position.y)),
    Infinity,
  );
}

function distanceToNodes(point: Point2, replay: Replay): number {
  return (replay.scene.nodes ?? []).reduce(
    (nearest, node) => Math.min(nearest, Math.hypot(point.x - node.position.x, point.y - node.position.y)),
    Infinity,
  );
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

function interlanePolygon(first: Polyline, second: Polyline): Point2[] | null {
  if (first.length < 2 || second.length < 2) return null;
  const distance = (a: WorldPoint, b: WorldPoint) => Math.hypot(a.x - b.x, a.y - b.y);
  const firstStart = first[0], firstEnd = first[first.length - 1];
  const secondStart = second[0], secondEnd = second[second.length - 1];
  const forward = distance(firstStart, secondStart) + distance(firstEnd, secondEnd);
  const reverse = distance(firstStart, secondEnd) + distance(firstEnd, secondStart);
  const tolerance = 3.5;
  if (Math.min(forward, reverse) > tolerance * 2) return null;
  const returnPath = forward <= reverse ? [...second].reverse() : [...second];
  return [
    ...first.map(({ x, y }) => ({ x, y })),
    ...returnPath.slice(1, -1).map(({ x, y }) => ({ x, y })),
  ];
}

function orderedLanes(replay: Replay): readonly Replay["scene"]["lanes"][number][] {
  const lanes = replay.scene.lanes;
  const rank = (lane: typeof lanes[number]) => {
    const key = `${lane.id} ${lane.label}`.toLowerCase();
    return /top/.test(key) ? 0 : /mid/.test(key) ? 1 : /bot|bottom/.test(key) ? 2 : 3;
  };
  return [...lanes].sort((a, b) => rank(a) - rank(b));
}

function buildForestRegions(replay: Replay): ForestRegion[] {
  const lanes = orderedLanes(replay);
  if (lanes.length < 3) return [];
  const regions: ForestRegion[] = [];
  for (let index = 0; index < 2; index++) {
    const boundaries = [lanes[index].points, lanes[index + 1].points] as const;
    const polygon = interlanePolygon(boundaries[0], boundaries[1]);
    if (!polygon) continue;
    const xs = polygon.map(point => point.x), ys = polygon.map(point => point.y);
    regions.push({
      id: index === 0 ? "upper-jungle" : "lower-jungle",
      polygon,
      boundaries,
      bounds: {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minY: Math.min(...ys), maxY: Math.max(...ys),
      },
    });
  }
  return regions;
}

function forestAt(
  point: Point2,
  replay: Replay,
  regions: readonly ForestRegion[],
  jungleRoutes: readonly Polyline[],
  river: readonly Polyline[],
): number {
  const routeDistance = distanceToLines(point, jungleRoutes);
  const campDistance = distanceToCamps(point, replay.scene.camps);
  const riverDistance = distanceToLines(point, river);
  let mask = 0;
  for (const region of regions) {
    if (!pointInPolygon(point, region.polygon)) continue;
    const edgeClearance = distanceToLines(point, region.boundaries);
    const forest = smoothstep(2.8, 5.1, edgeClearance)
      * smoothstep(1.35, 3.0, routeDistance)
      * smoothstep(3.5, 5.0, campDistance)
      * smoothstep(4.0, 6.2, riverDistance);
    mask = Math.max(mask, forest);
  }
  return clamp01(mask);
}

function observationIslandDistance(point: Point2, replay: Replay): number {
  const observation = replay.scene.nodes?.find(node => /MID\.OBS|observation/i.test(node.id));
  return observation ? Math.hypot(point.x - observation.position.x, point.y - observation.position.y) : Infinity;
}

function riverbedHeight(distance: number, land: number): number {
  // A broad submerged channel slopes through a gravel shelf and into irregular
  // banks. The width matches BattlefieldLandmarks' 4.05-unit water ribbon.
  const shore = smoothstep(1.8, 3.75, distance);
  const channel = THREE.MathUtils.lerp(-1.48, 0.12, shore);
  const bankBlend = 1 - smoothstep(3.15, 5.15, distance);
  return THREE.MathUtils.lerp(land, channel, bankBlend);
}

function createTerrainData(replay: Replay): TerrainData {
  const regions = buildForestRegions(replay);
  const lanePaths = replay.scene.lanes.map(lane => lane.points);
  const routes = replay.scene.routes ?? [];
  const landRoutes = routes.filter(route => route.region !== "bridge").map(route => route.points);
  const riverCourse = scenicRiverCourse(replay);
  const river = riverCourse.length ? [riverCourse] : [];
  const jungleRoutes = routes.filter(route => route.region === "jungle").map(route => route.points);
  const camps = replay.scene.camps;

  const forest = (x: number, z: number) => forestAt({ x, y: z }, replay, regions, jungleRoutes, river);
  const at = (x: number, z: number): number => {
    const point = { x, y: z };
    const broad = noise(x * 0.072 + 4, z * 0.072 - 7);
    const mid = noise(x * 0.18 - 11, z * 0.18 + 5);
    const detail = noise(x * 0.42 + 8, z * 0.42 + 3);
    const ridge = 1 - Math.abs(noise(x * 0.094 - 19, z * 0.094 + 13) * 2 - 1);
    const woods = forest(x, z);
    const roadDistance = Math.min(distanceToLines(point, lanePaths), distanceToLines(point, landRoutes));
    const campDistance = distanceToCamps(point, camps);
    const nodeDistance = distanceToNodes(point, replay);

    const rolling = (broad - 0.5) * 0.9 + (mid - 0.5) * 0.34 + (detail - 0.5) * 0.12;
    const land = THREE.MathUtils.clamp(
      0.1 + rolling + woods * (0.85 + broad * 1.8 + ridge * 1.55 + mid * 0.5),
      -0.34,
      4.25,
    );
    const roadMix = 1 - smoothstep(2.35, 5.7, roadDistance);
    const campMix = 1 - smoothstep(3.1, 5.2, campDistance);
    const nodeMix = 1 - smoothstep(1.8, 4.3, nodeDistance);
    const cleared = THREE.MathUtils.lerp(land, ROAD_LEVEL, roadMix);
    const aroundCamp = THREE.MathUtils.lerp(cleared, CAMP_LEVEL, campMix);
    const plaza = THREE.MathUtils.lerp(aroundCamp, ROAD_LEVEL, nodeMix);

    const riverDistance = distanceToLines(point, river);
    const islandDistance = observationIslandDistance(point, replay);
    const islandMask = 1 - smoothstep(2.6, 4.4, islandDistance);
    const channel = river.length ? riverbedHeight(riverDistance, plaza) : plaza;
    return THREE.MathUtils.lerp(channel, plaza, islandMask);
  };
  return { at, forest, regions };
}

function terrainColor(
  point: Point2,
  elevation: number,
  slope: number,
  forest: number,
  paths: { lane: Polyline[]; jungle: Polyline[]; camps: Replay["scene"]["camps"]; river: Polyline[] },
): THREE.Color {
  const patch = noise(point.x * 0.25 + 17, point.y * 0.25 - 2);
  const meadow = new THREE.Color(0x778461).lerp(new THREE.Color(0x8b906a), patch * 0.58);
  meadow.lerp(new THREE.Color(0x49614a), forest * 0.86);
  meadow.lerp(new THREE.Color(0x3f5844), smoothstep(0.9, 2.4, elevation) * forest * 0.46);

  const laneDistance = distanceToLines(point, paths.lane);
  const jungleDistance = distanceToLines(point, paths.jungle);
  const campDistance = distanceToCamps(point, paths.camps);
  const riverDistance = distanceToLines(point, paths.river);
  meadow.lerp(new THREE.Color(0x8f805f), 1 - smoothstep(1.2, 3.9, laneDistance));
  meadow.lerp(new THREE.Color(0x746b51), (1 - smoothstep(0.7, 2.5, jungleDistance)) * 0.55);
  meadow.lerp(new THREE.Color(0xa09572), 1 - smoothstep(2.4, 4.2, campDistance));
  meadow.lerp(new THREE.Color(0x80765f), 1 - smoothstep(1.6, 2.8, riverDistance));
  meadow.lerp(new THREE.Color(0x646954), 1 - smoothstep(2.0, 3.35, riverDistance));
  meadow.lerp(new THREE.Color(0x858476), smoothstep(0.85, 1.8, slope) * 0.35);
  meadow.offsetHSL(0, (patch - 0.5) * 0.08, (patch - 0.5) * 0.1);
  return meadow;
}

function buildGround(scene: THREE.Scene, replay: Replay, data: TerrainData): void {
  const { min, max } = replay.scene.bounds;
  const extent = Math.max(max.x - min.x, max.y - min.y, 40);
  const margin = Math.max(5.5, Math.min(9, extent * 0.11));
  const minX = min.x - margin, maxX = max.x + margin;
  const minZ = min.y - margin, maxZ = max.y + margin;
  const step = 0.48;
  const segmentsX = Math.ceil((maxX - minX) / step), segmentsZ = Math.ceil((maxZ - minZ) / step);
  const paths = {
    lane: replay.scene.lanes.map(lane => lane.points),
    jungle: (replay.scene.routes ?? []).filter(route => route.region === "jungle").map(route => route.points),
    camps: replay.scene.camps,
    river: scenicRiverCourse(replay).length ? [scenicRiverCourse(replay)] : [],
  };
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const delta = 0.35;
  for (let iz = 0; iz <= segmentsZ; iz++) {
    const z = minZ + ((maxZ - minZ) * iz) / segmentsZ;
    for (let ix = 0; ix <= segmentsX; ix++) {
      const x = minX + ((maxX - minX) * ix) / segmentsX;
      const elevation = data.at(x, z);
      const slopeX = (data.at(x + delta, z) - data.at(x - delta, z)) / (2 * delta);
      const slopeZ = (data.at(x, z + delta) - data.at(x, z - delta)) / (2 * delta);
      const slope = Math.hypot(slopeX, slopeZ);
      const point = { x, y: z };
      positions.push(x, elevation, z);
      const color = terrainColor(point, elevation, slope, data.forest(x, z), paths);
      colors.push(color.r, color.g, color.b);
      if (ix < segmentsX && iz < segmentsZ) {
        const a = iz * (segmentsX + 1) + ix, b = a + segmentsX + 1;
        if ((ix + iz) % 2 === 0) indices.push(a, b, a + 1, b, b + 1, a + 1);
        else indices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  }));
  ground.name = "battlefield-sculpted-landform";
  ground.receiveShadow = true;
  scene.add(ground);
}

function ribbonGeometry(points: Polyline, width: number, yOffset: number, heightAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  if (points.length < 2) return new THREE.BufferGeometry();
  const half = width / 2;
  const pathSamples: WorldPoint[] = [points[0]];
  for (let segment = 1; segment < points.length; segment++) {
    const start = points[segment - 1], end = points[segment];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= 1e-6) continue;
    const steps = Math.max(1, Math.ceil(length / 0.75));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      pathSamples.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
    }
  }

  // A two-edge ribbon floats across raised shoulders: the triangles interpolate
  // the hilltop heights over the lane center and bury its paving. Sample the
  // actual heightfield in both axes so every layer follows the road cut.
  let acrossSegments = Math.max(2, Math.ceil(width / 0.4));
  if (acrossSegments % 2 !== 0) acrossSegments++;
  const rowSize = acrossSegments + 1;
  for (let index = 0; index < pathSamples.length; index++) {
    const previous = pathSamples[Math.max(index - 1, 0)], current = pathSamples[index], next = pathSamples[Math.min(index + 1, pathSamples.length - 1)];
    const dx0 = current.x - previous.x, dz0 = current.y - previous.y;
    const dx1 = next.x - current.x, dz1 = next.y - current.y;
    const len0 = Math.hypot(dx0, dz0) || 1, len1 = Math.hypot(dx1, dz1) || 1;
    const n0 = { x: -dz0 / len0, z: dx0 / len0 }, n1 = { x: -dz1 / len1, z: dx1 / len1 };
    let nx = n0.x + n1.x, nz = n0.z + n1.z;
    const nLength = Math.hypot(nx, nz) || 1;
    nx /= nLength; nz /= nLength;
    const denominator = Math.max(0.66, Math.abs(nx * n1.x + nz * n1.z));
    const miter = Math.min(half / denominator, half * 1.5);
    for (let across = 0; across <= acrossSegments; across++) {
      const offset = THREE.MathUtils.lerp(-miter, miter, across / acrossSegments);
      const x = current.x + nx * offset, z = current.y + nz * offset;
      positions.push(x, heightAt(x, z) + yOffset, z);
      if (index < pathSamples.length - 1 && across < acrossSegments) {
        const at = index * rowSize + across;
        const nextRow = at + rowSize;
        indices.push(at, nextRow, at + 1, nextRow, nextRow + 1, at + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function mergeRibbons(
  lines: readonly { points: Polyline; width: number; yOffset: number }[],
  heightAt: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  for (const line of lines) {
    const geometry = ribbonGeometry(line.points, line.width, line.yOffset, heightAt);
    const base = positions.length / 3;
    positions.push(...(geometry.getAttribute("position").array as Float32Array));
    for (const index of geometry.getIndex()?.array ?? []) indices.push(index + base);
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

function offsetPath(points: Polyline, offset: number): WorldPoint[] {
  return points.map((point, index) => {
    const previous = points[Math.max(index - 1, 0)], next = points[Math.min(index + 1, points.length - 1)];
    const dx = next.x - previous.x, dz = next.y - previous.y, length = Math.hypot(dx, dz) || 1;
    return { x: point.x - (dz / length) * offset, y: point.y + (dx / length) * offset };
  });
}

function splitAtWater(points: Polyline, replay: Replay, exclusion: number): WorldPoint[][] {
  const riverCourse = scenicRiverCourse(replay);
  const river = riverCourse.length ? [riverCourse] : [];
  if (river.length === 0) return [points.map(point => ({ ...point }))];
  const islands = (replay.scene.nodes ?? [])
    .filter(node => /MID\.OBS|observation/i.test(node.id))
    .map(node => node.position);
  const canWalk = (point: WorldPoint) => {
    const island = islands.some(center => Math.hypot(point.x - center.x, point.y - center.y) < 3.2);
    return island || distanceToLines({ x: point.x, y: point.y }, river) > exclusion;
  };
  const output: WorldPoint[][] = [];
  let current: WorldPoint[] = [];
  const append = (point: WorldPoint) => {
    const last = current[current.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.025) current.push(point);
  };
  const finish = () => { if (current.length > 1) output.push(current); current = []; };
  for (let segment = 1; segment < points.length; segment++) {
    const start = points[segment - 1], end = points[segment];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(length / 0.34));
    for (let index = segment === 1 ? 0 : 1; index <= steps; index++) {
      const t = index / steps;
      const point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
      if (canWalk(point)) append(point); else finish();
    }
  }
  finish();
  return output;
}

function addRoads(scene: THREE.Scene, replay: Replay, heightAt: TerrainData["at"]): void {
  const lanePaths = replay.scene.lanes.flatMap(lane => splitAtWater(lane.points, replay, RIVER_WATER_HALF_WIDTH + 0.42));
  const laneEdges = (replay.scene.routes ?? [])
    .filter(route => route.region === "lane" && !route.bridgeSite)
    .flatMap(route => splitAtWater(route.points, replay, RIVER_WATER_HALF_WIDTH + 0.42));
  const clearing = lanePaths.map(points => ({ points, width: 8.0, yOffset: 0.018 }));
  const shoulder = laneEdges.map(points => ({ points, width: 5.6, yOffset: 0.034 }));
  const roadway = lanePaths.map(points => ({ points, width: 4.3, yOffset: 0.047 }));
  const trackOffset = replay.scene.trackOffset ?? 0.8;
  const flankTracks = lanePaths.flatMap(points => [
    { points: offsetPath(points, trackOffset), width: 0.62, yOffset: TRACK_LEVEL + 0.012 }, // LEFT
    { points: offsetPath(points, -trackOffset), width: 0.62, yOffset: TRACK_LEVEL + 0.012 }, // RIGHT
  ]);
  const centerTracks = lanePaths.map(points => ({ points, width: 0.68, yOffset: TRACK_LEVEL + 0.026 }));
  const roadLayers = [
    { name: "lane-clearing-earth", lines: clearing, color: 0x73785d, roughness: 1 },
    { name: "lane-packed-earth-shoulders", lines: shoulder, color: 0x806f52, roughness: 0.98 },
    { name: "lane-compacted-roadbed", lines: roadway, color: 0x89795b, roughness: 0.94 },
  ];
  for (const layer of roadLayers) {
    const mesh = new THREE.Mesh(mergeRibbons(layer.lines, heightAt), new THREE.MeshStandardMaterial({
      color: layer.color,
      roughness: layer.roughness,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
    }));
    mesh.name = layer.name;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // These are physical road surfaces at the Replay's actual display offsets,
  // not screen-space guide lines. The CENTER supply bed uses a compacted stone
  // finish; LEFT/RIGHT remain rougher shoulder passages with narrow gaps so
  // the three routes remain legible at overview scale.
  const trackGroup = new THREE.Group();
  trackGroup.name = "lane-three-track-paving";
  const trackSurfaces = [
    { name: "lane-flank-passage-tracks", lines: flankTracks, color: 0x766b53, roughness: 1 },
    { name: "lane-center-supply-track", lines: centerTracks, color: 0xb0a17b, roughness: 0.84 },
  ];
  for (const surface of trackSurfaces) {
    const mesh = new THREE.Mesh(mergeRibbons(surface.lines, heightAt), new THREE.MeshStandardMaterial({
      color: surface.color,
      roughness: surface.roughness,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
    }));
    mesh.name = surface.name;
    mesh.receiveShadow = true;
    trackGroup.add(mesh);
  }
  scene.add(trackGroup);

  const routes = replay.scene.routes ?? [];
  const jungle = routes.filter(route => route.region === "jungle").map(route => route.points);
  const camps = routes.filter(route => route.region === "jungle_camp").map(route => route.points);
  const fords = routes.filter(route => route.region === "river_ford").flatMap(route => splitAtWater(route.points, replay, RIVER_WATER_HALF_WIDTH + 0.4));
  const routeLayers = [
    { name: "jungle-trail-shoulders", lines: jungle.map(points => ({ points, width: 2.25, yOffset: 0.025 })), color: 0x52654d },
    { name: "jungle-trails", lines: jungle.map(points => ({ points, width: 1.12, yOffset: 0.045 })), color: 0x8a7a5c },
    { name: "camp-clearing-trails", lines: camps.map(points => ({ points, width: 0.95, yOffset: 0.045 })), color: 0xa09471 },
    { name: "ford-bank-approaches", lines: fords.map(points => ({ points, width: 1.65, yOffset: 0.04 })), color: 0x7f795e },
  ];
  for (const layer of routeLayers) {
    if (!layer.lines.length) continue;
    const mesh = new THREE.Mesh(mergeRibbons(layer.lines, heightAt), new THREE.MeshStandardMaterial({
      color: layer.color,
      roughness: 0.98,
      flatShading: true,
      side: THREE.DoubleSide,
    }));
    mesh.name = layer.name;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function addInstances(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  items: readonly ScenicInstance[],
): void {
  if (!items.length) { geometry.dispose(); return; }
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true }),
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

function sampleForest(replay: Replay, data: TerrainData): { trees: Point2[]; rocks: ScenicInstance[]; grass: ScenicInstance[] } {
  const lanePaths = replay.scene.lanes.map(lane => lane.points);
  const routePaths = (replay.scene.routes ?? []).filter(route => route.region !== "bridge").map(route => route.points);
  const riverCourse = scenicRiverCourse(replay);
  const river = riverCourse.length ? [riverCourse] : [];
  const trees: Point2[] = [], rocks: ScenicInstance[] = [], grass: ScenicInstance[] = [];
  const taken: Point2[] = [];
  for (let regionIndex = 0; regionIndex < data.regions.length; regionIndex++) {
    const region = data.regions[regionIndex];
    let count = 0;
    const spacing = 1.32;
    for (let z0 = region.bounds.minY + 0.5; z0 < region.bounds.maxY; z0 += spacing) {
      for (let x0 = region.bounds.minX + 0.5; x0 < region.bounds.maxX; x0 += spacing) {
        const seed = 7000 + regionIndex * 100000 + Math.round(x0 * 17) + Math.round(z0 * 31);
        const x = x0 + (hash(seed, 1) - 0.5) * 0.8;
        const z = z0 + (hash(seed, 2) - 0.5) * 0.8;
        const point = { x, y: z };
        if (data.forest(x, z) < 0.24 || hash(seed, 3) < 0.035) continue;
        if (distanceToLines(point, lanePaths) < 5.1 || distanceToLines(point, routePaths) < 1.55) continue;
        if (distanceToLines(point, river) < 4.45 || distanceToCamps(point, replay.scene.camps) < 4.25) continue;
        if (taken.some(other => Math.hypot(other.x - x, other.y - z) < 1.08)) continue;
        taken.push(point);
        if (hash(seed, 4) < 0.1) {
          const y = data.at(x, z);
          const size = 0.92 + hash(seed, 5) * 0.78;
          rocks.push({
            position: [x, y + 0.4 * size, z],
            scale: [1.05 * size, 0.62 * size, 1.28 * size],
            rotation: [0, hash(seed, 6) * Math.PI, (hash(seed, 7) - 0.5) * 0.24],
            color: hash(seed, 8) > 0.5 ? 0x777d70 : 0x8b8775,
          });
        } else {
          trees.push(point);
        }
        count++;
        if (count >= 800) break;
      }
      if (count >= 800) break;
    }
  }

  // Low grass tufts gather along woodland edges and stream banks, while the
  // traversable ribbons and camp pads retain a clear silhouette.
  const { min, max } = replay.scene.bounds;
  let seed = 16000;
  for (let z = min.y - 3; z <= max.y + 3; z += 1.25) {
    for (let x = min.x - 3; x <= max.x + 3; x += 1.25) {
      const id = seed++, px = x + (hash(id, 11) - 0.5), pz = z + (hash(id, 12) - 0.5);
      const woods = data.forest(px, pz);
      const riverDistance = distanceToLines({ x: px, y: pz }, river);
      const roadDistance = Math.min(distanceToLines({ x: px, y: pz }, lanePaths), distanceToLines({ x: px, y: pz }, routePaths));
      if (hash(id, 13) > 0.2 || (woods < 0.12 && (riverDistance > 3.1 || riverDistance < 2.0))) continue;
      if (roadDistance < 2.0 || distanceToCamps({ x: px, y: pz }, replay.scene.camps) < 3.8) continue;
      if (riverDistance < 2.05) continue;
      const height = 0.3 + hash(id, 14) * 0.34;
      const y = data.at(px, pz);
      grass.push({
        position: [px, y + height / 2, pz],
        scale: [0.12 + hash(id, 15) * 0.13, height, 0.12 + hash(id, 16) * 0.13],
        rotation: [0, hash(id, 17) * Math.PI, 0],
        color: hash(id, 18) > 0.5 ? 0x78895a : 0x65794f,
      });
    }
  }
  return { trees, rocks, grass };
}

function addWoodlands(scene: THREE.Scene, replay: Replay, data: TerrainData): void {
  const sampled = sampleForest(replay, data);
  const trunks: ScenicInstance[] = [], canopyLower: ScenicInstance[] = [], canopyUpper: ScenicInstance[] = [], understory: ScenicInstance[] = [];
  for (let index = 0; index < sampled.trees.length; index++) {
    const root = sampled.trees[index];
    const seed = 23000 + index * 19;
    const ground = data.at(root.x, root.y);
    const size = 0.82 + hash(seed, 1) * 0.5;
    const leaf = hash(seed, 2);
    const canopy = leaf > 0.68 ? 0x527658 : leaf > 0.34 ? 0x45694f : 0x385941;
    trunks.push({
      position: [root.x, ground + 1.38 * size, root.y],
      scale: [0.88 * size, 2.76 * size, 0.88 * size],
      rotation: [0, hash(seed, 3) * Math.PI, (hash(seed, 4) - 0.5) * 0.05],
      color: hash(seed, 5) > 0.5 ? 0x796448 : 0x67563e,
    });
    canopyLower.push({
      position: [root.x, ground + 3.05 * size, root.y],
      scale: [1.68 * size, 1.52 * size, 1.62 * size],
      rotation: [0, hash(seed, 6) * Math.PI, 0],
      color: canopy,
    });
    canopyUpper.push({
      position: [root.x + (hash(seed, 7) - 0.5) * 0.7, ground + 4.25 * size, root.y + (hash(seed, 8) - 0.5) * 0.7],
      scale: [1.12 * size, 1.08 * size, 1.14 * size],
      rotation: [0, hash(seed, 9) * Math.PI, 0],
      color: leaf > 0.44 ? 0x6c895c : 0x5b7a55,
    });
    if (hash(seed, 10) > 0.65) {
      understory.push({
        position: [root.x + (hash(seed, 11) - 0.5) * 1.2, ground + 0.65 * size, root.y + (hash(seed, 12) - 0.5) * 1.2],
        scale: [1.42 * size, 0.78 * size, 1.35 * size],
        color: leaf > 0.5 ? 0x697c51 : 0x526e4c,
      });
    }
  }
  addInstances(scene, "battlefield-forest-trunks", new THREE.CylinderGeometry(0.26, 0.38, 1, 7), trunks);
  addInstances(scene, "battlefield-canopy-lower", new THREE.IcosahedronGeometry(1, 1), canopyLower);
  addInstances(scene, "battlefield-canopy-upper", new THREE.IcosahedronGeometry(1, 0), canopyUpper);
  addInstances(scene, "battlefield-forest-understory", new THREE.DodecahedronGeometry(1, 0), understory);
  addInstances(scene, "battlefield-jungle-rock-outcrops", new THREE.DodecahedronGeometry(1, 1), sampled.rocks);
  addInstances(scene, "battlefield-meadow-grass", new THREE.ConeGeometry(0.45, 1, 4), sampled.grass);
}

/**
 * Builds a sculpted terrain shell, traversable clearings and stylized jungle
 * volumes from the authorized map geometry in PresentationReplay.
 */
export function buildBattlefieldTerrain(scene: THREE.Scene, replay: Replay): void {
  const data = createTerrainData(replay);
  buildGround(scene, replay, data);
  addRoads(scene, replay, data.at);
  addWoodlands(scene, replay, data);
}
