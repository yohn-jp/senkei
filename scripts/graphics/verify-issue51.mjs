#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

const url = option("url");
const source = option("source");
const output = option("output");
const executablePath = option("chromium") ?? process.env.SENKEI_CHROMIUM_EXECUTABLE;
const annotations = option("annotations") ?? "on";
const tick = Number(option("tick") ?? "13");
if (!url || !source || !output || !/^[a-f0-9]{7,40}$/i.test(source)
    || !["on", "off"].includes(annotations) || !Number.isInteger(tick) || tick < 1) {
  throw new Error("Usage: node scripts/graphics/verify-issue51.mjs --url <production-preview-url> --source <build-commit> --output <directory> [--chromium <path>] [--annotations on|off] [--tick <positive-integer>]");
}

const hash = data => createHash("sha256").update(data).digest("hex");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
const check = (condition, message) => { if (!condition) throw new Error(message); };

try {
  await page.goto(url, { waitUntil: "networkidle" });
  const buildRevision = await page.locator('meta[name="senkei-build-revision"]').getAttribute("content");
  check(buildRevision?.startsWith(source), `Expected production build ${source}; received ${buildRevision}`);
  const wasmResponse = await page.request.get(new URL("/wasm/senkei_wasm.wasm", url).href);
  check(wasmResponse.ok(), `WASM request failed: ${wasmResponse.status()}`);
  const wasmSha256 = hash(await wasmResponse.body());

  await page.getByTestId("nav-next").click();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await page.getByText("Compilation completed by the Jinrei core.").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator("#next-tab-battle").click();
  await page.getByRole("button", { name: /Launch local battle|New local battle/i }).click();
  await page.getByTestId("journey-ready").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "検証・コンパイル" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="preflight-status"]')?.textContent === "開始可能", null, { timeout: 60_000 });
  await page.getByRole("button", { name: "戦闘開始" }).click();
  await page.getByText(/AUTHORITATIVE ENBU RESULT|Confirmed result/i).first().waitFor({ state: "visible", timeout: 120_000 });
  const canvas = page.locator(".next-renderer-host canvas");
  await page.waitForFunction(() => document.querySelector(".next-renderer-host canvas")?.getAttribute("data-rendered") === "true", null, { timeout: 30_000 });
  if (annotations === "off") {
    await page.getByRole("checkbox", { name: "Lanes", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Engagements", exact: true }).uncheck();
  }
  for (const name of ["Lanes", "Engagements"]) {
    const enabled = await page.getByRole("checkbox", { name, exact: true }).isChecked();
    check(enabled === (annotations === "on"), `${name} annotation does not match --annotations ${annotations}`);
  }
  const slider = page.getByRole("slider", { name: "Seek replay tick" });
  const maximum = Number(await slider.getAttribute("max"));
  check(Number.isInteger(maximum) && maximum > tick, `Battle ended at ${maximum}, before rewind test Tick ${tick + 1}`);
  const seek = async selectedTick => {
    await slider.evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, String(value));
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, selectedTick);
    await page.waitForFunction(value => document.querySelector(".next-renderer-host canvas")?.getAttribute("data-tick") === String(value), selectedTick, { timeout: 30_000 });
  };
  const results = [];
  const mismatches = [];
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^(Overview|Overview view)$/i }).first().click();
    await page.waitForFunction(() => document.querySelector(".next-renderer-host canvas")?.getAttribute("data-camera-mode") === "overview", null, { timeout: 30_000 });
    const captures = [];
    const capture = async kind => {
      await page.waitForTimeout(250);
      const image = await canvas.screenshot({ animations: "disabled" });
      const filename = `${viewport.width}-${kind}-tick${tick}.png`;
      await writeFile(join(output, filename), image);
      const overlay = await page.locator(".next-renderer-host .world-label, .next-renderer-host .base-site-label, .next-minimap-legend i").evaluateAll(elements => {
        const canvasRect = document.querySelector(".next-renderer-host canvas").getBoundingClientRect();
        const round = value => Math.round(value * 1000) / 1000;
        return elements.map(element => {
          const style = getComputedStyle(element);
          if (element.hidden || style.display === "none" || style.visibility === "hidden") return null;
          const rect = element.getBoundingClientRect();
          return {
            className: element.className,
            text: element.textContent,
            ariaLabel: element.getAttribute("aria-label"),
            bounds: [rect.left - canvasRect.left, rect.top - canvasRect.top, rect.width, rect.height].map(round),
            color: style.color,
            background: style.backgroundColor,
          };
        }).filter(Boolean);
      });
      captures.push({ kind, filename, sha256: hash(image), camera: await canvas.getAttribute("data-camera"), target: await canvas.getAttribute("data-camera-target"), overlay });
    };
    await seek(0);
    await seek(tick);
    await capture("direct");
    await seek(0);
    for (let step = 1; step <= tick; step++) await seek(step);
    await capture("stepped");
    await seek(tick + 1);
    await seek(tick);
    await capture("rewind");
    for (const candidate of captures.slice(1)) {
      if (candidate.sha256 !== captures[0].sha256)
        mismatches.push(`${viewport.width}: ${candidate.kind} pixels differ from direct`);
      if (candidate.camera !== captures[0].camera || candidate.target !== captures[0].target)
        mismatches.push(`${viewport.width}: ${candidate.kind} camera differs from direct`);
      if (JSON.stringify(candidate.overlay) !== JSON.stringify(captures[0].overlay))
        mismatches.push(`${viewport.width}: ${candidate.kind} visible overlays differ from direct`);
    }
    results.push({ viewport, captures });
  }
  const report = { sourceRevision: buildRevision, wasmSha256, browser: browser.version(), renderer: "Chromium SwiftShader", reducedMotion: true, camera: "overview", annotations, tick, resultTick: maximum, results, pageErrors, mismatches };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  check(!pageErrors.length && !mismatches.length, `Comparison failed; see ${join(output, "report.json")}`);
  console.log(`Replay placement comparisons passed; evidence: ${output}`);
} finally {
  await browser.close();
}
