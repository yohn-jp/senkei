import type { BattlefieldUnitPose } from "./battlefield-unit-motion";

export interface BattlefieldRotationDelta {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BattlefieldRigMotion {
  /** Add these Euler deltas to the rig's authored rest pose each render. */
  readonly joints: Readonly<Record<string, BattlefieldRotationDelta>>;
  readonly weaponPivots: Readonly<Record<string, BattlefieldRotationDelta>>;
  /** Additive battlefield root Z rotation; preserves the root's facing yaw. */
  readonly rootZ: number;
}

const zero = (value: number): number => value === 0 ? 0 : value;
const rotation = (x = 0, y = 0, z = 0): BattlefieldRotationDelta => ({
  x: zero(x),
  y: zero(y),
  z: zero(z),
});

/**
 * Converts confirmed, tick-indexed action channels into additive named-rig
 * offsets. These values assume the model units used by Replay's world scale.
 * The caller resets each group to its model-authored rest pose before applying
 * the deltas, so Hero-specific stances supplied by the model remain intact.
 */
export function battlefieldUnitRigMotion(pose: BattlefieldUnitPose): BattlefieldRigMotion {
  const alive = 1 - pose.death;
  const step = pose.walk * alive;
  const strike = pose.strike * alive;
  const skill = pose.skill * alive;
  const hit = pose.hit * alive;
  const death = pose.death;

  return {
    joints: {
      "leg.left": rotation(step),
      "leg.right": rotation(-step),
      "shin.left": rotation(Math.max(0, step) * 0.32),
      "shin.right": rotation(Math.max(0, -step) * 0.32),
      "arm.left": rotation(-step * 0.55 - skill * 0.72),
      "arm.right": rotation(step * 0.55 - strike * 0.85),
      torso: rotation(0, 0, hit * 0.12 + death * 0.68),
      head: rotation(0, 0, death * 0.24),
      pelvis: rotation(death * 0.12),
      cape: rotation(Math.abs(step) * 0.18 + death * 0.3),
    },
    weaponPivots: {
      main: rotation(-strike * 0.22),
      off: rotation(-skill * 0.16, 0, skill * 0.52),
    },
    rootZ: pose.attackLean * alive + death * 0.5,
  };
}
