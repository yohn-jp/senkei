import { expect, test } from "@playwright/test";

for (const width of [320, 390, 430, 1440]) test(`Library tab keyboard focus survives delayed screen focus at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("journey-home")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("nav-next").click();
  await page.locator("#next-tab-analysis").click();
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  const saved = library.getByRole("tab", { name: "S14 · Library", exact: true });
  const recovery = library.getByRole("tab", { name: "S15 · Recovery", exact: true });
  await saved.focus();
  await saved.press("ArrowRight");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(recovery).toHaveAttribute("aria-selected", "true");
  await expect(recovery).toBeFocused();
  await recovery.press("ArrowLeft");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(saved).toBeFocused();
  await library.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("next-library")).toHaveCount(0);
  await page.getByTestId("nav-library").click();
  await expect(library.locator("h2")).toBeFocused();
});
