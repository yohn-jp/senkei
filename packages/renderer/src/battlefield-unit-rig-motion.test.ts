import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { DisplayEntity } from "@senkei/replay-contract";
import { applyBattlefieldUnitLodMotion, buildBattlefieldHero } from "./battlefield-units";
import { battlefieldUnitRigMotion } from "./battlefield-unit-rig-motion";
import { applyHeroPreviewMotion, heroPreviewPose } from "./hero-preview-motion";

const previewEntity = (id: string): DisplayEntity => ({
  id: `preview:${id}`,
  catalogId: id,
  appearanceKey: `senkei.next.hero.${id.toLowerCase()}`,
  side: "neutral",
  kind: "unit",
  archetype: "hero",
  position: { x: 0, y: 0 },
  hp: 1,
  maxHp: 1,
  destroyed: false,
});

function minimumWorldY(root: THREE.Object3D): number {
  root.updateWorldMatrix(true, true);
  let minimum = Infinity;
  const point = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index);
      object.localToWorld(point);
      minimum = Math.min(minimum, point.y);
    }
  });
  return minimum;
}

function vertexPositions(root: THREE.Object3D): number[] {
  root.updateWorldMatrix(true, true);
  const points: number[] = [];
  const point = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index);
      object.localToWorld(point);
      points.push(point.x, point.y, point.z);
    }
  });
  return points;
}

function maximumDisplacement(first: readonly number[], second: readonly number[]): number {
  return Math.max(...first.map((value, index) => Math.abs(value - second[index]!)));
}

