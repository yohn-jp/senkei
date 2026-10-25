#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
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
  if (request.operation !== "simulate" || request.payload?.include_diagnostics !== false ||
      typeof request.request_id !== "string") {
    fail(`${request.request_id ?? "fixture"} must use simulate, diagnostics=false, and a request_id`);
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
    const frame = (tick) => replay.frames.find((candidate) => candidate.tick === tick)?.visible_state?.entities ?? {};
    const field = (entity, name) => entity?.fields?.[name]?.kind === "string" || entity?.fields?.[name]?.kind === "enum"
      ? entity.fields[name].value : undefined;
    const entries = (tick) => Object.values(frame(tick));
    const bridgeAt = (tick) => entries(tick).find((entity) => entity.entity_type === "bridge" && field(entity, "site") === "TOP");
    if (field(bridgeAt(0), "bridge_state") !== "normal" || field(bridgeAt(13), "bridge_state") !== "expanded" ||
        field(bridgeAt(23), "bridge_state") !== "destroyed" || field(bridgeAt(49), "bridge_state") !== "normal") {
      fail("authorized public replay does not expose the actual normal → expanded → destroyed → rebuilt TOP bridge states");
    }
    if (!entries(2).some((entity) => field(entity, "track") === "LEFT" && field(entity, "edge_to") === "A.TOP.T2")) {
      fail("authorized public replay does not expose the real selected LEFT lane track and edge movement");
    }
    if (!replay.frames.some((candidate) => candidate.events.some((event) => event.event === "next.attack"))) {
      fail("canonical mid-node encounter produced no confirmed combat event");
    }
    if (!replay.frames.some((candidate) => Object.values(candidate.visible_state?.entities ?? {}).some((entity) =>
      entity.entity_type === "hero" && Number.isSafeInteger(entity.fields?.ford_remaining?.value) && entity.fields.ford_remaining.value > 0))) {
      fail("authorized public replay contains no real unit traversing a Jungle ford");
    }
    if (!entries(50).some((entity) => entity.entity_type === "hero" &&
        field(entity, "node") === "A.TOP.BANK" && field(entity, "edge_to") === "B.TOP.BANK")) {
      fail("authorized public replay contains no real unit traversing the rebuilt fixed TOP bridge");
    }
    if (["slot_id", "squad", "goal", "internal_secret_marker"].some((marker) => JSON.stringify(result).includes(marker))) {
      fail("canonical public replay leaked owner-only identities or tactical goals");
    }
  } else if (nativeResponse.ok) {
    fail(`${request.request_id} should be rejected, but the adapter accepted it`);
  }
  console.log(`PASS ${request.request_id} (${nativeResponse.ok ? "public simulation" : "matching rejection"})`);
}
