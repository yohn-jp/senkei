import { describe, expect, it } from "vitest";
import type { MatchResult, RulePackage } from "../../contracts/core-model";
import { createNextCampaignScenarios, getNextCampaignRunFeedback } from "../../../../../scenarios/next/campaign";
import sourceFixtures from "../../../../../scenarios/next/source-fixtures.json";

const ruleset = {
  ruleset: { id: "senkei.next", version: { major: 2, minor: 0, patch: 0 }, digest: "test" },
  model_version: { major: 1, minor: 0, patch: 0 },
  next: {
    heroes: [
      ...["F01", "F02", "F03", "F04", "F05", "F06", "R01", "R02", "R03", "R04", "R05", "R06"].map((id) => ({
        id,
        skill_paths: { path_a: ["passive", "active"], path_b: ["other-passive", "other-active"] },
      })),
    ],
    map: { attacker_base: "A.BASE", defender_base: "B.BASE" },
  },
} as unknown as RulePackage;

function result(outcome: MatchResult["outcome"], termination_reason: string): MatchResult {
  return {
    match_id: "campaign-test",
    outcome,
    termination_reason,
    final_tick: 42,
    statistics: {},
    cu_spent: { attacker: 1, defender: 1 },
    final_state_digest: "digest",
  };
}

describe("Next authored PvE campaign", () => {
  it("prepares six ordered recipes with complete five-Hero NPC drafts", () => {
    const scenarios = createNextCampaignScenarios(ruleset);
    expect(scenarios.map(({ id }) => id)).toEqual([
      "first-march", "read-the-map", "share-the-pressure", "jungle-objective", "bridge-approach", "protect-the-core",
    ]);
    expect(scenarios.map(({ npc }) => npc.program_input.kind === "text" ? npc.program_input.source : "")).toEqual(
      sourceFixtures.map(({ source }) => source),
    );
    for (const scenario of scenarios) {
      expect(scenario.npc.configuration.heroes).toMatchObject({ kind: "list" });
      const heroes = (scenario.npc.configuration.heroes as { kind: "list"; value: readonly { kind: "record"; value: Record<string, { kind: string; value: unknown }> }[] }).value;
      expect(heroes).toHaveLength(5);
      expect(heroes.every((hero) => typeof hero.value.node.value === "string" && typeof hero.value.skill_path.value === "string")).toBe(true);
      expect(scenario.criteria.length).toBeGreaterThan(0);
    }
  });

  it("rejects incompatible packages and reports measured match outcomes", () => {
    expect(() => createNextCampaignScenarios({ ...ruleset, ruleset: { ...ruleset.ruleset, id: "senkei.initial" } })).toThrow(/senkei.next/);
    expect(getNextCampaignRunFeedback(result("attacker_victory", "base_destroyed"))).toMatchObject({
      status: "victory",
      headline: "Victory: the opposing base was destroyed.",
      final_tick: 42,
    });
    expect(getNextCampaignRunFeedback(result("draw", "time_limit"))).toMatchObject({
      status: "draw",
      headline: "Draw: neither side won the match.",
      final_tick: 42,
    });
    expect(getNextCampaignRunFeedback(result("defender_victory", "base_destroyed")).status).toBe("defeat");
  });
});
