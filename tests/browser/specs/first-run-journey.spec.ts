import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const journeyScreenshots = resolve(process.env.SENKEI_UX_EVIDENCE_DIR ?? resolve(repositoryRoot, "test-results/ux-session-1"));
const viewports = [
  { width: 320, height: 780, name: "mobile-320" },
  { width: 390, height: 844, name: "mobile-390" },
  { width: 430, height: 932, name: "mobile-430" },
  { width: 1440, height: 900, name: "desktop-1440" },
  { width: 1920, height: 1080, name: "desktop-1920" },
] as const;

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page, width: number): Promise<void> {
  // Restoring two complete Enbu records after a viewport reload can occupy
  // the main thread beyond the DOM assertion default (measured 4.3s).
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
    timeout: 30_000,
    message: `The ${width}px journey must fit its viewport after local recovery finishes`,
  }).toBeLessThanOrEqual(width);
}

async function enterQuickReady(page: import("@playwright/test").Page, viewportName: string): Promise<void> {
  await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う" }).click();
  await expect(page.getByTestId("journey-conditions")).toBeVisible();
  await expect(page.getByTestId("journey-conditions")).toContainText("ローカルPvE");
  await expect(page.getByTestId("journey-conditions")).toContainText("同梱Starter");
  await page.screenshot({ path: resolve(journeyScreenshots, `${viewportName}-conditions.png`) });
  await page.getByRole("button", { name: "この条件で進む" }).click();
  await expect(page.getByTestId("journey-preset")).toBeVisible();
  if (viewportName.startsWith("mobile")) {
    const mobilePreset = page.getByTestId("journey-preset").locator(".journey-preset-mobile");
    await expect(mobilePreset.getByText("Hero 1 / 5")).toBeVisible();
    await mobilePreset.getByRole("button", { name: "次のHero" }).click();
    await expect(mobilePreset.getByText("Hero 2 / 5")).toBeVisible();
    await mobilePreset.getByRole("button", { name: "前のHero" }).click();
    await expect(mobilePreset.getByText("Hero 1 / 5")).toBeVisible();
    const allHeroes = mobilePreset.getByText("5 Heroの全体を確認");
    await allHeroes.click();
    await expect(mobilePreset.locator(".journey-heroes li")).toHaveCount(5);
    await allHeroes.click();
  } else {
    await expect(page.locator(".journey-preset-mobile")).toBeHidden();
    await expect(page.locator(".journey-desktop .journey-heroes li")).toHaveCount(5);
  }
  await page.screenshot({ path: resolve(journeyScreenshots, `${viewportName}-preset.png`) });
  await page.getByRole("button", { name: "準備確認へ" }).click();
  await expect(page.getByTestId("journey-ready")).toBeVisible();
  if (viewportName.startsWith("mobile")) {
    await expect(page.locator(".journey-ready-grid")).toBeHidden();
    await expect(page.locator(".journey-ready-mobile")).toBeVisible();
  } else {
    await expect(page.locator(".journey-ready-grid")).toBeVisible();
    await expect(page.locator(".journey-ready-mobile")).toBeHidden();
  }
}

