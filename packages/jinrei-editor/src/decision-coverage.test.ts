import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogStamp } from "./catalog.js";
import type { DomainCatalogDocument, DomainType } from "./catalog.js";
import { analyzeDecisionCoverage } from "./decision-coverage.js";
import type { CoverageAst, CoverageRulePackage, DecisionCoverageInput } from "./decision-coverage.js";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/next-domain-catalog.json", import.meta.url)), "utf8")) as DomainCatalogDocument;
const actor = { scope: "hero", side: "attacker", squadId: "squad-1", heroId: "hero-1" } as const;
const literal = (kind: string, value: unknown) => ({ kind: "literal", value: { kind, value } });
const path = (value: string) => ({ kind: "path", value: value.split(".") });
const compare = (pathName: string, operator: string, kind: string, value: unknown) => ({ kind: "compare", value: { left: path(pathName), operator, right: literal(kind, value) } });
const action = (name: string, when: unknown) => ({ kind: "action" as const, name, when, do_call: { capability: ["move"], arguments: [] } });
function setup(declarations: CoverageAst["declarations"], source = fixture): DecisionCoverageInput {
  const catalog = structuredClone(source), i = catalog.identity;
  const rulePackage: CoverageRulePackage = {
    ruleset: { id: i.rulesetId, version: i.rulesetVersion, digest: i.rulesetDigest },
    minimum_engine_version: i.minimumEngineVersion, model_version: i.modelVersion,
    primitive_set_id: i.primitiveSetId, primitive_set_version: i.primitiveSetVersion,
    jinrei_language_version: i.jinreiLanguageVersion, structured_ast_version: i.structuredAstVersion,
    typed_ir_version: i.typedIrVersion, bytecode_version: i.bytecodeVersion,
    cost_schedule: { id: catalog.costSchedule.id, version: catalog.costSchedule.version },
  };
  return { ast: { schema_version: i.structuredAstVersion, declarations }, rulePackage, catalog,
    compilationStamp: catalogStamp(catalog), actor, profile: null,
    program: { ruleset: rulePackage.ruleset, language_version: i.jinreiLanguageVersion, ir_version: i.typedIrVersion,
      bytecode_version: i.bytecodeVersion, cost_schedule_id: catalog.costSchedule.id,
      cost_schedule_version: catalog.costSchedule.version, content_digest: "a".repeat(64) } };
}
function addObservation(input: DecisionCoverageInput, name: string, type: DomainType) {
  const catalog = input.catalog!;
  catalog.observations[name] = { ...catalog.observations["match.tick"]!, id: name, valueType: type,
    allowedOperators: ["equal", "not_equal", "less_than", "less_than_or_equal", "greater_than", "greater_than_or_equal", "known", "unknown"] };
}
function analyzed(input: DecisionCoverageInput) {
  const report = analyzeDecisionCoverage(input);
  if (report.status !== "analyzed") throw new Error(report.reason);
  return report;
}

