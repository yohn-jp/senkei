import type { OfficialIdentity } from './official-transactions';

/** Local records are untrusted evidence; existing evidence databases are never migrated or overwritten. */
export interface OfficialJournalRecord<R extends OfficialIdentity, T> {
  readonly schemaVersion: 1;
  readonly request: R;
  readonly transaction: T;
}
export class OfficialOperationJournal<R extends OfficialIdentity, T> {
  constructor(private readonly factory: IDBFactory = indexedDB, private readonly name = 'senkei-official-operation-journal') {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1); let blocked = false;
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('operations', { keyPath: 'request.requestId' });
        store.createIndex('operationId', 'request.operationId', { unique: true });
      };
      request.onblocked = () => { blocked = true; reject(new Error('Official journal blocked')); };
      request.onerror = () => reject(request.error ?? new Error('Official journal unavailable'));
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    });
  }
  /** Raw access preserves malformed/unsupported records for inspection and recovery. */
  async getRaw(requestId: string): Promise<unknown> {
    if (typeof requestId !== 'string' || !requestId.trim()) throw new Error('Invalid request identity');
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readonly'); const request = tx.objectStore('operations').get(requestId);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error); tx.oncomplete = () => db.close();
    });
  }
  /** `add` is the cross-tab gate: a request or operation ID can be submitted once. */
  async begin(record: OfficialJournalRecord<R, T>): Promise<void> {
    const snapshot = structuredClone(record); const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readwrite'); tx.objectStore('operations').add(snapshot);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Official request already recorded')); };
    });
  }
  async replace(expected: OfficialJournalRecord<R, T>, next: OfficialJournalRecord<R, T>): Promise<void> {
    const before = structuredClone(expected); const after = structuredClone(next);
    if (JSON.stringify(before.request) !== JSON.stringify(after.request)) throw new Error('Official request cannot be changed');
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readwrite'); const store = tx.objectStore('operations'); const get = store.get(before.request.requestId);
      let conflict = false;
      get.onsuccess = () => {
        if (JSON.stringify(get.result) !== JSON.stringify(before)) { conflict = true; tx.abort(); return; }
        store.put(after);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(conflict ? new Error('Official journal conflict') : tx.error ?? new Error('Official journal write failed')); };
    });
  }
}
