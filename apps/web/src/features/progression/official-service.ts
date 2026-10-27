import {
  applyOfficialResponse, createOfficialTransaction, inquiryFor,
  type OfficialIdentity, type OfficialResponse, type OfficialTransaction,
} from './official-transactions';
import { OfficialOperationJournal, type OfficialJournalRecord } from './official-journal';

/** References supplied by the authority; no local price, probability or eligibility is implied. */
export interface OfficialPolicyRef { readonly id: string; readonly version: string; readonly digest: string }
export type OfficialAction =
  | { readonly kind: 'draw'; readonly entitlementId: string; readonly poolId: string }
  | { readonly kind: 'player_listing' | 'market_maker_buyback'; readonly itemId: string; readonly quoteId: string }
  | { readonly kind: 'purchase'; readonly quoteId: string }
  | { readonly kind: 'cancel'; readonly orderId: string };
export interface OfficialRequest extends OfficialIdentity { readonly policy: OfficialPolicyRef; readonly action: OfficialAction }
export type OfficialOutcome =
  | { readonly kind: 'draw'; readonly entitlementId: string; readonly poolId: string }
  | { readonly kind: 'player_listing'; readonly itemId: string; readonly quoteId: string; readonly orderId: string; readonly state: 'listed' | 'filled' }
  | { readonly kind: 'market_maker_buyback'; readonly itemId: string; readonly quoteId: string }
  | { readonly kind: 'purchase'; readonly quoteId: string }
  | { readonly kind: 'cancel'; readonly orderId: string };
export type OfficialServiceResponse =
  | (OfficialIdentity & { readonly status: 'outcome_unknown' })
  | (OfficialIdentity & { readonly status: 'pending'; readonly evidence: string; readonly progress?: { readonly kind: 'player_listing'; readonly orderId: string; readonly state: 'awaiting_buyer' } })
  | (OfficialIdentity & { readonly status: 'rejected'; readonly evidence: string; readonly reason: { readonly code: 'quote_changed' | 'insufficient_balance' | 'denied' | 'other' } })
  | (Extract<OfficialResponse, { status: 'committed' }> & { readonly outcome: OfficialOutcome });
export type OfficialServiceTransaction = Extract<OfficialTransaction, { status: 'submitted' }> | OfficialServiceResponse;

