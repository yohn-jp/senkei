#!/usr/bin/env node
// The requests are produced by the real Enbu tests using
// MINION_CONTROL_CONFORMANCE_FILE and RELATION_MATURITY_CONFORMANCE_FILE.
// Both contain explicit test-only policies; they do not define production data.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [minionPath, maturityPath] = process.argv.slice(2);
const nativePath = process.env.SENKEI_NATIVE_DISPATCHER;
const wasmPath = process.env.SENKEI_WASM_PATH;
if (!minionPath || !maturityPath || !nativePath || !wasmPath) throw new Error('two request fixtures, SENKEI_NATIVE_DISPATCHER and SENKEI_WASM_PATH are required');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const {instance} = await WebAssembly.instantiate(await readFile(resolve(wasmPath)), {});
const {memory,senkei_alloc:alloc,senkei_dispatch:dispatch,senkei_dealloc:free} = instance.exports;
assert(memory instanceof WebAssembly.Memory && typeof dispatch === 'function' && typeof alloc === 'function' && typeof free === 'function', 'WASM dispatcher exports missing');
function runWasm(request) {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const ptr = alloc(bytes.length); new Uint8Array(memory.buffer,ptr,bytes.length).set(bytes);
  const packed = BigInt(dispatch(ptr,bytes.length));
  const out = Number(packed & 0xffffffffn); const length = Number(packed >> 32n);
  const result = new Uint8Array(memory.buffer,out,length).slice();
  free(ptr,bytes.length); free(out,length);
  return JSON.parse(new TextDecoder().decode(result));
}
async function both(path, label) {
  const request = JSON.parse(await readFile(resolve(path),'utf8'));
  const child = spawnSync(resolve(nativePath), [], {input:JSON.stringify(request)+'\n', encoding:'utf8', maxBuffer:64_000_000});
  if (child.error || child.status !== 0) throw new Error(`${label}: native dispatcher failed: ${child.error ?? child.stderr}`);
  const native = JSON.parse(child.stdout); const wasm = runWasm(request);
  assert(native.ok && wasm.ok, `${label}: reproduction failed: ${JSON.stringify(native.error ?? wasm.error)}`);
  assert(JSON.stringify(canonical(native)) === JSON.stringify(canonical(wasm)), `${label}: native/WASM response differs`);
  return native.result;
}
const minion = await both(minionPath,'authored Minion control');
const notices = minion.diagnostics.events.filter(event => event.record.kind === 'runtime_notice');
assert(notices.some(event => event.record.value.code === 'enbu.minion_control_committed' && event.action_id === 'lane_mid'), 'accepted Lane command missing');
assert(notices.some(event => event.record.value.code === 'enbu.minion_lane_decision' && event.record.value.details.source === 'jinrei' && JSON.parse(event.record.value.details.action_ids).includes('lane_mid')), 'owner Minion provenance missing');
assert(minion.diagnostics.events.every(event => event.side === 'attacker'), 'Minion diagnostics crossed owner boundary');
const maturity = await both(maturityPath,'maturity-only relationship policy');
const frame = maturity.owner_replays.attacker.frames.find(frame => frame.tick === 2);
const hero = Object.values(frame.visible_state.entities).find(entity => entity.entity_type === 'hero' && entity.fields.slot_id?.value === 'slot-1');
assert(hero?.fields.maturity?.value === 6, 'explicit relationship maturity effect missing');
assert(Object.keys(maturity.owner_replays).join() === 'attacker', 'maturity replay crossed owner boundary');
console.log('PASS authored Minion control and maturity-only Native/WASM full-response parity');
