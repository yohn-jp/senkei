import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["packages/**/*.test.ts", "apps/web/src/features/next/**/*.test.ts", "apps/web/src/features/progression/**/*.test.ts", "apps/web/src/features/equipment/**/*.test.ts", "apps/web/src/features/relationships/**/*.test.ts", "apps/web/src/worker/**/*.test.ts"] } });
