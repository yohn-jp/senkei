import {
  type CatalogCapability,
  type CatalogCollection,
  type BehaviorFieldMetadata,
  type NamedBehaviorPreset,
  type CatalogStamp,
  type CatalogSymbol,
  type DomainCatalogDocument,
  type DomainValue,
  type DomainType,
  type ObservationDefinition,
  sameCatalog,
} from "./catalog.js";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ActorSelection =
  | { scope: "army"; side: "attacker" | "defender" }
  | { scope: "squad"; side: "attacker" | "defender"; squadId: string }
  | { scope: "hero"; side: "attacker" | "defender"; squadId: string; heroId: string; heroCatalogId?: string; packageEntityType?: string }
  | { scope: "lane_limited_minion"; side: "attacker" | "defender"; lane: string };

export type CatalogEntryKind = "constant" | "observation" | "collection" | "collection_field" | "capability" | "behavior_profile" | "behavior_preset";
export interface CatalogEntry {
  kind: CatalogEntryKind;
  id: string;
  label: string;
  detail: string;
  searchable: string;
  permission: "available" | "permission_denied" | "conditional";
  definition: CatalogSymbol | ObservationDefinition | CatalogCollection | CatalogCapability | BehaviorFieldMetadata | NamedBehaviorPreset;
}
export interface CompletionItem { label: string; insertText: string; kind: CatalogEntryKind; detail: string; entry: CatalogEntry; }

function scopeAllows(actor: ActorSelection, scope: { kind: string; entityType?: string }, entityType?: string | null): boolean {
  if (scope.kind === "match") return true;
  if (scope.kind === "package_domain") return false;
  if (scope.kind === "package_entity") {
    const typeId = entityType ?? scope.entityType;
    return typeId != null && actor.scope === "hero" && actor.packageEntityType === typeId;
  }
  if (scope.kind === "army") return actor.scope === "army" || actor.scope === "squad" || actor.scope === "hero" || actor.scope === "lane_limited_minion";
  if (scope.kind === "squad") return actor.scope === "squad" || actor.scope === "hero";
  if (scope.kind === "hero") return actor.scope === "hero";
  if (scope.kind === "minion_lane_limited") return actor.scope === "lane_limited_minion" || actor.scope === "army";
  return false;
}

function inaccessible(permission: string, visibility: string): boolean {
  return permission === "internal_denied" || visibility === "internal";
}

function visibleObservation(field: ObservationDefinition, containerVisibility: string | null = null): boolean {
  return !inaccessible(field.readPermission, field.visibility)
    && !inaccessible(field.readPermission, containerVisibility ?? "public");
}

function bound(min: number | null, max: number | null): string {
  return `${min === null ? "−∞" : min}..${max === null ? "∞" : max}`;
}

function typeLabel(valueType: DomainType): string {
  switch (valueType.kind) {
    case "bool": return "bool";
    case "integer": return `integer[${bound(valueType.value.min, valueType.value.max)}]`;
    case "fixed": return `fixed(scale ${valueType.value.scale}, ${bound(valueType.value.min, valueType.value.max)})`;
    case "string": return `string[${valueType.value.max_bytes} bytes]`;
    case "enum": return `enum ${valueType.value.domain}{${valueType.value.values.join(", ")}}`;
    case "entity": return valueType.value.entity_type ?? "entity";
    case "optional": return `optional<${typeLabel(valueType.value)}>`;
    case "list":
    case "vector": return `${valueType.kind}<${typeLabel(valueType.value.element)}, max ${valueType.value.max_items}>`;
    case "matrix": return `matrix<${typeLabel(valueType.value.element)}, ${valueType.value.max_rows}×${valueType.value.max_columns}>`;
    case "record": return `record{${Object.entries(valueType.value.fields).map(([id, type]) => `${id}: ${typeLabel(type)}`).join(", ")}}`;
  }
}

function scopeLabel(scope: { kind: string; entityType?: string }): string {
  return scope.entityType ? `${scope.kind}(${scope.entityType})` : scope.kind;
}

