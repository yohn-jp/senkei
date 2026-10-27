import { describe, it, expect } from "vitest";
import { decodeReplay, type PresentationReplay } from "@senkei/replay-contract";
import { ReplayPlayer, stateAt } from "./index";
import basic from "../../replay-contract/fixtures/basic-three-lane.json";
import clash from "../../replay-contract/fixtures/clash-and-loss.json";
import tower from "../../replay-contract/fixtures/tower-collapse.json";
describe("read-only replay projection and transport", () => {
  it.each([basic, clash, tower])(
    "direct and reverse seeks equal sequential playback at every tick",
    (data) => {
      const replay = decodeReplay(data),
        player = new ReplayPlayer(replay),
        states = [];
      states.push(player.state);
      player.play();
      for (let tick = 1; tick <= 28; tick++) {
        player.advance(400);
        expect(player.state.tick).toBe(tick);
        expect(player.state).toEqual(stateAt(replay, tick));
        states.push(player.state);
      }
      expect(player.playing).toBe(false);
      for (let tick = 28; tick >= 0; tick--) {
        player.seek(tick);
        expect(player.state).toEqual(states[tick]);
      }
    },
  );
  it("applies same-tick attack/damage/destruction without calculating combat", () => {
    const r = decodeReplay(tower);
    expect(stateAt(r, 13).entities["vermilion-mid-infantry"].hp).toBe(35);
    const dead = stateAt(r, 14).entities["vermilion-mid-infantry"];
    expect(dead.hp).toBe(0);
    expect(dead.destroyed).toBe(true);
    expect(stateAt(r, 14).entities["vermilion-mid-archer"]).toBeDefined();
    expect(stateAt(r, 15).entities["vermilion-mid-archer"]).toBeUndefined();
    expect(stateAt(r, 16).entities["azure-reinforcement"].position).toEqual({
      x: -7,
      y: 0,
    });
    expect(stateAt(r, 21).entities["vermilion-mid-tower"].hp).toBe(100);
    expect(stateAt(r, 23).entities["vermilion-mid-tower"].destroyed).toBe(true);
    expect(stateAt(r, 27).result).toBeNull();
    expect(stateAt(r, 28).result).toEqual(r.result);
  });
  it("does not infer HP from an attack cue", () => {
    const data = structuredClone(clash);
    data.timeline = data.timeline.filter(
      (e) => !["damage", "destroy"].includes(e.type),
    );
    expect(
      stateAt(decodeReplay(data), 14).entities["vermilion-mid-infantry"].hp,
    ).toBe(100);
  });
  it("replays logical positions and authorized facility state at the recorded tick", () => {
    const replay = structuredClone(basic) as unknown as PresentationReplay;
    replay.schemaVersion = "0.3";
    replay.scene.nodes = [{ id: "A.BASE", allegiance: "A", position: { x: 0, y: 0 } }];
    replay.scene.routes = [{ id: "edge-top", region: "lane", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], bridgeSite: "TOP" }];
    replay.initialView.push({
      id: "top-bridge", side: "neutral", kind: "bridge", archetype: "bridge", appearanceKey: "bridge",
      position: { x: 0, y: 0 }, hp: 500, maxHp: 500,
      battlefield: { bridgeSite: "TOP", bridgeState: "normal" },
    });
    replay.initialView.push({ id: "mid-observation", side: "neutral", kind: "observation", archetype: "observation", appearanceKey: "observation",
      position: { x: 0, y: 0 }, hp: 1, maxHp: 1, battlefield: { facilityOwner: "neutral", captureProgress: 0 } });
    const end = replay.timeline.find(event => event.type === "match-end");
    if (end?.type === "match-end") end.order = 1;
    const facilityEvent = {
      type: "facility-state", tick: replay.result.tick, order: 0, entityId: "top-bridge",
      battlefield: { bridgeSite: "TOP", bridgeState: "destroyed", buildRemaining: 0 },
    } as const;
    const damageEvent = { type: "damage", tick: replay.result.tick, order: 1, entityId: "top-bridge", hp: 0 } as const;
    if (end?.type === "match-end") end.order = 3;
    const captureEvent = { type: "facility-state", tick: replay.result.tick, order: 2, entityId: "mid-observation",
      battlefield: { facilityOwner: "azure", captureProgress: 0 } } as const;
    replay.timeline.splice(replay.timeline.indexOf(end!), 0, facilityEvent, damageEvent, captureEvent);
    const state = stateAt(decodeReplay(replay), replay.result.tick);
    expect(stateAt(decodeReplay(replay), 0).entities["mid-observation"].side).toBe("neutral");
    expect(state.entities["mid-observation"].side).toBe("azure");
    expect(state.entities["top-bridge"]).toMatchObject({ hp: 0, maxHp: 500, destroyed: false, battlefield: {
      bridgeSite: "TOP", bridgeState: "destroyed", buildRemaining: 0,
    } });
  });
  it("pauses without consuming time, seeks, resumes, resets and restarts at end", () => {
    const p = new ReplayPlayer(decodeReplay(tower));
    p.advance(4000);
    expect(p.state.tick).toBe(0);
    p.play();
    p.advance(600);
    expect(p.state.tick).toBe(1);
    p.pause();
    p.advance(9000);
    expect(p.state.tick).toBe(1);
    p.play();
    p.advance(200);
    expect(p.state.tick).toBe(2);
    p.seek(21);
    expect(p.playing).toBe(true);
    p.advance(400);
    expect(p.state.tick).toBe(22);
    p.reset();
    expect(p.state.tick).toBe(0);
    expect(p.playing).toBe(false);
    p.seek(28);
    p.play();
    expect(p.state.tick).toBe(0);
  });
  it("supports 1x/2x/4x independently of time chunking and caps at result", () => {
    for (const rate of [1, 2, 4]) {
      const p = new ReplayPlayer(decodeReplay(tower));
      p.setSpeed(rate);
      p.play();
      p.advance(200);
      p.advance(200);
      expect(p.state.tick).toBe(rate);
      p.advance(100000);
      expect(p.state.tick).toBe(28);
      expect(p.playing).toBe(false);
    }
  });
  it("keeps prior snapshots immutable through forward, repeated and backward seeks", () => {
    const replay = decodeReplay(tower);
    const player = new ReplayPlayer(replay);
    player.seek(13);
    const saved = player.state;
    const original = structuredClone(saved);
    for (const tick of [13, 18, 28, 4, 4, 23, 0, 15]) {
      player.seek(tick);
      expect(player.state).toEqual(stateAt(replay, tick));
      expect(saved).toEqual(original);
    }
    expect(Object.isFrozen(saved.entities)).toBe(true);
    expect(Object.isFrozen(saved.entities["vermilion-mid-infantry"])).toBe(true);
  });
  it("reads each timeline event only a bounded number of times during forward playback", () => {
    const replay = decodeReplay(tower);
    let reads = 0;
    const timeline = new Proxy(replay.timeline, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const player = new ReplayPlayer({ ...replay, timeline });
    player.play();
    for (let tick = 1; tick <= replay.result.tick; tick++) {
      player.advance(replay.presentation.tickDurationMs);
      expect(player.state).toEqual(stateAt(replay, tick));
    }
    expect(reads).toBeLessThanOrEqual(3 * timeline.length + 2 * replay.result.tick + 2);
  });
  it("rejects invalid cursor/time/speed and freezes output", () => {
    const p = new ReplayPlayer(decodeReplay(tower));
    for (const t of [-1, 0.5, 29, NaN]) expect(() => p.seek(t)).toThrow();
    for (const t of [-1, Infinity, NaN]) expect(() => p.advance(t)).toThrow();
    expect(() => p.setSpeed(3)).toThrow();
    expect(() => {
      (p.state.entities["azure-base"] as { hp: number }).hp = 1;
    }).toThrow();
  });
  it("emits state changes and unsubscribes", () => {
    const p = new ReplayPlayer(decodeReplay(tower));
    let count = 0;
    const unsub = p.subscribe(() => count++);
    p.play();
    p.advance(400);
    p.pause();
    expect(count).toBe(3);
    unsub();
    p.reset();
    expect(count).toBe(3);
  });
});

it("keeps a zero-tick completed replay stopped", () => {
  const input = structuredClone(basic);
  input.result.tick = 0;
  input.timeline = [
    { type: "match-end", tick: 0, order: 0, result: input.result },
  ];
  const player = new ReplayPlayer(decodeReplay(input));
  player.play();
  expect(player.playing).toBe(false);
  expect(player.state.result).toEqual(input.result);
});
