import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PresentationReplay, Replay } from "@senkei/replay-contract";
import { buildBattlefieldTerrain } from "./battlefield-terrain";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";

/** A small, topology-shaped replay: three base-to-base corridors, two groves,
 * one fixed bridge, one ford, an observation island, and authored camp trails. */
function topologyReplay(): Replay {
  const replay = structuredClone(basic) as unknown as PresentationReplay;
  replay.schemaVersion = "0.3";
  replay.scene.bounds = { min: { x: 0, y: 0 }, max: { x: 64, y: 64 } };
  replay.scene.lanes = [
    { id: "TOP", label: "TOP", points: [
      { x: 3, y: 61 }, { x: 8.8, y: 48 }, { x: 8.8, y: 34 }, { x: 10.4, y: 20.8 },
      { x: 14, y: 17.2 }, { x: 17.2, y: 14 }, { x: 20.8, y: 10.4 }, { x: 34, y: 8.8 }, { x: 48, y: 8.8 }, { x: 61, y: 3 },
    ], elevation: 0.1 },
    { id: "MID", label: "MID", points: [
      { x: 3, y: 61 }, { x: 13.2, y: 50.8 }, { x: 20.4, y: 43.6 }, { x: 26, y: 38 },
      { x: 29.4, y: 34.6 }, { x: 32, y: 32 }, { x: 34.6, y: 29.4 }, { x: 38, y: 26 },
      { x: 43.6, y: 20.4 }, { x: 50.8, y: 13.2 }, { x: 61, y: 3 },
    ], elevation: 0.1 },
    { id: "BOT", label: "BOT", points: [
      { x: 3, y: 61 }, { x: 16, y: 55.2 }, { x: 30, y: 55.2 }, { x: 43.2, y: 53.6 },
      { x: 46.8, y: 50 }, { x: 50, y: 46.8 }, { x: 53.6, y: 43.2 }, { x: 55.2, y: 30 }, { x: 55.2, y: 16 }, { x: 61, y: 3 },
    ], elevation: 0.1 },
  ];
  replay.scene.camps = [
    { id: "camp-upper", position: { x: 14, y: 31.2 } },
    { id: "camp-lower", position: { x: 32.8, y: 50 } },
  ];
  replay.scene.nodes = [
    { id: "A.BASE", allegiance: "A", position: { x: 3.2, y: 60.8 } },
    { id: "N.MID.OBS", allegiance: "N", position: { x: 32, y: 32 } },
    { id: "B.BASE", allegiance: "B", position: { x: 60.8, y: 3.2 } },
  ];
  replay.scene.river = [
    { x: 15.6, y: 15.6 }, { x: 23, y: 23 }, { x: 32, y: 32 },
    { x: 41, y: 41 }, { x: 48.4, y: 48.4 },
  ];
  replay.scene.trackOffset = 0.8;
  replay.scene.routes = [
    { id: "lane.TOP.A", region: "lane", points: [{ x: 3, y: 61 }, { x: 10.4, y: 20.8 }] },
    { id: "lane.TOP.t1-t2", region: "lane", points: [{ x: 8.8, y: 48 }, { x: 8.8, y: 34 }] },
    { id: "lane.TOP.t2-j", region: "lane", points: [{ x: 8.8, y: 34 }, { x: 10.4, y: 20.8 }] },
    { id: "bridge.TOP", region: "bridge", points: [{ x: 14, y: 17.2 }, { x: 17.2, y: 14 }], bridgeSite: "TOP" },
    { id: "jungle.upper", region: "jungle", points: [{ x: 10.4, y: 20.8 }, { x: 18, y: 28 }] },
    { id: "jungle_camp.upper", region: "jungle_camp", points: [{ x: 18, y: 28 }, { x: 14, y: 31.2 }] },
    { id: "ford.upper", region: "river_ford", points: [{ x: 18, y: 28 }, { x: 28, y: 18 }], ford: true },
  ];
  return replay as unknown as Replay;
}

function vertexPositions(mesh: THREE.Mesh): THREE.Vector3[] {
  const attribute = mesh.geometry.getAttribute("position");
  return Array.from({ length: attribute.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(attribute, index));
}

function nearestTerrainVertex(mesh: THREE.Mesh, x: number, z: number): THREE.Vector3 {
  const attribute = mesh.geometry.getAttribute("position");
  let nearest = new THREE.Vector3(), distance = Infinity;
  for (let index = 0; index < attribute.count; index++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(attribute, index);
    const candidate = Math.hypot(vertex.x - x, vertex.z - z);
    if (candidate < distance) { nearest = vertex; distance = candidate; }
  }
  return nearest;
}

function rayHeight(scene: THREE.Scene, mesh: THREE.Object3D, x: number, z: number): number {
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0), 0, 30);
  const hit = ray.intersectObject(mesh, true)[0];
  if (!hit) throw new Error(`No terrain ribbon intersection at ${x},${z} on ${mesh.name}`);
  return hit.point.y;
}