function capabilitySignature(capability: CatalogCapability, catalog: DomainCatalogDocument): string {
  const args = capability.arguments.map((argument) => `${argument.id}${argument.optional ? "?" : ""}: ${typeLabel(argument.value_type)}`).join(", ");
  const cost = catalog.costSchedule.operations[capability.logicalCostReference];
  const costText = cost ? `${cost.base} CU + ${cost.per_item} CU/item` : `CU ${capability.logicalCostReference} (schedule unresolved)`;
  const overrides = capability.behaviorOverrideArguments ? Object.entries(capability.behaviorOverrideArguments)
    .map(([field, index]) => `profile ${field} ← argument ${index}`).join(", ") : "";
  const scope = `scope ${scopeLabel(capability.actorScope)}`;
  const target = capability.targetScope ? `target ${scopeLabel(capability.targetScope)}${capability.targetOwner ? ` / ${capability.targetOwner}` : ""}` : "no target";
  const conditions = capability.preconditions.length ? `${capability.preconditions.length} Catalog precondition(s)` : "no preconditions";
  const phases = capability.activePhases?.length ? `phases ${capability.activePhases.join(", ")}` : "phase unspecified";
  const lifetime = typeof capability.effectLifetime.kind === "string" ? `lifetime ${capability.effectLifetime.kind}` : "lifetime unspecified";
  return `${capability.id}(${args}) · ${scope} · ${target} · ${conditions} · ${phases} · ${lifetime} · ${costText}${overrides ? ` · ${overrides}` : ""}`;
}

/** Produce explorer rows directly from the validated Producer output. */
export function catalogEntries(catalog: DomainCatalogDocument, actor: ActorSelection): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const symbol of catalog.symbols) {
    entries.push({ kind: "constant", id: `${symbol.id.domain}.${symbol.id.symbol}`, label: symbol.displayName,
      detail: `${typeLabel(symbol.valueType)} · ${symbol.namespace}`, searchable: `${symbol.displayName} ${symbol.id.domain} ${symbol.id.symbol}`,
      permission: "available", definition: symbol });
  }
  for (const [id, observation] of Object.entries(catalog.observations)) {
    if (!scopeAllows(actor, observation.scope, observation.entityType)) continue;
    entries.push({ kind: "observation", id, label: id,
      detail: `${typeLabel(observation.valueType)} · ${scopeLabel(observation.scope)} · ${observation.visibility}${observation.containerVisibility ? ` / container ${observation.containerVisibility}` : ""} · ${observation.readPermission} · ${observation.knownness.kind}${observation.unit ? ` · ${observation.unit}` : ""}`,
      searchable: `${id} ${observation.entityType ?? "match"} ${observation.readPermission}`,
      permission: visibleObservation(observation) ? "available" : "permission_denied", definition: observation });
  }
  for (const [id, collection] of Object.entries(catalog.collections)) {
    const collectionScope = { kind: "package_entity", entityType: collection.elementType };
    if (!scopeAllows(actor, collectionScope, collection.elementType)) continue;
    const collectionPermission = collection.visibility === "internal" ? "permission_denied" : "available";
    entries.push({ kind: "collection", id, label: id,
      detail: `${collection.elementType} collection · max ${collection.maxItems} · ${collection.visibility} · order ${collection.deterministicOrderBy.join(", ") || "producer-defined"} · operations ${Object.keys(collection.operations).join(", ") || "none"}`,
      searchable: `${id} ${collection.elementType} collection`, permission: collectionPermission, definition: collection });
    for (const [fieldId, field] of Object.entries(collection.visibleFields)) {
      const binding = collection.elementType;
      const permission = collectionPermission === "permission_denied" || !visibleObservation(field, collection.visibility)
        ? "permission_denied" : "available";
      entries.push({ kind: "collection_field", id: `${id}.${binding}.${fieldId}`, label: `${binding}.${fieldId}`,
        detail: `${typeLabel(field.valueType)} · ${collection.visibility} collection / ${field.visibility} field · ${field.knownness.kind}`,
        searchable: `${id} ${binding}.${fieldId} ${fieldId}`, permission, definition: field });
    }
  }
  for (const [id, capability] of Object.entries(catalog.capabilities)) {
    if (!scopeAllows(actor, capability.actorScope)) continue;
    const signature = capabilitySignature(capability, catalog);
    entries.push({ kind: "capability", id, label: id, detail: signature,
      searchable: `${signature} ${capability.description ?? ""}`,
      permission: "available", definition: capability });
  }
  if (catalog.behaviorProfiles.status === "authored_extension") {
    const profiles = catalog.behaviorProfiles.value?.metadata;
    if (profiles) {
      for (const [fieldId, field] of Object.entries(profiles.fields)) {
        if (!field.scopes.includes(actor.scope)) continue;
        const detail = `${typeLabel(field.valueType)} · scopes ${field.scopes.join(", ")} · aggregation ${field.aggregation ?? "none"} · ${field.overridePolicy.conditionalTickOverride ? "Tick override" : "no Tick override"}`;
        entries.push({ kind: "behavior_profile", id: `behavior.${fieldId}`, label: fieldId, detail,
          searchable: `${fieldId} ${detail} ${field.description}`, permission: "available", definition: field });
      }
      for (const [presetId, preset] of Object.entries(profiles.presets)) {
        if (preset.scope !== actor.scope) continue;
        entries.push({ kind: "behavior_preset", id: `behaviorPreset.${presetId}`, label: preset.name,
          detail: `${preset.scope} preset · ${Object.keys(preset.values).length} typed fields · ${preset.description}`,
          searchable: `${presetId} ${preset.name} ${preset.description}`, permission: "available", definition: preset });
      }
    }
  }
  return entries;
}

