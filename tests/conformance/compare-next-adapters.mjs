#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixturesDirectory = resolve(process.argv[2] ?? "target/next-balance/adapter");
const wasmPath = resolve(
  repositoryRoot,
  process.env.SENKEI_WASM_PATH ?? "apps/web/public/wasm/senkei_wasm.wasm",
);

function fail(message) {
  console.error(`Next native/WASM conformance: ${message}`);
  process.exit(1);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

async function requestFiles() {
  const entries = await readdir(fixturesDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".request.json"))
    .map((entry) => resolve(fixturesDirectory, entry.name))
    .sort();
}

async function runNative(requests) {
  const dispatcher = process.env.SENKEI_NATIVE_DISPATCHER;
  const child = spawn(
    dispatcher ?? "cargo",
    dispatcher ? [] : ["run", "--quiet", "--locked", "--release", "-p", "senkei-wasm", "--bin", "senkei-wasm-dispatch"],
    { cwd: repositoryRoot, stdio: ["pipe", "pipe", "inherit"] },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  const exitCode = await new Promise((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", resolvePromise);
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
  });
  if (exitCode !== 0) throw new Error(`native dispatcher exited with status ${exitCode}`);
  const responses = stdout.trimEnd().split("\n").map((line) => JSON.parse(line));
  if (responses.length !== requests.length) {
    throw new Error(`native dispatcher returned ${responses.length} responses for ${requests.length} requests`);
  }
  return responses;
}

async function makeWasmDispatcher() {
  const bytes = await readFile(wasmPath).catch(() => {
    fail(`missing WebAssembly module ${wasmPath}; build it with scripts/wasm/build.sh`);
  });
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const { memory, senkei_alloc: allocate, senkei_dispatch: dispatch, senkei_dealloc: deallocate } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof allocate !== "function" ||
      typeof dispatch !== "function" || typeof deallocate !== "function") {
    fail("WebAssembly module lacks memory or a dispatch export");
  }
  return (request) => {
    const input = new TextEncoder().encode(JSON.stringify(request));
    const inputPointer = allocate(input.byteLength);
    new Uint8Array(memory.buffer, inputPointer, input.byteLength).set(input);
    const packed = BigInt(dispatch(inputPointer, input.byteLength));
    const outputPointer = Number(packed & 0xffff_ffffn);
    const outputLength = Number(packed >> 32n);
    const output = new Uint8Array(memory.buffer, outputPointer, outputLength).slice();
    deallocate(inputPointer, input.byteLength);
    deallocate(outputPointer, outputLength);
    return JSON.parse(new TextDecoder().decode(output));
  };
}

const paths = await requestFiles();
if (paths.length < 2) fail(`expected the success and negative Next cases in ${fixturesDirectory}`);
const requests = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
for (const request of requests) {
  const ownerScenario = request.request_id === "next-battlefield-owner";
  if (request.operation !== "simulate" || request.payload?.include_diagnostics !== ownerScenario ||
      typeof request.request_id !== "string") {
    fail(`${request.request_id ?? "fixture"} has an invalid operation, diagnostics scope, or request_id`);
  }
}

