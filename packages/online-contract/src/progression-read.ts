import type { OfficialPolicyRef } from "../../../apps/web/src/features/progression/official-service";
import { canonicalJson, sha256Hex } from "../../../apps/web/src/worker/input-identity";
import type { AuthenticationPort, Principal } from "./index";
import type { EconomicOrderEvidence } from "./economy";

/** Amounts are exact provider text interpreted only through this approved format. */
export interface ReadAmount { readonly value: string; readonly format: OfficialPolicyRef }
export interface ReadCounterparty { readonly kind: "player" | "market_maker"; readonly id: string }
export type OptionalReadAmount = { readonly kind: "provided"; readonly amount: ReadAmount } | { readonly kind: "not_provided" };
export type ReadExpiration = { readonly kind: "at"; readonly value: string } | { readonly kind: "not_provided" };
export type OfficialReadQuery =
  | { readonly kind: "post_match"; readonly matchId: string }
  | { readonly kind: "entitlements" }
  | { readonly kind: "draw_pool"; readonly poolId: string }
  | { readonly kind: "inventory" | "market_search" | "orders"; readonly filter: string }
  | { readonly kind: "balance" }
  | { readonly kind: "quote"; readonly quoteId: string }
  | { readonly kind: "libra_statistics" };
export interface OfficialReadRequest {
  readonly queryId: string;
  readonly playerId: string;
  readonly authorityId: string;
  readonly policy: OfficialPolicyRef;
  readonly query: OfficialReadQuery;
}
export type OfficialReadPayload =
  | { readonly kind: "post_match"; readonly matchId: string; readonly resultId: string; readonly acquisitionIds: readonly string[]; readonly relationshipUpdateIds: readonly string[]; readonly pendingIds: readonly string[] }
  | { readonly kind: "entitlements"; readonly items: readonly { readonly entitlementId: string; readonly poolId: string }[] }
  | { readonly kind: "draw_pool"; readonly poolId: string; readonly items: readonly { readonly itemId: string; readonly probability: OptionalReadAmount }[]; readonly guarantee: string | null }
  | { readonly kind: "inventory"; readonly total: ReadAmount; readonly available: ReadAmount; readonly hasUnfilteredResults: boolean; readonly items: readonly { readonly instanceId: string; readonly definition: OfficialPolicyRef; readonly available: boolean; readonly equipped: boolean; readonly tradeRestricted: boolean }[] }
  | { readonly kind: "balance"; readonly total: ReadAmount; readonly available: ReadAmount }
  | { readonly kind: "market_search"; readonly hasUnfilteredResults: boolean; readonly items: readonly { readonly offerId: string; readonly itemId: string; readonly counterparty: ReadCounterparty; readonly price: ReadAmount }[] }
  | { readonly kind: "quote"; readonly quoteId: string; readonly itemId: string; readonly counterparty: ReadCounterparty; readonly price: ReadAmount; readonly fees: OptionalReadAmount; readonly total: ReadAmount; readonly expiration: ReadExpiration }
  | { readonly kind: "orders"; readonly hasUnfilteredResults: boolean; readonly items: readonly { readonly orderId: string; readonly itemId: string; readonly counterparty: ReadCounterparty; readonly state: EconomicOrderEvidence["state"]; readonly settlementIds: EconomicOrderEvidence["settlementIds"] }[] }
  | { readonly kind: "libra_statistics"; readonly cumulativeIssued: ReadAmount; readonly scope: OfficialPolicyRef; readonly asOf: string };
export interface OfficialReadEvidence {
  readonly schema: OfficialPolicyRef;
  readonly requestDigest: string;
  readonly evidence: string;
  readonly payload: OfficialReadPayload;
}
export interface OfficialReadProvider {
  /** Read only data authorized for this principal; no operation is committed here. */
  read(principal: Principal, request: OfficialReadRequest): Promise<OfficialReadEvidence>;
}
export interface OfficialReadVerifier {
  /** Authenticate every claim, the full query and policy, and the authority's evidence. */
  verify(request: OfficialReadRequest, evidence: OfficialReadEvidence): Promise<OfficialReadEvidence>;
}
export interface ConfiguredOfficialRead<Credentials> {
  readonly kind: "configured";
  readonly authorityId: string;
  readonly authentication: AuthenticationPort<Credentials>;
  readonly provider: OfficialReadProvider;
  readonly verifier: OfficialReadVerifier;
}
export type OfficialReadConfiguration<Credentials> = { readonly kind: "not-configured" } | ConfiguredOfficialRead<Credentials>;
export type OfficialReadResult =
  | { readonly kind: "unavailable" | "denied" | "failed" }
  | { readonly kind: "ready" | "empty" | "filtered-empty"; readonly payload: OfficialReadPayload };

