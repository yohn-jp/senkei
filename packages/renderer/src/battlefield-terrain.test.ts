import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PresentationReplay, Replay } from "@senkei/replay-contract";
import { buildBattlefieldTerrain } from "./battlefield-terrain";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";

function riverReplay(): Replay {
  const replay = structuredClone(basic) as unknown as PresentationReplay;
  replay.schemaVersion = "0.3";
  replay.scene.bounds = { min: { x: -10, y: -10 }, max: { x: 30, y: 30 } };
  replay.scene.lanes = [
    { id: "top", label: "TOP", points: [{ x: 0, y: 0 }, { x: 30, y: 0 }], elevation: 0.1 },
    { id: "mid", label: "MID", points: [{ x: 0, y: 10 }, { x: 30, y: 10 }], elevation: 0.1 },
    { id: "bot", label: "BOT", points: [{ x: 0, y: 20 }, { x: 30, y: 20 }], elevation: 0.1 },
  ];
  replay.scene.camps = [{ id: "test-camp", position: { x: 4, y: 10 } }];
  replay.scene.river = [{ x: 10, y: -5 }, { x: 10, y: 25 }];
  replay.scene.routes = [
    { id: "lane.TOP.bank", region: "lane", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    { id: "bridge.TOP", region: "bridge", points: [{ x: 10, y: 0 }, { x: 10, y: 10 }], bridgeSite: "TOP" },
    { id: "jungle.upper", region: "jungle", points: [{ x: 0, y: 8 }, { x: 9, y: 8 }] },
    { id: "jungle_camp.upper", region: "jungle_camp", points: [{ x: 2, y: 8 }, { x: 4, y: 10 }] },
    { id: "ford.jungle.upper", region: "river_ford", points: [{ x: 0, y: 15 }, { x: 20, y: 15 }], ford: true },
  ];
  return replay as unknown as Replay;
}

function positions(mesh: THREE.Mesh): THREE.Vector3[] {
  const attribute = mesh.geometry.getAttribute("position");
  return Array.from({ length: attribute.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(attribute, index));
}

function nearestTerrainPoint(mesh: THREE.Mesh, x: number, z: number): THREE.Vector3 {
  const attribute = mesh.geometry.getAttribute("position");
  let nearest = new THREE.Vector3(), distance = Infinity;
  for (let index = 0; index < attribute.count; index++) {
    const point = new THREE.Vector3().fromBufferAttribute(attribute, index);
    const candidate = Math.hypot(point.x - x, point.z - z);
    if (candidate < distance) { nearest = point; distance = candidate; }
  }
  return nearest;
}

describe("canonical Battlefield river presentation", () => {
  it("cuts the terrain below water and keeps crossing roads off bridge and ford spans", () => {
    const scene = new THREE.Scene();
    buildBattlefieldTerrain(scene, riverReplay());

    const ground = scene.getObjectByName("continuous-battlefield-ground") as THREE.Mesh;
    const laneTracks = scene.getObjectByName("lane-earth-tracks") as THREE.Mesh;
    const campTrails = scene.getObjectByName("jungle-camp-trails") as THREE.Mesh;
    const fordTrails = scene.getObjectByName("river-ford-bank-trails") as THREE.Mesh;
    expect(ground).toBeDefined();
    expect(laneTracks).toBeDefined();
    expect(campTrails).toBeDefined();
    expect(fordTrails).toBeDefined();

    const waterPoint = nearestTerrainPoint(ground, 10, 15);
    const landPoint = nearestTerrainPoint(ground, 20, 15);
    expect(waterPoint.y).toBeLessThan(0.072);
    expect(waterPoint.y).toBeLessThan(landPoint.y - 0.1);

    const laneVertices = positions(laneTracks);
    expect(laneVertices.some(point => Math.abs(point.x - 10) < 0.05 && point.z > 2)).toBe(false);
    const fordVertices = positions(fordTrails);
    expect(fordVertices.some(point => point.x > 8 && point.x < 12)).toBe(false);

    const groveTrunks = scene.getObjectByName("jungle-grove-trunks") as THREE.InstancedMesh | undefined;
    if (groveTrunks) {
      const matrix = new THREE.Matrix4(), center = new THREE.Vector3();
      for (let index = 0; index < groveTrunks.count; index++) {
        groveTrunks.getMatrixAt(index, matrix);
        center.setFromMatrixPosition(matrix);
        expect(Math.abs(center.x - 10)).toBeGreaterThanOrEqual(3.6);
      }
    }
  });
});
