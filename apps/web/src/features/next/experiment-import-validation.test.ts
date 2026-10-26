import { describe, expect, it } from "vitest";
import { prepareNextExperimentStore } from "./NextWorkspace";
import { reproductionSnapshotDigest } from "./experiment-restoration";
import type { CoreClient, LocalNextExperimentStore, RulePackage, SimulationResponse } from "../../contracts";

const version = { major: 1, minor: 0, patch: 0 };
const replayVersion = { major: 1, minor: 1, patch: 0 };
const ruleset = { id: "senkei.next", version, digest: "a".repeat(64) };
const world = { world_id: "world", schema_version: version, logic_digest: "c".repeat(64), presentation_digest: "d".repeat(64),
  compiler_version: version, minimum_compiler: version, maximum_compiler_exclusive: null, validation_profile_id: null, validation_profile_version: null };
const versions = { engine: version };
const packageValue = { ruleset, model_version: version, next: {
  world_identity: world,
  map: {
    id: "map", world_identity: world,
    world_projection: { schema_version: version, source_identity: world, node_ids: ["home"], edge_facts: {}, bridge_sites: {},
      presentation_artifact: { schema_version: version, content: {
        node_positions: { home: { position: { x: 0, y: 0 } }, away: { position: { x: 100, y: 0 } } },
        edge_paths: { "home-away": { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } }, rivers: {},
      } } },
    nodes: {
      home: { x: 0, y: 0, presentation_x: 0, presentation_y: 0, region: "home", allegiance: "A" },
      away: { x: 100, y: 0, presentation_x: 100, presentation_y: 0, region: "away", allegiance: "B" },
    },
    edges: [{ id: "home-away", from: "home", to: "away", length: 100, region: "center", blocked: false }],
    lanes: { center: ["home", "away"] }, attacker_base: "home", defender_base: "away", towers: [],
  }, mechanics_version: version, parameters: {}, camps: [],
  heroes: [{ id: "F01", skill_paths: { path_a: [] } }],
} } as unknown as RulePackage;
const response: SimulationResponse = {
  outcome: {
    result: { match_id: "match-a", outcome: "attacker_victory", termination_reason: "base_destroyed", final_tick: 7,
      statistics: {}, cu_spent: { attacker: 1, defender: 2 }, final_state_digest: "state-digest" },
    presentation_replay: { schema_version: replayVersion, match_id: "match-a", world_identity: world, ruleset,
      frames: [], result_digest: "" },
  },
};
const core = {
  newMatchContext: async () => ({ versions }),
  reproduce: async () => response,
} as unknown as CoreClient;

async function store(): Promise<LocalNextExperimentStore> {
  const slots = Array.from({ length: 5 }, (_, i) => ({ slot_id: `slot-0${i + 1}`, catalog_id: "F01", squad: "solo", node: "home", skill_path: "path_a" }));
  const snapshot = { context: { match_id: "match-a", ruleset, world_identity: world, versions }, attacker: { ruleset }, defender: { ruleset } };
  const resultDigest = await digest(JSON.stringify({
    match_id: "match-a",
    outcome: "attacker_victory",
    termination_reason: "base_destroyed",
    final_tick: 7,
    statistics: {},
    cu_spent: { attacker: 1, defender: 2 },
    final_state_digest: "state-digest",
  }));
  Object.assign(response.outcome.presentation_replay, { result_digest: resultDigest });
  return {
    format_version: 2,
    experiments: [{
      id: "experiment", match_id: "match-a", created_at: "2026-10-26", include_diagnostics: false, estimated_cu: 1,
      snapshot,
      reproduction_assets: { format_version: 1, rule_package: packageValue, world_definition: {} },
      snapshot_digest: await reproductionSnapshotDigest(snapshot as LocalNextExperimentStore["experiments"][number]["snapshot"]),
      setup: { format_version: 1, saved_at: "2026-10-26", ruleset, schema_version: version, mechanics_version: version,
        formation_shape: "single", slots, rival_slots: slots, rival_source: "source", campaign_scenario_id: "custom-scenario",
        draft: { id: "draft", revision: "1", schema_version: version, ruleset, program_input: { kind: "text", source: "source" }, configuration: {}, initial_memory: {} } },
      response: { ...response, outcome: { ...response.outcome, presentation_replay: { ...response.outcome.presentation_replay, result_digest: resultDigest } } },
    }],
  } as unknown as LocalNextExperimentStore;
}

