import { describe, expect, it } from "vitest";
import type { MatchContext, SenkeiSnapshot, SimulationSnapshot } from "../../contracts";
import { campaignConditionMismatch } from "./campaign-run-eligibility";
const npc = { id: "authored-npc", revision: "1", configuration: { heroes: { kind: "list", value: [] } }, program: { content_digest: "authored" }, initial_memory: {} } as unknown as SenkeiSnapshot;
const context = { match_id: "same-match", ruleset: { digest: "rules" }, max_ticks: 600, initial_world: { entities: { base: { hp: 100 } } }, host_limits: { max_entities: 100 }, versions: { engine: 1 } } as unknown as MatchContext;
const actual = { defender: npc, context, attacker: { configuration: { legal_own_choice: "varies" } } } as unknown as SimulationSnapshot;
describe("Canonical Campaign conditions", () => {
  it("matches exact authored opponent and same-match default context without restricting own legal setup", () => {
    expect(campaignConditionMismatch(actual, npc, context)).toBeNull();
    expect(campaignConditionMismatch({ ...actual, attacker: { ...actual.attacker, id: "different-own-draft" } } as SimulationSnapshot, npc, context)).toBeNull();
  });
  it("rejects relabeling a custom opponent as an authored Campaign", () => {
    for (const defender of [{ ...npc, program: { ...npc.program, content_digest: "custom" } }, { ...npc, initial_memory: { secret: { kind: "integer", value: 1 } } }, { ...npc, configuration: {} }]) {
      expect(campaignConditionMismatch({ ...actual, defender } as SimulationSnapshot, npc, context)).toContain("opponent");
    }
  });
  it("rejects changed initial world, limits, identity, versions or Match context without adjusting the snapshot", () => {
    for (const changed of [{ ...context, initial_world: {} }, { ...context, max_ticks: 1 }, { ...context, host_limits: {} }, { ...context, match_id: "different-match" }, { ...context, versions: {} }]) {
      expect(campaignConditionMismatch({ ...actual, context: changed } as SimulationSnapshot, npc, context)).toContain("context");
    }
    expect(actual.context).toBe(context);
  });
});
