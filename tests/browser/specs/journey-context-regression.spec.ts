import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`UX-C01 campaign conditions inspection preserves Ready at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const home = page.getByTestId("journey-home");
    await expect(home).toBeVisible({ timeout: 60_000 });
    if (width < 761) await home.getByText("戦役・自由編成・再開", { exact: true }).click();
    await home.getByRole("button", { name: "戦役を始める", exact: true }).click();
    const conditions = page.getByTestId("journey-conditions");
    const selected = await conditions.locator('.journey-campaign-card[aria-pressed="true"]').innerText();
    await conditions.getByRole("button", { name: "この課題で準備する" }).click();
    await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
    const ready = page.getByTestId("journey-ready");
    await ready.getByRole("button", { name: "検証・コンパイル", exact: true }).click();
    await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
    const draftBefore = await page.locator(".journey-draft-status").innerText();
    await ready.getByRole("button", { name: "対戦条件を確認", exact: true }).filter({ visible: true }).click();
    await expect(conditions.getByRole("heading", { name: "戦役の課題を選ぶ" })).toBeVisible();
    await expect(conditions.locator('.journey-campaign-card[aria-pressed="true"]')).toHaveText(selected, { useInnerText: true });
    await conditions.getByRole("button", { name: "準備確認へ戻る", exact: true }).click();
    await expect(ready.locator(".journey-ready-challenge")).toBeVisible();
    await expect(page.getByTestId("preflight-status")).toHaveText("開始可能");
    await expect(page.locator(".journey-draft-status")).toHaveText(draftBefore);
    await ready.getByRole("button", { name: "対戦条件を確認", exact: true }).filter({ visible: true }).click();
    await conditions.locator(".journey-back").click();
    await expect(page.getByTestId("preflight-status")).toHaveText("開始可能");
    await page.screenshot({ path: `test-results/ux-c01-${width}.png`, fullPage: true });
  });

  test(`I03 saved scenario differs from Starter conditions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const home = page.getByTestId("journey-home");
    await expect(home).toBeVisible({ timeout: 60_000 });
    if (width < 761) await home.getByText("戦役・自由編成・再開", { exact: true }).click();
    await home.getByRole("button", { name: "戦役を始める", exact: true }).click();
    await page.getByRole("button", { name: "この課題で準備する" }).click();
    await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
    await page.getByTestId("nav-library").click();
    const library = page.getByTestId("next-library");
    await library.getByRole("button", { name: "Save current setup", exact: true }).click();
    await library.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator(".journey-draft-status")).toContainText("保存済み");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("senkei.next-workspace.v1")!));
    expect(saved.campaign_scenario_id).toBeTruthy();
    await page.getByTestId("journey-ready").getByRole("button", { name: "Homeへ戻る" }).click();
    await home.getByRole("button", { name: "すぐ戦う", exact: true }).click();
    await expect(page.locator(".journey-draft-status")).toContainText("未保存の変更あり");
    const unchanged = await page.evaluate(() => JSON.parse(localStorage.getItem("senkei.next-workspace.v1")!));
    expect(unchanged).toEqual(saved);
    await page.screenshot({ path: `test-results/i03-${width}.png`, fullPage: true });
  });
}
