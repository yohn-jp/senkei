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
  const selectedJinreiScreenTab = await page.getByRole("tab", { name: /Jinrei Workbench/ }).getAttribute("aria-selected");
  const selectedJinreiEditorTab = await page.getByRole("tab", { name: "Jinrei Text", exact: true }).getAttribute("aria-selected");
  const sourceAfterWorkspaceReturn = await source.inputValue();
  const compileAfterWorkspaceReturn = await page.locator(".next-compile-state").innerText();
  expect(selectedWorkspaceTab).toBe("true");
  expect(selectedJinreiScreenTab).toBe("true");
  expect(selectedJinreiEditorTab).toBe("true");
  expect(sourceAfterWorkspaceReturn).toBe(editedSource);
  expect(compileAfterWorkspaceReturn).toContain("COMPILE REQUIRED");
  await expect(source).toHaveValue(editedSource);
  await expect(page.locator(".next-compile-state")).toHaveText("COMPILE REQUIRED");

  const layout = [] as Array<Record<string, unknown>>;
  let expectedSource = editedSource;
  let landscapeEditPreserved = false;
  for (const viewport of [
    { name: "portrait-390", width: 390, height: 844 },
    { name: "landscape-844", width: 844, height: 390 },
    { name: "portrait-restored-390", width: 390, height: 844 },
    { name: "portrait-320", width: 320, height: 844 },
    { name: "portrait-430", width: 430, height: 932 },
    { name: "desktop-1440", width: 1440, height: 900 },
    { name: "desktop-1920", width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await source.scrollIntoViewIfNeeded();
    await expect(page.locator("#next-tab-jinrei")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: /Jinrei Workbench/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Jinrei Text", exact: true })).toHaveAttribute("aria-selected", "true");
    if (viewport.name === "landscape-844") {
      expectedSource = `${expectedSource}// ux_c12_landscape_marker\n`;
      await source.fill(expectedSource);
      await expect(page.locator(".next-compile-state")).toHaveText("COMPILE REQUIRED");
      landscapeEditPreserved = (await source.inputValue()) === expectedSource;
    }
    await expect(source).toHaveValue(expectedSource);
    await expect(source).toBeVisible();
    const state = await page.evaluate(() => {
      const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Jinrei source"]');
      if (!input) throw new Error("The Jinrei source input is unavailable.");
      const rect = input.getBoundingClientRect();
      const workbenchRect = document.querySelector(".next-jinrei-workbench")!.getBoundingClientRect();
      const editorPaneRect = document.querySelector(".next-jinrei-editor-pane")!.getBoundingClientRect();
      const sidebar = document.querySelector<HTMLElement>(".app-shell > .sidebar")!;
      const nextTabs = document.querySelector<HTMLElement>(".next-tabs")!;
      const editorLayout = document.querySelector<HTMLElement>(".next-jinrei-panel .editor-layout")!;
      const editorConfiguration = document.querySelector<HTMLElement>(".next-jinrei-panel .editor-configuration")!;
      const editorTactics = document.querySelector<HTMLElement>(".next-jinrei-panel .editor-tactics")!;
      const bounds = (element: HTMLElement) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        sourceY: rect.y,
        sourceVisibleHeight: rect.height,
        sourceWidth: rect.width,
        workbenchWidth: workbenchRect.width,
        editorPaneWidth: editorPaneRect.width,
        appSidebar: bounds(sidebar),
        appShellColumns: getComputedStyle(document.querySelector<HTMLElement>(".app-shell")!).gridTemplateColumns,
        appSidebarNavDisplay: getComputedStyle(sidebar.querySelector<HTMLElement>(".primary-nav")!).display,
        nextTabs: bounds(nextTabs),
        nextTabsDisplay: getComputedStyle(nextTabs).display,
        nextTabsPosition: getComputedStyle(nextTabs).position,
        editorLayout: { ...bounds(editorLayout), gridTemplateColumns: getComputedStyle(editorLayout).gridTemplateColumns },
        editorConfigurationWidth: editorConfiguration.getBoundingClientRect().width,
        editorTacticsWidth: editorTactics.getBoundingClientRect().width,
        selectedWorkspaceTab: document.querySelector("#next-tab-jinrei")?.getAttribute("aria-selected"),
        selectedJinreiScreenTab: Array.from(document.querySelectorAll<HTMLElement>(".next-jinrei-screen-nav [role=tab]")).find(tab => tab.textContent?.includes("Jinrei Workbench"))?.getAttribute("aria-selected"),
        selectedJinreiEditorTab: Array.from(document.querySelectorAll<HTMLElement>(".next-jinrei-view-nav [role=tab]")).find(tab => tab.textContent?.trim() === "Jinrei Text")?.getAttribute("aria-selected"),
        scrollY: window.scrollY,
        sourceIntersectsViewport: rect.bottom > 0 && rect.top < window.innerHeight,
        sourceFocused: document.activeElement === input,
        compileState: document.querySelector(".next-compile-state")?.textContent?.trim(),
      };
    });
    expect(state.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(state.sourceIntersectsViewport).toBe(true);
    expect(state.compileState).toBe("COMPILE REQUIRED");
    layout.push({ name: viewport.name, ...state });
    await source.evaluate(input => { input.scrollTop = 0; });
    if (viewport.name === "landscape-844") {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: resolve(evidenceDirectory, "landscape-844-app-navigation.png"), fullPage: false });
      await page.locator(".next-tabs").scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(evidenceDirectory, "landscape-844-workbench-navigation.png"), fullPage: false });
      await source.scrollIntoViewIfNeeded();
    }
    await page.screenshot({ path: resolve(evidenceDirectory, `${viewport.name}.png`), fullPage: false });
  }

  const wasm = await page.request.get("/wasm/senkei_wasm.wasm");
  expect(landscapeEditPreserved).toBe(true);
  expect(wasm.ok()).toBe(true);
  expect(wasmResponses.some(response => response.status === 200)).toBe(true);
  writeFileSync(resolve(evidenceDirectory, "report.json"), JSON.stringify({
    sourceRevision: await page.locator('meta[name="senkei-build-revision"]').getAttribute("content"),
    sourceSha256: createHash("sha256").update(expectedSource).digest("hex"),
    wasmSha256: createHash("sha256").update(await wasm.body()).digest("hex"),
    browser: browserName,
    testedOperation: "390x844 Jinrei Text edit -> Home -> explicit Next workspace entry -> verify returned Jinrei/Text target without clicking editor tabs -> append to the same Draft at 844x390 -> restore 390x844, then inspect 320x844/430x932/1440x900/1920x1080",
    navigationKind: "Home then explicit Next workspace entry; no in-app Back button or browser history traversal",
    returnState: { selectedWorkspaceTab, selectedJinreiScreenTab, selectedJinreiEditorTab, sourcePreserved: sourceAfterWorkspaceReturn === editedSource, compileState: compileAfterWorkspaceReturn },
    landscapeEditPreserved,
    result: "the same unsaved source remained editable at 844x390 and retained COMPILE REQUIRED state; no horizontal overflow; source stayed visible at each captured viewport",
    layout,
    pageErrors,
    physicalOrientation: "NOT_CHECKED",
    physicalKeyboardAndIME: "NOT_CHECKED",
  }, null, 2));
  expect(pageErrors).toEqual([]);
});
