import { describe, expect, it } from "vitest";
import type {
  MatchResult,
  PresentationReplay as CoreReplay,
  RulePackage,
} from "../../../apps/web/src/contracts/core-model";
import { presentationToGraphics } from "./next-adapter";

function project(edges = [
  { from: "attacker", to: "camp", length: 250, region: "jungle", blocked: false },
  { from: "camp", to: "defender", length: 250, region: "jungle", blocked: true },
]) {
  const ruleset = {
    ruleset: { id: "senkei.next", digest: "a".repeat(64) },
    next: {
      parameters: { tick_duration_ms: 100 },
      map: {
        nodes: {
          attacker: { x: 0, y: 0, region: "base" },
          camp: { x: 250, y: 125, region: "jungle" },
          defender: { x: 500, y: 250, region: "base" },
        },
        edges,
        lanes: { mid: ["attacker", "camp", "defender"] },
      },
      camps: [{ id: "camp-nw", node: "camp" }],
      heroes: [],
    },
  } as unknown as RulePackage;
  const replay = {
    schema_version: { major: 1, minor: 0, patch: 0 },
    match_id: "match-1",
    result_digest: "b".repeat(64),
    frames: [],
  } as unknown as CoreReplay;
  const result = {
    match_id: "match-1",
    outcome: "draw",
    termination_reason: "tick_limit",
    final_tick: 1,
    statistics: {},
    cu_spent: { attacker: 0, defender: 0 },
    final_state_digest: "c".repeat(64),
  } as unknown as MatchResult;
  return presentationToGraphics(replay, ruleset, result);
}

describe("Next map graph projection", () => {
  it("projects traversable map edges and camps from their real world nodes", () => {
    const replay = project();
    expect(replay.scene.routes).toEqual([
      {
        id: "map-edge-0",
        region: "jungle",
        points: [{ x: 0, y: 0 }, { x: 10, y: 5 }],
      },
    ]);
    expect(replay.scene.camps).toEqual([
      { id: "camp-nw", position: { x: 10, y: 5 } },
    ]);
    expect(replay.scene.lanes[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 10 },
    ]);
  });

  it("rejects graph edges that reference a missing Senritsu node", () => {
    expect(() => project([
      { from: "attacker", to: "absent", length: 1, region: "jungle", blocked: false },
    ])).toThrow("Missing public map node: absent");
  });
});
