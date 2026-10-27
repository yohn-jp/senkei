/** References are opaque: only a separately approved, versioned definition may be used. */
export interface EquipmentDefinitionRef { id: string; version: string; digest: string; effectRef: string }
export interface EquipmentInstance { instanceId: string; playerId: string; definition: EquipmentDefinitionRef; authority: "local"; heroId: string | null }
export interface EquipmentBundle { schemaVersion: 1; playerId: string; instances: EquipmentInstance[]; requests: RequestRecord[] }
export interface RequestRecord { requestId: string; playerId: string; operation: string; payload: string }
export interface GrantRequest { requestId: string; playerId: string; instanceId: string; definition: EquipmentDefinitionRef }
/** Synchronous immutable ownership snapshot supplied by an authorized Hero producer. */
export interface HeroOwnershipAuthority { ownsHero(playerId: string, heroId: string): boolean }
export interface EquipRequest { requestId: string; playerId: string; instanceId: string; heroId: string }
export interface UnequipRequest { requestId: string; playerId: string; instanceId: string }
interface State { schemaVersion: 1; instances: EquipmentInstance[]; requests: RequestRecord[] }
const empty = (): State => ({ schemaVersion: 1, instances: [], requests: [] });
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const defValid = (d: EquipmentDefinitionRef) => d && [d.id, d.version, d.digest, d.effectRef].every(nonempty);
const sameDef = (a: EquipmentDefinitionRef, b: EquipmentDefinitionRef) => a.id === b.id && a.version === b.version && a.digest === b.digest && a.effectRef === b.effectRef;
const clone = <T>(v: T): T => structuredClone(v);

export class EquipmentError extends Error {
  constructor(readonly code: "invalid_data" | "conflict" | "not_found" | "unavailable" | "storage", message: string) { super(message); }
}

