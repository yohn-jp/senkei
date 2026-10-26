import { describe, expect, it, vi } from "vitest";
import type { LocalNextExperimentStore } from "../../contracts";
import { NEXT_EXPERIMENT_STORE_MAX_BYTES, PersistenceError, assertNextExperimentImportSize, parseNextExperimentStore, saveNextExperimentStore, serializeNextExperimentStore } from "../persistence/repository";

function countJsonValues(value: unknown): number {
  if (Array.isArray(value)) return 1 + value.reduce((sum, item) => sum + countJsonValues(item), 0);
  if (typeof value === "object" && value !== null) {
    return 1 + Object.values(value).reduce((sum, item) => sum + countJsonValues(item), 0);
  }
  return 1;
}

function experiment(id: string, paddingValues: number) {
  return {
    id,
    match_id: `match-${id}`,
    created_at: "2026-10-25T00:00:00.000Z",
    snapshot: { context: { match_id: `match-${id}` } },
    response: {},
    setup: { padding: Array<null>(paddingValues).fill(null) },
    include_diagnostics: true,
    estimated_cu: 1,
  };
}

function experimentWithBytes(id: string, paddingBytes: number) {
  return {
    id,
    match_id: `match-${id}`,
    created_at: "2026-10-25T00:00:00.000Z",
    snapshot: { context: { match_id: `match-${id}` } },
    response: {},
    setup: { padding: "x".repeat(paddingBytes) },
    include_diagnostics: true,
    estimated_cu: 1,
  };
}

describe("Next experiment store bounds", () => {
  // These deliberately parse millions of values / tens of MiB. CI measured
  // 10 seconds for the paired-node case; retain the real boundary inputs.
  const resourceBoundaryTimeout = 30_000;
  it("accepts two individually bounded complete records when their aggregate exceeds the single-export node cap", () => {
    const first = experiment("latest", 2_050_000);
    const second = experiment("baseline", 2_050_000);
    const store = { format_version: 1 as const, ruleset_digest: "ruleset-digest", experiments: [first, second] };
    expect(countJsonValues(first)).toBeLessThanOrEqual(4_000_000);
    expect(countJsonValues(second)).toBeLessThanOrEqual(4_000_000);
    expect(countJsonValues(store)).toBeGreaterThan(4_000_000);
    expect(parseNextExperimentStore(store).experiments).toHaveLength(2);
  }, resourceBoundaryTimeout);

  it("still rejects any one experiment that exceeds the 4M per-record cap", () => {
    const oversized = experiment("oversized", 4_000_010);
    const store = { format_version: 1 as const, ruleset_digest: "ruleset-digest", experiments: [oversized] };
    expect(() => parseNextExperimentStore(store)).toThrow(/Next experiment 1 has too many JSON values/);
  }, resourceBoundaryTimeout);

  it("accepts two records each under 64 MiB when the pair exceeds the single-export byte cap", () => {
    const first = experimentWithBytes("latest", 34 * 1024 * 1024);
    const second = experimentWithBytes("baseline", 34 * 1024 * 1024);
    const store = { format_version: 1 as const, ruleset_digest: "ruleset-digest", experiments: [first, second] };
    const firstBytes = new TextEncoder().encode(JSON.stringify(first)).byteLength;
    const secondBytes = new TextEncoder().encode(JSON.stringify(second)).byteLength;
    const storeBytes = new TextEncoder().encode(JSON.stringify(store)).byteLength;
    expect(firstBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(secondBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(storeBytes).toBeGreaterThan(64 * 1024 * 1024);
    expect(storeBytes).toBeLessThanOrEqual(NEXT_EXPERIMENT_STORE_MAX_BYTES);
    expect(parseNextExperimentStore(store).experiments).toHaveLength(2);
    const exportJson = serializeNextExperimentStore(store as unknown as LocalNextExperimentStore);
    expect(new TextEncoder().encode(exportJson).byteLength).toBeLessThanOrEqual(NEXT_EXPERIMENT_STORE_MAX_BYTES);
    expect(exportJson).not.toContain("\n  ");
  }, resourceBoundaryTimeout);

  it("rejects a single record over the 64 MiB per-experiment byte cap", () => {
    const oversized = experimentWithBytes("oversized", 65 * 1024 * 1024);
    const store = { format_version: 1 as const, ruleset_digest: "ruleset-digest", experiments: [oversized] };
    expect(() => parseNextExperimentStore(store)).toThrow(/exceeds the 64 MiB per-experiment limit/);
  }, resourceBoundaryTimeout);

  it("rejects a portable file above the paired-store byte budget before reading it", () => {
    expect(() => assertNextExperimentImportSize(NEXT_EXPERIMENT_STORE_MAX_BYTES + 1)).toThrow(/128 MiB paired-store limit/);
    expect(() => assertNextExperimentImportSize(NEXT_EXPERIMENT_STORE_MAX_BYTES)).not.toThrow();
  });

  it("rechecks an import generation after IndexedDB opens and before replacing saved records", async () => {
    const original = { id: "latest", payload: { sentinel: "existing" } };
    const records = new Map<string, { id: string; payload: unknown }>([["latest", original]]);
    const stores = new Set<string>();
    let puts = 0;
    const transaction = {
      oncomplete: null as null | (() => void),
      onerror: null as null | (() => void),
      onabort: null as null | (() => void),
      objectStore: () => ({ put: (record: { id: string; payload: unknown }) => { puts += 1; records.set(record.id, record); } }),
      abort() { queueMicrotask(() => this.onabort?.()); },
    };
    const database = {
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore(name: string) { stores.add(name); return { createIndex() {} }; },
      transaction: () => transaction,
      close() {},
      onversionchange: null as null | (() => void),
    };
    const request: { result: typeof database; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: database };
    vi.stubGlobal("indexedDB", {
      open: () => {
        queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
        return request;
      },
    });

    try {
      let current = true;
      const replacement = {
        format_version: 1 as const,
        ruleset_digest: "ruleset-digest",
        experiments: [experiment("replacement", 0)],
      } as unknown as LocalNextExperimentStore;
      const pending = saveNextExperimentStore(replacement, () => {
        if (!current) throw new PersistenceError("conflict", "The current import generation changed.");
      });
      current = false;
      await expect(pending).rejects.toMatchObject({ code: "conflict" });
      expect(puts).toBe(0);
      expect(records.get("latest")).toBe(original);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
