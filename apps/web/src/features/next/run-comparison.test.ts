import { describe, expect, it } from "vitest";
import type { SimulationSnapshot } from "../../contracts";
import { classifyRunComparison } from "./run-comparison";

const version = { major: 1, minor: 0, patch: 0 };
const ruleset = { id: "next", version, digest: "rule-digest" };
function snapshot(): SimulationSnapshot {
  const side = (id: string) => ({ schema_version: version, id, revision: "1", ruleset, configuration: { heroes: { kind: "list", value: [] } }, program: { language_version: version, ir_version: version, bytecode_version: version, cost_schedule_id: "cu", cost_schedule_version: version, ruleset, content_digest: "program", bytecode: [1, 2] }, initial_memory: {} });
  return structuredClone({ attacker: side("own"), defender: side("opponent"), context: { schema_version: version, match_id: "match-1", ruleset, world_identity: { world_id: "world", schema_version: version, compiler_version: version, minimum_compiler: version, maximum_compiler_exclusive: null, validation_profile_id: null, validation_profile_version: null, logic_digest: "world-logic", presentation_digest: "world-art" }, versions: Object.fromEntries(["model", "engine", "ruleset", "jinrei_language", "structured_ast", "typed_ir", "bytecode", "cost_schedule", "replay_schema"].map(key => [key, version])), initial_world: { entities: {}, global_fields: {}, collections: {} }, max_ticks: 600, host_limits: { max_input_bytes: 100000, max_entities: 100, max_events: 1000, max_diagnostic_events: 1000, max_output_bytes: 100000 } } }) as unknown as SimulationSnapshot;
}
function compare(a: SimulationSnapshot, b: SimulationSnapshot) { return classifyRunComparison({ snapshot: a }, { snapshot: b }); }
function mutate(input: SimulationSnapshot, path: string, value: unknown): SimulationSnapshot {
  const copy = structuredClone(input) as unknown as Record<string, any>;
  const keys = path.split("."); let cursor = copy;
  for (const key of keys.slice(0, -1)) cursor = cursor[key];
  cursor[keys.at(-1)!] = value;
  return copy as unknown as SimulationSnapshot;
}
function reverseKeys(value: any): any { return Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)])) : value; }

describe("completed Run input comparison", () => {
  it("uses canonical object keys but preserves array order", () => {
    const a = snapshot();
    expect(compare(a, reverseKeys(a))).toMatchObject({ category: "exact", snapshotIdentical: true, matchIdChanged: false });
    expect(compare(a, mutate(a, "attacker.program.bytecode", [2, 1])).category).toBe("improved");
  });
  it("treats Match ID alone as the same conditions without promising identical Snapshot/output identity", () => {
    const a = snapshot();
    expect(compare(a, mutate(a, "context.match_id", "match-2"))).toMatchObject({ category: "exact", snapshotIdentical: false, matchIdChanged: true });
  });
  it("allows declared own configuration/program and associated own revision changes only", () => {
    const a = snapshot();
    let b = mutate(a, "attacker.configuration", { heroes: { kind: "list", value: [] }, tactic: { kind: "integer", value: 2 } });
    b = mutate(b, "attacker.revision", "2"); b = mutate(b, "attacker.program.content_digest", "new-program");
    const result = compare(a, b);
    expect(result.category).toBe("improved");
    expect(result.changes.map(change => change.path)).toEqual(expect.arrayContaining(["attacker.configuration", "attacker.program", "attacker.revision"]));
    expect(compare(a, mutate(a, "attacker.revision", "2")).category).toBe("reference");
  });
  it.each([
    ["defender.initial_memory", { state: { kind: "integer", value: 1 } }],
    ["attacker.initial_memory", { state: { kind: "integer", value: 1 } }],
    ["defender.program.bytecode", [1, 3]], ["defender.program.language_version.patch", 1],
    ["defender.id", "different-opponent"], ["defender.revision", "2"], ["attacker.id", "another-army"],
    ["context.initial_world.global_fields", { seed: { kind: "integer", value: 7 } }],
    ["context.world_identity.logic_digest", "other-world"], ["context.world_identity.compiler_version.patch", 1], ["context.ruleset.digest", "other-rules"],
    ["context.versions.engine.patch", 1], ["context.max_ticks", 300],
    ["context.host_limits.max_diagnostic_events", 10], ["context.host_limits.max_input_bytes", 99],
    ["attacker.program.cost_schedule_version.patch", 1], ["attacker.program.language_version.patch", 1],
    ["attacker.ruleset.digest", "changed"], ["attacker.schema_version.patch", 1],
    ["context.other_future_condition", true], ["attacker.other_future_condition", 1],
  ])("classifies non-target %s as reference even alongside own tactics", (path, value) => {
    const a = snapshot(); let b = mutate(a, path, value); b = mutate(b, "attacker.program.content_digest", "own-new");
    expect(compare(a, b).category).toBe("reference");
    expect(compare(a, b).changes.some(change => !change.ownTarget)).toBe(true);
  });
  it.each(["context.world_identity", "context.world_identity.compiler_version", "context.world_identity.logic_digest", "context.ruleset.digest", "context.versions.engine", "context.host_limits.max_events", "attacker.initial_memory", "defender.program.bytecode", "context.match_id"])("never claims equal conditions when required %s is absent", path => {
    const missing = mutate(snapshot(), path, undefined);
    expect(compare(missing, missing)).toMatchObject({ category: "reference" });
    expect(compare(missing, missing).unavailable.length).toBeGreaterThan(0);
  });
  it("preserves campaign provenance and ignores results outside submitted inputs", () => {
    const a = snapshot();
    expect(classifyRunComparison({ snapshot: a, setup: { campaign_scenario_id: "a" } }, { snapshot: a, setup: { campaign_scenario_id: "b" } }).category).toBe("reference");
    expect(compare(a, structuredClone(a)).category).toBe("exact");
  });
});
