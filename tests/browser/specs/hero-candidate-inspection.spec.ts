import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`candidate inspection preserves Draft until explicit adoption at ${viewport.width}px`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport, isMobile: viewport.width < 761, hasTouch: viewport.width < 761 });
    const page = await context.newPage();
    await page.goto("/");
    if (viewport.width < 761) await page.getByTestId("journey-home").locator(".journey-start-mobile details > summary").click();
    await page.getByRole("button", { name: "自分で編成", exact: true }).click();
    await page.getByRole("button", { name: "この条件で進む" }).click();
    const savedDraft = () => page.evaluate(() => {
      const raw = localStorage.getItem("senkei.next-workspace-recovery.v1");
      if (!raw) return null;
      const setup = JSON.parse(raw);
      return { slots: setup.slots, draft: setup.draft, rival_source: setup.rival_source };
    });
    await expect.poll(savedDraft).not.toBeNull();
    const before = await savedDraft();
    await page.getByRole("button", { name: "Inspect Stoneheart without adopting", exact: true }).click();
    const preview = page.getByRole("region", { name: "Candidate adoption preview" });
    await expect(preview).toContainText("Slot 1:");
    await expect(preview).toContainText("Skill plan");
    await expect(preview).toContainText("Jinrei compile must be checked again");
    expect(await savedDraft()).toEqual(before);
    await page.screenshot({ path: `test-results/hero-candidate-${viewport.width}.png`, fullPage: true });
    await expect(page.getByRole("button", { name: "Plan this Hero's skills →" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to Collection", exact: true }).click();
    expect(await savedDraft()).toEqual(before);
    await page.getByRole("tab", { name: "Hero Detail" }).click();
    await expect(preview).toHaveCount(0);
    await page.getByRole("tab", { name: "Hero Collection" }).click();
    await page.getByRole("button", { name: "Inspect Stoneheart without adopting", exact: true }).click();
    await page.getByRole("button", { name: "Adopt Stoneheart in slot 1", exact: true }).click();
    await expect.poll(savedDraft).not.toEqual(before);
    const after = await savedDraft();
    expect(after.slots[0].catalog_id).toBe("F02");
    expect(after.slots.slice(1)).toEqual(before.slots.slice(1));
    expect(after.slots[0].squad).toBe(before.slots[0].squad);
    expect(after.slots[0].node).toBe(before.slots[0].node);
    expect(after.rival_source).toEqual(before.rival_source);
    await expect(page.getByRole("heading", { name: "Stoneheart", exact: true })).toBeVisible();
    await expect(preview).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await context.close();
  });
}
