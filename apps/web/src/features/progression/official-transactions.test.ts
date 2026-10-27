import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import typescript from "typescript";
import { applyOfficialResponse, createOfficialTransaction, inquiryFor, officialProducer, type OfficialResponse } from "./official-transactions";

const identity = { operationId: "op-1", requestId: "req-1", playerId: "player-1", authorityId: "authority-1" } as const;
const submitted = createOfficialTransaction(identity);
const response = { ...identity, status: "committed", resultId: "result-1", acquisitionIds: ["acq-1"], settlementIds: ["settle-1"], evidence: "opaque-proof" } as const;
const verifier = { verify: async () => ({ ...response }) };

describe("official transaction boundary", () => {
  it("has no configured producer", () => expect(officialProducer.kind).toBe("not-configured"));
  it("requires a verifier and matching identity before accepting a commit", async () => {
    await expect(applyOfficialResponse(submitted, response, undefined)).rejects.toThrow();
    await expect(applyOfficialResponse(submitted, { ...response, playerId: "other" }, verifier)).rejects.toThrow();
    await expect(applyOfficialResponse(submitted, response, { verify: async () => ({ ...response, authorityId: "other" }) })).rejects.toThrow();
    const committed = await applyOfficialResponse(submitted, response, verifier);
    expect(committed.status).toBe("committed");
    expect(await applyOfficialResponse(committed, response, verifier)).toEqual(committed);
    await expect(applyOfficialResponse(committed, { ...response, resultId: "different" }, { verify: async () => ({ ...response, resultId: "different" }) })).rejects.toThrow();
  });
  it("does not let a verifier mutate the original claims during verification", async () => {
    const mutating = { verify: async (claim: OfficialResponse) => { (claim as { playerId: string }).playerId = "other"; return claim; } };
    await expect(applyOfficialResponse(submitted, response, mutating)).rejects.toThrow("Evidence claims mismatch");
    expect(response.playerId).toBe("player-1");
  });
  it("inquires only with the same request after an unknown outcome", async () => {
    const unknown = await applyOfficialResponse(submitted, { ...identity, status: "outcome_unknown" }, undefined);
    expect(inquiryFor(unknown)).toEqual(identity);
    expect(() => inquiryFor(submitted)).toThrow();
  });
  it("rejects local records and invalid identities", () => {
    expect(() => createOfficialTransaction({ ...identity, authorityId: "local" })).toThrow();
    expect(() => createOfficialTransaction({ ...identity, requestId: " " })).toThrow();
  });
});

it.skipIf(!existsSync(process.env.SENKEI_CHROMIUM_EXECUTABLE || "/usr/bin/chromium"))("persists evidence and detects concurrent writes in browser IndexedDB", async () => {
  const { chromium } = await import("@playwright/test");
  // This standalone module has no imports; avoid starting Vite middleware for an IndexedDB-only contract test.
  const source = await readFile(new URL("./official-transactions.ts", import.meta.url), "utf8");
  const transformed = typescript.transpileModule(source, { compilerOptions: {
    target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ESNext,
  }, fileName: "official-transactions.ts" }).outputText;
  const browser = await chromium.launch({ executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE || "/usr/bin/chromium", args: ["--no-sandbox", "--no-proxy-server"], timeout: 45_000 });
  try {
    const page = await browser.newPage();
    await page.route("http://localhost/**", route => route.fulfill(route.request().url().endsWith(".ts")
      ? { contentType: "text/javascript", body: transformed }
      : { contentType: "text/html", body: "<!doctype html><title>Test</title>" }));
    await page.goto("http://localhost/", { timeout: 20_000 });
    // Chromium launches under a heavily contended Rust/Playwright CI runner. Bound each actual stage independently.
    const result = await page.evaluate(async () => {
      const bounded = async <T>(stage: string, operation: Promise<T>): Promise<T> => {
        let handle: ReturnType<typeof setTimeout> | undefined;
        try { return await Promise.race([operation, new Promise<T>((_, reject) => {
          handle = setTimeout(() => reject(new Error(`Browser IndexedDB contract stalled at ${stage}`)), 20_000);
        })]); }
        finally { if (handle !== undefined) clearTimeout(handle); }
      };
      const modulePath = "/apps/web/src/features/progression/official-transactions.ts";
      const { OfficialTransactionEvidenceStore, createOfficialTransaction } = await bounded("module import",
        (new Function("path", "return import(path)"))(modulePath) as Promise<typeof import("./official-transactions")>);
      const identity = { operationId: "op", requestId: "req", playerId: "player", authorityId: "authority" };
      const record = createOfficialTransaction(identity);
      const name = `test-official-${crypto.randomUUID()}`;
      const first = new OfficialTransactionEvidenceStore(indexedDB, name);
      await bounded("initial put", first.put(record));
      const second = new OfficialTransactionEvidenceStore(indexedDB, name);
      const loaded = await bounded("cross-instance get", second.get("req"));
      const unknown = { ...record, status: "outcome_unknown" };
      await bounded("compare-and-set put", second.put(unknown, loaded));
      let conflict = false;
      try { await bounded("stale writer conflict", first.put(record, loaded)); } catch (caught) { if (!(caught instanceof Error) || !caught.message.includes("Evidence record conflict")) throw caught; conflict = true; }
      return { loaded, updated: await bounded("final get", first.get("req")), conflict };
    });
    expect(result.loaded.status).toBe("submitted");
    expect(result.updated.status).toBe("outcome_unknown");
    expect(result.conflict).toBe(true);
  } finally {
    await browser.close();
  }
}, 120000);
