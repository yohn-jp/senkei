import {
  validateOfficialRequest, validateOfficialServiceResponse,
  type OfficialRequest, type OfficialServiceResponse,
} from "../../../apps/web/src/features/progression/official-service";
import { applyOfficialResponse, createOfficialTransaction, type OfficialIdentity } from "../../../apps/web/src/features/progression/official-transactions";
import { canonicalJson, sha256Hex } from "../../../apps/web/src/worker/input-identity";
import type { AuthenticationPort, Principal } from "./index";

type ConfirmedResponse = Exclude<OfficialServiceResponse, { readonly status: "outcome_unknown" }>;
export interface EconomyEvidenceSchema { readonly id: string; readonly version: string; readonly digest: string }
export type LibraIssuance =
  | { readonly kind: "none" }
  | { readonly kind: "market_maker"; readonly issuerId: string; readonly issuanceId: string };
/** This server-only envelope is authenticated by the authority's evidence verifier. */
export interface EconomyEvidence {
  readonly schema: EconomyEvidenceSchema;
  readonly requestDigest: string;
  readonly issuance: LibraIssuance;
  readonly response: ConfirmedResponse;
}
export type EconomyCommitOutcome =
  | { readonly status: "recorded"; readonly evidence: EconomyEvidence }
  | { readonly status: "outcome_unknown" };
export interface RecordedEconomicOperation {
  readonly request: OfficialRequest;
  readonly outcome: EconomyCommitOutcome;
}

/**
 * This is a trusted server-side durable transaction boundary, not an adapter to a
 * browser cache. In one serializable operation it must authenticate ownership and
 * eligibility against the principal, validate the exact versioned policy, entitlement,
 * order, quote, price/expiry and available balance as applicable, consume a right at
 * most once, and atomically record request, result, acquisitions, settlement and any
 * issuance. Same identity and same complete request return the existing operation;
 * reuse with different content must fail. Only an official market maker may issue
 * Libra; player trades transfer existing Libra and listing alone is not a sale.
 * Concrete policy, prices, random draws, ledgers and providers are not supplied here.
 */
export interface AtomicEconomyPort {
  commit(principal: Principal, request: OfficialRequest, requestDigest: string): Promise<EconomyCommitOutcome>;
  /** Load the original request and its durable outcome without resubmitting it. */
  inquire(principal: Principal, identity: OfficialIdentity): Promise<RecordedEconomicOperation | null>;
}
export interface EconomyEvidenceVerifier {
  /** Authenticate the issuer and all request, response, issuance and schema claims. */
  verify(request: OfficialRequest, evidence: EconomyEvidence): Promise<EconomyEvidence>;
}
export interface EconomyAuthorityPorts<Credentials> {
  readonly authorityId: string;
  readonly authentication: AuthenticationPort<Credentials>;
  readonly transaction: AtomicEconomyPort;
  readonly verifier: EconomyEvidenceVerifier;
}

export interface EconomicOrderIdentity { readonly authorityId: string; readonly playerId: string; readonly orderId: string }
export interface EconomicOrderEvidence extends EconomicOrderIdentity {
  readonly schema: EconomyEvidenceSchema;
  readonly state: "awaiting_buyer" | "filled" | "cancelled";
  readonly settlementIds: readonly string[];
  readonly evidence: string;
}
export interface EconomicOrderPorts<Credentials> {
  readonly authorityId: string;
  readonly authentication: AuthenticationPort<Credentials>;
  /** Must authorize the principal's access to this actual order. */
  readonly orders: { read(principal: Principal, orderId: string): Promise<EconomicOrderEvidence | null> };
  readonly verifier: { verifyOrder(evidence: EconomicOrderEvidence): Promise<EconomicOrderEvidence> };
}

