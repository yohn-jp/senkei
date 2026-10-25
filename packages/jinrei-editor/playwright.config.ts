import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4182",
    launchOptions: {
      executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE,
      args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: "npm run dev",
    cwd: process.cwd(),
    url: "http://127.0.0.1:4182/harness.html",
    reuseExistingServer: !process.env.CI,
  },
});
