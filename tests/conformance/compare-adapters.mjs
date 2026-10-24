#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const wasmPath = resolve(
  repositoryRoot,
  process.env.SENKEI_WASM_PATH ?? "apps/web/public/wasm/senkei_wasm.wasm",
);

function fail(message) {
  console.error(`native/WASM conformance: ${message}`);
  process.exit(1);
}

async function collectFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(fullPath)));
    else if (entry.isFile() && entry.name.endsWith(".request.json")) files.push(fullPath);
  }
  return files;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  const bytes = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(bytes).digest("hex");
}

function summarizeResponse(response) {
  const simulation = response.result;
  const eventsByType = {};
  const coreDamageByOwner = {};
  let eventCount = 0;
  for (const frame of simulation.replay.frames) {
    for (const event of frame.events) {
      eventCount += 1;
      eventsByType[event.event] = (eventsByType[event.event] ?? 0) + 1;
      if (event.event === "core_attacked") {
        const targetId = event.payload.target?.value;
        const owner = frame.visible_state?.entities?.[targetId]?.owner ?? "unknown";
        coreDamageByOwner[owner] = (coreDamageByOwner[owner] ?? 0) + (event.payload.damage?.value ?? 0);
      }
    }
  }

  const diagnosticsByKind = {};
  const acceptedBySideCapability = {};
  for (const event of simulation.diagnostics?.events ?? []) {
    const kind = event.record.kind;
    diagnosticsByKind[kind] = (diagnosticsByKind[kind] ?? 0) + 1;
    if (kind !== "intent_accepted") continue;
    const capability = event.record.value.intent.capability;
    const key = `${event.side}:${capability}`;
    acceptedBySideCapability[key] = (acceptedBySideCapability[key] ?? 0) + 1;
  }

  return {
    outcome: simulation.result.outcome,
    termination_reason: simulation.result.termination_reason,
    final_tick: simulation.result.final_tick,
    final_state_digest: simulation.result.final_state_digest,
    cu_by_side: simulation.diagnostics?.cu_by_side ?? {},
    replay_frames: simulation.replay.frames.length,
    event_count: eventCount,
    events_by_type: eventsByType,
    core_damage_by_owner: coreDamageByOwner,
    diagnostic_event_count: simulation.diagnostics?.events?.length ?? 0,
    diagnostics_by_kind: diagnosticsByKind,
    accepted_by_side_capability: acceptedBySideCapability,
  };
}

function makeCompactGolden(request, response) {
  return {
    golden_schema: "senkei-conformance/v1",
    request_id: request.request_id,
    request_sha256: sha256(request),
    response_sha256: sha256(response),
    summary: summarizeResponse(response),
  };
}

function runNative(requests) {
  return new Promise((resolvePromise, reject) => {
    const dispatcher = process.env.SENKEI_NATIVE_DISPATCHER;
    const child = spawn(
      dispatcher ?? "cargo",
      dispatcher ? [] : ["run", "--quiet", "--locked", "-p", "senkei-wasm", "--bin", "senkei-wasm-dispatch"],
      { cwd: repositoryRoot, stdio: ["pipe", "pipe", "inherit"] },
    );
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`native dispatcher exited with status ${code}`));
      else resolvePromise(stdout.trimEnd().split("\n").map((line) => JSON.parse(line)));
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
  });
}

async function createWasmDispatcher() {
  const bytes = await readFile(wasmPath).catch(() => {
    fail(`missing compiled module at ${wasmPath}; run scripts/wasm/build.sh first`);
  });
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const { memory, senkei_alloc: allocate, senkei_dispatch: dispatch, senkei_dealloc: deallocate } =
    instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof allocate !== "function" ||
      typeof dispatch !== "function" || typeof deallocate !== "function") {
    fail("compiled module is missing memory or one of senkei_alloc/senkei_dispatch/senkei_dealloc");
  }

  return (request) => {
    const bytes = new TextEncoder().encode(JSON.stringify(request));
    const inputPointer = allocate(bytes.byteLength);
    new Uint8Array(memory.buffer, inputPointer, bytes.byteLength).set(bytes);

    const packed = dispatch(inputPointer, bytes.byteLength);
    const packedResult = BigInt(packed);
    const outputPointer = Number(packedResult & 0xffff_ffffn);
    const outputLength = Number(packedResult >> 32n);
    const outputBytes = new Uint8Array(memory.buffer, outputPointer, outputLength).slice();
    deallocate(inputPointer, bytes.byteLength);
    deallocate(outputPointer, outputLength);
    return JSON.parse(new TextDecoder().decode(outputBytes));
  };
}

