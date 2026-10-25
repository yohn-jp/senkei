import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

interface WorkerReply {
  readonly web_protocol_version: number;
  readonly request_id: string;
  readonly operation?: string;
  readonly ok: boolean;
  readonly result?: any;
  readonly error?: { readonly code: string; readonly message: string };
}

type WorkerWindow = Window & {
  __senkeiTestRequest?: (operation: string, payload: unknown) => Promise<WorkerReply>;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function loadCampaignFactory() {
  const server = await createServer({
    configFile: false,
    root: repositoryRoot,
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return await server.ssrLoadModule("/scenarios/next/campaign.ts") as {
      createNextCampaignScenarios(ruleset: unknown): readonly { readonly id: string; readonly npc: Record<string, any> }[];
    };
  } finally {
    await server.close();
  }
}

test("production Worker batches the six Next campaign drafts and reports protocol errors", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.context().on("request", (request) => {
    if (new URL(request.url()).origin !== baseURL) externalRequests.push(request.url());
  });

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
  const workerAsset = readdirSync(resolve(repositoryRoot, "dist/web/assets"))
    .find((name) => /^core\.worker-.*\.js$/.test(name));
  expect(workerAsset, "the production build must contain its real core Worker").toBeTruthy();

  await page.evaluate(async (assetName) => {
    const worker = new Worker(`/assets/${assetName}`, { type: "module", name: "next-campaign-benchmark" });
    const pending = new Map<string, (reply: WorkerReply) => void>();
    let sequence = 0;
    worker.addEventListener("error", (event) => {
      for (const [requestId, resolveReply] of pending) {
        resolveReply({
          web_protocol_version: 1,
          request_id: requestId,
          ok: false,
          error: { code: "worker_error", message: event.message },
        });
      }
      pending.clear();
    });
    worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
      pending.get(event.data.request_id)?.(event.data);
      pending.delete(event.data.request_id);
    });
    (window as WorkerWindow).__senkeiTestRequest = (operation, payload) => new Promise((resolveReply, reject) => {
      const request_id = `w7-campaign-worker-${++sequence}`;
      pending.set(request_id, resolveReply);
      worker.postMessage({
        web_protocol_version: 1,
        request_id,
        operation,
        payload,
      });
      window.setTimeout(() => {
        if (pending.delete(request_id)) reject(new Error(`Production Worker timed out: ${operation}`));
      }, 120_000);
    });
  }, workerAsset!);

  const packageReply = await page.evaluate(() => (window as WorkerWindow).__senkeiTestRequest!("next_ruleset", {}));
  expect(packageReply.ok, JSON.stringify(packageReply)).toBe(true);
  expect(packageReply.operation).toBe("next_ruleset");
  const ruleset = packageReply.result;
  const { createNextCampaignScenarios } = await loadCampaignFactory();
  const scenarios = createNextCampaignScenarios(ruleset);
  expect(scenarios).toHaveLength(6);
  expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(6);
  const scenarioIds = scenarios.map((scenario) => scenario.id);
  const drafts = scenarios.map((scenario) => scenario.npc);

  const { benchmark, representative, invalidCompile } = await page.evaluate(async (campaignDrafts) => {
    const request = (window as WorkerWindow).__senkeiTestRequest!;
    const first = campaignDrafts[0];
    const compiled = await Promise.all(campaignDrafts.map(async (draft) => {
      const input = draft.program_input.kind === "text"
        ? { kind: "text", ruleset_ref: draft.ruleset, source: draft.program_input.source }
        : { kind: "structured_ast", ruleset_ref: draft.ruleset, ast: draft.program_input.ast };
      const reply = await request("compile", input);
      if (!reply.ok) throw new Error(`Next scenario tactic failed to compile: ${reply.error?.message}`);
      return reply.result.program;
    }));
    const attacker = {
      schema_version: first.schema_version,
      id: `${first.id}-worker-attacker`,
      revision: first.revision,
      ruleset: first.ruleset,
      configuration: first.configuration,
      program: compiled[0],
      initial_memory: first.initial_memory,
    };
    const cases = await Promise.all(campaignDrafts.map(async (draft, index) => {
      const context = await request("new_match_context", {
        ruleset_ref: draft.ruleset,
        match_id: `w7-browser-campaign-${draft.id}`,
      });
      if (!context.ok) throw new Error(`Next scenario context failed: ${context.error?.message}`);
      const defender = {
        schema_version: draft.schema_version,
        id: draft.id,
        revision: draft.revision,
        ruleset: draft.ruleset,
        configuration: draft.configuration,
        program: compiled[index],
        initial_memory: draft.initial_memory,
      };
      return { case_id: draft.id, snapshot: { attacker, defender, context: context.result } };
    }));

    const boundedBatch = [1, 2].map((max_ticks) => ({
      case_id: `worker-protocol-${max_ticks}-tick`,
      snapshot: {
        ...cases[0].snapshot,
        context: {
          ...cases[0].snapshot.context,
          match_id: `w7-browser-protocol-${max_ticks}-tick`,
          max_ticks,
        },
      },
    }));

    // Keep actual production gameplay evidence alongside a bounded two-case
    // batch so both protocol ordering and normal campaign execution are covered.
    // The malformed request races both and must receive its own correlated ID.
    const [batchReply, representativeReply, invalidReply] = await Promise.all([
      request("benchmark", { cases: boundedBatch }),
      request("benchmark", { cases: cases.slice(0, 1) }),
      request("compile", {}),
    ]);
    return { benchmark: batchReply, representative: representativeReply, invalidCompile: invalidReply };
  }, drafts);

  expect(benchmark.ok).toBe(true);
  expect(benchmark.operation).toBe("benchmark");
  expect(benchmark.result.cases.map((item: { case_id: string }) => item.case_id)).toEqual([
    "worker-protocol-1-tick",
    "worker-protocol-2-tick",
  ]);
  expect(representative.ok).toBe(true);
  expect(representative.result.cases.map((item: { case_id: string }) => item.case_id)).toEqual([`npc-${scenarioIds[0]}`]);
  for (const item of benchmark.result.cases) {
    expect(Number.isSafeInteger(item.outcome.result.final_tick)).toBe(true);
    expect(item.outcome.result.final_state_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isSafeInteger(item.outcome.result.cu_spent.attacker)).toBe(true);
    expect(Number.isSafeInteger(item.outcome.result.cu_spent.defender)).toBe(true);
  }
  expect(invalidCompile.ok).toBe(false);
  expect(invalidCompile.error?.code).toBe("invalid_request");
  expect(invalidCompile.request_id).not.toBe(benchmark.request_id);
  expect(invalidCompile.request_id).not.toBe(representative.request_id);
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
