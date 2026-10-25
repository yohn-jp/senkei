import { describe, expect, it } from "vitest";
import { battlefieldUnitRigMotion } from "./battlefield-unit-rig-motion";

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
    expect(motion.rootZ).toBe(0.5);
  });
});