const argumentsWithoutUpdate = process.argv.slice(2);
const updateGoldens = argumentsWithoutUpdate.includes("--update-goldens");
const requestPaths = argumentsWithoutUpdate
  .filter((path) => path !== "--update-goldens")
  .map((path) => resolve(repositoryRoot, path));
if (requestPaths.length === 0) {
  requestPaths.push(...(await collectFiles(resolve(repositoryRoot, "scenarios"))));
}
if (requestPaths.length === 0) {
  fail("no *.request.json scenario inputs found; refusing an empty conformance run");
}

const requests = [];
for (const path of requestPaths) {
  const request = JSON.parse(await readFile(path, "utf8"));
  if (request.operation !== "simulate" || typeof request.request_id !== "string" ||
      request.payload?.include_diagnostics !== true) {
    fail(`${path} must be a local simulation envelope with diagnostics enabled and a request_id`);
  }
  requests.push(request);
}

let nativeResponses;
try {
  nativeResponses = await runNative(requests);
} catch (error) {
  fail(`native run failed: ${error instanceof Error ? error.message : String(error)}`);
}
let repeatedNativeResponses;
try {
  repeatedNativeResponses = await runNative(requests);
} catch (error) {
  fail(`repeated native run failed: ${error instanceof Error ? error.message : String(error)}`);
}
const dispatchWasm = await createWasmDispatcher();
const wasmResponses = requests.map(dispatchWasm);
if (nativeResponses.length !== requests.length || repeatedNativeResponses.length !== requests.length) {
  fail(`native returned ${nativeResponses.length} and ${repeatedNativeResponses.length} responses for ${requests.length} requests`);
}

for (let index = 0; index < requests.length; index += 1) {
  const native = nativeResponses[index];
  const wasm = wasmResponses[index];
  if (native.request_id !== requests[index].request_id || wasm.request_id !== requests[index].request_id) {
    fail(`request_id mismatch for ${requests[index].request_id}`);
  }
  if (!native.ok || !wasm.ok) {
    fail(`${requests[index].request_id} did not produce a successful simulation (native=${native.ok}, wasm=${wasm.ok})`);
  }
  const expected = resolve(requestPaths[index].replace(/\.request\.json$/, ".golden.json"));
  if (!updateGoldens) {
    const golden = await readFile(expected, "utf8").then(JSON.parse).catch(() => {
      fail(`missing ${expected}; run with --update-goldens to generate it from the real native dispatcher`);
    });
    if (golden.golden_schema === "senkei-conformance/v1") {
      const generated = makeCompactGolden(requests[index], native);
      if (canonicalJson(generated) !== canonicalJson(golden)) {
        fail(`canonical request/response digest or summary differs from golden for ${requests[index].request_id}`);
      }
    } else if (canonicalJson(native) !== canonicalJson(golden)) {
      fail(`native response differs from full-response golden for ${requests[index].request_id}`);
    }
  }
  if (canonicalJson(native) !== canonicalJson(repeatedNativeResponses[index])) {
    fail(`repeated native result differs for ${requests[index].request_id}`);
  }
  if (canonicalJson(native) !== canonicalJson(wasm)) {
    fail(`response mismatch for ${requests[index].request_id}`);
  }
  if (updateGoldens) {
    const golden = makeCompactGolden(requests[index], native);
    await writeFile(expected, `${JSON.stringify(golden, null, 2)}\n`);
  }
  console.log(`PASS ${requests[index].request_id}`);
}
