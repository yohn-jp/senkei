import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { DisplayEntity } from "@senkei/replay-contract";
import { applyBattlefieldUnitLodMotion, buildBattlefieldHero } from "./battlefield-units";
import { battlefieldUnitRigMotion } from "./battlefield-unit-rig-motion";
import { heroPreviewPose } from "./hero-preview-motion";

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

  it("keeps both F01 and R01 boots grounded through the held death pose at every LOD", () => {
    const sampleTimes = [0, 0.225, 0.45, 0.675, 0.9, 1.35, 1.8];
    for (const heroId of ["F01", "R01"]) {
      const model = new THREE.Group();
      const entity = previewEntity(heroId);
      const rig = buildBattlefieldHero(model, entity, 0x71847b, entity.appearanceKey!);

      for (let level = 0; level < 3; level++) {
        const selectedRig = rig.lodRigs?.[level];
        expect(selectedRig).toBeDefined();
        const leftLeg = selectedRig!.joints["leg.left"];
        const rightLeg = selectedRig!.joints["leg.right"];
        expect(leftLeg).toBeDefined();
        expect(rightLeg).toBeDefined();

        for (const elapsedSeconds of sampleTimes) {
          const pose = heroPreviewPose("death", elapsedSeconds, false);
          const motion = battlefieldUnitRigMotion(pose);
          applyBattlefieldUnitLodMotion(rig, level, motion);
          model.rotation.z = motion.rootZ;
          const bootMinima = [minimumWorldY(leftLeg!), minimumWorldY(rightLeg!)];

          for (const minimumY of bootMinima) expect(minimumY).toBeGreaterThanOrEqual(-0.002);
          // Each boot remains within 8 cm of the local ground plane; this
          // catches the prior endpoint where one boot was high and the other
          // had already penetrated the ground.
          expect(Math.max(...bootMinima)).toBeLessThanOrEqual(0.08);
        }
      }
    }
  });
});
