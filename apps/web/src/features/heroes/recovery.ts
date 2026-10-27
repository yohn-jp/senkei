import { HeroRepository, type HeroBundle } from './repository';
import { EquipmentRepository, type EquipmentBundle, type EquipmentDefinitionRef } from '../equipment/repository';
import { OwnedRelationshipRepository } from './relationships';
import type { RelationshipArchive } from '../relationships/repository';
import { heroOwnershipAuthority } from './repository';

export interface OwnedAssetsArchive { schemaVersion: 1; playerId: string; heroes: HeroBundle; equipment: EquipmentBundle; relationships: RelationshipArchive }
type Journal = { archive: OwnedAssetsArchive; stage: 0 | 1 | 2 | 3; paused?: boolean };
export interface RecoveryEvidence {
  schemaVersion: 1; playerId: string; status: 'active' | 'paused';
  /** An unmodified copy of the requested archive. Never use it as a server authority. */
  original: OwnedAssetsArchive;
  /** A best-effort snapshot of the current stores; separate IndexedDB databases cannot be read atomically. */
  current: OwnedAssetsArchive;
}
/** Recovery is a durable, resumable sequence. Consumers must call resume before reading. */
export class OwnedAssetsRecovery {
  constructor(private readonly playerId: string, private readonly approved: readonly EquipmentDefinitionRef[], private readonly factory: IDBFactory = indexedDB, private readonly dbName = 'senkei-owned-recovery', private readonly names = { heroes: 'senkei-heroes', equipment: 'senkei-equipment', relationships: 'senkei-owned-relationships' }) {}
  private async journal<T>(write: boolean, fn: (current: Journal | undefined) => { value: T; next?: Journal | null }): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = this.factory.open(this.dbName, 1); let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore('journals'); request.onerror = () => reject(new Error('Recovery storage unavailable')); request.onblocked = () => { blocked = true; reject(new Error('Recovery storage blocked')); }; request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); }; });
    return new Promise((resolve, reject) => { const tx = db.transaction('journals', write ? 'readwrite' : 'readonly'); const store = tx.objectStore('journals'); const get = store.get(this.playerId); let value: T; let failure: unknown;
      get.onsuccess = () => { try { const result = fn(get.result as Journal | undefined); value = result.value; if (write && result.next !== undefined) { if (result.next === null) store.delete(this.playerId); else store.put(result.next, this.playerId); } } catch (e) { failure = e; tx.abort(); } };
      tx.oncomplete = () => { db.close(); resolve(value); }; tx.onabort = tx.onerror = () => { db.close(); reject(failure ?? new Error('Recovery journal failed')); };
    });
  }
  async begin(input: unknown): Promise<void> {
    const archive = structuredClone(input) as OwnedAssetsArchive;
    if (!archive || archive.schemaVersion !== 1 || archive.playerId !== this.playerId || archive.heroes?.playerId !== this.playerId || archive.equipment?.playerId !== this.playerId || archive.relationships?.playerId !== this.playerId) throw new Error('Invalid archive or player mismatch');
    // Verify the entire archive against isolated stores before creating the durable intent.
    const suffix = crypto.randomUUID(); const temp = { heroes: `recovery-check-hero-${suffix}`, equipment: `recovery-check-equipment-${suffix}`, relationships: `recovery-check-relations-${suffix}` };
    try { const current = await this.export(); await this.apply(current, temp); await this.apply(archive, temp); } finally { for (const name of Object.values(temp)) this.factory.deleteDatabase(name); }
    await this.journal(true, current => { if (current && JSON.stringify(current.archive) !== JSON.stringify(archive)) throw new Error('Another recovery is pending'); return { value: undefined, next: { archive, stage: 0, paused: false } }; });
    await this.resume();
  }
  private async apply(archive: OwnedAssetsArchive, names: typeof this.names): Promise<void> {
    const heroes = new HeroRepository(this.factory, names.heroes); await heroes.import(this.playerId, archive.heroes);
    const authority = heroOwnershipAuthority(await heroes.snapshot(this.playerId));
    await new EquipmentRepository(this.factory, names.equipment, this.approved, authority).import(this.playerId, archive.equipment);
    const relations = new OwnedRelationshipRepository(this.playerId, authority.ownsHero, this.factory, names.relationships);
    if (!archive.relationships.events.length) { const current = await relations.read(); if (!current.ok || current.value.events.length) throw new Error('Conflicting relationship archive'); return; }
    const result = await relations.importArchive(JSON.stringify(archive.relationships));
    if (!result.ok) { if (result.reason !== 'store-not-empty') throw new Error(result.reason); const current = await relations.read(); if (!current.ok || JSON.stringify(current.value) !== JSON.stringify(archive.relationships)) throw new Error('Conflicting relationship archive'); }
  }
  /** The original archive is never deleted merely because a restore was paused. */
  async pendingRecovery(): Promise<{ archive: OwnedAssetsArchive; paused: boolean } | null> {
    return this.journal(false, current => ({ value: current
      ? { archive: structuredClone(current.archive), paused: current.paused === true } : null }));
  }
  async pendingArchive(): Promise<OwnedAssetsArchive | null> { return (await this.pendingRecovery())?.archive ?? null; }
  /** Suspend automatic retries. The durable original survives this action and page reloads. */
  async abandonPending(): Promise<boolean> {
    return this.journal(true, current => ({ value: Boolean(current), next: current ? { ...current, paused: true } : undefined }));
  }
  /** Capture both sides of a conflicted restore without invoking resume again. */
  async exportRecoveryEvidence(): Promise<RecoveryEvidence | null> {
    const pending = await this.pendingRecovery();
    if (!pending) return null;
    return { schemaVersion: 1, playerId: this.playerId, status: pending.paused ? 'paused' : 'active',
      original: pending.archive, current: await this.readCurrent() };
  }
  async resume(): Promise<void> {
    const pending = await this.journal(false, current => ({ value: current })); if (!pending || pending.paused) return;
    // Reapplying each completed step is intentional: imports are idempotent and preserve originals.
    await this.apply(pending.archive, this.names);
    await this.journal(true, current => { if (!current) return { value: undefined }; if (JSON.stringify(current.archive) === JSON.stringify(pending.archive)) return { value: undefined, next: null }; throw new Error('Recovery journal changed'); });
  }
  async export(): Promise<OwnedAssetsArchive> {
    await this.resume(); return this.readCurrent();
  }
  private async readCurrent(): Promise<OwnedAssetsArchive> {
    const heroes = new HeroRepository(this.factory, this.names.heroes); const heroBundle = await heroes.export(this.playerId); const authority = heroOwnershipAuthority(await heroes.snapshot(this.playerId));
    const equipment = await new EquipmentRepository(this.factory, this.names.equipment, this.approved, authority).export(this.playerId);
    const relations = await new OwnedRelationshipRepository(this.playerId, authority.ownsHero, this.factory, this.names.relationships).read(); if (!relations.ok) throw new Error(relations.reason);
    return { schemaVersion: 1, playerId: this.playerId, heroes: heroBundle, equipment, relationships: relations.value };
  }
}
