import * as THREE from "three";
import { polylinePointAtFraction } from "./battlefield-polyline.js";
import type { Replay, WorldPoint } from "@senkei/replay-contract";
import { scenicRiverCourse } from "./battlefield-geography";

export const BATTLEFIELD_RIVER_SURFACE_WIDTH = 4.05;
const RIVER_HALF_WIDTH = BATTLEFIELD_RIVER_SURFACE_WIDTH / 2;
const WATER_SURFACE_Y = 0.072;

type FlowSample = { point: WorldPoint; tx: number; ty: number; station: number };
type PlanarMark = {
  x: number;
  z: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  color: number;
};
type FordCrossing = { id: string; position: WorldPoint; tangent: WorldPoint };
type Stone = { x: number; z: number; y: number; rotation: number; sx: number; sy: number; sz: number; color: number };

const distance = (a: WorldPoint, b: WorldPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: WorldPoint, b: WorldPoint) => a.x * b.y - a.y * b.x;

function stableNoise(index: number, seed: number): number {
  const value = Math.sin(index * 127.1 + seed * 311.7 + 41.73) * 43758.5453;
  return value - Math.floor(value);
}

function sampleCourse(points: readonly WorldPoint[], spacing: number, phase: number): FlowSample[] {
  if (points.length < 2) return [];
  const stations = [0];
  for (let index = 1; index < points.length; index++) {
    stations.push(stations[index - 1] + distance(points[index - 1], points[index]));
  }
  const samples: FlowSample[] = [];
  const total = stations[stations.length - 1];
  let segment = 1;
  for (let station = phase; station < total; station += spacing) {
    while (segment < stations.length - 1 && stations[segment] < station) segment++;
    const start = points[segment - 1], end = points[segment];
    const segmentLength = stations[segment] - stations[segment - 1];
    if (segmentLength < 1e-6) continue;
    const t = THREE.MathUtils.clamp((station - stations[segment - 1]) / segmentLength, 0, 1);
    const tx = (end.x - start.x) / segmentLength;
    const ty = (end.y - start.y) / segmentLength;
    samples.push({ point: { x: THREE.MathUtils.lerp(start.x, end.x, t), y: THREE.MathUtils.lerp(start.y, end.y, t) }, tx, ty, station });
  }
  return samples;
}

function segmentIntersection(a: WorldPoint, b: WorldPoint, c: WorldPoint, d: WorldPoint): WorldPoint | undefined {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-9) return undefined;
  const delta = { x: c.x - a.x, y: c.y - a.y };
  const t = cross(delta, s) / denominator;
  const u = cross(delta, r) / denominator;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return undefined;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

function fordCrossings(replay: Replay, river: readonly WorldPoint[]): FordCrossing[] {
  const crossings: FordCrossing[] = [];
  for (const route of replay.scene.routes ?? []) {
    if (route.region !== "river_ford" && !route.ford) continue;
    for (let routeIndex = 1; routeIndex < route.points.length; routeIndex++) {
      const start = route.points[routeIndex - 1], end = route.points[routeIndex];
      for (let riverIndex = 1; riverIndex < river.length; riverIndex++) {
        const riverStart = river[riverIndex - 1], riverEnd = river[riverIndex];
        const position = segmentIntersection(start, end, riverStart, riverEnd);
        if (!position) continue;
        const tangentLength = distance(riverStart, riverEnd) || 1;
        const tangent = { x: (riverEnd.x - riverStart.x) / tangentLength, y: (riverEnd.y - riverStart.y) / tangentLength };
        if (!crossings.some((entry) => distance(entry.position, position) < 0.04)) {
          crossings.push({ id: route.id, position, tangent });
        }
      }
    }
  }
  return crossings;
}

function bridgeCrossingCenters(replay: Replay): WorldPoint[] {
  return (replay.scene.routes ?? []).filter((route) => route.bridgeSite && route.bridgeKind === "lane")
    .map((route) => polylinePointAtFraction(route.points, 0.5))
    .filter((point): point is WorldPoint => point !== undefined);
}

function isNear(point: WorldPoint, centers: readonly WorldPoint[], radius: number): boolean {
  return centers.some((center) => distance(point, center) < radius);
}