let native;
let repeatedNative;
try {
  native = await runNative(requests);
  repeatedNative = await runNative(requests);
} catch (error) {
  fail(`native dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
}
const wasmDispatch = await makeWasmDispatcher();
const wasm = requests.map(wasmDispatch);

const evidence = [];
const digest = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
for (let index = 0; index < requests.length; index += 1) {
  const request = requests[index];
  const nativeResponse = native[index];
  const wasmResponse = wasm[index];
  if (nativeResponse.request_id !== request.request_id || wasmResponse.request_id !== request.request_id) {
    fail(`${request.request_id} returned an incorrect request_id`);
  }
  if (canonicalJson(nativeResponse) !== canonicalJson(repeatedNative[index])) {
    fail(`${request.request_id} differs on an identical native repeat`);
  }
  if (canonicalJson(nativeResponse) !== canonicalJson(wasmResponse)) {
    fail(`${request.request_id} differs between native and real WebAssembly dispatch`);
  }

  if (request.request_id === "next-public-simulation") {
    if (!nativeResponse.ok) fail(`public scenario failed: ${JSON.stringify(nativeResponse.error)}`);
    const result = nativeResponse.result;
    if (result.diagnostics !== null || Object.hasOwn(result, "owner_replay")) {
      fail("diagnostics=false exposed restricted diagnostics or the local owner replay");
    }
    const serialized = JSON.stringify(result);
    if (["slot_id", "squad", "internal_secret_marker", "final_memory_by_side"].some((marker) => serialized.includes(marker))) {
      fail("public Next simulation leaked owner-only identity, tactic source, or memory data");
    }
  } else if (request.request_id === "next-battlefield-canonical") {
    if (!nativeResponse.ok) fail(`canonical Battlefield scenario failed: ${JSON.stringify(nativeResponse.error)}`);
    const result = nativeResponse.result;
    const match = result.result;
    const replay = result.replay;
    if (result.diagnostics !== null || Object.hasOwn(result, "owner_replay")) {
      fail("canonical public battle leaked restricted diagnostics or owner replay");
    }
    if (match.final_tick < 50 || typeof match.final_state_digest !== "string" ||
        !Number.isSafeInteger(match.cu_spent?.attacker) || !Number.isSafeInteger(match.cu_spent?.defender)) {
      fail("canonical public battle is missing its confirmed terminal state, digest, or side CU");
    }
    if (!replay.frames.some((candidate) => candidate.events.some((event) => event.event === "next.attack"))) {
      fail("canonical mid-node encounter produced no confirmed combat event");
    }
    if (["slot_id", "squad", "goal", "internal_secret_marker"].some((marker) => JSON.stringify(result).includes(marker))) {
      fail("canonical public replay leaked owner-only identities or tactical goals");
    }
  } else if (request.request_id === "next-battlefield-owner") {
    if (!nativeResponse.ok) fail(`authorized owner battle failed: ${JSON.stringify(nativeResponse.error)}`);
    const result = nativeResponse.result;
    const match = result.result;
    const replay = result.owner_replay;
    if (result.diagnostics === null || !replay || replay.perspective !== "attacker") {
      fail("explicit diagnostics-enabled request lacks its authorized attacker replay");
    }
    if (match.final_tick < 50 || typeof match.final_state_digest !== "string" ||
        !Number.isSafeInteger(match.cu_spent?.attacker) || !Number.isSafeInteger(match.cu_spent?.defender)) {
      fail("authorized owner battle is missing its confirmed terminal state, digest, or side CU");
    }
    const frameEntities = (tick) => {
      const entities = replay.frames.find((candidate) => candidate.tick === tick)?.visible_state?.entities;
      return entities ? Object.values(entities) : [];
    };
    const field = (entity, name) => entity?.fields?.[name]?.kind === "string" || entity?.fields?.[name]?.kind === "enum"
      ? entity.fields[name].value : undefined;
    const integer = (entity, name) => entity?.fields?.[name]?.kind === "integer"
      ? entity.fields[name].value : undefined;
    const hero = (tick, catalogId) => frameEntities(tick).find((entity) =>
      entity.entity_type === "hero" && field(entity, "catalog_id") === catalogId);
    const bridge = (tick, site = "TOP") => frameEntities(tick).find((entity) =>
      entity.entity_type === "bridge" && field(entity, "site") === site);
    if (field(bridge(0), "bridge_state") !== "normal" || field(bridge(13), "bridge_state") !== "expanded" ||
        field(bridge(23), "bridge_state") !== "destroyed" || field(bridge(49), "bridge_state") !== "normal") {
      fail("authorized attacker replay does not expose the real normal → expanded → destroyed → rebuilt TOP bridge states");
    }
    if (field(bridge(0, "MID"), "bridge_state") !== "normal" || field(bridge(11, "MID"), "bridge_state") !== "destroyed") {
      fail("authorized attacker replay does not expose the actual MID connector bridge destruction");
    }
    if (field(hero(2, "F01"), "track") !== "LEFT" || field(hero(2, "F01"), "node") !== "A.TOP.T1" ||
        field(hero(2, "F01"), "edge_to") !== "A.TOP.T2") {
      fail("authorized attacker replay does not expose selected LEFT track movement on the canonical TOP edge");
    }
    if (!Number.isSafeInteger(integer(hero(3, "F01"), "cross_remaining")) || integer(hero(3, "F01"), "cross_remaining") <= 0) {
      fail("authorized attacker replay does not expose active CENTER occupancy during the real lateral track crossing");
    }
    if (field(hero(5, "F01"), "track") !== "RIGHT") {
      fail("authorized attacker replay does not expose completion of the three-tick LEFT-to-RIGHT lane crossing");
    }
    if (!Number.isSafeInteger(integer(hero(24, "F02"), "ford_remaining")) || integer(hero(24, "F02"), "ford_remaining") <= 0) {
      fail("authorized attacker replay contains no Hero in the actual Jungle ford transit state");
    }
    if (field(hero(1, "F03"), "node") !== "A.MID.T2" || field(hero(1, "F03"), "edge_to") !== "A.MID.J" ||
        integer(hero(1, "F03"), "edge_progress") <= 0) {
      fail("authorized attacker replay does not expose actual movement driven by the MID pursuit");
    }
    if (field(hero(2, "R02"), "node") !== "A.MID.BANK" || field(hero(2, "R02"), "edge_to") !== "") {
      fail("authorized attacker replay does not expose the retreat's adjacent-node arrival and tick boundary");
    }
    if (field(hero(50, "R01"), "node") !== "A.TOP.BANK" || field(hero(50, "R01"), "edge_to") !== "B.TOP.BANK") {
      fail("authorized attacker replay does not expose the rebuilt fixed TOP bridge transit");
    }
  } else if (nativeResponse.ok) {
    fail(`${request.request_id} should be rejected, but the adapter accepted it`);
  }
  const match = nativeResponse.ok ? nativeResponse.result.result : undefined;
  evidence.push({ request_id: request.request_id, input_sha256: digest(request),
    native_sha256: digest(nativeResponse), repeated_native_sha256: digest(repeatedNative[index]), wasm_sha256: digest(wasmResponse),
    ok: nativeResponse.ok, ...(match ? { final_tick: match.final_tick, final_state_digest: match.final_state_digest, cu_spent: match.cu_spent,
      public_replay_sha256: digest(nativeResponse.result.replay),
      ...(nativeResponse.result.owner_replay ? { owner_replay_sha256: digest(nativeResponse.result.owner_replay) } : {}) } : {}) });
  console.log(`PASS ${request.request_id} (${nativeResponse.ok ? request.payload.include_diagnostics ? "authorized owner simulation" : "public simulation" : "matching rejection"})`);
}
if (process.env.NEXT_ADAPTER_REPORT) {
  const report = resolve(process.env.NEXT_ADAPTER_REPORT);
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, JSON.stringify({ schema: "senkei-battlefield-adapter-evidence/v1", cases: evidence }, null, 2) + "\n");
}
