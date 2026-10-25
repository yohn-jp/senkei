import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.use({ actionTimeout: 20_000, hasTouch: true });

const evidence = resolve(process.env.SENKEI_UX_EVIDENCE_DIR ?? "test-results/ux-session-2");
const viewports = [
  { width: 1440, height: 900 }, { width: 1920, height: 1080 },
  { width: 320, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 },
];
async function textMode(page: Page) {
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  return page.getByRole("textbox", { name: "Jinrei source", exact: true });
}
async function capture(page: Page, width: number, screen: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${width}-${screen}.png`), fullPage: true });
}

for (const viewport of viewports) test(`Custom, Coverage, Library and recovery at ${viewport.width}px`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL, viewport, isMobile: viewport.width < 761, hasTouch: viewport.width < 761, reducedMotion: "reduce" });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  if (viewport.width < 761) await page.getByText("自分で作る・再開する", { exact: true }).click();
  await page.getByRole("button", { name: "自分で編成", exact: true }).click();
  await page.getByRole("button", { name: "この条件で進む" }).click();
  const atelier = page.getByRole("tablist", { name: "Hero Atelier" });
  await page.getByRole("button", { name: "Choose hero for slot 2" }).click();
  await page.getByRole("region", { name: "Filtered hero catalog" }).getByRole("button", { name: /F02.*Stoneheart/ }).click();
  await expect(page.getByLabel("Hero change impact")).toContainText("Stoneheart");
  const detailTab = atelier.getByRole("tab", { name: "Hero Detail" });
  await detailTab.focus();
  await detailTab.press("Enter");
  await expect(page.getByRole("heading", { name: "Stoneheart", exact: true })).toBeVisible();
  await detailTab.press("ArrowRight");
  await expect(atelier.getByRole("tab", { name: "Skill Tree" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Choose Path B for slot-02" }).click();
  await atelier.getByRole("tab", { name: "Squad Assembly" }).click();
  for (const partition of ["1+1+1+1+1", "2+1+1+1", "2+2+1", "3+1+1", "3+2", "4+1", "5"]) {
    if (viewport.width < 761) await page.getByRole("button", { name: "1 · Split" }).click();
    const split = page.getByRole("button", { name: `Use squad split ${partition}`, exact: true, includeHidden: true });
    await split.click();
    await expect(split).toHaveAttribute("aria-pressed", "true");
  }
  if (viewport.width < 761) await page.getByRole("button", { name: "3 · Start nodes" }).click();
  await expect(page.getByRole("region", { name: "Squad formation preview" })).toContainText("Quintet");
  await capture(page, viewport.width, "S07");
  await page.locator("#next-tab-jinrei").click();
  await expect(page.getByRole("tab", { name: "No-code", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".editor-ast")).toBeVisible();
  await page.getByRole("textbox", { name: "Program name", exact: true }).fill("field_orders");
  const source = await textMode(page);
  const validSource = await source.inputValue();
  expect(validSource).toContain("senkei field_orders");
  await source.fill("invalid Jinrei");
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILE REQUIRED");
  await page.getByRole("button", { name: "Open Jinrei editor ↗" }).click();
  await expect(source).toBeFocused();
  await source.fill(validSource);
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILED");
  await page.getByRole("tab", { name: /Behavior Coverage/ }).click();
  const coverage = page.getByRole("region", { name: "Hero Behavior Coverage" });
  await expect(coverage).toBeVisible();
  await expect(coverage).toContainText("Coverage remains Not Proven.");
  await coverage.getByRole("combobox", { name: "Comparison", exact: true }).selectOption("observed");
  await expect(coverage).toContainText("NOT_CHECKED");
  await capture(page, viewport.width, "S09");
  await coverage.getByRole("button", { name: "Edit Jinrei →" }).click();
  await expect(source).toHaveValue(validSource);
  await page.getByRole("tab", { name: "Domain Catalog", exact: true }).click();
  await page.getByRole("combobox", { name: "Decision scope", exact: true }).selectOption("army");
  await expect(page.getByRole("combobox", { name: "Decision scope", exact: true })).toHaveValue("army");
  await textMode(page);
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  await library.getByRole("button", { name: "Save current setup", exact: true }).click();
  await expect(library).toContainText("Saved this Next setup");
  const downloadPromise = page.waitForEvent("download");
  await library.getByRole("button", { name: "Export pinned", exact: true }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(saved.format_version).toBe(1);
  expect(saved.slots[1].catalog_id).toBe("F02");
  expect(saved.slots[1].skill_path).toBe("path_b");
  await capture(page, viewport.width, "S14");
  await library.getByRole("tab", { name: "S15 · Recovery", exact: true }).click();
  await capture(page, viewport.width, "S15");
  await library.getByRole("tab", { name: "S16 · Legacy / G1", exact: true }).click();
  await expect(library.getByRole("button", { name: "Open Legacy Library", exact: true })).toBeEnabled();
  await expect(library.getByRole("button", { name: "Open G1 samples", exact: true })).toBeEnabled();
  await capture(page, viewport.width, "S16");
  await library.getByRole("tab", { name: "S14 · Library", exact: true }).click();
  await library.getByRole("button", { name: "Restore pinned setup", exact: true }).click();
  await expect(page.getByTestId("journey-ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "戦闘開始", exact: true })).toBeDisabled();
  await page.getByTestId("journey-ready").getByRole("button", { name: /^Jinrei/ }).click();
  await textMode(page);
  const recoverySource = validSource.replace("advance_01", "advance_01_recovery");
  expect(recoverySource).not.toBe(validSource);
  await source.fill(recoverySource);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("senkei.next-workspace-recovery.v1")!).draft.program_input.source)).toBe(recoverySource);
  await page.reload();
  await page.getByTestId("nav-next").click();
  await page.locator("#next-tab-jinrei").click();
  await textMode(page);
  await expect(source).toHaveValue(recoverySource);
  const bytes = await page.evaluate(() => localStorage.getItem("senkei.next-workspace.v1"));
  expect(JSON.parse(bytes!).draft.program_input.source).toBe(validSource);
  await page.getByTestId("nav-library").click();
  await library.getByRole("tab", { name: "S16 · Legacy / G1", exact: true }).click();
  await library.getByRole("button", { name: "Open Legacy Library", exact: true }).click();
  await expect(page.getByRole("region", { name: "Local document library" })).toBeVisible();
  await page.getByTestId("nav-library").click();
  await library.getByRole("tab", { name: "S16 · Legacy / G1", exact: true }).click();
  await library.getByRole("button", { name: "Open G1 samples", exact: true }).click();
  await expect(page).toHaveURL(/\/graphics\//);
  await expect(page.locator("canvas")).toHaveAttribute("data-rendered", "true");
  await page.goto("/");
  await page.getByTestId("nav-next").click();
  await page.locator("#next-tab-jinrei").click();
  await textMode(page);
  await expect(source).toHaveValue(recoverySource);
  expect(pageErrors).toEqual([]);
  writeFileSync(resolve(evidence, `${viewport.width}-journey.json`), JSON.stringify({ viewport, result: "passed", screens: ["S04", "S05", "S06", "S07", "S08", "S09", "S14", "S15", "S16"], checks: ["seven partitions", "keyboard tabs", "No-code/Text conversion", "real compiler reject/repair", "coverage evidence boundary", "catalog scope", "save/export", "restore/reload", "pinned/recovery separation"], verifiedAt: new Date().toISOString() }, null, 2));
  await context.close();
});

test("corrupt and incompatible copies preserve bytes and refuse restore", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("senkei.next-workspace.v1", "{broken-preserved"));
  await page.goto("/");
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  await expect(library.getByRole("button", { name: "Restore pinned setup", exact: true })).toBeDisabled();
  const downloadPromise = page.waitForEvent("download");
  await library.getByRole("button", { name: "Export preserved bytes", exact: true }).click();
  const rawDownload = await downloadPromise;
  expect(readFileSync((await rawDownload.path())!, "utf8")).toBe("{broken-preserved");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("senkei.next-workspace.v1"))).toBe("{broken-preserved");
  await library.getByRole("button", { name: "Save current setup", exact: true }).click();
  await library.getByRole("button", { name: "Keep existing data", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("senkei.next-workspace.v1"))).toBe("{broken-preserved");
  const setup = await page.evaluate(() => JSON.parse(localStorage.getItem("senkei.next-workspace-recovery.v1")!));
  setup.ruleset.digest = "incompatible-package";
  const importBytes = JSON.stringify(setup);
  await library.getByRole("button", { name: "Choose JSON file", exact: true }).click();
  await library.getByLabel("Import a Next setup JSON file").setInputFiles({ name: "incompatible.json", mimeType: "application/json", buffer: Buffer.from(importBytes) });
  await library.getByRole("button", { name: "Validate and replace", exact: true }).click();
  await expect(library).toContainText("Compatibility check failed");
  await expect(library.getByRole("button", { name: "Restore pinned setup", exact: true })).toBeDisabled();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("senkei.next-workspace.v1")))!).ruleset.digest).toBe("incompatible-package");
});

test("quota failure keeps the Draft exportable and storage retry resumes saving", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { rejectNextWrites: boolean }).rejectNextWrites = true;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if ((window as unknown as { rejectNextWrites: boolean }).rejectNextWrites && key.startsWith("senkei.next-")) throw new DOMException("Quota exceeded", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page.goto("/");
  await page.getByTestId("nav-next").click();
  await page.locator("#next-tab-jinrei").click();
  const source = await textMode(page);
  const expectedSource = await source.inputValue();
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  await library.getByRole("button", { name: "Save current setup", exact: true }).click();
  await expect(library).toContainText("Quota exceeded");
  const exportPromise = page.waitForEvent("download");
  await library.getByRole("button", { name: "Export current", exact: true }).click();
  const exportFile = await exportPromise;
  expect(JSON.parse(readFileSync((await exportFile.path())!, "utf8")).draft.program_input.source).toBe(expectedSource);
  await page.evaluate(() => { (window as unknown as { rejectNextWrites: boolean }).rejectNextWrites = false; });
  await library.getByRole("button", { name: "Retry storage", exact: true }).first().click();
  await library.getByRole("button", { name: "Save current setup", exact: true }).click();
  await expect(library).toContainText("Saved this Next setup");
});

test("Core retry replaces a failed Worker without dropping the current edit", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("nav-next").click();
  await page.locator("#next-tab-jinrei").click();
  const source = await textMode(page);
  const edited = (await source.inputValue()).replace("advance_01", "advance_01_core_retry");
  await source.fill(edited);
  const worker = page.workers().find(candidate => candidate.url().includes("core.worker"));
  expect(worker).toBeTruthy();
  await worker!.evaluate(() => { setTimeout(() => { throw new Error("UX test: Worker failed"); }, 0); });
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.locator(".next-jinrei-diagnostic-alert")).toContainText(/Worker failed|disposed|worker/i);
  await expect(source).toHaveValue(edited);
  await capture(page, 1280, "S15-worker-failure");
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  await library.getByRole("tab", { name: "S15 · Recovery", exact: true }).click();
  await library.getByRole("button", { name: "Retry Core / Catalog", exact: true }).first().click();
  await library.getByRole("button", { name: "Back", exact: true }).click();
  await expect(source).toHaveValue(edited);
  await page.getByRole("tab", { name: "Domain Catalog", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Decision scope", exact: true })).toBeVisible();
  await textMode(page);
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILED", { timeout: 30_000 });
  await context.close();
});

test("S00 WASM load failure opens recovery and retries without reloading the page", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route("**/wasm/*.wasm*", route => route.abort());
  await page.goto("/");
  await expect(page.getByText("Next ruleset unavailable", { exact: true })).toBeVisible({ timeout: 30_000 });
  await capture(page, 1280, "S00-wasm-failure");
  await page.getByRole("button", { name: "保存・復旧へ", exact: true }).click();
  const library = page.getByTestId("next-library");
  await expect(library).toBeVisible();
  await page.unroute("**/wasm/*.wasm*");
  await library.getByRole("button", { name: "Retry Core / Catalog", exact: true }).first().click();
  await library.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: "すぐ戦う", exact: true })).toBeEnabled({ timeout: 30_000 });
  await context.close();
});

test("No-code preserves authored Text on an unchanged round trip and formats actual edits", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-next").click();
  await page.locator("#next-tab-jinrei").click();
  const source = await textMode(page);
  const authored = (await source.inputValue()) + "\n\n";
  await source.fill(authored);
  await page.getByRole("tab", { name: "No-code", exact: true }).click();
  await expect(page.locator(".editor-ast")).toBeVisible();
  await textMode(page);
  await expect(source).toHaveValue(authored);
  await page.getByRole("tab", { name: "No-code", exact: true }).click();
  await page.getByRole("textbox", { name: "Program name", exact: true }).fill("edited_roundtrip");
  await textMode(page);
  await expect(source).toHaveValue(/senkei edited_roundtrip/);
  expect(await source.inputValue()).not.toBe(authored);
});

test("Catalog search and scope-bound completion edit the actual shared Text draft", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-next").click();
  await page.locator("#next-tab-jinrei").click();
  const source = await textMode(page);
  const original = await source.inputValue();
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILED");
  await page.getByRole("combobox", { name: "Catalog scope", exact: true }).selectOption("army");
  const offset = original.indexOf("match.tick");
  expect(offset).toBeGreaterThanOrEqual(0);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await source.fill(original.replace("match.tick", "match.t"));
    await expect(page.locator(".next-compile-state")).toHaveText("COMPILE REQUIRED");
    await source.evaluate((element, cursor) => {
      const input = element as HTMLTextAreaElement;
      input.setSelectionRange(cursor, cursor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, offset + "match.t".length);
    const completions = page.getByRole("listbox", { name: "Text Catalog completions" });
    await expect(completions).toBeVisible();
    await capture(page, viewport.width, "S08-completion");
    const option = completions.getByRole("option").filter({ hasText: "match.tick" });
    if (viewport.width < 761) await option.tap();
    else { await option.focus(); await option.press("Enter"); }
    await expect(source).toHaveValue(original);
  }
  await page.getByRole("tab", { name: "Domain Catalog", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Decision scope", exact: true })).toHaveValue("army");
  await page.getByRole("textbox", { name: "Search Catalog", exact: true }).fill("match.tick");
  await page.locator("[data-entry='match.tick']").click();
  await expect(page.getByLabel("Catalog definition")).toContainText("match.tick");
});
