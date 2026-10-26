import { createServer } from "vite";
import { expect, test } from "@playwright/test";
import { campaignCore } from "../helpers/campaign-core";

test("Starter source preserves quoted, backslash, Unicode and control slot IDs through real Core parsing and compilation", async () => {
  const core = await campaignCore();
  const rules = core("next_ruleset", {});
  const server = await createServer({ configFile: false, root: process.cwd(), logLevel: "silent", server: { middlewareMode: true }, appType: "custom" });
  try {
    const { createStarterJinrei, parseFormationSlots } = await server.ssrLoadModule("/apps/web/src/features/next/NextWorkspace.tsx");
    const ids = ['quote"', "back\\slash", "狼🐺", "line\n\r\ttab", "control\b\f\u0001"];
    const slots = rules.next.heroes.slice(0, 5).map((hero: any, index: number) => ({ slot_id: ids[index], catalog_id: hero.id, skill_path: "path_a", squad: "alpha", node: "A.BASE" }));
    expect(parseFormationSlots(slots)).toEqual(slots);
    const source = createStarterJinrei(rules, "attacker", slots);
    const ast = core("parse_text", { ruleset_ref: rules.ruleset, source });
    const strings: string[] = [];
    const collect = (value: any): void => {
      if (value && typeof value === "object") {
        if (value.kind === "string" && typeof value.value === "string") strings.push(value.value);
        Object.values(value).forEach(collect);
      }
    };
    collect(ast);
    expect(strings).toEqual(expect.arrayContaining(ids));
    const compiled = core("compile_text", { ruleset_ref: rules.ruleset, source });
    expect(compiled.program.ruleset.digest).toBe(rules.ruleset.digest);
  } finally { await server.close(); }
});

test("Actual Core verifies authored Campaign association and rejects a custom NPC or context without mutating it", async () => {
  const { nativeCampaignFixture } = await import("../helpers/native-campaign-fixture");
  const fixture = await nativeCampaignFixture();
  const core = await campaignCore();
  const server = await createServer({ configFile: false, root: process.cwd(), logLevel: "silent", server: { middlewareMode: true }, appType: "custom" });
  try {
    const { verifyCampaignAssociation } = await server.ssrLoadModule("/apps/web/src/features/next/NextWorkspace.tsx");
    const { createNextCampaignScenarios } = await server.ssrLoadModule("/scenarios/next/campaign.ts");
    const bridge = { compile: async (request: any) => core("compile_text", { source: request.source, ruleset_ref: request.ruleset_ref }), newMatchContext: async (ruleset_ref: any, match_id: string) => core("new_match_context", { ruleset_ref, match_id }) };
    const scenarios = createNextCampaignScenarios(fixture.rules);
    const setup = { campaign_scenario_id: fixture.scenario.id };
    expect(await verifyCampaignAssociation(bridge, fixture.rules, scenarios, setup, fixture.snapshot)).toMatchObject({ eligible: true });
    const changed = structuredClone(fixture.snapshot);
    changed.context.max_ticks -= 1;
    expect(await verifyCampaignAssociation(bridge, fixture.rules, scenarios, setup, changed)).toMatchObject({ eligible: false, reason: expect.stringContaining("context") });
    const custom = structuredClone(fixture.snapshot);
    custom.defender.program = core("compile_text", { ruleset_ref: fixture.rules.ruleset, source: "senkei observe { state present { true }, }" }).program;
    expect(await verifyCampaignAssociation(bridge, fixture.rules, scenarios, setup, custom)).toMatchObject({ eligible: false, reason: expect.stringContaining("opponent") });
    expect(changed.context.max_ticks).toBe(fixture.snapshot.context.max_ticks - 1);
  } finally { await server.close(); }
});
