import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const baseURL = "http://127.0.0.1:4207";
export default defineConfig({
  testDir: "./specs", testMatch: "repair-focus-producers.spec.ts", workers: 1, timeout: 60_000,
  use: { baseURL, launchOptions: { executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
  webServer: { command: "npm run dev -- --host 127.0.0.1 --port 4207 --strictPort", cwd: root, url: baseURL, reuseExistingServer: false },
});
