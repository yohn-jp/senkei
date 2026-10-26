import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const recoveryKey = "senkei.next-workspace-recovery.v1";
const evidenceDirectory = resolve(process.env.SENKEI_RECOVERY_EVIDENCE_DIR ?? "test-results/recovery-core-quota-retry");

test("C13/C14 failed Recovery write and same-package Core retry preserve the current Source", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL, serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う", exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("nav-next").click();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Jinrei source", exact: true });
  await expect(source).toBeVisible();
  const originalSource = await source.inputValue();
  await expect.poll(() => page.evaluate(key => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).draft.program_input.source : null;
  }, recoveryKey)).toBe(originalSource);
  const originalRaw = await page.evaluate(key => localStorage.getItem(key), recoveryKey);
  expect(originalRaw).not.toBeNull();
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException("C13 test: Recovery quota denied", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, recoveryKey);
  const edited = originalSource + "\n// recovery_quota_marker_current_draft\n";
  await source.fill(edited);
  await expect(page.locator(".next-save-message.is-error").filter({ hasText: "Recovery quota denied" })).toBeVisible();
  const before = { source: await source.inputValue(), recoveryRaw: await page.evaluate(key => localStorage.getItem(key), recoveryKey) };
  expect(before.source).toBe(edited);
  expect(before.recoveryRaw).toBe(originalRaw);
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  await library.getByRole("tab", { name: "S15 · Recovery", exact: true }).click();
  await expect(library).toContainText("Recovery quota denied");
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDirectory, "before-core-retry.png"), fullPage: true });
  const nextWorker = page.waitForEvent("worker", worker => worker.url().includes("core.worker"));
  await library.getByRole("button", { name: "Retry Core / Catalog", exact: true }).first().click();
  await nextWorker;
  await library.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("tab", { name: "Domain Catalog", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Decision scope", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await page.getByRole("button", { name: "Compile tactics", exact: true }).click();
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILED", { timeout: 30_000 });
  const after = { source: await source.inputValue(), recoveryRaw: await page.evaluate(key => localStorage.getItem(key), recoveryKey) };
  const wasm = await page.request.get("/wasm/senkei_wasm.wasm");
  expect(wasm.ok()).toBe(true);
  writeFileSync(resolve(evidenceDirectory, "report.json"), JSON.stringify({
    sourceRevision: await page.locator('meta[name="senkei-build-revision"]').getAttribute("content"),
    wasmSha256: createHash("sha256").update(await wasm.body()).digest("hex"),
    rulesetDigest: JSON.parse(originalRaw!).ruleset.digest,
    before, after, pageErrors,
    actualCoreCompileAfterRetry: true,
    noEnbuMatchExecuted: true,
    currentRunPreservation: "NOT_CHECKED",
  }, null, 2));
  await page.screenshot({ path: resolve(evidenceDirectory, "after-core-retry.png"), fullPage: true });
  expect(after.source).toBe(edited);
  expect(after.recoveryRaw).toBe(originalRaw);
  expect(pageErrors).toEqual([]);
  await context.close();
});