/** Local trial assets only. Hero ownership and official grants require future authority contracts. */
export class EquipmentRepository {
  private readonly approved: EquipmentDefinitionRef[];
  constructor(private readonly factory: IDBFactory = indexedDB, private readonly name = "senkei-equipment", approved: readonly EquipmentDefinitionRef[] = [], private readonly heroAuthority?: HeroOwnershipAuthority) {
    if (!approved.every(defValid)) throw new EquipmentError("invalid_data", "Invalid approved definition");
    this.approved = clone([...approved]);
  }
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      let blocked = false;
      request.onblocked = () => { blocked = true; reject(new EquipmentError("unavailable", "Equipment storage upgrade is blocked")); };
      request.onupgradeneeded = () => { request.result.createObjectStore("state"); };
      request.onerror = () => reject(new EquipmentError("storage", "Could not open equipment storage"));
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    });
  }
  private validate(state: State): void {
    if (!state || state.schemaVersion !== 1 || !Array.isArray(state.instances) || !Array.isArray(state.requests)) throw new EquipmentError("invalid_data", "Unsupported equipment schema");
    const ids = new Set<string>(); const reqs = new Set<string>();
    for (const i of state.instances) {
      if (!i || !nonempty(i.instanceId) || !nonempty(i.playerId) || i.authority !== "local" || (i.heroId !== null && !nonempty(i.heroId)) || !defValid(i.definition) || ids.has(i.instanceId)) throw new EquipmentError("invalid_data", "Invalid equipment instance");
      ids.add(i.instanceId);
    }
    for (const r of state.requests) {
      if (!r || ![r.requestId, r.playerId, r.operation, r.payload].every(nonempty) || reqs.has(r.requestId)) throw new EquipmentError("invalid_data", "Invalid request record");
      reqs.add(r.requestId);
    }
  }
  private async transaction<T>(write: boolean, fn: (state: State) => T): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("state", write ? "readwrite" : "readonly"); const store = tx.objectStore("state"); const get = store.get("all");
      let result: T; let failure: unknown;
      get.onsuccess = () => { try { const state = (get.result ?? empty()) as State; this.validate(state); result = fn(state); if (write) store.put(state, "all"); } catch (error) { failure = error; tx.abort(); } };
      tx.oncomplete = () => { db.close(); resolve(clone(result)); };
      tx.onabort = tx.onerror = () => { db.close(); reject(failure ?? new EquipmentError("storage", "Equipment transaction failed")); };
    });
  }
  private request(state: State, requestId: string, playerId: string, operation: string, payload: string): boolean {
    if (![requestId, playerId].every(nonempty)) throw new EquipmentError("invalid_data", "Request and player identity are required");
    const prior = state.requests.find(r => r.requestId === requestId);
    if (prior) { if (prior.playerId !== playerId || prior.operation !== operation || prior.payload !== payload) throw new EquipmentError("conflict", "Conflicting request retry"); return false; }
    state.requests.push({ requestId, playerId, operation, payload }); return true;
  }
  async list(playerId: string): Promise<EquipmentInstance[]> {
    if (!nonempty(playerId)) throw new EquipmentError("invalid_data", "Player identity is required");
    return this.transaction(false, s => s.instances.filter(i => i.playerId === playerId));
  }
  async grant(input: GrantRequest): Promise<void> {
    input = clone(input);
    if (!nonempty(input.instanceId) || !defValid(input.definition) || !this.approved.some(d => sameDef(d, input.definition))) throw new EquipmentError("invalid_data", "Definition is not approved");
    await this.transaction(true, s => {
      const payload = JSON.stringify([input.instanceId, input.definition.id, input.definition.version, input.definition.digest, input.definition.effectRef]);
      if (!this.request(s, input.requestId, input.playerId, "grant", payload)) return;
      if (s.instances.some(i => i.instanceId === input.instanceId)) throw new EquipmentError("conflict", "Instance ID already exists");
      s.instances.push({ instanceId: input.instanceId, playerId: input.playerId, definition: clone(input.definition), authority: "local", heroId: null });
    });
  }
  async equip(input: EquipRequest): Promise<void> {
    input = clone(input);
    if (!this.heroAuthority) throw new EquipmentError("unavailable", "Hero ownership authority is unavailable");
    await this.transaction(true, s => {
      if (!nonempty(input.instanceId) || !nonempty(input.heroId)) throw new EquipmentError("invalid_data", "Instance and Hero identity are required");
      if (!this.heroAuthority!.ownsHero(input.playerId, input.heroId)) throw new EquipmentError("not_found", "Owned Hero not found");
      if (!this.request(s, input.requestId, input.playerId, "equip", JSON.stringify([input.instanceId, input.heroId]))) return;
      const item = s.instances.find(i => i.instanceId === input.instanceId && i.playerId === input.playerId);
      if (!item) throw new EquipmentError("not_found", "Owned instance not found");
      item.heroId = input.heroId;
    });
  }
  async unequip(input: UnequipRequest): Promise<void> {
    input = clone(input);
    await this.transaction(true, s => {
      if (!nonempty(input.instanceId)) throw new EquipmentError("invalid_data", "Instance identity is required");
      if (!this.request(s, input.requestId, input.playerId, "unequip", JSON.stringify([input.instanceId]))) return;
      const item = s.instances.find(i => i.instanceId === input.instanceId && i.playerId === input.playerId);
      if (!item) throw new EquipmentError("not_found", "Owned instance not found");
      item.heroId = null;
    });
  }
  async export(playerId: string): Promise<EquipmentBundle> {
    if (!nonempty(playerId)) throw new EquipmentError("invalid_data", "Player identity is required");
    return this.transaction(false, s => ({ schemaVersion: 1, playerId, instances: s.instances.filter(i => i.playerId === playerId), requests: s.requests.filter(r => r.playerId === playerId) }));
  }
  async import(playerId: string, input: unknown): Promise<void> {
    const bundle = clone(input) as EquipmentBundle;
    if (!nonempty(playerId) || !bundle || bundle.playerId !== playerId) throw new EquipmentError("invalid_data", "Player identity mismatch");
    this.validate(bundle);
    if (bundle.instances.some(i => i.playerId !== playerId || (i.heroId !== null && (!this.heroAuthority || !this.heroAuthority.ownsHero(playerId, i.heroId))) || !this.approved.some(d => sameDef(d, i.definition))) || bundle.requests.some(r => r.playerId !== playerId)) throw new EquipmentError("invalid_data", "Unapproved recovery data");
    for (const request of bundle.requests) {
      let equipPayload: unknown;
      try { equipPayload = JSON.parse(request.payload); } catch { /* invalid payload */ }
      const valid = bundle.instances.some(i => i.playerId === request.playerId && (
        (request.operation === "equip" && Array.isArray(equipPayload) && equipPayload.length === 2 && equipPayload[0] === i.instanceId && nonempty(equipPayload[1]) && !!this.heroAuthority?.ownsHero(playerId, equipPayload[1])) ||
        (request.operation === "grant" && request.payload === JSON.stringify([i.instanceId, i.definition.id, i.definition.version, i.definition.digest, i.definition.effectRef])) ||
        (request.operation === "unequip" && request.payload === JSON.stringify([i.instanceId]))
      ));
      if (!valid) throw new EquipmentError("invalid_data", "Recovery request has no corresponding instance");
    }
    await this.transaction(true, s => {
      for (const incoming of bundle.instances) {
        const current = s.instances.find(i => i.instanceId === incoming.instanceId);
        if (current && (current.playerId !== incoming.playerId || current.heroId !== incoming.heroId || current.authority !== incoming.authority || !sameDef(current.definition, incoming.definition))) throw new EquipmentError("conflict", "Conflicting recovered instance");
        if (!current) s.instances.push(clone(incoming));
      }
      for (const incoming of bundle.requests) {
        const current = s.requests.find(r => r.requestId === incoming.requestId);
        if (current && (current.playerId !== incoming.playerId || current.operation !== incoming.operation || current.payload !== incoming.payload)) throw new EquipmentError("conflict", "Conflicting recovered request");
        if (!current) s.requests.push(clone(incoming));
      }
    });
  }
}
