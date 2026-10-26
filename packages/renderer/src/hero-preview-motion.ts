import * as THREE from "three";
import type { BattlefieldUnitRig } from "./battlefield-units";
import type { BattlefieldUnitPose } from "./battlefield-unit-motion";
import { battlefieldUnitGroundingOffset, battlefieldUnitRigMotion } from "./battlefield-unit-rig-motion";

export type HeroPreviewPose = "idle" | "move" | "attack" | "hit" | "death";

/** Catalog clock supplies demonstration channels; joint motion is shared with Replay. */
export function heroPreviewPose(
  pose: HeroPreviewPose,
  elapsedSeconds: number,
  reducedMotion: boolean,
): BattlefieldUnitPose & { readonly strikePhase?: number; readonly hitPhase?: number } {
  const time = Math.max(0, elapsedSeconds);
  const duration = pose === "hit" ? 0.8 : 1.45;
  const phase = reducedMotion ? 0.5 : (time % duration) / duration;
  const action = reducedMotion ? 1 : Math.sin(phase * Math.PI);
  return {
    walk: pose === "move" ? (reducedMotion ? 0.34 : Math.sin(time * Math.PI * 3.2) * 0.34) : 0,
    strike: pose === "attack" ? action : 0,
    skill: 0,
    hit: pose === "hit" ? action : 0,
    attackLean: pose === "attack" ? action * 0.16 : 0,
    death: pose === "death" ? (reducedMotion ? 1 : Math.min(1, time / 0.9)) : 0,
    ...(pose === "attack" ? { strikePhase: phase } : {}),
    ...(pose === "hit" ? { hitPhase: phase } : {}),
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
  const motion = battlefieldUnitRigMotion(heroPreviewPose(pose, elapsedSeconds, reducedMotion), true);
  const apply = (key: string, joint: THREE.Group, offset?: { x: number; y: number; z: number }) => {
    const rest = rig.restPose?.[key] ?? { x: 0, y: 0, z: 0 };
    joint.rotation.set(rest.x + (offset?.x ?? 0), rest.y + (offset?.y ?? 0), rest.z + (offset?.z ?? 0));
  };
  for (const [key, joint] of Object.entries(rig.joints)) apply(key, joint, motion.joints[key]);
  for (const [key, joint] of Object.entries(rig.weaponPivots)) apply(`weapon.${key}`, joint, motion.weaponPivots[key]);
  model.rotation.z = motion.rootZ;
  model.position.y = 0;
  if (pose === "death" && motion.rootZ !== 0) {
    const lod = model.children.find((child): child is THREE.LOD => child instanceof THREE.LOD);
    const visible = lod?.levels.find(({ object }) => object.visible)?.object;
    model.position.y = battlefieldUnitGroundingOffset(visible ?? model, 0);
  }
  if (pose === "idle" && !reducedMotion) {
    const breath = Math.sin(elapsedSeconds * 2.1);
    const clothSway = Math.sin(elapsedSeconds * 1.55 - 0.42);
    if (rig.joints.pelvis) apply("pelvis", rig.joints.pelvis, { x: breath * -0.025, y: 0, z: 0 });
    if (rig.joints.torso) apply("torso", rig.joints.torso, { x: breath * 0.085, y: 0, z: breath * 0.055 });
    if (rig.joints.head) apply("head", rig.joints.head, { x: breath * -0.025, y: Math.sin(elapsedSeconds * 0.8) * 0.08, z: 0 });
    if (rig.joints.cape) apply("cape", rig.joints.cape, { x: clothSway * 0.16, y: clothSway * 0.055, z: breath * 0.025 });
    if (rig.joints["arm.left"]) apply("arm.left", rig.joints["arm.left"], { x: breath * 0.055, y: 0, z: -breath * 0.025 });
    if (rig.joints["arm.right"]) apply("arm.right", rig.joints["arm.right"], { x: breath * -0.055, y: 0, z: breath * 0.025 });
    if (rig.joints["forearm.left"]) apply("forearm.left", rig.joints["forearm.left"], { x: clothSway * 0.025, y: 0, z: 0 });
    if (rig.joints["forearm.right"]) apply("forearm.right", rig.joints["forearm.right"], { x: clothSway * -0.025, y: 0, z: 0 });
  }
}
