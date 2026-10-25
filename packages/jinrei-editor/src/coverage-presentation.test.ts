import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDomainCatalog } from "./catalog.js";
import { behaviorCoveragePresentation } from "./coverage-presentation.js";

async function fixture(name: string) {
  const json = readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
  const parsed = JSON.parse(json) as { identity: { rulesetId: string; rulesetVersion: { major: number; minor: number; patch: number }; rulesetDigest: string } };
  return loadDomainCatalog(json, {
    rulesetId: parsed.identity.rulesetId,
    rulesetVersion: parsed.identity.rulesetVersion,
    rulesetDigest: parsed.identity.rulesetDigest,
  });
}

describe("Behavior Coverage presentation", () => {
  it("shows authored defaults while keeping Effective, Explicit and Observed unproven", async () => {
    const catalog = await fixture("next-domain-catalog-with-profile.json");
    const report = behaviorCoveragePresentation(catalog, {
      scope: "hero", side: "attacker", squadId: "squad-1", heroId: "slot-01", heroCatalogId: "F01",
    }, "effective");

    expect(report.profileDeclared).toBe(true);
    expect(report.status).toBe("not_proven");
    expect(report.provenFields).toBe(0);
    expect(report.rows).toEqual([expect.objectContaining({
      fieldId: "navigation.mode",
      defaultStatus: "available",
      senritsuDefault: '"safest"',
      heroCatalogDefault: "No Hero override declared",
      explicitStatus: "NOT_PROVEN",
      effectiveStatus: "not_proven",
      observedStatus: "NOT_CHECKED",
    })]);
  });

  it("keeps undeclared Profile data distinct from a declared empty/default value", async () => {
    const catalog = await fixture("next-domain-catalog.json");
    const report = behaviorCoveragePresentation(catalog, { scope: "army", side: "attacker" }, "default");

    expect(report.profileDeclared).toBe(false);
    expect(report.rows[0]).toEqual(expect.objectContaining({
      fieldId: "behaviorProfiles",
      defaultStatus: "not_declared",
      senritsuDefault: "Not declared by this RulePackage",
      effectiveStatus: "not_proven",
      observedStatus: "NOT_CHECKED",
    }));
  });
});
