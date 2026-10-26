import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";
import type { LocalNextExperimentStore } from "../../../apps/web/src/contracts";

test.use({ hasTouch: true });

test("all supplied attacker diagnostics remain reachable beyond 60 on desktop and mobile", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseURL!, { waitUntil: "networkidle" });
  await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う" }).click();
  await page.getByRole("button", { name: "この条件で進む" }).click();
  await page.getByRole("button", { name: "準備確認へ" }).click();
  await completePreflight(page);
  await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });

  await page.locator("#next-tab-analysis").click();

  // Read the actual authorized Enbu output through the product's portable export.
  await page.getByTestId("workspace-view").getByRole("button", { name: "Library", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export experiments", exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error("Experiment export was not downloaded");
  const store = JSON.parse(await readFile(path, "utf8")) as LocalNextExperimentStore;
  const events = store.experiments[0].response.restricted_diagnostics!.events.filter((event) => event.side === "attacker");
  expect(events.length).toBeGreaterThan(60);
  const last = events.at(-1)!;
  const totalPages = Math.ceil(events.length / 24);
  await page.getByRole("button", { name: "Open latest comparison" }).click();
  const analysis = page.getByTestId("battle-analysis");
  const diagnostics = analysis.getByRole("region", { name: "Decision Trace and restricted diagnostics" });
  const pages = diagnostics.getByRole("navigation", { name: "Diagnostic pages" });
  const list = diagnostics.locator(".battle-analysis-diagnostic-list");

  for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 780 }]) {
    await page.setViewportSize(viewport);
    await expect(pages.getByRole("button", { name: "最初のTrace", exact: true })).toBeDisabled();
    await expect(list.locator("li")).toHaveCount(24);
    await expect(diagnostics.getByRole("status")).toHaveText(`1–24 / ${events.length} supplied attacker events · page 1/${totalPages}`);
    const next = pages.getByRole("button", { name: "次のTrace", exact: true });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(diagnostics.getByRole("status")).toContainText(`25–48 / ${events.length}`);
    const finalPage = pages.getByRole("button", { name: "最後のTrace", exact: true });
    if (viewport.width === 320) {
      const bounds = await finalPage.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    if (viewport.width === 320) await finalPage.tap();
    else await finalPage.click();
    await expect(list.locator("li")).toHaveCount(events.length - (totalPages - 1) * 24);
    await expect(diagnostics.getByRole("status")).toContainText(`page ${totalPages}/${totalPages}`);
    await expect(pages.getByRole("button", { name: "次のTrace", exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath(`diagnostics-last-page-${viewport.width}.png`), fullPage: true });
    const lastButton = list.getByRole("button").last();
    await expect(lastButton).toContainText(`T${String(last.tick).padStart(3, "0")}`);
    await expect(lastButton).toContainText(last.record.kind.replaceAll("_", " "));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if (viewport.width === 320) await lastButton.tap();
    else await lastButton.click();
    await expect.poll(() => page.locator(".next-renderer-host canvas").getAttribute("data-tick")).toBe(String(last.tick));
    await expect(page.locator(".next-tick-readout")).toContainText(`TICK ${last.tick} /`);
    await page.locator("#next-tab-analysis").click();
    await pages.getByRole("button", { name: "最初のTrace", exact: true }).click();
  }
  console.log(`Verified ${events.length} real attacker diagnostics across ${totalPages} pages; last tick ${last.tick}.`);
  expect(errors).toEqual([]);
});
