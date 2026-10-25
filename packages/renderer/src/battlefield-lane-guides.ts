import * as THREE from "three";
import type { Replay } from "@senkei/replay-contract";

/** Builds a light tactical guide from the same authored lane coordinates as the battlefield. */
export function buildBattlefieldLaneGuides(parent: THREE.Object3D, replay: Replay): THREE.Group {
  const group = new THREE.Group();
  group.name = "battlefield-information-lanes";
  group.userData.informationLayer = "lanes";
  const material = new THREE.LineDashedMaterial({
    color: 0xe2cf9b,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    dashSize: 0.8,
    gapSize: 0.5,
  });
  replay.scene.lanes.forEach((lane) => {
    if (lane.points.length < 2) return;
    const points = lane.points.map(({ x, y }) => new THREE.Vector3(x, lane.elevation + 0.21, y));
    const guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
    guide.name = `lane-guide-${lane.id}`;
    guide.computeLineDistances();
    guide.renderOrder = 4;
    group.add(guide);
  });
  parent.add(group);
  return group;
}
