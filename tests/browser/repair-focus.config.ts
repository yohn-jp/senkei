import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const baseURL = "http://127.0.0.1:4179";
export default defineConfig({
  testDir: "./component-specs", testMatch: "repair-focus-producers.spec.ts", workers: 1, timeout: 60_000,
  outputDir: "test-results/repair-focus",
  use: { baseURL, launchOptions: { executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
  webServer: { command: "npm run dev -- --host 127.0.0.1 --port 4179 --strictPort", cwd: root, url: baseURL, reuseExistingServer: false },
});
