import { beforeEach, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";
import { EquipmentRepository } from "./repository";

const definition = { id: "sword", version: "1", digest: "sha256:abc", effectRef: "effect:1" };
let repo: EquipmentRepository;
beforeEach(() => { repo = new EquipmentRepository(indexedDB, `test-${crypto.randomUUID()}`, [definition]); });
it("persists individual instances, makes retries idempotent, and rejects conflicts without changing state", async () => {
  const first = { requestId: "r1", playerId: "p", instanceId: "i1", definition };
  await repo.grant(first);
  await repo.grant(first);
  await repo.grant({ ...first, requestId: "r2", instanceId: "i2" });
  await expect(repo.grant({ ...first, instanceId: "other" })).rejects.toThrow();
  await expect(repo.equip({ requestId: "e1", playerId: "p", instanceId: "i1", heroId: "h" })).rejects.toThrow("Hero ownership");
  await expect(repo.equip({ requestId: "e2", playerId: "other", instanceId: "i1", heroId: "h" })).rejects.toThrow();
  expect(await repo.list("p")).toEqual([expect.objectContaining({ instanceId: "i1", heroId: null }), expect.objectContaining({ instanceId: "i2", heroId: null })]);
});
it("rejects malformed or official recovery data without changing stored data", async () => {
  await repo.grant({ requestId: "r", playerId: "p", instanceId: "i", definition });
  const original = await repo.export("p");
  await expect(repo.import("p", { ...original, schemaVersion: 99 })).rejects.toThrow();
  await expect(repo.import("p", { ...original, instances: [{ ...original.instances[0], authority: "official" }] })).rejects.toThrow();
  expect(await repo.export("p")).toEqual(original);
});
it("merges recovery without removing newer assets and rejects conflicting instance data", async () => {
  await repo.grant({ requestId: "r1", playerId: "p", instanceId: "i1", definition });
  const backup = await repo.export("p");
  await repo.grant({ requestId: "r2", playerId: "p", instanceId: "i2", definition });
  await repo.import("p", backup);
  expect((await repo.list("p")).map(i => i.instanceId)).toEqual(["i1", "i2"]);
  const conflicting = { ...backup, instances: [{ ...backup.instances[0], definition: { ...definition, digest: "wrong" } }] };
  await expect(repo.import("p", conflicting)).rejects.toThrow();
  expect((await repo.list("p")).length).toBe(2);
});
it("aborts a failed write without persisting the request or asset", async () => {
  await repo.grant({ requestId: "r1", playerId: "p", instanceId: "i1", definition });
  const before = await repo.export("p");
  const { IDBObjectStore } = await import("fake-indexeddb");
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new Error("quota failure"); };
  try { await expect(repo.grant({ requestId: "r2", playerId: "p", instanceId: "i2", definition })).rejects.toThrow("quota failure"); }
  finally { IDBObjectStore.prototype.put = original; }
  expect(await repo.export("p")).toEqual(before);
  await repo.grant({ requestId: "r2", playerId: "p", instanceId: "i2", definition });
});
it("leaves a newer stored schema intact and refuses to overwrite it", async () => {
  const name = `bad-${crypto.randomUUID()}`;
  const bad = new EquipmentRepository(indexedDB, name, [definition]);
  await bad.list("p");
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const stored = { schemaVersion: 99, instances: [], requests: [], future: "keep" };
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("state", "readwrite"); tx.objectStore("state").put(stored, "all"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  await expect(bad.grant({ requestId: "r", playerId: "p", instanceId: "i", definition })).rejects.toThrow("schema");
  const after = await new Promise<unknown>((resolve, reject) => { const tx = db.transaction("state"); const req = tx.objectStore("state").get("all"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  expect(after).toEqual(stored); db.close();
});
it("rejects forged request history that would make a grant appear successful without an instance", async () => {
  const forged = { schemaVersion: 1, playerId: "p", instances: [], requests: [{ requestId: "r", playerId: "p", operation: "grant", payload: JSON.stringify(["i", definition.id, definition.version, definition.digest, definition.effectRef]) }] };
  await expect(repo.import("p", forged)).rejects.toThrow();
  await repo.grant({ requestId: "r", playerId: "p", instanceId: "i", definition });
  expect(await repo.list("p")).toHaveLength(1);
});
it("atomically equips and unequips only an owned Hero and preserves retries and failures", async () => {
  const authority = { ownsHero: (playerId: string, heroId: string) => playerId === "p" && heroId === "h" };
  const owned = new EquipmentRepository(indexedDB, `owned-${crypto.randomUUID()}`, [definition], authority);
  await owned.grant({ requestId: "g", playerId: "p", instanceId: "i", definition });
  const equip = { requestId: "e", playerId: "p", instanceId: "i", heroId: "h" };
  await owned.equip(equip); await owned.equip(equip);
  const before = await owned.export("p");
  await expect(owned.equip({ ...equip, heroId: "other" })).rejects.toThrow();
  await expect(owned.equip({ ...equip, requestId: "e2", heroId: "other" })).rejects.toThrow();
  await expect(owned.equip({ ...equip, requestId: "e3", playerId: "other" })).rejects.toThrow();
  expect(await owned.export("p")).toEqual(before);
  await owned.unequip({ requestId: "u", playerId: "p", instanceId: "i" });
  await owned.unequip({ requestId: "u", playerId: "p", instanceId: "i" });
  expect((await owned.list("p"))[0].heroId).toBeNull();
});
it("requires Hero authority to recover equipped instances", async () => {
  const authority = { ownsHero: (p: string, h: string) => p === "p" && h === "h" };
  const equipped = new EquipmentRepository(indexedDB, `equipped-${crypto.randomUUID()}`, [definition], authority);
  await equipped.grant({ requestId: "g", playerId: "p", instanceId: "i", definition });
  await equipped.equip({ requestId: "e", playerId: "p", instanceId: "i", heroId: "h" });
  const backup = await equipped.export("p");
  await expect(repo.import("p", backup)).rejects.toThrow();
  const recovery = new EquipmentRepository(indexedDB, `recovery-${crypto.randomUUID()}`, [definition], authority);
  await recovery.import("p", backup);
  expect((await recovery.list("p"))[0].heroId).toBe("h");
});
it("rolls back an equipment assignment and request if its write fails", async () => {
  const owned = new EquipmentRepository(indexedDB, `failure-${crypto.randomUUID()}`, [definition], { ownsHero: () => true });
  await owned.grant({ requestId: "g", playerId: "p", instanceId: "i", definition });
  const before = await owned.export("p");
  const { IDBObjectStore } = await import("fake-indexeddb"); const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new Error("write failed"); };
  try { await expect(owned.equip({ requestId: "e", playerId: "p", instanceId: "i", heroId: "h" })).rejects.toThrow("write failed"); }
  finally { IDBObjectStore.prototype.put = original; }
  expect(await owned.export("p")).toEqual(before);
  await owned.equip({ requestId: "e", playerId: "p", instanceId: "i", heroId: "h" });
  expect((await owned.list("p"))[0].heroId).toBe("h");
});
