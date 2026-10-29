import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { decodeReplay, type DisplayState } from "@senkei/replay-contract";
import { stateAt } from "../../replay-player/src/index";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";
import { BattlefieldFog } from "./battlefield-fog";

describe("battlefield fog presentation", () => {
  it("has no mask for legacy inputs, then draws only authorized historical facilities", () => {
    const input = structuredClone(basic);
    Object.assign(input.scene, {
      nodes: [
        { id: "known", allegiance: "A", position: { x: 0, y: 0 } },
        { id: "unknown", allegiance: "B", position: { x: 2, y: 4 } },
      ],
      routes: [{ id: "r", region: "lane", bridgeSite: "world.bridge.top", bridgeKind: "lane", bridgePosition: { x: 1, y: 3 }, points: [{ x: 0, y: 0 }, { x: 2, y: 4 }] }],
    });
    const replay = decodeReplay(input);
    const fog = new BattlefieldFog(new THREE.Scene(), replay);
    fog.update(stateAt(replay, 0));
    expect(fog.group.visible).toBe(false);
    const state: DisplayState = { ...stateAt(replay, 2), fog: { worldUnitsPerRenderUnit: 25, state: {
      schema_version: 1, tick: 2, side: "attacker", nodes: { known: "explored", unknown: "unexplored" }, edges: { r: ["unexplored", "unexplored", "unexplored", "unexplored", "unexplored", "unexplored", "unexplored", "unexplored", "unexplored"] }, facilities: [{ id: "facility-1", state: "last_known", kind: "bridge", side: "neutral", site: "world.bridge.top", facility_state: { bridge_state: "normal" }, last_seen_tick: 1 }],
    } } };
    // The workspace sets information layers before the first replay update.
    fog.setVisionAnnotationsEnabled(true);
    fog.update(state);
    expect(fog.group.visible).toBe(true);
    const concealment = fog.group.getObjectByName("mandatory-unexplored-concealment")!;
    const annotations = fog.group.getObjectByName("explored-vision-annotation")!;
    expect(concealment.visible).toBe(true);
    expect(annotations.visible).toBe(true);
    fog.update(stateAt(replay, 0));
    expect(concealment.visible).toBe(false);
    fog.update(state);
    expect(concealment.visible).toBe(true);
    expect((concealment.children[0] as THREE.InstancedMesh).count).toBeGreaterThan(0);
    fog.setVisionAnnotationsEnabled(false);
    expect(fog.group.visible).toBe(true);
    expect(concealment.visible).toBe(true);
    expect(annotations.visible).toBe(false);
    expect((concealment.children[0] as THREE.InstancedMesh).count).toBeGreaterThan(0);
    fog.setVisionAnnotationsEnabled(true);
    expect(concealment.visible).toBe(true);
    expect(annotations.visible).toBe(true);
    const ring = fog.group.getObjectByName("last-known-facility-1-tick-1") as THREE.Line;
    expect(ring).toBeInstanceOf(THREE.Line);
    const box = new THREE.Box3().setFromObject(ring);
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(1);
    expect(box.getCenter(new THREE.Vector3()).z).toBeCloseTo(3);
    fog.update({ ...state, fog: { ...state.fog!, state: { ...state.fog!.state, facilities: [] } } });
    expect(fog.group.getObjectByName(ring.name)).toBeUndefined();
    fog.dispose();
  });
});
