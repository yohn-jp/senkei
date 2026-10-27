import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OfficialOperationPanel, type OfficialOperationPanelProps } from '../../../apps/web/src/features/progression/OfficialOperationPanel';
import { OfficialOperations, type OfficialAction, type OfficialRequest, type OfficialServiceResponse, type OfficialServiceTransaction } from '../../../apps/web/src/features/progression/official-service';
import { OfficialOperationJournal } from '../../../apps/web/src/features/progression/official-journal';
import type { OfficialOperationPreview, OfficialPreviewTerms } from '../../../apps/web/src/features/progression/official-preview';

const mode = new URL(location.href).searchParams.get('mode') ?? 'draw';
const policy = { id: 'fixture-policy', version: '1', digest: 'fixture-digest' };
const money = { value: '12', format: policy };
const action: OfficialAction = mode === 'draw' || mode === 'invalid-preview' || mode === 'lost-journal' ? { kind: 'draw', entitlementId: 'right', poolId: 'pool' }
  : mode === 'listing' || mode === 'pending' ? { kind: 'player_listing', itemId: 'blade', quoteId: 'quote' }
  : mode === 'buyback' ? { kind: 'market_maker_buyback', itemId: 'blade', quoteId: 'quote' }
  : mode === 'cancel' ? { kind: 'cancel', orderId: 'order' } : { kind: 'purchase', quoteId: 'quote' };
const request: OfficialRequest = { operationId: `operation-${mode}`, requestId: `request-${mode}`, playerId: 'fixture-player', authorityId: 'fixture-authority', policy, action };
const identity = { operationId: request.operationId, requestId: request.requestId, playerId: request.playerId, authorityId: request.authorityId };
const terms: OfficialPreviewTerms = action.kind === 'draw' ? { ...action, items: [{ itemId: 'blade', probability: { kind: 'provided', amount: { value: 'fixture 1/3', format: policy } } }], guarantee: { kind: 'not_provided' }, conditions: ['Fixture draw condition'] }
  : action.kind === 'cancel' ? { ...action, conditions: ['Fixture cancellation condition'] }
  : action.kind === 'market_maker_buyback' ? { kind: action.kind, itemId: 'blade', quoteId: 'quote', counterparty: { kind: 'market_maker', id: 'maker' }, quantity: { value: '1', format: policy }, price: money, fees: { kind: 'not_provided' }, total: money, expiration: { kind: 'provided', value: 'fixture expiry' }, minimumGuarantee: { kind: 'provided', amount: money }, conditions: ['Fixture quote condition'] }
  : { kind: action.kind, itemId: 'blade', quoteId: 'quote', counterparty: { kind: 'player', id: null }, quantity: { value: '1', format: policy }, price: money, fees: { kind: 'not_provided' }, total: money, expiration: { kind: 'provided', value: 'fixture expiry' }, conditions: ['Fixture quote condition'] };
const preview: OfficialOperationPreview = { schemaVersion: 1, schema: policy, previewId: 'fixture-preview', request, terms, evidence: 'fixture-preview-proof' };
const record = (name: string) => localStorage.setItem(`${mode}-${name}`, String(Number(localStorage.getItem(`${mode}-${name}`) ?? 0) + 1));
const drawResult: OfficialServiceResponse = { ...identity, status: 'committed', resultId: 'draw-result', acquisitionIds: ['blade-acquisition'], settlementIds: [], evidence: 'fixture-result-proof', outcome: { kind: 'draw', entitlementId: 'right', poolId: 'pool' } };
const listing = (state: 'listed' | 'filled'): OfficialServiceResponse => ({ ...identity, status: 'committed', resultId: `listing-${state}`, acquisitionIds: [], settlementIds: state === 'filled' ? ['sale-settlement'] : [], evidence: 'fixture-result-proof', outcome: { kind: 'player_listing', itemId: 'blade', quoteId: 'quote', orderId: 'order', state } });
const journal = new OfficialOperationJournal<OfficialRequest, OfficialServiceTransaction>(indexedDB, `fixture-official-${mode}`);
const operations = new OfficialOperations({ kind: 'configured', adapter: {
  async submit(actual) {
    record('submits'); localStorage.setItem(`${mode}-last-request`, JSON.stringify(actual));
    if (mode === 'lost-journal') {
      await new Promise<void>((resolve, reject) => { const deletion = indexedDB.deleteDatabase(`fixture-official-${mode}`); deletion.onsuccess = () => resolve(); deletion.onerror = () => reject(deletion.error); });
      throw new Error('fixture connection and journal lost');
    }
    if (mode === 'draw') throw new Error('fixture connection lost');
    if (mode === 'pending') return { ...identity, status: 'pending', evidence: 'fixture-result-proof', progress: { kind: 'player_listing', orderId: 'order', state: 'awaiting_buyer' } };
    if (mode === 'listing') return listing('listed');
    if (mode === 'quote-changed') return { ...identity, status: 'rejected', evidence: 'fixture-result-proof', reason: { code: 'quote_changed' } };
    if (mode === 'buyback') return { ...identity, status: 'committed', resultId: 'buyback', acquisitionIds: [], settlementIds: ['buyback-settlement'], evidence: 'fixture-result-proof', outcome: { kind: 'market_maker_buyback', itemId: 'blade', quoteId: 'quote' } };
    if (mode === 'cancel') return { ...identity, status: 'committed', resultId: 'cancel', acquisitionIds: [], settlementIds: [], evidence: 'fixture-result-proof', outcome: { kind: 'cancel', orderId: 'order' } };
    return { ...identity, status: 'committed', resultId: 'purchase', acquisitionIds: ['purchase-acquisition'], settlementIds: ['purchase-settlement'], evidence: 'fixture-result-proof', outcome: { kind: 'purchase', quoteId: 'quote' } };
  },
  async inquire(actual) { record('inquiries'); localStorage.setItem(`${mode}-last-inquiry`, JSON.stringify(actual)); return mode === 'pending' ? listing('filled') : drawResult; },
}, verifier: { async verify(actual, response) { if (JSON.stringify(actual) !== JSON.stringify(request) || response.status === 'outcome_unknown' || response.evidence !== 'fixture-result-proof') throw new Error('invalid fixture evidence'); return response; } } }, journal);
const configuration: Extract<OfficialOperationPanelProps, { request: OfficialRequest }>['configuration'] = { kind: 'configured', operations,
  previewProvider: { async preview(actual) { if (JSON.stringify(actual) !== JSON.stringify(request)) throw new Error('fixture request mismatch'); return preview; } },
  previewVerifier: { async verify(_actual, value) { return mode === 'invalid-preview' ? { ...value, previewId: 'tampered' } : value; } },
};
function Fixture() {
  const [connected, setConnected] = useState(false); const [open, setOpen] = useState(true); const [filter, setFilter] = useState('');
  return <main><label>Caller search <input value={filter} onChange={event => setFilter(event.target.value)}/></label>
    <button type="button" onClick={() => { setConnected(true); setOpen(true); }}>Connect fixture authority</button>
    {!open && <button type="button" onClick={() => setOpen(true)}>Open operation</button>}
    {open && (connected ? <OfficialOperationPanel configuration={configuration} request={request} onReturn={() => setOpen(false)}/> : <OfficialOperationPanel configuration={{ kind: 'not-configured' }}/>)}</main>;
}
createRoot(document.getElementById('official-operation-root')!).render(<Fixture />);