export function searchCatalog(catalog: DomainCatalogDocument, actor: ActorSelection, query: string): CatalogEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  const rows = catalogEntries(catalog, actor);
  return needle ? rows.filter((entry) => entry.searchable.toLocaleLowerCase().includes(needle)) : rows;
}

/**
 * The caller supplies a prefix/range from its cursor context. This proposes
 * Catalog-backed names only; source parsing and type validation remain in Jinrei.
 */
export function completeCatalog(
  catalog: DomainCatalogDocument,
  actor: ActorSelection,
  prefix: string,
  target: "jinrei_source" | "behavior_profile" = "jinrei_source",
): CompletionItem[] {
  const needle = prefix.toLocaleLowerCase();
  return catalogEntries(catalog, actor)
    .filter((entry) => entry.permission === "available"
      && (target === "behavior_profile" ? entry.kind === "behavior_profile" || entry.kind === "behavior_preset" : entry.kind !== "behavior_profile" && entry.kind !== "behavior_preset")
      && entry.searchable.toLocaleLowerCase().includes(needle))
    .map((entry) => ({ label: entry.label, insertText: entry.id, kind: entry.kind, detail: entry.detail, entry }));
}

export function hoverCatalog(catalog: DomainCatalogDocument, actor: ActorSelection, identifier: string): CatalogEntry | undefined {
  return catalogEntries(catalog, actor).find((entry) => entry.id === identifier || entry.label === identifier);
}

export type ComparisonSurface = "default" | "effective" | "observed";
export type CoverageStatus = "explicit" | "inherited" | "default" | "blocked_wait" | "not_proven" | "ambiguous_error";
export interface CoverageCell {
  fieldId: string;
  scope: ActorSelection["scope"];
  defaultStatus: "available" | "not_declared";
  senritsuDefaultValue?: DomainValue;
  heroCatalogDefaultValue?: DomainValue;
  effectiveStatus: CoverageStatus;
  observedStatus: "NOT_CHECKED";
  reason: string;
}
export interface CoverageMatrix {
  surface: ComparisonSurface;
  status: "not_proven";
  provenFields: 0;
  assessedFields: number;
  cells: CoverageCell[];
}

export function displayDomainValue(value: DomainValue | undefined): string {
  if (!value) return "—";
  switch (value.kind) {
    case "null": return "null";
    case "bool": return String(value.value);
    case "integer": return String(value.value);
    case "fixed": return `${value.value.coefficient} × 10⁻${value.value.scale}`;
    case "string": return JSON.stringify(value.value);
    case "enum": return value.value;
    case "entity": return `entity ${value.value}`;
    case "list": return `[${value.value.map((item) => displayDomainValue(item)).join(", ")}]`;
    case "record": return `{${Object.entries(value.value).map(([field, item]) => `${field}: ${displayDomainValue(item)}`).join(", ")}}`;
  }
}

