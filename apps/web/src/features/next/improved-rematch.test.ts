import { describe, expect, it } from "vitest";
import type { SenkeiSnapshot, SimulationSnapshot } from "../../contracts";
import { buildImprovedRematch } from "./improved-rematch";

const version = { major: 1, minor: 0, patch: 0 };
const ruleset = { id: "next", version, digest: "rules" };
function original(): SimulationSnapshot {
  const side = (id: string): SenkeiSnapshot => ({ schema_version: version, id, revision: "r1", ruleset,
    configuration: { heroes: { kind: "list", value: [] } }, initial_memory: { own: { kind: "integer", value: 7 } },
    program: { language_version: version, ir_version: version, bytecode_version: version, cost_schedule_id: "cu", cost_schedule_version: version, ruleset, content_digest: id, bytecode: [1, 2] } });
  return structuredClone({ attacker: side("own"), defender: side("opponent"), context: {
    schema_version: version, match_id: "original-runtime-id-seed", ruleset, max_ticks: 600,
    versions: Object.fromEntries(["model", "engine", "ruleset", "jinrei_language", "structured_ast", "typed_ir", "bytecode", "cost_schedule", "replay_schema"].map(key => [key, version])),
    host_limits: { max_input_bytes: 100000, max_entities: 100, max_events: 1000, max_diagnostic_events: 1000, max_output_bytes: 100000 },
    initial_world: { entities: {}, global_fields: {}, collections: {} },
    world_identity: { world_id: "world", schema_version: version, minimum_compiler: version, maximum_compiler_exclusive: null,
      validation_profile_id: null, validation_profile_version: null, logic_digest: "logic", presentation_digest: "art" },
  } }) as unknown as SimulationSnapshot;
}
function changed(value: unknown, path: string, next: unknown): any {
  const copy = structuredClone(value) as Record<string, any>, keys = path.split(".");
  let cursor = copy; for (const key of keys.slice(0, -1)) cursor = cursor[key];
  cursor[keys.at(-1)!] = next; return copy;
}
function freeze(value: any): any { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function reverse(value: any): any { return Array.isArray(value) ? value.map(reverse) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)])) : value; }

describe("immutable original-context improved rematch producer", () => {
  it("changes own configuration/code/revision while fixing the complete original context and opponent", () => {
    let base = changed(original(), "context.future_condition", { ordered: [1, 2], opaque: { keep: true } });
    base = changed(base, "defender.future_identity", "keep-opponent");
    base = changed(base, "future_snapshot", ["keep-root"]);
    base = changed(base, "context.max_ticks", 123);
    base = changed(base, "context.host_limits.max_events", 777);
    base = changed(base, "context.versions.engine.patch", 9);
    base = changed(base, "context.initial_world.global_fields", { seed: { kind: "integer", value: 91 } });
    base = changed(base, "context.world_identity.logic_digest", "fixed-other-logic");
    base = changed(base, "defender.program.bytecode", [8, 9]);
    base = changed(base, "defender.initial_memory.own.value", 13);
    base = changed(base, "attacker.future_identity", { fixed: true });
    base = changed(base, "attacker.program.future_runtime_condition", [2, 1]);
    let own = changed(base.attacker, "configuration.heroes.value", [{ kind: "string", value: "new-roster" }]);
    own = changed(own, "program.bytecode", [2, 3]); own = changed(own, "program.content_digest", "compiled-new"); own.revision = "r2";
    const before = JSON.stringify(base), draft = JSON.stringify(own);
    const result = buildImprovedRematch(freeze(base), freeze(own));
    expect(result.status).toBe("ready"); if (result.status !== "ready") return;
    expect(result.comparison.category).toBe("improved");
    expect(result.snapshot.attacker).toEqual(own);
    expect(result.snapshot.defender).toEqual(base.defender);
    expect(result.snapshot.context).toEqual(base.context);
    expect((result.snapshot as any).future_snapshot).toEqual(["keep-root"]);
    expect(result.snapshot.context.match_id).toBe("original-runtime-id-seed");
    expect(JSON.stringify(base)).toBe(before); expect(JSON.stringify(own)).toBe(draft);
    expect(result.snapshot.defender).not.toBe(base.defender); expect(result.snapshot.attacker).not.toBe(own);
    expect(result.snapshot.context.initial_world).not.toBe(base.context.initial_world);
  });
  it("accepts record reordering while treating array order as a target change", () => {
    const base = original();
    const exact = buildImprovedRematch(base, reverse(base.attacker));
    expect(exact.status === "ready" && exact.comparison.category).toBe("exact");
    const improved = buildImprovedRematch(base, changed(base.attacker, "program.bytecode", [2, 1]));
    expect(improved.status === "ready" && improved.comparison.category).toBe("improved");
  });
  it.each([
    ["id", "different"], ["schema_version.patch", 1], ["ruleset.digest", "other"],
    ["initial_memory.own.value", 8], ["program.ruleset.digest", "other"],
    ["program.language_version.patch", 1], ["program.ir_version.patch", 1], ["program.bytecode_version.patch", 1],
    ["program.cost_schedule_id", "other"], ["program.cost_schedule_version.patch", 1],
    ["future_identity", true], ["program.future_runtime_condition", true],
  ])("rejects a changed fixed own condition %s instead of ignoring the edit", (path, value) => {
    const base = original(), own = changed(base.attacker, path, value);
    own.program.content_digest = "new-code";
    expect(buildImprovedRematch(base, own)).toMatchObject({ status: "rejected", reason: "fixed_own_conditions_changed", requires: "current_conditions" });
  });
  it("rejects revision-only edits and unavailable inputs", () => {
    const base = original();
    expect(buildImprovedRematch(base, changed(base.attacker, "revision", "r2"))).toMatchObject({ status: "rejected", reason: "revision_without_improvement" });
    expect(buildImprovedRematch(base, changed(base.attacker, "program.bytecode", undefined))).toMatchObject({ status: "rejected", reason: "non_json_input" });
    const missing = changed(base, "context", {});
    expect(buildImprovedRematch(missing, base.attacker)).toMatchObject({ status: "rejected", reason: "unavailable_inputs" });
  });
  it.each([undefined, NaN, Infinity, 1n, new Date(), [undefined], new Array(1)])("rejects lossy JSON boundaries (%s)", value => {
    const base = original(), own = changed(base.attacker, "future", value);
    expect(buildImprovedRematch(base, own)).toMatchObject({ status: "rejected", reason: "non_json_input" });
  });
  it("rejects cycles and returns no input aliases", () => {
    const base = original(), own = structuredClone(base.attacker) as any; own.cycle = own;
    expect(buildImprovedRematch(base, own).status).toBe("rejected");
    const result = buildImprovedRematch(base, base.attacker); if (result.status !== "ready") throw new Error("merge failed");
    (result.snapshot.defender.program.bytecode as number[])[0] = 99;
    expect(base.defender.program.bytecode).toEqual([1, 2]);
  });
});
