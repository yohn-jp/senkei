import { describe, expect, it } from "vitest";
import type { Entity, Event, Replay } from "@senkei/replay-contract";
import { BattlefieldReplayEffectIndex } from "./battlefield-replay-effects";

const hero: Entity = {
  id: "hero",
  side: "azure",
  kind: "unit",
  archetype: "hero",
  appearanceKey: "hero-vanguard",
  position: { x: 0, y: 0 },
  hp: 100,
  maxHp: 100,
  battlefield: { node: "A", crossing: "none" },
};

const bridge: Entity = {
  id: "bridge.TOP",
  side: "neutral",
  kind: "bridge",
  archetype: "bridge",
  appearanceKey: "bridge",
  position: { x: 5, y: 0 },
  hp: 500,
  maxHp: 500,
  battlefield: { bridgeSite: "TOP", bridgeState: "normal", buildRemaining: 0 },
};

const observation: Entity = {
  id: "observation.MID",
  side: "neutral",
  kind: "observation",
  archetype: "observation",
  appearanceKey: "observation",
  position: { x: 5, y: 5 },
  hp: 1,
  maxHp: 1,
  battlefield: { captureProgress: 0, captureSide: "neutral", facilityOwner: "neutral" },
};

function replay(timeline: Event[], initialView: Entity[] = [hero, bridge, observation]): Replay {
  return {
    scene: {
      bounds: { min: { x: -1, y: -1 }, max: { x: 10, y: 10 } },
      lanes: [],
    },
    initialView,
    timeline,
    result: { winner: "azure", reason: "test", tick: 10 },
  } as unknown as Replay;
}

describe("Replay-confirmed battlefield effect index", () => {
  it("indexes crossing, bridge work/state, capture, combat, hit and death on their exact ticks", () => {
    const events: Event[] = [
      {
        type: "move", tick: 1, order: 1, entityId: "hero", position: { x: 1, y: 0 },
        logicalPosition: { node: "A", edgeTo: "B", progress: 1, crossing: "bridge" },
      },
      {
        type: "move", tick: 2, order: 1, entityId: "hero", position: { x: 2, y: 0 },
        logicalPosition: { node: "A", crossing: "none" },
      },
      {
        type: "facility-state", tick: 3, order: 1, entityId: bridge.id,
        battlefield: { bridgeSite: "TOP", bridgeState: "normal", buildRemaining: 2 },
      },
      {
        type: "facility-state", tick: 4, order: 1, entityId: bridge.id,
        battlefield: { bridgeSite: "TOP", bridgeState: "normal", buildRemaining: 1 },
      },
      {
        type: "facility-state", tick: 5, order: 1, entityId: bridge.id,
        battlefield: { bridgeSite: "TOP", bridgeState: "expanded", buildRemaining: 0 },
      },
      {
        type: "facility-state", tick: 6, order: 1, entityId: observation.id,
        battlefield: { captureProgress: 1, captureSide: "azure", facilityOwner: "neutral" },
      },
      {
        type: "facility-state", tick: 7, order: 1, entityId: observation.id,
        battlefield: { captureProgress: 0, captureSide: "neutral", facilityOwner: "azure" },
      },
      {
        type: "facility-state", tick: 8, order: 1, entityId: observation.id,
        battlefield: { captureProgress: 0, captureSide: "neutral", facilityOwner: "neutral" },
      },
      { type: "attack", tick: 9, order: 1, entityId: hero.id, targetId: "enemy" },
      { type: "damage", tick: 9, order: 2, entityId: hero.id, hp: 90 },
      { type: "destroy", tick: 10, order: 1, entityId: hero.id },
    ];
    const effects = new BattlefieldReplayEffectIndex(replay(events));

    expect(effects.at(1, hero.id).map((cue) => cue.channel)).toEqual(["crossing-start"]);
    expect(effects.at(2, hero.id).map((cue) => cue.channel)).toEqual(["crossing-end"]);
    expect(effects.at(3, bridge.id).map((cue) => cue.channel)).toEqual(["bridge-work-started"]);
    expect(effects.at(4, bridge.id).map((cue) => cue.channel)).toEqual(["bridge-work-progress"]);
    expect(effects.at(5, bridge.id).map((cue) => cue.channel)).toEqual(["bridge-expanded"]);
    expect(effects.at(6, observation.id).map((cue) => cue.channel)).toEqual(["capture-progress"]);
    expect(effects.at(7, observation.id).map((cue) => cue.channel)).toEqual([
      "capture-progress", "capture-completed",
    ]);
    expect(effects.at(8, observation.id).map((cue) => cue.channel)).toEqual(["capture-released"]);
    expect(effects.at(9, hero.id).map((cue) => cue.channel)).toEqual(["attack", "hit"]);
    expect(effects.at(10, hero.id).map((cue) => cue.channel)).toEqual(["death"]);
    expect(effects.at(9, hero.id)[0]).toMatchObject({ tick: 9, order: 1 });
  });

  it("does not infer death, crossing, bridge destruction, or capture across visibility gaps", () => {
    const returnedBridge: Entity = {
      ...bridge,
      battlefield: { bridgeSite: "TOP", bridgeState: "destroyed", buildRemaining: 0 },
    };
    const effects = new BattlefieldReplayEffectIndex(replay([
      { type: "disappear", tick: 1, order: 1, entityId: hero.id },
      { type: "disappear", tick: 1, order: 2, entityId: bridge.id },
      { type: "disappear", tick: 1, order: 3, entityId: observation.id },
      { type: "spawn", tick: 3, order: 1, entity: { ...hero, battlefield: { node: "A", crossing: "bridge" } } },
      { type: "spawn", tick: 3, order: 2, entity: returnedBridge },
      { type: "spawn", tick: 3, order: 3, entity: { ...observation, battlefield: {
        captureProgress: 0, captureSide: "neutral", facilityOwner: "azure",
      } } },
      {
        type: "move", tick: 4, order: 1, entityId: hero.id, position: { x: 0, y: 1 },
        logicalPosition: { node: "A", crossing: "none" },
      },
    ]));

    expect(effects.at(1)).toEqual([]);
    expect(effects.at(3)).toEqual([]);
    expect(effects.at(4, hero.id).map((cue) => cue.channel)).toEqual(["crossing-end"]);
  });

  it("distinguishes a rebuilt bridge and a work stop from inferred completion", () => {
    const damagedBridge: Entity = {
      ...bridge,
      battlefield: { bridgeSite: "TOP", bridgeState: "destroyed", buildRemaining: 2 },
    };
    const effects = new BattlefieldReplayEffectIndex(replay([
      {
        type: "facility-state", tick: 1, order: 1, entityId: bridge.id,
        battlefield: { bridgeSite: "TOP", bridgeState: "destroyed", buildRemaining: 0 },
      },
      {
        type: "facility-state", tick: 2, order: 1, entityId: bridge.id,
        battlefield: { bridgeSite: "TOP", bridgeState: "normal", buildRemaining: 0 },
      },
      {
        type: "facility-state", tick: 3, order: 1, entityId: bridge.id,
        battlefield: { bridgeSite: "TOP", bridgeState: "destroyed", buildRemaining: 0 },
      },
    ], [hero, damagedBridge, observation]));

    expect(effects.at(1, bridge.id).map((cue) => cue.channel)).toEqual(["bridge-work-stopped"]);
    expect(effects.at(2, bridge.id).map((cue) => cue.channel)).toEqual(["bridge-rebuilt"]);
    expect(effects.at(3, bridge.id).map((cue) => cue.channel)).toEqual(["bridge-destroyed"]);
  });
});
