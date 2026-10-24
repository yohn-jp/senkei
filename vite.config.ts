import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const wasmPath = resolve("apps/web/public/wasm/senkei_wasm.wasm");
const wasmRevision = existsSync(wasmPath)
  ? createHash("sha256").update(readFileSync(wasmPath)).digest("hex")
  : "unbuilt";

export default defineConfig({
  plugins: [react()],
  define: { __SENKEI_WASM_REVISION__: JSON.stringify(wasmRevision) },
  root: "apps/web",
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve("apps/web/index.html"),
        graphics: resolve("apps/web/graphics/index.html"),
      },
    },
  },
});
