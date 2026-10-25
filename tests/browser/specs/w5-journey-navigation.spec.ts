import { expect, test } from "@playwright/test";

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
