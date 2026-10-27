import { expect, test } from "@playwright/test";
for (const width of [1440, 390]) {
  test(`local equipment recovery preserves authority at ${width}px`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto("/");
    if (width < 761) await page.getByTestId("journey-home").locator(".journey-start-mobile details > summary").click();
    await page.getByRole("button", { name: "自分で編成", exact: true }).click();
    await page.getByRole("button", { name: "この条件で進む" }).click();
    await page.getByText("Local trial equipment", { exact: true }).click();
    await page.getByLabel("Local Player identity").fill("trial-player");
    await page.getByRole("button", { name: "Load / retry" }).click();
    await expect(page.getByText("No local equipment owned by this Player.")).toBeVisible();
    await page.getByRole("button", { name: "Prepare export" }).click();
    const archive = page.getByLabel("Local equipment recovery archive");
    await expect(archive).toHaveValue(/"schemaVersion": 1/);
    const original = await archive.inputValue();
    await archive.fill(original.replace('"schemaVersion": 1', '"schemaVersion": 99'));
    await page.getByRole("button", { name: "Validate and recover local archive" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Storage operation failed" })).toBeVisible();
    await archive.fill(original);
    await page.getByRole("button", { name: "Validate and recover local archive" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Local recovery committed" })).toBeVisible();
    await expect(page.getByText(/Official assets, rewards, draws and market: not configured/)).toBeVisible();
    await context.close();
  });
}