describe("finite decision classes", () => {
  it("partitions inclusive integer boundaries and retains Unknown, actor and legality hypotheses", () => {
    const input = setup([action("before", compare("match.tick", "less_than", "integer", 5))]);
    addObservation(input, "match.tick", { kind: "integer", value: { min: 0, max: 10 } });
    const report = analyzed(input);
    expect(report.axes[0]?.values.map(value => value.label)).toEqual(["0…4", "5…5", "6…10", "Unknown"]);
    expect(report.classes.filter(c => c.values["match.tick"]?.label === "0…4").map(c => c.actions[0]?.hypothesis))
      .toEqual(["applies_legal", "applies_illegal", "other_actor", "unresolved"]);
    expect(report.classes.filter(c => c.values["match.tick"]?.label === "5…5")[0]?.actions[0]?.condition).toBe("false");
    expect(report.classes.filter(c => c.values["match.tick"]?.label === "Unknown")[0]).toMatchObject({ status: "UNKNOWN", disposition: "unresolved" });
    expect(report.partitionComplete).toBe(false);
    expect(report.classes.every(c => c.status !== ("PROVEN" as string))).toBe(true);
  });

  it("keeps fixed-point threshold endpoints exact and handles reversed operands", () => {
    const threshold = { coefficient: 150, scale: 2 };
    const when = { kind: "compare", value: { left: literal("fixed", threshold), operator: "less_than_or_equal", right: path("measure") } };
    const input = setup([action("at_or_above", when)]);
    addObservation(input, "measure", { kind: "fixed", value: { min: 0, max: 200, scale: 2 } });
    const report = analyzed(input);
    const results = Object.fromEntries(report.classes.map(c => [c.values.measure?.label, c.actions[0]?.condition]));
    expect(results["0…149 (coefficient, scale 2)"]).toBe("false");
    expect(results["150…150 (coefficient, scale 2)"]).toBe("true");
    expect(results["151…200 (coefficient, scale 2)"]).toBe("true");
    expect(results.Unknown).toBe("unknown");
  });

  it("uses every finite enum and bool value and evaluates explicit knownness", () => {
    const input = setup([action("unknown", { kind: "knownness", value: { value: path("flag"), test: "unknown" } }),
      action("red", compare("color", "equal", "enum", "red"))]);
    addObservation(input, "flag", { kind: "bool" });
    addObservation(input, "color", { kind: "enum", value: { domain: "test-color", values: ["red", "blue"] } });
    const report = analyzed(input);
    expect(report.axes.find(a => a.path === "flag")?.values.map(v => v.label)).toEqual(["false", "true", "Unknown"]);
    expect(report.axes.find(a => a.path === "color")?.values.map(v => v.label)).toEqual(["red", "blue", "Unknown"]);
    const known = report.classes.find(c => c.values.flag?.label === "false" && c.values.color?.label === "blue")!;
    expect(known.actions.map(a => a.condition)).toEqual(["false", "false"]);
    const missing = report.classes.find(c => c.values.flag?.label === "Unknown" && c.values.color?.label === "blue")!;
    expect(missing.actions[0]?.condition).toBe("true");
    expect(missing.status).toBe("UNKNOWN");
  });

  it("expands referenced states and marks dynamic expressions as an unenumerated remainder", () => {
    const unsupported = { kind: "quantified", value: { quantifier: "any", binding: "hero", collection: { kind: "path", value: ["allies", "heroes"] }, predicates: [] } };
    const input = setup([{ kind: "state", name: "ready", predicates: [compare("match.tick", "greater_than", "integer", 3), unsupported] },
      action("conditional", { kind: "state_reference", value: "ready" })]);
    const report = analyzed(input);
    expect(report.axes[0]?.path).toBe("match.tick");
    expect(report.unresolved.some(reason => reason.includes("quantified"))).toBe(true);
    expect(report.classes.every(c => c.actions[0]?.condition === "not_proven")).toBe(true);
    expect(report.classes.every(c => c.reasons.some(reason => reason.includes("further decision classes")))).toBe(true);
    expect(report.partitionComplete).toBe(false);
  });

  it("keeps conflict-key alternatives separate and marks them as hypotheses", () => {
    const input = setup([action("a", { kind: "literal_truth", value: true }), action("b", { kind: "literal_truth", value: true })]);
    input.catalog!.capabilities.move!.arbitration = { conflict_keys: [{ kind: "actor" }, { kind: "target" }] };
    const report = analyzed(input);
    const bothLegal = report.classes.filter(c => c.actions.every(a => a.hypothesis === "applies_legal"));
    expect(bothLegal.map(c => c.conflict)).toEqual([expect.stringContaining("matching conflict keys"), expect.stringContaining("different conflict keys")]);
    expect(bothLegal.every(c => c.status === "NOT_PROVEN")).toBe(true);
  });

  it("does not assume dynamic actors match, and proves actor-key equality only for equal literals", () => {
    const yes = { kind: "literal_truth", value: true };
    const input = setup([action("a", yes), action("b", yes)]);
    input.catalog!.capabilities.move!.arbitration = { conflict_keys: [{ kind: "actor" }] };
    let bothLegal = analyzed(input).classes.filter(c => c.actions.every(a => a.hypothesis === "applies_legal"));
    expect(bothLegal.map(c => c.conflict)).toEqual([expect.stringContaining("matching conflict keys"), expect.stringContaining("different conflict keys")]);

    const entity = literal("entity", "hero-1");
    const a = { ...action("a", yes), do_call: { capability: ["move"], arguments: [entity] } };
    const b = { ...action("b", yes), do_call: { capability: ["move"], arguments: [entity] } };
    const concrete = setup([a, b]);
    concrete.catalog!.capabilities.move!.arbitration = { conflict_keys: [{ kind: "actor" }] };
    concrete.catalog!.capabilities.move!.actorArgument = 0;
    bothLegal = analyzed(concrete).classes.filter(c => c.actions.every(item => item.hypothesis === "applies_legal"));
    expect(bothLegal).toHaveLength(1);
    expect(bothLegal[0]?.conflict).toContain("matching literal actor conflict key");
  });

  it("shows the default path for a source without actions, without asserting a final action or an error", () => {
    const report = analyzed(setup([{ kind: "state", name: "unused", predicates: [{ kind: "literal_truth", value: false }] }]));
    expect(report.noAuthoredActions).toBe(true);
    expect(report.classes).toHaveLength(1);
    expect(report.classes[0]).toMatchObject({ disposition: "default_candidate", status: "NOT_PROVEN", actions: [] });
    expect(report.profileDeclared).toBe(false);
  });

  it("retains an identity-matched default Profile as a baseline without proving an action", () => {
    const authored = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/next-domain-catalog-with-profile.json", import.meta.url)), "utf8")) as DomainCatalogDocument;
    const input = setup([], authored);
    const profile = { catalog_identity: catalogStamp(input.catalog!), actor_scope: "hero" as const, actor_id: "hero-1", side: "attacker" as const,
      tick: 0, values: { "navigation.mode": { kind: "string", value: "safest" } }, provenance: { "navigation.mode": { layer: "senritsu_default", source: "catalog" } } };
    const report = analyzed({ ...input, profile });
    expect(report.profile).toBe(profile);
    expect(report.profileDeclared).toBe(true);
    expect(report.classes[0]).toMatchObject({ status: "NOT_PROVEN", disposition: "default_candidate" });
  });

  it("invalidates stale compilation, package and profile identities", () => {
    const input = setup([]);
    expect(analyzeDecisionCoverage({ ...input, compilationStamp: null })).toMatchObject({ status: "unavailable" });
    expect(analyzeDecisionCoverage({ ...input, compilationStamp: { ...input.compilationStamp!, catalogDigest: "stale" } })).toMatchObject({ status: "unavailable" });
    expect(analyzeDecisionCoverage({ ...input, rulePackage: { ...input.rulePackage!, model_version: { major: 9, minor: 0, patch: 0 } } })).toMatchObject({ status: "unavailable" });
    expect(analyzeDecisionCoverage({ ...input, profile: { catalog_identity: catalogStamp(input.catalog!), actor_scope: "hero", actor_id: "other", side: "attacker", tick: 0, values: {}, provenance: {} } })).toMatchObject({ status: "unavailable" });
  });

  it("reports an unenumerated full remainder instead of sampling when the class limit is exceeded", () => {
    const declarations = Array.from({ length: 6 }, (_, index) => action(`a${index}`, { kind: "literal_truth", value: true }));
    const report = analyzed(setup(declarations));
    expect(report.classes).toHaveLength(0);
    expect(report.unresolved.some(reason => reason.includes("Class limit"))).toBe(true);
    expect(report.partitionComplete).toBe(false);
  });
});
