import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, "../..");
const port = process.env.SENKEI_BROWSER_PORT ?? "4173";
const baseURL = `http://127.0.0.1:${port}`;
const executablePath = process.env.SENKEI_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : "list",
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
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
