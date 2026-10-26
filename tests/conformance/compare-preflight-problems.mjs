#!/usr/bin/env node
// Focused real-dispatch proof; never simulates a match.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const bytes = await readFile(process.env.SENKEI_WASM_PATH ?? "apps/web/public/wasm/senkei_wasm.wasm");
const { instance } = await WebAssembly.instantiate(bytes, {});
const { memory, senkei_alloc, senkei_dispatch, senkei_dealloc } = instance.exports;
let count = 0;
function request(operation, payload) {
  const input = Buffer.from(JSON.stringify({ api_version: { major: 1, minor: 0, patch: 0 }, request_id: `preflight-proof-${++count}`, operation, payload }));
  const pointer = senkei_alloc(input.length);
  new Uint8Array(memory.buffer, pointer, input.length).set(input);
  const packed = senkei_dispatch(pointer, input.length);
  const output = Number(packed & 0xffffffffn), length = Number(packed >> 32n);
  const wasm = JSON.parse(Buffer.from(new Uint8Array(memory.buffer, output, length)).toString());
  senkei_dealloc(pointer, input.length);
  senkei_dealloc(output, length);
  const native = spawnSync(process.env.SENKEI_NATIVE_DISPATCHER ?? resolve("target/debug/senkei-wasm-dispatch"), [], { input: `${input}\n`, encoding: "utf8", maxBuffer: 10_000_000 });
  assert.equal(native.status, 0, native.stderr);
  assert.deepEqual(wasm, JSON.parse(native.stdout), `${operation}: exact native/real-WASM parity`);
  return wasm;
}
function accepted(operation, payload) {
  const response = request(operation, payload);
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result;
}
const rules = accepted("next_ruleset", {});
const program = accepted("compile_text", { ruleset_ref: rules.ruleset, source: "senkei ready { state inert { false, }, }" }).program;
const side = owner => ({ schema_version: rules.model_version, id: `proof-${owner}`, revision: "1", ruleset: rules.ruleset, program: structuredClone(program), initial_memory: {}, configuration: { heroes: { kind: "list", value: rules.next.heroes.slice(0, 5).map((hero, index) => ({ kind: "record", value: {
  slot_id: { kind: "string", value: `slot-${index + 1}` }, catalog_id: { kind: "string", value: hero.id }, squad: { kind: "string", value: `squad-${index + 1}` },
  node: { kind: "string", value: owner === "attacker" ? rules.next.map.attacker_base : rules.next.map.defender_base }, skill_path: { kind: "string", value: Object.keys(hero.skill_paths)[0] },
} })) } } });
const snapshot = { attacker: side("attacker"), defender: side("defender"), context: accepted("new_match_context", { ruleset_ref: rules.ruleset, match_id: "preflight-proof" }) };
assert.equal(accepted("preflight", snapshot), null);
for (const owner of ["attacker", "defender"]) {
  for (const kind of ["skill", "squad", "program"]) {
    const input = structuredClone(snapshot);
    const heroes = input[owner].configuration.heroes.value;
    let message, field;
    if (kind === "skill") {
      heroes[1].value.skill_path.value = "missing-path";
      message = `Hero \`${heroes[1].value.catalog_id.value}\` has no configured skill path \`missing-path\``;
      field = "skill_path";
    } else if (kind === "squad") {
      heroes[1].value.squad.value = heroes[0].value.squad.value;
      heroes[1].value.node.value = Object.keys(rules.next.map.nodes).find(node => node !== heroes[0].value.node.value);
      message = "initial squad `squad-1` spans multiple map nodes";
      field = "node";
    } else {
      input[owner].program.content_digest = "0".repeat(64);
      message = "tactical program bytecode digest does not match its content";
      field = "program";
    }
    const response = request("preflight", input);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, kind === "program" ? "invalid_program" : "invalid_snapshot");
    assert.equal(response.error.message, message, "category/message and rejection constraint remain unchanged");
    assert.equal(response.error.path, kind === "program" ? `${owner}.program` : `${owner}.configuration.heroes.value[1].value.${field}`);
    assert.equal(response.error.details.preflight_side, owner);
    assert.equal(response.error.details.preflight_field, field);
    if (kind !== "program") {
      assert.equal(response.error.details.preflight_record_index, "1");
      assert.equal(response.error.details.preflight_slot_id, "slot-2");
      assert.equal(response.error.details.preflight_squad_id, kind === "squad" ? "squad-1" : "squad-2");
    } else assert.equal(response.error.details.preflight_slot_id, undefined);
  }
}
const catalog = JSON.parse(accepted("editor_catalog", {}));
const stamp = { identity: catalog.identity, catalogDigest: catalog.catalogDigest, metadataExtensionDigest: catalog.metadataExtensionDigest };
const source = "// 日本語 😀\r\nsenkei broken { state missing {";
const own = accepted("editor_compile", { source, stamp, revision: 7 });
assert.equal(own.reply.status, "rejected");
const npc = request("compile_text", { ruleset_ref: rules.ruleset, source });
assert.equal(npc.ok, false);
assert.deepEqual(own.reply.error, npc.error, "caller stage establishes own/NPC ownership; compiler errors stay unchanged");
assert.equal(npc.error.code, "compile_failed");
assert.equal(npc.error.path, `source@${Buffer.byteLength(source)}`, "existing UTF-8 byte offset survives Unicode and CRLF");
console.log(`PASS ${count} exact native/real-WASM dispatches: valid control; own/NPC Skill, Squad, program targets; unchanged source byte paths. WASM sha256 ${createHash("sha256").update(bytes).digest("hex")}`);
