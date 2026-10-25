/** The editor's typed adapter for the serialized Senritsu DomainCatalog. */

export interface Version { major: number; minor: number; patch: number; }
export interface CatalogIdentity {
  schemaVersion: Version;
  rulesetId: string;
  rulesetVersion: Version;
  rulesetDigest: string;
  minimumEngineVersion: Version;
  modelVersion: Version;
  primitiveSetId: string;
  primitiveSetVersion: Version;
  jinreiLanguageVersion: Version;
  structuredAstVersion: Version;
  typedIrVersion: Version;
  bytecodeVersion: Version;
  [key: string]: unknown;
}
export interface CatalogStamp {
  identity: CatalogIdentity;
  catalogDigest: string;
  metadataExtensionDigest: string | null;
}
export interface JsonObject { [key: string]: unknown; }
export type DomainType =
  | { kind: "bool" }
  | { kind: "integer"; value: { min: number | null; max: number | null } }
  | { kind: "fixed"; value: { scale: number; min: number | null; max: number | null } }
  | { kind: "string"; value: { max_bytes: number } }
  | { kind: "enum"; value: { domain: string; values: string[] } }
  | { kind: "entity"; value: { entity_type: string | null } }
  | { kind: "optional"; value: DomainType }
  | { kind: "list" | "vector"; value: { element: DomainType; max_items: number } }
  | { kind: "matrix"; value: { element: DomainType; max_rows: number; max_columns: number } }
  | { kind: "record"; value: { fields: Record<string, DomainType> } };
export type DomainValue =
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "integer"; value: number }
  | { kind: "fixed"; value: { coefficient: number; scale: number } }
  | { kind: "string" | "enum" | "entity"; value: string }
  | { kind: "list"; value: DomainValue[] }
  | { kind: "record"; value: Record<string, DomainValue> };
export type BehaviorScope = "army" | "squad" | "hero" | "lane_limited_minion";
export type ProfileLayer = "senritsu_default" | "hero_catalog_default" | "army_preference" | "squad_aggregate" | "jinrei_conditional_preference";
export interface BehaviorFieldMetadata {
  valueType: DomainType;
  scopes: BehaviorScope[];
  aggregation: "require_agreement" | "minimum" | "maximum" | "checked_sum" | "first_by_stable_subject_id" | null;
  overridePolicy: { conditionalTickOverride: boolean; persistentCapability: string | null };
  description: string;
  unit: string | null;
}
export interface NamedBehaviorPreset { name: string; scope: BehaviorScope; values: Record<string, DomainValue>; description: string; }
export interface BehaviorProfileMetadata {
  inheritanceOrder: ProfileLayer[];
  fields: Record<string, BehaviorFieldMetadata>;
  senritsuDefault: Record<string, DomainValue>;
  heroDefaults: Record<string, Record<string, DomainValue>>;
  presets: Record<string, NamedBehaviorPreset>;
}
export interface ObservationDefinition extends JsonObject {
  id: string;
  scope: { kind: string; entityType?: string };
  entityType: string | null;
  valueType: DomainType;
  visibility: string;
  containerVisibility: string | null;
  readPermission: string;
  knownness: { kind: string };
  allowedOperators: string[];
  unit: string | null;
  source: JsonObject;
}
export interface CatalogSymbol extends JsonObject {
  id: { domain: string; symbol: string };
  displayName: string;
  namespace: string;
  category: string;
  valueType: DomainType;
  finiteDomain: string[];
  allowedOperators: string[];
}
export interface CatalogCollection extends JsonObject {
  id: string;
  elementType: string;
  maxItems: number;
  visibility: string;
  visibleFields: Record<string, ObservationDefinition>;
  deterministicOrderBy: string[];
  operations: JsonObject;
}
export interface CatalogCapability extends JsonObject {
  id: string;
  description: string | null;
  actorScope: { kind: string; entityType?: string };
  version: Version | null;
  arguments: Array<{ id: string; value_type: DomainType; optional: boolean }>;
  targetScope: { kind: string; entityType?: string } | null;
  preconditions: unknown[];
  effectLifetime: JsonObject;
  rejectionCodes: unknown;
  logicalCostReference: string;
  behaviorOverrideArguments?: Record<string, number>;
  activePhases?: string[];
  targetTypes?: string[];
  targetOwner?: string;
}
export interface LogicalCuCost { base: number; per_item: number; }
export interface CatalogCostSchedule extends JsonObject {
  id: string;
  version: Version;
  operations: Record<string, LogicalCuCost>;
  perTickBudget: number;
  perMatchBudget: number;
}
export type CatalogBehaviorProfiles =
  | { status: "not_declared_by_rule_package" }
  | { status: "authored_extension"; value: { digest: string; metadata: BehaviorProfileMetadata } };
