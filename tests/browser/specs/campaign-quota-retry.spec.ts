import { expect, test } from "@playwright/test";
import { campaignCore } from "../helpers/campaign-core";
import { nativeCampaignFixture, nativeCampaignStore } from "../helpers/native-campaign-fixture";
import { completePreflight } from "../helpers/preflight";

test("A real Campaign clear survives quota failure and same-package Core retry", async ({ page }) => {
  test.setTimeout(600_000);
  const fixture = await nativeCampaignFixture("first-march"), core = await campaignCore();
  const compilation = core("compile_text", { ruleset_ref: fixture.rules.ruleset, source: fixture.source });
  const key = `senkei.next-campaign-progress.v2:${fixture.rules.ruleset.digest}`;
  await page.goto("/");
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), key)).not.toBeNull();
  const original = await page.evaluate(key => localStorage.getItem(key), key);
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  await library.getByLabel("Import Next experiment file").setInputFiles({ name: "actual-native-first-march.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(nativeCampaignStore(fixture, compilation.estimated_cu))) });
  await library.getByRole("button", { name: "Open latest comparison", exact: true }).click();
  await page.evaluate(() => {
    const state = window as unknown as { campaignQuotaBlocked: boolean; campaignReads: number };
    state.campaignQuotaBlocked = true; state.campaignReads = 0;
    const set = Storage.prototype.setItem, get = Storage.prototype.getItem;
    Storage.prototype.setItem = function (key, value) {
      if (state.campaignQuotaBlocked && key.startsWith("senkei.next-campaign-progress.v2:")) throw new DOMException("Campaign quota probe", "QuotaExceededError");
      return set.call(this, key, value);
    };
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("senkei.next-campaign-progress.v2:")) state.campaignReads += 1;
      return get.call(this, key);
    };
  });
  await page.getByRole("button", { name: /同条件で再戦 · Run Snapshot/ }).click();
  await completePreflight(page);
  const confirmed = page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i);
  await expect(confirmed).toBeVisible({ timeout: 300_000 });
  await expect(confirmed).toContainText("Attacker Victory");
  await expect(page.getByTestId("campaign-storage-error")).toContainText("Progress in this session remains available");
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(original);
  const showRecords = async () => {
    await page.getByTestId("nav-home").click();
    await page.getByTestId("journey-home").getByRole("button", { name: "戦役を始める", exact: true }).click();
    return page.getByRole("region", { name: "Campaign completion records" });
  };
  await expect(await showRecords()).toContainText("攻略記録 1 / 6 · 解放 2");
  await page.getByTestId("nav-library").click();
  await library.getByRole("tab", { name: "S15 · Recovery", exact: true }).click();
  const reads = await page.evaluate(() => (window as unknown as { campaignReads: number }).campaignReads);
  await library.getByRole("button", { name: "Retry Core / Catalog", exact: true }).last().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { campaignReads: number }).campaignReads)).toBeGreaterThan(reads);
  await expect(await showRecords()).toContainText("攻略記録 1 / 6 · 解放 2");
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(original);
  await page.evaluate(() => { (window as unknown as { campaignQuotaBlocked: boolean }).campaignQuotaBlocked = false; });
  await page.getByTestId("campaign-storage-error").getByRole("button", { name: "Retry progress save", exact: true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).toMatchObject({ completed_scenario_ids: ["first-march"], unlocked_scenario_ids: ["first-march", "read-the-map"] });
});
