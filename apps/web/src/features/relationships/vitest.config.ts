import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["apps/web/src/features/relationships/**/*.test.ts"] } });
