import {
  applyOfficialResponse, createOfficialTransaction, inquiryFor,
  type OfficialEvidenceVerifier, type OfficialIdentity, type OfficialResponse,
  type OfficialTransaction, OfficialTransactionEvidenceStore,
} from './official-transactions';

/** References supplied by the authority; no local price, probability or eligibility is implied. */
export interface OfficialPolicyRef { readonly id: string; readonly version: string; readonly digest: string }
export type OfficialAction =
  | { readonly kind: 'draw'; readonly entitlementId: string; readonly poolId: string }
  | { readonly kind: 'player_listing' | 'market_maker_buyback'; readonly itemId: string; readonly quoteId: string }
  | { readonly kind: 'purchase'; readonly quoteId: string }
  | { readonly kind: 'cancel'; readonly orderId: string };
export interface OfficialRequest extends OfficialIdentity { readonly policy: OfficialPolicyRef; readonly action: OfficialAction }

/** The service owns authorization, quotation, idempotent settlement and its evidence. */
export interface OfficialServiceAdapter {
  submit(request: OfficialRequest): Promise<OfficialResponse>;
  inquire(identity: OfficialIdentity): Promise<OfficialResponse>;
}
export type OfficialServiceConfiguration =
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'configured'; readonly adapter: OfficialServiceAdapter; readonly verifier: OfficialEvidenceVerifier };
export type OfficialOperationResult = { readonly kind: 'unavailable' } | { readonly kind: 'recorded'; readonly transaction: OfficialTransaction };
const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value;
function checkRequest(request: OfficialRequest): void {
  createOfficialTransaction(request);
  if (!request.policy || ![request.policy.id, request.policy.version, request.policy.digest].every(valid) || !request.action) throw new Error('Versioned official policy and action are required');
  const action = request.action;
  switch (action.kind) {
    case 'draw': if (![action.entitlementId, action.poolId].every(valid)) throw new Error('Draw entitlement and pool are required'); break;
    case 'player_listing': case 'market_maker_buyback': if (![action.itemId, action.quoteId].every(valid)) throw new Error('Equipment and quote are required'); break;
    case 'purchase': if (!valid(action.quoteId)) throw new Error('Quote is required'); break;
    case 'cancel': if (!valid(action.orderId)) throw new Error('Order is required'); break;
    default: throw new Error('Unsupported official action');
  }
}

/**
 * Durable client-side evidence and retry boundary. The authority remains the only
 * issuer and settler. A request is journaled before transport; any later recovery
 * inquires the same identity and never submits it again. The cache is untrusted.
 */
export class OfficialOperations {
  constructor(
    private readonly configuration: OfficialServiceConfiguration = { kind: 'not-configured' },
    private readonly evidence?: OfficialTransactionEvidenceStore,
  ) {}

  async submit(requestInput: OfficialRequest): Promise<OfficialOperationResult> {
    const request = structuredClone(requestInput);
    checkRequest(request);
    if (this.configuration.kind === 'not-configured') return { kind: 'unavailable' };
    const evidence = this.evidence ?? new OfficialTransactionEvidenceStore();
    const initial = createOfficialTransaction(request);
    // Compare-and-set is also the single-submission gate across tabs and retries.
    await evidence.put(initial);
    let response: OfficialResponse;
    try { response = await this.configuration.adapter.submit(request); }
    catch { response = { ...initial, status: 'outcome_unknown' }; }
    const next = await applyOfficialResponse(initial, structuredClone(response), this.configuration.verifier);
    await evidence.put(next, initial);
    return { kind: 'recorded', transaction: next };
  }

  async inquire(identityInput: OfficialIdentity): Promise<OfficialOperationResult> {
    const identity = structuredClone(identityInput);
    createOfficialTransaction(identity);
    if (this.configuration.kind === 'not-configured') return { kind: 'unavailable' };
    const evidence = this.evidence ?? new OfficialTransactionEvidenceStore();
    let current = await evidence.get(identity.requestId);
    if (!current) throw new Error('Request has not been recorded');
    if (current.operationId !== identity.operationId || current.playerId !== identity.playerId || current.authorityId !== identity.authorityId || current.requestId !== identity.requestId) throw new Error('Official request identity mismatch');
    // Re-verify evidence on every read; IndexedDB alone establishes no authority.
    if (current.status !== 'submitted') current = await applyOfficialResponse(current, current, this.configuration.verifier);
    if (current.status === 'committed' || current.status === 'rejected') return { kind: 'recorded', transaction: current };
    if (current.status === 'submitted') {
      const unknown = await applyOfficialResponse(current, { ...identity, status: 'outcome_unknown' });
      await evidence.put(unknown, current);
      current = unknown;
    }
    let response: OfficialResponse;
    try { response = await this.configuration.adapter.inquire(inquiryFor(current)); }
    catch { response = { ...identity, status: 'outcome_unknown' }; }
    const next = await applyOfficialResponse(current, structuredClone(response), this.configuration.verifier);
    await evidence.put(next, current);
    return { kind: 'recorded', transaction: next };
  }
}