describe("additive named Hero rig motion", () => {
  it("maps tick poses to the published joints and both weapon pivots", () => {
    const motion = battlefieldUnitRigMotion({
      walk: 0.34,
      strike: 0.5,
      skill: 0.25,
      hit: 0.75,
      attackLean: 0.08,
      death: 0,
    });

    expect(motion.joints["leg.left"]?.x).toBe(0.34);
    expect(motion.joints["leg.right"]?.x).toBe(-0.34);
    expect(motion.joints["arm.right"]?.x).toBeCloseTo(-0.238);
    expect(motion.joints["arm.left"]?.x).toBeCloseTo(-0.367);
    expect(motion.joints.torso?.z).toBe(0.09);
    expect(motion.joints.torso?.x).toBe(0);
    expect(motion.weaponPivots.main?.x).toBe(-0.11);
    expect(motion.weaponPivots.off?.z).toBe(0.13);
    expect(motion.rootZ).toBe(0.08);
  });

  it("settles explicit death while suppressing active gait and attacks", () => {
    const motion = battlefieldUnitRigMotion({
      walk: 0.34,
      strike: 1,
      skill: 1,
      hit: 0,
      attackLean: 0.16,
      death: 1,
    });

    expect(motion.joints["leg.left"]?.x).toBe(0);
    expect(motion.joints["arm.right"]?.x).toBe(0);
    expect(motion.weaponPivots.main?.x).toBe(0);
    expect(motion.joints.torso?.z).toBe(0.68);
    expect(motion.rootZ).toBe(0.06);
  });

  it("gives Heroes a completed fall pose without changing other unit death motion", () => {
    const pose = { walk: 0.34, strike: 1, skill: 1, hit: 0, attackLean: 0.16, death: 1 };
    const motion = battlefieldUnitRigMotion(pose, true);
    expect(motion.rootZ).toBeCloseTo(1.45);
    expect(motion.joints.torso?.z).toBe(0);
    expect(motion.joints.torso?.x).toBeCloseTo(0.08);
    expect(motion.joints["leg.left"]?.x).toBeCloseTo(0.1);
    expect(motion.joints["arm.right"]?.x).toBeCloseTo(0.36);
    expect(motion.weaponPivots.main?.x).toBe(0);
    expect(motion.joints["shin.left"]?.x).toBeCloseTo(0.34);
    expect(motion.joints["arm.left"]?.z).toBeCloseTo(0.42);

    const halfway = battlefieldUnitRigMotion({ ...pose, death: 0.5 }, true);
    expect(halfway.rootZ).toBeCloseTo(0.805);
    expect(battlefieldUnitRigMotion(pose).rootZ).toBe(0.06);
  });

  it("keeps Hero hit response distinct from idle and rest", () => {
    const pose = { walk: 0, strike: 0, skill: 0, hit: 1, attackLean: 0, death: 0 };
    const motion = battlefieldUnitRigMotion(pose, true);
    expect(motion.joints.torso?.x).toBeCloseTo(0.32);
    expect(motion.joints.torso?.z).toBeCloseTo(0.22);
    expect(motion.joints.head?.x).toBeCloseTo(-0.12);
  });

  it("grounds the settled Hero body without penetration across all LODs and holds the endpoint", () => {
    const sampleTimes = [0, 0.225, 0.45, 0.675, 0.9, 1.35, 1.8];
    for (const heroId of ["F01", "R01"]) {
      const model = new THREE.Group();
      const entity = previewEntity(heroId);
      const rig = buildBattlefieldHero(model, entity, 0x71847b, entity.appearanceKey!);
      const lod = model.children.find((child): child is THREE.LOD => child instanceof THREE.LOD)!;

      for (let level = 0; level < 3; level++) {
        const selectedRig = rig.lodRigs?.[level];
        expect(selectedRig).toBeDefined();
        const selectedLod = lod.levels[level]!.object;
        lod.levels.forEach((item, index) => { item.object.visible = index === level; });
        const terminalSamples: Array<{ rootZ: number; rootY: number; bodyMinY: number; fullMinY: number; vertices: number[] }> = [];

        for (const elapsedSeconds of sampleTimes) {
          applyHeroPreviewMotion(selectedRig!, model, "death", elapsedSeconds, false);
          expect(minimumWorldY(selectedLod)).toBeGreaterThanOrEqual(-0.002);

          if (elapsedSeconds >= 0.9) {
            const body = selectedRig!.joints.torso!;
            const bodyBounds = new THREE.Box3().setFromObject(body);
            terminalSamples.push({
              rootZ: model.rotation.z,
              rootY: model.position.y,
              bodyMinY: bodyBounds.min.y,
              fullMinY: minimumWorldY(selectedLod),
              vertices: vertexPositions(selectedLod),
            });
          }
        }

        for (const sample of terminalSamples) {
          expect(sample.fullMinY).toBeGreaterThanOrEqual(-0.002);
          expect(sample.bodyMinY).toBeGreaterThanOrEqual(-0.002);
          expect(sample.bodyMinY).toBeLessThanOrEqual(0.08);
          expect(sample.rootZ).toBeCloseTo(1.45);
          expect(sample.rootY).toBeCloseTo(terminalSamples[0]!.rootY);
          expect(sample.vertices).toEqual(terminalSamples[0]!.vertices);
        }
      }
    }
  });

  it("keeps the full Move cycle near floor contact and gives idle/hit readable motion at every LOD", () => {
    const moveTimes = [0, 0.15625, 0.3125, 0.46875, 0.625];
    for (const heroId of ["F01", "R01"]) {
      const model = new THREE.Group();
      const entity = previewEntity(heroId);
      const rig = buildBattlefieldHero(model, entity, 0x71847b, entity.appearanceKey!);
      const lod = model.children.find((child): child is THREE.LOD => child instanceof THREE.LOD)!;

      for (let level = 0; level < 3; level++) {
        const selectedRig = rig.lodRigs![level]!;
        const selectedLod = lod.levels[level]!.object;
        lod.levels.forEach((item, index) => { item.object.visible = index === level; });
        const neutral = vertexPositions(selectedLod);
        for (const elapsedSeconds of moveTimes) {
          const motion = battlefieldUnitRigMotion(heroPreviewPose("move", elapsedSeconds, false), true);
          applyBattlefieldUnitLodMotion(rig, level, motion);
          model.rotation.z = motion.rootZ;
          model.position.y = 0;
          expect(minimumWorldY(selectedLod)).toBeGreaterThanOrEqual(-0.02);
        }

        applyHeroPreviewMotion(selectedRig, model, "idle", 0, false);
        const idleStart = vertexPositions(selectedLod);
        applyHeroPreviewMotion(selectedRig, model, "idle", Math.PI / 3.4, false);
        const idlePeak = vertexPositions(selectedLod);
        expect(maximumDisplacement(idleStart, idlePeak)).toBeGreaterThan(0.025);

        applyHeroPreviewMotion(selectedRig, model, "hit", 0.4, false);
        const hitPeak = vertexPositions(selectedLod);
        expect(maximumDisplacement(neutral, hitPeak)).toBeGreaterThan(0.05);
      }
    }
  });
});
