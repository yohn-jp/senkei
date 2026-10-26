import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) test(`Read-only skill context renders actual owner frames at ${width}px`, async ({ page }) => {
  const server = await createServer({ configFile: false, root: process.cwd(), logLevel: "silent", server: { middlewareMode: true }, appType: "custom" });
  try {
    const { deriveSkillRunProgress } = await server.ssrLoadModule("/apps/web/src/features/next/skill-run-progress.ts");
    const { SkillRunProgressContext } = await server.ssrLoadModule("/apps/web/src/features/next/SkillRunProgressContext.tsx");
    const actual = JSON.parse(readFileSync("tests/fixtures/s06-actual-owner-frames.json", "utf8"));
    const css = readFileSync("apps/web/src/features/next/skill-run-progress.css", "utf8");
    await page.setViewportSize({ width, height: 844 });
    for (const state of [0, 85, "public"] as const) {
      const tick = state === "public" ? 85 : state;
      const html = renderToStaticMarkup(createElement(SkillRunProgressContext, { progress: deriveSkillRunProgress({ ...actual, tick, ...(state === "public" ? { ownerReplay: null } : {}) }) }));
      await page.setContent(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:12px;font:16px system-ui;background:#10191d}${css}</style></head><body>${html}</body></html>`);
      const context = page.getByRole("complementary", { name: "Run skill acquisition context" });
      await expect(context).toContainText(`Tick ${tick}`);
      await expect(context).toContainText(actual.matchId);
      const acquired = context.locator("li").filter({ hasText: / · Acquired$/ });
      await expect(acquired).toHaveCount(state === 85 ? 1 : 0);
      if (state === "public") { await expect(context).toContainText("Unavailable"); await expect(context).toContainText("Unknown"); }
      await expect(context.getByRole("button")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `test-results/s06-actual-owner-${state}-${width}.png`, fullPage: true });
    }
  } finally { await server.close(); }
});