/** Static schema availability is not decision coverage or a runtime trace. */
export function behaviorCoverage(catalog: DomainCatalogDocument, actor: ActorSelection, surface: ComparisonSurface): CoverageMatrix {
  const authored = catalog.behaviorProfiles.status === "authored_extension" ? catalog.behaviorProfiles.value?.metadata : undefined;
  const fieldRows = authored ? Object.entries(authored.fields) : [];
  const cells: CoverageCell[] = fieldRows
    .filter(([, field]) => field.scopes.includes(actor.scope))
    .map(([fieldId]) => ({ fieldId, scope: actor.scope,
      defaultStatus: "available" as const,
      senritsuDefaultValue: authored?.senritsuDefault[fieldId],
      heroCatalogDefaultValue: actor.scope === "hero" && actor.heroCatalogId ? authored?.heroDefaults[actor.heroCatalogId]?.[fieldId] : undefined,
      effectiveStatus: "not_proven" as const, observedStatus: "NOT_CHECKED" as const,
      reason: "Effective value is unresolved without runtime profile layers; no static decision proof or Enbu trace is connected." }));
  const assessedFields = cells.length;
  if (cells.length === 0) {
    cells.push({ fieldId: "behaviorProfiles", scope: actor.scope,
      defaultStatus: "not_declared", effectiveStatus: "not_proven", observedStatus: "NOT_CHECKED",
      reason: "No authored Behavior Profile is present in this RulePackage Catalog." });
  }
  return { surface, status: "not_proven", provenFields: 0, assessedFields, cells };
}

export type ObservationDisplay =
  | { status: "NOT_CHECKED" }
  | { status: "PERMISSION_DENIED"; reason: string }
  | { status: "UNKNOWN" }
  | { status: "KNOWN"; value: unknown };
export interface AuthorizedObservationEnvelope {
  stamp: CatalogStamp;
  tick: number;
  side: "attacker" | "defender";
  ownerAuthorized: boolean;
  fields: Record<string, { status: "known"; value: unknown } | { status: "unknown" }>;
}

/** Only an identity-matched, upstream-authorized Enbu snapshot can fill Observed. */
export function observedField(
  catalog: DomainCatalogDocument,
  identifier: string,
  envelope?: AuthorizedObservationEnvelope,
  selectedSide?: "attacker" | "defender",
): ObservationDisplay {
  const field = catalog.observations[identifier];
  if (!field) return { status: "PERMISSION_DENIED", reason: "Field is not declared by this Catalog." };
  if (field.readPermission === "internal_denied" || field.visibility === "internal") {
    return { status: "PERMISSION_DENIED", reason: "This field is not readable by Jinrei or the Editor." };
  }
  if (!envelope) return { status: "NOT_CHECKED" };
  const ownerSensitive = field.readPermission === "owning_side" || field.readPermission === "enemy_visible_only"
    || field.containerVisibility === "owning_side" || field.containerVisibility === "enemy_visible";
  if (ownerSensitive
    && (!selectedSide || selectedSide !== envelope.side || !envelope.ownerAuthorized)) {
    return { status: "PERMISSION_DENIED", reason: "Only an authorized snapshot for the selected side may supply this field." };
  }
  const stamp: CatalogStamp = { identity: catalog.identity, catalogDigest: catalog.catalogDigest, metadataExtensionDigest: catalog.metadataExtensionDigest };
  if (!sameCatalog(envelope.stamp, stamp)) return { status: "PERMISSION_DENIED", reason: "Observation belongs to a stale RulePackage or Catalog." };
  if (envelope.side !== selectedSide) return { status: "PERMISSION_DENIED", reason: "Observation belongs to a different selected side." };
  const sample = envelope.fields[identifier];
  if (!sample) return { status: "NOT_CHECKED" };
  return sample.status === "unknown" ? { status: "UNKNOWN" } : { status: "KNOWN", value: sample.value };
}

export interface CompilerRequest { source: string; stamp: CatalogStamp; revision: number; }
export interface CompilerDiagnostic { severity?: string; code: string; message: string; path?: string | null; }
export type CompilerReply =
  | { status: "compiled"; stamp: CatalogStamp; result: { ast: unknown; program: unknown; estimated_cu: number; diagnostics: CompilerDiagnostic[] } }
  | { status: "rejected"; stamp: CatalogStamp; error: { code: string; message: string; path?: string | null } };
