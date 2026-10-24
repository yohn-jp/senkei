import { describe, expect, it } from "vitest";
import basic from "../fixtures/basic-three-lane.json";
import { decodeReplay } from "./index";
import type { PresentationReplay } from "./generated";

describe("Replay route compatibility", () => {
  it("continues to accept older scenes without route data", () => {
    const replay = decodeReplay(basic);
    expect(replay.scene.routes).toBeUndefined();
  });

  it("does not impose an edge count cap absent from Senritsu map validation", () => {
    const replay = structuredClone(basic) as PresentationReplay;
    const [from, to] = replay.scene.lanes[0].points;
    replay.scene.routes = Array.from({ length: 513 }, (_, index) => ({
      id: `map-edge-${index}`,
      region: "jungle",
      points: [from, to] as [typeof from, typeof to],
    }));
    expect(decodeReplay(replay).scene.routes).toHaveLength(513);
  });
});
