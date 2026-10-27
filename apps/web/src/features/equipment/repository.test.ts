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
