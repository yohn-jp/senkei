import { expect, test, type Page } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";

async function finishMatch(page: Page) {
  await completePreflight(page);
  await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
  await page.locator("#next-tab-analysis").click();
  await expect(page.getByTestId("battle-analysis")).toBeVisible();
}

test("C08 classifies real exact, own-tactics and changed-opponent Runs without rewriting rematch inputs", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL!, { waitUntil: "networkidle" });
  await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う" }).click();
  await page.getByRole("button", { name: "この条件で進む" }).click();
  await page.getByRole("button", { name: "準備確認へ" }).click();
  await finishMatch(page);

  const analysis = page.getByTestId("battle-analysis");
  const comparison = analysis.getByRole("region", { name: "Previous and current match comparison" });
  await analysis.getByRole("button", { name: /同条件で再戦 · Run Snapshot/ }).click();
  await finishMatch(page);
  await expect(comparison).toHaveAttribute("data-comparison-kind", "exact");
  await expect(comparison).toContainText("Both completed Runs used the same complete SimulationSnapshot identity.");

  await analysis.getByRole("button", { name: "Jinreiを変更" }).click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Jinrei source" });
  const original = await source.inputValue();
  const changed = original.replace(/when ([^\n]+),/, "when and { $1, match.tick < 374, },");
  expect(changed).not.toBe(original);
  await source.fill(changed);
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await page.locator("#next-tab-analysis").click();
  await analysis.getByRole("button", { name: /改良した戦型を比較 · 元Run条件固定/ }).click();
  await finishMatch(page);
  await expect(comparison).toHaveAttribute("data-comparison-kind", "improved");
  await expect(comparison).toContainText("自軍のJinrei Program");
  await expect(comparison).toContainText("自軍SnapshotのRevision");
  await expect(comparison).toContainText("変更対象以外は基準Runと一致");
  await expect(comparison).toContainText("結果の改善そのものを保証する分類ではありません");

  await page.getByTestId("workspace-view").getByRole("button", { name: "Homeへ戻る", exact: true }).click();
  await page.getByTestId("journey-home").getByRole("button", { name: "戦役を始める" }).first().click();
  await page.locator(".journey-campaign-card:not([disabled])").first().click();
  await page.getByRole("button", { name: "この課題で準備する" }).click();
  await page.getByRole("button", { name: "準備確認へ" }).click();
  await finishMatch(page);
  await expect(comparison).toHaveAttribute("data-comparison-kind", "reference");
  await expect(comparison).toContainText("参考比較です");
  await expect(comparison).toContainText("出力の完全一致は保証しません");
  await expect(comparison.locator(".battle-analysis-change-list")).toContainText(/相手|Campaign/);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 780 : 900 });
    await expect(comparison).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`comparison-reference-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
