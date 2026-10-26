import { readFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";

async function exportRuns(page: Page, info: TestInfo, name: string) {
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  const downloaded = page.waitForEvent("download");
  await library.getByRole("button", { name: "Export experiments", exact: true }).click();
  const file = info.outputPath(name);
  await (await downloaded).saveAs(file);
  const store = JSON.parse(readFileSync(file, "utf8"));
  await library.getByRole("button", { name: "Back", exact: true }).click();
  return store.experiments;
}

test("C08 keeps original non-target inputs for a real improved battle and preserves the editing Draft", async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  if (process.env.SENKEI_TACTICAL_EXPERIMENT) {
    await page.getByTestId("nav-library").click();
    const library = page.getByTestId("next-library");
    await library.getByLabel("Import Next experiment file", { exact: true }).setInputFiles(process.env.SENKEI_TACTICAL_EXPERIMENT);
    await library.getByRole("button", { name: "Open latest comparison", exact: true }).click();
  } else {
    await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う", exact: true }).click();
    await page.getByRole("button", { name: "この条件で進む", exact: true }).click();
    await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
    await completePreflight(page);
    await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
    await page.locator("#next-tab-analysis").click();
  }
  const original = (await exportRuns(page, info, "original.json"))[0];
  const analysis = page.getByTestId("battle-analysis");
  await analysis.getByRole("button", { name: "Jinreiを変更", exact: true }).click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Jinrei source", exact: true });
  const previousSource = await source.inputValue();
  const changedSource = previousSource.replace(/when ([^\n]+),/, "when and { $1, match.tick < 374, },");
  expect(changedSource).not.toBe(previousSource);
  await source.fill(changedSource);
  await page.getByRole("button", { name: "Compile tactics", exact: true }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await page.locator("#next-tab-analysis").click();

  await analysis.getByRole("button", { name: "同条件で再戦 · Run Snapshot", exact: true }).click();
  await page.getByRole("button", { name: "検証・コンパイル", exact: true }).click();
  await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
  await expect(page.getByText("同条件再戦 · 元Runの確定Snapshot", { exact: true })).toBeVisible();
  await page.getByTestId("journey-ready").getByRole("button", { name: /^Jinrei/ }).click();
  await expect(source).toHaveValue(changedSource);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#next-tab-analysis").click();
  await analysis.getByRole("button", { name: "改良した戦型を比較 · 元Run条件固定", exact: true }).click();
  await expect(page.getByTestId("journey-ready")).toBeVisible();
  await expect(page.getByText("改良比較 · 自軍以外は元Runに固定", { exact: true })).toBeVisible();
  await completePreflight(page);
  await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
  await page.locator("#next-tab-analysis").click();
  await expect(analysis.getByRole("region", { name: "Previous and current match comparison", exact: true })).toHaveAttribute("data-comparison-kind", "improved");
  const completed = (await exportRuns(page, info, "improved.json"))[0];
  expect(completed.snapshot.context).toEqual(original.snapshot.context);
  expect(completed.snapshot.defender).toEqual(original.snapshot.defender);
  expect(completed.snapshot.attacker.initial_memory).toEqual(original.snapshot.attacker.initial_memory);
  expect(completed.snapshot.attacker.id).toBe(original.snapshot.attacker.id);
  expect(completed.snapshot.attacker.program.content_digest).not.toBe(original.snapshot.attacker.program.content_digest);
  expect(completed.setup.draft.program_input.source).toBe(changedSource);
  expect(completed.setup.rival_slots).toEqual(original.setup.rival_slots);
  expect(completed.setup.rival_source).toBe(original.setup.rival_source);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await analysis.getByRole("button", { name: "新しい条件で対戦 · 現在Draft", exact: true }).click();
    await expect(page.getByTestId("journey-ready")).toBeVisible();
    await expect(page.getByText("改良比較 · 自軍以外は元Runに固定", { exact: true })).toHaveCount(0);
    await page.getByTestId("journey-ready").getByRole("button", { name: /^Jinrei/ }).click();
    await expect(source).toHaveValue(changedSource);
    await page.locator("#next-tab-analysis").click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`three-rematch-operations-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
