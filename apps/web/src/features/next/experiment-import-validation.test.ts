import { describe, expect, it } from "vitest";
import { prepareNextExperimentStore } from "./NextWorkspace";
import type { CoreClient, LocalNextExperimentStore, RulePackage } from "../../contracts";

const version = { major: 1, minor: 0, patch: 0 };
const ruleset = { id: "senkei.next", version, digest: "rules" };
const world = { world_id: "world", logic_digest: "logic", presentation_digest: "presentation" };
const versions = { engine: version };
const core = { newMatchContext: async () => ({ versions }) } as unknown as CoreClient;
const packageValue = { ruleset, model_version: version, next: {
  world_identity: world, map: { world_identity: world, nodes: { home: {} } }, mechanics_version: version,
  heroes: [{ id: "F01", skill_paths: { path_a: [] } }],
} } as unknown as RulePackage;
function store(): LocalNextExperimentStore {
  const slots = Array.from({ length: 5 }, (_, i) => ({ slot_id: `slot-0${i + 1}`, catalog_id: "F01", squad: "solo", node: "home", skill_path: "path_a" }));
  return {
    format_version: 1, ruleset_digest: "rules", experiments: [{
      id: "experiment", match_id: "match-a", created_at: "2026-10-26", include_diagnostics: false, estimated_cu: 1,
      snapshot: { context: { match_id: "match-a", ruleset, world_identity: world, versions }, attacker: { ruleset }, defender: { ruleset } },
      setup: { format_version: 1, saved_at: "2026-10-26", ruleset, schema_version: version, mechanics_version: version,
        formation_shape: "single", slots, rival_slots: slots, rival_source: "source", campaign_scenario_id: "custom-scenario",
        draft: { id: "draft", revision: "1", schema_version: version, ruleset, program_input: { kind: "text", source: "source" }, configuration: {}, initial_memory: {} } },
      response: { outcome: {
        result: { match_id: "match-a", outcome: "attacker_victory", termination_reason: "base_destroyed", final_tick: 7, statistics: {}, cu_spent: { attacker: 1, defender: 2 }, final_state_digest: "state-digest" },
        presentation_replay: { schema_version: version, match_id: "match-a", world_identity: world, ruleset, frames: [], result_digest: "5bd522f68e9cc8ff06a012155945442ec94eb42042661765ab0cf3255ed58e0b" },
      } },
    }],
  } as unknown as LocalNextExperimentStore;
}

describe("semantic preparation of imported completed Runs", () => {
  it("rejects a different store RulePackage before restoring any Run", async () => {
    await expect(prepareNextExperimentStore({ ...store(), ruleset_digest: "other" }, packageValue, core)).rejects.toThrow("Stored package digest other");
  });
  it("rejects internally paired but incompatible World identity", async () => {
    const input = structuredClone(store());
    const changed = { ...world, presentation_digest: "different" };
    Object.assign(input.experiments[0].snapshot.context, { world_identity: changed });
    Object.assign(input.experiments[0].response.outcome.presentation_replay, { world_identity: changed });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("World identity or paired World projection");
  });
  it("rejects snapshot ruleset mismatch even with the matching store header", async () => {
    const input = structuredClone(store());
    Object.assign(input.experiments[0].snapshot.attacker, { ruleset: { ...ruleset, digest: "other" } });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("Ruleset identity does not match");
  });
  it("rejects result digest mismatch rather than accepting a valid-looking record", async () => {
    const input = structuredClone(store());
    Object.assign(input.experiments[0].response.outcome.presentation_replay, { result_digest: "other" });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("Replay result digest does not match");
  });
  it("rejects old runtime versions after validating the genuine result binding", async () => {
    const input = structuredClone(store());
    Object.assign(input.experiments[0].snapshot.context, { versions: { engine: { ...version, major: 99 } } });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("versions differ from this runtime");
  });
  it("rejects unauthorized owner channels before exposing imported artifacts", async () => {
    const input = structuredClone(store());
    Object.assign(input.experiments[0].response, { owner_replays: { defender: { perspective: "defender" } } });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("restricted channel without an owner request");
  });
  it("rejects malformed immutable setup metadata without modifying its source value", async () => {
    const input = structuredClone(store());
    Object.assign(input.experiments[0], { setup: {} });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("incomplete match, setup, result or replay");
    expect(input.experiments[0].setup).toEqual({});
  });
  it("requires actual Core validation of the frozen programs and battle input", async () => {
    const rejectingCore = { ...core, preflight: async () => { throw new Error("invalid compiled program digest"); } } as unknown as CoreClient;
    await expect(prepareNextExperimentStore(store(), packageValue, rejectingCore)).rejects.toThrow("invalid compiled program digest");
  });
  it("checks the public replay binding even when a valid owner replay is available", async () => {
    const input = structuredClone(store());
    const item = input.experiments[0];
    Object.assign(item, { include_diagnostics: true });
    Object.assign(item.response, {
      authorized_side: "attacker",
      owner_replays: { attacker: { ...item.response.outcome.presentation_replay, perspective: "attacker" } },
      restricted_diagnostics: { events: [], cu_by_side: {}, final_memory_by_side: {} },
    });
    Object.assign(item.response.outcome.presentation_replay, { world_identity: { ...world, presentation_digest: "different" } });
    await expect(prepareNextExperimentStore(input, packageValue, core)).rejects.toThrow("World identity or paired World projection");
  });
});
