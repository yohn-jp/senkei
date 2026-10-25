import { expect, it } from "vitest";
import type { DomainValue, MatchResult, PresentationReplay, RulePackage } from "../../../apps/web/src/contracts/core-model";
import { presentationToGraphics } from "./next-adapter";
const value = (x: unknown): DomainValue => {
  if (typeof x === "number") return { kind: "integer", value: x };
  if (typeof x === "string") return { kind: "string", value: x };
  if (Array.isArray(x)) return { kind: "list", value: x.map(value) };
  return { kind: "record", value: Object.fromEntries(Object.entries(x as object).map(([k, v]) => [k, value(v)])) };
};
it("projects side-authorized fog with public geometry while retaining no hidden entities", () => {
  const rules = { ruleset: { id: "next", digest: "a".repeat(64) }, minimum_engine_version: { major: 1, minor: 2, patch: 0 }, next: { parameters: {}, heroes: [], camps: [], map: {
    attacker_base: "a", defender_base: "b", nodes: { a: { x: 0, y: 0, region: "base" }, b: { x: 250, y: 250, region: "base" } },
    lanes: { mid: ["a", "b"] }, edges: [{ id: "r", from: "a", to: "b", length: 500, region: "lane", blocked: false }],
  } } } as unknown as RulePackage;
  const fog = { schema_version: 1, tick: 0, side: "attacker", nodes: { a: "visible", b: "unexplored" }, edges: { r: Array(9).fill("unexplored") }, facilities: [] };
  const source = { schema_version: { major: 1, minor: 0, patch: 0 }, perspective: "attacker", match_id: "m", frames: [{ tick: 0, events: [], visible_state: { entities: {}, global_fields: { fog: value(fog) } } }] } as unknown as PresentationReplay;
  const result = { match_id: "m", final_tick: 1, outcome: "draw", termination_reason: "limit" } as unknown as MatchResult;
  const replay = presentationToGraphics(source, rules, result);
  expect(replay.fog?.frames[0].nodes.b).toBe("unexplored");
  expect(replay.fog?.worldUnitsPerRenderUnit).toBe(25);
  expect(replay.initialView).toEqual([]);
  expect(replay.timeline.map(event => event.type)).toEqual(["match-end"]);
  expect(() => presentationToGraphics({ ...source, perspective: undefined }, rules, result)).toThrow("authorized");
});