/** Providers/authenticators can explicitly distinguish denial or disconnection from failure. */
export class OfficialReadError extends Error {
  constructor(readonly kind: "unavailable" | "denied", message: string) { super(message); }
}
function id(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.trim() === value; }
function shape(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== names.length || !names.every(key => Object.hasOwn(value, key))) throw new Error("Invalid official read shape");
}
function ref(value: unknown): void {
  shape(value, ["id", "version", "digest"]);
  if (![value.id, value.version, value.digest].every(id)) throw new Error("Invalid versioned reference");
}
function amount(value: unknown): void {
  shape(value, ["value", "format"]);
  if (!id(value.value)) throw new Error("Invalid provided amount");
  ref(value.format);
}
function optionalAmount(value: unknown): void {
  shape(value, (value as { kind?: unknown })?.kind === "provided" ? ["kind", "amount"] : ["kind"]);
  if (value.kind === "provided") amount(value.amount);
  else if (value.kind !== "not_provided") throw new Error("Invalid optional amount");
}
function expiration(value: unknown): void {
  shape(value, (value as { kind?: unknown })?.kind === "at" ? ["kind", "value"] : ["kind"]);
  if (value.kind === "at") { if (!id(value.value)) throw new Error("Invalid quote expiration"); }
  else if (value.kind !== "not_provided") throw new Error("Invalid quote expiration");
}
function counterparty(value: unknown): void {
  shape(value, ["kind", "id"]);
  if ((value.kind !== "player" && value.kind !== "market_maker") || !id(value.id)) throw new Error("Invalid counterparty");
}
function ids(value: unknown): void {
  if (!Array.isArray(value) || !value.every(id) || new Set(value).size !== value.length) throw new Error("Invalid identities");
}
function copy<T>(input: T): T {
  const cloned = structuredClone(input);
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
  };
  freeze(cloned);
  return cloned;
}
function requireRequest(request: OfficialReadRequest): void {
  shape(request, ["queryId", "playerId", "authorityId", "policy", "query"]);
  if (![request.queryId, request.playerId, request.authorityId].every(id) || request.authorityId.toLowerCase() === "local") throw new Error("Invalid official read identity");
  ref(request.policy);
  const query = request.query;
  if (!query || typeof query !== "object") throw new Error("Invalid official read query");
  switch (query.kind) {
    case "post_match": shape(query, ["kind", "matchId"]); if (!id(query.matchId)) throw new Error("Invalid Match identity"); break;
    case "draw_pool": shape(query, ["kind", "poolId"]); if (!id(query.poolId)) throw new Error("Invalid pool identity"); break;
    case "quote": shape(query, ["kind", "quoteId"]); if (!id(query.quoteId)) throw new Error("Invalid quote identity"); break;
    case "inventory": case "market_search": case "orders":
      shape(query, ["kind", "filter"]); if (typeof query.filter !== "string") throw new Error("Invalid filter"); break;
    case "entitlements": case "balance": case "libra_statistics": shape(query, ["kind"]); break;
    default: throw new Error("Unsupported official read query");
  }
}
function items(value: unknown): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid official read collection");
}
function unique(values: readonly unknown[], field: string): void {
  const identities = values.map(value => (value as Record<string, unknown>)[field]);
  if (new Set(identities).size !== identities.length) throw new Error("Duplicate official read identity");
}
function collectionState(filter: string, hasUnfilteredResults: unknown, values: readonly unknown[]): "ready" | "empty" | "filtered-empty" {
  if (typeof hasUnfilteredResults !== "boolean" || (values.length > 0 && !hasUnfilteredResults) || (filter.length === 0 && values.length === 0 && hasUnfilteredResults)) throw new Error("Inconsistent collection evidence");
  if (values.length > 0) return "ready";
  return hasUnfilteredResults ? "filtered-empty" : "empty";
}
function requirePayload(request: OfficialReadRequest, payload: OfficialReadPayload): "ready" | "empty" | "filtered-empty" {
  if (!payload || typeof payload !== "object" || payload.kind !== request.query.kind) throw new Error("Official read query mismatch");
  const query = request.query;
  switch (payload.kind) {
    case "post_match":
      shape(payload, ["kind", "matchId", "resultId", "acquisitionIds", "relationshipUpdateIds", "pendingIds"]);
      if (query.kind !== "post_match" || payload.matchId !== query.matchId || !id(payload.resultId)) throw new Error("Official Match read mismatch");
      ids(payload.acquisitionIds); ids(payload.relationshipUpdateIds); ids(payload.pendingIds); return "ready";
    case "entitlements":
      shape(payload, ["kind", "items"]); items(payload.items);
      for (const item of payload.items) { shape(item, ["entitlementId", "poolId"]); if (!id(item.entitlementId) || !id(item.poolId)) throw new Error("Invalid entitlement"); }
      unique(payload.items, "entitlementId");
      return payload.items.length ? "ready" : "empty";
    case "draw_pool":
      shape(payload, ["kind", "poolId", "items", "guarantee"]);
      if (query.kind !== "draw_pool" || payload.poolId !== query.poolId || (payload.guarantee !== null && !id(payload.guarantee))) throw new Error("Official pool read mismatch");
      items(payload.items); for (const item of payload.items) { shape(item, ["itemId", "probability"]); if (!id(item.itemId)) throw new Error("Invalid pool item"); optionalAmount(item.probability); }
      unique(payload.items, "itemId");
      return payload.items.length ? "ready" : "empty";
    case "inventory":
      shape(payload, ["kind", "total", "available", "hasUnfilteredResults", "items"]); amount(payload.total); amount(payload.available); items(payload.items);
      for (const item of payload.items) { shape(item, ["instanceId", "definition", "available", "equipped", "tradeRestricted"]); if (!id(item.instanceId) || typeof item.available !== "boolean" || typeof item.equipped !== "boolean" || typeof item.tradeRestricted !== "boolean") throw new Error("Invalid owned equipment"); ref(item.definition); }
      unique(payload.items, "instanceId");
      if (query.kind !== "inventory") throw new Error("Invalid inventory query"); return collectionState(query.filter, payload.hasUnfilteredResults, payload.items);
    case "balance": shape(payload, ["kind", "total", "available"]); amount(payload.total); amount(payload.available); return "ready";
    case "market_search":
      shape(payload, ["kind", "hasUnfilteredResults", "items"]); items(payload.items);
      for (const item of payload.items) { shape(item, ["offerId", "itemId", "counterparty", "price"]); if (!id(item.offerId) || !id(item.itemId)) throw new Error("Invalid market offer"); counterparty(item.counterparty); amount(item.price); }
      unique(payload.items, "offerId");
      if (query.kind !== "market_search") throw new Error("Invalid market query"); return collectionState(query.filter, payload.hasUnfilteredResults, payload.items);
    case "quote":
      shape(payload, ["kind", "quoteId", "itemId", "counterparty", "price", "fees", "total", "expiration"]);
      if (query.kind !== "quote" || payload.quoteId !== query.quoteId || !id(payload.itemId)) throw new Error("Official quote read mismatch");
      counterparty(payload.counterparty); amount(payload.price); optionalAmount(payload.fees); amount(payload.total); expiration(payload.expiration); return "ready";
    case "orders":
      shape(payload, ["kind", "hasUnfilteredResults", "items"]); items(payload.items);
      for (const item of payload.items) { shape(item, ["orderId", "itemId", "counterparty", "state", "settlementIds"]); if (!id(item.orderId) || !id(item.itemId) || !["awaiting_buyer", "filled", "cancelled"].includes(item.state as string)) throw new Error("Invalid order"); counterparty(item.counterparty); ids(item.settlementIds); if (item.state === "filled" && !(item.settlementIds as readonly unknown[]).length) throw new Error("Filled order lacks settlement"); }
      unique(payload.items, "orderId");
      if (query.kind !== "orders") throw new Error("Invalid order query"); return collectionState(query.filter, payload.hasUnfilteredResults, payload.items);
    case "libra_statistics": shape(payload, ["kind", "cumulativeIssued", "scope", "asOf"]); amount(payload.cumulativeIssued); ref(payload.scope); if (!id(payload.asOf)) throw new Error("Invalid statistic timestamp"); return "ready";
  }
}
/** Domain-separated identity binds the player, policy, query and every filter. */
export async function officialReadDigest(request: OfficialReadRequest): Promise<string> {
  requireRequest(request);
  return sha256Hex(canonicalJson({ domain: "senkei.official-progression-read.v1", request }));
}
/** No provider or verifier is supplied by default; no local data is promoted to official. */
export function readOfficialProgression(configuration: { readonly kind: "not-configured" }): Promise<OfficialReadResult>;
export function readOfficialProgression<Credentials>(configuration: ConfiguredOfficialRead<Credentials>, credentials: Credentials, requestInput: OfficialReadRequest): Promise<OfficialReadResult>;
export async function readOfficialProgression<Credentials>(configuration: OfficialReadConfiguration<Credentials>, credentials?: Credentials, requestInput?: OfficialReadRequest): Promise<OfficialReadResult> {
  if (configuration.kind === "not-configured") return { kind: "unavailable" };
  try {
    if (!requestInput) throw new Error("Missing official read request");
    const request = copy(requestInput); requireRequest(request);
    if (!id(configuration.authorityId) || configuration.authorityId !== request.authorityId || configuration.authorityId.toLowerCase() === "local") throw new Error("Official read authority mismatch");
    const principal = copy(await configuration.authentication.authenticate(credentials as Credentials));
    if (!principal || !id(principal.playerId) || !id(principal.identityAuthorityId) || principal.playerId !== request.playerId) throw new OfficialReadError("denied", "Read principal mismatch");
    const expectedDigest = await officialReadDigest(request);
    const evidence = copy(await configuration.provider.read(principal, request));
    shape(evidence, ["schema", "requestDigest", "evidence", "payload"]); ref(evidence.schema);
    if (evidence.requestDigest !== expectedDigest || !id(evidence.evidence)) throw new Error("Official read evidence mismatch");
    const kind = requirePayload(request, evidence.payload);
    const verified = copy(await configuration.verifier.verify(copy(request), copy(evidence)));
    if (canonicalJson(verified) !== canonicalJson(evidence)) throw new Error("Official read claims mismatch");
    return copy({ kind, payload: evidence.payload });
  } catch (error) {
    return { kind: error instanceof OfficialReadError ? error.kind : "failed" };
  }
}
