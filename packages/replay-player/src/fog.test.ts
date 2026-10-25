import { describe, expect, it } from "vitest";
import { decodeReplay, type PresentationReplay } from "@senkei/replay-contract";
import { ReplayPlayer, stateAt } from "./index";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";

const samples = (s: "visible" | "explored") => [s, s, s, s, s, s, s, s, s] as [typeof s, typeof s, typeof s, typeof s, typeof s, typeof s, typeof s, typeof s, typeof s];

function input(): PresentationReplay {
  const replay = structuredClone(basic) as unknown as PresentationReplay;
  replay.header.view = "attacker";
  replay.scene.nodes = [{ id: "n", allegiance: "N", position: { x: 0, y: 0 } }];
  replay.scene.routes = [{ id: "r", region: "lane", bridgeSite: "TOP", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }];
  replay.fog = { worldUnitsPerRenderUnit: 25, frames: [
    { schema_version: 1, tick: 0, side: "attacker", nodes: { n: "visible" }, edges: { r: samples("visible") }, facilities: [] },
    { schema_version: 1, tick: 2, side: "attacker", nodes: { n: "explored" }, edges: { r: samples("explored") }, facilities: [{ id: "facility-1", state: "last_known", kind: "bridge", side: "neutral", site: "TOP", facility_state: { bridge_state: "normal" }, last_seen_tick: 1 }] },
    { schema_version: 1, tick: 4, side: "attacker", nodes: { n: "visible" }, edges: { r: samples("visible") }, facilities: [] },
  ] };
  return replay;
}

describe("authorized fog projection and seek", () => {
  it("restores historical visibility and facilities in both seek directions", () => {
    const replay = decodeReplay(input());
    expect(stateAt(replay, 3).fog?.state.facilities[0].last_seen_tick).toBe(1);
    expect(stateAt(replay, 4).fog?.state.facilities).toEqual([]);
    expect(stateAt(replay, 1).fog?.state.nodes.n).toBe("visible");
    expect(stateAt(replay, 2).fog?.state.nodes.n).toBe("explored");
    expect(stateAt(replay, 0).fog?.state.facilities).toEqual([]);
  });
  it("rejects perspective changes, future facilities and unknown map references", () => {
    const publicView = input(); publicView.header.view = "public";
    expect(() => decodeReplay(publicView)).toThrow("authorized");
    const future = input(); future.fog!.frames[1].facilities[0].last_seen_tick = 3;
    expect(() => decodeReplay(future)).toThrow("facility");
    const unknown = input(); unknown.fog!.frames[0].nodes.secret = "visible";
    expect(() => decodeReplay(unknown)).toThrow("node");
    const mutable = input(); Object.assign(mutable.fog!.frames[1].facilities[0], { hp: 99 });
    expect(() => decodeReplay(mutable)).toThrow("additional properties");
  });
  it("requires complete map masks and never forgets explored geography", () => {
    const missingNode = input(); delete missingNode.fog!.frames[0].nodes.n;
    expect(missingNode.fog!.frames[0].nodes).toEqual({});
    expect(() => decodeReplay(missingNode)).toThrow("every map node");
    const regressedNode = input(); regressedNode.fog!.frames[1].nodes.n = "unexplored";
    expect(() => decodeReplay(regressedNode)).toThrow("cannot become unexplored");
    const regressedEdge = input(); regressedEdge.fog!.frames[1].edges.r[0] = "unexplored";
    expect(() => decodeReplay(regressedEdge)).toThrow("cannot become unexplored");
  });
  it("reconstructs the same fog and display state sequentially and after reverse seeks", () => {
    const replay = decodeReplay(input());
    const sequential = Array.from({ length: replay.result.tick + 1 }, (_, tick) => stateAt(replay, tick));
    const player = new ReplayPlayer(replay);
    expect(player.state).toEqual(sequential[0]);
    player.play();
    for (let tick = 1; tick <= replay.result.tick; tick++) {
      player.advance(replay.presentation.tickDurationMs);
      expect(player.state).toEqual(sequential[tick]);
    }
    player.pause();
    for (let tick = replay.result.tick; tick >= 0; tick--) {
      player.seek(tick);
      expect(player.state).toEqual(sequential[tick]);
    }
    for (let tick = 0; tick <= replay.result.tick; tick++) {
      expect(stateAt(replay, tick)).toEqual(sequential[tick]);
    }
  });
  it("keeps legacy replay compatibility without fabricating a fog mask", () => {
    expect(stateAt(decodeReplay(basic), 1).fog).toBeUndefined();
  });
});
