import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DisplayEntity } from "@senkei/replay-contract";
import {
  buildBattlefieldBase,
  buildBattlefieldBridge,
  buildBattlefieldTower,
  buildMidObservatory,
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
      bridgeSite: "MID" as const,
      points: [{ x: 4, y: 0 }, { x: 0, y: 0 }] as const,
    };
    const bridge = buildBattlefieldBridge(scene, route, 0.8, { x: 0, y: 0 });
    const centerDeck = bridge.group.getObjectByName(`${bridge.group.name}-center-deck`)!;
    const sideDeck = bridge.group.getObjectByName(`${bridge.group.name}-expanded-side-decks`)!;
    const piers = bridge.group.getObjectByName(`${bridge.group.name}-piers-and-abutments`)!;
    const broken = bridge.group.getObjectByName(`${bridge.group.name}-broken-water-gap`)!;

    expect(piers.children.length).toBeGreaterThan(0);
    expect(centerDeck.visible).toBe(false);
    expect(sideDeck.visible).toBe(false);
    expect(broken.visible).toBe(false);
    expect(bridge.group.userData.state).toBe("unknown");

    bridge.setState("normal");
    expect(centerDeck.visible).toBe(true);
    expect(sideDeck.visible).toBe(false);
    expect(bridge.group.userData.openWaterGap).toBe(false);

    bridge.setState("expanded");
    expect(centerDeck.visible).toBe(true);
    expect(sideDeck.visible).toBe(true);
    expect(bridge.group.getObjectByName(`${bridge.group.name}-expanded-rails`)?.visible).toBe(true);

    bridge.setState("destroyed");
    expect(centerDeck.visible).toBe(false);
    expect(sideDeck.visible).toBe(false);
    expect(broken.visible).toBe(true);
    expect(bridge.group.userData.openWaterGap).toBe(true);
    bridge.dispose();
  });

  it("builds a high silhouette tower and fortress distinct from unit-scale geometry", () => {
    const scene = new THREE.Scene();
    const tower = buildBattlefieldTower(scene, entity({ id: "tower-a", side: "azure", kind: "tower", archetype: "tower" }));
    const fortress = buildBattlefieldBase(scene, entity({ id: "base-a", side: "azure", kind: "base", archetype: "base" }));
    expect(tower.getObjectByName("azure-battlefield-tower-tower-a-bastion-shaft")).toBeDefined();
    expect(tower.getObjectByName("azure-battlefield-tower-tower-a-standard-cloth")).toBeDefined();
    expect(fortress.getObjectByName("azure-battlefield-fortress-base-a-keep-hall")).toBeDefined();
    expect(fortress.getObjectByName("azure-battlefield-fortress-base-a-walltower--3.18--3.17")).toBeDefined();
    expect(fortress.position.toArray()).toEqual([8, 0, 12]);
    expect(tower.position.toArray()).toEqual([0, 0, 0]);
  });

  it("reads MID owner and capture progress from the currently visible Replay entity", () => {
    const scene = new THREE.Scene();
    const mid = buildMidObservatory(scene, { x: 0, y: 0 }, [{ x: 3.6, y: 0 }, { x: -3.6, y: 0 }], 8);
    expect(mid.group.name).toBe("mid-observation-objective");
    expect(mid.group.getObjectByName("mid-island-wall-1")).toBeDefined();
    expect(mid.group.getObjectByName("mid-island-bridge-gate-0")).toBeDefined();
    expect(mid.group.userData.state).toBe("unknown");
    expect(mid.group.userData.owner).toBeUndefined();

    mid.update(entity({
      id: "obs",
      kind: "observation",
      archetype: "observation",
      battlefield: { facilityOwner: "azure", captureSide: "vermilion", captureProgress: 4 },
    }));
    expect(mid.group.userData.state).toBe("contested");
    expect(mid.group.userData.owner).toBe("azure");
    expect(mid.group.userData.captureSide).toBe("vermilion");
    expect(mid.group.userData.captureProgress).toBe(4);

    mid.update(undefined);
    expect(mid.group.userData.state).toBe("unknown");
    expect(mid.group.userData.owner).toBeUndefined();
    expect(mid.group.userData.captureProgress).toBeUndefined();
    mid.dispose();
  });
});
