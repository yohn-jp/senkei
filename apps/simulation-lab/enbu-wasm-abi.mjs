// Shared by the browser Worker and the Node native/WASM conformance gate.
// This is the same raw JSON ABI used by apps/web/src/worker/wasm-runtime.ts.
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
  return function dispatchJson(requestJson) {
    const bytes = encoder.encode(requestJson);
    if (!bytes.length || bytes.length > MAX_REQUEST_BYTES) throw new Error('Invalid Enbu request size');
    const pointer = exports.senkei_alloc(bytes.length);
    if (!pointer || pointer + bytes.length > exports.memory.buffer.byteLength) {
      throw new Error('Enbu input allocation failed');
    }
    let responsePointer = 0;
    let responseLength = 0;
    try {
      new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
      const packed = exports.senkei_dispatch(pointer, bytes.length);
      if (typeof packed !== 'bigint') throw new Error('Invalid Enbu ABI return type');
      responsePointer = Number(packed & 0xffffffffn);
      responseLength = Number((packed >> 32n) & 0xffffffffn);
      if (!responsePointer || !responseLength || responseLength > MAX_RESPONSE_BYTES ||
          responsePointer + responseLength > exports.memory.buffer.byteLength) {
        throw new Error('Invalid Enbu response bounds');
      }
      return decoder.decode(new Uint8Array(
        exports.memory.buffer, responsePointer, responseLength).slice());
    } finally {
      exports.senkei_dealloc(pointer, bytes.length);
      if (responsePointer && responseLength &&
          responsePointer + responseLength <= exports.memory.buffer.byteLength) {
        exports.senkei_dealloc(responsePointer, responseLength);
      }
    }
  };
}