function planeInstances(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  marks: readonly PlanarMark[],
): void {
  if (!marks.length) {
    geometry.dispose();
    material.dispose();
    return;
  }
  const instances = new THREE.InstancedMesh(geometry, material, marks.length);
  instances.name = name;
  instances.castShadow = false;
  instances.receiveShadow = false;
  instances.frustumCulled = false;
  const planeUpright = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const headingAxis = new THREE.Vector3(0, 1, 0);
  const object = new THREE.Object3D();
  for (const [index, mark] of marks.entries()) {
    object.position.set(mark.x, mark.y, mark.z);
    object.quaternion.setFromAxisAngle(headingAxis, -mark.angle).multiply(planeUpright);
    object.scale.set(mark.length, mark.width, 1);
    object.updateMatrix();
    instances.setMatrixAt(index, object.matrix);
    instances.setColorAt(index, new THREE.Color(mark.color));
  }
  instances.instanceMatrix.needsUpdate = true;
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  parent.add(instances);
}

function stoneInstances(parent: THREE.Object3D, stones: readonly Stone[]): void {
  if (!stones.length) return;
  const geometry = new THREE.DodecahedronGeometry(0.28, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0,
    flatShading: true,
  });
  const instances = new THREE.InstancedMesh(geometry, material, stones.length);
  instances.name = "ford-shallow-stones";
  instances.castShadow = true;
  instances.receiveShadow = true;
  instances.frustumCulled = false;
  const object = new THREE.Object3D();
  for (const [index, stone] of stones.entries()) {
    object.position.set(stone.x, stone.y, stone.z);
    object.rotation.set(stableNoise(index, 43) * 0.11, stone.rotation, stableNoise(index, 47) * 0.13);
    object.scale.set(stone.sx, stone.sy, stone.sz);
    object.updateMatrix();
    instances.setMatrixAt(index, object.matrix);
    instances.setColorAt(index, new THREE.Color(stone.color));
  }
  instances.instanceMatrix.needsUpdate = true;
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  parent.add(instances);
}

function shallowMarks(
  river: readonly WorldPoint[],
  island: WorldPoint | undefined,
  fords: readonly FordCrossing[],
  bridges: readonly WorldPoint[],
): PlanarMark[] {
  const marks: PlanarMark[] = [];
  for (const [index, sample] of sampleCourse(river, 1.8, 0.34).entries()) {
    for (const side of [-1, 1]) {
      if (stableNoise(index, side * 17 + 1) > 0.78) continue;
      const along = (stableNoise(index, side * 13 + 5) - 0.5) * 0.58;
      const lateral = side * (1.56 + stableNoise(index, side * 19 + 8) * 0.31);
      const point = {
        x: sample.point.x - sample.ty * lateral + sample.tx * along,
        y: sample.point.y + sample.tx * lateral + sample.ty * along,
      };
      if (island && distance(point, island) < 3.35) continue;
      if (isNear(point, fords.map((ford) => ford.position), 2.5) || isNear(point, bridges, 1.15)) continue;
      const shade = stableNoise(index, side * 23 + 11);
      marks.push({
        x: point.x,
        z: point.y,
        y: WATER_SURFACE_Y + 0.006,
        angle: Math.atan2(sample.ty, sample.tx),
        length: 0.72 + shade * 0.72,
        width: 0.32 + shade * 0.22,
        color: shade > 0.52 ? 0x88a99b : 0x73998c,
      });
    }
  }
  return marks;
}

function flowMarks(
  river: readonly WorldPoint[],
  island: WorldPoint | undefined,
  fords: readonly FordCrossing[],
  bridges: readonly WorldPoint[],
): PlanarMark[] {
  const marks: PlanarMark[] = [];
  for (const [index, sample] of sampleCourse(river, 0.92, 0.2).entries()) {
    if (stableNoise(index, 29) > 0.61) continue;
    const lateral = (stableNoise(index, 31) - 0.5) * RIVER_HALF_WIDTH * 1.26;
    const along = (stableNoise(index, 37) - 0.5) * 0.42;
    const point = {
      x: sample.point.x - sample.ty * lateral + sample.tx * along,
      y: sample.point.y + sample.tx * lateral + sample.ty * along,
    };
    if (island && distance(point, island) < 3.15) continue;
    if (isNear(point, fords.map((ford) => ford.position), 2.35) || isNear(point, bridges, 0.82)) continue;
    const glint = stableNoise(index, 41);
    marks.push({
      x: point.x,
      z: point.y,
      y: WATER_SURFACE_Y + 0.015,
      angle: Math.atan2(sample.ty, sample.tx),
      length: 0.22 + glint * 0.55,
      width: 0.028 + glint * 0.038,
      color: glint > 0.8 ? 0xd5d7c4 : glint > 0.48 ? 0xb5c7b8 : 0x98b6a9,
    });
  }
  return marks;
}