function distanceToRiver(point: THREE.Vector3): number {
  const path = [15.6, 23, 32, 43, 48.4].map(value => ({ x: value, y: value }));
  let nearest = Infinity;
  for (let index = 1; index < path.length; index++) {
    const start = path[index - 1], end = path[index];
    const dx = end.x - start.x, dy = end.y - start.y;
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.y) * dy) / (dx * dx + dy * dy)));
    nearest = Math.min(nearest, Math.hypot(point.x - start.x - dx * t, point.z - start.y - dy * t));
  }
  return nearest;
}

describe("canonical Battlefield terrain presentation", () => {
  it("sculpts deep water, a raised bank shelf and continuous forest relief from Replay geography", () => {
    const scene = new THREE.Scene();
    buildBattlefieldTerrain(scene, topologyReplay());

    const landform = scene.getObjectByName("battlefield-sculpted-landform") as THREE.Mesh;
    expect(landform).toBeDefined();
    const channel = nearestTerrainVertex(landform, 23, 23);
    const bank = nearestTerrainVertex(landform, 28, 23);
    const upperJungle = nearestTerrainVertex(landform, 16, 36);
    const lowland = nearestTerrainVertex(landform, 7, 15);
    expect(channel.y).toBeLessThan(0.072);
    expect(bank.y).toBeGreaterThan(channel.y + 0.5);
    expect(upperJungle.y).toBeGreaterThan(lowland.y + 0.6);
    expect(landform.geometry.getAttribute("color").count).toBeGreaterThan(10_000);
    expect(landform.geometry.index).toBeNull();
    expect(landform.geometry.getAttribute("uv").count).toBe(landform.geometry.getAttribute("position").count);
    expect((landform.material as THREE.MeshStandardMaterial).map?.name).toBe("battlefield-meadow-microtexture");
  });

  it("finishes the terrain tile with a faceted, irregular-depth rock perimeter", () => {
    const scene = new THREE.Scene();
    buildBattlefieldTerrain(scene, topologyReplay());
    const cliffs = scene.getObjectByName("battlefield-faceted-perimeter-cliffs") as THREE.Mesh;
    expect(cliffs).toBeDefined();
    const positions = cliffs.geometry.getAttribute("position");
    const colors = cliffs.geometry.getAttribute("color");
    const ys = Array.from({ length: positions.count }, (_, index) => positions.getY(index));
    expect(Math.min(...ys)).toBeLessThan(-4);
    expect(Math.max(...ys)).toBeGreaterThan(0.5);
    expect(new Set(Array.from({ length: colors.count }, (_, index) =>
      `${colors.getX(index).toFixed(2)}:${colors.getY(index).toFixed(2)}:${colors.getZ(index).toFixed(2)}`,
    )).size).toBeGreaterThan(4);
    expect(positions.count).toBeGreaterThan(2_000);
  });

  it("builds three separated lane surfaces and keeps their dry paving off water", () => {
    const scene = new THREE.Scene();
    buildBattlefieldTerrain(scene, topologyReplay());
    const tracks = scene.getObjectByName("lane-three-track-paving") as THREE.Group;
    const clearing = scene.getObjectByName("lane-clearing-earth") as THREE.Mesh;
    expect(tracks).toBeDefined();
    expect(clearing).toBeDefined();
    const trackMeshes = tracks.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const trackVertices = trackMeshes.flatMap(vertexPositions);
    const centerTrack = scene.getObjectByName("lane-center-supply-track") as THREE.Mesh;
    const flankTracks = scene.getObjectByName("lane-flank-passage-tracks") as THREE.Mesh;
    const centerMaterial = centerTrack.material as THREE.MeshStandardMaterial;
    const flankMaterial = flankTracks.material as THREE.MeshStandardMaterial;
    expect(trackVertices.length).toBeGreaterThan(100);
    expect(centerMaterial.color.r).toBeGreaterThan(flankMaterial.color.r + 0.08);
    expect(trackVertices.every(point =>
      Math.hypot(point.x - 32, point.z - 32) < 3.5 || distanceToRiver(point) > 1.95,
    )).toBe(true);

    const trackBands = [...new Set(trackVertices.filter(point => Math.abs(point.x - 6) < 4).map(point => Math.round(point.z * 4) / 4))];
    expect(trackBands.length).toBeGreaterThan(4);

    const leftHeight = rayHeight(scene, tracks, 8.0, 40);
    const centerHeight = rayHeight(scene, tracks, 8.8, 40);
    const rightHeight = rayHeight(scene, tracks, 9.6, 40);
    expect(centerHeight).toBeGreaterThan(leftHeight + 0.01);
    expect(centerHeight).toBeGreaterThan(rightHeight + 0.01);
  });

  it("samples wide road ribbons across sloped shoulders so track paving stays above the road cut", () => {
    const scene = new THREE.Scene();
    buildBattlefieldTerrain(scene, topologyReplay());
    const ground = scene.getObjectByName("battlefield-sculpted-landform") as THREE.Mesh;
    const clearing = scene.getObjectByName("lane-clearing-earth") as THREE.Mesh;
    const roadbed = scene.getObjectByName("lane-compacted-roadbed") as THREE.Mesh;
    const tracks = scene.getObjectByName("lane-three-track-paving") as THREE.Group;

    const x = 8.8, z = 40;
    const groundAtLane = rayHeight(scene, ground, x, z);
    const clearingAtLane = rayHeight(scene, clearing, x, z);
    const clearingAtShoulder = rayHeight(scene, clearing, x + 4, z);
    const roadbedAtLane = rayHeight(scene, roadbed, x, z);
    const trackAtLane = rayHeight(scene, tracks, x, z);

    expect(clearingAtShoulder).toBeGreaterThan(clearingAtLane + 0.1);
    expect(clearingAtLane).toBeGreaterThan(groundAtLane);
    expect(roadbedAtLane).toBeGreaterThan(clearingAtLane);
    expect(trackAtLane).toBeGreaterThan(roadbedAtLane);
  });

  it("leaves authored ford gaps, reaches camp clearings, and anchors layered forest volumes to the hills", () => {
    const scene = new THREE.Scene();
    buildBattlefieldTerrain(scene, topologyReplay());
    const ford = scene.getObjectByName("ford-bank-approaches") as THREE.Mesh;
    const campTrail = scene.getObjectByName("camp-clearing-trails") as THREE.Mesh;
    const trunks = scene.getObjectByName("battlefield-forest-trunks") as THREE.InstancedMesh;
    const canopy = scene.getObjectByName("battlefield-canopy-lower") as THREE.InstancedMesh;
    const upperCanopy = scene.getObjectByName("battlefield-canopy-upper") as THREE.InstancedMesh;
    expect(ford).toBeDefined();
    expect(campTrail).toBeDefined();
    expect(trunks.count).toBeGreaterThan(140);
    expect(canopy.count).toBe(trunks.count);
    expect(upperCanopy.count).toBe(trunks.count);

    const fordVertices = vertexPositions(ford);
    expect(fordVertices.every(point => distanceToRiver(point) > 2.0)).toBe(true);
    const campVertices = vertexPositions(campTrail);
    expect(campVertices.some(point => Math.hypot(point.x - 14, point.z - 31.2) < 1.2)).toBe(true);

    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    trunks.updateWorldMatrix(true, false);
    for (let index = 0; index < trunks.count; index++) {
      trunks.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      trunks.localToWorld(position);
      expect(distanceToRiver(position)).toBeGreaterThan(4.3);
    }

    const woodland = scene.getObjectByName("battlefield-woodland-lod") as THREE.LOD;
    expect(woodland).toBeDefined();
    expect(woodland.levels.map(level => level.distance)).toEqual([0, 92]);
    expect(woodland.getObjectByName("battlefield-canopy-distant")).toBeDefined();
  });

  it("applies repeated UV texture materials to road and track meshes", () => {
    const scene = new THREE.Scene();
    buildBattlefieldTerrain(scene, topologyReplay());

    for (const name of [
      "lane-clearing-earth",
      "lane-compacted-roadbed",
      "lane-center-supply-track",
      "jungle-trails",
    ]) {
      const mesh = scene.getObjectByName(name) as THREE.Mesh;
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.map).toBeDefined();
      expect(material.map?.wrapS).toBe(THREE.RepeatWrapping);
      expect(material.map?.wrapT).toBe(THREE.RepeatWrapping);
      expect(material.map?.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(mesh.geometry.getAttribute("uv").count).toBe(mesh.geometry.getAttribute("position").count);
    }

    const gravel = scene.getObjectByName("battlefield-riverbank-gravel") as THREE.Mesh;
    const material = gravel.material as THREE.MeshStandardMaterial;
    expect(material.map?.name).toBe("battlefield-river-gravel-microtexture");
    expect(gravel.geometry.getAttribute("uv").count).toBe(gravel.geometry.getAttribute("position").count);

    const rocks = scene.getObjectByName("battlefield-jungle-rock-outcrops") as THREE.InstancedMesh;
    expect((rocks.material as THREE.MeshStandardMaterial).map?.name).toBe("battlefield-rock-microtexture");
  });
});
