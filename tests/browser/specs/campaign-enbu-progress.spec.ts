import { expect, test, type Page } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";
test.use({ actionTimeout: 20_000 });
const ids = ["first-march", "read-the-map", "share-the-pressure", "jungle-objective", "bridge-approach", "protect-the-core"];
const persistentOrders = "senkei campaign_orders { " + Array.from({ length: 5 }, (_, index) => {
  const slot = `slot-${String(index + 1).padStart(2, "0")}`;
  return `action advance_${index + 1} { when any hero in allies.heroes { hero.slot_id == "${slot}", hero.goal == "", hero.hp > 0, }, do move(argmin hero in filter hero in allies.heroes { hero.slot_id == "${slot}", } by hero.hp then hero.id, "B.BASE"), }`;
}).join(", ") + " }";
async function progress(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("senkei.next-campaign-progress.v2:"));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
}
async function prepare(page: Page, final: boolean) {
  await page.goto("/");
  await expect.poll(() => progress(page)).not.toBeNull();
  let legacy: { key: string; raw: string } | null = null;
  if (final) {
    legacy = await page.evaluate(ids => {
      const current = Object.keys(localStorage).find(key => key.startsWith("senkei.next-campaign-progress.v2:"))!;
      const digest = current.split(":")[1];
      const key = current.replace(".v2:", ".v1:");
      const raw = JSON.stringify({ format_version: 1, ruleset_digest: digest, unlocked_scenario_ids: ids });
      localStorage.removeItem(current); localStorage.setItem(key, raw);
      return { key, raw };
    }, ids);
    await page.reload();
  }
  await page.getByTestId("journey-home").getByRole("button", { name: "戦役を始める", exact: true }).click();
  if (final) await page.getByRole("button", { name: /Regroup for a base defense/ }).click();
  await page.getByRole("button", { name: "この課題で準備する", exact: true }).click();
  await page.getByRole("button", { name: "Heroを変更", exact: true }).click();
  if (!final) {
    // Exercise an authored legal roster and explicit persistent movement.
    // The same five-Hero roster in one Squad wins, while five Solo squads
    // with the unchanged opponent and 600-tick Core produce a natural Draw.
    for (const [index, id] of ["F02", "F04", "R01", "R03", "R05"].entries()) {
      await page.getByRole("button", { name: `Choose hero for slot ${index + 1}`, exact: true }).click();
      await page.locator(".next-catalog-card").filter({ has: page.locator(".ha-hero-id", { hasText: new RegExp(`^${id}import { expect, test, type Page } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";
test.use({ actionTimeout: 20_000 });
const ids = ["first-march", "read-the-map", "share-the-pressure", "jungle-objective", "bridge-approach", "protect-the-core"];
const persistentOrders = "senkei campaign_orders { " + Array.from({ length: 5 }, (_, index) => {
  const slot = `slot-${String(index + 1).padStart(2, "0")}`;
  return `action advance_${index + 1} { when any hero in allies.heroes { hero.slot_id == "${slot}", hero.goal == "", hero.hp > 0, }, do move(argmin hero in filter hero in allies.heroes { hero.slot_id == "${slot}", } by hero.hp then hero.id, "B.BASE"), }`;
}).join(", ") + " }";
async function progress(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("senkei.next-campaign-progress.v2:"));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
}
async function prepare(page: Page, final: boolean) {
  await page.goto("/");
  await expect.poll(() => progress(page)).not.toBeNull();
  let legacy: { key: string; raw: string } | null = null;
  if (final) {
    legacy = await page.evaluate(ids => {
      const current = Object.keys(localStorage).find(key => key.startsWith("senkei.next-campaign-progress.v2:"))!;
      const digest = current.split(":")[1];
      const key = current.replace(".v2:", ".v1:");
      const raw = JSON.stringify({ format_version: 1, ruleset_digest: digest, unlocked_scenario_ids: ids });
      localStorage.removeItem(current); localStorage.setItem(key, raw);
      return { key, raw };
    }, ids);
    await page.reload();
  }
  await page.getByTestId("journey-home").getByRole("button", { name: "戦役を始める", exact: true }).click();
  if (final) await page.getByRole("button", { name: /Regroup for a base defense/ }).click();
  await page.getByRole("button", { name: "この課題で準備する", exact: true }).click();
  await page.getByRole("button", { name: "Heroを変更", exact: true }).click();
  if (!final) {
    // Exercise an authored legal roster and explicit persistent movement.
    // The same five-Hero roster in one Squad wins, while five Solo squads
    // with the unchanged opponent and 600-tick Core produce a natural Draw.
    for (const [index, id] of ["F02", "F04", "R01", "R03", "R05"].entries()) {
      await page.getByRole("button", { name: `Choose hero for slot ${index + 1}`, exact: true }).click();
) }) }).click();
    }
    await page.getByRole("tab", { name: "Squad Assembly" }).click();
    const soloPattern = page.getByRole("button", { name: "Use squad split 1+1+1+1+1", exact: true });
    await soloPattern.click();
    await expect(soloPattern).toHaveAttribute("aria-pressed", "true");
  } else {
    // This is an explicit legal player deployment through the current UI, not
    // a changed opponent, map, victory condition, or difficulty definition.
    await page.getByRole("tab", { name: "Squad Assembly" }).click();
    await page.getByRole("combobox", { name: "Starting node for Alpha", exact: true }).selectOption("B.BASE");
  }
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await page.getByRole("textbox", { name: "Jinrei source", exact: true }).fill(persistentOrders);
  await page.getByRole("button", { name: "準備確認へ", exact: true }).first().click();
  await page.getByRole("checkbox", { name: /自軍のローカルReplay・診断を収集/ }).uncheck();
  return legacy;
}

test("Actual campaign Draw never records a clear or unlocks the next challenge", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page, false);
  await completePreflight(page);
  const confirmed = page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i);
  await expect(confirmed).toBeVisible({ timeout: 300_000 });
  await expect(confirmed).toContainText("Draw");
  await expect.poll(() => progress(page)).toMatchObject({ completed_scenario_ids: [], unlocked_scenario_ids: ["first-march"], history_incomplete: false });
  const actions = page.getByRole("region", { name: "Campaign next actions" });
  await expect(actions).toContainText("新たな攻略・解放は記録しません");
  await expect(actions.getByRole("button", { name: /次の課題を準備/ })).toHaveCount(0);
  await actions.getByRole("button", { name: "同じ課題を再挑戦", exact: true }).click();
  await expect(page.getByTestId("journey-ready")).toContainText("March to the lane");
  await expect(page.getByText("同条件再戦 · 元Runの確定Snapshot", { exact: true })).toBeVisible();
});

test("Actual final-campaign Draw preserves unknown legacy history and offers real return actions on mobile", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const legacy = await prepare(page, true);
  await completePreflight(page);
  const confirmed = page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i);
  await expect(confirmed).toBeVisible({ timeout: 300_000 });
  await expect(confirmed).toContainText("Draw");
  await expect.poll(() => progress(page)).toMatchObject({ completed_scenario_ids: [], history_incomplete: true });
  expect(await page.evaluate(key => localStorage.getItem(key), legacy!.key)).toBe(legacy!.raw);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".next-battle-panel.has-campaign-result")).toHaveCSS("overflow-y", "auto");
  const actions = page.getByRole("region", { name: "Campaign next actions" });
  await expect(actions).toContainText("新たな攻略・解放は記録しません");
  await expect(actions).not.toContainText("最終課題を攻略");
  await expect(actions.getByRole("button", { name: /次の課題を準備/ })).toHaveCount(0);
  await actions.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/campaign-final-draw-actions-390.png", fullPage: true });
  await actions.getByRole("button", { name: "結果を分析", exact: true }).click();
  await expect(page.getByTestId("battle-analysis")).toBeVisible();
  await actions.getByRole("button", { name: "Replayで結果を見る", exact: true }).click();
  await actions.getByRole("button", { name: "同じ課題を再挑戦", exact: true }).click();
  await expect(page.getByTestId("journey-ready")).toContainText("Regroup for a base defense");
  await expect(page.getByText("同条件再戦 · 元Runの確定Snapshot", { exact: true })).toBeVisible();
  await page.getByTestId("nav-next").click();
  await actions.getByRole("button", { name: "この課題のJinreiを改善", exact: true }).click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Jinrei source", exact: true })).toHaveValue(persistentOrders);
  await page.locator("#next-tab-battle").click();
  await actions.getByRole("button", { name: "Homeへ戻る", exact: true }).click();
  await page.getByTestId("journey-home").locator(".journey-start-mobile details > summary").click();
  await page.getByRole("button", { name: "戦役を始める", exact: true }).click();
  await expect(page.getByRole("region", { name: "Campaign completion records" })).toContainText("攻略記録 0 / 6");
  await expect(page.getByRole("button", { name: /March to the lane/ })).toContainText("攻略履歴不明");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/campaign-final-draw-history-390.png", fullPage: true });
});
