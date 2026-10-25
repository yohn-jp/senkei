import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CatalogLoadError,
  digestMaterialJson,
  loadDomainCatalog,
  sameCatalog,
  type DomainCatalogDocument,
} from "./src/catalog.js";
import {
  EditorSession,
  behaviorCoverage,
  catalogEntries,
  completeCatalog,
  jsonCompilerGateway,
  observedField,
  searchCatalog,
  hoverCatalog,
  type CompilerGateway,
  type CompilerRequest,
  type CompilerReply,
} from "./src/editor.js";
import { renderJinreiEditorMarkup } from "./src/view.js";

const rawCatalog = readFileSync(new URL("./fixtures/next-domain-catalog.json", import.meta.url), "utf8");
const rawProfileCatalog = readFileSync(new URL("./fixtures/next-domain-catalog-with-profile.json", import.meta.url), "utf8");
const compiledByJinrei = readFileSync(new URL("./fixtures/next-compile-reply.json", import.meta.url), "utf8");
const rejectedByJinrei = readFileSync(new URL("./fixtures/next-compile-rejected.json", import.meta.url), "utf8");
const expected = {
  rulesetId: "senkei.next",
  rulesetVersion: { major: 1, minor: 0, patch: 0 },
  rulesetDigest: "19c7b44ec5649f739bb9727bc220f70e030045651190c1d774b5392f319e4a75",
};

async function catalog(): Promise<DomainCatalogDocument> { return loadDomainCatalog(rawCatalog, expected); }

