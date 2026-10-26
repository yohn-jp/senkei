import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { decodeReplay, type PresentationReplay } from "@senkei/replay-contract";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";
import { buildBattlefieldWaterDetails } from "./battlefield-water-details";

function replayWithRiverFeatures() {
  const source = structuredClone(basic) as unknown as PresentationReplay;
  source.schemaVersion = "0.3";
  source.scene.bounds = { min: { x: -15, y: -15 }, max: { x: 15, y: 15 } };
  source.scene.nodes = [
    { id: "N.MID.OBS", allegiance: "N", position: { x: 8, y: 8 } },
    { id: "N.A.UJ", allegiance: "N", position: { x: -10, y: 0 } },
    { id: "N.B.UJ", allegiance: "N", position: { x: 10, y: 0 } },
  ];
  source.scene.routes = [
    { id: "ford.upper", region: "river_ford", points: [{ x: -10, y: 0 }, { x: 10, y: 0 }], ford: true },
  ];
  source.scene.river = [{ x: -12, y: -12 }, { x: 0, y: 0 }, { x: 12, y: 12 }];
  return decodeReplay(source);
}

function instancePositions(instances: THREE.InstancedMesh): THREE.Vector3[] {
  const output: THREE.Vector3[] = [];
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < instances.count; index++) {
    instances.getMatrixAt(index, matrix);
    output.push(new THREE.Vector3().setFromMatrixPosition(matrix));
  }
  return output;
}

describe("Battlefield water details", () => {
  it("derives flow and shallow shoreline marks from the authored river course", () => {
    const scene = new THREE.Scene();
    const details = buildBattlefieldWaterDetails(scene, replayWithRiverFeatures());
    const shallows = details.getObjectByName("river-shallow-water-shelves") as THREE.InstancedMesh;
    const ripples = details.getObjectByName("river-flow-ripples") as THREE.InstancedMesh;
    const foam = details.getObjectByName("riverbank-foam-flecks") as THREE.InstancedMesh;
    expect(shallows.count).toBeGreaterThan(0);
    expect(ripples.count).toBeGreaterThan(0);
    expect(foam.count).toBeGreaterThan(0);
    expect(instancePositions(foam).every((point) => Math.hypot(point.x - 8, point.z - 8) >= 3.6)).toBe(true);
    expect(details.userData.fordSites).toEqual(["ford.upper"]);
  });

  it("marks a ford with scattered low stones without adding a deck or rails", () => {
    const scene = new THREE.Scene();
    const details = buildBattlefieldWaterDetails(scene, replayWithRiverFeatures());
    const stones = details.getObjectByName("ford-shallow-stones") as THREE.InstancedMesh;
    expect(stones.count).toBe(17);
    expect(details.getObjectByName("fixed-bridge-ford.upper")).toBeUndefined();
    expect(details.children.some((child) => /deck|rail/i.test(child.name))).toBe(false);
    expect(instancePositions(stones).every((point) => Math.hypot(point.x, point.z) < 2.1)).toBe(true);
    expect(stones.geometry).toBeInstanceOf(THREE.DodecahedronGeometry);
    expect((stones.geometry as THREE.DodecahedronGeometry).parameters.detail).toBe(0);
    const material = stones.material as THREE.MeshStandardMaterial;
    expect(material.flatShading).toBe(true);
    expect(material.roughness).toBeGreaterThanOrEqual(0.9);
    expect(material.metalness).toBe(0);
    expect(material.transparent).toBe(false);
    expect(stones.castShadow).toBe(true);
  });

  it("rebuilds water decoration deterministically without changing Replay data", () => {
    const replay = replayWithRiverFeatures();
    const before = JSON.stringify(replay);
    const first = buildBattlefieldWaterDetails(new THREE.Scene(), replay);
    const second = buildBattlefieldWaterDetails(new THREE.Scene(), replay);
    for (const child of first.children as THREE.InstancedMesh[]) {
      const rebuilt = second.getObjectByName(child.name) as THREE.InstancedMesh;
      expect(rebuilt.instanceMatrix.array).toEqual(child.instanceMatrix.array);
      expect(rebuilt.instanceColor?.array).toEqual(child.instanceColor?.array);
      if (child.name !== "ford-shallow-stones") {
        const material = child.material as THREE.Material;
        expect(material.transparent).toBe(true);
        expect(material.depthWrite).toBe(false);
      }
    }
    expect(JSON.stringify(replay)).toBe(before);
  });
});
