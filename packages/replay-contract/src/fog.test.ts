import { describe, expect, it } from "vitest";
import type { DomainValue } from "../../../apps/web/src/contracts/core-model";
import { EDGE_SAMPLE_COUNT, FogReplayError, parseFogReplayValue } from "./fog";

const string = (value: string): DomainValue => ({ kind: "string", value });
const integer = (value: number): DomainValue => ({ kind: "integer", value });
const record = (value: Record<string, DomainValue>): DomainValue => ({ kind: "record", value });
const list = (value: DomainValue[]): DomainValue => ({ kind: "list", value });

function fogValue(contacts: DomainValue[] = []): DomainValue {
  return record({
    schema_version: integer(1),
    tick: integer(8),
    side: string("attacker"),
    nodes: record({ lane_a: string("visible"), lane_b: string("explored"), lane_c: string("unexplored") }),
    edges: record({ main: list(Array.from({ length: EDGE_SAMPLE_COUNT }, (_, index) => string(index < 3 ? "visible" : "unexplored"))) }),
    contacts: list(contacts),
  });
}

describe("fog replay projection", () => {
  it("parses side-scoped nodes and uniformly sampled edges from DomainValue records", () => {
    const fog = parseFogReplayValue(fogValue(), 8, "attacker");
    expect(fog?.nodes).toEqual({ lane_a: "visible", lane_b: "explored", lane_c: "unexplored" });
    expect(fog?.edges.main).toHaveLength(EDGE_SAMPLE_COUNT);
    expect(fog?.side).toBe("attacker");
  });

  it("parses only explicit last-known contact fields", () => {
    const contact = record({
      id: string("contact-1"),
      state: string("last_known"),
      kind: string("hero"),
      side: string("defender"),
      x: integer(40),
      y: integer(25),
      last_seen_tick: integer(7),
    });
    expect(parseFogReplayValue(fogValue([contact]))?.contacts).toEqual([{
      id: "contact-1", state: "last_known", kind: "hero", side: "defender", x: 40, y: 25, last_seen_tick: 7,
    }]);
  });

  it("keeps old replays compatible and rejects mismatched or private contact payloads", () => {
    expect(parseFogReplayValue(undefined, 8, "attacker")).toBeUndefined();
    expect(parseFogReplayValue({ kind: "null" }, 8, "attacker")).toBeUndefined();
    expect(() => parseFogReplayValue(fogValue(), 9, "attacker")).toThrow(FogReplayError);
    expect(() => parseFogReplayValue(fogValue(), 8, "defender")).toThrow(FogReplayError);

    const privateContact = record({
      id: string("contact-1"), state: string("last_known"), kind: string("hero"),
      side: string("defender"), x: integer(40), y: integer(25), last_seen_tick: integer(7),
      hp: integer(1),
    });
    expect(() => parseFogReplayValue(fogValue([privateContact]), 8, "attacker")).toThrow(/outside the Fog Replay contract/);
  });
});
