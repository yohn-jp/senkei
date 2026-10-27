import { expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { HeroRepository } from './repository';
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
