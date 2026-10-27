import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`owner decision inspection uses the retained real Run at ${width}px`, async ({ page }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    await page.getByTestId("nav-next").click();
    await page.getByText("Local ownership and runtime", { exact: true }).click();
    const enable = page.getByRole("button", { name: "Enable test-only owned runtime", exact: true });
    if (await enable.isVisible()) await enable.click();
    await expect(page.getByRole("status").filter({ hasText: "Test-only six-domain runtime enabled" })).toBeVisible({ timeout: 60_000 });
    const owned = page.getByRole("region", { name: "Owned Heroes and local assets" });
    await owned.getByRole("button", { name: "Obtain trial roster" }).click();
    for (let index = 1; index <= 5; index++) {
      const select = owned.getByRole("combobox", { name: `Slot slot-0${index}`, exact: true });
      await expect.poll(() => select.locator("option").count()).toBeGreaterThan(5);
      const id = await select.locator("option").nth(index).getAttribute("value");
      expect(id).toBeTruthy();
      await select.selectOption(id!);
    }
    await page.getByLabel("Trial tick limit").fill("3");
    await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
    await page.getByRole("button", { name: "検証・コンパイル", exact: true }).click();
    await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
    await page.getByRole("button", { name: "戦闘開始", exact: true }).click();
    await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
    await page.locator("#next-tab-analysis").click();
    const disclosure = page.locator("#next-panel-analysis details.next-decision-inspector");
    await disclosure.locator("summary").first().click();
    const inspector = page.getByRole("region", { name: "Next Behavior decision inspection" });
    await expect(inspector.getByText(/test-only policy/)).toBeVisible({ timeout: 30_000 });
    const hero = inspector.getByRole("combobox", { name: "Owner Hero" });
    await expect(hero.locator("option")).toHaveCount(5);
    await inspector.getByRole("spinbutton", { name: "Tick" }).fill("1");
    await inspector.getByRole("button", { name: "Inspect decision", exact: true }).click();
    const result = inspector.getByRole("region", { name: "Decision inspection result" });
    await expect(result).toBeVisible({ timeout: 180_000 });
    await expect(result).toContainText("result digest matches the retained Run");
    await expect(result).toContainText("original decision trace is not independently proven");
    await expect(result).toContainText("Status: evaluated");
    await expect(result).toContainText("test-only");
    await result.getByText("Actual observation", { exact: true }).click();
    await expect(result).toContainText("Observed IDs are local aliases");
    const candidates = result.locator("details.decision-entry");
    await expect(candidates.first()).toBeVisible();
    await candidates.first().locator("summary").click();
    await expect(candidates.first()).toContainText("Arguments:");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const firstHero = await hero.inputValue();
    const secondHero = await hero.locator("option").nth(1).getAttribute("value");
    expect(secondHero).toBeTruthy();
    expect(secondHero).not.toBe(firstHero);
    await hero.selectOption(secondHero!);
    await expect(result).toHaveCount(0);
    await inspector.getByRole("button", { name: "Inspect decision", exact: true }).click();
    await expect(result).toBeVisible({ timeout: 180_000 });
    await expect(result).toContainText("Status: evaluated");
  });
}
