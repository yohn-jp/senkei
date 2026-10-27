import { createRelationshipRepository, type HeroOwnershipResolver, type RelationshipArchive, type RelationshipEvent, type Result } from '../relationships/repository';
/** Serializes relationship writes across tabs with IndexedDB read/write transactions. */
export class OwnedRelationshipRepository {
  constructor(private readonly playerId: string, private readonly owns: HeroOwnershipResolver, private readonly factory: IDBFactory = indexedDB, private readonly name = 'senkei-owned-relationships') {}
  private async transact<T>(write: boolean, action: (repo: ReturnType<typeof createRelationshipRepository>) => T): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = this.factory.open(this.name, 1); let blocked = false;
      r.onupgradeneeded = () => r.result.createObjectStore('players');
      r.onblocked = () => { blocked = true; reject(new Error('Relationship storage blocked')); };
      r.onerror = () => reject(new Error('Relationship storage unavailable'));
      r.onsuccess = () => { if (blocked) r.result.close(); else resolve(r.result); };
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('players', write ? 'readwrite' : 'readonly'); const store = tx.objectStore('players'); const get = store.get(this.playerId); let result: T; let failure: unknown;
      get.onsuccess = () => { try {
        let raw: string | null = get.result ?? null;
        const repo = createRelationshipRepository({ getItem: () => raw, setItem: (_key, value) => { raw = value; } }, this.playerId, this.owns);
        result = action(repo); if (write && raw !== (get.result ?? null)) store.put(raw, this.playerId);
      } catch (e) { failure = e; tx.abort(); } };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(failure ?? new Error('Relationship transaction failed')); };
    });
  }
  read(): Promise<Result<RelationshipArchive>> { return this.transact(false, r => r.read()); }
  applyEvent(event: RelationshipEvent): Promise<Result<RelationshipArchive>> { const snapshot = structuredClone(event); return this.transact(true, r => r.applyEvent(snapshot)); }
  importArchive(raw: string): Promise<Result<RelationshipArchive>> { return this.transact(true, r => r.importArchive(raw)); }
}
