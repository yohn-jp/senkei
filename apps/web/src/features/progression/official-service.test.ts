import { indexedDB } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { OfficialTransactionEvidenceStore, type OfficialResponse } from './official-transactions';
import { OfficialOperations, type OfficialRequest } from './official-service';

const identity = { operationId: 'operation', requestId: 'request', playerId: 'player', authorityId: 'authority' };
const request: OfficialRequest = { ...identity, policy: { id: 'policy', version: 'version', digest: 'digest' }, action: { kind: 'draw', entitlementId: 'right', poolId: 'pool' } };
const committed: OfficialResponse = { ...identity, status: 'committed', resultId: 'result', acquisitionIds: ['acquisition'], settlementIds: ['settlement'], evidence: 'proof' };
const store = () => new OfficialTransactionEvidenceStore(indexedDB, `official-test-${Math.random()}`);

describe('official operation recovery', () => {
  it('reports an absent producer without writing or fabricating an outcome', async () => {
    const evidence = store();
    const service = new OfficialOperations({ kind: 'not-configured' }, evidence);
    expect(await service.submit(request)).toEqual({ kind: 'unavailable' });
    expect(await evidence.get(identity.requestId)).toBeUndefined();
  });
  it('journals before submission and recovers a lost result by inquiry, never a second draw', async () => {
    const evidence = store();
    const submit = vi.fn(async () => { expect((await evidence.get(identity.requestId))?.status).toBe('submitted'); throw new Error('connection lost'); });
    const inquire = vi.fn(async () => committed);
    const verifier = { verify: async (response: OfficialResponse) => response };
    const service = new OfficialOperations({ kind: 'configured', adapter: { submit, inquire }, verifier }, evidence);
    expect((await service.submit(request))).toMatchObject({ kind: 'recorded', transaction: { status: 'outcome_unknown' } });
    await expect(service.submit(request)).rejects.toThrow();
    expect((await service.inquire(identity))).toMatchObject({ kind: 'recorded', transaction: { status: 'committed', resultId: 'result' } });
    expect((await service.inquire(identity))).toMatchObject({ kind: 'recorded', transaction: { status: 'committed' } });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(inquire).toHaveBeenCalledTimes(1);
    expect(inquire).toHaveBeenCalledWith(identity);
  });
  it('does not accept unverified authority claims or a different request identity', async () => {
    const evidence = store();
    const verifier = { verify: async () => { throw new Error('untrusted'); } };
    const service = new OfficialOperations({ kind: 'configured', adapter: { submit: async () => committed, inquire: async () => committed }, verifier }, evidence);
    await expect(service.submit(request)).rejects.toThrow('untrusted');
    expect((await evidence.get(identity.requestId))?.status).toBe('submitted');
    await expect(service.inquire({ ...identity, playerId: 'other' })).rejects.toThrow('identity mismatch');
  });
});
