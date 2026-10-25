import { expect, test } from "@playwright/test";

test("real WASM local PvE journey remains playable offline", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const firstRevisionSource = `senkei careful_march {
    action advance_until_tick_40 {
        when match.tick < 40,
        do move_forward(argmin unit in allies.units by unit.position then unit.slot_id),
    },
    action deploy_ready_reserve {
        when match.tick >= 4,
        do deploy(
            argmin barracks in allies.barracks by barracks.resources then barracks.id,
            argmin reserve in filter reserve in allies.reserves {
                reserve.available_tick <= match.tick,
            } by reserve.available_tick then reserve.slot_id,
            mid,
        ),
    },
}`;
  const secondRevisionSource = firstRevisionSource.replace("match.tick < 40", "match.tick < 24");
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
  await page.getByTestId("nav-editor").click();
  await expect(page.getByRole("heading", { name: "Build a formation and its tactics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "No-code" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();
  const starterProgram = await page.locator(".editor-digest").innerText();

  await page.getByRole("button", { name: "Jinrei text" }).click();
  const sourceEditor = page.getByRole("textbox", { name: "Jinrei source" });
  await expect(sourceEditor).toBeVisible();
  await sourceEditor.fill(firstRevisionSource);
  const credits = page.getByRole("spinbutton", { name: "Starting Credits" });
  await credits.fill("30");
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();
  await expect.poll(() => page.locator(".editor-digest").innerText()).not.toBe(starterProgram);
  const firstRevisionProgram = await page.locator(".editor-digest").innerText();

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

  await navigation.getByRole("button", { name: "旧版 Library", exact: true }).click();
  await page.getByPlaceholder("Strategy name").fill("Offline campaign journey");
  await page.getByRole("button", { name: "Create document" }).click();
  const savedDocument = page.getByRole("button", { name: "Open Offline campaign journey" });
  await expect(savedDocument).toBeVisible();
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByText("REV 2", { exact: true })).toBeVisible();

  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await browserContext.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible({ timeout: 30_000 });
  await navigation.getByTestId("nav-editor").click();
  await navigation.getByRole("button", { name: "旧版 Library", exact: true }).click();
  await page.getByRole("button", { name: "Open Offline campaign journey" }).click();
  await expect(page.getByRole("heading", { name: "Offline campaign journey" })).toBeVisible();
  await navigation.getByRole("button", { name: /Tactics/ }).click();
  const offlineSource = page.getByRole("textbox", { name: "Jinrei source" });
  await expect(offlineSource).toBeVisible();
  await expect(offlineSource).toHaveValue(firstRevisionSource);
  const offlineCredits = page.getByRole("spinbutton", { name: "Starting Credits" });
  await expect(offlineCredits).toHaveValue("30");
  await offlineSource.fill(secondRevisionSource);
  await offlineCredits.fill("31");
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();
  await expect.poll(() => page.locator(".editor-digest").innerText()).not.toBe(firstRevisionProgram);
  await navigation.getByRole("button", { name: /Battle lab/ }).click();
  await expect(page.getByText("No battle result")).toBeVisible();
  await page.getByLabel("Include tactical diagnostics").check();
  await expect(run).toBeEnabled({ timeout: 30_000 });
  await run.click();
  await expect(page.getByText("ENBU MATCH RESULT")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Tactics & CU trace" })).toBeVisible();
  const replayTick = page.getByRole("slider", { name: "Seek to replay tick" });
  await replayTick.focus();
  await replayTick.press("Home");
  for (let tick = 0; tick < 4; tick += 1) await replayTick.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Tick 4 activity" })).toBeVisible();
  await expect(page.getByText("Unit Deployed", { exact: true })).toBeVisible();
  const acceptedDeployRow = page.locator("li.diagnostic-row")
    .filter({ has: page.locator("span.status-accepted") })
    .filter({ hasText: "deploy_ready_reserve" });
  await expect(acceptedDeployRow).toHaveCount(1);
  await expect(acceptedDeployRow.locator("strong")).toHaveText("deploy_ready_reserve");
  await expect(acceptedDeployRow.locator("small")).toContainText("Attacker · tick 4");
  await navigation.getByRole("button", { name: "旧版 Library", exact: true }).click();
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByText("REV 3", { exact: true })).toBeVisible();

  // Reopen the latest saved revision while still offline. It must retain its
  // rematch result, and running again must produce a fresh result as well.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("navigation", { name: "Workspace" }).getByTestId("nav-editor").click();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "旧版 Library", exact: true }).click();
  await page.getByRole("button", { name: "Open Offline campaign journey" }).click();
  await expect(page.getByRole("heading", { name: "Offline campaign journey" })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: /Tactics/ }).click();
  const finalSource = page.getByRole("textbox", { name: "Jinrei source" });
  await expect(finalSource).toHaveValue(secondRevisionSource);
  await expect(page.getByRole("spinbutton", { name: "Starting Credits" })).toHaveValue("31");
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: /Battle lab/ }).click();
  const reloadedRun = page.getByRole("button", { name: "Run simulation" });
  await expect(reloadedRun).toBeEnabled({ timeout: 30_000 });
  await reloadedRun.click();
  await expect(page.getByText("ENBU MATCH RESULT")).toBeVisible({ timeout: 60_000 });

  expect(wasmResponses.some((response) => response.status === 200)).toBe(true);
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
