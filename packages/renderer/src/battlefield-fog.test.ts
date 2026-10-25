import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { decodeReplay, type DisplayState } from "@senkei/replay-contract";
import { stateAt } from "../../replay-player/src/index";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";
import { BattlefieldFog } from "./battlefield-fog";

describe("battlefield fog presentation", () => {
  it("has no mask for legacy inputs, then draws only authorized historical contacts", () => {
    const replay = decodeReplay(basic);
    const fog = new BattlefieldFog(new THREE.Scene(), replay);
    fog.update(stateAt(replay, 0));
    expect(fog.group.visible).toBe(false);
    const state: DisplayState = { ...stateAt(replay, 2), fog: { worldUnitsPerRenderUnit: 25, state: {
      schema_version: 1, tick: 2, side: "attacker", nodes: {}, edges: {}, contacts: [{ id: "contact-1", state: "last_known", kind: "hero", side: "defender", x: 25, y: 50, last_seen_tick: 1 }],
    } } };
    fog.update(state);
    const ring = fog.group.getObjectByName("last-known-contact-1-tick-1") as THREE.Line;
    expect(ring).toBeInstanceOf(THREE.Line);
    const box = new THREE.Box3().setFromObject(ring);
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(1);
    expect(box.getCenter(new THREE.Vector3()).z).toBeCloseTo(2);
    fog.update({ ...state, fog: { ...state.fog!, state: { ...state.fog!.state, contacts: [] } } });
    expect(fog.group.getObjectByName(ring.name)).toBeUndefined();
    fog.dispose();
  });
});
