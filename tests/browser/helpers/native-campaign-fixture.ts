import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createServer } from "vite";
const pending = new Map<string, Promise<any>>();
/** Actual matched native result and original source; reused only for the exact same snapshot. */
export function nativeCampaignFixture(scenarioId: "protect-the-core" | "first-march" = "protect-the-core"): Promise<any> {
  if (!pending.has(scenarioId)) pending.set(scenarioId, build(scenarioId));
  return pending.get(scenarioId)!;
}
async function build(scenarioId: string) {
  const first = scenarioId === "first-march";
  const server = await createServer({ configFile: false, root: process.cwd(), logLevel: "silent", server: { middlewareMode: true }, appType: "custom" });
  try {
    const { createNextCampaignScenarios } = await server.ssrLoadModule("/scenarios/next/campaign.ts");
    const progressApi = await server.ssrLoadModule("/apps/web/src/features/next/campaign-progress.ts");
    const dispatch = (operation: string, payload: unknown): any => {
      const command = process.env.SENKEI_NATIVE_DISPATCHER ?? "cargo";
      const args = process.env.SENKEI_NATIVE_DISPATCHER ? [] : ["run", "--quiet", "--locked", "--release", "-p", "senkei-wasm", "--bin", "senkei-wasm-dispatch"];
      const bytes = execFileSync(command, args, { input: JSON.stringify({ api_version: { major: 1, minor: 0, patch: 0 }, request_id: "campaign-native-positive", operation, payload }) + "\n", maxBuffer: 256 * 1024 * 1024, timeout: 240_000 });
      const reply = JSON.parse(bytes.toString()); if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.result;
    };
    const rules = dispatch("next_ruleset", {}), scenarios = createNextCampaignScenarios(rules);
    const scenario = scenarios.find((item: any) => item.id === scenarioId);
    const compile = (source: string) => dispatch("compile_text", { ruleset_ref: rules.ruleset, source }).program;
    const { program_input, ...definition } = scenario.npc;
    const defender = { ...definition, program: compile(program_input.source) };
    const ownHeroes = scenarios[0].npc.configuration.heroes.value.map((hero: any, index: number) => first
      ? { ...hero, value: { ...hero.value, catalog_id: { kind: "string", value: ["F02", "F04", "R01", "R03", "R05"][index] } } } : hero);
    const source = (first ? "senkei w9_persistent_movement { " : "senkei probe {") + ownHeroes.map((hero: any, index: number) => {
      const slot = hero.value.slot_id.value;
      return `action ${first ? `advance_slot_${index + 1}` : `move_${index}`} { when any hero in allies.heroes { hero.slot_id == "${slot}", hero.goal == "", hero.hp > 0, }, do move(argmin hero in filter hero in allies.heroes { hero.slot_id == "${slot}", } by hero.hp then hero.id, "B.BASE"), }`;
    }).join(first ? ", " : ",") + (first ? " }" : "}");
    const attacker = { ...defender, id: first ? "campaign-player" : "probe-player", program: compile(source), configuration: { heroes: { kind: "list", value: ownHeroes.map((hero: any) => ({ ...hero, value: { ...hero.value, squad: { kind: "string", value: first ? "squad-0" : "squad-1" }, node: { kind: "string", value: first ? "A.BASE" : "B.BASE" } } })) } } };
    const context = dispatch("new_match_context", { ruleset_ref: rules.ruleset, match_id: first ? "campaign-first-march-clear" : "campaign-probe-protect-the-core" });
    const snapshot = { attacker, defender, context };
    dispatch("preflight", snapshot);
    const proofPath = first ? process.env.SENKEI_CAMPAIGN_FIRST_PROOF : process.env.SENKEI_CAMPAIGN_NATIVE_PROOF;
    const recorded = proofPath ? JSON.parse(readFileSync(proofPath, "utf8")) : null;
    if (recorded && !isDeepStrictEqual(recorded.snapshot, snapshot)) throw new Error("Recorded native input differs from the actual fixture snapshot.");
    const actual = recorded?.actual ?? dispatch("simulate", { ...snapshot, include_diagnostics: false });
    const { validateNextExperimentReplay } = await server.ssrLoadModule("/apps/web/src/features/next/experiment-restoration.ts");
    await validateNextExperimentReplay(actual.replay, actual.result, context.match_id);
    if (actual.result.outcome !== "attacker_victory" || actual.result.termination_reason !== "base_destroyed") throw new Error("The actual native fixture did not win.");
    const ids = scenarios.map((item: any) => item.id);
    const legacy = JSON.stringify({ format_version: 1, ruleset_digest: rules.ruleset.digest, unlocked_scenario_ids: ids });
    const after = progressApi.reduceCampaignProgress(progressApi.migrateLegacyCampaignProgress(legacy, rules.ruleset.digest, ids), ids, { scenario_id: scenario.id, context, result: actual.result });
    const current = progressApi.serializeCampaignProgress(after, ids);
    mkdirSync("test-results", { recursive: true });
    writeFileSync(first ? "test-results/campaign-native-first-march-proof.json" : "test-results/campaign-native-final-proof.json", JSON.stringify({ source, npcSource: program_input.source, snapshot, actual, current, legacy }));
    return { rules, scenario, source, npcSource: program_input.source, snapshot, actual, current, legacy };
  } finally { await server.close(); }
}

/** Wraps actual source/snapshots/result in the existing Experiment format; no ID rewriting. */
export function nativeCampaignStore(fixture: any, estimatedCU: number) {
  const slots = (snapshot: any) => snapshot.configuration.heroes.value.map((hero: any) => Object.fromEntries(Object.entries(hero.value).map(([key, value]: [string, any]) => [key, value.value])));
  const { program: _program, ...definition } = fixture.snapshot.attacker;
  const time = new Date().toISOString();
  const setup = { format_version: 1, saved_at: time, ruleset: definition.ruleset, schema_version: definition.schema_version,
    mechanics_version: fixture.rules.next.mechanics_version, formation_shape: "single", slots: slots(fixture.snapshot.attacker), rival_slots: slots(fixture.snapshot.defender),
    draft: { ...definition, program_input: { kind: "text", source: fixture.source } }, rival_source: fixture.npcSource, campaign_scenario_id: fixture.scenario.id };
  return { format_version: 1, ruleset_digest: definition.ruleset.digest, experiments: [{ id: `genuine-native-campaign-${fixture.scenario.id}`, match_id: fixture.snapshot.context.match_id,
    created_at: time, snapshot: fixture.snapshot, response: { outcome: { result: fixture.actual.result, presentation_replay: fixture.actual.replay } }, setup, include_diagnostics: false, estimated_cu: estimatedCU }] };
}
