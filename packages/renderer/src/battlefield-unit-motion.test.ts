import { describe, expect, it } from "vitest";
import type { Entity, Event, Replay } from "@senkei/replay-contract";
import {
  BattlefieldUnitMotionIndex,
  battlefieldUnitPose,
} from "./battlefield-unit-motion";

const hero: Entity = {
  id: "hero",
  side: "azure",
  kind: "unit",
  archetype: "hero",
  appearanceKey: "hero-vanguard",
  position: { x: 2, y: 0 },
  hp: 100,
  maxHp: 100,
  battlefield: {
    node: "A.BOT.J",
    edgeTo: "B.BOT.J",
    progress: 2,
    track: "LEFT",
    crossing: "none",
  },
};

function testReplay(timeline: Event[], initialView: Entity[] = [hero]): Replay {
  return {
    scene: {
      bounds: { min: { x: -5, y: -5 }, max: { x: 15, y: 5 } },
      lanes: [{ id: "bot", label: "BOT", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], elevation: 0 }],
      nodes: [
        { id: "A.BOT.J", allegiance: "A", position: { x: 0, y: 0 } },
        { id: "B.BOT.J", allegiance: "B", position: { x: 10, y: 0 } },
      ],
      routes: [{ id: "bot-edge", region: "lane", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
      trackOffset: 0.8,
    },
    initialView,
    timeline,
    result: { winner: "azure", reason: "test", tick: 4 },
  } as unknown as Replay;
}

describe("Replay-derived battlefield unit motion", () => {
  it("is seek-safe and records only the movement belonging to the selected tick", () => {
    const replay = testReplay([
      {
        type: "move", tick: 1, order: 1, entityId: "hero",
        position: { x: 3, y: 0 },
        logicalPosition: { node: "A.BOT.J", edgeTo: "B.BOT.J", progress: 3, track: "LEFT", crossing: "none" },
      },
      {
        type: "move", tick: 3, order: 1, entityId: "hero",
        position: { x: 5, y: 0 },
        logicalPosition: { node: "A.BOT.J", edgeTo: "B.BOT.J", progress: 5, track: "LEFT", crossing: "none" },
      },
    ]);
    const motion = new BattlefieldUnitMotionIndex(replay);

    expect(motion.at(1, "hero")).toEqual({ dx: 1, dy: 0 });
    expect(motion.at(2, "hero")).toBeUndefined();
    expect(motion.at(3, "hero")).toEqual({ dx: 2, dy: 0 });
    // Looking backward and forward again returns the same Replay-derived data.
    expect(motion.at(1, "hero")).toEqual({ dx: 1, dy: 0 });
  });

  it("uses the authorized effective lane trackpoint and ignores nonsemantic layout offsets", () => {
    const replay = testReplay([
      {
        type: "move", tick: 1, order: 1, entityId: "hero",
        position: { x: 2, y: 0 },
        logicalPosition: { node: "A.BOT.J", edgeTo: "B.BOT.J", progress: 2, track: "RIGHT", crossing: "none" },
      },
    ]);
    const motion = new BattlefieldUnitMotionIndex(replay);

    // The world position is unchanged; the authorized trackpoint moved 1.6 units.
    expect(motion.at(1, "hero")).toEqual({ dx: 0, dy: -1.6 });
    // The index has no input for NodeDisplayLayout or model offsets.
    expect(motion.at(2, "hero")).toBeUndefined();
  });

  it("does not animate a ford timer update when the public position is unchanged", () => {
    const fordHero: Entity = {
      ...hero,
      battlefield: { node: "A.BOT.J", edgeTo: "B.BOT.J", progress: 20, crossing: "ford", remaining: 5 },
    };
    const replay = testReplay([
      {
        type: "move", tick: 1, order: 1, entityId: "hero",
        position: { x: 2, y: 0 },
        logicalPosition: { node: "A.BOT.J", edgeTo: "B.BOT.J", progress: 20, crossing: "ford", remaining: 4 },
      },
      {
        type: "move", tick: 2, order: 1, entityId: "hero",
        position: { x: 2, y: 0 },
        logicalPosition: { node: "A.BOT.J", edgeTo: "B.BOT.J", progress: 20, crossing: "ford", remaining: 3 },
      },
    ], [fordHero]);
    const motion = new BattlefieldUnitMotionIndex(replay);

    expect(motion.at(1, "hero")).toBeUndefined();
    expect(motion.at(2, "hero")).toBeUndefined();
  });
});

describe("deterministic fixed-tick unit poses", () => {
  const cues: Event[] = [
    { type: "attack", tick: 4, order: 1, entityId: "hero", targetId: "enemy" },
    { type: "damage", tick: 4, order: 2, entityId: "enemy", hp: 90 },
  ];

  it("shows a representative attack and hit pose while paused or reduced-motion", () => {
    const attacker = battlefieldUnitPose(4, cues, "hero", false, false, 1);
    const defender = battlefieldUnitPose(4, cues, "enemy", false, false, 1);

    expect(attacker).toEqual({ walk: 0, strike: 1, hit: 0, attackLean: 0.16 });
    expect(defender).toEqual({ walk: 0, strike: 0, hit: 1, attackLean: 0 });
  });

  it("holds a deterministic mid-step for a confirmed move and leaves idle units at rest", () => {
    const moving = battlefieldUnitPose(4, [], "hero", true, false, 0.1);
    const idle = battlefieldUnitPose(4, [], "enemy", false, false, 0.1);
    const priorTickAction = battlefieldUnitPose(5, cues, "hero", false, false, 0.1);

    expect(moving.walk).toBeCloseTo(0.34, 10);
    expect(battlefieldUnitPose(4, [], "hero", true, false, 0.95)).toEqual(moving);
    expect(idle).toEqual({ walk: 0, strike: 0, hit: 0, attackLean: 0 });
    expect(priorTickAction).toEqual(idle);
  });

  it("keeps playback phase animation available when playback is active", () => {
    expect(battlefieldUnitPose(4, cues, "hero", false, true, 0.25).strike)
      .toBeCloseTo(Math.sin(Math.PI * 0.25), 10);
  });
});
