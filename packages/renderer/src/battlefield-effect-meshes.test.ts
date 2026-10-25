import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { DisplayState, Entity, Event, Replay } from "@senkei/replay-contract";
import { BattlefieldReplayEffectIndex } from "./battlefield-replay-effects";
import { buildBattlefieldTransitionEffects } from "./battlefield-effect-meshes";

const hero: Entity = {
  id: "hero",
  side: "azure",
  kind: "unit",
  archetype: "hero",
  appearanceKey: "hero-vanguard",
  position: { x: 2, y: 0 },
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
  position: { x: 4, y: 0 },
  hp: 500,
  maxHp: 500,
  battlefield: { bridgeSite: "TOP", bridgeState: "normal", buildRemaining: 0 },
};

const observation: Entity = {
  id: "observation.MID",
  side: "azure",
  kind: "observation",
  archetype: "observation",
  appearanceKey: "observation",
  position: { x: 6, y: 2 },
  hp: 1,
  maxHp: 1,
  battlefield: { captureProgress: 1, captureSide: "azure", facilityOwner: "neutral" },
};

function replay(timeline: Event[], initialView: Entity[] = [hero, bridge, observation]): Replay {
  return {
    header: { origin: "local", title: "Test", enbuVersion: "1.0.0", senritsu: { id: "s", digest: "d" }, view: "public" },
    presentation: { coordinates: "x-right-y-down", assetCatalogVersion: "test", tickDurationMs: 100 },
    scene: {
      bounds: { min: { x: 0, y: -2 }, max: { x: 10, y: 8 } },
      lanes: [{ id: "top", label: "TOP", elevation: 0.1, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
      routes: [{ id: "bridge-top", region: "lane", bridgeSite: "TOP", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
      captureTicks: 4,
    },
    initialView,
    timeline,
    result: { winner: "azure", reason: "test", tick: 1 },
  } as unknown as Replay;
}

function displayState(tick: number, entities: Entity[] = [hero, bridge, observation]): DisplayState {
  return {
    tick,
    entities: Object.fromEntries(entities.map((entity) => [entity.id, { ...entity, destroyed: false }])),
    cues: [],
    result: null,
  } as unknown as DisplayState;
}

describe("Replay-confirmed battlefield transition meshes", () => {
  it("creates no mesh when there is no cue", () => {
    const replayValue = replay([]);
    const parent = new THREE.Group();

    buildBattlefieldTransitionEffects(parent, replayValue, displayState(1), []);

    expect(parent.children).toHaveLength(0);
  });

  it("renders a visible crossing at the observed unit point and tags its channel/tick", () => {
    const destination = { node: "A", edgeTo: "B", progress: 3, crossing: "bridge" as const };
    const crossing: Event = {
      type: "move", tick: 1, order: 7, entityId: hero.id,
      position: { x: 3, y: 0 }, logicalPosition: destination,
    };
    const replayValue = replay([crossing]);
    const effects = new BattlefieldReplayEffectIndex(replayValue).at(1, hero.id);
    const parent = new THREE.Group();
    const visibleHero = { ...hero, position: crossing.position, battlefield: destination };

    buildBattlefieldTransitionEffects(parent, replayValue, displayState(1, [visibleHero]), effects);

    const group = parent.children[0] as THREE.Group;
    expect(group.name).toContain("crossing-start");
    expect(group.position.x).toBe(3);
    expect(group.position.z).toBe(0);
    expect(group.userData).toMatchObject({
      replayTransition: true,
      transitionChannel: "crossing-start",
      transitionTick: 1,
      transitionOrder: 7,
      transitionEntityId: hero.id,
      transitionDurationMs: 300,
    });
    expect(group.children.some((child) => child.name === "crossing-surface-marker")).toBe(true);
  });

  it("renders only supported bridge-work and capture facts at their visible facilities", () => {
    const bridgeState = { bridgeSite: "TOP" as const, bridgeState: "normal" as const, buildRemaining: 2 };
    const captureState = { captureProgress: 2, captureSide: "azure" as const, facilityOwner: "neutral" as const };
    const events: Event[] = [
      { type: "facility-state", tick: 1, order: 1, entityId: bridge.id, battlefield: bridgeState },
      { type: "facility-state", tick: 1, order: 2, entityId: observation.id, battlefield: captureState },
    ];
    const replayValue = replay(events);
    const cues = new BattlefieldReplayEffectIndex(replayValue).at(1);
    const parent = new THREE.Group();
    const visible = displayState(1, [
      { ...bridge, battlefield: bridgeState },
      { ...observation, battlefield: captureState },
    ]);

    buildBattlefieldTransitionEffects(parent, replayValue, visible, cues);

    expect(parent.children.map((child) => child.name)).toEqual([
      `battlefield-effect-bridge-work-started-${bridge.id}-1-1`,
      `battlefield-effect-capture-progress-${observation.id}-1-2`,
    ]);
    expect((parent.children[0] as THREE.Group).children.map((child) => child.name)).toContain("bridge-work-crosspiece");
    expect((parent.children[1] as THREE.Group).children.map((child) => child.name)).toContain("capture-progress-pillar");
  });

  it("shows transient splinter geometry only for a Replay-confirmed bridge destruction", () => {
    const destroyedState = { bridgeSite: "TOP" as const, bridgeState: "destroyed" as const, buildRemaining: 0 };
    const event: Event = {
      type: "facility-state", tick: 1, order: 4, entityId: bridge.id, battlefield: destroyedState,
    };
    const replayValue = replay([event]);
    const effects = new BattlefieldReplayEffectIndex(replayValue).at(1, bridge.id);
    const parent = new THREE.Group();

    buildBattlefieldTransitionEffects(parent, replayValue, displayState(1, [
      { ...bridge, hp: 0, battlefield: destroyedState },
    ]), effects);

    const group = parent.children[0] as THREE.Group;
    expect(group.name).toContain("bridge-destroyed");
    expect(group.children.filter((child) => child.name.startsWith("bridge-break-shard-"))).toHaveLength(5);
  });

  it("does not create transition geometry for a missing entity or a nonmatching Replay fact", () => {
    const destination = { node: "A", edgeTo: "B", progress: 3, crossing: "bridge" as const };
    const crossing: Event = {
      type: "move", tick: 1, order: 1, entityId: hero.id,
      position: { x: 3, y: 0 }, logicalPosition: destination,
    };
    const replayValue = replay([crossing]);
    const cue = new BattlefieldReplayEffectIndex(replayValue).at(1, hero.id);
    const hiddenParent = new THREE.Group();
    buildBattlefieldTransitionEffects(hiddenParent, replayValue, displayState(1, [bridge]), cue);
    expect(hiddenParent.children).toHaveLength(0);

    const unverifiedParent = new THREE.Group();
    const forgedCue = [{ ...cue[0]!, order: 10 }];
    buildBattlefieldTransitionEffects(unverifiedParent, replayValue, displayState(1), forgedCue);
    expect(unverifiedParent.children).toHaveLength(0);
  });
});
