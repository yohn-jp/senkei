import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";

test("Library retains two actual completed Runs and exports before third replacement", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う", exact: true }).click();
  await page.getByRole("button", { name: "この条件で進む", exact: true }).click();
  await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
  const library = page.getByTestId("next-library");
  const records = library.locator(".next-library-experiment-list li");
  const completed: string[] = [];
  let beforeThird: string[] = [];
  let pinned: string | null = null;
  const exportExperiments = async () => {
    const downloadEvent = page.waitForEvent("download");
    await library.getByRole("button", { name: "Export experiments", exact: true }).click();
    const download = await downloadEvent;
    const file = await download.path();
    if (!file) throw new Error("Experiment download did not produce a file.");
    await expect(library.getByRole("status")).toContainText("JSON download started");
    return JSON.parse(readFileSync(file, "utf8")) as { experiments: { id: string }[] };
  };
  const editable = () => page.evaluate(() => {
    const raw = localStorage.getItem("senkei.next-workspace-recovery.v1");
    if (!raw) throw new Error("No current recovery copy.");
    const { saved_at: _timestamp, ...content } = JSON.parse(raw);
    return content;
  });

  for (let index = 0; index < 3; index += 1) {
    await completePreflight(page);
    await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
    await page.getByTestId("nav-library").click();
    const retention = library.getByRole("note", { name: "Completed Run retention" });
    await expect(retention).toContainText("Up to 2 completed Runs");
    await expect(retention).toContainText("third completed Run");
    await expect(retention).toContainText("Export experiments before");
    await expect(records).toHaveCount(Math.min(index + 1, 2), { timeout: 60_000 });
    if (index === 2) await expect(library.locator(".next-library-experiment-list")).not.toContainText(completed[0], { timeout: 60_000 });
    const store = await exportExperiments();
    const ids = store.experiments.map(record => record.id);
    expect(ids).toHaveLength(Math.min(index + 1, 2));
    if (index === 0) {
      await library.getByRole("button", { name: "Save current setup", exact: true }).click();
      pinned = await page.evaluate(() => localStorage.getItem("senkei.next-workspace.v1"));
    }
    if (index === 1) {
      expect(ids).toContain(completed[0]);
      beforeThird = ids;
    }
    if (index === 2) {
      expect(ids).toContain(beforeThird[0]);
      expect(ids).not.toContain(completed[0]);
      expect(new Set(ids).size).toBe(2);
    }
    completed.push(ids[0]);
    if (index < 2) {
      await library.getByRole("button", { name: "Back", exact: true }).click();
      await page.locator("#next-tab-analysis").click();
      await page.getByTestId("battle-analysis").getByRole("button", { name: /同条件で再戦 · Run Snapshot/ }).click();
    }
  }

  const current = await editable();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(library.getByRole("note", { name: "Completed Run retention" })).toBeVisible();
  await expect(library.getByRole("button", { name: "Export experiments", exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/library-retention-390.png", fullPage: true });
  await library.getByLabel("Import Next experiment file").setInputFiles({ name: "invalid-experiments.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  const confirmation = library.getByRole("alertdialog", { name: "Replace saved experiments with this import?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Validate and import", exact: true }).click();
  await expect(library.getByRole("alert")).toContainText("unsupported or malformed format");
  await expect(records).toHaveCount(2);
  expect(await editable()).toEqual(current);
  expect(await page.evaluate(() => localStorage.getItem("senkei.next-workspace.v1"))).toBe(pinned);
});
