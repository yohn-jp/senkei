/** A reference to an actual versioned Next catalog, not a squad slot or entity. */
export interface HeroCatalog { id: string; version: string; digest: string; heroes: readonly { id: string }[] }
export interface HeroInstance { instanceId: string; playerId: string; authority: "local"; definition: { id: string; version: string; digest: string; catalogId: string } }
interface Issuance { requestId: string; playerId: string; payload: string; instanceIds: string[] }
export interface HeroBundle { schemaVersion: 1; playerId: string; instances: HeroInstance[]; issuances: Issuance[] }
interface State { schemaVersion: 1; instances: HeroInstance[]; issuances: Issuance[] }
export interface HeroOwnershipSnapshot { readonly playerId: string; readonly heroes: readonly HeroInstance[] }
/** Build an immutable authority from a serializable snapshot. */
export function heroOwnershipAuthority(snapshot: HeroOwnershipSnapshot): { ownsHero(playerId: string, heroId: string): boolean } {
  const playerId = snapshot.playerId; const ids = new Set(snapshot.heroes.filter(h => h.playerId === playerId && h.authority === "local").map(h => h.instanceId));
  return Object.freeze({ ownsHero: (owner: string, id: string) => owner === playerId && ids.has(id) });
}
const valid = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
const clone = <T>(v: T): T => structuredClone(v);
const empty = (): State => ({ schemaVersion: 1, instances: [], issuances: [] });
export class HeroError extends Error {
  constructor(readonly code: 'invalid_data' | 'conflict' | 'storage' | 'unavailable', message: string) { super(message); }
}
function validate(s: State): void {
  if (!s || s.schemaVersion !== 1 || !Array.isArray(s.instances) || !Array.isArray(s.issuances)) throw new HeroError('invalid_data', 'Unsupported Hero schema');
  const ids = new Set<string>(); const requests = new Set<string>();
  for (const i of s.instances) {
    if (!i || !valid(i.instanceId) || !valid(i.playerId) || i.authority !== 'local' || !i.definition || ![i.definition.id, i.definition.version, i.definition.digest, i.definition.catalogId].every(valid) || ids.has(i.instanceId)) throw new HeroError('invalid_data', 'Invalid Hero instance');
    ids.add(i.instanceId);
  }
  for (const r of s.issuances) {
    if (!r || !valid(r.requestId) || !valid(r.playerId) || !valid(r.payload) || !Array.isArray(r.instanceIds) || !r.instanceIds.every(valid) || new Set(r.instanceIds).size !== r.instanceIds.length || requests.has(r.requestId)) throw new HeroError('invalid_data', 'Invalid Hero issuance');
    requests.add(r.requestId);
    let payload: unknown;
    try { payload = JSON.parse(r.payload); } catch { throw new HeroError('invalid_data', 'Invalid issuance payload'); }
    if (!Array.isArray(payload) || payload.length !== 4 || !payload.slice(0, 3).every(valid) || !Array.isArray(payload[3]) || !payload[3].every(valid) || new Set(payload[3]).size !== payload[3].length || payload[3].length !== r.instanceIds.length) throw new HeroError('invalid_data', 'Invalid issuance payload');
    r.instanceIds.forEach((id, index) => {
      const i = s.instances.find(item => item.instanceId === id);
      if (!i || i.playerId !== r.playerId || i.definition.catalogId !== payload[0] || i.definition.version !== payload[1] || i.definition.digest !== payload[2] || i.definition.id !== payload[3][index]) throw new HeroError('invalid_data', 'Issuance does not match Hero');
    });
  }
  if (s.instances.some(i => s.issuances.filter(r => r.instanceIds.includes(i.instanceId)).length !== 1)) throw new HeroError('invalid_data', 'Hero has no unique issuance');
}
export class HeroRepository {
  constructor(private readonly factory: IDBFactory = indexedDB, private readonly name = 'senkei-heroes') {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = this.factory.open(this.name, 1); let blocked = false;
      req.onupgradeneeded = () => { req.result.createObjectStore('state'); };
      req.onblocked = () => { blocked = true; reject(new HeroError('unavailable', 'Hero storage upgrade blocked')); };
      req.onerror = () => reject(new HeroError('storage', 'Cannot open Hero storage'));
      req.onsuccess = () => { if (blocked) req.result.close(); else resolve(req.result); };
    });
  }
  private async transaction<T>(write: boolean, fn: (s: State) => T): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', write ? 'readwrite' : 'readonly'); const store = tx.objectStore('state'); const get = store.get('all'); let result: T; let failure: unknown;
      get.onsuccess = () => { try { const state = (get.result ?? empty()) as State; validate(state); result = fn(state); if (write) { validate(state); store.put(state, 'all'); } } catch (error) { failure = error; tx.abort(); } };
      tx.oncomplete = () => { db.close(); resolve(clone(result)); };
      tx.onabort = tx.onerror = () => { db.close(); reject(failure ?? new HeroError('storage', 'Hero transaction failed')); };
    });
  }
  async obtainTrialRoster(input: { requestId: string; playerId: string; catalog: HeroCatalog }): Promise<HeroInstance[]> {
    input = clone(input); const c = input.catalog;
    if (!valid(input.requestId) || !valid(input.playerId) || !c || ![c.id, c.version, c.digest].every(valid) || !Array.isArray(c.heroes) || !c.heroes.length || !c.heroes.every(h => h && valid(h.id)) || new Set(c.heroes.map(h => h.id)).size !== c.heroes.length) throw new HeroError('invalid_data', 'Invalid catalog or request');
    const payload = JSON.stringify([c.id, c.version, c.digest, c.heroes.map(h => h.id)]);
    return this.transaction(true, s => {
      const prior = s.issuances.find(r => r.requestId === input.requestId);
      if (prior) { if (prior.playerId !== input.playerId || prior.payload !== payload) throw new HeroError('conflict', 'Conflicting request retry'); return prior.instanceIds.map(id => s.instances.find(i => i.instanceId === id)!); }
      const instances = c.heroes.map(h => ({ instanceId: crypto.randomUUID(), playerId: input.playerId, authority: 'local' as const, definition: { id: h.id, version: c.version, digest: c.digest, catalogId: c.id } }));
      if (instances.some(i => s.instances.some(existing => existing.instanceId === i.instanceId)) || new Set(instances.map(i => i.instanceId)).size !== instances.length) throw new HeroError('conflict', 'Hero identity collision');
      s.instances.push(...instances); s.issuances.push({ requestId: input.requestId, playerId: input.playerId, payload, instanceIds: instances.map(i => i.instanceId) }); return instances;
    });
  }
  async list(playerId: string): Promise<HeroInstance[]> { if (!valid(playerId)) throw new HeroError('invalid_data', 'Player required'); return this.transaction(false, s => s.instances.filter(i => i.playerId === playerId)); }
  async snapshot(playerId: string): Promise<HeroOwnershipSnapshot> {
    const heroes = await this.list(playerId);
    heroes.forEach(h => { Object.freeze(h.definition); Object.freeze(h); }); Object.freeze(heroes);
    return Object.freeze({ playerId, heroes });
  }
  async export(playerId: string): Promise<HeroBundle> { if (!valid(playerId)) throw new HeroError('invalid_data', 'Player required'); return this.transaction(false, s => ({ schemaVersion: 1, playerId, instances: s.instances.filter(i => i.playerId === playerId), issuances: s.issuances.filter(r => r.playerId === playerId) })); }
  async import(playerId: string, input: unknown): Promise<void> {
    const bundle = clone(input) as HeroBundle;
    if (!valid(playerId) || !bundle || bundle.playerId !== playerId) throw new HeroError('invalid_data', 'Player mismatch');
    validate(bundle);
    if (bundle.instances.some(i => i.playerId !== playerId) || bundle.issuances.some(r => r.playerId !== playerId)) throw new HeroError('invalid_data', 'Player mismatch');
    await this.transaction(true, s => {
      for (const i of bundle.instances) { const existing = s.instances.find(x => x.instanceId === i.instanceId); if (existing && JSON.stringify(existing) !== JSON.stringify(i)) throw new HeroError('conflict', 'Conflicting Hero'); if (!existing) s.instances.push(i); }
      for (const r of bundle.issuances) { const existing = s.issuances.find(x => x.requestId === r.requestId); if (existing && JSON.stringify(existing) !== JSON.stringify(r)) throw new HeroError('conflict', 'Conflicting issuance'); if (!existing) s.issuances.push(r); }
    });
  }
}