export interface CompilerGateway { compile(request: CompilerRequest): Promise<CompilerReply>; }

/** Adapter for the JSON gateway produced by `senkei-editor-adapter`. */
export function jsonCompilerGateway(transport: (request: string) => Promise<string>): CompilerGateway {
  return {
    async compile(request) {
      let response: unknown;
      try { response = JSON.parse(await transport(JSON.stringify(request))) as unknown; }
      catch { throw new Error("Jinrei compiler adapter returned invalid JSON."); }
      if (!object(response) || response.revision !== request.revision || !object(response.reply)) {
        throw new Error("Jinrei compiler adapter response does not match the draft revision.");
      }
      const candidate = response.reply;
      const stamp = candidate.stamp;
      if ((candidate.status !== "compiled" && candidate.status !== "rejected") || !object(stamp)
        || !object(stamp.identity) || typeof stamp.catalogDigest !== "string" || !/^[0-9a-f]{64}$/.test(stamp.catalogDigest)
        || !(stamp.metadataExtensionDigest === null || (typeof stamp.metadataExtensionDigest === "string" && /^[0-9a-f]{64}$/.test(stamp.metadataExtensionDigest)))
        || !sameCatalog(request.stamp, stamp as unknown as CatalogStamp)) {
        throw new Error("Jinrei compiler adapter response does not match the selected Catalog.");
      }
      if (candidate.status === "compiled" && (!object(candidate.result)
        || !Number.isSafeInteger(candidate.result.estimated_cu) || (candidate.result.estimated_cu as number) < 0
        || !Array.isArray(candidate.result.diagnostics) || !candidate.result.diagnostics.every((item) => object(item)
          && typeof item.code === "string" && typeof item.message === "string"
          && (item.path === undefined || item.path === null || typeof item.path === "string")))) {
        throw new Error("Jinrei compiler adapter returned a malformed compile result.");
      }
      if (candidate.status === "rejected" && (!object(candidate.error)
        || typeof candidate.error.code !== "string" || typeof candidate.error.message !== "string"
        || (candidate.error.path !== undefined && candidate.error.path !== null && typeof candidate.error.path !== "string"))) {
        throw new Error("Jinrei compiler adapter returned malformed diagnostics.");
      }
      return candidate as unknown as CompilerReply;
    },
  };
}

export interface EditorSnapshot {
  catalog: DomainCatalogDocument;
  source: string;
  revision: number;
  selection: ActorSelection;
  lastCompilerReply?: CompilerReply;
}

/** Draft/session state with stale async compile response rejection. */
export class EditorSession {
  private source = "";
  private revision = 0;
  private selection: ActorSelection;
  private latestRequest = 0;
  private reply: CompilerReply | undefined;

  constructor(private catalog: DomainCatalogDocument, initialSelection: ActorSelection) {
    this.selection = initialSelection;
  }

  snapshot(): EditorSnapshot {
    return { catalog: this.catalog, source: this.source, revision: this.revision, selection: this.selection, lastCompilerReply: this.reply };
  }

  setDraft(source: string): void {
    if (source === this.source) return;
    this.source = source;
    this.revision++;
    this.reply = undefined;
  }

  setSelection(selection: ActorSelection): void { this.selection = selection; }

  replaceCatalog(catalog: DomainCatalogDocument): void {
    if (!sameCatalog(stampOf(this.catalog), stampOf(catalog))) {
      this.catalog = catalog;
      this.revision++;
      this.reply = undefined;
    }
  }

  async compile(gateway: CompilerGateway): Promise<CompilerReply | undefined> {
    const requestId = ++this.latestRequest;
    const snapshot = this.snapshot();
    const reply = await gateway.compile({ source: snapshot.source, stamp: stampOf(snapshot.catalog), revision: snapshot.revision });
    if (requestId !== this.latestRequest || snapshot.revision !== this.revision || !sameCatalog(stampOf(this.catalog), reply.stamp)) return undefined;
    this.reply = reply;
    return reply;
  }
}

function stampOf(catalog: DomainCatalogDocument): CatalogStamp {
  return { identity: catalog.identity, catalogDigest: catalog.catalogDigest, metadataExtensionDigest: catalog.metadataExtensionDigest };
}
