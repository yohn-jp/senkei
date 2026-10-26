import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({ root: resolve("tools/art"), build: { outDir: resolve("dist/art"), emptyOutDir: true } });
