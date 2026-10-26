import { expect, test } from "@playwright/test";
import { nativeCampaignFixture } from "../helpers/native-campaign-fixture";
// Native→reducer→reload evidence is separate from a live browser victory.
test("Real native final victory records completion that the browser reloads without inferring prior clears", async ({ page }) => {
  test.setTimeout(600_000);
  const fixture = await nativeCampaignFixture();
  expect(fixture.actual.result.outcome).toBe("attacker_victory");
    await page.goto("/");
    await expect(page.getByTestId("journey-home")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("senkei.next-campaign-progress.v2:")))).toBe(true);
    await page.evaluate(({ digest, current, legacy }) => {
      localStorage.setItem(`senkei.next-campaign-progress.v1:${digest}`, legacy);
      localStorage.setItem(`senkei.next-campaign-progress.v2:${digest}`, current);
    }, { digest: fixture.rules.ruleset.digest, current: fixture.current, legacy: fixture.legacy });
    await page.reload();
    await page.getByRole("button", { name: "戦役を始める", exact: true }).click();
    const records = page.getByRole("region", { name: "Campaign completion records" });
    await expect(records).toContainText("攻略記録 1 / 6");
    await expect(records).toContainText("最終課題：攻略記録あり");
    await expect(records).toContainText("以前の全課題の攻略までは確認できません");
    await expect(page.getByRole("button", { name: /March to the lane/ })).toContainText("攻略履歴不明");
    await expect(page.getByRole("button", { name: /Regroup for a base defense/ })).toContainText("攻略済み");
    expect(await page.evaluate(digest => localStorage.getItem(`senkei.next-campaign-progress.v1:${digest}`), fixture.rules.ruleset.digest)).toBe(fixture.legacy);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(records).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "test-results/campaign-native-final-390.png", fullPage: true });

});
