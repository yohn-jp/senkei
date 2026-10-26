import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baseURL = "http://127.0.0.1:4213";
export default defineConfig({
  testDir: "./component-specs", testMatch: "skill-atelier.spec.ts", workers: 1, timeout: 60_000,
  outputDir: "./test-results/skill-atelier",
  use: { baseURL, trace: "retain-on-failure", launchOptions: { executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
  webServer: { command: "npm run dev -- --host 127.0.0.1 --port 4213 --strictPort", cwd: root, url: baseURL, reuseExistingServer: false },
});
