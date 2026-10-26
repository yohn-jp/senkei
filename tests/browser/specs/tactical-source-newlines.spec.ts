import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";

test.use({ actionTimeout: 30_000 });
test("verified Unicode CRLF and lone-CR source selects the normalized textarea without rewriting Draft", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("journey-home")).toBeVisible({ timeout: 60_000 });
  let store;
  if (process.env.SENKEI_TACTICAL_EXPERIMENT) {
    store = JSON.parse(readFileSync(process.env.SENKEI_TACTICAL_EXPERIMENT, "utf8"));
  } else {
    // Standalone CI fallback produces a real experiment; local regressions reuse its actual export.
    await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う", exact: true }).click();
    await page.getByRole("button", { name: "この条件で進む", exact: true }).click();
    await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
    await completePreflight(page);
    await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
    await page.getByTestId("nav-library").click();
    const downloadEvent = page.waitForEvent("download");
    await page.getByTestId("next-library").getByRole("button", { name: "Export experiments", exact: true }).click();
    store = JSON.parse(readFileSync((await (await downloadEvent).path())!, "utf8"));
  }
  const original = store.experiments[0];
  // Explicitly imported source-form variant of a real Run; the compiler must verify the unchanged Program.
  const rawSource = "// 日本語 🐺\r\n\r" + original.setup.draft.program_input.source.replace(/\r\n?|\n/g, "\r\n");
  const setup = { ...original.setup, draft: { ...original.setup.draft, program_input: { kind: "text", source: rawSource } } };
  const variant = { ...store, experiments: [{ ...original, setup }] };
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  const hasStoredExperiments = await library.getByRole("button", { name: "Export experiments", exact: true }).isEnabled();
  await library.getByLabel("Import Next experiment file", { exact: true }).setInputFiles({ name: "real-run-source-form.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(variant)) });
  const replaceExperiments = library.getByRole("button", { name: "Validate and import", exact: true });
  const openLatest = library.getByRole("button", { name: "Open latest comparison", exact: true });
  if (hasStoredExperiments) {
    await expect(replaceExperiments).toBeVisible({ timeout: 30_000 });
    await replaceExperiments.click();
  }
  await expect(openLatest).toBeEnabled({ timeout: 180_000 });
  await openLatest.click();
  await page.getByTestId("nav-library").click();
  await library.getByLabel("Import a Next setup JSON file", { exact: true }).setInputFiles({ name: "raw-source-setup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(setup)) });
  const replacePinned = library.getByRole("button", { name: "Validate and replace", exact: true });
  if (await replacePinned.isVisible()) await replacePinned.click();
  await library.getByRole("button", { name: "Restore pinned setup", exact: true }).click();
  await library.getByRole("button", { name: "Replace current Draft", exact: true }).click();
  await page.getByTestId("journey-ready").getByRole("button", { name: "検証・コンパイル", exact: true }).click();
  await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
  await page.getByTestId("nav-library").click();
  await library.getByRole("button", { name: "Open latest comparison", exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const analysis = page.getByTestId("battle-analysis");
    const inspect = analysis.getByRole("button", { name: "Inspect Action source", exact: true }).and(page.locator(":enabled")).first();
    await expect(inspect).toBeEnabled({ timeout: 60_000 });
    await inspect.click();
    const origin = page.getByRole("region", { name: "Analysis source context" });
    await expect(origin).toContainText("Exact source correspondence");
    await origin.getByRole("button", { name: "Select matching current source", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Jinrei source", exact: true });
    const selected = await editor.evaluate((input: HTMLTextAreaElement) => input.value.slice(input.selectionStart, input.selectionEnd));
    const originalAction = await origin.locator("pre").textContent();
    expect(selected).toMatch(/^action\s/);
    expect(selected).toBe(originalAction!.replace(/\r\n?/g, "\n"));
    expect(await editor.inputValue()).toBe(rawSource.replace(/\r\n?/g, "\n"));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("senkei.next-workspace-recovery.v1")!).draft.program_input.source)).toBe(rawSource);
    await page.getByRole("tab", { name: /Behavior Coverage/ }).click();
    await origin.getByRole("button", { name: "Select matching current source", exact: true }).click();
    await expect(editor).toBeFocused();
    await expect(page.getByRole("tab", { name: "Jinrei Workbench", exact: false })).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: `test-results/tactical-source-newlines-${width}.png`, fullPage: true });
    await origin.getByRole("button", { name: "Back to original Analysis", exact: true }).click();
  }
});
