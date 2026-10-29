// JSON ABI shared by the actual game and all eight experimental Enbu builds.
// Profiling is host-side: wasm_dispatch_ms also includes Rust JSON parse/serialize.
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64_000_000;

export function createEnbuDispatcher(exports) {
  if (!(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.senkei_alloc !== 'function' ||
      typeof exports.senkei_dealloc !== 'function' ||
      typeof exports.senkei_dispatch !== 'function') {
    throw new Error('Incompatible production Enbu WASM ABI');
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', {fatal: true});

  function execute(requestJson, measured) {
    const start = measured ? performance.now() : 0;
    const bytes = encoder.encode(requestJson);
    if (!bytes.length || bytes.length > MAX_REQUEST_BYTES) throw new Error('Invalid Enbu request size');
    const pointer = exports.senkei_alloc(bytes.length);
    if (!pointer || pointer + bytes.length > exports.memory.buffer.byteLength) {
      throw new Error('Enbu input allocation failed');
    }
    let responsePointer = 0;
    let responseLength = 0;
    let response;
    let beforeDispatch = 0;
    let afterDispatch = 0;
    let memoryBytes = 0;
    try {
      new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
      if (measured) beforeDispatch = performance.now();
      const packed = exports.senkei_dispatch(pointer, bytes.length);
      if (measured) afterDispatch = performance.now();
      if (typeof packed !== 'bigint') throw new Error('Invalid Enbu ABI return type');
      responsePointer = Number(packed & 0xffffffffn);
      responseLength = Number((packed >> 32n) & 0xffffffffn);
      if (!responsePointer || !responseLength || responseLength > MAX_RESPONSE_BYTES ||
          responsePointer + responseLength > exports.memory.buffer.byteLength) {
        throw new Error('Invalid Enbu response bounds');
      }
      response = decoder.decode(new Uint8Array(
        exports.memory.buffer, responsePointer, responseLength).slice());
      memoryBytes = exports.memory.buffer.byteLength;
    } finally {
      exports.senkei_dealloc(pointer, bytes.length);
      if (responsePointer && responseLength &&
          responsePointer + responseLength <= exports.memory.buffer.byteLength) {
        exports.senkei_dealloc(responsePointer, responseLength);
      }
    }
    if (!measured) return {response};
    const end = performance.now();
    return {response, timing: {
      host_input_ms: beforeDispatch - start,
      wasm_dispatch_ms: afterDispatch - beforeDispatch,
      host_output_ms: end - afterDispatch,
      total_ms: end - start,
      memory_bytes: memoryBytes,
      input_bytes: bytes.length,
      output_bytes: responseLength,
    }};
  }

  function dispatchJson(requestJson) { return execute(requestJson, false).response; }
  dispatchJson.profile = requestJson => execute(requestJson, true);
  return dispatchJson;
}
