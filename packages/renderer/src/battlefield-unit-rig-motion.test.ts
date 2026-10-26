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

function weaponPenetratesBody(weapon: THREE.Object3D, torso: THREE.Object3D): boolean {
  weapon.updateWorldMatrix(true, true);
  torso.updateWorldMatrix(true, true);
  const bodyMeshes = torso.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  const raycaster = new THREE.Raycaster();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let intersects = false;
  weapon.traverse((object) => {
    if (intersects || !(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    const indices = object.geometry.index;
    const count = indices?.count ?? positions.count;
    for (let triangle = 0; triangle + 2 < count && !intersects; triangle += 3) {
      const vertexIndices = [0, 1, 2].map(offset => indices?.getX(triangle + offset) ?? triangle + offset);
      for (const [from, to] of [[0, 1], [1, 2], [2, 0]] as const) {
        start.fromBufferAttribute(positions, vertexIndices[from]!);
        object.localToWorld(start);
        end.fromBufferAttribute(positions, vertexIndices[to]!);
        object.localToWorld(end);
        direction.subVectors(end, start);
        const length = direction.length();
        if (length <= 0.004) continue;
        raycaster.set(start, direction.normalize());
        raycaster.near = 0.002;
        raycaster.far = length - 0.002;
        if (bodyMeshes.some(mesh => raycaster.intersectObject(mesh, false).length > 0)) {
          intersects = true;
          break;
        }
      }
    }
  });
  return intersects;
}

function isDescendant(child: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let parent = child.parent;
  while (parent) {
    if (parent === ancestor) return true;
    parent = parent.parent;
  }
  return false;
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
    expect(halfway.rootZ).toBeCloseTo(0.825);
    expect(battlefieldUnitRigMotion(pose).rootZ).toBe(0.06);
  });

  it("keeps Hero hit response distinct from idle and rest", () => {
    const pose = { walk: 0, strike: 0, skill: 0, hit: 1, attackLean: 0, death: 0 };
    const motion = battlefieldUnitRigMotion(pose, true);
    expect(motion.joints.torso?.x).toBeCloseTo(0.42);
    expect(motion.joints.torso?.z).toBeCloseTo(0.26);
    expect(motion.joints.head?.x).toBeCloseTo(-0.22);
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

  it("keeps the full Move cycle near floor contact at every LOD", () => {
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

        expect(vertexPositions(selectedLod).length).toBe(neutral.length);
      }
    }
  });

  it("shows upper-body breathing and delayed cape sway through an idle cycle at every LOD", () => {
    for (const heroId of ["F01", "R01"]) {
      const model = new THREE.Group();
      const entity = previewEntity(heroId);
      const rig = buildBattlefieldHero(model, entity, 0x71847b, entity.appearanceKey!);
      const lod = model.children.find((child): child is THREE.LOD => child instanceof THREE.LOD)!;
      for (let level = 0; level < 3; level++) {
        const selectedRig = rig.lodRigs![level]!;
        const selectedLod = lod.levels[level]!.object;
        lod.levels.forEach((item, index) => { item.object.visible = index === level; });

        applyHeroPreviewMotion(selectedRig, model, "idle", 0, false);
        const still = vertexPositions(selectedLod);
        const torsoStill = vertexPositions(selectedRig.joints.torso!);
        const capeStill = selectedRig.joints.cape ? vertexPositions(selectedRig.joints.cape) : undefined;
        applyHeroPreviewMotion(selectedRig, model, "idle", 0.75, false);
        const breath = vertexPositions(selectedLod);
        const torsoBreath = vertexPositions(selectedRig.joints.torso!);
        const capeSway = selectedRig.joints.cape ? vertexPositions(selectedRig.joints.cape) : undefined;

        expect(maximumDisplacement(still, breath)).toBeGreaterThan(0.08);
        expect(maximumDisplacement(torsoStill, torsoBreath)).toBeGreaterThan(0.035);
        if (capeStill && capeSway) expect(maximumDisplacement(capeStill, capeSway)).toBeGreaterThan(0.06);
      }
    }
  });

  it("distinguishes attack preparation, swing and follow-through while preserving weapon attachment and torso clearance", () => {
    const sampleTimes = [0, 0.3625, 0.725, 1.0875, 1.45];
    for (const heroId of ["F01", "R01"]) {
      const model = new THREE.Group();
      const entity = previewEntity(heroId);
      const rig = buildBattlefieldHero(model, entity, 0x71847b, entity.appearanceKey!);
      const lod = model.children.find((child): child is THREE.LOD => child instanceof THREE.LOD)!;
      for (let level = 0; level < 3; level++) {
        const selectedRig = rig.lodRigs![level]!;
        const selectedLod = lod.levels[level]!.object;
        lod.levels.forEach((item, index) => { item.object.visible = index === level; });
        const frames: number[][] = [];
        const armAngles: number[][] = [];
        expect(isDescendant(selectedRig.weaponPivots.main!, selectedRig.joints["arm.right"]!)).toBe(true);

        for (const elapsedSeconds of sampleTimes) {
          applyHeroPreviewMotion(selectedRig, model, "attack", elapsedSeconds, false);
          frames.push(vertexPositions(selectedLod));
          armAngles.push([
            selectedRig.joints["arm.right"]!.rotation.x,
            selectedRig.joints["arm.right"]!.rotation.z,
            selectedRig.weaponPivots.main!.rotation.x,
            selectedRig.weaponPivots.main!.rotation.z,
          ]);
          if (heroId === "F01")
            expect(weaponPenetratesBody(selectedRig.weaponPivots.main!, selectedRig.joints.torso!)).toBe(false);
        }

        expect(maximumDisplacement(frames[0]!, frames[1]!)).toBeGreaterThan(0.1);
        expect(maximumDisplacement(frames[1]!, frames[2]!)).toBeGreaterThan(0.12);
        expect(maximumDisplacement(frames[2]!, frames[3]!)).toBeGreaterThan(0.12);
        expect(frames[0]).toEqual(frames[4]);
        expect(maximumDisplacement(armAngles[1]!, armAngles[2]!)).toBeGreaterThan(0.2);
        expect(maximumDisplacement(armAngles[2]!, armAngles[3]!)).toBeGreaterThan(0.2);
      }
    }
  });

  it("shows hit recoil and later arm/cape recovery, then restores the neutral pose at every LOD", () => {
    const sampleTimes = [0, 0.2, 0.4, 0.6, 0.8];
    for (const heroId of ["F01", "R01"]) {
      const model = new THREE.Group();
      const entity = previewEntity(heroId);
      const rig = buildBattlefieldHero(model, entity, 0x71847b, entity.appearanceKey!);
      const lod = model.children.find((child): child is THREE.LOD => child instanceof THREE.LOD)!;
      for (let level = 0; level < 3; level++) {
        const selectedRig = rig.lodRigs![level]!;
        const selectedLod = lod.levels[level]!.object;
        lod.levels.forEach((item, index) => { item.object.visible = index === level; });
        const frames: number[][] = [];
        const capeFrames: number[][] = [];
        const armFrames: number[][] = [];
        for (const elapsedSeconds of sampleTimes) {
          applyHeroPreviewMotion(selectedRig, model, "hit", elapsedSeconds, false);
          frames.push(vertexPositions(selectedLod));
          if (selectedRig.joints.cape) capeFrames.push(vertexPositions(selectedRig.joints.cape));
          armFrames.push(vertexPositions(selectedRig.joints["arm.right"]!));
        }
        expect(maximumDisplacement(frames[0]!, frames[2]!)).toBeGreaterThan(0.12);
        if (capeFrames.length) expect(maximumDisplacement(capeFrames[0]!, capeFrames[2]!)).toBeGreaterThan(0.12);
        expect(maximumDisplacement(armFrames[0]!, armFrames[2]!)).toBeGreaterThan(0.08);
        expect(maximumDisplacement(frames[2]!, frames[3]!)).toBeGreaterThan(0.025);
        expect(frames[0]).toEqual(frames[4]);
      }
    }
  });
});
