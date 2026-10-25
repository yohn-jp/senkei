import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";

const evidenceDirectory = resolve(process.env.SENKEI_UX_EVIDENCE_DIR ?? "test-results/ux-session-2-analysis");
const viewportCases = [
  { width: 1440, height: 900, name: "desktop-1440" },
  { width: 1920, height: 1080, name: "desktop-1920" },
  { width: 320, height: 780, name: "mobile-320" },
  { width: 390, height: 844, name: "mobile-390" },
  { width: 430, height: 932, name: "mobile-430" },
] as const;

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page, width: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function launchCurrentReady(page: import("@playwright/test").Page): Promise<void> {
  await completePreflight(page);
  await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-rendered", "true");
}

test("S13 uses real Enbu runs for replay navigation, draft comparison and both rematch routes", async ({ page, baseURL }) => {
  test.setTimeout(600_000);
  if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");
  mkdirSync(evidenceDirectory, { recursive: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う" }).click();
  await page.getByRole("button", { name: "この条件で進む" }).click();
  await page.getByRole("button", { name: "準備確認へ" }).click();
  await launchCurrentReady(page);

  const analysisTab = page.locator("#next-tab-analysis");
  await analysisTab.click();
  const analysis = page.getByTestId("battle-analysis");
  await expect(analysis).toBeVisible();
  await expect(analysis.getByRole("region", { name: "確定した試合結果" })).toContainText(/勝利|敗北|引き分け/);
  await expect(analysis.locator(".battle-analysis-hero-card")).toHaveCount(5);
  await expect(analysis.getByText("ATTACKER ONLY")).toBeVisible();
  await expect(analysis.getByText("比較可能な前回Runはありません。", { exact: false })).toBeVisible();
  await expect(analysis.getByRole("button", { name: /同条件で再戦 · Run Snapshot/ })).toBeEnabled();

  const firstEvent = analysis.locator(".battle-analysis-timeline li button").first();
  await expect(firstEvent).toBeVisible();
  const eventTick = Number((await firstEvent.locator(".battle-analysis-tick").innerText()).replace(/\D/g, ""));
  await firstEvent.click();
  await expect(analysisTab).toHaveAttribute("aria-selected", "false");
  await expect.poll(() => page.locator(".next-tick-readout").innerText()).toContain(`TICK ${eventTick} /`);
  await expect.poll(() => page.locator(".next-renderer-host canvas").getAttribute("data-tick")).toBe(String(eventTick));

  for (const viewport of viewportCases) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await analysisTab.click();
    await expect(analysis).toBeVisible();
    await expect(analysis.getByRole("heading", { name: "戦績を 分析" })).toBeVisible();
    await expectNoHorizontalOverflow(page, viewport.width);
    await page.screenshot({ path: resolve(evidenceDirectory, `${viewport.name}.png`), fullPage: true });
    if (viewport.width <= 430) {
      await expect(analysis.getByRole("combobox", { name: "HeroでTimelineを絞り込む" })).toBeVisible();
      await expect(analysis.getByRole("button", { name: /変更後の条件を検証/ })).toBeDisabled();
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await analysisTab.click();
  await analysis.getByRole("button", { name: "Jinreiを変更" }).click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Jinrei source" });
  const originalSource = await source.inputValue();
  const revisedSource = originalSource.replace(/when ([^\n]+),/, "when and { $1, match.tick < 374, },");
  expect(revisedSource).not.toBe(originalSource);
  await source.fill(revisedSource);
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await analysisTab.click();
  await expect(analysis.getByText("現在のDraftに変更があります。", { exact: false })).toBeVisible();
  await expect(analysis.getByRole("button", { name: /変更後の条件を検証 · 現在Draft/ })).toBeEnabled();
  await analysis.getByRole("button", { name: /変更後の条件を検証 · 現在Draft/ }).click();
  await expect(page.getByTestId("journey-ready")).toBeVisible();
  await launchCurrentReady(page);

  await analysisTab.click();
  await expect(analysis).toBeVisible();
  await expect(analysis.getByText("入力を変更したRun", { exact: true })).toBeVisible();
  await expect(analysis.getByText("自軍のJinrei Program", { exact: true })).toBeVisible();
  await expect(analysis.locator(".battle-analysis-comparison-values")).toContainText(/PREVIOUS[\s\S]*CURRENT/);
  const originalDigest = await analysis.locator(".battle-analysis-result-identity code").innerText();
  await analysis.getByRole("button", { name: "Jinreiを変更" }).click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  const pendingDraft = revisedSource.replace("match.tick < 374", "match.tick < 375");
  await source.fill(pendingDraft);
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILE REQUIRED");
  await analysisTab.click();
  await analysis.getByRole("button", { name: /同条件で再戦 · Run Snapshot/ }).click();
  await expect(page.getByTestId("journey-ready")).toBeVisible();
  await expect(page.getByText("同条件再戦 · 元Runの確定Snapshot", { exact: true })).toBeVisible();
  await launchCurrentReady(page);
  await analysisTab.click();
  await expect(analysis).toContainText("Both completed Runs used the same complete SimulationSnapshot identity.");
  await expect(analysis.locator(".battle-analysis-result-identity code")).toHaveText(originalDigest);
  await analysis.getByRole("button", { name: "Jinreiを変更" }).click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await expect(source).toHaveValue(pendingDraft);
  expect(pageErrors).toEqual([]);
});
