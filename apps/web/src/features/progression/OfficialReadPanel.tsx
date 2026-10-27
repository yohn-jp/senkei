import { useRef, useState } from "react";
import {
  readOfficialProgression,
  type ConfiguredOfficialRead,
  type OfficialReadPayload,
  type OfficialReadRequest,
  type OfficialReadResult,
  type ReadAmount,
} from "../../../../../packages/online-contract/src/progression-read";

export type OfficialReadPanelProps<Credentials> =
  | { readonly configuration: { readonly kind: "not-configured" } }
  | { readonly configuration: ConfiguredOfficialRead<Credentials>; readonly credentials: Credentials; readonly request: OfficialReadRequest };

type Readable = Extract<OfficialReadResult, { kind: "ready" | "empty" | "filtered-empty" }>;
type ScreenState = { readonly kind: "not-fetched" | "loading" } | OfficialReadResult;
const amount = (value: ReadAmount) => `${value.value} (${value.format.id} ${value.format.version})`;
const counterparty = (value: { readonly kind: "player" | "market_maker"; readonly id: string }) => `${value.kind === "market_maker" ? "Official market maker" : "Player"} · ${value.id}`;

function ReadData({ payload }: { readonly payload: OfficialReadPayload }) {
  switch (payload.kind) {
    case "post_match": return <div><p>Match {payload.matchId} · result {payload.resultId}</p><p>Confirmed acquisitions: {payload.acquisitionIds.length ? payload.acquisitionIds.join(", ") : "none reported"}</p><p>Confirmed relationship updates: {payload.relationshipUpdateIds.length ? payload.relationshipUpdateIds.join(", ") : "none reported"}</p><p>Pending: {payload.pendingIds.length ? payload.pendingIds.join(", ") : "none reported"}</p></div>;
    case "entitlements": return <ul>{payload.items.map(item => <li key={item.entitlementId}>Draw entitlement {item.entitlementId} · pool {item.poolId}</li>)}</ul>;
    case "draw_pool": return <div><p>Pool {payload.poolId} · guarantee: {payload.guarantee ?? "not supplied"}</p><ul>{payload.items.map(item => <li key={item.itemId}>{item.itemId} · probability: {item.probability.kind === "provided" ? amount(item.probability.amount) : "not supplied"}</li>)}</ul></div>;
    case "inventory": return <div><p>Total: {amount(payload.total)} · available: {amount(payload.available)}</p><ul>{payload.items.map(item => <li key={item.instanceId}>{item.definition.id} {item.definition.version} · {item.instanceId} · {item.available ? "available" : "unavailable"}{item.equipped ? " · equipped" : ""}{item.tradeRestricted ? " · trade restricted" : ""}</li>)}</ul></div>;
    case "balance": return <p>Libra total: {amount(payload.total)} · available: {amount(payload.available)}</p>;
    case "market_search": return <div><p>Search prices do not guarantee a transaction.</p><ul>{payload.items.map(item => <li key={item.offerId}>{item.itemId} · {counterparty(item.counterparty)} · {amount(item.price)} · offer {item.offerId}</li>)}</ul></div>;
    case "quote": return <div><p>Quote {payload.quoteId} · {payload.itemId} · {counterparty(payload.counterparty)}</p><p>Price: {amount(payload.price)} · fees: {payload.fees.kind === "provided" ? amount(payload.fees.amount) : "not supplied"} · total: {amount(payload.total)}</p><p>Expiration: {payload.expiration.kind === "at" ? payload.expiration.value : "not supplied"}. Confirm with the authority before committing.</p></div>;
    case "orders": return <ul>{payload.items.map(item => <li key={item.orderId}>{item.orderId} · {item.itemId} · {counterparty(item.counterparty)} · {item.state === "awaiting_buyer" ? "Awaiting buyer" : item.state === "filled" ? "Filled" : "Cancelled"}{item.settlementIds.length > 0 ? ` · settlement: ${item.settlementIds.join(", ")}` : ""}</li>)}</ul>;
    case "libra_statistics": return <p>Cumulative Libra issued: {amount(payload.cumulativeIssued)} · scope {payload.scope.id} {payload.scope.version} · as of {payload.asOf}. This is issuance, not trading volume.</p>;
  }
}

function ConfiguredPanel<Credentials>({ configuration, credentials, request }: { readonly configuration: ConfiguredOfficialRead<Credentials>; readonly credentials: Credentials; readonly request: OfficialReadRequest }) {
  const filterable = request.query.kind === "inventory" || request.query.kind === "market_search" || request.query.kind === "orders";
  const [filter, setFilter] = useState(filterable ? request.query.filter : "");
  const [state, setState] = useState<{ readonly generation: number; readonly value: ScreenState }>({ generation: 0, value: { kind: "not-fetched" } });
  const context = useRef({ configuration, credentials, key: JSON.stringify(request), generation: 0 });
  if (context.current.configuration !== configuration || context.current.credentials !== credentials || context.current.key !== JSON.stringify(request)) {
    context.current = { configuration, credentials, key: JSON.stringify(request), generation: context.current.generation + 1 };
  }
  const current = state.generation === context.current.generation ? state.value : { kind: "not-fetched" as const };
  const load = async () => {
    const generation = ++context.current.generation;
    setState({ generation, value: { kind: "loading" } });
    const query = request.query.kind === "inventory" || request.query.kind === "market_search" || request.query.kind === "orders"
      ? { ...request.query, filter } : request.query;
    const result = await readOfficialProgression(configuration, credentials, { ...request, query });
    if (generation === context.current.generation) setState({ generation, value: result });
  };
  const readable = current.kind === "ready" || current.kind === "empty" || current.kind === "filtered-empty" ? current as Readable : null;
  return <section aria-label="Official progression read"><h3>Official progression</h3>
    {filterable && <label>Search <input value={filter} onChange={event => { context.current.generation++; setFilter(event.target.value); setState({ generation: context.current.generation, value: { kind: "not-fetched" } }); }}/></label>}
    <button type="button" disabled={current.kind === "loading"} onClick={() => void load()}>{current.kind === "failed" || current.kind === "unavailable" ? "Retry" : filterable ? "Search" : "Load"}</button>
    {current.kind === "not-fetched" && <p>Not fetched from the authority.</p>}
    {current.kind === "loading" && <p role="status">Loading from the authority…</p>}
    {current.kind === "unavailable" && <p role="status">The official service is unavailable. Retry when it is connected.</p>}
    {current.kind === "denied" && <p role="alert">This account is not authorized to read the requested data.</p>}
    {current.kind === "failed" && <p role="alert">The official read could not be verified or completed. Retry.</p>}
    {current.kind === "empty" && <p>No results were reported by the authority.</p>}
    {current.kind === "filtered-empty" && <p>No results match this filter; other results exist.</p>}
    {readable && <ReadData payload={readable.payload}/>}
  </section>;
}

/** A configured host supplies real credentials and a real authority request; replace the credentials value when identity changes. */
export function OfficialReadPanel<Credentials>(props: OfficialReadPanelProps<Credentials>) {
  if (!("request" in props)) return <section aria-label="Official progression read"><h3>Official progression</h3><p>The official service is not configured.</p></section>;
  return <ConfiguredPanel key={JSON.stringify(props.request)} configuration={props.configuration} credentials={props.credentials} request={props.request}/>;
}
