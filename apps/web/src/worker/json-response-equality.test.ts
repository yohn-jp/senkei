import { describe, expect, it } from "vitest";
import { canonicalJson } from "./input-identity";
import { sameJsonResponse } from "./json-response-equality";

describe("complete reproduction response equality", () => {
  it.each([
    [{ a: 1, b: [null, "x"] }, { b: [null, "x"], a: 1 }, true],
    [{ absent: undefined }, {}, true],
    [[undefined], [null], true],
    [-0, 0, true],
    [NaN, null, true],
    [Infinity, null, true],
    [{ "𐀀": 1, "\ue000": 2, "10": 3, "2": 4 }, { "2": 4, "10": 3, "\ue000": 2, "𐀀": 1 }, true],
    [{ a: null }, {}, false],
    [[1, 2], [2, 1], false],
    [[1], [1, null], false],
    [{ a: 1 }, { a: "1" }, false],
    [{ a: 1 }, { b: 1 }, false],
    [[], {}, false],
  ])("preserves JSON value semantics for %j and %j", (left, right, equal) => {
    expect(sameJsonResponse(left, right)).toBe(equal);
    expect(sameJsonResponse(left, right)).toBe(canonicalJson(left) === canonicalJson(right));
  });

  it("rejects unsupported values rather than silently equating them", () => {
    expect(() => sameJsonResponse(undefined, undefined)).toThrow();
    for (const value of [() => 1, Symbol("private"), BigInt(1)]) {
      expect(() => sameJsonResponse({ payload: [value] }, { payload: [value] })).toThrow();
    }
    expect(() => sameJsonResponse(new Array(1), new Array(1))).toThrow();
  });

  it("detects changes at the end of every retained response channel", () => {
    const row = { tick: 577, value: { hp: 10, lane: "mid" } };
    const original = {
      authorized_side: "attacker", result: { final_state_digest: "state" },
      presentation_replay: { frames: Array.from({ length: 1000 }, () => structuredClone(row)) },
      owner_replay: { frames: [structuredClone(row)] }, owner_replays: { attacker: { frames: [structuredClone(row)] } },
      restricted_diagnostics: { identity: { snapshot_digest: "input" }, events: [structuredClone(row)], final_memory_by_side: { attacker: { last: 1 } } },
    };
    expect(sameJsonResponse(original, structuredClone(original))).toBe(true);
    const mutations = [
      (v: typeof original) => { v.authorized_side = "defender"; },
      (v: typeof original) => { v.result.final_state_digest = "other"; },
      (v: typeof original) => { v.presentation_replay.frames.at(-1)!.value.hp = 0; },
      (v: typeof original) => { v.owner_replay.frames[0].value.hp = 0; },
      (v: typeof original) => { v.owner_replays.attacker.frames[0].value.hp = 0; },
      (v: typeof original) => { v.restricted_diagnostics.identity.snapshot_digest = "other"; },
      (v: typeof original) => { v.restricted_diagnostics.events[0].value.hp = 0; },
      (v: typeof original) => { v.restricted_diagnostics.final_memory_by_side.attacker.last = 2; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(original);
      mutate(changed);
      expect(sameJsonResponse(original, changed)).toBe(false);
    }
  });
});
