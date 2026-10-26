import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DisplayEntity } from "@senkei/replay-contract";
import {
  buildBattlefieldHero,
  buildBattlefieldMinion,
  buildBattlefieldMonster,
} from "./battlefield-units";
import { battlefieldUnitLodLevel } from "./battlefield-unit-geometry";

function entity(id: string, appearanceKey: string, catalogId?: string): DisplayEntity {
  return {
    id,
    side: "azure",
    kind: "unit",
    archetype: "hero",
    appearanceKey,
    position: { x: 0, y: 0 },
    hp: 100,
    maxHp: 100,
    destroyed: false,
    ...(catalogId ? { catalogId } : {}),
  };
}

function lodLevels(group: THREE.Group): THREE.Group[] {
  const lod = group.getObjectByName(`${group.name}.lod`);
  expect(lod).toBeInstanceOf(THREE.LOD);
  return (lod as THREE.LOD).levels.map(({ object }) => object as THREE.Group);
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root.traverse(object => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}

function minimumWorldY(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  let minimum = Infinity;
  for (const mesh of meshes(root)) {
    const positions = mesh.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const y = mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, index)).y;
      minimum = Math.min(minimum, y);
    }
  }
  return minimum;
}

function silhouetteBounds(root: THREE.Object3D): string {
  root.updateMatrixWorld(true);
  return meshes(root).map(mesh => {
    const bounds = new THREE.Box3().setFromObject(mesh);
    return [...bounds.min.toArray(), ...bounds.max.toArray()].map(value => Math.round(value * 100) / 100).join(",");
  }).sort().join(";");
}

