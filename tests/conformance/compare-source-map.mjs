#!/usr/bin/env node
// Run after scripts/wasm/build.sh; compares actual native and raw WASM dispatch.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(await readFile(process.env.SENKEI_WASM_PATH ?? "apps/web/public/wasm/senkei_wasm.wasm"), {});
const { memory, senkei_alloc, senkei_dispatch, senkei_dealloc } = instance.exports;
let count = 0;
function request(operation, payload) {
  const envelope = { api_version: { major: 1, minor: 0, patch: 0 }, request_id: `source-map-${++count}`, operation, payload };
  const input = Buffer.from(JSON.stringify(envelope));
  const pointer = senkei_alloc(input.length);
  new Uint8Array(memory.buffer, pointer, input.length).set(input);
  const packed = senkei_dispatch(pointer, input.length);
  const outputPointer = Number(packed & 0xffffffffn);
  const outputLength = Number(packed >> 32n);
  const wasm = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, outputPointer, outputLength)));
  senkei_dealloc(pointer, input.length);
  senkei_dealloc(outputPointer, outputLength);
  const native = spawnSync("cargo", ["run", "--quiet", "--locked", "-p", "senkei-wasm", "--bin", "senkei-wasm-dispatch"], { input: `${input}\n`, encoding: "utf8", maxBuffer: 10_000_000 });
  assert.equal(native.status, 0, native.stderr);
  assert.deepEqual(wasm, JSON.parse(native.stdout), `${operation}: native/WASM exact response parity`);
  assert.equal(wasm.ok, true, JSON.stringify(wasm));
  return wasm.result;
}
const catalog = JSON.parse(request("editor_catalog", {}));
const stamp = { identity: catalog.identity, catalogDigest: catalog.catalogDigest, metadataExtensionDigest: catalog.metadataExtensionDigest };
const ruleset_ref = request("next_ruleset", {}).ruleset;
const action = 'action hold { // 日本語 😀 } action hold {\n when true, do move(argmin hero in allies.heroes by hero.level then hero.id, "attacker_base"), }';
const source = `// 😀 action hold {}\r\nsenkei mapped { state guard { true }, ${action}, }`;
const compiled = request("compile_text", { ruleset_ref, source });
const bytes = Buffer.from(source);
const map = compiled.source_map;
assert.equal(map.schema_version, 1);
assert.equal(map.source_digest, createHash("sha256").update(bytes).digest("hex"));
assert.equal(map.program_digest, compiled.program.content_digest);
assert.equal(map.actions.length, 1);
assert.equal(map.actions[0].action_id, "hold");
assert.equal(map.actions[0].declaration_index, 1);
assert.equal(bytes.subarray(map.actions[0].start_utf8, map.actions[0].end_utf8).toString(), action);
const ast = request("compile_ast", { ruleset_ref, ast: compiled.ast });
assert.equal(Object.hasOwn(ast, "source_map"), false);
assert.deepEqual(ast.program, compiled.program);
assert.equal(ast.estimated_cu, compiled.estimated_cu);
const revised = request("compile_text", { ruleset_ref, source: `// revision\n${source}` });
assert.notEqual(revised.source_map.source_digest, map.source_digest);
assert.deepEqual(revised.program, compiled.program);
const editor = request("editor_compile", { source, stamp, revision: 9 });
assert.equal(editor.revision, 9);
assert.deepEqual(editor.reply.result.source_map, map);
console.log(`PASS ${count} native/real-WASM dispatches: exact UTF-8 source map, revision/program binding, AST omission, editor propagation`);
