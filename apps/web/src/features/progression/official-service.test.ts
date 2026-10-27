import { indexedDB } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { OfficialOperationJournal } from './official-journal';
import { OfficialOperations, type OfficialRequest, type OfficialServiceResponse, type OfficialServiceTransaction } from './official-service';

const identity = { operationId: 'operation', requestId: 'request', playerId: 'player', authorityId: 'authority' };
const request: OfficialRequest = { ...identity, policy: { id: 'policy', version: 'version', digest: 'digest' }, action: { kind: 'draw', entitlementId: 'right', poolId: 'pool' } };
const committed: OfficialServiceResponse = { ...identity, status: 'committed', resultId: 'result', acquisitionIds: ['acquisition'], settlementIds: ['settlement'], evidence: 'proof', outcome: { kind: 'draw', entitlementId: 'right', poolId: 'pool' } };
const journal = () => new OfficialOperationJournal<OfficialRequest, OfficialServiceTransaction>(indexedDB, `official-test-${Math.random()}`);

describe('official operation recovery', () => {
  it('reports an absent producer without writing or fabricating an outcome', async () => {
    const evidence = journal();
    const service = new OfficialOperations({ kind: 'not-configured' }, evidence);
    expect(await service.submit(request)).toEqual({ kind: 'unavailable' });
    expect(await evidence.getRaw(identity.requestId)).toBeUndefined();
  });
  it('journals the full request before submission and recovers a lost result by inquiry, never a second draw', async () => {
    const evidence = journal();
    const submit = vi.fn(async () => { expect(await evidence.getRaw(identity.requestId)).toMatchObject({ request, transaction: { status: 'submitted' } }); throw new Error('connection lost'); });
    const inquire = vi.fn(async () => committed);
    const verify = vi.fn(async (_request: OfficialRequest, response: OfficialServiceResponse) => response);
    const service = new OfficialOperations({ kind: 'configured', adapter: { submit, inquire }, verifier: { verify } }, evidence);
    expect(await service.submit(request)).toMatchObject({ kind: 'recorded', transaction: { status: 'outcome_unknown' } });
    await expect(service.submit(request)).rejects.toThrow();
    expect(await service.inquire(identity)).toMatchObject({ kind: 'recorded', transaction: { status: 'committed', resultId: 'result' } });
    expect(await service.inquire(identity)).toMatchObject({ kind: 'recorded', transaction: { status: 'committed' } });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(inquire).toHaveBeenCalledTimes(1);
    expect(inquire).toHaveBeenCalledWith(identity);
    expect(verify).toHaveBeenCalledWith(request, committed);
    expect(verify).toHaveBeenCalledTimes(2);
  });
  it('does not accept unverified claims, changed outcome or another identity', async () => {
    const evidence = journal();
    const verifier = { verify: async () => { throw new Error('untrusted'); } };
    const service = new OfficialOperations({ kind: 'configured', adapter: { submit: async () => committed, inquire: async () => committed }, verifier }, evidence);
    await expect(service.submit(request)).rejects.toThrow('untrusted');
    expect(await evidence.getRaw(identity.requestId)).toMatchObject({ transaction: { status: 'submitted' } });
    await expect(service.inquire({ ...identity, playerId: 'other' })).rejects.toThrow('identity mismatch');
    const other = journal();
    const mismatch = { ...committed, outcome: { kind: 'draw' as const, entitlementId: 'right', poolId: 'other' } };
    const wrong = new OfficialOperations({ kind: 'configured', adapter: { submit: async () => mismatch, inquire: async () => mismatch }, verifier: { verify: async (_req, response) => response } }, other);
    await expect(wrong.submit(request)).rejects.toThrow('Draw outcome mismatch');
  });
  it('keeps a listed order distinct from a filled sale and verifies every outcome', async () => {
    const listing: OfficialRequest = { ...request, action: { kind: 'player_listing', itemId: 'item', quoteId: 'quote' } };
    const listed: OfficialServiceResponse = { ...identity, status: 'committed', resultId: 'listing-result', acquisitionIds: [], settlementIds: [], evidence: 'listing-proof', outcome: { kind: 'player_listing', itemId: 'item', quoteId: 'quote', orderId: 'order', state: 'listed' } };
    const evidence = journal();
    const service = new OfficialOperations({ kind: 'configured', adapter: { submit: async () => listed, inquire: async () => listed }, verifier: { verify: async (_req, response) => response } }, evidence);
    expect(await service.submit(listing)).toMatchObject({ transaction: { outcome: { state: 'listed' }, settlementIds: [] } });
    const invalid = { ...listed, outcome: { ...listed.outcome, state: 'filled' as const } };
    const other = new OfficialOperations({ kind: 'configured', adapter: { submit: async () => invalid, inquire: async () => invalid }, verifier: { verify: async (_req, response) => response } }, journal());
    await expect(other.submit(listing)).rejects.toThrow('Listing outcome mismatch');
  });
  it('preserves unsupported journal bytes instead of resetting or resubmitting', async () => {
    const evidence = journal();
    const raw = { schemaVersion: 99, request, transaction: { ...identity, status: 'submitted' as const } };
    await evidence.begin(raw as never);
    const submit = vi.fn(async () => committed);
    const service = new OfficialOperations({ kind: 'configured', adapter: { submit, inquire: async () => committed }, verifier: { verify: async (_req, response) => response } }, evidence);
    await expect(service.inquire(identity)).rejects.toThrow('original data preserved');
    expect(await evidence.getRaw(identity.requestId)).toEqual(raw);
    expect(submit).not.toHaveBeenCalled();
  });
  it('authenticates the stored request again when recovering a terminal result', async () => {
    const name = `official-tamper-${Math.random()}`;
    const evidence = new OfficialOperationJournal<OfficialRequest, OfficialServiceTransaction>(indexedDB, name);
    const verifier = { verify: async (actual: OfficialRequest, response: OfficialServiceResponse) => {
      if (actual.action.kind !== 'draw' || actual.action.poolId !== 'pool') throw new Error('evidence does not bind this request');
      return response;
    } };
    const service = new OfficialOperations({ kind: 'configured', adapter: { submit: async () => committed, inquire: async () => committed }, verifier }, evidence);
    await service.submit(request);
    const tampered = { schemaVersion: 1, request: { ...request, action: { kind: 'draw', entitlementId: 'right', poolId: 'other' } }, transaction: { ...committed, outcome: { kind: 'draw', entitlementId: 'right', poolId: 'other' } } };
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open(name); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('operations', 'readwrite'); tx.objectStore('operations').put(tampered); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
    await expect(service.inquire(identity)).rejects.toThrow('evidence does not bind this request');
    expect(await evidence.getRaw(identity.requestId)).toEqual(tampered);
  });
});