function worldBounds(root: THREE.Object3D): THREE.Box3 {
  let sceneRoot = root;
  while (sceneRoot.parent) sceneRoot = sceneRoot.parent;
  sceneRoot.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

interface CapeVertexRange {
  startVertex: number;
  vertexCount: number;
}

function capeVertices(level: THREE.Group, world = false): THREE.Vector3[] {
  level.updateMatrixWorld(true);
  const cape = level.getObjectByName("joint.cape");
  if (cape) {
    const capeMeshes = meshes(cape);
    if (capeMeshes.length) return capeMeshes.flatMap(mesh => {
      const positions = mesh.geometry.getAttribute("position");
      return Array.from({ length: positions.count }, (_, index) => {
        const point = new THREE.Vector3().fromBufferAttribute(positions, index);
        return world ? mesh.localToWorld(point) : point;
      });
    });
  }

  return meshes(level).flatMap(mesh => {
    const ranges = mesh.geometry.userData.bakedCapeRanges as CapeVertexRange[] | undefined;
    if (!ranges) return [];
    const positions = mesh.geometry.getAttribute("position");
    return ranges.flatMap(({ startVertex, vertexCount }) =>
      Array.from({ length: vertexCount }, (_, offset) => {
        const point = new THREE.Vector3().fromBufferAttribute(positions, startVertex + offset);
        return world ? mesh.localToWorld(point) : point;
      }),
    );
  });
}

describe("Battlefield unit models", () => {
  it("keeps focused targets detailed while reducing untracked LOD by screen occupancy", () => {
    expect(battlefieldUnitLodLevel(10, true, false)).toBe(0);
    expect(battlefieldUnitLodLevel(75.9, false, true)).toBe(0);
    expect(battlefieldUnitLodLevel(17.9, false, true)).toBe(2);
    expect(battlefieldUnitLodLevel(18, false, true)).toBe(1);
    expect(battlefieldUnitLodLevel(127.9, false, false)).toBe(1);
    expect(battlefieldUnitLodLevel(49.9, false, false)).toBe(2);
    expect(battlefieldUnitLodLevel(128, false, false)).toBe(0);
    expect(battlefieldUnitLodLevel(50, false, false)).toBe(1);
  });

  it("builds twelve Atelier identities with articulated rig anchors and bounded LOD draw calls", () => {
    const identities = ["f01", "f02", "f03", "f04", "f05", "f06", "r01", "r02", "r03", "r04", "r05", "r06"];
    const names = new Set<string>();
    for (const id of identities) {
      const group = new THREE.Group();
      const rig = buildBattlefieldHero(group, entity(id, `senkei.next.hero.${id}`, id.toUpperCase()), 0x347e83, `senkei.next.hero.${id}`);
      names.add(group.userData.heroName);
      const levels = lodLevels(group);
      expect(levels).toHaveLength(3);
      expect(levels[0].name).toContain(".full");
      expect(levels[1].name).toContain(".medium");
      expect(levels[2].name).toContain(".far");
      expect(meshes(levels[0]).length).toBeGreaterThan(8);
      // Reduced rigs merge surfaces/decorations into the major moving regions.
      expect(meshes(levels[0]).length).toBeLessThanOrEqual(60);
      expect(meshes(levels[1]).length).toBeLessThanOrEqual(8);
      expect(meshes(levels[2]).length).toBeLessThanOrEqual(8);
      expect(minimumWorldY(levels[0]), `${id} neutral pose stays above the ground`).toBeGreaterThanOrEqual(-0.025);
      expect(rig.joints.torso).toBeInstanceOf(THREE.Group);
      expect(rig.joints.head).toBeInstanceOf(THREE.Group);
      expect(rig.weaponPivots.main).toBeInstanceOf(THREE.Group);
      expect(rig.restPose?.torso).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }));
      expect(rig.restPose?.["weapon.main"]).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }));
      expect(rig.anchors.head).toBeInstanceOf(THREE.Group);
      expect(group.getObjectByName(rig.joints.torso.name)).toBe(rig.joints.torso);
      const fullArmor = meshes(levels[0]).find(mesh => mesh.userData.unitSurface === "armor");
      const midBaked = meshes(levels[1]).find(mesh => mesh.userData.unitSurface === "baked");
      const farBaked = meshes(levels[2]).find(mesh => mesh.userData.unitSurface === "baked");
      expect(fullArmor).toBeDefined();
      expect(midBaked?.material).toBeDefined();
      expect(farBaked?.material).toBe(midBaked?.material);
      expect(midBaked?.material).not.toBe(fullArmor?.material);
      for (const mesh of meshes(levels[0])) {
        expect(mesh.castShadow).toBe(true);
        expect(mesh.receiveShadow).toBe(true);
        expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
      for (const level of levels.slice(1))
        expect(meshes(level).every(mesh => !mesh.castShadow), `${id} reduced LOD skips the shadow-map pass`).toBe(true);
    }
    expect(names).toHaveProperty("size", 12);
  });

  it("gives golden capes a tapered, waved cloth silhouette in all LODs without body or hand penetration", () => {
    for (const id of ["F01", "R01"]) {
      const root = new THREE.Group();
      const key = `senkei.next.hero.${id.toLowerCase()}`;
      const rig = buildBattlefieldHero(root, entity(id, key, id), 0x347e83, key);
      const levels = lodLevels(root);
      expect(levels).toHaveLength(3);
      for (const [levelIndex, level] of levels.entries()) {
        const points = capeVertices(level);
        expect(points.length, `${id} LOD ${levelIndex} has cape vertices`).toBeGreaterThan(0);
        if (levelIndex === 0) {
          const capeMesh = meshes(level.getObjectByName("joint.cape")!)[0];
          expect((capeMesh.material as THREE.MeshStandardMaterial).roughness).toBe(0.92);
          expect((capeMesh.material as THREE.MeshStandardMaterial).metalness).toBe(0.02);
        } else {
          const capeMesh = meshes(level).find(mesh => mesh.geometry.userData.bakedCapeRanges);
          expect(capeMesh).toBeDefined();
          const response = capeMesh!.geometry.getAttribute("senkeiSurfaceResponse");
          const ranges = capeMesh!.geometry.userData.bakedCapeRanges as CapeVertexRange[];
          for (const { startVertex, vertexCount } of ranges) for (let index = startVertex; index < startVertex + vertexCount; index++) {
            expect(response.getX(index)).toBeCloseTo(0.92);
            expect(response.getY(index)).toBeCloseTo(0.02);
            expect(response.getZ(index)).toBe(0);
          }
        }
        const top = points.filter(point => point.y > 1.8);
        const middle = points.filter(point => point.y > 0.9 && point.y < 1.25);
        const hem = points.filter(point => point.y < 0.8);
        const halfWidth = (vertices: readonly THREE.Vector3[]) => Math.max(...vertices.map(point => Math.abs(point.x)));
        expect(Math.min(...points.map(point => point.y)), `${id} LOD ${levelIndex} hem clears the lower legs`).toBeGreaterThan(0.52);
        expect(halfWidth(middle), `${id} LOD ${levelIndex} flares below the shoulder`).toBeGreaterThan(halfWidth(top) * 1.35);
        expect(halfWidth(middle), `${id} LOD ${levelIndex} tapers toward the hem`).toBeGreaterThan(halfWidth(hem) * 1.03);

        const centerHem = hem.filter(point => Math.abs(point.x) < 0.06).map(point => point.y);
        const outerTails = hem.filter(point => Math.abs(point.x) > 0.08 && Math.abs(point.x) < 0.3).map(point => point.y);
        expect(centerHem.length).toBeGreaterThan(0);
        expect(outerTails.length).toBeGreaterThan(0);
        expect(Math.min(...centerHem), `${id} LOD ${levelIndex} has a lifted central notch`).toBeGreaterThan(Math.min(...outerTails) + 0.12);
        const midBackFold = points.filter(point => Math.abs(point.y - 1.22) < 1e-6);
        expect(Math.max(...midBackFold.map(point => point.z)) - Math.min(...midBackFold.map(point => point.z)), `${id} LOD ${levelIndex} has broad vertical folds`).toBeGreaterThan(0.14);
        expect(Math.max(...points.map(point => point.z)) - Math.min(...points.map(point => point.z)), `${id} LOD ${levelIndex} has a swept rear drape`).toBeGreaterThan(0.38);

        const worldPoints = capeVertices(level, true);
        const torso = rig.lodRigs![levelIndex].joints.torso;
        const torsoBack = worldBounds(torso).min.z;
        const capeAboveWaist = worldPoints.filter(point => point.y < 1.7);
        expect(Math.max(...capeAboveWaist.map(point => point.z)), `${id} LOD ${levelIndex} cloth stays behind the torso`).toBeLessThan(torsoBack - 0.02);
        if (levelIndex === 0) {
          const hand = rig.lodRigs![levelIndex].joints["hand.right"];
          const handBounds = worldBounds(hand);
          const capeBehindHand = worldPoints.filter(point =>
            point.x >= handBounds.min.x && point.x <= handBounds.max.x &&
            point.y >= handBounds.min.y && point.y <= handBounds.max.y,
          );
          expect(capeBehindHand.length).toBeGreaterThan(0);
          expect(Math.max(...capeBehindHand.map(point => point.z)), `${id} cape stays behind the hand at overlapping height`).toBeLessThan(handBounds.min.z - 0.01);
        }
        if (levelIndex > 0) expect(meshes(level).length, `${id} LOD ${levelIndex} stays within the low mesh budget`).toBeLessThanOrEqual(8);
      }
      if (id === "R01") {
        for (const side of ["left", "right"]) {
          const arm = rig.joints[`arm.${side}`];
          expect(arm.children.some(child => child instanceof THREE.Mesh && child.userData.unitSurface === "armor")).toBe(false);
        }
        const chest = root.getObjectByName("armor.chest")!;
        expect(meshes(chest).some(mesh => mesh.userData.unitSurface === "armor")).toBe(false);
        const tunic = chest.getObjectByName("armor.chest.cloth") as THREE.Mesh;
        tunic.geometry.computeBoundingBox();
        expect(tunic.geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBeGreaterThan(0.4);
      }
    }
  });

  it("retains per-surface material response in the R01 reduced LODs within the draw budget", () => {
    const root = new THREE.Group();
    const key = "senkei.next.hero.r01";
    buildBattlefieldHero(root, entity("R01", key, "R01"), 0x347e83, key);
    const levels = lodLevels(root);
    const baked = levels.slice(1).map(level => meshes(level));
    const expected = ["0.52,0.36,0", "0.92,0.02,0", "0.82,0.02,0", "0.78,0,0", "0.3,0.1,1"];

    expect(baked[0].length).toBeLessThanOrEqual(8);
    expect(baked[1].length).toBeLessThanOrEqual(8);
    const sharedBakedMaterial = baked[0][0].material as THREE.MeshStandardMaterial;
    expect(sharedBakedMaterial).toBe(baked[1][0].material);
    expect(sharedBakedMaterial.side).toBe(THREE.DoubleSide);
    expect(sharedBakedMaterial.customProgramCacheKey()).toBe("senkei.baked-unit-surface-response.v1");

    for (const reducedMeshes of baked) {
      const responses = new Set<string>();
      for (const mesh of reducedMeshes) {
        expect(mesh.userData.unitSurface).toBe("baked");
        expect(mesh.material).toBe(sharedBakedMaterial);
        const response = mesh.geometry.getAttribute("senkeiSurfaceResponse");
        expect(response).toBeDefined();
        expect(response.count).toBe(mesh.geometry.getAttribute("position").count);
        for (let index = 0; index < response.count; index++) {
          responses.add([
            response.getX(index), response.getY(index), response.getZ(index),
          ].map(value => Math.round(value * 100) / 100).join(","));
        }
      }
      for (const surfaceResponse of expected) expect(responses).toContain(surfaceResponse);
    }

    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as Parameters<typeof sharedBakedMaterial.onBeforeCompile>[0];
    sharedBakedMaterial.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("attribute vec3 senkeiSurfaceResponse;");
    expect(shader.vertexShader).toContain("vSenkeiSurfaceResponse = senkeiSurfaceResponse;");
    expect(shader.fragmentShader).toContain("roughnessFactor = clamp(vSenkeiSurfaceResponse.x, 0.04, 1.0);");
    expect(shader.fragmentShader).toContain("metalnessFactor = clamp(vSenkeiSurfaceResponse.y, 0.0, 1.0);");
    expect(shader.fragmentShader).toContain("totalEmissiveRadiance = emissive * vSenkeiSurfaceResponse.z;");
  });

  it("keeps F01's command cuirass integrated and angles its sword clear of the torso", () => {
    const root = new THREE.Group();
    const rig = buildBattlefieldHero(root, entity("F01", "senkei.next.hero.f01", "F01"), 0x347e83, "senkei.next.hero.f01");
    const chest = root.getObjectByName("armor.chest")!;
    const armor = chest.getObjectByName("armor.chest.armor") as THREE.Mesh;
    const positions = armor.geometry.getAttribute("position");
    const centerBottom = Math.min(...Array.from({ length: positions.count }, (_, index) => ({
      x: positions.getX(index), y: positions.getY(index),
    })).filter(point => Math.abs(point.x) < 1e-5).map(point => point.y));
    expect(centerBottom, "the chest crest should not end in a shield-like point").toBeGreaterThan(0.26);
    expect(rig.restPose?.["weapon.main"]?.z).toBeCloseTo(-0.32);

    const torso = rig.joints.torso.getObjectByName("joint.torso.leather")!;
    expect(worldBounds(rig.weaponPivots.main).max.x, "the sword should clear the breastplate's edge").toBeGreaterThan(worldBounds(torso).max.x);
  });

  it("keeps the golden mouth a narrow facial mark instead of a projecting block", () => {
    const root = new THREE.Group();
    const rig = buildBattlefieldHero(root, entity("F01", "senkei.next.hero.f01", "F01"), 0x347e83, "senkei.next.hero.f01");
    const mouthColor = new THREE.Color(0x684c40);
    const mouth = new THREE.Box3();
    for (const mesh of meshes(rig.joints.head)) {
      const colors = mesh.geometry.getAttribute("color");
      const positions = mesh.geometry.getAttribute("position");
      for (let i = 0; i < colors.count; i++) if (Math.abs(colors.getX(i) - mouthColor.r) < 1e-6 && Math.abs(colors.getY(i) - mouthColor.g) < 1e-6) mouth.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, i));
    }
    expect(mouth.isEmpty()).toBe(false);
    expect(mouth.getSize(new THREE.Vector3()).x).toBeLessThan(0.13);
    expect(mouth.getSize(new THREE.Vector3()).y).toBeLessThan(0.02);
  });

  it("shares the common facet materials and exposes a reproducible appearance record", () => {
    const first = new THREE.Group();
    const second = new THREE.Group();
    buildBattlefieldHero(first, entity("first", "senkei.next.hero.f01", "F01"), 0x347e83, "senkei.next.hero.f01");
    buildBattlefieldHero(second, entity("second", "senkei.next.hero.f01", "F01"), 0x347e83, "senkei.next.hero.f01");
    const firstArmor = meshes(lodLevels(first)[0]).find(mesh => mesh.userData.unitSurface === "armor");
    const secondArmor = meshes(lodLevels(second)[0]).find(mesh => mesh.userData.unitSurface === "armor");
    expect(firstArmor?.material).toBe(secondArmor?.material);
    expect(first.userData.assetManifest).toEqual(expect.objectContaining({
      assetKey: "hero.f01",
      appearanceKey: "senkei.next.hero.f01",
      generator: "senkei.battlefield-unit.v1",
      generatorVersion: 6,
      lod: ["battlefield-hero-f01.full", "battlefield-hero-f01.medium", "battlefield-hero-f01.far"],
      source: "project-authored-procedural-geometry",
    }));
  });

  it("reproduces golden identities, rig transforms and every LOD geometry buffer", () => {
    for (const [id, name, weapon] of [["F01", "Bannerhold", "sword-shield"], ["R01", "Tempest", "staff"]]) {
      const build = () => {
        const group = new THREE.Group();
        const appearanceKey = `senkei.next.hero.${id.toLowerCase()}`;
        const rig = buildBattlefieldHero(group, entity(id, appearanceKey, id), 0x347e83, appearanceKey);
        group.updateMatrixWorld(true);
        return { group, rig };
      };
      const first = build();
      const second = build();
      expect(first.group.userData.heroName).toBe(name);
      expect(first.group.userData.heroWeapon).toBe(weapon);
      expect(first.group.userData.assetManifest).toEqual(second.group.userData.assetManifest);
      expect(first.rig.restPose).toEqual(second.rig.restPose);
      const firstLevels = lodLevels(first.group);
      const secondLevels = lodLevels(second.group);
      firstLevels.forEach((level, levelIndex) => {
        const firstMeshes = meshes(level);
        const secondMeshes = meshes(secondLevels[levelIndex]);
        expect(firstMeshes.map(mesh => mesh.name)).toEqual(secondMeshes.map(mesh => mesh.name));
        firstMeshes.forEach((mesh, meshIndex) => {
          const other = secondMeshes[meshIndex];
          expect(mesh.matrixWorld.elements).toEqual(other.matrixWorld.elements);
          expect(Object.keys(mesh.geometry.attributes)).toEqual(Object.keys(other.geometry.attributes));
          for (const attribute of ["position", "normal", "color"]) {
            const values = mesh.geometry.getAttribute(attribute).array;
            expect(Array.from(values).every(Number.isFinite), `${id} ${mesh.name} ${attribute}`).toBe(true);
            expect(values).toEqual(other.geometry.getAttribute(attribute).array);
          }
          expect(mesh.geometry.index?.array).toEqual(other.geometry.index?.array);
        });
      });
      for (const key of ["main", "off"]) {
        const pivot = first.rig.weaponPivots[key];
        expect(pivot.parent).toBe(first.rig.joints[`hand.${key === "main" ? "right" : "left"}`]);
      }
      const hand = first.rig.joints["hand.right"];
      const handMesh = hand.children.find(child => child instanceof THREE.Mesh)!;
      const weaponLeather = first.rig.weaponPivots.main.children.find(child => child instanceof THREE.Mesh && child.userData.unitSurface === "leather")!;
      expect(worldBounds(handMesh).intersectsBox(worldBounds(weaponLeather)), `${id} grip intersects the hand`).toBe(true);
    }
  });

  it("bends golden shins about the authored kneecaps while keeping the knee attached", () => {
    for (const id of ["F01", "R01"]) {
      const group = new THREE.Group();
      const key = `senkei.next.hero.${id.toLowerCase()}`;
      const rig = buildBattlefieldHero(group, entity(id, key, id), 0x347e83, key);
      for (const side of ["left", "right"]) {
        const leg = rig.joints[`leg.${side}`];
        const shin = rig.joints[`shin.${side}`];
        expect(shin.parent).toBe(leg);
        const kneeInLeg = new THREE.Vector3(0, -0.45, 0);
        expect(shin.position.distanceTo(kneeInLeg)).toBeLessThan(1e-8);
        group.updateMatrixWorld(true);
        const before = shin.getWorldPosition(new THREE.Vector3());
        shin.rotation.x += 0.4;
        group.updateMatrixWorld(true);
        expect(shin.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-8);
        expect(leg.localToWorld(kneeInLeg).distanceTo(before)).toBeLessThan(1e-8);
      }
    }
  });

  it("gives each Hero an authored stance and a distinct shape signature independent of palette colors", () => {
    const identities = ["f01", "f02", "f03", "f04", "f05", "f06", "r01", "r02", "r03", "r04", "r05", "r06"];
    const stances = new Set<string>();
    const silhouettes = new Set<string>();
    const bodyProfiles = new Set<string>();
    const bodyContours = new Set<string>();
    const chestStyles = new Set<string>();
    const chestContours = new Set<string>();
    for (const id of identities) {
      const group = new THREE.Group();
      const rig = buildBattlefieldHero(group, entity(id, `senkei.next.hero.${id}`, id.toUpperCase()), 0xffffff, `senkei.next.hero.${id}`);
      const chest = group.getObjectByName("armor.chest");
      stances.add(JSON.stringify(rig.restPose));
      silhouettes.add(silhouetteBounds(lodLevels(group)[0]));
      bodyProfiles.add(String(group.userData.heroBodyProfile));
      bodyContours.add(silhouetteBounds(rig.joints.torso));
      expect(chest).toBeInstanceOf(THREE.Group);
      chestStyles.add(String(chest?.userData.chestStyle));
      chestContours.add(silhouetteBounds(chest!));
    }
    expect(stances.size).toBe(12);
    expect(silhouettes.size).toBe(12);
    expect(bodyProfiles.size).toBe(12);
    expect(bodyContours.size).toBe(12);
    expect(chestStyles.size).toBe(12);
    expect(chestContours.size).toBe(12);
  });

  it("preserves R04's halo as weapon geometry through its full model", () => {
    const weaponGeometry = (id: string) => {
      const group = new THREE.Group();
      const rig = buildBattlefieldHero(group, entity(id, `senkei.next.hero.${id.toLowerCase()}`, id), 0x347e83, `senkei.next.hero.${id.toLowerCase()}`);
      const pivot = rig.weaponPivots.main;
      return meshes(pivot).reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count, 0);
    };
    expect(weaponGeometry("R04")).toBeGreaterThan(weaponGeometry("R01"));
  });

  it("keeps paired Hero blades clear of the torso silhouette", () => {
    for (const id of ["F04", "R03"]) {
      const group = new THREE.Group();
      const rig = buildBattlefieldHero(group, entity(id, `senkei.next.hero.${id.toLowerCase()}`, id), 0x347e83, `senkei.next.hero.${id.toLowerCase()}`);
      const torsoSurface = rig.joints.torso.getObjectByName("joint.torso.leather");
      expect(torsoSurface).toBeInstanceOf(THREE.Mesh);
      const torsoBounds = worldBounds(torsoSurface!);
      const mainBlade = worldBounds(rig.weaponPivots.main);
      const offBlade = worldBounds(rig.weaponPivots.off);
      expect(mainBlade.max.x, `${id} right-hand blade clears the torso`).toBeGreaterThan(torsoBounds.max.x);
      expect(offBlade.min.x, `${id} left-hand blade clears the torso`).toBeLessThan(torsoBounds.min.x);
      expect(mainBlade.max.x - offBlade.min.x, `${id} paired weapon span`).toBeGreaterThan(0.9);
    }

    const farSilhouetteWidth = (id: string) => {
      const group = new THREE.Group();
      buildBattlefieldHero(group, entity(id, `senkei.next.hero.${id.toLowerCase()}`, id), 0x347e83, `senkei.next.hero.${id.toLowerCase()}`);
      return worldBounds(lodLevels(group)[2]).getSize(new THREE.Vector3()).x;
    };
    expect(farSilhouetteWidth("F04"), "F04 retains both blades in its far LOD").toBeGreaterThan(farSilhouetteWidth("F05") + 0.04);
  });

  it("keeps melee, ranged and siege Minions visually distinct with a compact shared-material far LOD", () => {
    const kinds = ["melee", "ranged", "siege"];
    const signaturesByLevel = [new Set<string>(), new Set<string>(), new Set<string>()];
    const groups = kinds.map(kind => {
      const group = new THREE.Group();
      const rig = buildBattlefieldMinion(group, entity(kind, `minion-${kind}`, `minion-${kind}`), 0x347e83, `minion-${kind}`);
      const levels = lodLevels(group);
      expect(levels).toHaveLength(3);
      levels.forEach((level, index) => {
        signaturesByLevel[index].add(silhouetteBounds(level));
        if (index > 0) expect(meshes(level).length).toBeLessThanOrEqual(8);
      });
      expect(minimumWorldY(levels[0])).toBeGreaterThanOrEqual(-0.025);
      expect(rig.anchors.head).toBeInstanceOf(THREE.Group);
      expect(rig.weaponPivots.main).toBeInstanceOf(THREE.Group);
      return { group, levels };
    });
    expect(signaturesByLevel.map(signatures => signatures.size)).toEqual([3, 3, 3]);
    expect(new Set(groups.map(({ group }) => group.userData.unitClass)).size).toBe(3);
    const silhouetteComplexity = groups.map(({ levels }) => meshes(levels[0]).reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count, 0));
    expect(new Set(silhouetteComplexity).size).toBe(3);
    expect(groups[2].group.name).toContain("siege");
  });

  it("keeps three neutral monster silhouettes on separate LOD models", () => {
    const signaturesByLevel = [new Set<string>(), new Set<string>(), new Set<string>()];
    for (const species of ["grove-brute", "iron-warden", "storm-stalker"]) {
      const group = new THREE.Group();
      const rig = buildBattlefieldMonster(group, entity(species, species, `monster-${species}`), species);
      const levels = lodLevels(group);
      levels.forEach((level, index) => signaturesByLevel[index].add(silhouetteBounds(level)));
      expect(group.userData.species).toBe(species);
      expect(levels).toHaveLength(3);
      expect(meshes(levels[1]).length).toBeLessThanOrEqual(9);
      expect(meshes(levels[2]).length).toBeLessThanOrEqual(9);
      expect(minimumWorldY(levels[0])).toBeGreaterThanOrEqual(-0.025);
      expect(rig.joints.head).toBeInstanceOf(THREE.Group);
      expect(rig.anchors.head).toBeInstanceOf(THREE.Group);
    }
    expect(signaturesByLevel.map(signatures => signatures.size)).toEqual([3, 3, 3]);
  });
});
