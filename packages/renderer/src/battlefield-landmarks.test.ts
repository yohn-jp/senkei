import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { decodeReplay, type DisplayEntity, type DisplayState, type PresentationReplay } from "@senkei/replay-contract";
import { stateAt } from "../../replay-player/src/index";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";
import { BattlefieldLandmarks } from "./battlefield-landmarks";

describe("canonical Battlefield landmarks", () => {
  it("renders fixed sites from the Replay graph and keeps hidden facilities unknown", () => {
    const source = structuredClone(basic) as unknown as PresentationReplay;
    source.schemaVersion = "0.5";
    source.scene.nodes = [
      { id: "A.TOP.BANK", allegiance: "A", position: { x: 0, y: 1 } },
      { id: "N.MID.OBS", allegiance: "N", position: { x: 1, y: 1 } },
    ];
    source.scene.routes = [
      { id: "edge-a-top", region: "lane", points: [{ x: 0, y: 1 }, { x: 2, y: 1 }], bridgeSite: "world.fixed-bridge.top", bridgeKind: "lane" },
      { id: "edge-to-observatory", region: "bridge", points: [{ x: 1, y: 1 }, { x: 6, y: 1 }], bridgeSite: "world.observation-approach.17", bridgeKind: "facility" },
    ];
    source.scene.river = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }];
    source.scene.trackOffset = 0.8;
    source.initialView.push(
      { id: "top-bridge", side: "neutral", kind: "bridge", archetype: "bridge", appearanceKey: "bridge", position: { x: 1, y: 1 }, hp: 1, maxHp: 1, battlefield: { bridgeSite: "world.fixed-bridge.top", bridgeState: "normal", buildRemaining: 3 } },
      { id: "mid-observation", side: "neutral", kind: "observation", archetype: "observation", appearanceKey: "observation", position: { x: 1, y: 1 }, hp: 1, maxHp: 1, battlefield: { captureProgress: 4, captureSide: "vermilion", facilityOwner: "neutral" } },
      { id: "mid-unit-azure", side: "azure", kind: "unit", archetype: "hero", appearanceKey: "hero-vanguard", position: { x: 1, y: 1 }, hp: 1, maxHp: 1, battlefield: { node: "N.MID.OBS" } },
      { id: "mid-unit-vermilion", side: "vermilion", kind: "unit", archetype: "hero", appearanceKey: "hero-vanguard", position: { x: 1, y: 1 }, hp: 1, maxHp: 1, battlefield: { node: "N.MID.OBS" } },
    );
    source.result = { ...source.result, tick: 3 };
    source.timeline = [
      { type: "facility-state", tick: 1, order: 0, entityId: "top-bridge", battlefield: { bridgeSite: "world.fixed-bridge.top", bridgeState: "destroyed", buildRemaining: 0 } },
      { type: "move", tick: 1, order: 1, entityId: "mid-unit-vermilion", position: { x: 0, y: 1 }, logicalPosition: { node: "A.TOP.BANK" } },
      { type: "facility-state", tick: 1, order: 2, entityId: "mid-observation", battlefield: { captureProgress: 4, captureSide: "vermilion", facilityOwner: "neutral", captureContested: true } },
      { type: "facility-state", tick: 2, order: 0, entityId: "mid-observation", battlefield: { captureProgress: 4, captureSide: "vermilion", facilityOwner: "neutral", captureContested: false } },
      { type: "match-end", tick: 3, order: 0, result: { ...source.result } },
    ];
    const replay = decodeReplay(source), scene = new THREE.Scene();
    const landmarks = new BattlefieldLandmarks(scene, replay);
    const bridge = scene.getObjectByName("fixed-bridge-world.fixed-bridge.top-edge-a-top") as THREE.Group;
    const objective = scene.getObjectByName("mid-observation-objective") as THREE.Group;
    const water = scene.getObjectByName("canonical-river-from-fixed-crossings") as THREE.Mesh;
    const centerDeck = bridge.getObjectByName(`${bridge.name}-center-deck`)!;
    const sideDeck = bridge.getObjectByName(`${bridge.name}-expanded-side-decks`)!;
    const brokenGap = bridge.getObjectByName(`${bridge.name}-broken-water-gap`)!;
    expect(scene.getObjectByName("canonical-river-from-fixed-crossings")).toBeDefined();
    expect(scene.getObjectByName("combat-domain-N.MID.OBS")).toBeDefined();
    expect(objective.getObjectByName("mid-island-bridge-gate-0")).toBeDefined();
    expect(bridge.userData.state).toBe("unknown");
    expect(bridge.userData.site).toBe("world.fixed-bridge.top");
    expect(centerDeck.visible).toBe(false);
    expect(sideDeck.visible).toBe(false);
    expect(brokenGap.visible).toBe(false);
    expect(objective.userData.state).toBe("unknown");
    const geometry = water.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position");
    const indices = geometry.getIndex();
    const vertexAt = (index: number) => new THREE.Vector3().fromBufferAttribute(positions, indices?.getX(index) ?? index);
    const triangleCount = indices ? indices.count / 3 : positions.count / 3;
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const center = vertexAt(triangle * 3).add(vertexAt(triangle * 3 + 1)).add(vertexAt(triangle * 3 + 2)).multiplyScalar(1 / 3);
      expect(Math.hypot(center.x - 1, center.z - 1)).toBeGreaterThanOrEqual(1.9);
    }
    landmarks.update(stateAt(replay, 0));
    expect(bridge.userData.state).toBe("normal");
    expect(centerDeck.visible).toBe(true);
    expect(sideDeck.visible).toBe(false);
    expect(brokenGap.visible).toBe(false);
    expect(bridge.getObjectByName(`${bridge.name}-work-scaffold`)?.visible).toBe(true);
    expect(bridge.userData.buildRemaining).toBe(3);
    // Seeing opponents at the site does not confirm a contest: the Replay
    // exposes capture progress, but no contest status for this Tick.
    expect(objective.userData.state).toBe("capture-progress");
    expect(objective.userData.contested).toBeUndefined();
    expect(objective.getObjectByName("mid-observatory-contested-ring")?.visible).toBe(false);
    expect(objective.getObjectByName("mid-observatory-capture-ring")?.visible).toBe(true);
    const damagedBridge = structuredClone(stateAt(replay, 0)) as {
      tick: number;
      entities: Record<string, Omit<DisplayEntity, "hp" | "maxHp"> & { hp: number; maxHp: number }>;
      cues: DisplayState["cues"];
      result: DisplayState["result"];
    };
    damagedBridge.entities["top-bridge"]!.hp = 300;
    damagedBridge.entities["top-bridge"]!.maxHp = 500;
    landmarks.update(damagedBridge as DisplayState);
    expect(bridge.userData.damageStage).toBe("damaged");
    expect(bridge.getObjectByName(`${bridge.name}-timber-fractures`)?.visible).toBe(true);

    const oneSided = structuredClone(stateAt(replay, 0)) as {
      tick: number;
      entities: Record<string, DisplayEntity>;
      cues: DisplayState["cues"];
      result: DisplayState["result"];
    };
    delete oneSided.entities["mid-unit-vermilion"];
    landmarks.update(oneSided as DisplayState);
    expect(objective.userData.state).toBe("capture-progress");
    // A hidden opponent could still be present; one visible side is not proof
    // that the site is uncontested either.
    expect(objective.userData.contested).toBeUndefined();
    landmarks.update(stateAt(replay, 1));
    // The producer's resolution snapshot, not the later visible positions,
    // controls the contest cue (the vermilion unit has already left).
    expect(objective.userData.state).toBe("contested");
    expect(objective.userData.contested).toBe(true);
    expect(objective.getObjectByName("mid-observatory-contested-ring")?.visible).toBe(true);
    expect(bridge.userData.state).toBe("destroyed");
    expect(centerDeck.visible).toBe(false);
    expect(sideDeck.visible).toBe(false);
    expect(brokenGap.visible).toBe(true);
    expect(bridge.getObjectByName(`${bridge.name}-work-scaffold`)?.visible).toBe(false);
    expect(bridge.userData.buildRemaining).toBeUndefined();
    landmarks.update(stateAt(replay, 2));
    expect(objective.userData.state).toBe("capture-progress");
    expect(objective.userData.contested).toBe(false);
    expect(objective.getObjectByName("mid-observatory-contested-ring")?.visible).toBe(false);
    landmarks.update(stateAt(replay, 1));
    expect(objective.userData.contested).toBe(true);
    landmarks.update({ tick: 1, entities: {}, cues: [], result: null });
    expect(bridge.userData.state).toBe("unknown");
    expect(bridge.getObjectByName(`${bridge.name}-work-scaffold`)?.visible).toBe(false);
    expect(bridge.userData.buildRemaining).toBeUndefined();
    expect(objective.userData.state).toBe("unknown");
    landmarks.dispose();
  });

  it("leaves lane geometry to the terrain surface instead of drawing guide ribbons", () => {
    const source = structuredClone(basic) as unknown as PresentationReplay;
    source.schemaVersion = "0.3";
    source.scene.nodes = [{ id: "A.BASE", allegiance: "A", position: { x: 0, y: 0 } }];
    source.scene.routes = [{ id: "lane-a", region: "lane", points: [{ x: 0, y: 0 }, { x: 4, y: 2 }] }];
    source.scene.river = undefined;
    source.scene.trackOffset = 0.8;
    const replay = decodeReplay(source), scene = new THREE.Scene();
    const landmarks = new BattlefieldLandmarks(scene, replay);
    expect(scene.getObjectByName(`lane-${replay.scene.lanes[0].id}-track-left`)).toBeUndefined();
    expect(scene.getObjectByName(`lane-${replay.scene.lanes[0].id}-track-center`)).toBeUndefined();
    expect(scene.getObjectByName(`lane-${replay.scene.lanes[0].id}-track-right`)).toBeUndefined();
    expect(scene.getObjectByName("combat-domain-A.BASE")).toBeDefined();
    landmarks.dispose();
  });
});
