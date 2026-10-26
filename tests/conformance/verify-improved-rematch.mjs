#!/usr/bin/env node
// Build Core WASM first, or supply a verified fresh artifact in SENKEI_WASM_PATH.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "vite";
const wasm = await readFile(process.env.SENKEI_WASM_PATH ?? "apps/web/public/wasm/senkei_wasm.wasm");
const { instance } = await WebAssembly.instantiate(wasm, {});
const { memory, senkei_alloc, senkei_dispatch, senkei_dealloc } = instance.exports;
let sequence = 0;
function dispatch(operation, payload) {
  const input = Buffer.from(JSON.stringify({ api_version: { major: 1, minor: 0, patch: 0 }, request_id: `improved-rematch-${++sequence}`, operation, payload }));
  const pointer = senkei_alloc(input.length); new Uint8Array(memory.buffer, pointer, input.length).set(input);
  const packed = senkei_dispatch(pointer, input.length), output = Number(packed & 0xffffffffn), length = Number(packed >> 32n);
  const response = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, output, length)));
  senkei_dealloc(pointer, input.length); senkei_dealloc(output, length); return response;
}
function core(operation, payload) { const response = dispatch(operation, payload); assert.equal(response.ok, true, JSON.stringify(response)); return response.result; }
const rules = core("next_ruleset", {});
const program = core("compile_text", { ruleset_ref: rules.ruleset, source: "senkei baseline { state inert { false, }, }" }).program;
const side = owner => ({ schema_version: rules.model_version, id: `comparison-${owner}`, revision: "1", ruleset: rules.ruleset, initial_memory: {}, program,
  configuration: { heroes: { kind: "list", value: rules.next.heroes.slice(0, 5).map((hero, index) => ({ kind: "record", value: {
    slot_id: { kind: "string", value: `slot-${index + 1}` }, catalog_id: { kind: "string", value: hero.id },
    squad: { kind: "string", value: `squad-${index + 1}` }, skill_path: { kind: "string", value: Object.keys(hero.skill_paths)[0] },
    node: { kind: "string", value: owner === "attacker" ? rules.next.map.attacker_base : rules.next.map.defender_base },
  } })) } } });
const original = { attacker: side("attacker"), defender: side("defender"), context: core("new_match_context", { ruleset_ref: rules.ruleset, match_id: "original-comparison-runtime-ids" }) };
core("preflight", original);
const own = structuredClone(original.attacker); own.revision = "2";
own.program = core("compile_text", { ruleset_ref: rules.ruleset, source: "senkei revised { state inert { true, }, }" }).program;
const originalKey = JSON.stringify(original), ownKey = JSON.stringify(own);
const server = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, entries: [] }, appType: "custom" });
try {
  const { buildImprovedRematch } = await server.ssrLoadModule("/apps/web/src/features/next/improved-rematch.ts");
  const improved = buildImprovedRematch(original, own);
  assert.equal(improved.status, "ready"); assert.equal(improved.comparison.category, "improved");
  assert.deepEqual(improved.snapshot.context, original.context); assert.deepEqual(improved.snapshot.defender, original.defender);
  core("preflight", improved.snapshot);
  const invalid = structuredClone(own); invalid.configuration.heroes.value.pop();
  const rejectedByCore = buildImprovedRematch(original, invalid); assert.equal(rejectedByCore.status, "ready");
  assert.deepEqual(rejectedByCore.snapshot.context, original.context);
  const response = dispatch("preflight", rejectedByCore.snapshot);
  assert.equal(response.ok, false); assert.equal(response.error.code, "invalid_snapshot");
  assert.equal(JSON.stringify(original), originalKey); assert.equal(JSON.stringify(own), ownKey);
  assert.deepEqual(rejectedByCore.snapshot.context, original.context);
  const memoryEdit = structuredClone(own); memoryEdit.initial_memory.new_state = { kind: "integer", value: 1 };
  assert.equal(buildImprovedRematch(original, memoryEdit).status, "rejected");
} finally { await server.close(); }
console.log(`PASS real Core preflight accepts derived improvement, rejects invalid roster with original context unchanged; UI NOT_CHECKED; WASM SHA256 ${createHash("sha256").update(wasm).digest("hex")}`);
