import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.use({ video: "on" });

test("real WASM Next workbench supports editing, replay, rematch, mobile and offline restore", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");

  const pageErrors: string[] = [];
  const wasmResponses: { readonly status: number; readonly fromServiceWorker: boolean; readonly url: string }[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.context().on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) {
      wasmResponses.push({ status: response.status(), fromServiceWorker: response.fromServiceWorker(), url:response.url() });
    }
  });

  await page.setViewportSize({width:1440,height:900});
  // A previous install can retain a fixed-name core in the offline cache.
  // The current content fingerprint must bypass that obsolete binary.
  await page.goto(`${baseURL}/graphics/`, {waitUntil:"networkidle"});
  await page.evaluate(async () => {
    const cache = await caches.open("senkei-web-offline-v1");
    await cache.put("/wasm/senkei_wasm.wasm", new Response(new Uint8Array([0,97,115,109,1,0,0,0]), {headers:{"Content-Type":"application/wasm"}}));
  });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByTestId("nav-next").click();
  await expect(page.getByRole("heading", { name: /Battle workbench/ })).toBeVisible();
  await expect(page.getByText("REAL LOCAL SIMULATION")).toBeVisible();

  const atelier = page.getByRole("tablist", {name:"Hero Atelier"});
  await atelier.getByRole("tab", {name:"Squad Assembly"}).click();
  await expect(page.getByRole("region", {name:"Squad formation preview"})).toContainText("Quintet");
  await atelier.getByRole("tab", {name:"Hero Collection"}).click();
  await page.locator(".next-catalog-card").nth(1).click();
  await atelier.getByRole("tab", {name:"Skill Tree"}).click();
  const pathB = page.getByRole("button", {name:"Choose Path B for slot-01"});
  await pathB.click();
  await expect(pathB).toHaveAttribute("aria-pressed","true");
  await page.locator("#next-tab-jinrei").click();
  const source = page.getByRole("textbox", { name: "Jinrei source" });
  const starterSource = await source.inputValue();
  const editedSource = starterSource.replace("when true,", "when match.tick < 374,");
  const recoverySource = editedSource.replace("match.tick < 374", "match.tick < 338");
  expect(editedSource).not.toBe(starterSource);
  await source.fill(editedSource);
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();
  await page.getByRole("button", { name: "Save setup" }).click();
  await expect(page.getByText("matches the current ruleset and can be restored.")).toBeVisible();

  await page.locator("#next-tab-battle").click();
  const diagnostics = page.getByRole("checkbox", { name: /Include my local replay and diagnostics/ });
  await expect(diagnostics).toBeChecked();
  const launch = page.getByRole("button", { name: "Launch local battle" });
  await expect(launch).toBeEnabled();
  await launch.click();
  await expect(page.getByText("AUTHORITATIVE ENBU RESULT")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".next-result-strip")).toContainText(/Attacker Victory|Defender Victory|Draw/);
  await expect(page.locator(".next-renderer-host canvas")).toHaveCount(1);
  await page.getByRole("button", {name:/^Analyze/}).click();
  await expect(page.getByRole("heading", {name:"Read the result"})).toBeVisible();
  await page.screenshot({path:"../../docs/evidence/next/analysis-1440.png"});
  const analysisEvent = page.locator(".next-timeline li button").nth(8);
  await expect(analysisEvent).toBeVisible();
  const analysisTick = (await analysisEvent.locator(".next-timeline-tick").innerText()).replace(/\D/g, "");
  await analysisEvent.click();
  await expect(page.locator("#next-tab-battle")).toHaveAttribute("aria-selected","true");
  await expect(page.locator(".next-tick-readout")).toContainText(analysisTick);

  const slider = page.getByRole("slider", { name: "Seek replay tick" });
  await slider.focus();
  await slider.press("Home");
  await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
  await page.getByRole("button", {name:"Play replay", exact:true}).click();
  // The hosted SwiftShader runner can advance more slowly under parallel
  // renderer load; verify cursor movement without making an FPS assertion.
  await expect.poll(async () => Number(await slider.inputValue()), {timeout:15_000}).toBeGreaterThanOrEqual(25);
  await page.getByRole("button", {name:"Pause replay", exact:true}).click();
  const pausedTick = await slider.inputValue();
  await page.waitForTimeout(250);
  await expect(slider).toHaveValue(pausedTick);

  // The same production replay is observable at an intermediate tick, and a
  // world selection must move the camera before Overview restores it.
  await slider.focus();
  await slider.press("Home");
  for (let tick = 0; tick < 50; tick += 1) await slider.press("ArrowRight");
  await expect(page.locator(".next-tick-readout")).toContainText("50");
  const canvas = page.locator(".next-renderer-host canvas");
  await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
  await page.screenshot({path:"../../docs/evidence/next/real-replay-overview-1440.png"});
  const initialCamera = await canvas.getAttribute("data-camera");
  const follow = page.getByRole("button", {name:"Follow", exact:true});
  const entitySelector = page.getByRole("combobox", {name:"Observe visible entity"});
  await expect(entitySelector).toBeEnabled();
  const visibleHeroValue = await entitySelector.locator("option").evaluateAll((options) =>
    options.find((option) => /\b[FR]0[1-6]\b/.test(option.textContent ?? ""))?.getAttribute("value") ?? null,
  );
  const selectedTarget = visibleHeroValue ?? await entitySelector.locator("option").nth(1).getAttribute("value");
  expect(selectedTarget).toBeTruthy();
  await entitySelector.selectOption(selectedTarget!);
  const selectedTargetLabel = await entitySelector.locator("option:checked").innerText();
  test.info().annotations.push({
    type: "follow target",
    description: /\b[FR]0[1-6]\b/.test(selectedTargetLabel)
      ? `Tick 50 camera follows visible Hero: ${selectedTargetLabel}`
      : `No living visible Hero is available at tick 50; camera follows ${selectedTargetLabel}`,
  });
  await expect(follow).toBeEnabled();
  await follow.click();
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(initialCamera);
  const followedCamera = await canvas.getAttribute("data-camera");
  for (let zoom = 0; zoom < 3; zoom += 1) await page.getByRole("button", {name:"Zoom in"}).click();
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(followedCamera);
  await page.screenshot({path:"../../docs/evidence/next/real-replay-follow-1440.png"});
  await page.getByRole("button", {name:"Overview", exact:true}).click();
  await expect.poll(() => canvas.getAttribute("data-camera")).toBe(initialCamera);

  const tickBeforeContextLoss = await slider.inputValue();
  await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const gl = target.getContext("webgl2") ?? target.getContext("webgl");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("WEBGL_lose_context is unavailable in the browser renderer.");
    extension.loseContext();
  });
  const retryRenderer = page.getByRole("button", {name:"Retry battlefield renderer"});
  await expect(retryRenderer).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Playback is paused at the current tick.");
  await expect(page.getByRole("alert")).toContainText(/WebGL.*失われました/);
  await expect(slider).toHaveValue(tickBeforeContextLoss);
  await expect(page.getByRole("button", {name:"Play replay", exact:true})).toBeVisible();
  await page.screenshot({path:"../../docs/evidence/next/webgl-context-lost-1440.png"});
  await retryRenderer.click();
  await expect.poll(() => page.locator(".next-renderer-host canvas").getAttribute("data-rendered")).toBe("true");
  await expect.poll(() => page.locator(".next-renderer-host canvas").getAttribute("data-tick")).toBe(tickBeforeContextLoss);
  await expect(slider).toHaveValue(tickBeforeContextLoss);
  await expect(page.getByRole("button", {name:"Retry battlefield renderer"})).toBeHidden();

  await slider.focus();
  await slider.press("End");
  await expect(page.locator(".next-tick-readout")).toContainText("/");
  await expect(page.locator(".next-stage-hud")).not.toContainText(/\b0 VISIBLE ENTITIES\b/);
  const pixelToggle = page.getByRole("button", {name:"Toggle Pixel 3D"});
  await expect(pixelToggle).toHaveAttribute("aria-pressed","true");
  await pixelToggle.click();
  await expect(pixelToggle).toHaveAttribute("aria-pressed","false");
  await page.screenshot({path:"../../docs/evidence/next/real-replay-smooth-1440.png"});
  await pixelToggle.click();
  await expect(pixelToggle).toHaveAttribute("aria-pressed","true");
  mkdirSync("../../docs/evidence/next", { recursive:true });
  await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
  await page.screenshot({path:"../../docs/evidence/next/desktop-battle.png"});
  const desktopStage = await page.locator(".next-renderer-host").boundingBox();
  expect(desktopStage!.width).toBeGreaterThanOrEqual(1440 * 0.7);
  expect(desktopStage!.height).toBeGreaterThanOrEqual(900 * 0.55);
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1920);
  await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
  await page.screenshot({path:"../../docs/evidence/next/desktop-battle-1920.png"});
  const wideStage = await page.locator(".next-renderer-host").boundingBox();
  expect(wideStage!.width).toBeGreaterThanOrEqual(1920 * 0.7);
  expect(wideStage!.height).toBeGreaterThanOrEqual(1080 * 0.55);
  const finalTick = await page.locator(".next-tick-readout").innerText();

  await page.locator("#next-tab-formation").click();
  await atelier.getByRole("tab", {name:"Skill Tree"}).click();
  const pathA = page.getByRole("button", {name:"Choose Path A for slot-01"});
  await pathA.click();
  await expect(pathA).toHaveAttribute("aria-pressed","true");
  await page.locator("#next-tab-battle").click();
  const revisedRun = page.getByRole("button", { name: "Run revised battle" });
  await expect(revisedRun).toBeEnabled();
  await revisedRun.click();
  await expect(launch).toBeEnabled({timeout:90_000});
  await expect(page.getByText("AUTHORITATIVE ENBU RESULT")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Save setup" }).click();
  await expect(page.getByText("matches the current ruleset and can be restored.")).toBeVisible();

  // Keep the F02 / Path A / editedSource setup as the pinned restore point.
  // The later F05 / Path B / recoverySource edits are deliberately unsaved.
  for (const [width, height, path] of [
    [390, 844, "mobile-battle.png"],
    [430, 932, "mobile-battle-430.png"],
    [320, 740, "mobile-battle-320.png"],
  ] as const) {
    await page.setViewportSize({ width, height });
    const mobileLayout = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      cameraControls: getComputedStyle(document.querySelector(".next-camera-controls")!).display,
    }));
    expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.width);
    expect(mobileLayout.cameraControls).not.toBe("none");
    await expect(page.locator(".next-renderer-host")).toBeVisible();
    await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
    await expect(page.locator(".next-replay-controls")).toBeInViewport();
    await expect(page.getByRole("slider", {name:"Seek replay tick"})).toBeInViewport();
    await page.screenshot({path:`../../docs/evidence/next/${path}`});
  }

  // Make all three post-save changes after the pinned baseline and viewport
  // evidence. No second Save action may overwrite the F02 / Path A / editedSource
  // restore point before the offline reload below.
  await page.locator("#next-tab-formation").click();
  await atelier.getByRole("tab", {name:"Hero Collection"}).click();
  await page.getByRole("region", {name:"Filtered hero catalog"}).getByRole("button", {name:/F05/}).click();
  await expect(page.getByRole("group", {name:"Five selected Hero slots"})).toContainText("F05");
  await atelier.getByRole("tab", {name:"Skill Tree"}).click();
  const recoveryPathB = page.getByRole("button", {name:"Choose Path B for slot-01"});
  await recoveryPathB.click();
  await expect(recoveryPathB).toHaveAttribute("aria-pressed","true");
  await page.locator("#next-tab-jinrei").click();
  await source.fill(recoverySource);
  await page.getByRole("button", {name:"Compile tactics"}).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();
  const recoveryBeforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem("senkei.next-workspace-recovery.v1") ?? "null"));
  expect(recoveryBeforeReload.slots.find((slot: {slot_id:string}) => slot.slot_id === "slot-01").skill_path).toBe("path_b");
  expect(recoveryBeforeReload.draft.program_input.source).toBe(recoverySource);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(async () => (await (await caches.open("senkei-web-offline-v1")).keys()).some(request => { const url=new URL(request.url); return url.pathname === "/wasm/senkei_wasm.wasm" && url.searchParams.has("rev"); }));
  await page.context().setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("nav-next").click();
    await expect(page.getByText("matches the current ruleset and can be restored.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Recovered this unsaved draft after reload/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("group", {name:"Five selected Hero slots"})).toContainText("F05");
    await page.locator("#next-tab-formation").click();
    await atelier.getByRole("tab", {name:"Skill Tree"}).click();
    await expect(page.getByRole("button", {name:"Choose Path B for slot-01"})).toHaveAttribute("aria-pressed","true");
    await page.locator("#next-tab-jinrei").click();
    await expect(page.getByRole("textbox", { name: "Jinrei source" })).toHaveValue(recoverySource);
    await page.getByRole("button", { name: "Restore saved" }).click();
    await page.locator("#next-tab-formation").click();
    await atelier.getByRole("tab", {name:"Hero Collection"}).click();
    await expect(page.getByRole("group", {name:"Five selected Hero slots"})).toContainText("Stoneheart");
    await atelier.getByRole("tab", {name:"Skill Tree"}).click();
    await expect(page.getByRole("button", {name:"Choose Path A for slot-01"})).toHaveAttribute("aria-pressed","true");
    await page.locator("#next-tab-jinrei").click();
    await expect(page.getByRole("textbox", { name: "Jinrei source" })).toHaveValue(editedSource);
    await page.getByRole("button", {name:"Compile tactics"}).click();
    await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();
    await page.locator("#next-tab-battle").click();
    await page.getByRole("button", {name:"Launch local battle"}).click();
    await expect(page.getByText("AUTHORITATIVE ENBU RESULT")).toBeVisible({timeout:90_000});
    await expect(page.locator(".next-renderer-host canvas")).toHaveCount(1);
  } finally {
    await page.context().setOffline(false);
  }

  expect(wasmResponses.some((response) => response.status === 200 && /[?&]rev=[a-f0-9]{64}/.test(response.url))).toBe(true);
  expect(wasmResponses.some((response) => response.fromServiceWorker)).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(finalTick).toMatch(/TICK\s+\d+\s+\/\s+\d+/);
});
