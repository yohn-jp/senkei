import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const output = resolve(process.env.SENKEI_ART_OUTPUT ?? "test-results/art-production/captures");
const goldenHeroes = [{ id: "F01", name: "Bannerhold" }, { id: "R01", name: "Tempest" }] as const;
type Capture = { image: string; label: string; attributes: Record<string, string>; sha256: string };

async function capture(canvas: Locator, label: string, captures: Capture[]) {
  await canvas.scrollIntoViewIfNeeded();
  // Two paint boundaries after the control event; screenshots capture actual WebGL pixels.
  await canvas.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const image = `${label}.png`;
  const bytes = await canvas.screenshot({ path: resolve(output, image), animations: "disabled" });
  const attributes = await canvas.evaluate(node => Object.fromEntries(Array.from(node.attributes).filter(a => a.name.startsWith("data-")).map(a => [a.name, a.value])));
  captures.push({ image, label, attributes, sha256: createHash("sha256").update(bytes).digest("hex") });
}

async function orbit(page: Page, canvas: Locator, yaw: number) {
  const camera = (await canvas.getAttribute("data-camera"))!.split(",").map(Number);
  const bounds = (await canvas.boundingBox())!;
  const currentYaw = Math.atan2(camera[0]! - camera[3]!, camera[2]! - camera[5]!);
  const dx = (currentYaw - yaw) * bounds.height / (Math.PI * 2 * 0.7);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + dx, bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.up();
}

test("actual Hero Detail golden candidates and production battlefield", async ({ page, browser }) => {
  // Two real 3D previews across multiple angles, animation poses and viewports,
  // followed by a full Rust/WASM battle, cannot complete under Playwright's
  // 60-second default on the CI software GPU. Keep every capture and assertion.
  test.setTimeout(900_000);
  mkdirSync(output, { recursive: true });
  const captures: Capture[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const consoleErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const httpErrors: Array<{ status: number; method: string; url: string }> = [];
  page.on("response", response => {
    if (response.status() >= 400) httpErrors.push({
      status: response.status(), method: response.request().method(), url: response.url(),
    });
  });
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  const wasm = resolve("apps/web/public/wasm/senkei_wasm.wasm");
  const manifest = {
    schema: "senkei-art-browser-evidence/v1", sourceRevision: revision, dirtyWorktree: dirty,
    browser: browser.version(), viewport: { width: 1440, height: 1000 },
    renderer: "Chromium SwiftShader software GPU; timings do not predict physical GPU performance",
    wasmSha256: existsSync(wasm) ? createHash("sha256").update(readFileSync(wasm)).digest("hex") : null,
    goldenCandidates: goldenHeroes, captures, errors, consoleErrors, httpErrors,
    acceptance: "UNVERIFIED: capture success is not artistic acceptance; inspect images and record review separately",
    unavailableEvidence: ["neutral-clay override (no public control)", "LOD selection (no public control)", "physical GPU timings", "source concept comparison"],
    status: "running", failure: null as string | null,
  };
  const flush = () => writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  flush();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "自分で編成", exact: true }).click();
    await page.getByRole("button", { name: "この条件で進む" }).click();
    const tabs = page.getByRole("tablist", { name: "Hero Atelier" });
    await expect(tabs).toBeVisible();
    for (const hero of goldenHeroes) {
      await tabs.getByRole("tab", { name: /^Hero Collection/ }).click();
      const slots = page.getByRole("group", { name: "Five selected Hero slots" }).getByRole("button");
      const labels = await slots.allInnerTexts();
      const assigned = labels.findIndex(label => new RegExp(`\\b${hero.id}\\b`).test(label));
      await slots.nth(assigned >= 0 ? assigned : 1).click();
      if (assigned < 0) await page.getByRole("region", { name: "Filtered hero catalog" }).getByRole("button", { name: new RegExp(`^${hero.id}\\b`) }).click();
      await tabs.getByRole("tab", { name: /^Hero Detail/ }).click();
      const preview = page.getByRole("region", { name: `${hero.name} 3D model`, exact: true });
      const canvas = preview.locator("canvas");
      await expect(canvas).toHaveAttribute("data-preview-ready", "true");
      await expect(canvas).toHaveAttribute("data-catalog-id", hero.id);
      await expect(canvas).toHaveAttribute("data-preview-mode", "catalog");
      for (const [name, yaw] of [["front", 0], ["quarter", Math.PI / 4], ["side", Math.PI / 2], ["rear", Math.PI]] as const) {
        await preview.getByRole("button", { name: "Reset view", exact: true }).click();
        await orbit(page, canvas, yaw);
        await capture(canvas, `${hero.id}-${name}-idle`, captures); flush();
      }
      await preview.getByRole("button", { name: "Reset view", exact: true }).click();
      for (const pose of ["move", "attack", "hit", "death"] as const) {
        await preview.getByRole("button", { name: `Preview ${pose} animation`, exact: true }).click();
        await expect(canvas).toHaveAttribute("data-pose", pose);
        await capture(canvas, `${hero.id}-default-${pose}`, captures); flush();
      }
      await preview.getByRole("button", { name: "Preview idle animation", exact: true }).click();
      await canvas.hover();
      await page.mouse.wheel(0, -1800);
      await capture(canvas, `${hero.id}-closest-available`, captures); flush();
      await page.setViewportSize({ width: 390, height: 844 });
      await preview.getByRole("button", { name: "Reset view", exact: true }).click();
      await capture(canvas, `${hero.id}-mobile-idle`, captures); flush();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    // Production integration: real compile, Worker/WASM match, authorized replay and UI renderer.
    await page.locator("#next-tab-jinrei").click();
    await page.getByRole("tab", { name: /^Jinrei Text/ }).click();
    await page.getByRole("button", { name: "Compile tactics", exact: true }).click();
    await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
    await page.locator("#next-tab-battle").click();
    await page.getByRole("button", { name: /Launch local battle|New local battle/i }).click();
    // Use this runner's Playwright instance; importing tests/browser's helper loads
    // a second @playwright/test from its separate node_modules and aborts test discovery.
    await expect(page.getByTestId("journey-ready")).toBeVisible();
    await page.getByRole("button", { name: "検証・コンパイル" }).click();
    await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
    await page.getByRole("button", { name: "戦闘開始" }).click();
    const battlefield = page.locator(".next-renderer-host canvas");
    await expect(battlefield).toHaveAttribute("data-rendered", "true", { timeout: 240_000 });
    await capture(battlefield, "battlefield-default-t000", captures); flush();
    const modes = page.getByRole("group", { name: "Presentation mode", exact: true });
    await modes.getByRole("button", { name: "Cinematic", exact: true }).click();
    await expect(battlefield).toHaveAttribute("data-presentation-mode", "cinematic");
    await capture(battlefield, "battlefield-cinematic-t000", captures); flush();
    expect(errors).toEqual([]);
    manifest.status = consoleErrors.length ? "captured-with-console-errors-awaiting-visual-review" : "captured-awaiting-human-visual-review";
  } catch (error) {
    manifest.status = "failed"; manifest.failure = String(error);
    await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally { flush(); }
});
