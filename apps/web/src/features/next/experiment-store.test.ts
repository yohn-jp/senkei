import { describe, expect, it, vi } from "vitest";
import type { LocalNextExperimentStore, ReproductionAssets } from "../../contracts";
import { NEXT_EXPERIMENT_STORE_MAX_BYTES, PersistenceError, assertNextExperimentImportSize, loadNextExperimentPayload, loadNextExperimentStore, parseNextExperimentStore, saveNextExperimentStore, serializeNextExperimentStore } from "../persistence/repository";

const version = { major: 1, minor: 0, patch: 0 } as const;
const ruleset = { id: "senkei.next", version, digest: "a".repeat(64) };
const worldIdentity = {
  world_id: "world-a",
  schema_version: version,
  compiler_version: version,
  minimum_compiler: version,
  maximum_compiler_exclusive: null,
  validation_profile_id: null,
  validation_profile_version: null,
  logic_digest: "b".repeat(64),
  presentation_digest: "c".repeat(64),
};
const program = {
  language_version: version,
  ir_version: version,
  bytecode_version: version,
  cost_schedule_id: "standard",
  cost_schedule_version: version,
  ruleset,
  content_digest: "d".repeat(64),
  bytecode: [],
};
const sideSnapshot = (id: string) => ({
  schema_version: version,
  id,
  revision: "revision-1",
  ruleset,
  configuration: {},
  program,
  initial_memory: {},
});

function reproductionAssets(): ReproductionAssets {
  return {
    format_version: 1,
    rule_package: {
      next: { world_identity: worldIdentity },
      ruleset,
      minimum_engine_version: version,
      model_version: version,
      primitive_set_id: "senkei.default",
      primitive_set_version: version,
      jinrei_language_version: version,
      structured_ast_version: version,
      typed_ir_version: version,
      bytecode_version: version,
      domain: { senkei_configuration: {} },
      world_initialization: {},
      world: { entity_types: {} },
      phases: [],
      required_primitives: [],
      transitions: [],
      arbitration: {},
      termination: {},
      cost_schedule: {},
      presentation: {},
      limits: {},
    },
    world_definition: { id: "world-a", schema_version: version },
  } as unknown as ReproductionAssets;
}

function snapshot(matchId: string) {
  return {
    attacker: sideSnapshot("attacker"),
    defender: sideSnapshot("defender"),
    context: {
      schema_version: version,
      match_id: matchId,
      ruleset,
      world_identity: worldIdentity,
      versions: {
        model: version,
        engine: version,
        ruleset: version,
        jinrei_language: version,
        structured_ast: version,
        typed_ir: version,
        bytecode: version,
        cost_schedule: version,
        replay_schema: version,
      },
      initial_world: { entities: {}, global_fields: {}, collections: {} },
      max_ticks: 1,
      host_limits: { max_input_bytes: 1, max_entities: 1, max_events: 1, max_diagnostic_events: 1, max_output_bytes: 1 },
    },
  };
}

function countJsonValues(value: unknown): number {
  if (Array.isArray(value)) return 1 + value.reduce((sum, item) => sum + countJsonValues(item), 0);
  if (typeof value === "object" && value !== null) {
    return 1 + Object.values(value).reduce((sum, item) => sum + countJsonValues(item), 0);
  }
  return 1;
}

function experiment(id: string, paddingValues: number) {
  const matchId = `match-${id}`;
  return {
    id,
    match_id: matchId,
    created_at: "2026-10-25T00:00:00.000Z",
    snapshot: snapshot(matchId),
    reproduction_assets: reproductionAssets(),
    snapshot_digest: "e".repeat(64),
    response: {},
    setup: { padding: Array<null>(paddingValues).fill(null) },
    include_diagnostics: true,
    estimated_cu: 1,
  };
}

