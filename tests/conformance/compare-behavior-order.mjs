#!/usr/bin/env node
// Build the test-only behavior_order_parity example for native and wasm first.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createServer } from "vite";
const target = process.env.CARGO_TARGET_DIR ?? "target";
const native = spawnSync(resolve(target, "release/examples/behavior_order_parity"), [], { encoding: "utf8" });
assert.equal(native.status, 0, native.stderr);
const bytes = await readFile(resolve(target, "wasm32-unknown-unknown/release/examples/behavior_order_parity.wasm"));
const { instance } = await WebAssembly.instantiate(bytes, {});
const packed = instance.exports.behavior_order_fixture();
const pointer = Number(packed & 0xffffffffn), length = Number(packed >> 32n);
const wasm = new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, pointer, length));
instance.exports.behavior_order_release(pointer, length);
assert.equal(wasm, native.stdout.trim());
const result = JSON.parse(wasm);
assert.equal(result.decision.selected.action_id, "a_skill");
assert.equal(result.composition.values["navigation.destination"].value, "A.TOP.J");
assert.equal(result.composition.values["targeting.mode"].value, "f01_a_active");
const server = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom" });
try {
  const { loadDomainCatalog, digestMaterialJson } = await server.ssrLoadModule("/packages/jinrei-editor/src/catalog.ts");
  const decoded = await loadDomainCatalog(result.catalog);
  assert.equal(decoded.behaviorProfiles.value.metadata.crossCapabilityOrder.intentSelection[0].actorType, "hero");
  await assert.rejects(loadDomainCatalog(result.catalog.replace('"actorType":"hero"', '"actorType":"wrong_type"')), { code: "invalid_shape" });
  await assert.rejects(loadDomainCatalog(result.catalog.replaceAll('"kind":"action_id"', '"kind":"capability"')), { code: "invalid_shape" });
  const duplicate = JSON.parse(result.catalog);
  duplicate.behaviorProfiles.value.metadata.crossCapabilityOrder.intentSelection[0].arbitration.resolution.value.sort_by.unshift(
    { key: { kind: "argument", value: 1 }, direction: "ascending" },
    { key: { value: 1, kind: "argument", ignored: true }, direction: "descending" },
  );
  const malformed = JSON.stringify(duplicate);
  const rehashed = malformed.replace(/"catalogDigest":"[0-9a-f]{64}"/, `"catalogDigest":"${createHash("sha256").update(digestMaterialJson(malformed)).digest("hex")}"`);
  await assert.rejects(loadDomainCatalog(rehashed), { code: "invalid_shape" });
} finally { await server.close(); }
console.log(`PASS real Catalog/Jinrei VM/BehaviorResolver native-WASM exact fixture parity; wasm SHA256 ${createHash("sha256").update(bytes).digest("hex")}`);
