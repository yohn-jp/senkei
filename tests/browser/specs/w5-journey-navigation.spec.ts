import { expect, test } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";

const viewports = [
  { width: 320, height: 780 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
] as const;

for (const viewport of viewports) test(`W5 journey navigation and recovery controls at ${viewport.width}px`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport,
    isMobile: viewport.width < 761,
    hasTouch: viewport.width < 761,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("journey-home")).toBeVisible({ timeout: 60_000 });
  if (viewport.width < 761) await page.getByText("戦役・自由編成・再開", { exact: true }).click();
  await page.getByTestId("journey-home").getByRole("button", { name: "自分で編成", exact: true }).click();
  await page.getByRole("button", { name: "この条件で進む" }).click();

  const atelier = page.getByRole("tablist", { name: "Hero Atelier" });
  const collection = atelier.getByRole("tab", { name: "Hero Collection" });
  await expect(collection).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Choose hero for slot 2" }).click();
  await page.getByRole("region", { name: "Filtered hero catalog" }).getByRole("button", { name: /F02.*Stoneheart/ }).click();
  await expect(page.getByLabel("Hero change impact")).toContainText("Stoneheart");
  const detailTab = atelier.getByRole("tab", { name: "Hero Detail" });
  await detailTab.click();
  await expect(detailTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Stoneheart" })).toBeVisible();

  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  await library.getByRole("tab", { name: "S14 · Library" }).focus();
  await library.getByRole("tab", { name: "S14 · Library" }).press("ArrowRight");
  await expect(library.getByRole("tab", { name: "S15 · Recovery" })).toBeFocused();
  await expect(library.getByRole("tab", { name: "S15 · Recovery" })).toHaveAttribute("aria-selected", "true");
  await library.getByRole("tab", { name: "S14 · Library" }).click();
  await library.getByRole("button", { name: "Save current setup", exact: true }).click();
  await library.getByRole("button", { name: "Clear pinned…", exact: true }).click();
  const confirmation = library.getByRole("alertdialog", { name: "Clear the pinned setup?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Confirm clear" })).toBeVisible();
  if (viewport.width < 761) {
    const geometry = await confirmation.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { position: style.position, bottom: rect.bottom, viewportHeight: innerHeight, confirmHeight: element.querySelector("button.is-danger")?.getBoundingClientRect().height ?? 0 };
    });
    expect(geometry.position).toBe("fixed");
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.confirmHeight).toBeGreaterThanOrEqual(44);
  }
  await confirmation.getByRole("button", { name: "Keep existing data" }).click();
  await expect(confirmation).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await context.close();
});

for (const viewport of viewports) test(`Campaign challenge picker and selected context at ${viewport.width}px`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport,
    isMobile: viewport.width < 761,
    hasTouch: viewport.width < 761,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("journey-home")).toBeVisible({ timeout: 60_000 });
  if (viewport.width < 761) await page.getByText("戦役・自由編成・再開", { exact: true }).click();
  await page.getByTestId("journey-home").getByRole("button", { name: "戦役を始める", exact: true }).click();
  const conditions = page.getByTestId("journey-conditions");
  await expect(conditions.getByRole("heading", { name: "戦役の課題を選ぶ" })).toBeVisible();
  const cards = conditions.locator(".journey-campaign-card");
  await expect(cards).toHaveCount(6);
  await expect(cards.first()).toBeEnabled();
  await expect(cards.first()).toHaveAttribute("aria-pressed", "true");
  await expect(cards.nth(1)).toBeDisabled();
  await expect(cards.first()).toContainText("見どころ");
  await conditions.getByRole("button", { name: "この課題で準備する" }).click();
  const preset = page.getByTestId("journey-preset");
  await expect(preset).toBeVisible();
  await expect(preset.locator(".journey-scenario-summary")).toContainText("SELECTED CHALLENGE");
  await expect(preset.locator(".journey-scenario-summary")).toContainText("対戦相手");
  await preset.getByRole("button", { name: "準備確認へ" }).click();
  const ready = page.getByTestId("journey-ready");
  await expect(ready.locator(".journey-ready-challenge")).toContainText("課題に登録されたNPC");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await context.close();
});

test("mobile replay event, Jinrei edit and Analysis return preserve the run and unsaved draft", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("journey-home")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う", exact: true }).click();
  await page.getByRole("button", { name: "この条件で進む" }).click();
  await page.getByRole("button", { name: "準備確認へ" }).click();
  await completePreflight(page);
  const canvas = page.locator(".next-renderer-host canvas");
  await expect(canvas).toHaveAttribute("data-rendered", "true", { timeout: 180_000 });
  await expect(page.getByText(/Confirmed result/i)).toContainText(/Attacker Victory|Defender Victory|Draw/, { timeout: 180_000 });

  await page.locator("#next-tab-analysis").click();
  const analysis = page.locator("#next-panel-analysis");
  await expect(analysis).toBeVisible();
  const event = analysis.locator(".battle-analysis-timeline li button").nth(5);
  await expect(event).toBeVisible();
  await event.click();
  const selectedTick = Number((await page.locator(".next-tick-readout").innerText()).match(/TICK\s+(\d+)/)?.[1]);
  expect(selectedTick).toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute("data-tick", String(selectedTick));
  const cameraTargetAtEvent = await canvas.getAttribute("data-camera-target");
  const cameraModeAtEvent = await canvas.getAttribute("data-camera-mode");
  expect(cameraTargetAtEvent).toBeTruthy();

  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Jinrei source" });
  const original = await source.inputValue();
  const edited = original.replace(/when ([^\n]+),/, "when and { $1, match.tick < 374, },");
  expect(edited).not.toBe(original);
  await source.fill(edited);

  // A short, phone-sized viewport approximates the visible area left by a
  // software keyboard. Keep focus and ensure the source field can be brought
  // fully into view without horizontal overflow before compiling.
  await page.setViewportSize({ width: 390, height: 450 });
  await source.scrollIntoViewIfNeeded();
  await source.focus();
  const sourceBox = await source.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(sourceBox!.y).toBeGreaterThanOrEqual(0);
  expect(sourceBox!.y + sourceBox!.height).toBeLessThanOrEqual(450);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();
  await expect(source).toHaveValue(edited);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#next-tab-analysis").click();
  await expect(page.locator("#next-panel-analysis")).toBeVisible();
  await page.locator("#next-tab-jinrei").click();
  await expect(page.getByRole("textbox", { name: "Jinrei source" })).toHaveValue(edited);
  await page.locator("#next-tab-battle").click();
  await expect(page.locator(".next-tick-readout")).toContainText(`TICK ${selectedTick}`);
  await expect(canvas).toHaveAttribute("data-tick", String(selectedTick));
  await expect(canvas).toHaveAttribute("data-camera-target", cameraTargetAtEvent!);
  await expect(canvas).toHaveAttribute("data-camera-mode", cameraModeAtEvent!);
  await expect(page.getByRole("button", { name: "Timeline view", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
