import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildBattlefieldHero } from "./battlefield-units";
import { battlefieldUnitRigMotion } from "./battlefield-unit-rig-motion";
import { battlefieldUnitPose } from "./battlefield-unit-motion";
import { applyHeroPreviewMotion, heroPreviewPose, type HeroPreviewPose } from "./hero-preview-motion";
import { disposeHeroPreviewScene } from "./renderer-hero-model-preview";
import type { DisplayEntity } from "@senkei/replay-contract";

const entity = { id: "preview:F01", side: "neutral", kind: "unit", archetype: "hero", catalogId: "F01", appearanceKey: "hero_f01", position: { x: 0, y: 0 }, hp: 1, maxHp: 1, destroyed: false } as DisplayEntity;

describe("catalog Hero animation", () => {
  it("samples movement, attack, hit and death through separate shared action channels", () => {
    expect(heroPreviewPose("move", 0.2, false).walk).not.toBe(0);
    expect(heroPreviewPose("attack", 0.4, false).strike).toBeGreaterThan(0.5);
    expect(heroPreviewPose("attack", 0.3625, false).strikePhase).toBeCloseTo(0.25);
    expect(heroPreviewPose("attack", 0.725, false).strikePhase).toBeCloseTo(0.5);
    expect(heroPreviewPose("attack", 1.0875, false).strikePhase).toBeCloseTo(0.75);
    expect(heroPreviewPose("hit", 0.2, false).hit).toBeGreaterThan(0.5);
    expect(heroPreviewPose("hit", 0.2, false).hitPhase).toBeCloseTo(0.25);
    expect(heroPreviewPose("hit", 0.6, false).hitPhase).toBeCloseTo(0.75);
    expect(heroPreviewPose("hit", 0.2, false).strike).toBe(0);
    expect(heroPreviewPose("death", 2, false).death).toBe(1);
    expect(heroPreviewPose("death", 3, false)).toEqual(heroPreviewPose("death", 2, false));
  });

  it("holds readable reduced-motion poses independent of time", () => {
    for (const pose of ["idle", "move", "attack", "hit", "death"] as const) {
      expect(heroPreviewPose(pose, 0, true)).toEqual(heroPreviewPose(pose, 5, true));
    }
    expect(heroPreviewPose("hit", 0, true).hit).toBeGreaterThan(0.5);
    expect(heroPreviewPose("death", 0, true).death).toBe(1);
  });

  it("passes the same deterministic idle oscillator through the shared Hero rig", () => {
    const elapsedSeconds = 0.6;
    const pose = heroPreviewPose("idle", elapsedSeconds, false, entity.id);
    const motion = battlefieldUnitRigMotion(pose, true);
    const replayPose = battlefieldUnitPose(12, [], entity.id, false, true, 0.9, 50);
    const model = new THREE.Group();
    const rig = buildBattlefieldHero(model, entity, 0x71847b, entity.appearanceKey!);

    expect(pose).toEqual(replayPose);
    applyHeroPreviewMotion(rig, model, "idle", elapsedSeconds, false, entity.id);
    expect(rig.joints.torso!.rotation.x).toBeCloseTo((rig.restPose?.torso?.x ?? 0) + motion.joints.torso!.x, 10);
    expect(rig.joints.torso!.rotation.y).toBeCloseTo((rig.restPose?.torso?.y ?? 0) + motion.joints.torso!.y, 10);
    expect(rig.joints.cape!.rotation.x).toBeCloseTo((rig.restPose?.cape?.x ?? 0) + motion.joints.cape!.x, 10);
    expect(heroPreviewPose("idle", elapsedSeconds, false, "preview:other").idlePhase)
      .not.toBe(pose.idlePhase);
  });

  it("animates one built rig without replacing identity, equipment or accumulating offsets", () => {
    const model = new THREE.Group();
    const rig = buildBattlefieldHero(model, entity, 0x71847b, entity.appearanceKey!);
    const originalChildren = [...model.children];
    const identity = JSON.stringify(model.userData);
    const samples = new Set<string>();
    for (const pose of ["idle", "move", "attack", "hit", "death"] as HeroPreviewPose[]) {
      applyHeroPreviewMotion(rig, model, pose, 0.4, false);
      samples.add(JSON.stringify([model.rotation.toArray(), ...Object.values(rig.joints).map(joint => joint.rotation.toArray())]));
    }
    expect(samples.size).toBe(5);
    applyHeroPreviewMotion(rig, model, "idle", 0, true);
    for (const [name, joint] of Object.entries(rig.joints)) {
      const rest = rig.restPose?.[name] ?? { x: 0, y: 0, z: 0 };
      expect(joint.rotation.toArray().slice(0, 3)).toEqual([rest.x, rest.y, rest.z]);
    }
    expect(model.rotation.z).toBe(0);
    expect(model.children).toEqual(originalChildren);
    expect(JSON.stringify(model.userData)).toBe(identity);
  });
});


describe("catalog preview resource ownership", () => {
  it("releases local geometry and studio material while keeping battlefield materials alive", () => {
    const scene = new THREE.Scene();
    const model = new THREE.Group();
    scene.add(model);
    buildBattlefieldHero(model, entity, 0x71847b, entity.appearanceKey!);
    let sharedDisposals = 0;
    let geometryDisposals = 0;
    const shared = new Set<THREE.Material>();
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.addEventListener("dispose", () => geometryDisposals++);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) shared.add(material);
    });
    for (const material of shared) material.addEventListener("dispose", () => sharedDisposals++);
    const studioMaterial = new THREE.MeshStandardMaterial();
    let studioDisposals = 0;
    studioMaterial.addEventListener("dispose", () => studioDisposals++);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), studioMaterial));
    disposeHeroPreviewScene(scene);
    expect(geometryDisposals).toBeGreaterThan(0);
    expect(studioDisposals).toBe(1);
    expect(sharedDisposals).toBe(0);
  });
});
