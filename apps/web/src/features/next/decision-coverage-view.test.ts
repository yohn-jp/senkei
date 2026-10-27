import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { catalogStamp } from "@senkei/jinrei-editor";
import type { DomainCatalogDocument } from "@senkei/jinrei-editor";
import type { RulePackage, StructuredTacticsAst, TacticalProgram } from "../../contracts";
import { DecisionCoverage } from "./DecisionCoverage";

const catalog = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../packages/jinrei-editor/fixtures/next-domain-catalog.json", import.meta.url)), "utf8")) as DomainCatalogDocument;
const i = catalog.identity;
const rulePackage = { ruleset: { id: i.rulesetId, version: i.rulesetVersion, digest: i.rulesetDigest },
  minimum_engine_version: i.minimumEngineVersion, model_version: i.modelVersion, primitive_set_id: i.primitiveSetId,
  primitive_set_version: i.primitiveSetVersion, jinrei_language_version: i.jinreiLanguageVersion,
  structured_ast_version: i.structuredAstVersion, typed_ir_version: i.typedIrVersion, bytecode_version: i.bytecodeVersion,
  cost_schedule: { id: catalog.costSchedule.id, version: catalog.costSchedule.version } } as RulePackage;
const program = { ruleset: rulePackage.ruleset, language_version: i.jinreiLanguageVersion, ir_version: i.typedIrVersion,
  bytecode_version: i.bytecodeVersion, cost_schedule_id: catalog.costSchedule.id, cost_schedule_version: catalog.costSchedule.version,
  content_digest: "a".repeat(64), bytecode: [] } as TacticalProgram;
const actor = { scope: "hero", side: "attacker", heroId: "hero-1", squadId: "squad-1" } as const;
const ast: StructuredTacticsAst = { schema_version: i.structuredAstVersion, program_name: "test", declarations: [] };

describe("DecisionCoverage", () => {
  it("renders the empty-program default as an unproved candidate, not an error or a fabricated profile", () => {
    const html = renderToStaticMarkup(createElement(DecisionCoverage, { ast, program, compilationStamp: catalogStamp(catalog),
      catalog, rulePackage, actor, profile: null }));
    expect(html).toContain("Default candidate");
    expect(html).toContain("declares no actions");
    expect(html).toContain("does not declare a Behavior Profile");
    expect(html).toContain("No final action or reachability is proved");
    expect(html).not.toContain("100%");
  });

  it("shows threshold classes and Unknown without presenting legality hypotheses as facts", () => {
    const conditional: StructuredTacticsAst = { ...ast, declarations: [{ kind: "action", name: "early", when: {
      kind: "compare", value: { left: { kind: "path", value: ["match", "tick"] }, operator: "less_than",
        right: { kind: "literal", value: { kind: "integer", value: 10 } } },
    }, do_call: { capability: ["move"], arguments: [] } }] };
    const html = renderToStaticMarkup(createElement(DecisionCoverage, { ast: conditional, program, compilationStamp: catalogStamp(catalog),
      catalog, rulePackage, actor, profile: null }));
    expect(html).toContain("0…9");
    expect(html).toContain("10…10");
    expect(html).toContain("Unknown");
    expect(html).toContain("legal (hypothesis)");
    expect(html).toContain("total number of classes is not established");
  });

  it("does not associate a compiled AST with a Catalog without its retained compiler stamp", () => {
    const html = renderToStaticMarkup(createElement(DecisionCoverage, { ast, program, compilationStamp: null,
      catalog, rulePackage, actor, profile: null }));
    expect(html).toContain("not checked");
    expect(html).toContain("Compile the current draft");
    expect(html).not.toContain("constructed partitions");
  });
});
