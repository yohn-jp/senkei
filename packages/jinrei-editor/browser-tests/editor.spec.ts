import { expect, test } from "@playwright/test";

test("catalog explorer, source diagnostics, actor selection and coverage operate in the isolated view", async ({ page }) => {
  await page.goto("/harness.html");
  await expect(page.getByRole("heading", { name: "Jinrei Editor Foundation" })).toBeVisible();
  await page.getByLabel("Jinrei v0.1 source").fill("senkei draft { }");
  await page.getByRole("button", { name: "Compile with this Catalog" }).click();
  await expect(page.locator("[data-diagnostics]")).toContainText("Compiled · 3 logical CU");

  await page.getByLabel("Jinrei v0.1 source").fill("senkei edited { }");
  await expect(page.locator("[data-diagnostics]")).toHaveText("Compiler has not run for this draft.");
  await page.evaluate(() => {
    const mounted = (window as Window & { __jinreiEditor?: { session: { setDraft(value: string): void }; refresh(): void } }).__jinreiEditor;
    mounted?.session.setDraft("senkei external { }");
    mounted?.refresh();
  });
  await expect(page.getByLabel("Jinrei v0.1 source")).toHaveValue("senkei external { }");
  await page.getByLabel("Jinrei v0.1 source").fill("senkei invalid { }");
  await page.getByRole("button", { name: "Compile with this Catalog" }).click();
  await expect(page.locator("[data-diagnostics]")).toContainText("compile_failed at /actions/0: unknown symbol");

  await page.getByRole("tab", { name: "catalog" }).click();
  await page.getByLabel("Search Catalog").fill("activate");
  await page.locator('[data-entry="activate"]').click();
  await expect(page.getByLabel("Catalog definition")).toContainText("3 CU + 0 CU/item");
  await expect(page.getByLabel("Catalog definition")).toContainText("package_entity(hero)");

  await page.getByLabel("Scope").selectOption("army");
  await expect.poll(() => page.evaluate(() => (window as Window & { __jinreiScope?: string }).__jinreiScope)).toBe("army");
  await page.getByRole("tab", { name: "coverage" }).click();
  await expect(page.getByRole("tabpanel", { name: "Behavior Coverage" })).toContainText("not_proven");
  await expect(page.getByRole("tabpanel", { name: "Behavior Coverage" })).toContainText("NOT_CHECKED");
  await page.getByRole("tab", { name: "observed" }).click();
  await expect(page.locator("[data-observed-status]")).toHaveText("NOT_CHECKED");
});
