import { expect, test } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";

test("S06 connects the confirmed Run and selected display Tick to its editable skill plan", async ({ page, baseURL }) => {
  test.setTimeout(360_000);
  if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う", exact: true }).click();
  await page.getByRole("button", { name: "この条件で進む", exact: true }).click();
  await page.getByTestId("journey-preset").getByRole("button", { name: "準備確認へ", exact: true }).click();
  await completePreflight(page);
  await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });

  const checkLiveRunContext = async (): Promise<void> => {
    await page.locator("#next-tab-formation").click();
    const atelier = page.getByRole("tablist", { name: "Hero Atelier" });
    await atelier.getByRole("tab", { name: "Skill Tree" }).click();
    const context = page.getByLabel("Run skill acquisition context");
    await expect(context).toBeVisible();
    await expect(context).toContainText(/Match .+ · Tick -?\d+ · Experiment /);
    await expect(context.locator("header strong")).toContainText("Observed");
    await expect(context).toContainText("Planned · Not acquired");
    await expect(context).not.toContainText("No confirmed Run is available");
    await expect(page.getByText("Choose one branch for the match", { exact: true })).toBeVisible();
  };
  await checkLiveRunContext();
  await page.setViewportSize({ width: 390, height: 844 });
  await checkLiveRunContext();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(pageErrors).toEqual([]);
});
