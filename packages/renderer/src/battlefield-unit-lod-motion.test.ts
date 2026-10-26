import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DisplayEntity } from "@senkei/replay-contract";
import { applyBattlefieldUnitLodMotion, buildBattlefieldHero, buildBattlefieldMinion, buildBattlefieldMonster } from "./battlefield-units";
import { battlefieldUnitRigMotion } from "./battlefield-unit-rig-motion";

const idle = { walk: 0, strike: 0, skill: 0, hit: 0, attackLean: 0, death: 0 };
const entity = (key: string): DisplayEntity => ({ id: key, catalogId: key, appearanceKey: key, side: "azure", kind: "unit", archetype: "hero", position: { x: 4, y: 5 }, hp: 100, maxHp: 100, destroyed: false });

function vertices(root: THREE.Object3D): number[] {
  root.updateWorldMatrix(true, true);
  const values: number[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) values.push(...object.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i)).toArray());
  });
  return values;
}

function displacement(first: number[], second: number[]): number {
  return Math.max(...first.map((value, index) => Math.abs(value - second[index])));
}

describe("visible LOD replay motion", () => {
  for (const key of ["F01", "R01", "minion-melee", "minion-ranged", "minion-siege", "grove-brute", "iron-warden", "storm-stalker"]) {
    it(`${key} visibly walks and attacks at every detail level without changing world identity`, () => {
      const root = new THREE.Group();
      const appearance = key.startsWith("F") || key.startsWith("R") ? `senkei.next.hero.${key.toLowerCase()}` : key;
      const rig = key.startsWith("minion") ? buildBattlefieldMinion(root, entity(key), 0x347e83, appearance)
        : key === "F01" || key === "R01" ? buildBattlefieldHero(root, entity(key), 0x347e83, appearance)
        : buildBattlefieldMonster(root, entity(key), appearance);
      root.position.set(4, 0.2, 5);
      root.rotation.y = 0.7;
      const identity = JSON.stringify(root.userData.assetManifest);
      const lod = root.children.find(child => child instanceof THREE.LOD) as THREE.LOD;
      const fullNeutral = vertices(lod.levels[0].object);
      for (let level = 0; level < 3; level++) {
        const object = lod.levels[level].object;
        const neutral = vertices(object);
        applyBattlefieldUnitLodMotion(rig, level, battlefieldUnitRigMotion({ ...idle, walk: 0.32 }));
        const walking = vertices(object);
        // Siege's rolling chassis has no gait joints: its weapon still articulates below.
        if (key !== "minion-siege") expect(displacement(neutral, walking)).toBeGreaterThan(0.015);
        applyBattlefieldUnitLodMotion(rig, level, battlefieldUnitRigMotion({ ...idle, strike: 0.85, skill: 0.7 }));
        const attacking = vertices(object);
        expect(displacement(neutral, attacking)).toBeGreaterThan(0.015);
        expect(displacement(walking, attacking)).toBeGreaterThan(0.015);
        // Repeated/rewound samples must never accumulate offsets or change buffers.
        applyBattlefieldUnitLodMotion(rig, level, battlefieldUnitRigMotion({ ...idle, strike: 0.85, skill: 0.7 }));
        expect(vertices(object)).toEqual(attacking);
        applyBattlefieldUnitLodMotion(rig, level, battlefieldUnitRigMotion(idle));
        expect(vertices(object)).toEqual(neutral);
        if (level > 0) expect(vertices(lod.levels[0].object)).toEqual(fullNeutral);
      }
      expect(root.position.toArray()).toEqual([4, 0.2, 5]);
      expect(root.rotation.y).toBe(0.7);
      expect(JSON.stringify(root.userData.assetManifest)).toBe(identity);
    });
  }
});
