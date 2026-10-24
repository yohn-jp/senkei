import { expect, test } from "@playwright/test";

test("real WASM local PvE journey remains playable offline", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  const wasmResponses: { readonly status: number; readonly fromServiceWorker: boolean }[] = [];
  const browserContext = page.context();

  browserContext.on("request", (request) => {
    if (new URL(request.url()).origin !== baseURL) externalRequests.push(request.url());
  });
  browserContext.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) {
      wasmResponses.push({ status: response.status(), fromServiceWorker: response.fromServiceWorker() });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Build a formation and its tactics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "No-code" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();

  await page.getByRole("button", { name: "Jinrei text" }).click();
  const sourceEditor = page.getByRole("textbox", { name: "Jinrei source" });
  await expect(sourceEditor).toBeVisible();
  await sourceEditor.fill(`${await sourceEditor.inputValue()}\n// edited in the browser journey\n`);
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "Workspace" });
  await navigation.getByRole("button", { name: /Battle lab/ }).click();
  await page.getByRole("button", { name: /Marching line/ }).click();
  await page.getByLabel("Include tactical diagnostics").check();
  const run = page.getByRole("button", { name: "Run simulation" });
  await expect(run).toBeEnabled({ timeout: 30_000 });
  await run.click();
  await expect(page.getByText("ENBU MATCH RESULT")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Tactics & CU trace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conditions & intents" })).toBeVisible();

  await navigation.getByRole("button", { name: /Library/ }).click();
  await page.getByPlaceholder("Strategy name").fill("Offline campaign journey");
  await page.getByRole("button", { name: "Create document" }).click();
  const savedDocument = page.getByRole("button", { name: "Open Offline campaign journey" });
  await expect(savedDocument).toBeVisible();
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByText("REV 2")).toBeVisible();

  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await browserContext.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible({ timeout: 30_000 });
  await navigation.getByRole("button", { name: /Library/ }).click();
  await page.getByRole("button", { name: "Open Offline campaign journey" }).click();
  await expect(page.getByRole("heading", { name: "Offline campaign journey" })).toBeVisible();
  await navigation.getByRole("button", { name: /Tactics/ }).click();
  const offlineSource = page.getByRole("textbox", { name: "Jinrei source" });
  await expect(offlineSource).toBeVisible();
  await offlineSource.fill(`${await offlineSource.inputValue()}\n// recompiled after offline reload\n`);
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();
  await navigation.getByRole("button", { name: /Battle lab/ }).click();
  await expect(page.getByText("No battle result")).toBeVisible();
  await expect(run).toBeEnabled({ timeout: 30_000 });
  await run.click();
  await expect(page.getByText("ENBU MATCH RESULT")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Tactics & CU trace" })).toBeVisible();

  expect(wasmResponses.some((response) => response.status === 200)).toBe(true);
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
