import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.use({ video: "on" });

test("real WASM Next workbench supports editing, replay, rematch, mobile and offline restore", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");

  const pageErrors: string[] = [];
  const wasmResponses: { readonly status: number; readonly fromServiceWorker: boolean }[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.context().on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) {
      wasmResponses.push({ status: response.status(), fromServiceWorker: response.fromServiceWorker() });
    }
  });

  await page.setViewportSize({width:1440,height:900});
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByTestId("nav-next").click();
  await expect(page.getByRole("heading", { name: /Battle workbench/ })).toBeVisible();
  await expect(page.getByText("REAL LOCAL SIMULATION")).toBeVisible();

  await expect(page.getByRole("region", {name:"Squad formation preview"})).toContainText("Quintet");
  await page.locator(".next-catalog-card").nth(1).click();
  await page.getByLabel("Skill path").selectOption("path_b");
  await page.locator("#next-tab-jinrei").click();
  const source = page.getByRole("textbox", { name: "Jinrei source" });
  const starterSource = await source.inputValue();
  const editedSource = starterSource.replace("when true,", "when match.tick < 374,");
  expect(editedSource).not.toBe(starterSource);
  await source.fill(editedSource);
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();
  await page.getByRole("button", { name: "Save setup" }).click();
  await expect(page.getByText("matches the current ruleset and can be restored.")).toBeVisible();

  await page.locator("#next-tab-battle").click();
  const diagnostics = page.getByRole("checkbox", { name: /Include my local replay and diagnostics/ });
  await expect(diagnostics).toBeChecked();
  const launch = page.getByRole("button", { name: "Launch local battle" });
  await expect(launch).toBeEnabled();
  await launch.click();
  await expect(page.getByText("AUTHORITATIVE ENBU RESULT")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".next-result-strip")).toContainText(/Attacker Victory|Defender Victory|Draw/);
  await expect(page.locator(".next-renderer-host canvas")).toHaveCount(1);

  const slider = page.getByRole("slider", { name: "Seek replay tick" });
  await slider.focus();
  await slider.press("Home");
  await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
  await page.getByRole("button", {name:"Play replay", exact:true}).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThanOrEqual(25);
  await page.getByRole("button", {name:"Pause replay", exact:true}).click();
  const pausedTick = await slider.inputValue();
  await page.waitForTimeout(250);
  await expect(slider).toHaveValue(pausedTick);
  await slider.focus();
  await slider.press("End");
  await expect(page.locator(".next-tick-readout")).toContainText("/");
  await expect(page.locator(".next-stage-hud")).not.toContainText(/\b0 VISIBLE ENTITIES\b/);
  const pixelToggle = page.getByRole("button", {name:"Toggle Pixel 3D"});
  await pixelToggle.click();
  await expect(pixelToggle).toHaveAttribute("aria-pressed","false");
  mkdirSync("../../docs/evidence/next", { recursive:true });
  await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
  await page.screenshot({path:"../../docs/evidence/next/desktop-battle.png"});
  const finalTick = await page.locator(".next-tick-readout").innerText();

  await page.locator("#next-tab-formation").click();
  await page.getByLabel("Skill path").selectOption("path_a");
  await page.locator("#next-tab-battle").click();
  const revisedRun = page.getByRole("button", { name: "Run revised battle" });
  await expect(revisedRun).toBeEnabled();
  await revisedRun.click();
  await expect(launch).toBeEnabled({timeout:90_000});
  await expect(page.getByText("AUTHORITATIVE ENBU RESULT")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Save setup" }).click();
  await expect(page.getByText("matches the current ruleset and can be restored.")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    cameraControls: getComputedStyle(document.querySelector(".next-camera-controls")!).display,
  }));
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.width);
  expect(mobileLayout.cameraControls).not.toBe("none");
  await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
  await page.screenshot({path:"../../docs/evidence/next/mobile-battle.png"});

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(async () => Boolean(await (await caches.open("senkei-web-offline-v1")).match("/wasm/senkei_wasm.wasm")));
  await page.context().setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("nav-next").click();
    await expect(page.getByText("matches the current ruleset and can be restored.")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Restore saved" }).click();
    await expect(page.locator(".next-slot-card.is-active")).toContainText("Stoneheart");
    await page.locator("#next-tab-jinrei").click();
    await expect(page.getByRole("textbox", { name: "Jinrei source" })).toHaveValue(editedSource);
    await expect(page.getByLabel("Skill path")).toHaveValue("path_a");
  } finally {
    await page.context().setOffline(false);
  }

  expect(wasmResponses.some((response) => response.status === 200)).toBe(true);
  expect(wasmResponses.some((response) => response.fromServiceWorker)).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(finalTick).toMatch(/TICK\s+\d+\s+\/\s+\d+/);
});
