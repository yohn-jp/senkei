import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, "../..");
const port = process.env.SENKEI_BROWSER_PORT ?? "4173";
const baseURL = `http://127.0.0.1:${port}`;
const executablePath = process.env.SENKEI_CHROMIUM_EXECUTABLE;
const grep = process.env.SENKEI_BROWSER_GREP;
const grepInvert = process.env.SENKEI_BROWSER_GREP_INVERT;

// Heavy capture files use their existing viewport selectors on separate runners.
// New ordinary specs automatically join journeys, so no test allowlist can omit them.
const suite = process.env.SENKEI_BROWSER_SUITE ?? "all";
if (!["all", "journeys", "verification", "visual"].includes(suite)) {
  throw new Error(`Unknown SENKEI_BROWSER_SUITE: ${suite}`);
}
const heavySpecs = ["**/battlefield-verification.spec.ts", "**/visual-battlefield.spec.ts"];

export default defineConfig({
  testDir: "./specs",
  testMatch: suite === "verification" ? heavySpecs[0]
    : suite === "visual" ? heavySpecs[1] : "**/*.spec.ts",
  testIgnore: suite === "journeys" ? heavySpecs : [],
  ...(grep ? { grep: new RegExp(grep) } : {}),
  ...(grepInvert ? { grepInvert: new RegExp(grepInvert) } : {}),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["line"], ["json", { outputFile: resolve(configDirectory, "test-results/results.json") }]]
    : "list",
  outputDir: "./test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: { ...(executablePath ? { executablePath } : {}), args:["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.SENKEI_BROWSER_EXTERNAL_PREVIEW ? undefined : {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: repositoryRoot,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
