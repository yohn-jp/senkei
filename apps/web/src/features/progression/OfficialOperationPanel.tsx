import { useEffect, useRef, useState } from 'react';
import { canonicalJson } from '../../worker/input-identity';
import type { OfficialIdentity } from './official-transactions';
import { type OfficialOperationResult, type OfficialRequest, type OfficialServiceTransaction, OfficialOperations } from './official-service';
import {
  readVerifiedOperationPreview,
  type OfficialOperationPreview,
  type OfficialOperationPreviewProvider,
  type OfficialOperationPreviewVerifier,
  type OptionalPreviewText,
  type PreviewAmount,
} from './official-preview';

export type OfficialOperationPanelProps =
  | { readonly configuration: { readonly kind: 'not-configured' }; readonly onReturn?: () => void }
  | { readonly configuration: { readonly kind: 'configured'; readonly operations: OfficialOperations; readonly previewProvider: OfficialOperationPreviewProvider; readonly previewVerifier: OfficialOperationPreviewVerifier }; readonly request: OfficialRequest; readonly onReturn?: () => void };
type ConfiguredProps = Extract<OfficialOperationPanelProps, { readonly request: OfficialRequest }>;
type Recorded = Extract<OfficialOperationResult, { kind: 'recorded' }>;
type Screen =
  | { readonly kind: 'recovering' | 'idle' | 'previewing' | 'cancelled' | 'submitting' | 'status-lost' }
  | { readonly kind: 'review'; readonly preview: OfficialOperationPreview }
  | { readonly kind: 'recorded'; readonly value: Recorded; readonly checking: boolean; readonly error?: string }
  | { readonly kind: 'failure'; readonly stage: 'recovery' | 'preview'; readonly message: string; readonly afterSubmit?: boolean };
