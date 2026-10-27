import { describe, expect, it, vi } from "vitest";
import { decodeReplay, type Entity, type PresentationReplay } from "@senkei/replay-contract";
import { ReplayPlayer, stateAt } from "../../replay-player/src/index";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";
import { BattlefieldReplayLayoutIndex } from "./battlefield-replay-layout";
import { NodeDisplayLayout } from "./node-display-layout";

function fixture() {
  const source = structuredClone(basic) as PresentationReplay;
  source.schemaVersion = "0.3";
  source.scene.nodes = [
    { id: "N.A.UJ", allegiance: "N", position: { x: -10, y: -4 } },
    { id: "A.TOP.BANK", allegiance: "A", position: { x: 0, y: 0 } },
    { id: "B.TOP.BANK", allegiance: "B", position: { x: 10, y: 0 } },
    { id: "N.A.LJ", allegiance: "N", position: { x: -10, y: 4 } },
    { id: "N.B.LJ", allegiance: "N", position: { x: 10, y: 4 } },
  ];
  source.scene.routes = [
    { id: "bridge", region: "bridge", bridgeSite: "world.bridge.top", bridgeKind: "lane", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    { id: "ford", region: "river_ford", ford: true, points: [{ x: -10, y: 4 }, { x: 10, y: 4 }] },
  ];
  source.scene.river = [{ x: 3, y: -7 }, { x: 3, y: 7 }];
  const unit = (id: string, node: string, x: number, y: number, extra: NonNullable<Entity["battlefield"]> = {}): Entity => ({
    id, side: "azure", kind: "unit", archetype: "hero", appearanceKey: "hero-f01", position: { x, y }, hp: 100, maxHp: 100,
    battlefield: { node, crossing: "none", ...extra },
  });
  const bridgeTrack = { edgeTo: "B.TOP.BANK", progress: 50, crossing: "bridge" as const };
  source.initialView = [
    unit("b-jungle", "N.A.UJ", -10, -4), unit("c-jungle", "N.A.UJ", -10, -4),
    unit("b-bank", "A.TOP.BANK", 0, 0), unit("c-bank", "A.TOP.BANK", 0, 0),
    unit("bridge-a", "A.TOP.BANK", 5, 0, { ...bridgeTrack, track: "CENTER" }),
    unit("bridge-b", "A.TOP.BANK", 5, 0, { ...bridgeTrack, track: "CENTER" }),
    unit("bridge-left-a", "A.TOP.BANK", 5, 0, { ...bridgeTrack, track: "LEFT" }),
    unit("bridge-left-b", "A.TOP.BANK", 5, 0, { ...bridgeTrack, track: "LEFT" }),
    unit("ford-a", "N.A.LJ", 0, 4, { edgeTo: "N.B.LJ", progress: 50, crossing: "ford" }),
    unit("ford-b", "N.A.LJ", 0, 4, { edgeTo: "N.B.LJ", progress: 50, crossing: "ford" }),
  ];
  source.result = { winner: "draw", reason: "test", tick: 8 };
  source.timeline = [
    { type: "spawn", tick: 1, order: 0, entity: unit("a-jungle", "N.A.UJ", -10, -4) },
    { type: "spawn", tick: 1, order: 1, entity: unit("a-bank", "A.TOP.BANK", 0, 0) },
    { type: "disappear", tick: 2, order: 0, entityId: "b-jungle" },
    { type: "disappear", tick: 2, order: 1, entityId: "b-bank" },
    { type: "spawn", tick: 3, order: 0, entity: unit("d-jungle", "N.A.UJ", -10, -4) },
    { type: "spawn", tick: 3, order: 1, entity: unit("d-bank", "A.TOP.BANK", 0, 0) },
    { type: "move", tick: 4, order: 0, entityId: "bridge-b", position: { x: 6, y: 0 }, logicalPosition: { node: "A.TOP.BANK", ...bridgeTrack, progress: 60, track: "CENTER" } },
    { type: "damage", tick: 4, order: 1, entityId: "c-jungle", hp: 0 },
    { type: "destroy", tick: 4, order: 2, entityId: "c-jungle" },
    { type: "move", tick: 5, order: 0, entityId: "bridge-b", position: { x: 5, y: 0 }, logicalPosition: { node: "A.TOP.BANK", ...bridgeTrack, track: "CENTER" } },
    { type: "disappear", tick: 6, order: 0, entityId: "d-bank" },
    { type: "spawn", tick: 7, order: 0, entity: unit("reobserved-bank", "A.TOP.BANK", 0, 0) },
    { type: "match-end", tick: 8, order: 0, result: source.result },
  ];
  return decodeReplay(source);
}

function record(offsets: ReadonlyMap<string, { readonly x: number; readonly y: number }>) {
  return Object.fromEntries([...offsets].sort(([a], [b]) => a.localeCompare(b)));
}

describe("canonical Replay placement", () => {
  it("matches progressive slot assignment on direct seek and rewind across crowded nodes and tracks", () => {
    const replay = fixture();
    const sourceBefore = JSON.stringify(replay);
    const sequential = new NodeDisplayLayout();
    const player = new ReplayPlayer(replay);
    const expected = new Map<number, ReturnType<typeof record>>();
    for (let tick = 0; tick <= replay.result.tick; tick++) {
      player.seek(tick);
      expected.set(tick, record(sequential.update(player.state, replay)));
    }

    // This fixture reproduces the history dependence that the index removes.
    expect(record(new NodeDisplayLayout().update(stateAt(replay, 3), replay))).not.toEqual(expected.get(3));
    const index = new BattlefieldReplayLayoutIndex(replay);
    for (const tick of [3, 0, 8, 5, 2, 7, 4, 1, 6, 3]) {
      expect(record(index.at(stateAt(replay, tick))), `tick ${tick}`).toEqual(expected.get(tick));
      expect(record(new BattlefieldReplayLayoutIndex(replay).at(stateAt(replay, tick))), `fresh tick ${tick}`).toEqual(expected.get(tick));
    }
    for (const id of ["c-jungle", "c-bank"]) {
      expect(expected.get(1)?.[id]).toEqual(expected.get(0)?.[id]);
      expect(expected.get(2)?.[id]).toEqual(expected.get(0)?.[id]);
      expect(expected.get(3)?.[id]).toEqual(expected.get(0)?.[id]);
    }
    for (const id of ["bridge-a", "bridge-b", "bridge-left-a", "bridge-left-b", "ford-a", "ford-b"])
      expect(expected.get(0)?.[id]).toBeDefined();
    expect(expected.get(4)?.["c-jungle"]).toBeDefined(); // confirmed death tick
    expect(expected.get(5)?.["c-jungle"]).toBeUndefined(); // no invisible reserved slot
    expect(expected.get(6)?.["d-bank"]).toBeUndefined();
    expect(expected.get(7)?.["reobserved-bank"]).toBeDefined();
    expect(JSON.stringify(replay)).toBe(sourceBefore);
  });

  it("never replays earlier placement ticks on repeated playback and seek queries", () => {
    const replay = fixture();
    const update = vi.spyOn(NodeDisplayLayout.prototype, "update");
    try {
      const index = new BattlefieldReplayLayoutIndex(replay);
      expect(update).toHaveBeenCalled();
      update.mockClear();
      for (let iteration = 0; iteration < 100; iteration++)
        index.at(stateAt(replay, iteration % (replay.result.tick + 1)));
      expect(update).not.toHaveBeenCalled();
    } finally {
      update.mockRestore();
    }
  });
});
