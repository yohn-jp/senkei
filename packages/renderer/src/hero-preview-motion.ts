import * as THREE from "three";
import type { BattlefieldUnitRig } from "./battlefield-units";
import type { BattlefieldUnitPose } from "./battlefield-unit-motion";
import { battlefieldUnitIdlePhaseAtSeconds } from "./battlefield-unit-motion";
import { battlefieldUnitGroundingOffset, battlefieldUnitRigMotion } from "./battlefield-unit-rig-motion";

export type HeroPreviewPose = "idle" | "move" | "attack" | "hit" | "death";

/** Catalog clock supplies demonstration channels; joint motion is shared with Replay. */
export function heroPreviewPose(
  pose: HeroPreviewPose,
  elapsedSeconds: number,
  reducedMotion: boolean,
  entityId = "preview",
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
    idle: pose === "idle" && !reducedMotion ? 1 : 0,
    idlePhase: pose === "idle" && !reducedMotion ? battlefieldUnitIdlePhaseAtSeconds(time, entityId) : 0,
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
  entityId?: string,
): void {
  const stableEntityId = entityId ?? String(model.userData.entityId ?? model.userData.catalogId ?? "preview");
  const motion = battlefieldUnitRigMotion(heroPreviewPose(pose, elapsedSeconds, reducedMotion, stableEntityId), true);
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
}
