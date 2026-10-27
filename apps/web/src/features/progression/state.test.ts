import { describe, expect, it } from "vitest";
import { readCollection, transition } from "./state";

describe("progression state boundaries", () => {
  it("distinguishes unavailable, empty, filtered empty, failure and denial", () => {
    expect(readCollection({ kind: "unconnected" })).toEqual({ kind: "unconnected" });
    expect(readCollection({ kind: "not-fetched" })).toEqual({ kind: "not-fetched" });
    expect(readCollection({ kind: "failed", reason: "offline" })).toEqual({ kind: "failed", reason: "offline" });
    expect(readCollection({ kind: "denied" })).toEqual({ kind: "denied" });
    expect(readCollection({ kind: "loaded", items: [], visible: [] }).kind).toBe("empty");
    expect(readCollection({ kind: "loaded", items: [1], visible: [] }).kind).toBe("filtered-empty");
    expect(readCollection({ kind: "loaded", items: [1], visible: [1] }).kind).toBe("ready");
  });
  it("cancels a preview without modifying its payload", () => {
    const payload = { equipment: ["a"] };
    const result = transition({ kind: "review", payload }, { kind: "cancel" }, Object.is);
    expect(result).toEqual({ kind: "cancelled", payload });
    expect(payload).toEqual({ equipment: ["a"] });
  });
  it("inquires using the original request reference after an unknown result", () => {
    const ref = { request: "opaque" };
    const unknown = transition({ kind: "submitted", requestRef: ref }, { kind: "unknown", requestRef: ref }, Object.is);
    expect(transition(unknown, { kind: "inquire" }, Object.is)).toEqual({ kind: "inquiring", requestRef: ref });
    expect(() => transition(unknown, { kind: "submit", requestRef: { request: "second" } }, Object.is)).toThrow();
  });
  it("rejects responses for a different request in submitted and inquiry states", () => {
    for (const kind of ["submitted", "inquiring"] as const) {
      for (const event of [
        { kind: "unknown", requestRef: "other" } as const,
        { kind: "failed", requestRef: "other" } as const,
        { kind: "confirmed", requestRef: "other", result: 1 } as const,
      ]) expect(() => transition({ kind, requestRef: "original" }, event, Object.is)).toThrow();
      expect(transition({ kind, requestRef: "original" }, { kind: "confirmed", requestRef: "original", result: 1 }, Object.is).kind).toBe("confirmed");
    }
  });
  it("never treats unknown or unsupported transitions as success", () => {
    expect(() => transition({ kind: "unconnected" }, { kind: "confirmed", requestRef: "r", result: 1 }, Object.is)).toThrow();
    expect(() => transition({ kind: "decision-required" }, { kind: "confirmed", requestRef: "r", result: 1 }, Object.is)).toThrow();
    expect(() => transition({ kind: "unknown", requestRef: "r" }, { kind: "confirmed", requestRef: "r", result: 1 }, Object.is)).toThrow();
    expect(() => transition({ kind: "submitted", requestRef: "r" }, { kind: "bogus" } as never, Object.is)).toThrow();
  });
});
