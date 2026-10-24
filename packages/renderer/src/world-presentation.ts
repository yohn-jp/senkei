import * as THREE from "three";
import type { Replay, WorldPoint } from "@senkei/replay-contract";
import { buildBattlefieldTerrain } from "./battlefield-terrain";

/** Real-match world presentation. All traversable topology comes from Replay. */
export function buildWorldPresentation(scene: THREE.Scene, replay: Replay): void {
  buildBattlefieldTerrain(scene, replay);
}

function distanceToSegment(point: WorldPoint, start: WorldPoint, end: WorldPoint): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const t = THREE.MathUtils.clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1),
    0,
    1,
  );
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function distanceToAuthoredPaths(point: WorldPoint, replay: Replay): number {
  const authored = [
    ...replay.scene.lanes.map((lane) => lane.points),
    ...(replay.scene.routes ?? []).map((route) => route.points),
  ];
  let nearest = Infinity;
  for (const path of authored)
    for (let index = 1; index < path.length; index++)
      nearest = Math.min(nearest, distanceToSegment(point, path[index - 1], path[index]));
  return nearest;
}

export function buildWorldCamp(
  parent: THREE.Group,
  position: WorldPoint,
  campId: string,
  replay: Replay,
): void {
  const scale = replay.scene.routes?.length ? 1.22 : 1;
  const campHue = campId.includes("center")
    ? 0x807e62
    : campId.includes("se")
      ? 0x92735e
      : 0x96885f;
  const clearing = new THREE.MeshStandardMaterial({
    color: campHue,
    roughness: 1,
    flatShading: true,
  });
  const camp = new THREE.Group();
  camp.position.set(position.x, 0, position.y);
  camp.name = `jungle-camp-${campId}`;

  // A broken glade floor blends into the terrain. The boundary is deliberately
  // asymmetric and carries no stand-in path, ring, capture or occupancy state.
  const phase = [...campId].reduce((sum, character) => sum + character.charCodeAt(0), 0) * 0.017;
  const gladeShape = new THREE.Shape();
  const gladeSegments = 15;
  for (let i = 0; i < gladeSegments; i++) {
    const angle = (i / gladeSegments) * Math.PI * 2;
    const radius = 3.0 * scale * (
      0.88 + Math.sin(angle * 3 + phase) * 0.075 + Math.sin(angle * 5 - phase * 0.6) * 0.045
    );
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (i === 0) gladeShape.moveTo(x, y);
    else gladeShape.lineTo(x, y);
  }
  gladeShape.closePath();
  const clearingMesh = new THREE.Mesh(new THREE.ShapeGeometry(gladeShape), clearing);
  clearingMesh.rotation.x = -Math.PI / 2;
  clearingMesh.position.y = -0.024;
  clearingMesh.receiveShadow = true;
  camp.add(clearingMesh);

  // Candidate landmark sites sit outside the central monster area. Search
  // against the actual paths so the static ruin never covers an authored edge.
  const landmarkSites: { x: number; z: number; score: number; angle: number }[] = [];
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2 + phase;
    const radius = 2.1 + ((i * 7) % 5) * 0.13;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    if (distanceToAuthoredPaths({ x: position.x + x, y: position.y + z }, replay) < 1.9) continue;
    landmarkSites.push({ x, z, score: radius + Math.sin(angle * 2.4 + phase) * 0.25, angle });
  }
  landmarkSites.sort((a, b) => b.score - a.score);
  const chosen: typeof landmarkSites = [];
  for (const site of landmarkSites) {
    if (chosen.length >= 3) break;
    if (chosen.some((other) => Math.hypot(site.x - other.x, site.z - other.z) < 1.5)) continue;
    chosen.push(site);
  }
  const landmarkMaterial = new THREE.MeshStandardMaterial({
    color: 0x757969,
    roughness: 0.92,
    flatShading: true,
  });
  chosen.forEach((site, index) => {
    const height = index === 0 ? 1.18 : 0.56 + (index % 2) * 0.18;
    const landmark = new THREE.Mesh(new THREE.DodecahedronGeometry(index === 0 ? 0.54 : 0.37, 0), landmarkMaterial);
    landmark.position.set(site.x, height * 0.5, site.z);
    landmark.scale.set(0.78, height, 0.66);
    landmark.rotation.set(0.05, site.angle + 0.21, 0.07);
    landmark.castShadow = true;
    landmark.receiveShadow = true;
    camp.add(landmark);
  });

  parent.add(camp);
}