/** The service owns authorization, quotation, idempotent settlement and its evidence. */
export interface OfficialServiceAdapter {
  submit(request: OfficialRequest): Promise<OfficialServiceResponse>;
  inquire(identity: OfficialIdentity): Promise<OfficialServiceResponse>;
}
/** A verifier must authenticate evidence binding the entire request and all response claims. */
export interface OfficialOperationVerifier {
  verify(request: OfficialRequest, response: OfficialServiceResponse): Promise<OfficialServiceResponse>;
}
export type OfficialServiceConfiguration =
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'configured'; readonly adapter: OfficialServiceAdapter; readonly verifier: OfficialOperationVerifier };
export type OfficialOperationResult = { readonly kind: 'unavailable' } | { readonly kind: 'recorded'; readonly request: OfficialRequest; readonly transaction: OfficialServiceTransaction };
type RecordValue = OfficialJournalRecord<OfficialRequest, OfficialServiceTransaction>;
function submitted(identity: OfficialIdentity): Extract<OfficialTransaction, { status: 'submitted' }> {
  const value = createOfficialTransaction(identity);
  if (value.status !== 'submitted') throw new Error('Invalid initial transaction');
  return value;
}
const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value;
const keysAre = (value: unknown, expected: readonly string[]) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const sameIdentity = (a: OfficialIdentity, b: OfficialIdentity) => a.operationId === b.operationId && a.requestId === b.requestId && a.playerId === b.playerId && a.authorityId === b.authorityId;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function validateOfficialRequest(request: OfficialRequest): void {
  if (!keysAre(request, ['operationId', 'requestId', 'playerId', 'authorityId', 'policy', 'action'])) throw new Error('Invalid official request');
  createOfficialTransaction(request);
  if (!keysAre(request.policy, ['id', 'version', 'digest']) || ![request.policy.id, request.policy.version, request.policy.digest].every(valid) || !request.action) throw new Error('Versioned official policy and action are required');
  const action = request.action;
  switch (action.kind) {
    case 'draw': if (!keysAre(action, ['kind', 'entitlementId', 'poolId']) || ![action.entitlementId, action.poolId].every(valid)) throw new Error('Draw entitlement and pool are required'); break;
    case 'player_listing': case 'market_maker_buyback': if (!keysAre(action, ['kind', 'itemId', 'quoteId']) || ![action.itemId, action.quoteId].every(valid)) throw new Error('Equipment and quote are required'); break;
    case 'purchase': if (!keysAre(action, ['kind', 'quoteId']) || !valid(action.quoteId)) throw new Error('Quote is required'); break;
    case 'cancel': if (!keysAre(action, ['kind', 'orderId']) || !valid(action.orderId)) throw new Error('Order is required'); break;
    default: throw new Error('Unsupported official action');
  }
}
export function validateOfficialServiceResponse(request: OfficialRequest, response: OfficialServiceResponse): void {
  validateOfficialRequest(request);
  if (!response || !sameIdentity(request, response)) throw new Error('Official response identity mismatch');
  if (response.status !== 'outcome_unknown' && !valid(response.evidence)) throw new Error('Invalid response evidence');
  if (response.status === 'committed') {
    if (!valid(response.resultId) || !Array.isArray(response.acquisitionIds) || !response.acquisitionIds.every(valid) || !Array.isArray(response.settlementIds) || !response.settlementIds.every(valid)) throw new Error('Invalid commit identities');
    const identities = [response.resultId, ...response.acquisitionIds, ...response.settlementIds];
    if (new Set(identities).size !== identities.length) throw new Error('Result, acquisition and settlement identities must be distinct');
  }
  const base = ['operationId', 'requestId', 'playerId', 'authorityId', 'status'];
  switch (response.status) {
    case 'outcome_unknown': if (!keysAre(response, base)) throw new Error('Invalid unknown outcome'); return;
    case 'pending': {
      if (!keysAre(response, [...base, 'evidence', ...(response.progress ? ['progress'] : [])])) throw new Error('Invalid pending response');
      if (response.progress && (!keysAre(response.progress, ['kind', 'orderId', 'state']) || request.action.kind !== 'player_listing' || response.progress.kind !== 'player_listing' || response.progress.state !== 'awaiting_buyer' || !valid(response.progress.orderId))) throw new Error('Invalid listing progress');
      return;
    }
    case 'rejected':
      if (!keysAre(response, [...base, 'evidence', 'reason']) || !keysAre(response.reason, ['code']) || !['quote_changed', 'insufficient_balance', 'denied', 'other'].includes(response.reason.code)) throw new Error('Invalid rejection');
      return;
    case 'committed': {
      if (!keysAre(response, [...base, 'evidence', 'resultId', 'acquisitionIds', 'settlementIds', 'outcome'])) throw new Error('Invalid committed response');
      const action = request.action; const outcome = response.outcome;
      if (!outcome || outcome.kind !== action.kind) throw new Error('Official outcome action mismatch');
      switch (outcome.kind) {
        case 'draw': if (action.kind !== 'draw' || !keysAre(outcome, ['kind', 'entitlementId', 'poolId']) || outcome.entitlementId !== action.entitlementId || outcome.poolId !== action.poolId) throw new Error('Draw outcome mismatch'); break;
        case 'player_listing': if (action.kind !== 'player_listing' || !keysAre(outcome, ['kind', 'itemId', 'quoteId', 'orderId', 'state']) || outcome.itemId !== action.itemId || outcome.quoteId !== action.quoteId || !valid(outcome.orderId) || !['listed', 'filled'].includes(outcome.state) || (outcome.state === 'filled' && (!Array.isArray(response.settlementIds) || response.settlementIds.length === 0))) throw new Error('Listing outcome mismatch'); break;
        case 'market_maker_buyback': if (action.kind !== 'market_maker_buyback' || !keysAre(outcome, ['kind', 'itemId', 'quoteId']) || outcome.itemId !== action.itemId || outcome.quoteId !== action.quoteId || !Array.isArray(response.settlementIds) || response.settlementIds.length === 0) throw new Error('Buyback outcome mismatch'); break;
        case 'purchase': if (action.kind !== 'purchase' || !keysAre(outcome, ['kind', 'quoteId']) || outcome.quoteId !== action.quoteId || !Array.isArray(response.settlementIds) || response.settlementIds.length === 0) throw new Error('Purchase outcome mismatch'); break;
        case 'cancel': if (action.kind !== 'cancel' || !keysAre(outcome, ['kind', 'orderId']) || outcome.orderId !== action.orderId) throw new Error('Cancellation outcome mismatch'); break;
      }
      return;
    }
    default: throw new Error('Invalid official response status');
  }
}

