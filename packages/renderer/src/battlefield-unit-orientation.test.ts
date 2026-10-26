import { describe, expect, it } from "vitest";
import type { Entity, Event, Replay } from "@senkei/replay-contract";
import { BattlefieldUnitOrientationIndex } from "./battlefield-unit-orientation";

const hero: Entity = { id: "hero", side: "azure", kind: "unit", archetype: "hero", appearanceKey: "hero-vanguard", position: { x: 0, y: 0 }, hp: 100, maxHp: 100 };
const enemy: Entity = { ...hero, id: "enemy", side: "vermilion", position: { x: 2, y: -3 } };
const move = (tick: number, x: number, y: number): Extract<Event, { type: "move" }> => ({ type: "move", tick, order: 0, entityId: "hero", position: { x, y } });
function replay(timeline: Event[], initialView: Entity[] = [hero, enemy]): Replay {
  return { initialView, timeline, scene: { bounds: { min: { x: -10, y: -10 }, max: { x: 10, y: 10 } }, lanes: [] }, result: { tick: 10, winner: "azure", reason: "test" } } as unknown as Replay;
}

describe("Replay-derived unit orientation", () => {
  it("retains the last movement heading at idle ticks independent of seek order", () => {
    const index = new BattlefieldUnitOrientationIndex(replay([move(1, 2, 0), move(3, 2, 2)]));
    expect(index.at(2, "hero")).toBeCloseTo(Math.PI / 2);
    expect(index.at(3, "hero")).toBe(0);
    expect(index.at(2, "hero")).toBeCloseTo(Math.PI / 2);
    expect(index.at(0, "hero")).toBe(0);
    expect(index.at(2, "hero")).toBeCloseTo(Math.PI / 2);
    expect(index.at(9, "hero")).toBe(0);
  });

  it("preserves attack heading through idle ticks and gives attack precedence over motion", () => {
    const index = new BattlefieldUnitOrientationIndex(replay([
      move(1, 2, 0), { type: "attack", tick: 1, order: 1, entityId: "hero", targetId: "enemy" },
      move(4, 3, 0),
    ]));
    expect(index.at(1, "hero")).toBeCloseTo(Math.PI);
    expect(index.at(3, "hero")).toBeCloseTo(Math.PI);
    expect(index.at(4, "hero")).toBeCloseTo(Math.PI / 2);
    expect(index.at(2, "enemy")).toBe(0);
  });

  it("does not retain or derive motion across an enemy visibility gap", () => {
    const observed = { ...hero, side: "vermilion" as const };
    const index = new BattlefieldUnitOrientationIndex(replay([
      move(1, 2, 0), { type: "disappear", tick: 2, order: 0, entityId: "hero" },
      { type: "spawn", tick: 5, order: 0, entity: { ...observed, position: { x: -5, y: -5 } } },
      move(7, -5, -3),
    ], [observed]));
    expect(index.at(1, "hero")).toBeCloseTo(Math.PI / 2);
    expect(index.at(2, "hero")).toBeUndefined();
    expect(index.at(4, "hero")).toBeUndefined();
    expect(index.at(5, "hero")).toBe(0);
    expect(index.at(6, "hero")).toBe(0);
    expect(index.at(7, "hero")).toBe(0);
    expect(index.at(1, "hero")).toBeCloseTo(Math.PI / 2);
  });

  it("starts facing the public opposing base and ignores unobserved entities", () => {
    const input = replay([]);
    const index = new BattlefieldUnitOrientationIndex({ ...input, scene: { ...input.scene, baseSites: [{ id: "b", side: "vermilion", position: { x: -5, y: 0 } }] } });
    expect(index.at(0, "hero")).toBeCloseTo(-Math.PI / 2);
    expect(index.at(0, "missing")).toBeUndefined();
    expect(index.at(0, "enemy")).toBe(0);
  });

  it("uses final positions and the first authorized attack within a tick", () => {
    const second = { ...enemy, id: "second", position: { x: -3, y: 0 } };
    const index = new BattlefieldUnitOrientationIndex(replay([
      move(1, 0, 2), { ...move(1, 2, 0), order: 1 },
      { type: "attack", tick: 1, order: 2, entityId: "hero", targetId: "enemy" },
      { type: "attack", tick: 1, order: 3, entityId: "hero", targetId: "second" },
    ], [hero, enemy, second]));
    expect(index.at(2, "hero")).toBeCloseTo(Math.PI);
  });

  it("does not turn a stationary timer update or coincident attack into a direction", () => {
    const index = new BattlefieldUnitOrientationIndex(replay([
      move(1, 2, 0), move(2, 2, 0),
      { type: "attack", tick: 2, order: 1, entityId: "hero", targetId: "enemy" },
    ], [hero, { ...enemy, position: { x: 2, y: 0 } }]));
    expect(index.at(3, "hero")).toBeCloseTo(Math.PI / 2);
  });

  it("derives track-change heading from authorized effective track positions", () => {
    const unit = { ...hero, position: { x: 2, y: 0 }, battlefield: { node: "a", edgeTo: "b", progress: 2, track: "LEFT" as const, crossing: "none" as const } };
    const input = replay([{ ...move(1, 2, 0), logicalPosition: { ...unit.battlefield, track: "RIGHT" } }], [unit]);
    const index = new BattlefieldUnitOrientationIndex({ ...input, scene: { ...input.scene, trackOffset: 0.8, nodes: [{ id: "a", allegiance: "A", position: { x: 0, y: 0 } }, { id: "b", allegiance: "B", position: { x: 10, y: 0 } }], routes: [{ id: "lane", region: "lane", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] } });
    expect(index.at(2, "hero")).toBeCloseTo(Math.PI);
  });
});
