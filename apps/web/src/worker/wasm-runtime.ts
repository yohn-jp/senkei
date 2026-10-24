const MAX_WASM_RESPONSE_BYTES = 32 * 1024 * 1024;

interface SenkeiWasmExports extends WebAssembly.Exports {
  readonly memory: WebAssembly.Memory;
  senkei_alloc(length: number): number;
  senkei_dealloc(pointer: number, length: number): void;
  /** Returns `(response_length << 32) | response_pointer`. */
  senkei_dispatch(pointer: number, length: number): bigint;
}

export class WasmRuntimeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WasmRuntimeError";
  }
}

/**
 * Loads the same Rust JSON dispatcher used by native tests and calls its small
 * C ABI. This object is created inside the dedicated worker, so synchronous
 * Rust execution never blocks the browser's UI thread.
 */
export class WasmRuntime {
  private instancePromise: Promise<SenkeiWasmExports> | null = null;

  async dispatchJson(requestJson: string): Promise<string> {
    const exports = await this.load();
    const request = new TextEncoder().encode(requestJson);
    if (request.byteLength > 0xffff_ffff) {
      throw new WasmRuntimeError("The core request is too large for the WASM adapter.");
    }

    const requestPointer = exports.senkei_alloc(request.byteLength);
    if (!Number.isSafeInteger(requestPointer) || requestPointer <= 0) {
      throw new WasmRuntimeError("The WASM adapter could not allocate request memory.");
    }

    let responsePointer = 0;
    let responseLength = 0;
    try {
      new Uint8Array(exports.memory.buffer, requestPointer, request.byteLength).set(request);
      const response = exports.senkei_dispatch(requestPointer, request.byteLength);
      responsePointer = Number(response & 0xffff_ffffn);
      responseLength = Number((response >> 32n) & 0xffff_ffffn);

      if (
        !Number.isSafeInteger(responsePointer) ||
        !Number.isSafeInteger(responseLength) ||
        responsePointer <= 0 ||
        responseLength <= 0 ||
        responseLength > MAX_WASM_RESPONSE_BYTES ||
        responsePointer + responseLength > exports.memory.buffer.byteLength
      ) {
        throw new WasmRuntimeError("The WASM adapter returned an invalid response buffer.");
      }

      const responseBytes = new Uint8Array(
        exports.memory.buffer,
        responsePointer,
        responseLength,
      ).slice();
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(responseBytes);
      } catch (error) {
        throw new WasmRuntimeError("The WASM adapter returned invalid UTF-8.", { cause: error });
      }
    } finally {
      exports.senkei_dealloc(requestPointer, request.byteLength);
      if (responsePointer > 0 && responseLength > 0) {
        exports.senkei_dealloc(responsePointer, responseLength);
      }
    }
  }

  private load(): Promise<SenkeiWasmExports> {
    if (this.instancePromise === null) {
      this.instancePromise = this.instantiate();
    }
    return this.instancePromise;
  }

  private async instantiate(): Promise<SenkeiWasmExports> {
    const wasmUrl = new URL("/wasm/senkei_wasm.wasm", globalThis.location.href);
    wasmUrl.searchParams.set("rev", __SENKEI_WASM_REVISION__);
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new WasmRuntimeError(
        `Unable to load the local Senkei WASM module (HTTP ${response.status}).`,
      );
    }

    let instance: WebAssembly.Instance;
    try {
      const streamed = await WebAssembly.instantiateStreaming(response.clone(), {});
      instance = streamed.instance;
    } catch {
      const bytes = await response.arrayBuffer();
      const instantiated = await WebAssembly.instantiate(bytes, {});
      instance = instantiated instanceof WebAssembly.Instance
        ? instantiated
        : instantiated.instance;
    }

    const exports = instance.exports as Partial<SenkeiWasmExports>;
    if (
      !(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.senkei_alloc !== "function" ||
      typeof exports.senkei_dealloc !== "function" ||
      typeof exports.senkei_dispatch !== "function"
    ) {
      throw new WasmRuntimeError("The loaded WASM module has an incompatible Senkei ABI.");
    }
    return exports as SenkeiWasmExports;
  }
}