const identityOf = ({ operationId, requestId, playerId, authorityId }: OfficialRequest): OfficialIdentity => ({ operationId, requestId, playerId, authorityId });
const amount = (value: PreviewAmount) => `${value.value} (${value.format.id} ${value.format.version})`;
const supplied = (value: OptionalPreviewText) => value.kind === 'provided' ? value.value : 'not supplied';
const actionLabel = (request: OfficialRequest) => ({ draw: 'draw', player_listing: 'player listing', market_maker_buyback: 'market maker buyback', purchase: 'purchase', cancel: 'cancellation' })[request.action.kind];
function PreviewDetails({ preview }: { readonly preview: OfficialOperationPreview }) {
  const terms = preview.terms;
  return <div><p>Verified preview {preview.previewId} · policy {preview.request.policy.id} {preview.request.policy.version}</p>
    {terms.kind === 'draw' ? <><p>Entitlement {terms.entitlementId} · pool {terms.poolId}</p><p>Guarantee: {supplied(terms.guarantee)}</p>
      {terms.items.length ? <ul>{terms.items.map(item => <li key={item.itemId}>{item.itemId} · probability: {item.probability.kind === 'provided' ? amount(item.probability.amount) : 'not supplied'}</li>)}</ul> : <p>Pool item details were not supplied.</p>}</>
      : terms.kind === 'cancel' ? <p>Order {terms.orderId}</p>
      : <><p>Item {terms.itemId} · quote {terms.quoteId}</p><p>Counterparty: {terms.counterparty.kind === 'market_maker' ? 'Official market maker' : 'Player'}{terms.counterparty.id ? ` · ${terms.counterparty.id}` : ' · identity not supplied'}</p>
        <p>Quantity: {amount(terms.quantity)} · price: {amount(terms.price)} · fees: {terms.fees.kind === 'provided' ? amount(terms.fees.amount) : 'not supplied'} · total: {amount(terms.total)}</p><p>Expiration: {supplied(terms.expiration)}</p>
        {terms.kind === 'player_listing' && <p>A player listing waits for a buyer; submitting a listing does not itself complete a sale.</p>}
        {terms.kind === 'market_maker_buyback' && <p>Official market maker minimum guarantee: {terms.minimumGuarantee.kind === 'provided' ? amount(terms.minimumGuarantee.amount) : 'not supplied'}.</p>}</>}
    {terms.conditions.length ? <ul>{terms.conditions.map((condition, index) => <li key={`${index}:${condition}`}>{condition}</li>)}</ul> : <p>No additional conditions were supplied.</p>}
  </div>;
}
function TransactionDetails({ value }: { readonly value: Recorded }) {
  const transaction: OfficialServiceTransaction = value.transaction;
  if (transaction.status === 'submitted' || transaction.status === 'outcome_unknown') return <p role="status">The outcome is unknown. Check the original request; do not submit it again.</p>;
  if (transaction.status === 'pending') return <p role="status">{transaction.progress?.kind === 'player_listing' ? `Listing ${transaction.progress.orderId} is awaiting a buyer.` : 'The authority reports this request is pending.'}</p>;
  if (transaction.status === 'rejected') return <p role="alert">{transaction.reason.code === 'quote_changed' ? 'The quote changed. Return and review a new quote before another request.' : transaction.reason.code === 'insufficient_balance' ? 'The authority rejected this request for insufficient available balance.' : transaction.reason.code === 'denied' ? 'The authority denied this request.' : 'The authority rejected this request.'}</p>;
  const outcome = transaction.outcome;
  const description = outcome.kind === 'draw' ? 'Draw committed.'
    : outcome.kind === 'player_listing' ? outcome.state === 'listed' ? `Listing ${outcome.orderId} was created and is awaiting a buyer.` : `Listing ${outcome.orderId} was filled.`
    : outcome.kind === 'market_maker_buyback' ? 'Market maker buyback committed.'
    : outcome.kind === 'purchase' ? 'Purchase committed.' : 'Order cancellation committed.';
  return <div role="status"><p>{description}</p><p>Result {transaction.resultId}</p><p>Acquisition records: {transaction.acquisitionIds.length ? transaction.acquisitionIds.join(', ') : 'none reported'}</p><p>Settlement records: {transaction.settlementIds.length ? transaction.settlementIds.join(', ') : 'none reported'}</p>
    {outcome.kind === 'player_listing' && outcome.state === 'listed' && <p>Use the order view to check later status.</p>}
  </div>;
}
function ConfiguredOperationPanel({ configuration, request, onReturn }: ConfiguredProps) {
  const [screen, setScreen] = useState<Screen>({ kind: 'recovering' });
  const generation = useRef(0); const busy = useRef(false); const requestKey = canonicalJson(request);
  const readRecovery = async (ticket: number, afterSubmit: boolean) => {
    try {
      const recovered = await configuration.operations.recover(identityOf(request));
      if (generation.current !== ticket) return;
      if (recovered.kind === 'unavailable') { setScreen({ kind: 'failure', stage: 'recovery', message: 'The official service is unavailable.', afterSubmit }); return; }
      if (recovered.kind === 'not-recorded') { setScreen(afterSubmit ? { kind: 'status-lost' } : { kind: 'idle' }); return; }
      if (canonicalJson(recovered.request) !== requestKey) throw new Error('The retained request differs from this operation.');
      setScreen({ kind: 'recorded', value: recovered, checking: false });
    } catch {
      if (generation.current === ticket) setScreen({ kind: 'failure', stage: 'recovery', message: 'Retry or return to the previous view.', afterSubmit });
    }
  };
  useEffect(() => {
    const ticket = ++generation.current; setScreen({ kind: 'recovering' });
    void readRecovery(ticket, false);
    return () => { generation.current++; };
  }, [configuration.operations, configuration.previewProvider, configuration.previewVerifier, requestKey]);
  const review = async () => {
    if (busy.current) return;
    busy.current = true; const ticket = generation.current; setScreen({ kind: 'previewing' });
    try {
      const preview = await readVerifiedOperationPreview(request, configuration.previewProvider, configuration.previewVerifier);
      if (generation.current === ticket) setScreen({ kind: 'review', preview });
    } catch {
      if (generation.current === ticket) setScreen({ kind: 'failure', stage: 'preview', message: 'Retry or return to the previous view.' });
    } finally { busy.current = false; }
  };
  const submit = async (preview: OfficialOperationPreview) => {
    if (busy.current || canonicalJson(preview.request) !== requestKey) return;
    busy.current = true; const ticket = generation.current; setScreen({ kind: 'submitting' });
    try {
      const result = await configuration.operations.submit(preview.request);
      if (generation.current !== ticket) return;
      if (result.kind === 'unavailable') { setScreen({ kind: 'failure', stage: 'recovery', message: 'The official service is unavailable.', afterSubmit: true }); return; }
      if (canonicalJson(result.request) !== requestKey) throw new Error('The retained request differs from this operation.');
      setScreen({ kind: 'recorded', value: result, checking: false });
    } catch {
      // A journaled or sent request must never be submitted again on an error.
      if (generation.current === ticket) await readRecovery(ticket, true);
    } finally { busy.current = false; }
  };
  const inquire = async (value: Recorded) => {
    if (busy.current) return;
    busy.current = true; const ticket = generation.current; setScreen({ kind: 'recorded', value, checking: true });
    try {
      const result = await configuration.operations.inquire(identityOf(value.request));
      if (generation.current !== ticket) return;
      if (result.kind === 'unavailable') throw new Error('The official service is unavailable.');
      if (canonicalJson(result.request) !== requestKey) throw new Error('The retained request differs from this operation.');
      setScreen({ kind: 'recorded', value: result, checking: false });
    } catch {
      if (generation.current === ticket) setScreen({ kind: 'recorded', value, checking: false, error: 'The inquiry could not be completed or verified.' });
    } finally { busy.current = false; }
  };
  const recoverAgain = async (afterSubmit: boolean) => {
    if (busy.current) return;
    busy.current = true; const ticket = generation.current; setScreen({ kind: 'recovering' });
    try { await readRecovery(ticket, afterSubmit); } finally { busy.current = false; }
  };
  return <section aria-label="Official operation"><h3>Official {actionLabel(request)}</h3>
    <p>Request {request.requestId} · authority {request.authorityId}</p>
    {screen.kind === 'recovering' && <p role="status">Checking this device for the original request…</p>}
    {screen.kind === 'idle' && <><p>This request is not recorded on this device. The authority must still validate and settle it.</p><button type="button" onClick={() => void review()}>Review {actionLabel(request)}</button></>}
    {screen.kind === 'previewing' && <p role="status">Checking the authority's preview…</p>}
    {screen.kind === 'review' && <div role="group" aria-label="Confirm official operation"><PreviewDetails preview={screen.preview}/><button type="button" onClick={() => void submit(screen.preview)}>Confirm {actionLabel(request)}</button><button type="button" onClick={() => setScreen({ kind: 'cancelled' })}>Cancel</button></div>}
    {screen.kind === 'cancelled' && <><p>Cancelled before submission.</p><button type="button" onClick={() => void review()}>Review again</button></>}
    {screen.kind === 'submitting' && <p role="status">Submitting the original request…</p>}
    {screen.kind === 'status-lost' && <><p role="alert">The request outcome could not be recovered. Do not submit it again.</p><button type="button" onClick={() => void recoverAgain(true)}>Retry request recovery</button></>}
    {screen.kind === 'failure' && <><p role="alert">{screen.stage === 'preview' ? 'The preview could not be verified.' : 'The request status could not be recovered.'} {screen.message}</p><button type="button" onClick={() => screen.stage === 'preview' ? void review() : void recoverAgain(screen.afterSubmit === true)}>{screen.stage === 'preview' ? 'Retry preview' : 'Retry request recovery'}</button></>}
    {screen.kind === 'recorded' && <><TransactionDetails value={screen.value}/>{screen.error && <p role="alert">Inquiry failed: {screen.error}</p>}{(screen.value.transaction.status === 'submitted' || screen.value.transaction.status === 'outcome_unknown' || screen.value.transaction.status === 'pending') && <button type="button" disabled={screen.checking} onClick={() => void inquire(screen.value)}>{screen.checking ? 'Checking…' : 'Check original request'}</button>}</>}
    {onReturn && <button type="button" onClick={onReturn}>Return</button>}
  </section>;
}

/** Default installation has no authority, credentials, preview producer or transaction controls. */
export function OfficialOperationPanel(props: OfficialOperationPanelProps) {
  if (!('request' in props)) return <section aria-label="Official operation"><h3>Official operation</h3><p>The official service is not configured.</p>{props.onReturn && <button type="button" onClick={props.onReturn}>Return</button>}</section>;
  return <ConfiguredOperationPanel key={canonicalJson(props.request)} {...props}/>;
}
