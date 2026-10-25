import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { decodeReplay, type PresentationReplay } from "@senkei/replay-contract";
import { stateAt } from "../../replay-player/src/index";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";
import { BattlefieldLandmarks } from "./battlefield-landmarks";

describe("canonical Battlefield landmarks", () => {
  it("renders fixed sites from the Replay graph and keeps hidden facilities unknown", () => {
    const source = structuredClone(basic) as unknown as PresentationReplay;
    source.schemaVersion = "0.3";
    source.scene.nodes = [
      { id: "A.TOP.BANK", allegiance: "A", position: { x: 0, y: 1 } },
      { id: "N.MID.OBS", allegiance: "N", position: { x: 1, y: 1 } },
    ];
    source.scene.routes = [{ id: "edge-a-top", region: "lane", points: [{ x: 0, y: 1 }, { x: 2, y: 1 }], bridgeSite: "TOP" }];
    source.scene.river = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }];
    source.scene.trackOffset = 0.8;
    source.initialView.push(
      { id: "top-bridge", side: "neutral", kind: "bridge", archetype: "bridge", appearanceKey: "bridge", position: { x: 1, y: 1 }, hp: 1, maxHp: 1, battlefield: { bridgeSite: "TOP", bridgeState: "normal" } },
      { id: "mid-observation", side: "neutral", kind: "observation", archetype: "observation", appearanceKey: "observation", position: { x: 1, y: 1 }, hp: 1, maxHp: 1, battlefield: { captureProgress: 0, facilityOwner: "neutral" } },
    );
    source.result = { ...source.result, tick: 2 };
    source.timeline = [
      { type: "facility-state", tick: 1, order: 0, entityId: "top-bridge", battlefield: { bridgeSite: "TOP", bridgeState: "destroyed", buildRemaining: 0 } },
      { type: "match-end", tick: 2, order: 0, result: { ...source.result } },
    ];
    const replay = decodeReplay(source), scene = new THREE.Scene();
    const landmarks = new BattlefieldLandmarks(scene, replay);
    const bridge = scene.getObjectByName("fixed-bridge-TOP-edge-a-top") as THREE.Group;
    const objective = scene.getObjectByName("mid-observation-objective") as THREE.Group;
    const deckBoards = bridge.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry && child.geometry.parameters.height === 0.1);
    expect(scene.getObjectByName("canonical-river-from-fixed-crossings")).toBeDefined();
    expect(scene.getObjectByName("combat-domain-N.MID.OBS")).toBeDefined();
    expect(bridge.userData.state).toBe("unknown");
    expect(deckBoards.filter(board => board.visible)).toHaveLength(0);
    expect(objective.userData.state).toBe("unknown");
    landmarks.update(stateAt(replay, 0));
    expect(bridge.userData.state).toBe("normal");
    expect(deckBoards.filter(board => board.visible)).toHaveLength(5);
    expect(objective.userData.state).toBe("visible");
    landmarks.update(stateAt(replay, 1));
    expect(bridge.userData.state).toBe("destroyed");
    expect(deckBoards.filter(board => board.visible)).toHaveLength(3);
    landmarks.update({ tick: 1, entities: {}, cues: [], result: null });
    expect(bridge.userData.state).toBe("unknown");
    expect(objective.userData.state).toBe("unknown");
    landmarks.dispose();
  });

  it("draws the three separate lane combat tracks at versioned lateral spacing", () => {
    const source = structuredClone(basic) as unknown as PresentationReplay;
    source.schemaVersion = "0.3";
    source.scene.nodes = [{ id: "A.BASE", allegiance: "A", position: { x: 0, y: 0 } }];
    source.scene.routes = [{ id: "lane-a", region: "lane", points: [{ x: 0, y: 0 }, { x: 4, y: 2 }] }];
    source.scene.river = undefined;
    source.scene.trackOffset = 0.8;
    const replay = decodeReplay(source), scene = new THREE.Scene();
    const landmarks = new BattlefieldLandmarks(scene, replay);
    for (const track of ["left", "center", "right"])
      expect(scene.getObjectByName(`lane-${replay.scene.lanes[0].id}-track-${track}`)).toBeDefined();
    landmarks.dispose();
  });
});
