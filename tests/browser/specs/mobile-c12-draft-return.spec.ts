import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const evidenceDirectory = resolve(process.env.SENKEI_MOBILE_C12_EVIDENCE_DIR ?? "test-results/mobile-c12-draft-return");

test("UX-C12 retains an unsaved Jinrei Draft through Home return and an emulated landscape resize", async ({ page, baseURL, browserName }) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");
  mkdirSync(evidenceDirectory, { recursive: true });
  const pageErrors: string[] = [];
  const wasmResponses: Array<{ status: number; url: string }> = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) wasmResponses.push({ status: response.status(), url: response.url() });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL);
  await expect(page.getByTestId("journey-home")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("nav-next").click();
  const workspace = page.getByRole("region", { name: "Next local battle workshop", exact: true });
  await expect(workspace).toBeVisible();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Jinrei source", exact: true });
  await expect(source).toBeVisible();

  const originalSource = await source.inputValue();
  const editedSource = `${originalSource}\n// ux_c12_return_marker\n`;
  await source.fill(editedSource);
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILE REQUIRED");
  await expect(page.locator(".journey-draft-status")).toContainText("未保存Draft");
  await page.screenshot({ path: resolve(evidenceDirectory, "portrait-edited.png"), fullPage: true });

  await page.getByTestId("nav-home").click();
  await expect(page.getByTestId("journey-home")).toBeVisible();
  await page.getByTestId("nav-next").click();
  await expect(workspace).toBeVisible();
  const selectedWorkspaceTab = await page.locator('#next-tab-jinrei').getAttribute("aria-selected");
  const selectedJinreiEditorTab = await page.getByRole("tab", { name: "Jinrei Text", exact: true }).getAttribute("aria-selected");
  const sourceAfterWorkspaceReturn = await source.inputValue();
  const compileAfterWorkspaceReturn = await page.locator(".next-compile-state").innerText();
  expect(selectedWorkspaceTab).toBe("true");
  expect(selectedJinreiEditorTab).toBe("true");
  expect(sourceAfterWorkspaceReturn).toBe(editedSource);
  expect(compileAfterWorkspaceReturn).toContain("COMPILE REQUIRED");
  await expect(source).toHaveValue(editedSource);
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILE REQUIRED");

  const layout = [] as Array<Record<string, unknown>>;
  for (const viewport of [
    { name: "portrait", width: 390, height: 844 },
    { name: "landscape-shaped", width: 844, height: 390 },
    { name: "portrait-restored", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await source.scrollIntoViewIfNeeded();
    await expect(source).toHaveValue(editedSource);
    await expect(source).toBeVisible();
    const state = await page.evaluate(() => {
      const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Jinrei source"]');
      if (!input) throw new Error("The Jinrei source input is unavailable.");
      const rect = input.getBoundingClientRect();
      const workbenchRect = document.querySelector(".next-jinrei-workbench")!.getBoundingClientRect();
      const editorPaneRect = document.querySelector(".next-jinrei-editor-pane")!.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        sourceVisibleHeight: rect.height,
        sourceWidth: rect.width,
        workbenchWidth: workbenchRect.width,
        editorPaneWidth: editorPaneRect.width,
        sourceIntersectsViewport: rect.bottom > 0 && rect.top < window.innerHeight,
        sourceFocused: document.activeElement === input,
        compileState: document.querySelector(".next-compile-state")?.textContent?.trim(),
      };
    });
    expect(state.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(state.sourceIntersectsViewport).toBe(true);
    expect(state.compileState).toBe("COMPILE REQUIRED");
    layout.push({ name: viewport.name, ...state });
    await page.screenshot({ path: resolve(evidenceDirectory, `${viewport.name}.png`), fullPage: true });
  }

  const wasm = await page.request.get("/wasm/senkei_wasm.wasm");
  expect(wasm.ok()).toBe(true);
  expect(wasmResponses.some(response => response.status === 200)).toBe(true);
  writeFileSync(resolve(evidenceDirectory, "report.json"), JSON.stringify({
    sourceRevision: await page.locator('meta[name="senkei-build-revision"]').getAttribute("content"),
    sourceSha256: createHash("sha256").update(editedSource).digest("hex"),
    wasmSha256: createHash("sha256").update(await wasm.body()).digest("hex"),
    browser: browserName,
    testedOperation: "390x844 Jinrei Text edit -> Home -> explicit Next workspace entry -> verify returned Jinrei/Text target without clicking editor tabs -> 844x390 viewport resize -> restore 390x844",
    navigationKind: "Home then explicit Next workspace entry; no in-app Back button or browser history traversal",
    returnState: { selectedWorkspaceTab, selectedJinreiEditorTab, sourcePreserved: sourceAfterWorkspaceReturn === editedSource, compileState: compileAfterWorkspaceReturn },
    result: "unsaved source and COMPILE REQUIRED state retained; no horizontal overflow; source stayed visible",
    layout,
    pageErrors,
    physicalOrientation: "NOT_CHECKED",
    physicalKeyboardAndIME: "NOT_CHECKED",
  }, null, 2));
  expect(pageErrors).toEqual([]);
});
