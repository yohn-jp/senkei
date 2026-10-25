import { describe, expect, it } from "vitest";
import type { DomainValue } from "../../../apps/web/src/contracts/core-model";
import { EDGE_SAMPLE_COUNT, FogReplayError, parseFogReplayValue } from "./fog";

const string = (value: string): DomainValue => ({ kind: "string", value });
const integer = (value: number): DomainValue => ({ kind: "integer", value });
const record = (value: Record<string, DomainValue>): DomainValue => ({ kind: "record", value });
const list = (value: DomainValue[]): DomainValue => ({ kind: "list", value });

function fogValue(facilities: DomainValue[] = []): DomainValue {
  return record({
    schema_version: integer(1),
    tick: integer(8),
    side: string("attacker"),
    nodes: record({ lane_a: string("visible"), lane_b: string("explored"), lane_c: string("unexplored") }),
    edges: record({ main: list(Array.from({ length: EDGE_SAMPLE_COUNT }, (_, index) => string(index < 3 ? "visible" : "unexplored"))) }),
    facilities: list(facilities),
  });
}

describe("fog replay projection", () => {
  it("parses side-scoped nodes and uniformly sampled edges from DomainValue records", () => {
    const fog = parseFogReplayValue(fogValue(), 8, "attacker");
    expect(fog?.nodes).toEqual({ lane_a: "visible", lane_b: "explored", lane_c: "unexplored" });
    expect(fog?.edges.main).toHaveLength(EDGE_SAMPLE_COUNT);
    expect(fog?.side).toBe("attacker");
  });

  it("parses neutral, site-based facility history with optional last observed state", () => {
    const facility = record({
      id: string("facility-1"),
      state: string("last_known"),
      kind: string("bridge"),
      side: string("neutral"),
      site: string("TOP"),
      last_seen_tick: integer(7),
      facility_state: record({
        bridge_state: string("normal"),
        hp: integer(90),
        max_hp: integer(100),
      }),
    });
    expect(parseFogReplayValue(fogValue([facility]))?.facilities).toEqual([{
      id: "facility-1", state: "last_known", kind: "bridge", side: "neutral", site: "TOP", last_seen_tick: 7,
      facility_state: { bridge_state: "normal", hp: 90, max_hp: 100 },
    }]);
  });

  it("keeps old replays compatible and rejects unit ghosts or unapproved facility state", () => {
    expect(parseFogReplayValue(undefined, 8, "attacker")).toBeUndefined();
    expect(parseFogReplayValue({ kind: "null" }, 8, "attacker")).toBeUndefined();
    expect(() => parseFogReplayValue(fogValue(), 9, "attacker")).toThrow(FogReplayError);
    expect(() => parseFogReplayValue(fogValue(), 8, "defender")).toThrow(FogReplayError);

    const unitGhost = record({
      id: string("facility-1"), state: string("last_known"), kind: string("hero"),
      side: string("defender"), site: string("a"), last_seen_tick: integer(7),
    });
    expect(() => parseFogReplayValue(fogValue([unitGhost]), 8, "attacker")).toThrow(/facility type/);

    const privateState = record({
      id: string("facility-1"), state: string("last_known"), kind: string("bridge"),
      side: string("neutral"), site: string("TOP"), last_seen_tick: integer(7),
      facility_state: record({ hp: integer(90), attack: integer(12) }),
    });
    expect(() => parseFogReplayValue(fogValue([privateState]), 8, "attacker")).toThrow(/outside the Fog Replay contract/);
  });
});