test("first-run Quick reaches a confirmed Enbu replay on mobile and desktop layouts", async ({ page, baseURL }) => {
  test.setTimeout(600_000);
  if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");
  mkdirSync(journeyScreenshots, { recursive: true });
  const wasmResponses: number[] = [];
  const viewportRunReport: { viewport: string; result: string; finalTick: number; rendered: string | null; wasm200: boolean }[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.context().on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) wasmResponses.push(response.status());
  });

  for (const viewport of viewports) {
    const responseStart = wasmResponses.length;
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(baseURL, { waitUntil: "networkidle" });
    await expect(page.getByTestId("journey-home")).toBeVisible();
    await expectNoHorizontalOverflow(page, viewport.width);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(journeyScreenshots, `${viewport.name}-home.png`) });
    await enterQuickReady(page, viewport.name);
    await expect(page.getByRole("button", { name: "検証・コンパイル" })).toBeVisible();
    await expect(page.getByRole("button", { name: "戦闘開始" })).toBeDisabled();
    await page.screenshot({ path: resolve(journeyScreenshots, `${viewport.name}-ready.png`) });
    await page.getByRole("button", { name: "検証・コンパイル" }).click();
    await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
    await page.getByRole("button", { name: "戦闘開始" }).click();
    await expect(page.locator(".next-workspace")).toBeVisible();
    await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
    const canvas = page.locator(".next-renderer-host canvas");
    await expect(canvas).toHaveAttribute("data-rendered", "true");
    await expect(page.getByRole("slider", { name: "Seek replay tick" })).toBeVisible();
    const resultText = await page.locator(".next-result-disclosure summary").innerText();
    const tickReadout = await page.locator(".next-tick-readout").innerText();
    const finalTick = Number(tickReadout.match(/\/\s*(\d+)/)?.[1]);
    expect(finalTick).toBeGreaterThan(0);
    const currentWasmResponses = wasmResponses.slice(responseStart);
    const wasm200 = currentWasmResponses.some((status) => status === 200);
    expect(wasm200).toBe(true);
    viewportRunReport.push({
      viewport: viewport.name,
      result: resultText.split("\n")[0],
      finalTick,
      rendered: await canvas.getAttribute("data-rendered"),
      wasm200,
    });
    await expectNoHorizontalOverflow(page, viewport.width);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(journeyScreenshots, `${viewport.name}-confirmed-replay.png`) });
  }

  expect(wasmResponses.some((status) => status === 200)).toBe(true);
  expect(pageErrors).toEqual([]);
  writeFileSync(resolve(journeyScreenshots, "viewport-run-report.json"), JSON.stringify(viewportRunReport, null, 2) + "\n");
});

