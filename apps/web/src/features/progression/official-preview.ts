import { canonicalJson } from '../../worker/input-identity';
import { validateOfficialRequest, type OfficialPolicyRef, type OfficialRequest } from './official-service';

/** Amount text is interpreted by the authority's versioned format, never calculated here. */
export interface PreviewAmount { readonly value: string; readonly format: OfficialPolicyRef }
export type OptionalPreviewAmount = { readonly kind: 'provided'; readonly amount: PreviewAmount } | { readonly kind: 'not_provided' };
export type OptionalPreviewText = { readonly kind: 'provided'; readonly value: string } | { readonly kind: 'not_provided' };
export interface PreviewCounterparty { readonly kind: 'player' | 'market_maker'; readonly id: string | null }
interface PreviewMarketTerms { readonly itemId: string; readonly quoteId: string; readonly counterparty: PreviewCounterparty; readonly quantity: PreviewAmount; readonly price: PreviewAmount; readonly fees: OptionalPreviewAmount; readonly total: PreviewAmount; readonly expiration: OptionalPreviewText; readonly conditions: readonly string[] }
export type OfficialPreviewTerms =
  | { readonly kind: 'draw'; readonly entitlementId: string; readonly poolId: string; readonly items: readonly { readonly itemId: string; readonly probability: OptionalPreviewAmount }[]; readonly guarantee: OptionalPreviewText; readonly conditions: readonly string[] }
  | (PreviewMarketTerms & { readonly kind: 'player_listing' | 'purchase' })
  | (PreviewMarketTerms & { readonly kind: 'market_maker_buyback'; readonly minimumGuarantee: OptionalPreviewAmount })
  | { readonly kind: 'cancel'; readonly orderId: string; readonly conditions: readonly string[] };
export interface OfficialOperationPreview {
  readonly schemaVersion: 1;
  readonly schema: OfficialPolicyRef;
  readonly previewId: string;
  readonly request: OfficialRequest;
  readonly terms: OfficialPreviewTerms;
  readonly evidence: string;
}
export interface OfficialOperationPreviewProvider { preview(request: OfficialRequest): Promise<OfficialOperationPreview> }
export interface OfficialOperationPreviewVerifier {
  /** Authenticate the complete request, versioned policy, terms and authority evidence. */
  verify(request: OfficialRequest, preview: OfficialOperationPreview): Promise<OfficialOperationPreview>;
}
const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value;
function shape(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) throw new Error('Invalid preview shape');
}
function reference(value: unknown): void { shape(value, ['id', 'version', 'digest']); if (![value.id, value.version, value.digest].every(valid)) throw new Error('Invalid preview version'); }
function amount(value: unknown): void { shape(value, ['value', 'format']); if (!valid(value.value)) throw new Error('Invalid preview amount'); reference(value.format); }
function optionalAmount(value: unknown): void {
  const kind = (value as { kind?: unknown } | null)?.kind;
  shape(value, kind === 'provided' ? ['kind', 'amount'] : ['kind']);
  if (value.kind === 'provided') amount(value.amount); else if (value.kind !== 'not_provided') throw new Error('Invalid optional amount');
}
function optionalText(value: unknown): void {
  const kind = (value as { kind?: unknown } | null)?.kind;
  shape(value, kind === 'provided' ? ['kind', 'value'] : ['kind']);
  if (value.kind === 'provided') { if (!valid(value.value)) throw new Error('Invalid preview text'); }
  else if (value.kind !== 'not_provided') throw new Error('Invalid optional text');
}
function conditions(value: unknown): void { if (!Array.isArray(value) || !value.every(valid)) throw new Error('Invalid preview conditions'); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
export function validateOfficialPreview(request: OfficialRequest, preview: OfficialOperationPreview): void {
  validateOfficialRequest(request);
  shape(preview, ['schemaVersion', 'schema', 'previewId', 'request', 'terms', 'evidence']);
  if (preview.schemaVersion !== 1 || !valid(preview.previewId) || !valid(preview.evidence)) throw new Error('Invalid preview evidence');
  reference(preview.schema);
  validateOfficialRequest(preview.request as OfficialRequest);
  if (canonicalJson(preview.request) !== canonicalJson(request)) throw new Error('Preview request mismatch');
  const terms = preview.terms as OfficialPreviewTerms; const action = request.action;
  if (!terms || terms.kind !== action.kind) throw new Error('Preview action mismatch');
  switch (terms.kind) {
    case 'draw': {
      shape(terms, ['kind', 'entitlementId', 'poolId', 'items', 'guarantee', 'conditions']);
      if (action.kind !== 'draw' || terms.entitlementId !== action.entitlementId || terms.poolId !== action.poolId || !Array.isArray(terms.items)) throw new Error('Preview draw mismatch');
      const seen = new Set<string>();
      for (const item of terms.items) { shape(item, ['itemId', 'probability']); if (!valid(item.itemId) || seen.has(item.itemId)) throw new Error('Invalid pool item'); seen.add(item.itemId); optionalAmount(item.probability); }
      optionalText(terms.guarantee); conditions(terms.conditions); break;
    }
    case 'player_listing': case 'market_maker_buyback': case 'purchase': {
      shape(terms, ['kind', 'itemId', 'quoteId', 'counterparty', 'quantity', 'price', 'fees', 'total', 'expiration', 'conditions', ...(terms.kind === 'market_maker_buyback' ? ['minimumGuarantee'] : [])]);
      if (!valid(terms.itemId) || !valid(terms.quoteId) || (action.kind !== 'player_listing' && action.kind !== 'market_maker_buyback' && action.kind !== 'purchase') || terms.quoteId !== action.quoteId || (action.kind !== 'purchase' && terms.itemId !== action.itemId)) throw new Error('Preview quote mismatch');
      shape(terms.counterparty, ['kind', 'id']);
      if ((terms.counterparty.kind !== 'player' && terms.counterparty.kind !== 'market_maker') || (terms.counterparty.id !== null && !valid(terms.counterparty.id)) || (terms.counterparty.kind === 'market_maker' && !valid(terms.counterparty.id)) || (terms.kind === 'player_listing' && terms.counterparty.kind !== 'player') || (terms.kind === 'market_maker_buyback' && terms.counterparty.kind !== 'market_maker')) throw new Error('Preview counterparty mismatch');
      amount(terms.quantity); amount(terms.price); optionalAmount(terms.fees); amount(terms.total); optionalText(terms.expiration); conditions(terms.conditions);
      if (terms.kind === 'market_maker_buyback') optionalAmount(terms.minimumGuarantee); break;
    }
    case 'cancel':
      shape(terms, ['kind', 'orderId', 'conditions']);
      if (action.kind !== 'cancel' || terms.orderId !== action.orderId) throw new Error('Preview order mismatch');
      conditions(terms.conditions); break;
  }
}

/** Provider content is shown only after the host verifier binds the complete request and terms. */
export async function readVerifiedOperationPreview(requestInput: OfficialRequest, provider: OfficialOperationPreviewProvider, verifier: OfficialOperationPreviewVerifier): Promise<OfficialOperationPreview> {
  const request = freeze(structuredClone(requestInput)); validateOfficialRequest(request);
  const preview = freeze(structuredClone(await provider.preview(structuredClone(request))));
  validateOfficialPreview(request, preview);
  const verifiedRequest = structuredClone(request);
  const verified = await verifier.verify(verifiedRequest, structuredClone(preview));
  if (canonicalJson(verifiedRequest) !== canonicalJson(request) || canonicalJson(verified) !== canonicalJson(preview)) throw new Error('Preview evidence claims mismatch');
  return preview;
}
