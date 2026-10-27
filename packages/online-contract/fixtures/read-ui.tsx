import { createRoot } from "react-dom/client";
import { OfficialReadPanel } from "../../../apps/web/src/features/progression/OfficialReadPanel";
import { OfficialReadError, officialReadDigest, type OfficialReadEvidence, type OfficialReadPayload, type OfficialReadRequest } from "../src/progression-read";

// Explicitly synthetic test producer; never imported by the application.
const ref = { id: "test-policy", version: "1", digest: "test-digest" };
const quantity = { value: "2", format: { id: "test-count", version: "1", digest: "test-format" } };
const request: OfficialReadRequest = { queryId: "test-query", playerId: "test-player", authorityId: "test-authority", policy: ref, query: { kind: "inventory", filter: "" } };
const calls = new Map<string, number>();
const configuration = { kind: "configured" as const, authorityId: "test-authority", authentication: { authenticate: async () => ({ playerId: "test-player", identityAuthorityId: "test-auth" }) },
  provider: { read: async (_principal: unknown, input: OfficialReadRequest) => {
    if (input.query.kind !== "inventory") throw new Error("Wrong fixture query");
    const filter = input.query.filter;
    calls.set(filter, (calls.get(filter) ?? 0) + 1);
    if (filter === "denied") throw new OfficialReadError("denied", "fixture denial");
    if (filter === "failure" && calls.get(filter) === 1) throw new Error("fixture connection error");
    if (filter === "slow") await new Promise(resolve => setTimeout(resolve, 300));
    const item = { instanceId: filter === "slow" ? "stale-item" : "real-item", definition: ref, available: true, equipped: false, tradeRestricted: false };
    const payload: OfficialReadPayload = { kind: "inventory", total: quantity, available: quantity, hasUnfilteredResults: true, items: filter === "missing" ? [] : [item] };
    return { schema: ref, requestDigest: await officialReadDigest(input), evidence: "test-proof", payload };
  } }, verifier: { verify: async (_request: OfficialReadRequest, evidence: OfficialReadEvidence) => evidence } };
const unavailable = new URLSearchParams(location.search).get("mode") === "unavailable";
createRoot(document.getElementById("root")!).render(unavailable
  ? <OfficialReadPanel configuration={{ kind: "not-configured" }}/>
  : <OfficialReadPanel configuration={configuration} credentials="test-credential" request={request}/>);