test("Custom setup rejects invalid Jinrei and an invalid Squad at real Preflight, then repairs and runs", async ({ page, baseURL }) => {
  test.setTimeout(600_000);
  if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");
  mkdirSync(journeyScreenshots, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByTestId("journey-home").getByRole("button", { name: "自分で編成" }).click();
  await expect(page.getByTestId("journey-conditions")).toBeVisible();
  await page.getByRole("button", { name: "この条件で進む" }).click();

  const collection = page.getByRole("tablist", { name: "Hero Atelier" });
  await expect(collection).toBeVisible();
  await collection.getByRole("tab", { name: "Hero Collection" }).click();
  await page.locator(".next-catalog-card").nth(1).click();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Jinrei source" });
  const validSource = await source.inputValue();
  expect(validSource).toMatch(/^senkei next_orders/m);

  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILED");

  const invalidSource = "this is not valid Jinrei";
  await source.fill(invalidSource);
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILE REQUIRED");
  await page.screenshot({ path: resolve(journeyScreenshots, "custom-stale-compile.png") });
  await page.getByRole("button", { name: "準備確認へ" }).click();
  await expect(page.getByTestId("journey-ready")).toBeVisible();
  await page.getByRole("button", { name: "検証・コンパイル" }).click();
  await expect(page.getByTestId("preflight-status")).toContainText("不正", { timeout: 60_000 });
  await expect(page.getByTestId("journey-ready").getByRole("alert").getByText("不正・開始拒否")).toBeVisible();
  await expect(page.getByRole("button", { name: "戦闘開始" })).toBeDisabled();
  await page.screenshot({ path: resolve(journeyScreenshots, "custom-invalid-jinrei-preflight.png") });
  await page.getByRole("button", { name: "Jinreiを変更" }).first().click();
  await expect(source).toBeVisible();

  await source.fill(validSource);
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILED");
  await page.getByRole("button", { name: "準備確認へ" }).click();
  await page.getByRole("button", { name: "Squad・起点を変更" }).click();

  await collection.getByRole("tab", { name: "Squad Assembly" }).click();
  const split = page.getByRole("button", { name: "Use squad split 2+1+1+1" });
  await split.click();
  await expect(split).toHaveAttribute("aria-pressed", "true");
  const secondHeroSquad = page.getByRole("combobox", { name: /Squad for/ }).nth(1);
  const firstSquadNode = page.getByRole("combobox", { name: "Starting node for Squad 1" });
  const originalNode = await firstSquadNode.inputValue();
  const nodeOptions = await firstSquadNode.locator("option").evaluateAll((options) => options
    .filter((option) => !option.disabled && option.value)
    .map((option) => option.value));
  const otherNode = nodeOptions.find((node) => node !== originalNode) ?? null;
  expect(otherNode).toBeTruthy();
  await secondHeroSquad.selectOption("squad-2");
  await firstSquadNode.selectOption(otherNode!);
  await secondHeroSquad.selectOption("squad-1");
  await expect(page.getByRole("alert").filter({ hasText: "This Squad has multiple starting nodes." })).toBeVisible();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILE REQUIRED");
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "準備確認へ" }).click();
  await page.getByRole("button", { name: "検証・コンパイル" }).click();
  await expect(page.getByTestId("preflight-status")).toContainText("不正", { timeout: 60_000 });
  await expect(page.getByTestId("journey-ready").getByRole("alert")).toContainText(/spans multiple map nodes/i);
  await expect(page.getByRole("button", { name: "戦闘開始" })).toBeDisabled();
  await page.screenshot({ path: resolve(journeyScreenshots, "custom-invalid-enbu-preflight.png") });

  await page.getByRole("button", { name: "Squad・起点を変更" }).first().click();
  await collection.getByRole("tab", { name: "Squad Assembly" }).click();
  await firstSquadNode.selectOption(originalNode);
  await expect(firstSquadNode).toHaveValue(originalNode);
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILE REQUIRED");
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "準備確認へ" }).click();
  await page.getByRole("button", { name: "検証・コンパイル" }).click();
  await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
  await page.getByRole("button", { name: "戦闘開始" }).click();
  await expect(page.getByTestId("journey-running")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(journeyScreenshots, "custom-enbu-running.png") });
  await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-rendered", "true");
});

test("Continue preserves the pinned setup and separately restores the latest unsaved draft", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");
  mkdirSync(journeyScreenshots, { recursive: true });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByTestId("nav-next").click();
  await expect(page.getByRole("heading", { name: /Battle workbench|Battlefield console/ })).toBeVisible();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Jinrei source" });
  const pinnedSource = await source.inputValue();
  const unsavedSource = pinnedSource.replace("advance_01", "advance_01_recovered");
  expect(unsavedSource).not.toBe(pinnedSource);

  await page.getByRole("button", { name: "Save setup" }).click();
  await expect(page.getByText("matches the current ruleset and can be restored.")).toBeVisible();
  await source.fill(unsavedSource);
  await expect(page.getByText("Unsaved edits are automatically saved as a separate local recovery copy.")).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("journey-home").getByRole("button", { name: "続きから" }).click();
  await expect(page.getByTestId("next-library")).toBeVisible();
  await page.screenshot({ path: resolve(journeyScreenshots, "continue-resume-options.png") });
  await page.getByRole("button", { name: "Readyへ" }).click();
  await page.getByRole("button", { name: "Jinreiを変更" }).first().click();
  await expect(page.getByRole("heading", { name: /Battle workbench|Battlefield console/ })).toBeVisible();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await expect(source).toHaveValue(unsavedSource);
  await expect(page.getByText(/Recovered this unsaved draft after reload/)).toBeVisible();

  await page.getByRole("button", { name: "Restore saved" }).click();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await expect(source).toHaveValue(pinnedSource);
  await page.screenshot({ path: resolve(journeyScreenshots, "continue-restored-pinned-setup.png") });
});