async function digest(value: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

describe("semantic preparation of imported completed Runs", () => {
  it("reproduces a retained Run even when the active RulePackage differs", async () => {
    const input = await store();
    const activePackage = { ...packageValue, ruleset: { ...ruleset, digest: "b".repeat(64) } } as RulePackage;
    const restored = await prepareNextExperimentStore(input, activePackage, core);
    expect(restored).toHaveLength(1);
    expect(restored[0].reproductionAssets).toEqual(input.experiments[0].reproduction_assets);
    expect(restored[0].snapshotDigest).toBe(input.experiments[0].snapshot_digest);
  });

  it("rejects an internally paired but incompatible retained World identity", async () => {
    const input = structuredClone(await store());
    const changed = { ...world, presentation_digest: "different" };
    Object.assign(input.experiments[0].snapshot.context, { world_identity: changed });
    Object.assign(input.experiments[0].response.outcome.presentation_replay, { world_identity: changed });
    Object.assign(input.experiments[0], { snapshot_digest: await reproductionSnapshotDigest(input.experiments[0].snapshot) });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("World identity or paired World projection");
  });

  it("rejects snapshot ruleset mismatch against the retained package", async () => {
    const input = structuredClone(await store());
    Object.assign(input.experiments[0].snapshot.attacker, { ruleset: { ...ruleset, digest: "other" } });
    Object.assign(input.experiments[0], { snapshot_digest: await reproductionSnapshotDigest(input.experiments[0].snapshot) });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("Ruleset identity does not match its retained RulePackage");
  });

  it("rejects result digest mismatch rather than accepting a valid-looking record", async () => {
    const input = structuredClone(await store());
    Object.assign(input.experiments[0].response.outcome.presentation_replay, { result_digest: "other" });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("Replay result digest does not match");
  });

  it("rejects records that the retained-asset Core cannot reproduce", async () => {
    const rejectingCore = { ...core, reproduce: async () => { throw new Error("Stored Core version is incompatible"); } } as unknown as CoreClient;
    await expect(prepareNextExperimentStore(await store(), packageValue, rejectingCore)).rejects.toThrow("Stored Core version is incompatible");
  });

  it("rejects unauthorized owner channels before reproduction", async () => {
    const input = structuredClone(await store());
    Object.assign(input.experiments[0].response, { owner_replays: { defender: { perspective: "defender" } } });
    const noRunCore = { ...core, reproduce: async () => { throw new Error("must not reproduce unauthorized data"); } } as unknown as CoreClient;
    await expect(prepareNextExperimentStore(input, packageValue, noRunCore)).rejects.toThrow("restricted channel without an owner request");
  });

  it("rejects malformed immutable setup metadata without modifying its source value", async () => {
    const input = structuredClone(await store());
    Object.assign(input.experiments[0], { setup: {} });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("incomplete match, setup, result or replay");
    expect(input.experiments[0].setup).toEqual({});
  });

  it("requires actual Core reproduction of the frozen programs and battle input", async () => {
    const rejectingCore = { ...core, reproduce: async () => { throw new Error("invalid compiled program digest"); } } as unknown as CoreClient;
    await expect(prepareNextExperimentStore(await store(), packageValue, rejectingCore)).rejects.toThrow("invalid compiled program digest");
  });

  it("checks the public replay binding even when a valid owner replay is available", async () => {
    const input = structuredClone(await store());
    const item = input.experiments[0];
    Object.assign(item, { include_diagnostics: true });
    Object.assign(item.snapshot.attacker, { program: { content_digest: "attacker-program" } });
    Object.assign(item.snapshot.defender, { program: { content_digest: "defender-program" } });
    const snapshotDigest = await reproductionSnapshotDigest(item.snapshot);
    const resultDigest = item.response.outcome.presentation_replay.result_digest;
    Object.assign(item.response, {
      authorized_side: "attacker",
      owner_replays: { attacker: { ...item.response.outcome.presentation_replay, perspective: "attacker" } },
      restricted_diagnostics: { identity: { schema_version: 1, side: "attacker", match_id: "match-a",
        result_digest: resultDigest, snapshot_digest: snapshotDigest, program_digest: "attacker-program" },
        events: [], cu_by_side: { attacker: 1 }, final_memory_by_side: { attacker: {} } },
    });
    Object.assign(item, { snapshot_digest: snapshotDigest });
    Object.assign(item.response.outcome.presentation_replay, { world_identity: { ...world, presentation_digest: "different" } });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("World identity or paired World projection");
  });

  it("rejects identity-less imported owner diagnostics before restoring the Run", async () => {
    const input = structuredClone(await store());
    const item = input.experiments[0]!;
    Object.assign(item, { include_diagnostics: true });
    Object.assign(item.response, {
      authorized_side: "attacker",
      owner_replays: { attacker: { ...item.response.outcome.presentation_replay, perspective: "attacker" } },
      restricted_diagnostics: { events: [], cu_by_side: {}, final_memory_by_side: {} },
    });
    const noRunCore = { ...core, reproduce: async () => { throw new Error("must not reproduce identity-less data"); } } as unknown as CoreClient;
    await expect(prepareNextExperimentStore(input, packageValue, noRunCore)).rejects.toThrow("Stored diagnostics have no Run identity");
  });

  it("rejects a stored snapshot digest that does not bind the complete input", async () => {
    const input = structuredClone(await store());
    Object.assign(input.experiments[0], { snapshot_digest: "bad-digest" });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("snapshot digest does not match its complete immutable input");
  });
});
