import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
const allIds = ["first-march", "read-the-map", "share-the-pressure", "jungle-objective", "bridge-approach", "protect-the-core"];
async function keys(page: Page) {
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).find(key => key.startsWith("senkei.next-campaign-progress.v2:")))).toBeTruthy();
  return page.evaluate(() => {
    const current = Object.keys(localStorage).find(key => key.startsWith("senkei.next-campaign-progress.v2:"))!;
    return { current, legacy: current.replace(".v2:", ".v1:"), digest: current.split(":")[1] };
  });
}
async function enterCampaign(page: Page, mobile: boolean) {
  const home = page.getByTestId("journey-home");
  await expect(home).toBeVisible();
  if (mobile) await home.locator(".journey-start-mobile details > summary").click();
  await home.getByRole("button", { name: "戦役を始める", exact: true }).click();
}
async function seedLegacy(page: Page, ids = allIds) {
  const storage = await keys(page);
  const raw = JSON.stringify({ format_version: 1, ruleset_digest: storage.digest, unlocked_scenario_ids: ids });
  await page.evaluate(({ current, legacy, raw }) => { localStorage.removeItem(current); localStorage.setItem(legacy, raw); }, { ...storage, raw });
  await page.reload();
  return { ...storage, raw };
}
for (const width of [1440, 390]) test(`Campaign migrates legacy unknown history without inventing clears at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  const storage = await seedLegacy(page, allIds.slice(0, 2));
  await enterCampaign(page, width < 761);
  const campaign = page.getByRole("region", { name: "ローカル戦役" });
  await expect(campaign).toContainText("攻略記録 0 / 6");
  await expect(campaign.locator(".journey-campaign-card").first()).toContainText("攻略履歴不明");
  await expect(campaign.locator(".journey-campaign-card").first()).toHaveAttribute("aria-current", "true");
  await expect(campaign.locator(".journey-campaign-card").nth(2)).toBeDisabled();
  await expect(campaign).toContainText("未プレイ");
  const stored = await page.evaluate(({ current, legacy }) => ({ current: JSON.parse(localStorage.getItem(current)!), legacy: localStorage.getItem(legacy) }), storage);
  expect(stored.current.completed_scenario_ids).toEqual([]);
  expect(stored.current.history_incomplete).toBe(true);
  expect(stored.legacy).toBe(storage.raw);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/campaign-legacy-${width}.png`, fullPage: true });
});

test("Malformed campaign originals remain exportable and block automatic overwrite", async ({ page }) => {
  await page.goto("/");
  const storage = await keys(page);
  for (const version of ["legacy", "current"] as const) {
    const raw = version === "legacy" ? "{}" : '{"format_version":2,"broken":true}';
    await page.evaluate(({ current, legacy, version, raw }) => { localStorage.removeItem(current); localStorage.removeItem(legacy); localStorage.setItem(version === "legacy" ? legacy : current, raw); }, { ...storage, version, raw });
    await page.reload();
    const error = page.getByTestId("campaign-storage-error");
    await expect(error).toContainText("automatic writes are blocked");
    const downloadEvent = page.waitForEvent("download");
    await error.getByRole("button", { name: version === "legacy" ? "Export preserved legacy progress" : "Export preserved v2 progress", exact: true }).click();
    const file = await (await downloadEvent).path();
    expect(readFileSync(file!, "utf8")).toBe(raw);
    await error.getByRole("button", { name: "Retry campaign storage", exact: true }).click();
    await expect(error).toBeVisible();
    expect(await page.evaluate(({ current, legacy, version }) => localStorage.getItem(version === "legacy" ? legacy : current), { ...storage, version })).toBe(raw);
    if (version === "legacy") expect(await page.evaluate(key => localStorage.getItem(key), storage.current)).toBeNull();
  }
});

test("Campaign quota failure preserves legacy bytes and retries the in-session migration", async ({ page }) => {
  await page.goto("/");
  const storage = await keys(page);
  const raw = JSON.stringify({ format_version: 1, ruleset_digest: storage.digest, unlocked_scenario_ids: allIds.slice(0, 2) });
  await page.evaluate(({ current, legacy, raw }) => { localStorage.removeItem(current); localStorage.setItem(legacy, raw); }, { ...storage, raw });
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, "campaignQuotaBlocked", { value: true, writable: true });
    Storage.prototype.setItem = function (key, value) {
      if ((window as unknown as { campaignQuotaBlocked: boolean }).campaignQuotaBlocked && key.startsWith("senkei.next-campaign-progress.v2:")) throw new DOMException("campaign quota full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.reload();
  const error = page.getByTestId("campaign-storage-error");
  await expect(error).toContainText("could not be saved");
  expect(await page.evaluate(key => localStorage.getItem(key), storage.legacy)).toBe(raw);
  expect(await page.evaluate(key => localStorage.getItem(key), storage.current)).toBeNull();
  await page.evaluate(() => { (window as unknown as { campaignQuotaBlocked: boolean }).campaignQuotaBlocked = false; });
  await error.getByRole("button", { name: "Retry progress save", exact: true }).click();
  await expect(error).toHaveCount(0);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storage.current);
  expect(saved.history_incomplete).toBe(true);
  expect(saved.completed_scenario_ids).toEqual([]);
  expect(await page.evaluate(key => localStorage.getItem(key), storage.legacy)).toBe(raw);
});

test("Same-digest Core reload never overwrites campaign bytes that failed the new read", async ({ page }) => {
  await page.goto("/");
  const storage = await keys(page);
  const raw = '{"format_version":2,"broken_after_load":true}';
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: storage.current, raw });
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  await library.getByRole("tab", { name: "S15 · Recovery", exact: true }).click();
  await library.getByRole("button", { name: "Retry Core / Catalog", exact: true }).click();
  await expect(page.getByTestId("campaign-storage-error")).toContainText("automatic writes are blocked");
  expect(await page.evaluate(key => localStorage.getItem(key), storage.current)).toBe(raw);
});
