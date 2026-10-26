import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createServer } from "vite";
import type { LocalPveScenario } from "../../../apps/web/src/contracts/workspace";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function campaign(rules: RulePackage): Promise<readonly LocalPveScenario[]> {
  const server = await createServer({ configFile: false, root: repositoryRoot, logLevel: "silent", server: { middlewareMode: true }, appType: "custom" });
  try {
    const { createNextCampaignScenarios } = await server.ssrLoadModule("/scenarios/next/campaign.ts");
    return createNextCampaignScenarios(rules);
  } finally { await server.close(); }
}
import type { RulePackage, SenkeiSnapshot, CompileResult, MatchContext } from "../../../apps/web/src/contracts/core-model";

// Exercise the shipped Rust/WASM dispatcher with the exact drafts produced by
// the browser's scenario factory; source-only compilation misses invalid squads.
async function loadCore() {
  const { instance } = await WebAssembly.instantiate(readFileSync(resolve(repositoryRoot, "apps/web/public/wasm/senkei_wasm.wasm")), {});
  const memory = instance.exports.memory as WebAssembly.Memory;
  const allocate = instance.exports.senkei_alloc as (size: number) => number;
  const dispatch = instance.exports.senkei_dispatch as (pointer: number, size: number) => bigint;
  const free = instance.exports.senkei_dealloc as (pointer: number, size: number) => void;
  return <T>(operation: string, payload: unknown): T => {
    const bytes = new TextEncoder().encode(JSON.stringify({ api_version: { major: 1, minor: 0, patch: 0 }, request_id: "npc-preflight", operation, payload }));
    const input = allocate(bytes.length);
    let output = 0;
    let size = 0;
    try {
      new Uint8Array(memory.buffer, input, bytes.length).set(bytes);
      const packed = dispatch(input, bytes.length);
      output = Number(packed & 0xffff_ffffn);
      size = Number(packed >> 32n);
      const response = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, output, size)));
      if (!response.ok) throw new Error(JSON.stringify(response.error));
      return response.result as T;
    } finally {
      free(input, bytes.length);
      if (output) free(output, size);
    }
  };
}

for (const scenarioId of ["first-march", "read-the-map", "share-the-pressure", "jungle-objective", "bridge-approach", "protect-the-core"]) {
  test(`bundled NPC ${scenarioId} passes real Core preflight`, async () => {
    const core = await loadCore();
    const rules = core<RulePackage>("next_ruleset", {});
    const scenarios = await campaign(rules);
    const draft = scenarios.find(scenario => scenario.id === scenarioId)!.npc;
    const compile = (source: typeof draft.program_input) => {
      if (source.kind !== "text") throw new Error("Authored NPC source must be text.");
      return core<CompileResult>("compile_text", { ruleset_ref: rules.ruleset, source: source.source }).program;
    };
    const { program_input, ...definition } = draft;
    const defender: SenkeiSnapshot = { ...definition, program: compile(program_input) };
    const playerDraft = scenarios[0].npc;
    const playerHeroes = playerDraft.configuration.heroes;
    if (playerHeroes.kind !== "list") throw new Error("Expected authored Hero list.");
    const attacker: SenkeiSnapshot = { ...defender, id: "npc-preflight-player", program: compile(playerDraft.program_input), configuration: {
      heroes: { kind: "list", value: playerHeroes.value.map(hero => {
        if (hero.kind !== "record") throw new Error("Expected Hero record.");
        return { ...hero, value: { ...hero.value, node: { kind: "string", value: rules.next!.map.attacker_base } } };
      }) },
    } };
    const context = core<MatchContext>("new_match_context", { ruleset_ref: rules.ruleset, match_id: `preflight-${scenarioId}` });
    expect(() => core("preflight", { attacker, defender, context })).not.toThrow();
    if (scenarioId === "protect-the-core") {
      const heroes = defender.configuration.heroes;
      if (heroes.kind !== "list") throw new Error("Expected Hero list.");
      const invalid = { ...defender, configuration: { heroes: { ...heroes, value: heroes.value.map((hero, index) => {
        if (hero.kind !== "record") throw new Error("Expected Hero record.");
        return index === 1 ? { ...hero, value: { ...hero.value, node: { kind: "string" as const, value: "B.MID.T2" } } } : hero;
      }) } } };
      expect(() => core("preflight", { attacker, defender: invalid, context })).toThrow(/spans multiple map nodes/);
    }
  });
}

for (const width of [1440, 390]) test(`final campaign NPC is playable through Ready at ${width}px`, async ({ browser, baseURL }) => {
  const core = await loadCore();
  const rules = core<RulePackage>("next_ruleset", {});
  const scenarios = await campaign(rules);
  const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, isMobile: width < 761, hasTouch: width < 761 });
  const page = await context.newPage();
  // A saved local campaign progression state provides access to the final
  // challenge; all readiness checks still run through the real browser Worker.
  await page.addInitScript(({ digest, ids }) => localStorage.setItem(`senkei.next-campaign-progress.v1:${digest}`, JSON.stringify({ format_version: 1, ruleset_digest: digest, unlocked_scenario_ids: ids })), { digest: rules.ruleset.digest, ids: scenarios.map(scenario => scenario.id) });
  await page.goto("/");
  if (width < 761) await page.getByTestId("journey-home").locator(".journey-start-mobile details > summary").click();
  await page.getByRole("button", { name: "戦役を始める", exact: true }).click();
  await page.getByRole("button", { name: /Regroup for a base defense/ }).click();
  await page.getByRole("button", { name: "この課題で準備する", exact: true }).click();
  await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
  await page.getByRole("button", { name: "検証・コンパイル", exact: true }).click();
  await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "戦闘開始", exact: true })).toBeEnabled();
  await context.close();
});
