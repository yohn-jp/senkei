import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DisplayEntity } from "@senkei/replay-contract";
import {
  buildBattlefieldBase,
  buildBattlefieldBridge,
  buildBattlefieldTower,
  buildMidObservatory,
  battlefieldStructureDamageStage,
} from "./battlefield-architecture";

function entity(overrides: Partial<DisplayEntity> = {}): DisplayEntity {
  return {
    id: "facility-test",
    side: "neutral",
    kind: "bridge",
    archetype: "bridge",
    appearanceKey: "bridge",
    position: { x: 8, y: 12 },
    hp: 500,
    maxHp: 500,
    destroyed: false,
    ...overrides,
  };
}

describe("Battlefield architectural models", () => {
  it("distinguishes site knowledge from normal, expanded and destroyed bridge geometry", () => {
    const scene = new THREE.Scene();
    const route = {
      id: "bridge.MID.A",
      region: "bridge",
      bridgeSite: "world.bridge.mid" as const,
      bridgeKind: "facility" as const,
      points: [{ x: 4, y: 0 }, { x: 0, y: 0 }] as const,
    };
    const bridge = buildBattlefieldBridge(scene, route, 0.8, { x: 0, y: 0 });
    const centerDeck = bridge.group.getObjectByName(`${bridge.group.name}-center-deck`)!;
    const sideDeck = bridge.group.getObjectByName(`${bridge.group.name}-expanded-side-decks`)!;
    const piers = bridge.group.getObjectByName(`${bridge.group.name}-piers-and-abutments`)!;
    const broken = bridge.group.getObjectByName(`${bridge.group.name}-broken-water-gap`)!;
    const scaffold = bridge.group.getObjectByName(`${bridge.group.name}-work-scaffold`)!;
    const beam = bridge.group.getObjectByName(`${scaffold.name}-animated-beam`)!;

    expect(piers.children.length).toBeGreaterThan(0);
    expect(centerDeck.visible).toBe(false);
    expect(sideDeck.visible).toBe(false);
    expect(broken.visible).toBe(false);
    expect(bridge.group.userData.state).toBe("unknown");
    expect(bridge.group.userData.site).toBe("world.bridge.mid");
    expect(bridge.group.position.x).toBeCloseTo(3.26);

    bridge.setWork(12, 3, "bridge.MID");
    const firstBeamAngle = beam.rotation.z;
    expect(scaffold.visible).toBe(true);
    expect(bridge.group.userData.buildRemaining).toBe(12);
    expect(bridge.group.userData.state).toBe("unknown");
    bridge.setWork(12, 4, "bridge.MID");
    expect(beam.rotation.z).not.toBe(firstBeamAngle);
    bridge.setWork(0, 5, "bridge.MID");
    expect(scaffold.visible).toBe(false);
    expect(bridge.group.userData.buildRemaining).toBeUndefined();
    expect(bridge.group.userData.state).toBe("unknown");

    bridge.setState("normal");
    expect(centerDeck.visible).toBe(true);
    expect(sideDeck.visible).toBe(false);
    expect(bridge.group.userData.openWaterGap).toBe(false);

    bridge.setIntegrity?.("damaged");
    const fractures = bridge.group.getObjectByName(`${bridge.group.name}-timber-fractures`)!;
    expect(bridge.group.userData.damageStage).toBe("damaged");
    expect(fractures.visible).toBe(true);
    expect(fractures.children.filter((child) => child.visible)).toHaveLength(1);
    expect(centerDeck.visible).toBe(true);

    bridge.setState("expanded");
    expect(centerDeck.visible).toBe(true);
    expect(sideDeck.visible).toBe(true);
    expect(bridge.group.getObjectByName(`${bridge.group.name}-expanded-rails`)?.visible).toBe(true);
    bridge.setIntegrity?.("critical");
    expect(fractures.children.filter((child) => child.visible)).toHaveLength(6);
    expect(centerDeck.visible).toBe(true);
    expect(sideDeck.visible).toBe(true);

    bridge.setState("destroyed");
    expect(centerDeck.visible).toBe(false);
    expect(sideDeck.visible).toBe(false);
    expect(broken.visible).toBe(true);
    expect(bridge.group.userData.openWaterGap).toBe(true);
    expect(bridge.group.userData.damageStage).toBe("destroyed");
    expect(fractures.visible).toBe(false);
    bridge.dispose();
  });

  it("does not infer facility geometry from the site ID", () => {
    const scene = new THREE.Scene();
    const route = {
      id: "authored-lane",
      region: "bridge",
      bridgeSite: "world.bridge.mid" as const,
      bridgeKind: "lane" as const,
      points: [{ x: 4, y: 0 }, { x: 0, y: 0 }] as const,
    };
    const bridge = buildBattlefieldBridge(scene, route, 0.8, { x: 0, y: 0 });
    expect(bridge.group.userData.site).toBe("world.bridge.mid");
    expect(bridge.group.position.x).toBeCloseTo(2);
    bridge.dispose();
  });

  it("builds a high silhouette tower and fortress distinct from unit-scale geometry", () => {
    const scene = new THREE.Scene();
    const tower = buildBattlefieldTower(scene, entity({ id: "tower-a", side: "azure", kind: "tower", archetype: "tower", hp: 500, maxHp: 500 }));
    const fortress = buildBattlefieldBase(scene, entity({ id: "base-a", side: "azure", kind: "base", archetype: "base" }));
    expect(tower.getObjectByName("azure-battlefield-tower-tower-a-bastion-shaft")).toBeDefined();
    expect(tower.getObjectByName("azure-battlefield-tower-tower-a-standard-cloth")).toBeDefined();
    expect(tower.getObjectByName("azure-battlefield-tower-tower-a-buttress-0")).toBeDefined();
    expect(tower.userData.damageStage).toBe("intact");
    expect(fortress.getObjectByName("azure-battlefield-fortress-base-a-keep-hall")).toBeDefined();
    expect(fortress.getObjectByName("azure-battlefield-fortress-base-a-walltower--3.18--3.17")).toBeDefined();
    expect(fortress.position.toArray()).toEqual([8, 0, 12]);
    expect(tower.position.toArray()).toEqual([0, 0, 0]);

    const damagedFortress = buildBattlefieldBase(scene, entity({ id: "base-damaged", side: "vermilion", kind: "base", archetype: "base", hp: 300, maxHp: 500 }));
    expect(damagedFortress.userData.damageStage).toBe("damaged");
    expect(damagedFortress.getObjectByName("vermilion-battlefield-fortress-base-damaged-keep-impact-scar")).toBeDefined();
    expect(damagedFortress.getObjectByName("vermilion-battlefield-fortress-base-damaged-breached-gate-rubble")).toBeUndefined();

    const criticalFortress = buildBattlefieldBase(scene, entity({ id: "base-critical", side: "vermilion", kind: "base", archetype: "base", hp: 100, maxHp: 500 }));
    expect(criticalFortress.userData.damageStage).toBe("critical");
    expect(criticalFortress.getObjectByName("vermilion-battlefield-fortress-base-critical-gate-door")?.visible).toBe(false);
    expect(criticalFortress.getObjectByName("vermilion-battlefield-fortress-base-critical-breached-gate-rubble")).toBeDefined();
    expect(criticalFortress.getObjectByName("vermilion-battlefield-fortress-base-critical-keep-standard-cloth")).toBeUndefined();

    const worn = buildBattlefieldTower(scene, entity({ id: "tower-worn", kind: "tower", archetype: "tower", hp: 300, maxHp: 500 }));
    expect(worn.userData.damageStage).toBe("damaged");
    expect(worn.getObjectByName("neutral-battlefield-tower-tower-worn-impact-scar")).toBeDefined();
    expect(worn.getObjectByName("neutral-battlefield-tower-tower-worn-collapse-rubble-0")).toBeUndefined();

    const critical = buildBattlefieldTower(scene, entity({ id: "tower-critical", kind: "tower", archetype: "tower", hp: 100, maxHp: 500 }));
    expect(critical.userData.damageStage).toBe("critical");
    expect(critical.getObjectByName("neutral-battlefield-tower-tower-critical-impact-scar")).toBeDefined();
    expect(critical.getObjectByName("neutral-battlefield-tower-tower-critical-collapse-rubble-0")).toBeDefined();
    expect(critical.getObjectByName("neutral-battlefield-tower-tower-critical-standard-cloth")).toBeUndefined();

    const noVitals = buildBattlefieldTower(scene, entity({ id: "tower-no-vitals", kind: "tower", archetype: "tower", hp: 0, maxHp: 0 }));
    expect(noVitals.userData.damageStage).toBe("unknown");
    const noVitalsFortress = buildBattlefieldBase(scene, entity({ id: "base-no-vitals", kind: "base", archetype: "base", hp: 0, maxHp: 0 }));
    expect(noVitalsFortress.userData.damageStage).toBe("unknown");
    expect(noVitalsFortress.getObjectByName("neutral-battlefield-fortress-base-no-vitals-keep-impact-scar")).toBeUndefined();
    expect(battlefieldStructureDamageStage(entity({ hp: 0, maxHp: 500, destroyed: false }))).toBe("critical");
    expect(battlefieldStructureDamageStage(entity({ hp: 0, maxHp: 500, destroyed: true }))).toBe("destroyed");
  });

  it("reads MID owner and capture progress from the currently visible Replay entity", () => {
    const scene = new THREE.Scene();
    const mid = buildMidObservatory(scene, { x: 0, y: 0 }, [{ x: 3.6, y: 0 }, { x: -3.6, y: 0 }], 8);
    expect(mid.group.name).toBe("mid-observation-objective");
    expect(mid.group.getObjectByName("mid-island-wall-1")).toBeDefined();
    expect(mid.group.getObjectByName("mid-island-bridge-gate-0")).toBeDefined();
    expect(mid.group.userData.state).toBe("unknown");
    expect(mid.group.userData.owner).toBeUndefined();
    expect(mid.group.userData.contested).toBeUndefined();
    const beacon = mid.group.getObjectByName("mid-observatory-beacon-crystal") as THREE.Mesh;
    const ownerBanner = mid.group.getObjectByName("mid-observatory-owner-standard")!;
    const progressRing = mid.group.getObjectByName("mid-observatory-capture-ring") as THREE.Mesh<THREE.TorusGeometry>;
    const contestedRing = mid.group.getObjectByName("mid-observatory-contested-ring") as THREE.Mesh<THREE.TorusGeometry>;
    const azureStandard = mid.group.getObjectByName("mid-observatory-contested-standard-azure")!;
    const vermilionStandard = mid.group.getObjectByName("mid-observatory-contested-standard-vermilion")!;
    expect(progressRing.visible).toBe(false);
    expect(contestedRing.visible).toBe(false);
    expect((beacon.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.04);

    mid.update(entity({
      id: "obs-owner-unknown",
      kind: "observation",
      archetype: "observation",
      battlefield: { captureProgress: 0 },
    }));
    expect(mid.group.userData.state).toBe("visible");
    expect(mid.group.userData.owner).toBeUndefined();
    expect(ownerBanner.visible).toBe(false);

    mid.update(entity({
      id: "obs",
      kind: "observation",
      archetype: "observation",
      battlefield: { facilityOwner: "neutral", captureProgress: 0 },
    }));
    expect(mid.group.userData.state).toBe("visible");
    expect(progressRing.visible).toBe(false);
    expect(ownerBanner.visible).toBe(false);
    expect((beacon.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x8f9a8a);
    expect((beacon.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.3);

    mid.update(entity({
      id: "obs",
      kind: "observation",
      archetype: "observation",
      battlefield: { facilityOwner: "neutral", captureSide: "azure", captureProgress: 7 },
    }));
    expect(mid.group.userData.state).toBe("capturing");
    expect(mid.group.userData.owner).toBe("neutral");
    expect(mid.group.userData.captureSide).toBe("azure");
    expect(mid.group.userData.captureProgress).toBe(7);
    expect(progressRing.visible).toBe(true);
    expect(progressRing.position.y).toBeGreaterThan(2.2);
    expect(progressRing.geometry.parameters.radius).toBeCloseTo(1.25);
    expect(progressRing.geometry.parameters.arc).toBeCloseTo(2 * Math.PI * 7 / 8);
    expect((progressRing.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x4d9fa4);
    expect((beacon.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.5);

    mid.update(entity({
      id: "obs",
      kind: "observation",
      archetype: "observation",
      battlefield: { facilityOwner: "azure", captureProgress: 0 },
    }));
    expect(mid.group.userData.state).toBe("visible");
    expect(progressRing.visible).toBe(false);
    expect(ownerBanner.visible).toBe(true);
    expect((beacon.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x4d9fa4);

    mid.update(entity({
      id: "obs",
      kind: "observation",
      archetype: "observation",
      battlefield: { facilityOwner: "azure", captureSide: "vermilion", captureProgress: 7 },
    }), true);
    expect(mid.group.userData.state).toBe("contested");
    expect(mid.group.userData.owner).toBe("azure");
    expect(contestedRing.visible).toBe(true);
    expect(ownerBanner.visible).toBe(false);
    expect(azureStandard.visible).toBe(true);
    expect(vermilionStandard.visible).toBe(true);
    expect((beacon.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xd4a756);
    expect((contestedRing.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0xd4a756);

    mid.update(undefined);
    expect(mid.group.userData.state).toBe("unknown");
    expect(mid.group.userData.owner).toBeUndefined();
    expect(mid.group.userData.captureProgress).toBeUndefined();
    expect(mid.group.userData.contested).toBeUndefined();
    expect(progressRing.visible).toBe(false);
    expect(contestedRing.visible).toBe(false);
    expect(ownerBanner.visible).toBe(false);
    expect(azureStandard.visible).toBe(false);
    expect(vermilionStandard.visible).toBe(false);
    expect((beacon.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.04);
    mid.dispose();
  });
});
