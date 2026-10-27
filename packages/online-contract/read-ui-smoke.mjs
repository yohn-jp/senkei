#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: "127.0.0.1", port: 0 }, appType: "mpa" });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/packages/online-contract/fixtures/read-ui.html`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  await page.goto(`${base}?mode=unavailable`);
  await page.getByText("The official service is not configured.").waitFor();
  assert.equal(await page.getByRole("button").count(), 0);
  await page.goto(base);
  const search = page.getByRole("button", { name: "Search" });
  const filter = page.getByLabel("Search");
  await page.getByText("Not fetched from the authority.").waitFor();
  await search.click();
  await page.getByText(/real-item/).waitFor();
  await filter.fill("missing"); await search.click();
  await page.getByText("No results match this filter; other results exist.").waitFor();
  await filter.fill("failure"); await search.click();
  await page.getByText("The official read could not be verified or completed. Retry.").waitFor();
  await page.getByRole("button", { name: "Retry" }).click();
  await page.getByText(/real-item/).waitFor();
  await filter.fill("denied"); await search.click();
  await page.getByText("This account is not authorized to read the requested data.").waitFor();
  await filter.fill("slow"); await search.click();
  await filter.fill("fresh"); await search.click();
  await page.getByText(/real-item/).waitFor();
  await page.waitForTimeout(400);
  assert.equal(await page.getByText(/stale-item/).count(), 0);
  console.log("PASS: unavailable/no controls, authenticated read, filtered empty, failure/retry, denied and stale response isolation (synthetic producer)");
} finally {
  await browser?.close();
  await server.close();
}
