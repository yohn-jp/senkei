#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
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

const requestPaths = process.argv.slice(2).map((path) => resolve(repositoryRoot, path));
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
const dispatchWasm = await createWasmDispatcher();
const wasmResponses = requests.map(dispatchWasm);
if (nativeResponses.length !== requests.length) {
  fail(`native returned ${nativeResponses.length} responses for ${requests.length} requests`);
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
  if (JSON.stringify(canonical(native)) !== JSON.stringify(canonical(wasm))) {
    fail(`response mismatch for ${requests[index].request_id}`);
  }
  console.log(`PASS ${requests[index].request_id}`);
}
