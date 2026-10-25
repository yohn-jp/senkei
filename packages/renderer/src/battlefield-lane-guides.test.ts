import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { decodeReplay } from "@senkei/replay-contract";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";
import { buildBattlefieldLaneGuides } from "./battlefield-lane-guides";

describe("battlefield lane information layer", () => {
  it("uses the Replay lane coordinates for a separate, independently visible guide", () => {
    const replay = decodeReplay(structuredClone(basic));
    const scene = new THREE.Scene();
    const guide = buildBattlefieldLaneGuides(scene, replay);
    expect(guide.userData.informationLayer).toBe("lanes");
    expect(guide.children).toHaveLength(replay.scene.lanes.length);
    expect(guide.children.map(({ name }) => name)).toEqual(replay.scene.lanes.map(({ id }) => `lane-guide-${id}`));
    const line = guide.children[0] as THREE.Line;
    const positions = line.geometry.getAttribute("position");
    expect(positions.getX(0)).toBeCloseTo(replay.scene.lanes[0]!.points[0]!.x);
    expect(positions.getZ(0)).toBeCloseTo(replay.scene.lanes[0]!.points[0]!.y);
    guide.visible = false;
    expect(guide.visible).toBe(false);
  });
});
