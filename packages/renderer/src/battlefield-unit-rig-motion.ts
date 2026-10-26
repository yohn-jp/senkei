import * as THREE from "three";
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
export function battlefieldUnitRigMotion(pose: BattlefieldUnitPose, heroDeathFall = false): BattlefieldRigMotion {
  const alive = 1 - pose.death;
  const step = pose.walk * alive;
  const strike = pose.strike * alive;
  const skill = pose.skill * alive;
  const hit = pose.hit * alive;
  const death = pose.death;
  const settledFall = death * death * (3 - 2 * death);

  return {
    joints: {
      "leg.left": rotation(step + (heroDeathFall ? settledFall * 0.1 : 0)),
      "leg.right": rotation(-step - (heroDeathFall ? settledFall * 0.2 : 0)),
      "shin.left": rotation(Math.max(0, step) * 0.32 + (heroDeathFall ? settledFall * 0.34 : 0)),
      "shin.right": rotation(Math.max(0, -step) * 0.32 + (heroDeathFall ? settledFall * 0.12 : 0)),
      "arm.left": heroDeathFall
        ? rotation(-step * 0.55 - skill * 0.72 - settledFall * 0.28, 0, settledFall * 0.42)
        : rotation(-step * 0.55 - skill * 0.72),
      "arm.right": heroDeathFall
        ? rotation(step * 0.55 - strike * 0.85 + settledFall * 0.36, 0, -settledFall * 0.22)
        : rotation(step * 0.55 - strike * 0.85),
      "forearm.left": rotation(heroDeathFall ? settledFall * 0.2 : 0),
      "forearm.right": rotation(heroDeathFall ? -settledFall * 0.24 : 0),
      torso: heroDeathFall
        ? rotation(hit * 0.32 + settledFall * 0.08, 0, hit * 0.22)
        : rotation(0, 0, hit * 0.12 + death * 0.68),
      head: heroDeathFall
        ? rotation(-hit * 0.12 - settledFall * 0.08, hit * 0.05, death * 0.1)
        : rotation(0, 0, death * 0.24),
      pelvis: rotation(death * (heroDeathFall ? 0.12 : 0.12)),
      cape: rotation(Math.abs(step) * 0.18 + death * (heroDeathFall ? 0.36 : 0.3)),
    },
    weaponPivots: {
      main: rotation(-strike * 0.22),
      off: rotation(-skill * 0.16, 0, skill * 0.52),
    },
    // Heroes settle onto their side as a completed presentation pose. The
    // renderer supplies the geometry-dependent root Y support correction;
    // other unit types retain their existing small death lean.
    rootZ: pose.attackLean * alive + (heroDeathFall ? settledFall * 1.45 : death * 0.06),
  };
}

/** Vertical root correction that places a posed LOD's lowest vertex on groundY. */
export function battlefieldUnitGroundingOffset(subject: THREE.Object3D, groundY: number): number {
  subject.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(subject);
  return bounds.isEmpty() || !Number.isFinite(bounds.min.y) ? 0 : groundY - bounds.min.y;
}
