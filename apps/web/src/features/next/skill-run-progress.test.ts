import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { deriveSkillRunProgress, type SkillRunProgressInput } from "./skill-run-progress";
import { SkillRunProgressContext } from "./SkillRunProgressContext";
const string = (value: string) => ({ kind: "string" as const, value });
const slot = { slot_id: "exact slot", catalog_id: "F01", skill_path: "path_a", squad: "solo", node: "A.BASE" };
const ruleset = { id: "rules", digest: "digest", version: { major: 1, minor: 0, patch: 0 } };
const hero = { id: "F01", skill_paths: { path_a: ["first", "second"], path_b: ["other"] }, skills: [
  { id: "first", name: "First", unlock_level: 2, prerequisites: [] },
  { id: "second", name: "Second", unlock_level: 4, prerequisites: ["first"] },
  { id: "other", name: "Other", unlock_level: 2, prerequisites: [] },
] };
function input(): SkillRunProgressInput {
  return { experimentId: "run-1", matchId: "match", ruleset, authorizedSide: "attacker", tick: 2, slot, hero,
    submittedHeroes: { kind: "list", value: [{ kind: "record", value: Object.fromEntries(Object.entries(slot).map(([key, value]) => [key, string(value)])) }] },
    ownerReplay: { match_id: "match", ruleset, perspective: "attacker", frames: [{ tick: 2, visible_state: { entities: {
      opaque: { entity_type: "hero", owner: "attacker", fields: { slot_id: string(slot.slot_id), catalog_id: string(slot.catalog_id), skill_path: string(slot.skill_path), level: { kind: "integer", value: 6 }, skills: { kind: "list", value: [string("first")] } } },
    } } }] } } as unknown as SkillRunProgressInput;
}
describe("Run skill progress", () => {
  it("renders actual native owner observations before and after acquisition without consulting future frames", () => {
    const source = JSON.parse(readFileSync("tests/fixtures/s06-actual-owner-frames.json", "utf8"));
    const before = deriveSkillRunProgress({ ...source, tick: 0 });
    const after = deriveSkillRunProgress({ ...source, tick: 85 });
    expect(before.status).toBe("known"); expect(after.status).toBe("known");
    expect(before.skills.filter(skill => skill.acquisition === "acquired")).toHaveLength(0);
    expect(after.skills.filter(skill => skill.acquisition === "acquired").map(skill => skill.id)).toEqual(["f02_a_passive"]);
    expect(before.skills.find(skill => skill.id === "f02_a_active")?.missingPrerequisiteIds).toEqual(["f02_a_passive"]);
    expect(after.skills.find(skill => skill.id === "f02_a_active")?.missingPrerequisiteIds).toEqual([]);
    const html = renderToStaticMarkup(createElement(SkillRunProgressContext, { progress: after }));
    expect(html).toContain("Tick 85"); expect(html).toContain("Acquired");
    expect(deriveSkillRunProgress({ ...source, tick: 84 }).status).toBe("unavailable");
  });
  it("keeps observed acquisitions independent of planned branch and level", () => {
    const source = input(), before = JSON.stringify(source), result = deriveSkillRunProgress(source);
    expect(result.status).toBe("known");
    expect(result.skills.map(node => [node.id, node.planned, node.acquisition, node.missingPrerequisiteIds])).toEqual([
      ["first", true, "acquired", []], ["second", true, "not_acquired", []], ["other", false, "not_acquired", []],
    ]);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("treats absent authorization, frame, ambiguous identity and changed plan as unknown", () => {
    for (const change of [ { authorizedSide: undefined }, { ownerReplay: null }, { tick: 1 }, { matchId: "different" }, { slot: { ...slot, skill_path: "path_b" } } ]) {
      const result = deriveSkillRunProgress({ ...input(), ...change });
      expect(result.status).toBe("unavailable");
      expect(result.skills.every(node => node.acquisition === "unknown")).toBe(true);
    }
    const source = input(), frame = source.ownerReplay!.frames[0];
    const entities = frame.visible_state!.entities;
    expect(deriveSkillRunProgress({ ...source, ownerReplay: { ...source.ownerReplay!, frames: [{ ...frame, visible_state: { ...frame.visible_state!, entities: { ...entities, duplicate: entities.opaque } } }] } }).status).toBe("unavailable");
  });
  it("shows immutable Run identity and text states without acquisition controls", () => {
    const html = renderToStaticMarkup(createElement(SkillRunProgressContext, { progress: deriveSkillRunProgress(input()) }));
    expect(html).toContain("match"); expect(html).toContain("Tick 2"); expect(html).toContain("Acquired"); expect(html).toContain("Not acquired");
    expect(html).not.toContain("<button");
    const unknown = renderToStaticMarkup(createElement(SkillRunProgressContext, { progress: deriveSkillRunProgress({ ...input(), ownerReplay: null }) }));
    expect(unknown).toContain("Unavailable"); expect(unknown).toContain("Unknown");
  });
});