export interface DomainCatalogDocument extends JsonObject {
  identity: CatalogIdentity;
  catalogDigest: string;
  metadataExtensionDigest: string | null;
  symbols: CatalogSymbol[];
  observations: Record<string, ObservationDefinition>;
  collections: Record<string, CatalogCollection>;
  capabilities: Record<string, CatalogCapability>;
  entityTypes: Record<string, JsonObject>;
  costSchedule: CatalogCostSchedule;
  ordering: JsonObject;
  entityScopes: JsonObject;
  capabilityMetadata: JsonObject;
  behaviorProfiles: CatalogBehaviorProfiles;
}

export type CatalogLoadErrorCode = "invalid_json" | "unsupported_schema" | "invalid_shape" | "digest_mismatch" | "package_mismatch";
export class CatalogLoadError extends Error {
  constructor(readonly code: CatalogLoadErrorCode, message: string) { super(message); this.name = "CatalogLoadError"; }
}

function object(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function string(value: unknown): value is string { return typeof value === "string"; }
function validVersion(value: unknown): value is Version {
  return object(value) && Number.isInteger(value.major) && Number.isInteger(value.minor) && Number.isInteger(value.patch)
    && (value.major as number) >= 0 && (value.minor as number) >= 0 && (value.patch as number) >= 0;
}
function validDigest(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function isVisibility(value: unknown): value is string { return ["public", "owning_side", "enemy_visible", "internal"].includes(String(value)); }

const DOMAIN_TYPE_TAGS = new Set(["bool", "integer", "fixed", "string", "enum", "entity", "optional", "list", "vector", "matrix", "record"]);
function isDomainType(value: unknown, depth = 0): value is DomainType {
  if (!object(value) || typeof value.kind !== "string" || !DOMAIN_TYPE_TAGS.has(value.kind) || depth > 64) return false;
  if (value.kind === "bool") return true;
  if (!object(value.value)) return false;
  if (value.kind === "optional") return isDomainType(value.value, depth + 1);
  if (value.kind === "record") return object(value.value.fields) && Object.values(value.value.fields).every((item) => isDomainType(item, depth + 1));
  if (value.kind === "list" || value.kind === "vector") return isDomainType(value.value.element, depth + 1) && Number.isSafeInteger(value.value.max_items) && (value.value.max_items as number) > 0;
  if (value.kind === "matrix") return isDomainType(value.value.element, depth + 1)
    && Number.isSafeInteger(value.value.max_rows) && (value.value.max_rows as number) > 0
    && Number.isSafeInteger(value.value.max_columns) && (value.value.max_columns as number) > 0;
  if (value.kind === "enum") return string(value.value.domain) && Array.isArray(value.value.values) && value.value.values.every(string);
  if (value.kind === "entity") return value.value.entity_type === null || string(value.value.entity_type);
  if (value.kind === "string") return Number.isSafeInteger(value.value.max_bytes) && (value.value.max_bytes as number) >= 0;
  if (value.kind === "integer") return (value.value.min === null || Number.isSafeInteger(value.value.min)) && (value.value.max === null || Number.isSafeInteger(value.value.max));
  return value.kind === "fixed" && Number.isInteger(value.value.scale) && (value.value.scale as number) >= 0 && (value.value.scale as number) <= 255
    && (value.value.min === null || Number.isSafeInteger(value.value.min))
    && (value.value.max === null || Number.isSafeInteger(value.value.max));
}

function isDomainValue(value: unknown, depth = 0): value is DomainValue {
  if (!object(value) || typeof value.kind !== "string" || depth > 64) return false;
  if (value.kind === "null") return true;
  if (value.kind === "bool") return typeof value.value === "boolean";
  if (value.kind === "integer") return Number.isSafeInteger(value.value);
  if (value.kind === "fixed") return object(value.value) && Number.isSafeInteger(value.value.coefficient)
    && Number.isInteger(value.value.scale) && (value.value.scale as number) >= 0 && (value.value.scale as number) <= 255;
  if (value.kind === "string" || value.kind === "enum" || value.kind === "entity") return string(value.value);
  if (value.kind === "list") return Array.isArray(value.value) && value.value.every((item) => isDomainValue(item, depth + 1));
  if (value.kind === "record") return object(value.value) && Object.values(value.value).every((item) => isDomainValue(item, depth + 1));
  return false;
}

function domainValueMatches(value: DomainValue, type: DomainType, depth = 0): boolean {
  if (depth > 64) return false;
  switch (type.kind) {
    case "bool": return value.kind === "bool";
    case "integer": return value.kind === "integer"
      && (type.value.min === null || value.value >= type.value.min)
      && (type.value.max === null || value.value <= type.value.max);
    case "fixed": return value.kind === "fixed" && value.value.scale === type.value.scale
      && (type.value.min === null || value.value.coefficient >= type.value.min)
      && (type.value.max === null || value.value.coefficient <= type.value.max);
    case "string": return value.kind === "string" && new TextEncoder().encode(value.value).length <= type.value.max_bytes;
    case "enum": return value.kind === "enum" && type.value.values.includes(value.value);
    case "entity": return value.kind === "entity";
    case "optional": return value.kind === "null" || domainValueMatches(value, type.value, depth + 1);
    case "list":
    case "vector": return value.kind === "list" && value.value.length <= type.value.max_items
      && value.value.every((item) => domainValueMatches(item, type.value.element, depth + 1));
    case "matrix": return value.kind === "list" && value.value.length <= type.value.max_rows
      && value.value.every((row) => row.kind === "list" && row.value.length <= type.value.max_columns
        && row.value.every((item) => domainValueMatches(item, type.value.element, depth + 2)));
    case "record": return value.kind === "record" && Object.keys(value.value).length === Object.keys(type.value.fields).length
      && Object.entries(type.value.fields).every(([field, fieldType]) => {
        const fieldValue = value.value[field];
        return fieldValue !== undefined && domainValueMatches(fieldValue, fieldType, depth + 1);
      });
  }
}

function isBehaviorProfileMetadata(value: unknown): value is BehaviorProfileMetadata {
  if (!object(value) || !Array.isArray(value.inheritanceOrder) || !object(value.fields)
    || !object(value.senritsuDefault) || !object(value.heroDefaults) || !object(value.presets)) return false;
  const layers = new Set(["senritsu_default", "hero_catalog_default", "army_preference", "squad_aggregate", "jinrei_conditional_preference"]);
  if (!value.inheritanceOrder.every((layer) => typeof layer === "string" && layers.has(layer))) return false;
  const scopes = new Set(["army", "squad", "hero", "lane_limited_minion"]);
  const fields = value.fields;
  const layerValues = value.inheritanceOrder as unknown[];
  if (layerValues.length === 0 || layerValues[0] !== "senritsu_default" || new Set(layerValues).size !== layerValues.length) return false;
  for (const field of Object.values(value.fields)) {
    if (!object(field) || !isDomainType(field.valueType) || !Array.isArray(field.scopes) || field.scopes.length === 0
      || !field.scopes.every((scope) => typeof scope === "string" && scopes.has(scope))
      || !(field.aggregation === null || ["require_agreement", "minimum", "maximum", "checked_sum", "first_by_stable_subject_id"].includes(String(field.aggregation)))
      || !object(field.overridePolicy) || typeof field.overridePolicy.conditionalTickOverride !== "boolean"
      || !(field.overridePolicy.persistentCapability === null || string(field.overridePolicy.persistentCapability))
      || (!field.overridePolicy.conditionalTickOverride && field.overridePolicy.persistentCapability === null)
      || !string(field.description) || field.description.trim().length === 0 || !(field.unit === null || string(field.unit))) return false;
  }
  const validValues = (record: JsonObject) => Object.entries(record).every(([id, item]) => {
    const field = fields[id];
    return object(field) && isDomainType(field.valueType) && isDomainValue(item) && domainValueMatches(item, field.valueType);
  });
  if (Object.keys(value.senritsuDefault).length !== Object.keys(value.fields).length || !validValues(value.senritsuDefault)) return false;
  for (const values of Object.values(value.heroDefaults)) if (!object(values) || !validValues(values)
    || Object.keys(values).some((id) => !(fields[id] as BehaviorFieldMetadata).scopes.includes("hero"))) return false;
  for (const preset of Object.values(value.presets)) {
    if (!object(preset) || !string(preset.name) || !string(preset.description)
      || typeof preset.scope !== "string" || !scopes.has(preset.scope)
      || !object(preset.values) || Object.keys(preset.values).length === 0 || !validValues(preset.values)
      || Object.keys(preset.values).some((id) => !(fields[id] as BehaviorFieldMetadata).scopes.includes(preset.scope as BehaviorScope))) return false;
  }
  return true;
}

function assertCatalogShape(value: unknown): asserts value is DomainCatalogDocument {
  if (!object(value) || !object(value.identity) || !validVersion(value.identity.schemaVersion)
    || !string(value.identity.rulesetId) || !validVersion(value.identity.rulesetVersion)
    || !validDigest(value.identity.rulesetDigest) || !validVersion(value.identity.minimumEngineVersion)
    || !validVersion(value.identity.modelVersion) || !string(value.identity.primitiveSetId)
    || !validVersion(value.identity.primitiveSetVersion) || !validVersion(value.identity.jinreiLanguageVersion)
    || !validVersion(value.identity.structuredAstVersion) || !validVersion(value.identity.typedIrVersion)
    || !validVersion(value.identity.bytecodeVersion) || !validDigest(value.catalogDigest)
    || !(value.metadataExtensionDigest === null || validDigest(value.metadataExtensionDigest))
    || !Array.isArray(value.symbols) || !object(value.observations) || !object(value.collections)
    || !object(value.capabilities) || !object(value.entityTypes) || !object(value.costSchedule)
    || !object(value.ordering) || !object(value.entityScopes) || !object(value.capabilityMetadata)
    || !object(value.behaviorProfiles)) {
    throw new CatalogLoadError("invalid_shape", "Catalog does not match the serialized DomainCatalog contract.");
  }
  const profiles = value.behaviorProfiles as CatalogBehaviorProfiles;
  if (profiles.status !== "not_declared_by_rule_package" && profiles.status !== "authored_extension") {
    throw new CatalogLoadError("invalid_shape", "Catalog Behavior Profile metadata status is invalid.");
  }
  if (profiles.status === "authored_extension" && (!object(profiles.value) || !validDigest(profiles.value.digest) || !isBehaviorProfileMetadata(profiles.value.metadata))) {
    throw new CatalogLoadError("invalid_shape", "Authored Behavior Profile extension is malformed.");
  }
  if (!string(value.costSchedule.id) || !validVersion(value.costSchedule.version)
    || !object(value.costSchedule.operations) || !Number.isSafeInteger(value.costSchedule.perTickBudget)
    || !Number.isSafeInteger(value.costSchedule.perMatchBudget)) {
    throw new CatalogLoadError("invalid_shape", "Catalog CU schedule is malformed.");
  }
  for (const [operation, cost] of Object.entries(value.costSchedule.operations)) {
    if (!object(cost) || !Number.isSafeInteger(cost.base) || !Number.isSafeInteger(cost.per_item)) {
      throw new CatalogLoadError("invalid_shape", `CU operation '${operation}' is malformed.`);
    }
  }
  for (const [index, symbol] of value.symbols.entries()) {
    if (!object(symbol) || !object(symbol.id) || !string(symbol.id.domain) || !string(symbol.id.symbol)
      || !string(symbol.displayName) || !isDomainType(symbol.valueType) || !Array.isArray(symbol.finiteDomain)
      || !symbol.finiteDomain.every(string) || !Array.isArray(symbol.allowedOperators)) {
      throw new CatalogLoadError("invalid_shape", `Catalog symbol at index ${index} is malformed.`);
    }
  }
  for (const [id, collection] of Object.entries(value.collections)) {
    if (!object(collection) || collection.id !== id || !string(collection.elementType)
      || !Number.isSafeInteger(collection.maxItems) || !isVisibility(collection.visibility)
      || !object(collection.visibleFields) || !Array.isArray(collection.deterministicOrderBy)
      || !object(collection.operations)) {
      throw new CatalogLoadError("invalid_shape", `Collection '${id}' is malformed.`);
    }
  }
  for (const [id, field] of Object.entries(value.observations)) {
    if (!object(field) || field.id !== id || !object(field.scope) || !isDomainType(field.valueType)
      || !isVisibility(field.visibility) || !(field.containerVisibility === null || isVisibility(field.containerVisibility))
      || !["public", "owning_side", "enemy_visible_only", "internal_denied", "parent_collection"].includes(String(field.readPermission))
      || !object(field.knownness) || !Array.isArray(field.allowedOperators)) {
      throw new CatalogLoadError("invalid_shape", `Observation '${id}' is malformed.`);
    }
  }
  for (const [id, capability] of Object.entries(value.capabilities)) {
    if (!object(capability) || capability.id !== id || !object(capability.actorScope)
      || !Array.isArray(capability.arguments) || !object(capability.effectLifetime)
      || !string(capability.logicalCostReference) || !capability.arguments.every((argument) => object(argument)
        && string(argument.id) && isDomainType(argument.value_type) && typeof argument.optional === "boolean")) {
      throw new CatalogLoadError("invalid_shape", `Capability '${id}' is malformed.`);
    }
    if (capability.behaviorOverrideArguments !== undefined
      && (!object(capability.behaviorOverrideArguments) || Object.values(capability.behaviorOverrideArguments).some((index) => !Number.isInteger(index) || (index as number) < 0))) {
      throw new CatalogLoadError("invalid_shape", `Capability '${id}' has malformed profile argument metadata.`);
    }
    if (capability.behaviorOverrideArguments !== undefined) {
      if (profiles.status !== "authored_extension") {
        throw new CatalogLoadError("invalid_shape", `Capability '${id}' references a profile field that is not declared by this Catalog.`);
      }
      const mappings = capability.behaviorOverrideArguments as Record<string, number>;
      for (const [fieldId, argumentIndex] of Object.entries(mappings)) {
        const field = profiles.value.metadata.fields[fieldId];
        const argument = capability.arguments[argumentIndex];
        if (!field || !argument || stableJson(field.valueType) !== stableJson(argument.value_type)) {
          throw new CatalogLoadError("invalid_shape", `Capability '${id}' profile field '${fieldId}' does not match its argument signature.`);
        }
      }
    }
  }
}

/**
 * Rebuild the exact digest material from raw JSON value spans. The Producer's
 * private Rust material struct serializes its root keys in snake_case and its
 * declaration order, while the public Catalog uses camelCase. Copying value
 * bytes preserves BTreeMap ordering, integer-like keys and serde UTF-8 output.
 */
export function digestMaterialJson(canonicalJson: string): string {
  const fail = () => { throw new CatalogLoadError("invalid_json", "Catalog JSON is not a canonical root object."); };
  let cursor = 0;
  const skipSpace = () => { while (/\s/.test(canonicalJson[cursor] ?? "")) cursor++; };
  const scanString = (start: number): number => {
    if (canonicalJson[start] !== '"') fail();
    let escaped = false;
    for (let i = start + 1; i < canonicalJson.length; i++) {
      const ch = canonicalJson[i]!;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') return i + 1;
    }
    return fail();
  };
  const scanValue = (start: number): number => {
    if (canonicalJson[start] === '"') return scanString(start);
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let i = start; i < canonicalJson.length; i++) {
      const ch = canonicalJson[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") {
        const opener = stack.pop();
        if ((ch === "}" && opener !== "{") || (ch === "]" && opener !== "[")) fail();
        if (stack.length === 0) return i + 1;
      } else if (ch === "," && stack.length === 0) return i;
    }
    return canonicalJson.length;
  };

  skipSpace();
  if (canonicalJson[cursor] !== "{") return fail();
  cursor++;
  const rootValues = new Map<string, string>();
  while (cursor < canonicalJson.length) {
    skipSpace();
    if (canonicalJson[cursor] === "}") { cursor++; break; }
    const keyStart = cursor;
    const keyEnd = scanString(keyStart);
    let key: unknown;
    try { key = JSON.parse(canonicalJson.slice(keyStart, keyEnd)) as unknown; } catch { return fail(); }
    cursor = keyEnd;
    skipSpace();
    if (canonicalJson[cursor] !== ":") return fail();
    cursor++;
    skipSpace();
    const valueStart = cursor;
    const valueEnd = scanValue(valueStart);
    cursor = valueEnd;
    skipSpace();
    const delimiter = canonicalJson[cursor];
    if (typeof key !== "string" || rootValues.has(key)) return fail();
    rootValues.set(key, canonicalJson.slice(valueStart, valueEnd));
    if (delimiter === ",") { cursor++; continue; }
    if (delimiter === "}") { cursor++; break; }
    return fail();
  }
  skipSpace();
  if (cursor !== canonicalJson.length) return fail();
  const digestFields: ReadonlyArray<readonly [string, string]> = [
    ["identity", "identity"],
    ["metadataExtensionDigest", "metadata_extension_digest"],
    ["symbols", "symbols"],
    ["observations", "observations"],
    ["collections", "collections"],
    ["capabilities", "capabilities"],
    ["entityTypes", "entity_types"],
    ["costSchedule", "cost_schedule"],
    ["ordering", "ordering"],
    ["entityScopes", "entity_scopes"],
    ["capabilityMetadata", "capability_metadata"],
    ["behaviorProfiles", "behavior_profiles"],
  ];
  const allowedRootFields = new Set([...digestFields.map(([wire]) => wire), "catalogDigest"]);
  for (const key of rootValues.keys()) if (!allowedRootFields.has(key)) return fail();
  const serialized = digestFields.map(([wire, rust]) => {
    const rawValue = rootValues.get(wire);
    if (rawValue === undefined) return fail();
    return `${JSON.stringify(rust)}:${rawValue}`;
  });
  const digest = rootValues.get("catalogDigest");
  if (digest === undefined || !validDigest(JSON.parse(digest))) return fail();
  return `{${serialized.join(",")}}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export async function loadDomainCatalog(
  canonicalJson: string,
  expected?: { rulesetId: string; rulesetVersion: Version; rulesetDigest: string },
): Promise<DomainCatalogDocument> {
  let parsed: unknown;
  try { parsed = JSON.parse(canonicalJson) as unknown; }
  catch { throw new CatalogLoadError("invalid_json", "Catalog JSON could not be parsed."); }
  assertCatalogShape(parsed);
  if (parsed.identity.schemaVersion.major !== 1) throw new CatalogLoadError("unsupported_schema", "This Editor supports Domain Catalog schema major version 1.");
  if (expected && (parsed.identity.rulesetId !== expected.rulesetId
    || !sameVersion(parsed.identity.rulesetVersion, expected.rulesetVersion)
    || parsed.identity.rulesetDigest !== expected.rulesetDigest)) {
    throw new CatalogLoadError("package_mismatch", "Catalog RulePackage identity does not match the selected package.");
  }
  const material = digestMaterialJson(canonicalJson);
  const actual = await sha256Hex(new TextEncoder().encode(material));
  if (actual !== parsed.catalogDigest) throw new CatalogLoadError("digest_mismatch", "Catalog canonical digest does not match its content.");
  return parsed;
}

export function sameVersion(left: Version, right: Version): boolean {
  return left.major === right.major && left.minor === right.minor && left.patch === right.patch;
}

export function catalogStamp(catalog: DomainCatalogDocument): CatalogStamp {
  return { identity: catalog.identity, catalogDigest: catalog.catalogDigest, metadataExtensionDigest: catalog.metadataExtensionDigest };
}

export function sameCatalog(left: CatalogStamp, right: CatalogStamp): boolean {
  return left.catalogDigest === right.catalogDigest && left.metadataExtensionDigest === right.metadataExtensionDigest
    && stableJson(left.identity) === stableJson(right.identity);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