describe("Jinrei Editor catalog client", () => {
  it("loads a canonical Catalog emitted by the real verified Senritsu producer", async () => {
    const value = await catalog();
    expect(value.identity.rulesetId).toBe("senkei.next");
    expect(value.identity.rulesetDigest).toBe(expected.rulesetDigest);
    expect(value.behaviorProfiles.status).toBe("not_declared_by_rule_package");
    expect(Object.keys(value.capabilities).length).toBeGreaterThan(0);
    expect(value.costSchedule).toHaveProperty("operations");
  });

  it("loads typed profile fields and named presets emitted by the real Catalog producer", async () => {
    const value = await loadDomainCatalog(rawProfileCatalog, expected);
    expect(value.behaviorProfiles.status).toBe("authored_extension");
    if (value.behaviorProfiles.status !== "authored_extension") return;
    const profile = value.behaviorProfiles.value!.metadata;
    expect(profile.fields["navigation.mode"]?.valueType).toEqual({ kind: "string", value: { max_bytes: 64 } });
    expect(profile.presets["navigation.safest"]?.values["navigation.mode"]).toEqual({ kind: "string", value: "safest" });
    const actor = { scope: "hero", side: "attacker", squadId: "squad-1", heroId: "hero-1", packageEntityType: "hero" } as const;
    expect(completeCatalog(value, actor, "navigation", "behavior_profile").map((item) => item.kind))
      .toEqual(["behavior_profile", "behavior_preset"]);
    expect(hoverCatalog(value, actor, "behaviorPreset.navigation.safest")?.detail).toContain("Fixture named preference");
    expect(behaviorCoverage(value, { ...actor, heroCatalogId: "unknown-hero" }, "default").cells[0]?.senritsuDefaultValue)
      .toEqual({ kind: "string", value: "safest" });
  });

  it("rejects RulePackage and content digest mismatches", async () => {
    await expect(loadDomainCatalog(rawCatalog, { ...expected, rulesetId: "senkei.initial" }))
      .rejects.toMatchObject({ code: "package_mismatch" });
    const firstSymbolName = (JSON.parse(rawCatalog) as { symbols: Array<{ displayName: string }> }).symbols[0]!.displayName;
    const altered = rawCatalog.replace(`"displayName":${JSON.stringify(firstSymbolName)}`, '"displayName":"EVIL"');
    await expect(loadDomainCatalog(altered)).rejects.toMatchObject({ code: "digest_mismatch" });
  });

  it("accepts additive capability metadata and rejects malformed typed profile values", async () => {
    const augmented = rawProfileCatalog.replace('"description":null,', '"description":null,"behaviorOverrideArguments":{"navigation.mode":1},"futureMetadata":{"enabled":true},');
    expect(augmented).not.toBe(rawProfileCatalog);
    const material = digestMaterialJson(augmented);
    const digest = createHash("sha256").update(material).digest("hex");
    const augmentedWithDigest = augmented.replace(/"catalogDigest":"[0-9a-f]{64}"/, `"catalogDigest":"${digest}"`);
    const value = await loadDomainCatalog(augmentedWithDigest, expected);
    expect(value.capabilities.activate?.behaviorOverrideArguments).toEqual({ "navigation.mode": 1 });
    expect(value.capabilities.activate?.futureMetadata).toEqual({ enabled: true });
    const wrongArgumentType = augmentedWithDigest.replace('"navigation.mode":1', '"navigation.mode":0');
    await expect(loadDomainCatalog(wrongArgumentType)).rejects.toMatchObject({ code: "invalid_shape" });

    const malformedProfile = rawProfileCatalog.replace('"kind":"string","value":"safest"', '"kind":"integer","value":999');
    await expect(loadDomainCatalog(malformedProfile)).rejects.toMatchObject({ code: "invalid_shape" });
  });

  it("removes the digest without reserializing UTF-8 or integer-like map keys", () => {
    const values = `{"10":"十","2":"二","text":"é\u2028\\\""}`;
    const material = `{"identity":{"values":${values}},"metadata_extension_digest":null,"symbols":[],"observations":{},"collections":{},"capabilities":{},"entity_types":{},"cost_schedule":{},"ordering":{},"entity_scopes":{},"capability_metadata":{},"behavior_profiles":{}}`;
    const raw = `{"identity":{"values":${values}},"catalogDigest":"${"a".repeat(64)}","metadataExtensionDigest":null,"symbols":[],"observations":{},"collections":{},"capabilities":{},"entityTypes":{},"costSchedule":{},"ordering":{},"entityScopes":{},"capabilityMetadata":{},"behaviorProfiles":{}}`;
    expect(digestMaterialJson(raw)).toBe(material);
    const reorderedValues = `{"2":"二","10":"十","text":"é\u2028\\\""}`;
    const reorderedMaterial = material.replace(values, reorderedValues);
    expect(digestMaterialJson(raw)).not.toBe(reorderedMaterial);
  });

  it("fails closed for unsupported Catalog schema and malformed root", async () => {
    const data = JSON.parse(rawCatalog) as Record<string, unknown>;
    (data.identity as Record<string, unknown>).schemaVersion = { major: 9, minor: 0, patch: 0 };
    await expect(loadDomainCatalog(JSON.stringify(data))).rejects.toMatchObject({ code: "unsupported_schema" });
    await expect(loadDomainCatalog("[]")).rejects.toBeInstanceOf(CatalogLoadError);
  });
});

