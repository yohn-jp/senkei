import { expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { HeroRepository, heroOwnershipAuthority } from './repository';
import { OwnedRelationshipRepository } from './relationships';
import { OwnedAssetsRecovery } from './recovery';
const names = () => ({heroes: crypto.randomUUID(), equipment: crypto.randomUUID(), relationships: crypto.randomUUID()});
it('recovers after a failed write and a new coordinator resumes the durable journal', async () => {
  const sourceNames = names(); const targetNames = names(); const db = crypto.randomUUID(); const hero = new HeroRepository(indexedDB, sourceNames.heroes);
  await hero.obtainTrialRoster({requestId:'r',playerId:'p',catalog:{id:'c',version:'1',digest:'d',heroes:[{id:'a'}]}});
  const source = new OwnedAssetsRecovery('p', [], indexedDB, crypto.randomUUID(), sourceNames); const archive = await source.export();
  const { IDBObjectStore } = await import('fake-indexeddb'); const original = IDBObjectStore.prototype.put; let failed = false;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) { if (!failed && this.transaction.db.name === targetNames.equipment) { failed = true; throw new Error('injected'); } return original.apply(this,args); };
  const target = new OwnedAssetsRecovery('p', [], indexedDB, db, targetNames);
  try { await expect(target.begin(archive)).rejects.toThrow(); } finally { IDBObjectStore.prototype.put = original; }
  expect(failed).toBe(true);
  const reopened = new OwnedAssetsRecovery('p', [], indexedDB, db, targetNames); await reopened.resume(); expect(await reopened.export()).toEqual(archive);
  await expect(reopened.begin({...archive, playerId:'other'})).rejects.toThrow('mismatch');
});

it('keeps the original pending archive exportable after a concurrent relationship write', async () => {
  const sourceNames = names(), targetNames = names(), journalName = crypto.randomUUID();
  const sourceHero = new HeroRepository(indexedDB, sourceNames.heroes);
  const owned = await sourceHero.obtainTrialRoster({ requestId: 'r-two', playerId: 'p', catalog: {
    id: 'c', version: '1', digest: 'd', heroes: [{ id: 'a' }, { id: 'b' }],
  } });
  const [from, to] = owned.map(item => item.instanceId);
  const owner = heroOwnershipAuthority(await sourceHero.snapshot('p'));
  const sourceRelations = new OwnedRelationshipRepository('p', owner.ownsHero, indexedDB, sourceNames.relationships);
  expect((await sourceRelations.applyEvent({ eventId: 'imported', source: 'authoritative', from, to,
    definitionVersion: '1', value: 1, tags: [], history: 'original' })).ok).toBe(true);
  const archive = await new OwnedAssetsRecovery('p', [], indexedDB, crypto.randomUUID(), sourceNames).export();
  const original = OwnedRelationshipRepository.prototype.importArchive;
  let calls = 0;
  OwnedRelationshipRepository.prototype.importArchive = async function (raw: string) {
    if (++calls === 2) {
      const competing = await this.applyEvent({ eventId: 'concurrent', source: 'authoritative', from, to,
        definitionVersion: '1', value: 2, tags: [], history: 'other tab' });
      expect(competing.ok).toBe(true);
    }
    return original.call(this, raw);
  };
  try {
    await expect(new OwnedAssetsRecovery('p', [], indexedDB, journalName, targetNames).begin(archive))
      .rejects.toThrow('Conflicting relationship archive');
  } finally { OwnedRelationshipRepository.prototype.importArchive = original; }
  expect(calls).toBe(2);
  const reopened = new OwnedAssetsRecovery('p', [], indexedDB, journalName, targetNames);
  expect(await reopened.pendingArchive()).toEqual(archive);
  await expect(reopened.resume()).rejects.toThrow('Conflicting relationship archive');
  expect(await reopened.pendingArchive()).toEqual(archive);
  expect(await reopened.abandonPending()).toBe(true);
  expect(await reopened.pendingArchive()).toBeNull();
  const current = await reopened.export();
  expect(current.heroes).toEqual(archive.heroes);
  expect(current.relationships.events.map(event => event.eventId)).toEqual(['concurrent']);
});