function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}
function keys(value: unknown, expected: readonly string[]): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
function copy<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object" && !Object.isFrozen(item)) {
      Object.freeze(item);
      Object.values(item).forEach(freeze);
    }
  };
  freeze(cloned);
  return cloned;
}
function matches(a: OfficialIdentity, b: OfficialIdentity): boolean {
  return a.operationId === b.operationId && a.requestId === b.requestId && a.playerId === b.playerId && a.authorityId === b.authorityId;
}
function unknown(identity: OfficialIdentity): OfficialServiceResponse {
  return { operationId: identity.operationId, requestId: identity.requestId, playerId: identity.playerId, authorityId: identity.authorityId, status: "outcome_unknown" };
}
async function principalFor<Credentials>(ports: EconomyAuthorityPorts<Credentials>, credentials: Credentials, identity: OfficialIdentity): Promise<Principal> {
  if (!id(ports.authorityId) || ports.authorityId.toLowerCase() === "local" || identity.authorityId !== ports.authorityId) throw new Error("Economic authority mismatch");
  createOfficialTransaction(identity);
  const principal = copy(await ports.authentication.authenticate(credentials));
  if (!principal || !id(principal.playerId) || !id(principal.identityAuthorityId) || principal.playerId !== identity.playerId) throw new Error("Economic principal mismatch");
  return principal;
}
/** Canonical SHA-256 over the complete request, separated from other hash domains. */
export async function economicRequestDigest(request: OfficialRequest): Promise<string> {
  validateOfficialRequest(request);
  return sha256Hex(canonicalJson({ domain: "senkei.official-economic-request.v1", request }));
}
async function accept(ports: EconomyAuthorityPorts<unknown>, request: OfficialRequest, requestDigest: string, outcomeInput: EconomyCommitOutcome): Promise<OfficialServiceResponse> {
  const outcome = copy(outcomeInput);
  if (!outcome || typeof outcome !== "object") throw new Error("Invalid economic outcome");
  if (outcome.status === "outcome_unknown") {
    if (!keys(outcome, ["status"])) throw new Error("Invalid unknown economic outcome");
    return unknown(request);
  }
  if (outcome.status !== "recorded" || !keys(outcome, ["status", "evidence"])) throw new Error("Invalid economic outcome");
  const evidence = outcome.evidence;
  if (!keys(evidence, ["schema", "requestDigest", "issuance", "response"]) ||
      !keys(evidence.schema, ["id", "version", "digest"]) || !id(evidence.schema.id) || !id(evidence.schema.version) || !id(evidence.schema.digest) ||
      evidence.requestDigest !== requestDigest) throw new Error("Economic evidence identity mismatch");
  const issuance = evidence.issuance;
  if (!issuance || (issuance.kind === "none" && !keys(issuance, ["kind"])) ||
      (issuance.kind === "market_maker" && (!keys(issuance, ["kind", "issuerId", "issuanceId"]) || !id(issuance.issuerId) || !id(issuance.issuanceId) || request.action.kind !== "market_maker_buyback" || evidence.response?.status !== "committed")) ||
      (issuance.kind !== "none" && issuance.kind !== "market_maker")) throw new Error("Invalid Libra issuance claim");
  validateOfficialServiceResponse(request, evidence.response);
  const verified = copy(await ports.verifier.verify(copy(request), copy(evidence)));
  if (canonicalJson(verified) !== canonicalJson(evidence)) throw new Error("Economic evidence claims mismatch");
  // Reuse the existing identity, evidence and result/acquisition/settlement checks.
  await applyOfficialResponse(createOfficialTransaction(request), evidence.response, { verify: async () => evidence.response });
  return copy(evidence.response);
}

/** Authenticate, then ask the authority to validate and commit one complete request. */
export async function submitEconomicOperation<Credentials>(ports: EconomyAuthorityPorts<Credentials>, credentials: Credentials, input: OfficialRequest): Promise<OfficialServiceResponse> {
  const request = copy(input);
  validateOfficialRequest(request);
  const principal = await principalFor(ports, credentials, request);
  const digest = await economicRequestDigest(request);
  let outcome: EconomyCommitOutcome;
  try { outcome = await ports.transaction.commit(principal, request, digest); }
  catch { return unknown(request); }
  return accept(ports as EconomyAuthorityPorts<unknown>, request, digest, outcome);
}

/** Authenticate and inquire the same retained request; never submit a replacement. */
export async function inquireEconomicOperation<Credentials>(ports: EconomyAuthorityPorts<Credentials>, credentials: Credentials, input: OfficialIdentity): Promise<OfficialServiceResponse> {
  const identity = copy(input);
  if (!keys(identity, ["operationId", "requestId", "playerId", "authorityId"])) throw new Error("Invalid economic inquiry identity");
  const principal = await principalFor(ports, credentials, identity);
  let recorded: RecordedEconomicOperation | null;
  try { recorded = await ports.transaction.inquire(principal, identity); }
  catch { return unknown(identity); }
  if (!recorded) return unknown(identity);
  const record = copy(recorded);
  validateOfficialRequest(record.request);
  if (!matches(record.request, identity)) throw new Error("Economic inquiry identity mismatch");
  return accept(ports as EconomyAuthorityPorts<unknown>, record.request, await economicRequestDigest(record.request), record.outcome);
}

/** Observe an existing listing separately; a committed listing is never resubmitted as a sale. */
export async function readEconomicOrder<Credentials>(ports: EconomicOrderPorts<Credentials>, credentials: Credentials, input: EconomicOrderIdentity): Promise<EconomicOrderEvidence | null> {
  const identity = copy(input);
  if (!keys(identity, ["authorityId", "playerId", "orderId"]) || !id(identity.authorityId) || !id(identity.playerId) || !id(identity.orderId) ||
      !id(ports.authorityId) || ports.authorityId.toLowerCase() === "local" || identity.authorityId !== ports.authorityId) throw new Error("Invalid order identity");
  const principal = copy(await ports.authentication.authenticate(credentials));
  if (!principal || !id(principal.playerId) || !id(principal.identityAuthorityId) || principal.playerId !== identity.playerId) throw new Error("Order principal mismatch");
  const inputEvidence = await ports.orders.read(principal, identity.orderId);
  if (inputEvidence === null) return null;
  const evidence = copy(inputEvidence);
  if (!keys(evidence, ["authorityId", "playerId", "orderId", "schema", "state", "settlementIds", "evidence"]) ||
      evidence.authorityId !== identity.authorityId || evidence.playerId !== identity.playerId || evidence.orderId !== identity.orderId ||
      !keys(evidence.schema, ["id", "version", "digest"]) || !id(evidence.schema.id) || !id(evidence.schema.version) || !id(evidence.schema.digest) ||
      !["awaiting_buyer", "filled", "cancelled"].includes(evidence.state) || !id(evidence.evidence) ||
      !Array.isArray(evidence.settlementIds) || !evidence.settlementIds.every(id) || new Set(evidence.settlementIds).size !== evidence.settlementIds.length ||
      (evidence.state === "filled" && evidence.settlementIds.length === 0)) throw new Error("Invalid order evidence");
  const verified = copy(await ports.verifier.verifyOrder(copy(evidence)));
  if (canonicalJson(verified) !== canonicalJson(evidence)) throw new Error("Order evidence claims mismatch");
  return evidence;
}
