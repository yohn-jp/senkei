import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OfficialOperationPanel } from './OfficialOperationPanel';
import { readVerifiedOperationPreview, type OfficialOperationPreview } from './official-preview';
import type { OfficialRequest } from './official-service';

const policy = { id: 'policy', version: '1', digest: 'digest' };
const draw: OfficialRequest = { operationId: 'op', requestId: 'req', playerId: 'player', authorityId: 'authority', policy, action: { kind: 'draw', entitlementId: 'right', poolId: 'pool' } };
const offer: OfficialOperationPreview = { schemaVersion: 1, schema: policy, previewId: 'preview', request: draw, evidence: 'proof', terms: { kind: 'draw', entitlementId: 'right', poolId: 'pool', items: [{ itemId: 'blade', probability: { kind: 'not_provided' } }], guarantee: { kind: 'not_provided' }, conditions: [] } };

describe('official operation preview boundary', () => {
  it('shows unavailable without a fabricated account, value or inactive operation', () => {
    const html = renderToStaticMarkup(createElement(OfficialOperationPanel, { configuration: { kind: 'not-configured' } }));
    expect(html).toContain('The official service is not configured');
    expect(html).not.toContain('<button'); expect(html).not.toContain('Confirm');
  });
  it('requires a verifier and authenticates the entire request and terms', async () => {
    const verifier = vi.fn(async (_request: OfficialRequest, preview: OfficialOperationPreview) => preview);
    const result = await readVerifiedOperationPreview(draw, { preview: async () => offer }, { verify: verifier });
    expect(verifier).toHaveBeenCalledWith(draw, offer);
    expect(result.terms).toEqual(offer.terms); expect(Object.isFrozen(result.terms)).toBe(true);
    const changed = structuredClone(offer); (changed.request as { policy: typeof policy }).policy = { ...policy, version: 'other' };
    await expect(readVerifiedOperationPreview(draw, { preview: async () => changed }, { verify: verifier })).rejects.toThrow('Preview request mismatch');
    await expect(readVerifiedOperationPreview(draw, { preview: async () => offer }, { verify: async (_request, preview) => ({ ...preview, previewId: 'other' }) })).rejects.toThrow('claims mismatch');
    await expect(readVerifiedOperationPreview(draw, { preview: async () => offer }, { verify: async (request, preview) => { (request.policy as { version: string }).version = 'other'; return preview; } })).rejects.toThrow('claims mismatch');
  });
  it('rejects a quote for another item, price authority or market counterparty', async () => {
    const request: OfficialRequest = { ...draw, action: { kind: 'market_maker_buyback', itemId: 'item', quoteId: 'quote' } };
    const money = { value: '12', format: policy };
    const preview: OfficialOperationPreview = { ...offer, request, terms: { kind: 'market_maker_buyback', itemId: 'item', quoteId: 'quote', counterparty: { kind: 'market_maker', id: 'maker' }, quantity: money, price: money, fees: { kind: 'not_provided' }, total: money, expiration: { kind: 'provided', value: 'provider expiry' }, minimumGuarantee: { kind: 'provided', amount: money }, conditions: ['provider condition'] } };
    const verify = { verify: async (_request: OfficialRequest, value: OfficialOperationPreview) => value };
    await expect(readVerifiedOperationPreview(request, { preview: async () => preview }, verify)).resolves.toEqual(preview);
    await expect(readVerifiedOperationPreview(request, { preview: async () => ({ ...preview, terms: { ...preview.terms, itemId: 'other' } as typeof preview.terms }) }, verify)).rejects.toThrow();
    await expect(readVerifiedOperationPreview(request, { preview: async () => ({ ...preview, terms: { ...preview.terms, counterparty: { kind: 'player', id: null } } as typeof preview.terms }) }, verify)).rejects.toThrow();
  });
});
