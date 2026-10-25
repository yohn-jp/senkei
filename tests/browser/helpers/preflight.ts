import { expect, type Page } from "@playwright/test";

export async function completePreflight(page: Page): Promise<void> {
  await expect(page.getByTestId("journey-ready")).toBeVisible();
  await page.getByRole("button", { name: "検証・コンパイル" }).click();
  await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
  await page.getByRole("button", { name: "戦闘開始" }).click();
}
