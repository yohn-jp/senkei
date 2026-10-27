import { describe, expect, it, vi } from "vitest";
import type { OfficialRequest, OfficialServiceResponse } from "../../../apps/web/src/features/progression/official-service";
import type { OfficialIdentity } from "../../../apps/web/src/features/progression/official-transactions";
import type { Principal } from "./index";
import { economicRequestDigest, inquireEconomicOperation, readEconomicOrder, submitEconomicOperation, type EconomyAuthorityPorts, type EconomyCommitOutcome, type EconomyEvidence, type EconomicOrderEvidence, type RecordedEconomicOperation } from "./economy";

const identity = { operationId: "operation", requestId: "request", playerId: "player", authorityId: "authority" };
const request: OfficialRequest = { ...identity, policy: { id: "policy", version: "1", digest: "approved-policy-digest" }, action: { kind: "draw", entitlementId: "right", poolId: "pool" } };
const committed: Exclude<OfficialServiceResponse, { status: "outcome_unknown" }> = { ...identity, status: "committed", resultId: "result", acquisitionIds: ["acquisition"], settlementIds: [], evidence: "signed-evidence", outcome: { kind: "draw", entitlementId: "right", poolId: "pool" } };

async function harness(req: OfficialRequest = request, response: Exclude<OfficialServiceResponse, { status: "outcome_unknown" }> = committed) {
  const evidence: EconomyEvidence = { schema: { id: "claims", version: "1", digest: "approved-schema" }, requestDigest: await economicRequestDigest(req), issuance: { kind: "none" }, response };
  let stored: RecordedEconomicOperation | null = null;
  let effects = 0;
  const ports = {
    authorityId: "authority",
    authentication: { authenticate: vi.fn(async (credential: string): Promise<Principal> => {
      if (credential !== "valid") throw new Error("Authentication failed");
      return { playerId: "player", identityAuthorityId: "identity-provider" };
    }) },
    transaction: {
      commit: vi.fn(async (_principal: Principal, submitted: OfficialRequest, digest: string): Promise<EconomyCommitOutcome> => {
        if (stored) {
          if (await economicRequestDigest(stored.request) !== digest) throw new Error("Conflicting request");
          return stored.outcome;
        }
        if (digest !== evidence.requestDigest) throw new Error("Unexpected request");
        effects++;
        stored = { request: submitted, outcome: { status: "recorded", evidence } };
        return stored.outcome;
      }),
      inquire: vi.fn(async (_principal: Principal, _identity: OfficialIdentity): Promise<RecordedEconomicOperation | null> => stored),
    },
    verifier: { verify: vi.fn(async (_request: OfficialRequest, claim: EconomyEvidence) => claim) },
  } satisfies EconomyAuthorityPorts<string>;
  return { ports, evidence, effects: () => effects };
}