/** Journal before transport; on recovery authenticate the full stored request and inquire, never resubmit. */
export class OfficialOperations {
  constructor(
    private readonly configuration: OfficialServiceConfiguration = { kind: 'not-configured' },
    private readonly journal?: OfficialOperationJournal<OfficialRequest, OfficialServiceTransaction>,
  ) {}
  private async accept(request: OfficialRequest, current: OfficialServiceTransaction, responseInput: OfficialServiceResponse): Promise<OfficialServiceResponse> {
    if (this.configuration.kind !== 'configured') throw new Error('Official service not configured');
    const response = structuredClone(responseInput);
    validateOfficialServiceResponse(request, response);
    if ((current.status === 'committed' || current.status === 'rejected') && canonical(current) !== canonical(response)) throw new Error('Conflicting terminal response');
    const verifier = this.configuration.verifier;
    await applyOfficialResponse(current, response, { verify: async () => {
      const requested = structuredClone(request);
      const verified = await verifier.verify(requested, structuredClone(response));
      if (canonical(requested) !== canonical(request)) throw new Error('Evidence request mismatch');
      if (canonical(verified) !== canonical(response)) throw new Error('Evidence claims mismatch');
      return verified;
    } });
    return response;
  }
  async submit(requestInput: OfficialRequest): Promise<OfficialOperationResult> {
    const request = structuredClone(requestInput); validateOfficialRequest(request);
    if (this.configuration.kind === 'not-configured') return { kind: 'unavailable' };
    const journal = this.journal ?? new OfficialOperationJournal<OfficialRequest, OfficialServiceTransaction>();
    const initial = submitted(request);
    const record: RecordValue = { schemaVersion: 1, request, transaction: initial };
    await journal.begin(record);
    let response: OfficialServiceResponse;
    try { response = await this.configuration.adapter.submit(structuredClone(request)); }
    catch { response = { ...initial, status: 'outcome_unknown' }; }
    const transaction = await this.accept(request, initial, response);
    await journal.replace(record, { ...record, transaction });
    return { kind: 'recorded', request, transaction };
  }
  async inquire(identityInput: OfficialIdentity): Promise<OfficialOperationResult> {
    const identity = structuredClone(identityInput); createOfficialTransaction(identity);
    if (this.configuration.kind === 'not-configured') return { kind: 'unavailable' };
    const journal = this.journal ?? new OfficialOperationJournal<OfficialRequest, OfficialServiceTransaction>();
    const raw = await journal.getRaw(identity.requestId);
    if (!raw) throw new Error('Request has not been recorded');
    if (!keysAre(raw, ['schemaVersion', 'request', 'transaction']) || (raw as RecordValue).schemaVersion !== 1) throw new Error('Unsupported official journal record; original data preserved');
    let record = structuredClone(raw as RecordValue);
    validateOfficialRequest(record.request);
    if (!sameIdentity(identity, record.request) || !record.transaction || !sameIdentity(record.request, record.transaction)) throw new Error('Official request identity mismatch');
    const initial = submitted(record.request);
    if (record.transaction.status !== 'submitted') {
      const verified = await this.accept(record.request, initial, record.transaction);
      if (verified.status === 'committed' || verified.status === 'rejected') return { kind: 'recorded', request: record.request, transaction: verified };
    } else {
      if (canonical(record.transaction) !== canonical(initial)) throw new Error('Invalid submitted journal record');
      const unknown = await this.accept(record.request, initial, { ...identity, status: 'outcome_unknown' });
      const next = { ...record, transaction: unknown }; await journal.replace(record, next); record = next;
    }
    let response: OfficialServiceResponse;
    try { response = await this.configuration.adapter.inquire(inquiryFor(record.transaction)); }
    catch { response = { ...identity, status: 'outcome_unknown' }; }
    const transaction = await this.accept(record.request, record.transaction, response);
    await journal.replace(record, { ...record, transaction });
    return { kind: 'recorded', request: record.request, transaction };
  }
}