function foamMarks(
  river: readonly WorldPoint[],
  island: WorldPoint | undefined,
  fords: readonly FordCrossing[],
  bridges: readonly WorldPoint[],
): PlanarMark[] {
  const marks: PlanarMark[] = [];
  for (const [index, sample] of sampleCourse(river, 2.25, 1.05).entries()) {
    if (stableNoise(index, 53) > 0.31) continue;
    const side = stableNoise(index, 59) > 0.5 ? 1 : -1;
    const lateral = side * (1.82 + stableNoise(index, 61) * 0.12);
    const point = {
      x: sample.point.x - sample.ty * lateral,
      y: sample.point.y + sample.tx * lateral,
    };
    if (island && distance(point, island) < 3.6) continue;
    if (isNear(point, fords.map((ford) => ford.position), 3.0) || isNear(point, bridges, 1.2)) continue;
    const size = stableNoise(index, 67);
    marks.push({
      x: point.x,
      z: point.y,
      y: WATER_SURFACE_Y + 0.024,
      angle: Math.atan2(sample.ty, sample.tx),
      length: 0.18 + size * 0.24,
      width: 0.025 + size * 0.025,
      color: size > 0.6 ? 0xd0cfb9 : 0xbfcbb7,
    });
  }
  return marks;
}

function fordStones(crossings: readonly FordCrossing[]): Stone[] {
  const stones: Stone[] = [];
  for (const [site, crossing] of crossings.entries()) {
    const normal = { x: -crossing.tangent.y, y: crossing.tangent.x };
    for (let index = 0; index < 17; index++) {
      const across = (stableNoise(index, site * 71 + 73) - 0.5) * 3.38;
      const downstream = (stableNoise(index, site * 79 + 83) - 0.5) * 1.18;
      const size = 0.68 + stableNoise(index, site * 89 + 97) * 0.7;
      const stoneColor = stableNoise(index, site * 101 + 103);
      stones.push({
        x: crossing.position.x + normal.x * across + crossing.tangent.x * downstream,
        z: crossing.position.y + normal.y * across + crossing.tangent.y * downstream,
        y: WATER_SURFACE_Y - 0.06,
        rotation: stableNoise(index, site * 107 + 109) * Math.PI * 2,
        sx: size,
        sy: 0.46 + stableNoise(index, site * 113 + 127) * 0.17,
        sz: 0.68 + stableNoise(index, site * 131 + 137) * 0.58,
        color: stoneColor > 0.66 ? 0x96927a : stoneColor > 0.32 ? 0x777b6d : 0x646f67,
      });
    }
  }
  return stones;
}

/** Subtle surface detail derived from Replay's authored river and ford routes. */
export function buildBattlefieldWaterDetails(parent: THREE.Object3D, replay: Replay): THREE.Group {
  const group = new THREE.Group();
  group.name = "battlefield-water-details";
  parent.add(group);
  const river = scenicRiverCourse(replay);
  if (river.length < 2) return group;

  const observation = replay.scene.nodes?.find((node) => node.id === "N.MID.OBS")?.position;
  const fords = fordCrossings(replay, river);
  const bridges = bridgeCrossingCenters(replay);
  const shallowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  planeInstances(group, "river-shallow-water-shelves", new THREE.CircleGeometry(1, 7), shallowMaterial, shallowMarks(river, observation, fords, bridges));

  const rippleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.52,
    metalness: 0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  planeInstances(group, "river-flow-ripples", new THREE.PlaneGeometry(1, 1), rippleMaterial, flowMarks(river, observation, fords, bridges));

  const foamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.19,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  planeInstances(group, "riverbank-foam-flecks", new THREE.PlaneGeometry(1, 1), foamMaterial, foamMarks(river, observation, fords, bridges));

  stoneInstances(group, fordStones(fords));
  group.userData.fordSites = fords.map((crossing) => crossing.id);
  return group;
}
