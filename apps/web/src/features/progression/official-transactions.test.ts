import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { applyOfficialResponse, createOfficialTransaction, inquiryFor, officialProducer } from "./official-transactions";

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
  const { createServer } = await import("vite");
  const { chromium } = await import("@playwright/test");
  const server = await createServer({ configFile: false, server: { middlewareMode: true } });
  const transformed = await server.transformRequest("/apps/web/src/features/progression/official-transactions.ts");
  if (!transformed) throw new Error("Could not transform transaction module");
  const browser = await chromium.launch({ executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE || "/usr/bin/chromium", args: ["--no-sandbox", "--no-proxy-server"] });
  try {
    const page = await browser.newPage();
    await page.route("http://localhost/**", route => route.fulfill(route.request().url().endsWith(".ts")
      ? { contentType: "text/javascript", body: transformed.code }
      : { contentType: "text/html", body: "<!doctype html><title>Test</title>" }));
    await page.goto("http://localhost/");
    const result = await page.evaluate(async () => {
      const modulePath = "/apps/web/src/features/progression/official-transactions.ts";
      const { OfficialTransactionEvidenceStore, createOfficialTransaction } = await (new Function("path", "return import(path)"))(modulePath);
      const identity = { operationId: "op", requestId: "req", playerId: "player", authorityId: "authority" };
      const record = createOfficialTransaction(identity);
      const name = `test-official-${crypto.randomUUID()}`;
      const first = new OfficialTransactionEvidenceStore(indexedDB, name);
      await first.put(record);
      const second = new OfficialTransactionEvidenceStore(indexedDB, name);
      const loaded = await second.get("req");
      const unknown = { ...record, status: "outcome_unknown" };
      await second.put(unknown, loaded);
      let conflict = false;
      try { await first.put(record, loaded); } catch { conflict = true; }
      return { loaded, updated: await first.get("req"), conflict };
    });
    expect(result.loaded.status).toBe("submitted");
    expect(result.updated.status).toBe("outcome_unknown");
    expect(result.conflict).toBe(true);
  } finally {
    await browser.close();
    await server.close();
  }
}, 30000);
