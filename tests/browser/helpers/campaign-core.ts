import { readFileSync } from "node:fs";
import { resolve } from "node:path";
/** Real bundled Rust/WASM ABI; test code never supplies a fabricated Core reply. */
export async function campaignCore() {
  const { instance } = await WebAssembly.instantiate(readFileSync(resolve("apps/web/public/wasm/senkei_wasm.wasm")), {});
  const memory = instance.exports.memory as WebAssembly.Memory;
  const alloc = instance.exports.senkei_alloc as (size: number) => number;
  const run = instance.exports.senkei_dispatch as (pointer: number, size: number) => bigint;
  const free = instance.exports.senkei_dealloc as (pointer: number, size: number) => void;
  return (operation: string, payload: unknown): any => {
    const bytes = new TextEncoder().encode(JSON.stringify({ api_version: { major: 1, minor: 0, patch: 0 }, request_id: "campaign-core", operation, payload }));
    const input = alloc(bytes.length); let output = 0; let size = 0;
    try {
      new Uint8Array(memory.buffer, input, bytes.length).set(bytes);
      const packed = run(input, bytes.length); output = Number(packed & 0xffff_ffffn); size = Number(packed >> 32n);
      const reply = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, output, size)));
      if (!reply.ok) throw new Error(JSON.stringify(reply.error));
      return reply.result;
    } finally { free(input, bytes.length); if (output) free(output, size); }
  };
}
