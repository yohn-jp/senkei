import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { completePreflight } from "../helpers/preflight";
test.use({ actionTimeout: 30_000 });

test("Replay selection and real Action source survive Analysis and editing on desktop and mobile", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  if (process.env.SENKEI_TACTICAL_EXPERIMENT) {
    await page.getByTestId("nav-library").click();
    const library = page.getByTestId("next-library");
    await library.getByLabel("Import Next experiment file", { exact: true }).setInputFiles(process.env.SENKEI_TACTICAL_EXPERIMENT);
    await library.getByRole("button", { name: "Open latest comparison", exact: true }).click();
    await page.getByTestId("battle-analysis").getByRole("button", { name: "Battle Replayへ", exact: true }).click();
  } else {
    await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う", exact: true }).click();
    await page.getByRole("button", { name: "この条件で進む", exact: true }).click();
    await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
    await completePreflight(page);
    await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
    // Keep the genuine immutable experiment export for reproducing UI failures without another Enbu run.
    await page.getByTestId("nav-library").click();
    const downloadEvent = page.waitForEvent("download");
    await page.getByTestId("next-library").getByRole("button", { name: "Export experiments", exact: true }).click();
    await (await downloadEvent).saveAs(resolve("test-results/tactical-real-experiments.json"));
    await page.getByTestId("next-library").getByRole("button", { name: "Back", exact: true }).click();
  }
  const originalExperiment = JSON.parse(readFileSync(process.env.SENKEI_TACTICAL_EXPERIMENT ?? resolve("test-results/tactical-real-experiments.json"), "utf8")).experiments[0];
  const analysis = page.getByTestId("battle-analysis");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator("#next-tab-battle").click();
    const seek = page.getByRole("slider", { name: "Seek replay tick" });
    await seek.focus();
    await seek.press("Home");
    for (let step = 0; step < 4; step++) await seek.press("PageUp");
    const tick = Number(await seek.inputValue());
    expect(tick).toBeGreaterThan(60);
    let selectedId: string | null = null;
    if (width < 761) {
      await page.getByRole("button", { name: "Follow view", exact: true }).click();
      const chooser = page.getByRole("region", { name: "Choose a visible unit or confirmed owner Squad to follow" });
      const cluster = chooser.locator(".next-visible-cluster-toggle").first();
      if (await cluster.getAttribute("aria-expanded") !== "true") await cluster.click();
      const select = chooser.getByRole("button", { name: /^Select .*, replay entity / }).first();
      selectedId = (await select.getAttribute("aria-label"))!.split("replay entity ")[1];
      await select.click();
    }
    if (width >= 761) {
      const subject = page.getByRole("combobox", { name: "Observe visible entity", exact: true });
      const id = await subject.locator("option").nth(1).getAttribute("value");
      expect(id).toBeTruthy();
      await subject.selectOption(id!);
      selectedId = id;
    }
    await page.locator("#next-tab-analysis").click();
    const context = analysis.getByRole("region", { name: "Replay analysis context" });
    await expect(context).toHaveAttribute("data-tick", String(tick));
    await expect(context).toContainText("attacker");
    await expect(context).toHaveAttribute("data-entity-id", selectedId!);
    const eventRow = analysis.locator(".battle-analysis-timeline li").first();
    const eventOrder = await eventRow.getAttribute("data-event-order");
    const eventTick = Number((await eventRow.locator(".battle-analysis-tick").innerText()).replace(/\D/g, ""));
    await eventRow.getByRole("button").click();
    const replaySubject = await page.getByRole("combobox", { name: "Observe visible entity", exact: true, includeHidden: true }).inputValue();
    await page.locator("#next-tab-analysis").click();
    await expect(context).toHaveAttribute("data-tick", String(eventTick));
    await expect(context).toHaveAttribute("data-event-order", eventOrder!);
    await expect(context).toHaveAttribute("data-entity-id", replaySubject);
    const resultDigest = await analysis.locator(".battle-analysis-result-identity code").innerText();
    const sourceButton = analysis.getByRole("button", { name: "Inspect Action source", exact: true }).and(page.locator(":enabled")).first();
    await expect(sourceButton).toBeEnabled({ timeout: 60_000 });
    await analysis.getByRole("searchbox", { name: "Timelineを検索" }).fill("move");
    const tracePage = await analysis.locator(".battle-analysis-diagnostics [role=status]").innerText();
    await sourceButton.click();
    const origin = page.getByRole("region", { name: "Analysis source context" });
    await expect(origin).toBeVisible();
    if (await origin.getByRole("button", { name: "Select matching current source", exact: true }).isDisabled()) {
      await page.getByRole("button", { name: "Compile tactics", exact: true }).click();
      await expect(page.locator(".next-compile-state")).toHaveText("COMPILED");
    }
    await origin.getByRole("button", { name: "Select matching current source", exact: true }).click();
    await expect(origin).toContainText("Exact source correspondence");
    const source = page.getByRole("textbox", { name: "Jinrei source", exact: true });
    const original = await source.inputValue();
    const selected = await source.evaluate((input: HTMLTextAreaElement) => input.value.slice(input.selectionStart, input.selectionEnd));
    expect(selected).toMatch(/action\s/);
    await source.fill(`${original}\n// preserve edited Draft ${width}\n`);
    await expect(origin).toContainText("Current Draft differs");
    await expect(origin.getByRole("button", { name: "Select matching current source", exact: true })).toBeDisabled();
    await origin.getByRole("button", { name: "Back to original Analysis", exact: true }).click();
    await expect(analysis).toBeVisible();
    await expect(context).toHaveAttribute("data-tick", String(eventTick));
    await expect(context).toHaveAttribute("data-entity-id", replaySubject);
    await expect(context).toHaveAttribute("data-event-order", eventOrder!);
    await expect(analysis.locator(".battle-analysis-result-identity code")).toHaveText(resultDigest);
    await expect(analysis.getByRole("searchbox", { name: "Timelineを検索" })).toHaveValue("move");
    await expect(analysis.locator(".battle-analysis-diagnostics [role=status]")).toHaveText(tracePage);
    await analysis.getByRole("button", { name: "Inspect Action source", exact: true }).and(page.locator(":enabled")).first().click();
    await expect(origin).toContainText("Current Draft differs");
    await expect(origin.getByRole("button", { name: "Select matching current source", exact: true })).toBeDisabled();
    await expect(source).toHaveValue(`${original}\n// preserve edited Draft ${width}\n`);
    await page.screenshot({ path: `test-results/tactical-source-${width}.png`, fullPage: true });
    await source.fill(original);
    await page.getByRole("button", { name: "Compile tactics", exact: true }).click();
    await expect(page.locator(".next-compile-state")).toHaveText("COMPILED");
    await page.getByRole("tab", { name: /Behavior Coverage/ }).click();
    await page.locator("#next-tab-analysis").click();
    await page.locator("#next-tab-jinrei").click();
    await expect(page.getByRole("tab", { name: /Behavior Coverage/ })).toHaveAttribute("aria-selected", "true");
    await origin.getByRole("button", { name: "Back to original Analysis", exact: true }).click();
  }
  await page.getByTestId("nav-library").click();
  const finalExport = page.waitForEvent("download");
  await page.getByTestId("next-library").getByRole("button", { name: "Export experiments", exact: true }).click();
  const finalExperiment = JSON.parse(readFileSync((await (await finalExport).path())!, "utf8")).experiments[0];
  expect(finalExperiment.snapshot).toEqual(originalExperiment.snapshot);
  expect(finalExperiment.setup).toEqual(originalExperiment.setup);
  expect(finalExperiment.response.outcome.result).toEqual(originalExperiment.response.outcome.result);

});
