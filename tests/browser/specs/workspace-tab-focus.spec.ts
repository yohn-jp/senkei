import { expect, test, type Locator, type Page } from "@playwright/test";

const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function state(page: Page, tab: Locator, stage: string): Promise<unknown> {
  return { stage, selected: await tab.getAttribute("aria-selected"), focused: await tab.evaluate(element => document.activeElement === element),
    active: await page.evaluate(() => ({ tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute("role"), text: document.activeElement?.textContent?.trim(), screen: document.querySelector(".next-workspace")?.getAttribute("data-screen") })) };
}

for (const width of [320, 390, 430, 1440]) for (const group of ["Hero Atelier", "Jinrei screens"]) {
  test(`${group} selected keyboard tab retains focus after entry frames at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const wasm: { status: number; url: string }[] = [], errors: string[] = [];
    page.on("response", response => { if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) wasm.push({ status: response.status(), url: response.url() }); });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByTestId("journey-home")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("nav-next").click();
    const workspace = page.getByRole("region", { name: "Next local battle workshop", exact: true });
    await expect(workspace).toBeVisible(); await settle(page);
    expect(await workspace.locator("h2:visible,h3:visible,h4:visible").evaluateAll(headings => headings.some(heading => document.activeElement === heading))).toBe(true);
    const notes: unknown[] = [];
    if (group === "Jinrei screens") { await page.locator("#next-tab-jinrei").click(); await settle(page); }
    const list = page.getByRole("tablist", { name: group, exact: true });
    const first = list.getByRole("tab", { name: group === "Hero Atelier" ? /Hero Collection/ : /Jinrei Workbench/ });
    const second = list.getByRole("tab", { name: group === "Hero Atelier" ? /Hero Detail/ : /Behavior Coverage/ });
    await first.focus(); await first.press("ArrowRight"); await settle(page);
    notes.push(await state(page, second, "ArrowRight after two frames"));
    await expect(second).toHaveAttribute("aria-selected", "true");
    expect.soft(await second.evaluate(element => document.activeElement === element)).toBe(true);
    await page.screenshot({ path: info.outputPath("arrow-right.png") });
    await second.press("ArrowLeft"); await settle(page);
    notes.push(await state(page, first, "ArrowLeft after two frames"));
    await expect(first).toHaveAttribute("aria-selected", "true");
    expect.soft(await first.evaluate(element => document.activeElement === element)).toBe(true);
    if (group === "Hero Atelier") {
      await workspace.getByRole("button", { name: /Inspect selected Hero/ }).click(); await settle(page);
      notes.push(await state(page, second, "ordinary Inspect button entry"));
      expect(await workspace.locator("h2:visible,h3:visible,h4:visible").evaluateAll(headings => headings.some(heading => document.activeElement === heading))).toBe(true);
    }
    // A real screen transition from ordinary navigation still focuses its heading.
    await page.getByTestId("nav-home").click(); await settle(page);
    expect(await workspace.locator("h2:visible,h3:visible,h4:visible").evaluateAll(headings => headings.some(heading => document.activeElement === heading))).toBe(true);
    await page.getByTestId("nav-next").click(); await settle(page);
    notes.push(await state(page, group === "Hero Atelier" ? second : first, "ordinary navigation reentry"));
    expect(await workspace.locator("h2:visible,h3:visible,h4:visible").evaluateAll(headings => headings.some(heading => document.activeElement === heading))).toBe(true);
    expect(wasm.some(response => response.status === 200)).toBe(true);
    expect(errors).toEqual([]);
    await info.attach("focus-states.json", { body: JSON.stringify({ width, group, wasm, errors, notes }, null, 2), contentType: "application/json" });
  });
}
