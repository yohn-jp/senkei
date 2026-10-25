import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DisplayEntity } from "@senkei/replay-contract";
import {
  buildBattlefieldHero,
  buildBattlefieldMinion,
  buildBattlefieldMonster,
} from "./battlefield-units";

function entity(id: string, appearanceKey: string, catalogId?: string): DisplayEntity {
  return {
    id,
    side: "azure",
    kind: "unit",
    archetype: "hero",
    appearanceKey,
    position: { x: 0, y: 0 },
    hp: 100,
    maxHp: 100,
    destroyed: false,
    ...(catalogId ? { catalogId } : {}),
  };
}

function lodLevels(group: THREE.Group): THREE.Group[] {
  const lod = group.getObjectByName(`${group.name}.lod`);
  expect(lod).toBeInstanceOf(THREE.LOD);
  return (lod as THREE.LOD).levels.map(({ object }) => object as THREE.Group);
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root.traverse(object => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}

function minimumWorldY(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  let minimum = Infinity;
  for (const mesh of meshes(root)) {
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (!bounds) continue;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z])
          minimum = Math.min(minimum, mesh.localToWorld(new THREE.Vector3(x, y, z)).y);
  }
  return minimum;
}

function silhouetteBounds(root: THREE.Object3D): string {
  root.updateMatrixWorld(true);
  return meshes(root).map(mesh => {
    const bounds = new THREE.Box3().setFromObject(mesh);
    return [...bounds.min.toArray(), ...bounds.max.toArray()].map(value => Math.round(value * 100) / 100).join(",");
  }).sort().join(";");
}

describe("Battlefield unit models", () => {
  it("builds twelve Atelier identities with articulated rig anchors and bounded LOD draw calls", () => {
    const identities = ["f01", "f02", "f03", "f04", "f05", "f06", "r01", "r02", "r03", "r04", "r05", "r06"];
    const names = new Set<string>();
    for (const id of identities) {
      const group = new THREE.Group();
      const rig = buildBattlefieldHero(group, entity(id, `senkei.next.hero.${id}`, id.toUpperCase()), 0x347e83, `senkei.next.hero.${id}`);
      names.add(group.userData.heroName);
      const levels = lodLevels(group);
      expect(levels).toHaveLength(3);
      expect(levels[0].name).toContain(".full");
      expect(levels[1].name).toContain(".medium");
      expect(levels[2].name).toContain(".far");
      expect(meshes(levels[0]).length).toBeGreaterThan(8);
      // Full rigs keep per-joint meshes animatable; common distances are flattened below.
      expect(meshes(levels[0]).length).toBeLessThanOrEqual(60);
      expect(meshes(levels[1]).length).toBeLessThanOrEqual(5);
      expect(meshes(levels[2]).length).toBeLessThanOrEqual(5);
      expect(minimumWorldY(levels[0])).toBeGreaterThanOrEqual(-0.025);
      expect(rig.joints.torso).toBeInstanceOf(THREE.Group);
      expect(rig.joints.head).toBeInstanceOf(THREE.Group);
      expect(rig.weaponPivots.main).toBeInstanceOf(THREE.Group);
      expect(rig.restPose?.torso).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }));
      expect(rig.restPose?.["weapon.main"]).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }));
      expect(rig.anchors.head).toBeInstanceOf(THREE.Group);
      expect(group.getObjectByName(rig.joints.torso.name)).toBe(rig.joints.torso);
      const fullArmor = meshes(levels[0]).find(mesh => mesh.userData.unitSurface === "armor");
      const midArmor = meshes(levels[1]).find(mesh => mesh.userData.unitSurface === "armor");
      const farArmor = meshes(levels[2]).find(mesh => mesh.userData.unitSurface === "armor");
      expect(fullArmor).toBeDefined();
      expect(midArmor?.material).toBe(fullArmor?.material);
      expect(farArmor?.material).toBe(fullArmor?.material);
      for (const mesh of meshes(levels[0])) {
        expect(mesh.castShadow).toBe(true);
        expect(mesh.receiveShadow).toBe(true);
        expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
    }
    expect(names).toHaveProperty("size", 12);
  });

  it("gives each Hero an authored stance and a distinct shape signature independent of palette colors", () => {
    const identities = ["f01", "f02", "f03", "f04", "f05", "f06", "r01", "r02", "r03", "r04", "r05", "r06"];
    const stances = new Set<string>();
    const silhouettes = new Set<string>();
    for (const id of identities) {
      const group = new THREE.Group();
      const rig = buildBattlefieldHero(group, entity(id, `senkei.next.hero.${id}`, id.toUpperCase()), 0xffffff, `senkei.next.hero.${id}`);
      stances.add(JSON.stringify(rig.restPose));
      silhouettes.add(silhouetteBounds(lodLevels(group)[0]));
    }
    expect(stances.size).toBe(12);
    expect(silhouettes.size).toBe(12);
  });

  it("keeps melee, ranged and siege Minions visually distinct with a compact shared-material far LOD", () => {
    const kinds = ["melee", "ranged", "siege"];
    const groups = kinds.map(kind => {
      const group = new THREE.Group();
      const rig = buildBattlefieldMinion(group, entity(kind, `minion-${kind}`, `minion-${kind}`), 0x347e83, `minion-${kind}`);
      const levels = lodLevels(group);
      expect(levels).toHaveLength(3);
      expect(meshes(levels[1]).length).toBeLessThanOrEqual(5);
      expect(meshes(levels[2]).length).toBeLessThanOrEqual(5);
      expect(minimumWorldY(levels[0])).toBeGreaterThanOrEqual(-0.025);
      expect(rig.anchors.head).toBeInstanceOf(THREE.Group);
      expect(rig.weaponPivots.main).toBeInstanceOf(THREE.Group);
      return { group, levels };
    });
    expect(new Set(groups.map(({ group }) => group.userData.unitClass)).size).toBe(3);
    const silhouetteComplexity = groups.map(({ levels }) => meshes(levels[0]).reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count, 0));
    expect(new Set(silhouetteComplexity).size).toBe(3);
    expect(groups[2].group.name).toContain("siege");
  });

  it("keeps three neutral monster silhouettes on separate LOD models", () => {
    for (const species of ["grove-brute", "iron-warden", "storm-stalker"]) {
      const group = new THREE.Group();
      const rig = buildBattlefieldMonster(group, entity(species, species, `monster-${species}`), species);
      const levels = lodLevels(group);
      expect(group.userData.species).toBe(species);
      expect(levels).toHaveLength(3);
      expect(meshes(levels[1]).length).toBeLessThanOrEqual(5);
      expect(meshes(levels[2]).length).toBeLessThanOrEqual(5);
      expect(minimumWorldY(levels[0])).toBeGreaterThanOrEqual(-0.025);
      expect(rig.joints.head).toBeInstanceOf(THREE.Group);
      expect(rig.anchors.head).toBeInstanceOf(THREE.Group);
    }
  });
});
