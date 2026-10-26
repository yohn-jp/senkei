import { defineConfig } from "@playwright/test";
const port = process.env.SENKEI_ART_PORT ?? "4186";
export default defineConfig({
  testDir: "../../tests/visual/art-production",
  outputDir: "../../test-results/art-production/playwright",
  workers: 1, fullyParallel: false, timeout: 360_000,
  expect: { timeout: 20_000 }, reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1, reducedMotion: "reduce", trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE,
      args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: process.env.SENKEI_ART_EXTERNAL_SERVER ? undefined : {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "../..", url: `http://127.0.0.1:${port}`, reuseExistingServer: false,
  },
});