describe("catalog-backed editor model", () => {
  const actor = { scope: "hero", side: "attacker", squadId: "squad-1", heroId: "hero-1", packageEntityType: "hero" } as const;

  it("searches and completes Catalog symbols, observations, collections, and capabilities", async () => {
    const value = await catalog();
    expect(searchCatalog(value, actor, "allies.heroes").some((entry) => entry.kind === "collection")).toBe(true);
    expect(completeCatalog(value, actor, "move").some((item) => item.kind === "capability")).toBe(true);
    expect(hoverCatalog(value, actor, "activate")?.detail).toContain("3 CU");
    expect(hoverCatalog(value, actor, "activate")?.detail).toContain("scope package_entity(hero)");
    expect(catalogEntries(value, actor).every((entry) => entry.id.length > 0)).toBe(true);
    const unknownEntityType = { scope: "hero", side: "attacker", squadId: "squad-1", heroId: "hero-1" } as const;
    expect(catalogEntries(value, unknownEntityType).some((entry) => entry.id === "allies.heroes")).toBe(false);
  });

  it("keeps Permission Denied, Unknown, and unconnected Observed distinct", async () => {
    const value = await catalog();
    const denied = Object.entries(value.observations).find(([, field]) => field.readPermission === "internal_denied");
    if (denied) expect(observedField(value, denied[0])).toMatchObject({ status: "PERMISSION_DENIED" });
    expect(observedField(value, "match.tick")).toEqual({ status: "NOT_CHECKED" });
    expect(observedField(value, "match.tick", {
      stamp: { identity: value.identity, catalogDigest: value.catalogDigest, metadataExtensionDigest: null },
      tick: 1, side: "attacker", ownerAuthorized: false, fields: { "match.tick": { status: "known", value: 2 } },
    }, "attacker")).toEqual({ status: "KNOWN", value: 2 });
    const owning = Object.entries(value.observations).find(([, field]) => field.readPermission === "owning_side");
    if (owning) {
      expect(observedField(value, owning[0], undefined, "attacker")).toEqual({ status: "NOT_CHECKED" });
      expect(observedField(value, owning[0], { stamp: { identity: value.identity, catalogDigest: value.catalogDigest, metadataExtensionDigest: null }, tick: 1, side: "defender", ownerAuthorized: true, fields: { [owning[0]]: { status: "known", value: 1 } } }, "attacker"))
        .toMatchObject({ status: "PERMISSION_DENIED" });
      expect(observedField(value, owning[0], { stamp: { identity: value.identity, catalogDigest: value.catalogDigest, metadataExtensionDigest: null }, tick: 1, side: "attacker", ownerAuthorized: false, fields: { [owning[0]]: { status: "known", value: 1 } } }, "attacker"))
        .toMatchObject({ status: "PERMISSION_DENIED" });
      expect(observedField(value, owning[0], { stamp: { identity: value.identity, catalogDigest: value.catalogDigest, metadataExtensionDigest: null }, tick: 1, side: "attacker", ownerAuthorized: true, fields: { [owning[0]]: { status: "unknown" } } }, "attacker"))
        .toEqual({ status: "UNKNOWN" });
    }
  });

  it("reports Coverage as Not Proven without static proof or Enbu trace", async () => {
    const result = behaviorCoverage(await catalog(), actor, "effective");
    expect(result).toMatchObject({ surface: "effective", status: "not_proven", provenFields: 0 });
    expect(result.cells.every((cell) => cell.observedStatus === "NOT_CHECKED")).toBe(true);
    expect(result.cells.some((cell) => cell.defaultStatus === "not_declared")).toBe(true);
  });

  it("discards compile replies from an older draft revision", async () => {
    const value = await catalog();
    const session = new EditorSession(value, actor);
    session.setDraft("senkei draft { action wait { when true, do move(), }, }");
    let complete!: (reply: CompilerReply) => void;
    const gateway: CompilerGateway = { compile: (_request: CompilerRequest) => new Promise((resolve) => { complete = resolve; }) };
    const pending = session.compile(gateway);
    session.setDraft("senkei newer { action wait { when true, do move(), }, }");
    complete({ status: "rejected", stamp: { identity: value.identity, catalogDigest: value.catalogDigest, metadataExtensionDigest: null }, error: { code: "compile_failed", message: "stale" } });
    await expect(pending).resolves.toBeUndefined();
    expect(session.snapshot().lastCompilerReply).toBeUndefined();
  });

  it("adapts the real Rust Jinrei compiler JSON wire reply", async () => {
    const value = await catalog();
    const source = "senkei editor_test { action hold { when true, do move(argmin hero in allies.heroes by hero.level then hero.id, \"attacker_base\"), }, }";
    const gateway = jsonCompilerGateway(async (request) => {
      const decoded = JSON.parse(request) as { source: string; revision: number; stamp: { catalogDigest: string } };
      expect(decoded.source).toBe(source);
      expect(decoded.revision).toBe(4);
      expect(decoded.stamp.catalogDigest).toBe(value.catalogDigest);
      return compiledByJinrei;
    });
    const reply = await gateway.compile({ source, stamp: {
      identity: value.identity, catalogDigest: value.catalogDigest, metadataExtensionDigest: value.metadataExtensionDigest,
    }, revision: 4 });
    expect(reply.status).toBe("compiled");
    if (reply.status === "compiled") expect(reply.result.estimated_cu).toBeGreaterThan(0);
    const mismatched = jsonCompilerGateway(async () => compiledByJinrei.replace(value.catalogDigest, "0".repeat(64)));
    await expect(mismatched.compile({ source, stamp: {
      identity: value.identity, catalogDigest: value.catalogDigest, metadataExtensionDigest: value.metadataExtensionDigest,
    }, revision: 4 })).rejects.toThrow("selected Catalog");
    const malformedGateway = jsonCompilerGateway(async () => '{"revision":4,"reply":{"status":"compiled","stamp":null}}');
    await expect(malformedGateway.compile({ source, stamp: {
      identity: value.identity, catalogDigest: value.catalogDigest, metadataExtensionDigest: value.metadataExtensionDigest,
    }, revision: 4 })).rejects.toThrow("selected Catalog");
    const rejectedGateway = jsonCompilerGateway(async (request) => {
      const decoded = JSON.parse(request) as { source: string; revision: number };
      expect(decoded.source).toBe("senkei editor_test { action bad { when true, do missing(), }, }");
      expect(decoded.revision).toBe(9);
      return rejectedByJinrei;
    });
    const rejected = await rejectedGateway.compile({ source: "senkei editor_test { action bad { when true, do missing(), }, }", stamp: {
      identity: value.identity, catalogDigest: value.catalogDigest, metadataExtensionDigest: value.metadataExtensionDigest,
    }, revision: 9 });
    expect(rejected).toMatchObject({ status: "rejected", error: { code: "validation_failed", message: "unknown capability 'missing'" } });
  });

  it("checks the complete catalog stamp when caching a comparison", async () => {
    const value = await catalog();
    expect(sameCatalog({ identity: value.identity, catalogDigest: value.catalogDigest, metadataExtensionDigest: null }, {
      identity: value.identity, catalogDigest: "0".repeat(64), metadataExtensionDigest: null,
    })).toBe(false);
  });

  it("renders an escaped, operable foundation view with all comparison surfaces", async () => {
    const value = await loadDomainCatalog(rawProfileCatalog, expected);
    const unsafeActor = { scope: "hero", side: "attacker", squadId: "<squad>", heroId: "hero-1", packageEntityType: "hero" } as const;
    const source = "senkei draft { } <script>";
    const sourceView = renderJinreiEditorMarkup(value, unsafeActor, "source", source);
    expect(sourceView).toContain("<textarea id=\"jinrei-source\" data-source>senkei draft { } &lt;script&gt;</textarea>");
    expect(sourceView).toContain("&lt;squad&gt;");
    const catalogView = renderJinreiEditorMarkup(value, unsafeActor, "catalog", "", "activate", "activate");
    expect(catalogView).toContain("role=\"tabpanel\" aria-label=\"Domain Catalog\"");
    expect(catalogView).toContain("3 CU + 0 CU/item");
    const coverageView = renderJinreiEditorMarkup(value, unsafeActor, "coverage");
    expect(coverageView).toContain("not_proven · proven fields 0 /");
    expect(coverageView).toContain("NOT_CHECKED");
    const observedView = renderJinreiEditorMarkup(value, unsafeActor, "observed");
    expect(observedView).toContain("NOT_CHECKED");
    expect(observedView).toContain("authorized Enbu adapter");
  });
});
