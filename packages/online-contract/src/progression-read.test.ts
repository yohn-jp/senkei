import { describe, expect, it, vi } from "vitest";
import { OfficialReadError, officialReadDigest, readOfficialProgression, type OfficialReadEvidence, type OfficialReadPayload, type OfficialReadRequest } from "./progression-read";
import type { Principal } from "./index";

const ref = { id: "policy", version: "1", digest: "approved" };
const quantity = { value: "123456789012345678901234567890", format: { id: "quantity-format", version: "2", digest: "format-digest" } };
const principal = { playerId: "player", identityAuthorityId: "identity" };
const makeRequest = (query: OfficialReadRequest["query"]): OfficialReadRequest => ({ queryId: "query", playerId: "player", authorityId: "authority", policy: ref, query });
function harness(payload: OfficialReadPayload) {
  const authentication = { authenticate: vi.fn(async (credential: string): Promise<Principal> => { if (credential !== "valid") throw new OfficialReadError("denied", "denied"); return principal; }) };
  const provider = { read: vi.fn(async (_principal: Principal, request: OfficialReadRequest): Promise<OfficialReadEvidence> => ({ schema: ref, requestDigest: await officialReadDigest(request), evidence: "proof", payload })) };
  const verifier = { verify: vi.fn(async (_request: OfficialReadRequest, evidence: OfficialReadEvidence) => evidence) };
  return { authentication, provider, verifier, config: { kind: "configured" as const, authorityId: "authority", authentication, provider, verifier } };
}