describe("economic authority boundary", () => {
  it("authenticates the principal and rejects client-forged ownership or results before commit", async () => {
    const { ports } = await harness();
    await expect(submitEconomicOperation(ports, "invalid", request)).rejects.toThrow("Authentication failed");
    await expect(submitEconomicOperation(ports, "valid", { ...request, playerId: "other" })).rejects.toThrow("principal mismatch");
    await expect(submitEconomicOperation(ports, "valid", { ...request, resultId: "forged" } as OfficialRequest)).rejects.toThrow("Invalid official request");
    expect(ports.transaction.commit).not.toHaveBeenCalled();
  });
  it("binds claims to the full request, preserves idempotence and never exposes the internal envelope", async () => {
    const { ports, effects } = await harness();
    expect(await submitEconomicOperation(ports, "valid", request)).toEqual(committed);
    expect(await submitEconomicOperation(ports, "valid", request)).toEqual(committed);
    expect(effects()).toBe(1);
    const changed = { ...request, action: { kind: "draw", entitlementId: "other", poolId: "pool" } } as OfficialRequest;
    expect(await submitEconomicOperation(ports, "valid", changed)).toMatchObject({ status: "outcome_unknown" });
    expect(effects()).toBe(1);
    expect(ports.verifier.verify).toHaveBeenCalledTimes(2);
  });
  it("recovers an ambiguous result by inquiry of the original durable request, not a second draw", async () => {
    const { ports, evidence, effects } = await harness();
    const original = ports.transaction.commit.getMockImplementation()!;
    ports.transaction.commit.mockImplementationOnce(async (...args) => { await original(...args); throw new Error("Lost response"); });
    expect(await submitEconomicOperation(ports, "valid", request)).toMatchObject({ status: "outcome_unknown" });
    expect(await inquireEconomicOperation(ports, "valid", identity)).toEqual(committed);
    expect(ports.transaction.commit).toHaveBeenCalledTimes(1);
    expect(effects()).toBe(1);
    expect(ports.verifier.verify).toHaveBeenLastCalledWith(request, evidence);
  });
  it("rejects evidence for a different request and tampered verifier claims", async () => {
    const first = await harness();
    first.ports.transaction.commit.mockResolvedValueOnce({ status: "recorded", evidence: { ...first.evidence, requestDigest: "0".repeat(64) } });
    await expect(submitEconomicOperation(first.ports, "valid", request)).rejects.toThrow("evidence identity mismatch");
    const second = await harness();
    second.ports.verifier.verify.mockImplementationOnce(async (_r, claim) => ({ ...claim, schema: { ...claim.schema, version: "2" } }));
    await expect(submitEconomicOperation(second.ports, "valid", request)).rejects.toThrow("evidence claims mismatch");
  });
  it("does not accept mismatched action outcomes or Libra issuance from a player listing", async () => {
    const listing: OfficialRequest = { ...request, action: { kind: "player_listing", itemId: "item", quoteId: "quote" } };
    const listed: Exclude<OfficialServiceResponse, { status: "outcome_unknown" }> = { ...identity, status: "committed", resultId: "listing-result", acquisitionIds: [], settlementIds: [], evidence: "signed", outcome: { kind: "player_listing", itemId: "item", quoteId: "quote", orderId: "order", state: "listed" } };
    const good = await harness(listing, listed);
    expect(await submitEconomicOperation(good.ports, "valid", listing)).toEqual(listed);
    const forged = await harness(listing, listed);
    forged.ports.transaction.commit.mockResolvedValueOnce({ status: "recorded", evidence: { ...forged.evidence, issuance: { kind: "market_maker", issuerId: "maker", issuanceId: "issue" } } });
    await expect(submitEconomicOperation(forged.ports, "valid", listing)).rejects.toThrow("Invalid Libra issuance claim");
    const wrong = await harness();
    wrong.ports.transaction.commit.mockResolvedValueOnce({ status: "recorded", evidence: { ...wrong.evidence, response: { ...committed, outcome: { kind: "draw", entitlementId: "other", poolId: "pool" } } } });
    await expect(submitEconomicOperation(wrong.ports, "valid", request)).rejects.toThrow("Draw outcome mismatch");
  });
  it("preserves authenticated rejection reasons and never presents an unknown outcome as a commit", async () => {
    const rejected: Exclude<OfficialServiceResponse, { status: "outcome_unknown" }> = { ...identity, status: "rejected", evidence: "signed", reason: { code: "quote_changed" } };
    const { ports } = await harness(request, rejected);
    expect(await submitEconomicOperation(ports, "valid", request)).toEqual(rejected);
    ports.transaction.inquire.mockResolvedValueOnce(null);
    expect(await inquireEconomicOperation(ports, "valid", identity)).toEqual({ ...identity, status: "outcome_unknown" });
  });
  it("reads a separately authorized order without turning listing acceptance into a sale", async () => {
    const principal = { playerId: "player", identityAuthorityId: "identity-provider" };
    const order: EconomicOrderEvidence = { authorityId: "authority", playerId: "player", orderId: "order", schema: { id: "order-schema", version: "1", digest: "schema-digest" }, state: "awaiting_buyer", settlementIds: [], evidence: "signed" };
    const ports = { authorityId: "authority", authentication: { authenticate: vi.fn(async () => principal) },
      orders: { read: vi.fn(async () => order) }, verifier: { verifyOrder: vi.fn(async (claim: EconomicOrderEvidence) => claim) } };
    expect((await readEconomicOrder(ports, "valid", { authorityId: "authority", playerId: "player", orderId: "order" }))?.state).toBe("awaiting_buyer");
    expect(ports.orders.read).toHaveBeenCalledWith(principal, "order");
    await expect(readEconomicOrder(ports, "valid", { authorityId: "authority", playerId: "other", orderId: "order" })).rejects.toThrow("principal mismatch");
    ports.orders.read.mockResolvedValueOnce({ ...order, state: "filled" });
    await expect(readEconomicOrder(ports, "valid", { authorityId: "authority", playerId: "player", orderId: "order" })).rejects.toThrow("Invalid order evidence");
  });
});