function experimentWithBytes(id: string, paddingBytes: number) {
  const matchId = `match-${id}`;
  return {
    id,
    match_id: matchId,
    created_at: "2026-10-25T00:00:00.000Z",
    snapshot: snapshot(matchId),
    reproduction_assets: reproductionAssets(),
    snapshot_digest: "e".repeat(64),
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
    const store = { format_version: 2 as const, experiments: [first, second] };
    expect(countJsonValues(first)).toBeLessThanOrEqual(4_000_000);
    expect(countJsonValues(second)).toBeLessThanOrEqual(4_000_000);
    expect(countJsonValues(store)).toBeGreaterThan(4_000_000);
    expect(parseNextExperimentStore(store).experiments).toHaveLength(2);
  }, resourceBoundaryTimeout);

  it("keeps each Run bound to its own package so a pair can span package revisions", () => {
    const latest = experiment("latest-package", 0);
    const baseline = experiment("prior-package", 0);
    const priorRuleset = { id: "senkei.next", version: { major: 1, minor: 9, patch: 0 }, digest: "f".repeat(64) };
    const priorPackage = { ...baseline.reproduction_assets.rule_package, ruleset: priorRuleset };
    const priorProgram = { ...program, ruleset: priorRuleset };
    baseline.reproduction_assets = { ...baseline.reproduction_assets, rule_package: priorPackage } as ReproductionAssets;
    baseline.snapshot = {
      ...baseline.snapshot,
      attacker: { ...baseline.snapshot.attacker, ruleset: priorRuleset, program: priorProgram },
      defender: { ...baseline.snapshot.defender, ruleset: priorRuleset, program: priorProgram },
      context: { ...baseline.snapshot.context, ruleset: priorRuleset },
    };

    const restored = parseNextExperimentStore({ format_version: 2, experiments: [latest, baseline] });
    expect(restored.experiments.map((item) => item.reproduction_assets.rule_package.ruleset.digest))
      .toEqual([ruleset.digest, priorRuleset.digest]);
  });

  it("still rejects any one experiment that exceeds the 4M per-record cap", () => {
    const oversized = experiment("oversized", 4_000_010);
    const store = { format_version: 2 as const, experiments: [oversized] };
    expect(() => parseNextExperimentStore(store)).toThrow(/Next experiment 1 has too many JSON values/);
  }, resourceBoundaryTimeout);

  it("accepts two records each under 64 MiB when the pair exceeds the single-export byte cap", () => {
    const first = experimentWithBytes("latest", 34 * 1024 * 1024);
    const second = experimentWithBytes("baseline", 34 * 1024 * 1024);
    const store = { format_version: 2 as const, experiments: [first, second] };
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
    const store = { format_version: 2 as const, experiments: [oversized] };
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
        format_version: 2 as const,
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
      database.onversionchange?.();
      vi.unstubAllGlobals();
    }
  });

  it("round-trips the retained package, authored World bytes, and complete input digest", () => {
    const record = experiment("exact", 0);
    record.snapshot_digest = "f".repeat(64);
    const store = { format_version: 2 as const, experiments: [record] };
    const serialized = serializeNextExperimentStore(store as unknown as LocalNextExperimentStore);
    const restored = parseNextExperimentStore(JSON.parse(serialized));
    expect(restored.experiments[0]?.reproduction_assets).toEqual(record.reproduction_assets);
    expect(restored.experiments[0]?.snapshot_digest).toBe(record.snapshot_digest);
    expect(restored.experiments[0]?.snapshot).toEqual(record.snapshot);
  });

  it("rejects legacy typed records while leaving their raw JSON exportable", () => {
    const legacy = { format_version: 1 as const, ruleset_digest: ruleset.digest, experiments: [] };
    expect(() => parseNextExperimentStore(legacy)).toThrow(/unsupported or malformed format/);
    expect(JSON.stringify(legacy)).toContain('"format_version":1');
  });

  it("preserves legacy raw storage for export when the typed format is unsupported", async () => {
    const legacy = { format_version: 1, ruleset_digest: ruleset.digest, experiments: [] };
    const stores = new Set(["next_experiments"]);
    const database = {
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore(name: string) { stores.add(name); return { createIndex() {} }; },
      transaction: () => {
        const request: { result: unknown; onsuccess?: null | (() => void) } = { result: { id: "latest", payload: legacy } };
        const transaction = {
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          onabort: null as null | (() => void),
          objectStore: () => ({ get: () => {
            queueMicrotask(() => {
              request.onsuccess?.();
              transaction.oncomplete?.();
            });
            return request;
          } }),
          abort() { queueMicrotask(() => this.onabort?.()); },
        };
        return transaction;
      },
      close() {},
      onversionchange: null as null | (() => void),
    };
    const openRequest: { result: typeof database; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: database };
    vi.stubGlobal("indexedDB", {
      open: () => {
        queueMicrotask(() => { openRequest.onupgradeneeded?.(); openRequest.onsuccess?.(); });
        return openRequest;
      },
    });
    try {
      await expect(loadNextExperimentStore()).rejects.toThrow(/unsupported or malformed format/);
      await expect(loadNextExperimentPayload()).resolves.toEqual(legacy);
    } finally {
      database.onversionchange?.();
      vi.unstubAllGlobals();
    }
  });
});
