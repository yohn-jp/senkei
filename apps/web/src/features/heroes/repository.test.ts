import { describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { HeroRepository, heroOwnershipAuthority } from './repository';
import { EquipmentRepository } from '../equipment/repository';
import { createRelationshipRepository } from '../relationships/repository';
const catalog = { id: 'rules', version: '1.0.0', digest: 'digest', heroes: [{ id: 'a' }, { id: 'b' }] };
const repo = () => new HeroRepository(indexedDB, crypto.randomUUID());
describe('local Hero ownership', () => {
  it('issues durable individual identities, retries safely, and enforces ownership in consumers', async () => {
    const heroes = repo(); const input = { requestId: 'request', playerId: 'player', catalog };
    const roster = await heroes.obtainTrialRoster(input);
    expect(roster.map(h => h.definition.id)).toEqual(['a', 'b']);
    expect(roster[0].instanceId).not.toBe('a');
    expect(await heroes.obtainTrialRoster(input)).toEqual(roster);
    await expect(heroes.obtainTrialRoster({ ...input, playerId: 'other' })).rejects.toMatchObject({ code: 'conflict' });
    const snapshot = await heroes.snapshot('player'); const authority = heroOwnershipAuthority(snapshot);
    expect(JSON.parse(JSON.stringify(snapshot)).heroes).toEqual(roster);
    expect(authority.ownsHero('other', roster[0].instanceId)).toBe(false);
    const definition = { id: 'item', version: '1', digest: 'd', effectRef: 'approved' };
    const equipment = new EquipmentRepository(indexedDB, crypto.randomUUID(), [definition], authority);
    await equipment.grant({ requestId: 'grant', playerId: 'player', instanceId: 'item', definition });
    await equipment.equip({ requestId: 'equip', playerId: 'player', instanceId: 'item', heroId: roster[0].instanceId });
    await expect(equipment.equip({ requestId: 'bad', playerId: 'player', instanceId: 'item', heroId: 'a' })).rejects.toMatchObject({ code: 'not_found' });
    const data = new Map<string,string>(); const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string,v: string) => { data.set(k,v); } };
    const rel = createRelationshipRepository(storage, 'player', authority.ownsHero);
    expect(rel.applyEvent({ eventId: 'e', source: 'authoritative', from: roster[0].instanceId, to: roster[1].instanceId, definitionVersion: 'test', value: null, tags: [], history: 'trial' }).ok).toBe(true);
  });
  it('recovers atomically and rejects foreign or official records', async () => {
    const source = repo(); await source.obtainTrialRoster({ requestId: 'r', playerId: 'p', catalog });
    const bundle = await source.export('p'); const destination = repo(); await destination.import('p', bundle);
    expect(await destination.export('p')).toEqual(bundle);
    const bad = structuredClone(bundle); bad.instances[0].authority = 'official' as 'local';
    await expect(destination.import('p', bad)).rejects.toMatchObject({ code: 'invalid_data' });
    await expect(destination.import('other', bundle)).rejects.toMatchObject({ code: 'invalid_data' });
    expect(await destination.export('p')).toEqual(bundle);
  });
});
