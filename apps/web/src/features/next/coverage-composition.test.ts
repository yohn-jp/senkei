import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { behaviorCoveragePresentation, loadDomainCatalog } from "@senkei/jinrei-editor";
import type { BehaviorProfileComposition, BehaviorResolveReply } from "../../contracts/behavior-resolution";
import type { RulePackage } from "../../contracts";
import { baselineComposition, baselineRequest, inheritedCoverageRows, profileValueText } from "./coverage-composition";

async function catalogFixture() {
  const json = readFileSync(fileURLToPath(new URL("../../../../../packages/jinrei-editor/fixtures/next-domain-catalog-with-profile.json", import.meta.url)), "utf8");
  const value = JSON.parse(json);
  return loadDomainCatalog(json, { rulesetId: value.identity.rulesetId, rulesetVersion: value.identity.rulesetVersion, rulesetDigest: value.identity.rulesetDigest });
}

describe("Catalog baseline composition", () => {
  it("binds a hypothetical default to the exact Catalog, actor, roster and revision", async () => {
    const catalog = await catalogFixture();
    const slots = [{ slot_id: "s1", catalog_id: "F01", squad: "front" }, { slot_id: "s2", catalog_id: "F02", squad: "front" }];
    const request = baselineRequest(3, catalog, {} as RulePackage, {}, "hero", slots, slots[0])!;
    expect(request.evaluation).toEqual({ kind: "defaults_only" });
    expect(request.preferences.army).toEqual({});
    expect(request.actor.squadMembers).toHaveLength(2);
    const composition: BehaviorProfileComposition = {
      catalog_identity: request.stamp, actor_scope: "hero", actor_id: "s1", movement_authority: "HeroInSquad",
      tick: 0, side: "attacker", squad_members: ["s1", "s2"], digest: "profile-digest",
      values: { "navigation.mode": { kind: "bool", value: false } }, provenance: {},
      unknown_conditions: [], unknown_overrides: [], rejected_overrides: [],
    };
    const reply: BehaviorResolveReply = { revision: 3, stamp: request.stamp, evaluationKind: "defaults_only", status: "resolved", composition };
    expect(baselineComposition(request, reply)).toBe(composition);
    expect(profileValueText(composition.values["navigation.mode"])).toBe("false");
    expect(profileValueText({ kind: "integer", value: 0 })).toBe("0");
    expect(baselineComposition(request, { ...reply, revision: 4 })).toBeNull();
    expect(baselineComposition(request, { ...reply, stamp: { ...request.stamp, catalogDigest: "other" } })).toBeNull();
    expect(baselineComposition(request, { ...reply, composition: { ...composition, actor_id: "s2" } })).toBeNull();
    expect(baselineComposition(request, { ...reply, composition: { ...composition, squad_members: ["s1"] } })).toBeNull();
    expect(baselineComposition(request, { ...reply, composition: { ...composition, unknown_conditions: [{ action_id: "x", truth: "unknown" }] } })).toBeNull();
    expect(baselineComposition(request, { ...reply, evaluationKind: "provided" })).toBeNull();
  });

  it("includes fields inherited from Army and Squad without claiming a resolved value", async () => {
    const catalog = await catalogFixture();
    if (catalog.behaviorProfiles.status !== "authored_extension") throw new Error("missing fixture profile");
    const metadata = catalog.behaviorProfiles.value.metadata;
    metadata.fields["army.preference"] = { ...metadata.fields["navigation.mode"], scopes: ["army"] };
    metadata.senritsuDefault["army.preference"] = { kind: "bool", value: false };
    const actor = { scope: "hero" as const, side: "attacker" as const, squadId: "front", heroId: "s1", heroCatalogId: "F01" };
    const rows = inheritedCoverageRows(catalog, "hero", "F01", behaviorCoveragePresentation(catalog, actor, "default").rows);
    expect(rows.find(row => row.fieldId === "army.preference")).toMatchObject({ senritsuDefault: "false", effectiveStatus: "not_proven", observedStatus: "NOT_CHECKED" });
  });
});
