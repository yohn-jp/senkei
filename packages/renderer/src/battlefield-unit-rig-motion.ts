import * as THREE from "three";
import { BATTLEFIELD_HERO_IDLE_ANGULAR_FREQUENCY, type BattlefieldUnitPose } from "./battlefield-unit-motion";

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
export function battlefieldUnitRigMotion(
  pose: BattlefieldUnitPose & { readonly strikePhase?: number; readonly hitPhase?: number },
  heroMotion = false,
): BattlefieldRigMotion {
  const alive = 1 - pose.death;
  const step = pose.walk * alive;
  const strike = pose.strike * alive;
  const skill = pose.skill * alive;
  const hit = pose.hit * alive;
  const death = pose.death;
  const idle = heroMotion ? Math.max(0, Math.min(1, pose.idle ?? 0)) : 0;
  const idlePhase = pose.idlePhase ?? 0;
  const idleBreath = idle * Math.sin(idlePhase);
  const idleWeightShift = idle * Math.sin(idlePhase * (1.05 / BATTLEFIELD_HERO_IDLE_ANGULAR_FREQUENCY) - 0.35);
  const idleClothWave = idle * Math.sin(idlePhase * (2.25 / BATTLEFIELD_HERO_IDLE_ANGULAR_FREQUENCY) - 0.8);
  const idleDelayedFold = idle * Math.sin(idlePhase * (3.1 / BATTLEFIELD_HERO_IDLE_ANGULAR_FREQUENCY) - 1.45);
  const settledFall = death * death * (3 - 2 * death);
  const strikePhase = THREE.MathUtils.clamp(pose.strikePhase ?? 0.5, 0, 1);
  const hitPhase = THREE.MathUtils.clamp(pose.hitPhase ?? 0.5, 0, 1);
  const attackPrep = strikePhase < 0.5 ? Math.sin(Math.PI * strikePhase * 2) : 0;
  const attackFollowThrough = strikePhase > 0.5 ? Math.sin(Math.PI * (strikePhase - 0.5) * 2) : 0;
  const hitRecovery = hitPhase > 0.5 ? Math.sin(Math.PI * (hitPhase - 0.5) * 2) : 0;

  return {
    joints: {
      "leg.left": rotation(step + (heroMotion
        ? settledFall * 0.1 - attackPrep * 0.08 - strike * 0.1 + attackFollowThrough * 0.05 + hit * 0.12 - hitRecovery * 0.06 + idleWeightShift * 0.025
        : 0)),
      "leg.right": rotation(-step - (heroMotion
        ? settledFall * 0.2 - attackPrep * 0.16 - strike * 0.08 + attackFollowThrough * 0.12 - hit * 0.16 + hitRecovery * 0.08 - idleWeightShift * 0.025
        : 0)),
      "shin.left": rotation(Math.max(0, step) * 0.32 + (heroMotion ? settledFall * 0.34 + attackPrep * 0.08 + hit * 0.18 - hitRecovery * 0.1 : 0)),
      "shin.right": rotation(Math.max(0, -step) * 0.32 + (heroMotion ? settledFall * 0.12 + attackPrep * 0.12 + attackFollowThrough * 0.1 + hit * 0.22 - hitRecovery * 0.12 : 0)),
      "arm.left": heroMotion
        ? rotation(-step * 0.55 - skill * 0.72 - settledFall * 0.28 + strike * 0.18 + attackPrep * 0.55 - attackFollowThrough * 0.35 + hit * 0.52 - hitRecovery * 0.32 + idleBreath * 0.08 + idleWeightShift * 0.025,
          0, settledFall * 0.42 - attackPrep * 0.32 + attackFollowThrough * 0.28 + hit * 0.45 - hitRecovery * 0.25 - idleBreath * 0.035)
        : rotation(-step * 0.55 - skill * 0.72),
      "arm.right": heroMotion
        ? rotation(step * 0.55 - strike * 0.72 - attackPrep * 0.55 + attackFollowThrough * 0.45 + settledFall * 0.36 - hit * 0.35 + hitRecovery * 0.32 - idleBreath * 0.08 - idleWeightShift * 0.025,
          attackPrep * 0.12 - attackFollowThrough * 0.1,
          strike * 0.35 + attackPrep * 0.45 + attackFollowThrough * 0.55 - settledFall * 0.22 - hit * 0.55 + hitRecovery * 0.38 + idleBreath * 0.035)
        : rotation(step * 0.55 - strike * 0.85),
      "forearm.left": rotation(heroMotion ? settledFall * 0.2 + hit * 0.26 - hitRecovery * 0.18 + attackPrep * 0.12 + idleClothWave * 0.04 : 0, 0,
        heroMotion ? hit * 0.18 - hitRecovery * 0.12 + idleWeightShift * 0.025 : 0),
      "forearm.right": rotation(heroMotion ? -settledFall * 0.24 + strike * 0.08 + attackPrep * 0.36 - attackFollowThrough * 0.35 + hit * 0.34 + hitRecovery * 0.28 : 0,
        heroMotion ? attackPrep * -0.08 + attackFollowThrough * 0.12 : 0,
        heroMotion ? strike * 0.05 - attackPrep * 0.08 + attackFollowThrough * 0.05 - hit * 0.34 - hitRecovery * 0.22 - idleWeightShift * 0.025 : 0),
      torso: heroMotion
        ? rotation(hit * 0.62 - hitRecovery * 0.28 + settledFall * 0.08 + strike * 0.35 + attackPrep * 0.18 - attackFollowThrough * 0.12 + idleBreath * 0.12,
          strike * 0.16 - attackPrep * 0.2 + attackFollowThrough * 0.32 + hit * 0.1 + idleWeightShift * 0.025,
          hit * 0.36 - hitRecovery * 0.16 + attackFollowThrough * 0.4 - attackPrep * 0.3 + idleBreath * 0.08)
        : rotation(0, 0, hit * 0.12 + death * 0.68),
      head: heroMotion
        ? rotation(-hit * 0.33 + hitRecovery * 0.16 - settledFall * 0.08 - idleBreath * 0.035,
          hit * 0.12 - hitRecovery * 0.08 + strike * 0.06
            + idle * Math.sin(idlePhase * (0.9 / BATTLEFIELD_HERO_IDLE_ANGULAR_FREQUENCY)) * 0.1,
          hit * 0.1 - hitRecovery * 0.08 + attackFollowThrough * 0.08 - idleWeightShift * 0.035)
        : rotation(0, 0, death * 0.24),
      pelvis: heroMotion
        ? rotation(death * 0.12 + strike * 0.05 + attackPrep * 0.08 - attackFollowThrough * 0.06 - hit * 0.18 + hitRecovery * 0.1 - idleBreath * 0.035,
          -attackPrep * 0.1 + attackFollowThrough * 0.14 + idleWeightShift * 0.04,
          attackPrep * 0.12 + attackFollowThrough * 0.18 - hit * 0.24 + hitRecovery * 0.12 + idleWeightShift * 0.035)
        : rotation(death * 0.12),
      // The cape extends along local -Z, so a positive X rotation swings it
      // through the torso toward the camera. Hit recoil keeps the cloth folded
      // behind the body. Y/Z rotation adds a delayed sideways follow without
      // bringing its surface through the chest.
      cape: heroMotion
        ? rotation(Math.abs(step) * 0.18 + death * 0.36 - attackPrep * 0.18 - attackFollowThrough * 0.28 - hit * 0.35 - hitRecovery * 0.2
            - idle * (0.13 + (0.5 + idleClothWave * 0.5) * 0.09),
          attackPrep * -0.16 + attackFollowThrough * 0.2 + hit * 0.12 + hitRecovery * 0.18 + idleClothWave * 0.18 + idleDelayedFold * 0.04,
          attackPrep * -0.2 + attackFollowThrough * 0.16 + hit * 0.1 + hitRecovery * 0.2
            + idle * Math.sin(idlePhase * (1.75 / BATTLEFIELD_HERO_IDLE_ANGULAR_FREQUENCY) - 1.1) * 0.12 + idleDelayedFold * 0.08)
        : rotation(Math.abs(step) * 0.18 + death * -0.06),
    },
    weaponPivots: {
      main: rotation(-strike * (heroMotion ? 0.26 : 0.22) + (heroMotion ? attackPrep * 0.4 + attackFollowThrough * 1.0 : 0),
        heroMotion ? attackPrep * 0.08 + attackFollowThrough * 0.1 : 0,
        heroMotion ? -strike * 0.25 - attackPrep * 0.4 - attackFollowThrough * 0.45 : 0),
      off: rotation(-skill * 0.16, 0, skill * 0.52),
    },
    // Heroes settle onto their side as a completed presentation pose. The
    // renderer supplies the geometry-dependent root Y support correction;
    // other unit types retain their existing small death lean.
    rootZ: pose.attackLean * alive * (heroMotion ? 1.25 : 1)
      + (heroMotion ? attackPrep * 0.12 - attackFollowThrough * 0.22 - hit * 0.22 + hitRecovery * 0.12 : 0)
      + (heroMotion ? settledFall * 1.45 : death * 0.06),
  };
}

/** Vertical root correction that places a posed LOD's lowest vertex on groundY. */
export function battlefieldUnitGroundingOffset(subject: THREE.Object3D, groundY: number): number {
  subject.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(subject);
  return bounds.isEmpty() || !Number.isFinite(bounds.min.y) ? 0 : groundY - bounds.min.y;
}