describe("official progression reads", () => {
  it("reports a missing producer without credentials, fabricated identifiers or values", async () => {
    expect(await readOfficialProgression({ kind: "not-configured" })).toEqual({ kind: "unavailable" });
  });
  it("authenticates the exact Player before requesting provider data", async () => {
    const { config, provider } = harness({ kind: "balance", total: quantity, available: quantity });
    expect(await readOfficialProgression(config, "invalid", makeRequest({ kind: "balance" }))).toEqual({ kind: "denied" });
    expect(await readOfficialProgression(config, "valid", { ...makeRequest({ kind: "balance" }), playerId: "other" })).toEqual({ kind: "denied" });
    expect(provider.read).not.toHaveBeenCalled();
  });
  it("binds query, filter, versioned policy and authenticated evidence to immutable claims", async () => {
    const payload: OfficialReadPayload = { kind: "balance", total: quantity, available: quantity };
    const { config, provider, verifier } = harness(payload);
    provider.read.mockImplementationOnce(async (_principal, request) => {
      expect(Object.isFrozen(request.query)).toBe(true);
      return { schema: ref, requestDigest: await officialReadDigest({ ...request, policy: { ...ref, version: "other" } }), evidence: "proof", payload };
    });
    expect(await readOfficialProgression(config, "valid", makeRequest({ kind: "balance" }))).toEqual({ kind: "failed" });
    expect(verifier.verify).not.toHaveBeenCalled();
    verifier.verify.mockImplementationOnce(async (_request, evidence) => ({ ...evidence, payload: { ...payload, available: { ...quantity, value: "0" } } }));
    expect(await readOfficialProgression(config, "valid", makeRequest({ kind: "balance" }))).toEqual({ kind: "failed" });
    const accepted = await readOfficialProgression(config, "valid", makeRequest({ kind: "balance" }));
    expect(accepted).toEqual({ kind: "ready", payload });
    if (accepted.kind === "ready") expect(Object.isFrozen(accepted.payload)).toBe(true);
  });
  it("keeps provider failures, disconnection and denial distinct without revealing data", async () => {
    const { config, provider } = harness({ kind: "balance", total: quantity, available: quantity });
    provider.read.mockRejectedValueOnce(new Error("network"));
    expect(await readOfficialProgression(config, "valid", makeRequest({ kind: "balance" }))).toEqual({ kind: "failed" });
    provider.read.mockRejectedValueOnce(new OfficialReadError("unavailable", "offline"));
    expect(await readOfficialProgression(config, "valid", makeRequest({ kind: "balance" }))).toEqual({ kind: "unavailable" });
    provider.read.mockRejectedValueOnce(new OfficialReadError("denied", "forbidden"));
    expect(await readOfficialProgression(config, "valid", makeRequest({ kind: "balance" }))).toEqual({ kind: "denied" });
  });
  it("distinguishes truly empty inventory and an empty filtered view using provider evidence", async () => {
    const { config, provider } = harness({ kind: "inventory", total: quantity, available: quantity, hasUnfilteredResults: true, items: [] });
    const request = makeRequest({ kind: "inventory", filter: "rare" });
    expect(await readOfficialProgression(config, "valid", request)).toMatchObject({ kind: "filtered-empty", payload: { total: quantity, available: quantity } });
    expect(await readOfficialProgression(config, "valid", makeRequest({ kind: "inventory", filter: "" }))).toEqual({ kind: "failed" });
    provider.read.mockImplementationOnce(async (_principal, actual) => ({ schema: ref, requestDigest: await officialReadDigest(actual), evidence: "proof", payload: { kind: "inventory", total: quantity, available: quantity, hasUnfilteredResults: false, items: [] } }));
    expect(await readOfficialProgression(config, "valid", request)).toMatchObject({ kind: "empty" });
  });
  it("does not invent a probability, guarantee, price or missing issuance statistic", async () => {
    const pool: OfficialReadPayload = { kind: "draw_pool", poolId: "pool", guarantee: null, items: [{ itemId: "item", probability: { kind: "not_provided" } }] };
    expect(await readOfficialProgression(harness(pool).config, "valid", makeRequest({ kind: "draw_pool", poolId: "pool" }))).toEqual({ kind: "ready", payload: pool });
    expect(await readOfficialProgression(harness(pool).config, "valid", makeRequest({ kind: "draw_pool", poolId: "other" }))).toEqual({ kind: "failed" });
    const statistics = { kind: "libra_statistics", scope: ref, asOf: "as-of" } as OfficialReadPayload;
    expect(await readOfficialProgression(harness(statistics).config, "valid", makeRequest({ kind: "libra_statistics" }))).toEqual({ kind: "failed" });
    const provided: OfficialReadPayload = { kind: "libra_statistics", scope: ref, asOf: "as-of", cumulativeIssued: quantity };
    expect(await readOfficialProgression(harness(provided).config, "valid", makeRequest({ kind: "libra_statistics" }))).toEqual({ kind: "ready", payload: provided });
  });
  it("preserves authenticated entitlements and market offers without treating search prices as settlement", async () => {
    const entitlements: OfficialReadPayload = { kind: "entitlements", items: [{ entitlementId: "right", poolId: "pool" }] };
    expect(await readOfficialProgression(harness(entitlements).config, "valid", makeRequest({ kind: "entitlements" }))).toEqual({ kind: "ready", payload: entitlements });
    expect(await readOfficialProgression(harness({ kind: "entitlements", items: [] }).config, "valid", makeRequest({ kind: "entitlements" }))).toMatchObject({ kind: "empty" });
    const market: OfficialReadPayload = { kind: "market_search", hasUnfilteredResults: true, items: [{ offerId: "offer", itemId: "item", counterparty: { kind: "player", id: "seller" }, price: quantity }] };
    expect(await readOfficialProgression(harness(market).config, "valid", makeRequest({ kind: "market_search", filter: "item" }))).toEqual({ kind: "ready", payload: market });
    const duplicate: OfficialReadPayload = { ...market, items: [market.items[0], market.items[0]] };
    expect(await readOfficialProgression(harness(duplicate).config, "valid", makeRequest({ kind: "market_search", filter: "item" }))).toEqual({ kind: "failed" });
  });
  it("keeps owned and available inventory separate without imposing a numeric format or exclusive status", async () => {
    const item = { instanceId: "instance", definition: ref, available: false, equipped: true, tradeRestricted: true };
    const inventory: OfficialReadPayload = { kind: "inventory", total: quantity, available: { ...quantity, value: "0" }, hasUnfilteredResults: true, items: [item] };
    expect(await readOfficialProgression(harness(inventory).config, "valid", makeRequest({ kind: "inventory", filter: "" }))).toEqual({ kind: "ready", payload: inventory });
    const duplicate: OfficialReadPayload = { ...inventory, items: [item, item] };
    expect(await readOfficialProgression(harness(duplicate).config, "valid", makeRequest({ kind: "inventory", filter: "" }))).toEqual({ kind: "failed" });
  });
  it("keeps quotation and counterparty data bound to the requested quote", async () => {
    const quote: OfficialReadPayload = { kind: "quote", quoteId: "quote", itemId: "item", counterparty: { kind: "market_maker", id: "maker" }, price: quantity, fees: { kind: "not_provided" }, total: quantity, expiration: { kind: "not_provided" } };
    const { config } = harness(quote);
    expect(await readOfficialProgression(config, "valid", makeRequest({ kind: "quote", quoteId: "quote" }))).toEqual({ kind: "ready", payload: quote });
    expect(await readOfficialProgression(config, "valid", makeRequest({ kind: "quote", quoteId: "other" }))).toEqual({ kind: "failed" });
  });
  it("does not confuse an awaiting listing with a filled order or accept a filled order without settlement", async () => {
    const order = { orderId: "order", itemId: "item", counterparty: { kind: "player" as const, id: "other" }, state: "awaiting_buyer" as const, settlementIds: [] };
    const payload: OfficialReadPayload = { kind: "orders", hasUnfilteredResults: true, items: [order] };
    expect(await readOfficialProgression(harness(payload).config, "valid", makeRequest({ kind: "orders", filter: "" }))).toEqual({ kind: "ready", payload });
    const invalid: OfficialReadPayload = { ...payload, items: [{ ...order, state: "filled" }] };
    expect(await readOfficialProgression(harness(invalid).config, "valid", makeRequest({ kind: "orders", filter: "" }))).toEqual({ kind: "failed" });
    const filled: OfficialReadPayload = { ...payload, items: [{ ...order, state: "filled", settlementIds: ["settlement"] }] };
    expect(await readOfficialProgression(harness(filled).config, "valid", makeRequest({ kind: "orders", filter: "" }))).toEqual({ kind: "ready", payload: filled });
  });
  it("binds post-match data to the requested Match and preserves separately supplied result and acquisition references", async () => {
    const payload: OfficialReadPayload = { kind: "post_match", matchId: "match", resultId: "result", acquisitionIds: ["acquired"], relationshipUpdateIds: [], pendingIds: ["pending"] };
    expect(await readOfficialProgression(harness(payload).config, "valid", makeRequest({ kind: "post_match", matchId: "match" }))).toEqual({ kind: "ready", payload });
    expect(await readOfficialProgression(harness(payload).config, "valid", makeRequest({ kind: "post_match", matchId: "other" }))).toEqual({ kind: "failed" });
  });
});
