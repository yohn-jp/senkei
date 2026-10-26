import type * as THREE from "three";
import type { BattlefieldUnitRig } from "./battlefield-units";
import type { BattlefieldUnitPose } from "./battlefield-unit-motion";
import { battlefieldUnitRigMotion } from "./battlefield-unit-rig-motion";

export type HeroPreviewPose = "idle" | "move" | "attack" | "hit" | "death";

/** Catalog clock supplies demonstration channels; joint motion is shared with Replay. */
export function heroPreviewPose(pose: HeroPreviewPose, elapsedSeconds: number, reducedMotion: boolean): BattlefieldUnitPose {
  const time = Math.max(0, elapsedSeconds);
  const duration = pose === "hit" ? 0.8 : 1.45;
  const action = reducedMotion ? 1 : Math.sin((time % duration) / duration * Math.PI);
  return {
    walk: pose === "move" ? (reducedMotion ? 0.34 : Math.sin(time * Math.PI * 3.2) * 0.34) : 0,
    strike: pose === "attack" ? action : 0,
    skill: 0,
    hit: pose === "hit" ? action : 0,
    attackLean: pose === "attack" ? action * 0.16 : 0,
    death: pose === "death" ? (reducedMotion ? 1 : Math.min(1, time / 0.9)) : 0,
  };
}

/** Always restore the authored stance first, including when leaving the held death pose. */
export function applyHeroPreviewMotion(
  rig: BattlefieldUnitRig,
  model: THREE.Group,
  pose: HeroPreviewPose,
  elapsedSeconds: number,
  reducedMotion: boolean,
): void {
  const motion = battlefieldUnitRigMotion(heroPreviewPose(pose, elapsedSeconds, reducedMotion));
  const apply = (key: string, joint: THREE.Group, offset?: { x: number; y: number; z: number }) => {
    const rest = rig.restPose?.[key] ?? { x: 0, y: 0, z: 0 };
    joint.rotation.set(rest.x + (offset?.x ?? 0), rest.y + (offset?.y ?? 0), rest.z + (offset?.z ?? 0));
  };
  for (const [key, joint] of Object.entries(rig.joints)) apply(key, joint, motion.joints[key]);
  for (const [key, joint] of Object.entries(rig.weaponPivots)) apply(`weapon.${key}`, joint, motion.weaponPivots[key]);
  model.rotation.z = motion.rootZ;
  model.position.y = 0;
  if (pose === "idle" && !reducedMotion) {
    const breath = Math.sin(elapsedSeconds * 1.7);
    if (rig.joints.torso) apply("torso", rig.joints.torso, { x: breath * 0.025, y: 0, z: breath * 0.012 });
    if (rig.joints.head) apply("head", rig.joints.head, { x: 0, y: Math.sin(elapsedSeconds * 0.8) * 0.035, z: 0 });
    if (rig.joints.cape) apply("cape", rig.joints.cape, { x: breath * 0.035, y: 0, z: 0 });
  }
}
