import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "vite";

/** Bounded diagnosis only: never substitutes a candidate for a failed fixture. */
export async function diagnoseNativeCampaign() {
  const root = resolve(import.meta.dirname, "../../..");
  const binary = process.env.SENKEI_NATIVE_DISPATCHER;
  if (!binary) throw new Error("Native dispatcher is required for Campaign diagnosis.");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dispatch = (operation, payload) => {
    const request = { api_version: { major: 1, minor: 0, patch: 0 }, request_id: `campaign-diagnosis-${operation}`, operation, payload };
    const reply = JSON.parse(execFileSync(binary, [], { cwd: root, input: JSON.stringify(request) + "\n", maxBuffer: 256 * 1024 * 1024, timeout: 240_000 }).toString());
    if (!reply.ok) throw new Error(JSON.stringify(reply.error));
    return reply.result;
  };
  const server = await createServer({ configFile: false, root, logLevel: "silent", server: { middlewareMode: true }, appType: "custom" });
  try {
    const { createNextCampaignScenarios } = await server.ssrLoadModule("/scenarios/next/campaign.ts");
    const rules = dispatch("next_ruleset", {});
    const scenarios = createNextCampaignScenarios(rules);
    const compile = source => dispatch("compile_text", { ruleset_ref: rules.ruleset, source }).program;
    for (const scenarioId of ["protect-the-core", "first-march"]) {
      const first = scenarioId === "first-march";
      const scenario = scenarios.find(item => item.id === scenarioId);
      if (!scenario) throw new Error(`Missing authored scenario ${scenarioId}`);
      const { program_input, ...definition } = scenario.npc;
      const defender = { ...definition, program: compile(program_input.source) };
      for (const candidate of ["solo", "duos", "siege-solo"]) {
        const catalog = candidate === "siege-solo" ? ["F03", "F04", "R01", "R02", "R05"]
          : first ? ["F02", "F04", "R01", "R03", "R05"] : ["F01", "F03", "F06", "R02", "R04"];
        const heroes = scenarios[0].npc.configuration.heroes.value.map((hero, index) => ({
          ...hero, value: { ...hero.value,
            catalog_id: { kind: "string", value: catalog[index] },
            skill_path: { kind: "string", value: Object.keys(rules.next.heroes.find(item => item.id === catalog[index]).skill_paths).sort()[0] },
            squad: { kind: "string", value: `squad-${candidate === "duos" ? Math.floor(index / 2) + 1 : index + 1}` },
            node: { kind: "string", value: first ? "A.BASE" : "B.BASE" },
          },
        }));
        const source = "senkei integration_probe { " + heroes.map((hero, index) => {
          const slot = hero.value.slot_id.value;
          return `action advance_${index + 1} { when any hero in allies.heroes { hero.slot_id == "${slot}", hero.goal == "", hero.hp > 0, }, do move(argmin hero in filter hero in allies.heroes { hero.slot_id == "${slot}", } by hero.hp then hero.id, "B.BASE"), }`;
        }).join(", ") + " }";
        const attacker = { ...defender, id: first ? "campaign-player" : "probe-player", program: compile(source), configuration: { heroes: { kind: "list", value: heroes } } };
        const context = dispatch("new_match_context", { ruleset_ref: rules.ruleset, match_id: first ? "campaign-first-march-clear" : "campaign-probe-protect-the-core" });
        const actual = dispatch("simulate", { attacker, defender, context, include_diagnostics: false });
        console.log("CAMPAIGN_DIAGNOSTIC " + JSON.stringify({ sourceSha, scenarioId, candidate, catalog, result: actual.result }));
      }
    }
  } finally {
    await server.close();
  }
}
