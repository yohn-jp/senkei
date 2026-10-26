import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";

const evidenceDirectory = resolve(process.env.SENKEI_MOBILE_CONTROLS_EVIDENCE_DIR ?? "test-results/mobile-controls-acceptance");
const viewports = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

test("Replay presentation controls stay operable and keep the current Tick at all supported widths", async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors: string[] = [];
  const observations: Array<{ width: number; height: number; tick: string; layerTargets: Array<{ x: number; right: number; y: number; height: number }>; modeTargetHeights: number[] }> = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う", exact: true }).click();
  await page.getByRole("button", { name: "この条件で進む", exact: true }).click();
  await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
  await completePreflight(page);
  await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
  await page.locator("#next-tab-battle").click();

  const seek = page.getByRole("slider", { name: "Seek replay tick", exact: true });
  await expect(seek).toBeEnabled();
  await seek.focus();
  await seek.press("Home");
  await seek.press("PageUp");
  const play = page.getByRole("button", { name: /^(Play|Pause) replay$/ });
  if (await play.getAttribute("aria-label") === "Pause replay") await play.click();

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const tick = await seek.inputValue();
    const controls = page.locator(".next-battle-view-controls");
    const mode = controls.getByRole("group", { name: "Presentation mode", exact: true });
    const cinematic = mode.getByRole("button", { name: "Cinematic", exact: true });
    const tactical = mode.getByRole("button", { name: "Tactical", exact: true });

    await expect(controls).toBeVisible();
    await expect(cinematic).toBeVisible();
    await cinematic.click();
    await expect(cinematic).toHaveAttribute("aria-pressed", "true");
    await tactical.click();
    await expect(tactical).toHaveAttribute("aria-pressed", "true");

    const layerLabels = controls.locator(".next-battle-layer-control label");
    await expect(layerLabels).toHaveCount(3);
    const labelRects = await layerLabels.evaluateAll(labels => labels.map(label => {
      const rect = label.getBoundingClientRect();
      return { x: rect.x, right: rect.right, y: rect.y, height: rect.height };
    }));
    expect(labelRects.every(rect => rect.x >= 0 && rect.right <= viewport.width)).toBe(true);
    if (viewport.width <= 430) {
      expect(labelRects.every(rect => rect.height >= 44)).toBe(true);
      expect(new Set(labelRects.map(rect => rect.y)).size).toBe(1);
      const modeRects = await mode.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
      expect(modeRects.every(height => height >= 44)).toBe(true);
    }

    for (const name of ["Vision", "Lanes", "Engagements"]) {
      const checkbox = controls.getByRole("checkbox", { name, exact: true });
      const checked = await checkbox.isChecked();
      await checkbox.setChecked(!checked);
      await expect(checkbox).toHaveJSProperty("checked", !checked);
      await checkbox.setChecked(checked);
      await expect(checkbox).toHaveJSProperty("checked", checked);
    }

    await expect(seek).toHaveValue(tick);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expect(controls).toHaveJSProperty("scrollWidth", await controls.evaluate(element => element.clientWidth));
    const modeTargetHeights = await mode.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
    observations.push({ width: viewport.width, height: viewport.height, tick, layerTargets: labelRects, modeTargetHeights });
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, `battle-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }

  const wasm = await page.request.get("/wasm/senkei_wasm.wasm");
  expect(wasm.ok()).toBe(true);
  writeFileSync(resolve(evidenceDirectory, "report.json"), JSON.stringify({
    sourceRevision: await page.locator('meta[name="senkei-build-revision"]').getAttribute("content"),
    wasmSha256: createHash("sha256").update(await wasm.body()).digest("hex"),
    scenario: "fresh confirmed local Enbu match",
    tested: ["Tactical/Cinematic mode", "Vision/Lanes/Engagements layer toggles", "tick preservation", "touch targets", "horizontal overflow", "page errors"],
    observations,
    pageErrors,
  }, null, 2));
  expect(pageErrors).toEqual([]);
});
