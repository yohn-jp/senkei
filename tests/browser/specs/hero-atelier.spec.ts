import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const viewports = [
  { name: "1440x900", width: 1440, height: 900, mobile: false },
  { name: "1920x1080", width: 1920, height: 1080, mobile: false },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "430x932", width: 430, height: 932, mobile: true },
  { name: "320x740", width: 320, height: 740, mobile: true },
] as const;

for (const viewport of viewports) {
  test(`Hero Atelier screens work at ${viewport.name}`, async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");

    const context = await browser.newContext({
      baseURL,
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/");
    await page.getByTestId("nav-next").click();

    if (viewport.mobile) {
      const disclosure = page.locator(".next-save-disclosure > summary");
      await expect(disclosure).toBeVisible();
      expect(await page.locator(".next-save-disclosure").evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
      await disclosure.click();
      await expect(page.getByRole("button", { name: "Save setup" })).toBeVisible();
      await page.screenshot({ path: `../../docs/evidence/next/atelier/${viewport.name}-save-disclosure.png` });
      await disclosure.click();
      await expect(page.getByRole("button", { name: "Save setup" })).toBeHidden();
    }

    const atelier = page.getByRole("tablist", { name: "Hero Atelier" });
    await expect(atelier).toBeVisible();
    const collection = atelier.getByRole("tab", { name: "Hero Collection" });
    await expect(collection).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Choose your heroes" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Choose hero for slot/ })).toHaveCount(5);

    mkdirSync("../../docs/evidence/next/atelier", { recursive: true });
    await page.screenshot({ path: `../../docs/evidence/next/atelier/${viewport.name}-collection.png` });

    // Pick an unused real catalog identity in slot 2, then confirm the same
    // choice is visible in the shared Detail/Tree/Assembly draft.
    await page.getByRole("button", { name: "Choose hero for slot 2" }).click();
    await page.getByRole("region", { name: "Filtered hero catalog" }).getByRole("button", { name: /F02.*Stoneheart/ }).click();
    await expect(page.getByRole("group", { name: "Five selected Hero slots" })).toContainText("Stoneheart");
    await page.screenshot({ path: `../../docs/evidence/next/atelier/${viewport.name}-collection-catalog.png` });
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewport.width);

    for (const [label, screenshot, heading] of [
      ["Hero Detail", "detail", /Hero detail/],
      ["Skill Tree", "skill-tree", /Plan a skill tree/],
      ["Squad Assembly", "squad-assembly", /Assemble your squads/],
    ] as const) {
      const button = atelier.getByRole("tab", { name: label });
      await button.click();
      await expect(button).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      if (label === "Hero Detail") await expect(page.getByRole("heading", { name: "Stoneheart" })).toBeVisible();
      if (label === "Skill Tree") {
        const pathB = page.getByRole("button", { name: "Choose Path B for slot-02" });
        await pathB.click();
        await expect(pathB).toHaveAttribute("aria-pressed", "true");
        await page.screenshot({ path: `../../docs/evidence/next/atelier/${viewport.name}-skill-tree-plan.png` });
      }
      if (label === "Squad Assembly") {
        const split = page.getByRole("button", { name: "Use squad split 2+2+1" });
        await split.click();
        await expect(split).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("region", { name: "Squad formation preview" })).toContainText("2+2+1");
      }
      await page.locator("#next-panel-formation .next-panel-header").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `../../docs/evidence/next/atelier/${viewport.name}-${screenshot}.png` });
    }
    expect(pageErrors).toEqual([]);
    await context.close();
  });
}
