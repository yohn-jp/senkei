import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { OrthographicCamera, Vector3 } from "three";
const evidence = process.env.SENKEI_GRAPHICS_EVIDENCE_DIR ?? "docs/evidence/g1";
const g1 = JSON.parse(
  readFileSync(
    new URL(
      "../../packages/replay-contract/fixtures/basic-three-lane.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  scene: {
    bounds: {
      min: { x: number; y: number };
      max: { x: number; y: number };
    };
  };
  initialView: Array<{ id: string; position: { x: number; y: number } }>;
};
mkdirSync(evidence, { recursive: true });
async function seek(page: Page, tick: number) {
  const slider = page.getByRole("slider", { name: "Tickシーク" });
  await slider.focus();
  await slider.press("Home");
  for (let n = 0; n < tick; n++) await slider.press("ArrowRight");
  await expect(page.getByLabel("現在Tick")).toContainText(
    String(tick).padStart(2, "0"),
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-tick",
    String(tick),
  );
}
for (const [width, height] of [
  [1440, 900],
  [1920, 1080],
  [390, 844],
  [430, 932],
]) {
  test(`${width}x${height}: playback, seek, camera, fixture recovery and visual states`, async ({
    browser,
  }) => {
    const mobile = width < 760;
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const engineRequests: string[] = [];
    page.on("request", (r) => {
      if (/core\.worker|\/wasm\//.test(r.url())) engineRequests.push(r.url());
    });
    await page.goto("/graphics/");
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    const fixture = page.getByLabel(
      mobile ? "モバイルFixture選択" : "Fixture選択",
      { exact: true },
    );
    const shot = async (name: string) => {
      await page.screenshot({
        path: `${evidence}/${width}x${height}-${name}.png`,
      });
    };
    await shot("initial");
    const bounds = await page.locator("canvas").boundingBox();
    const host = await page.locator(".scene-host").boundingBox();
    const { min, max } = g1.scene.bounds;
    const center = new Vector3(
      (min.x + max.x) / 2,
      0,
      (min.y + max.y) / 2,
    );
    const pickCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const [cameraPosition, zoom] = (
      (await page.locator("canvas").getAttribute("data-camera")) ?? ""
    ).split(":");
    pickCamera.position.fromArray(
      cameraPosition.split(",").map(Number),
    );
    pickCamera.zoom = Number(zoom);
    pickCamera.lookAt(center);
    pickCamera.updateMatrixWorld();
    const direction = center.clone().sub(pickCamera.position).normalize();
    const right = new Vector3()
      .crossVectors(direction, pickCamera.up)
      .normalize();
    const screenUp = new Vector3().crossVectors(right, direction).normalize();
    let horizontal = 0,
      vertical = 0;
    for (const x of [min.x, max.x])
      for (const z of [min.y, max.y])
        for (const y of [-1, 5]) {
          const corner = new Vector3(x, y, z).sub(center);
          horizontal = Math.max(horizontal, Math.abs(corner.dot(right)));
          vertical = Math.max(vertical, Math.abs(corner.dot(screenUp)));
        }
    const aspect = host!.width / host!.height;
    const halfHeight = Math.max(vertical, horizontal / aspect) * 1.18;
    pickCamera.left = -halfHeight * aspect;
    pickCamera.right = halfHeight * aspect;
    pickCamera.top = halfHeight;
    pickCamera.bottom = -halfHeight;
    pickCamera.updateProjectionMatrix();
    const heavy = g1.initialView.find(
      (entity) => entity.id === "azure-top-heavy",
    )!;
    const pick = new Vector3(
      heavy.position.x,
      0.96,
      heavy.position.y,
    ).project(pickCamera);
    const px = bounds!.x + ((pick.x + 1) * bounds!.width) / 2;
    const py = bounds!.y + ((1 - pick.y) * bounds!.height) / 2;
    if (mobile) await page.touchscreen.tap(px, py);
    else await page.mouse.click(px, py);
    await expect(page.getByRole("region", { name: "選択情報" })).toContainText(
      "重装兵",
    );
    await page.getByRole("button", { name: "詳細を閉じる" }).click();
    await page.getByRole("button", { name: "再生", exact: true }).click();
    await expect
      .poll(() => page.getByRole("slider").inputValue())
      .not.toBe("0");
    await page.getByRole("button", { name: "停止", exact: true }).click();
    const stopped = await page.getByRole("slider").inputValue();
    await page.waitForTimeout(600);
    expect(await page.getByRole("slider").inputValue()).toBe(stopped);
    await page.getByRole("button", { name: "2倍速", exact: true }).click();
    await expect(page.getByRole("button", { name: "2倍速" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "4倍速", exact: true }).click();
    await page.getByRole("button", { name: "1倍速", exact: true }).click();
    await seek(page, 13);
    await shot("clash");
    await seek(page, 23);
    await shot("tower-collapse");
    await seek(page, 28);
    await expect(page.getByRole("status", { name: "終局結果" })).toContainText(
      "蒼軍の勝利",
    );
    await shot("result");
    await page.getByRole("button", { name: "先頭へ戻る" }).click();
    await expect(page.getByRole("slider")).toHaveValue("0");
    await expect(page.getByRole("status", { name: "終局結果" })).toHaveCount(0);
    const canvas = page.locator("canvas"),
      camera = await canvas.getAttribute("data-camera");
    await page.getByRole("button", { name: "拡大", exact: true }).click();
    await expect
      .poll(() => canvas.getAttribute("data-camera"))
      .not.toBe(camera);
    await page.getByRole("button", { name: "縮小", exact: true }).click();
    const rect = await canvas.boundingBox();
    await page.mouse.move(
      rect!.x + rect!.width * 0.5,
      rect!.y + rect!.height * 0.6,
    );
    await page.mouse.down();
    await page.mouse.move(
      rect!.x + rect!.width * 0.62,
      rect!.y + rect!.height * 0.65,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect
      .poll(() => canvas.getAttribute("data-camera"))
      .not.toBe(camera);
    await page
      .getByRole("button", {
        name: mobile ? "モバイル視点リセット" : "カメラを初期位置へ",
        exact: true,
      })
      .click();
    await expect.poll(() => canvas.getAttribute("data-camera")).toBe(camera);
    await page.getByRole("button", { name: "Pixel 3D", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Pixel 3D" }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Pixel 3D", exact: true }).click();
    for (const value of ["basic-three-lane", "clash-and-loss"]) {
      await fixture.selectOption(value);
      await expect(page.getByRole("slider")).toHaveValue("0");
      await seek(page, 14);
    }
    await fixture.selectOption("malformed-replay");
    await expect(page.getByRole("alert")).toContainText(
      "リプレイを読み込めません",
    );
    await expect(
      page.getByRole("button", { name: "再生", exact: true }),
    ).toBeDisabled();
    if (!mobile) await expect(page.locator(".army-count")).toContainText("—");
    await shot("invalid");
    await page.getByRole("button", { name: "正常なサンプルへ戻る" }).click();
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const controls = await page
      .getByRole("button", { name: "再生", exact: true })
      .boundingBox();
    expect(controls!.y + controls!.height).toBeLessThanOrEqual(height);
    expect(errors).toEqual([]);
    expect(engineRequests).toEqual([]);
    await context.close();
  });
}
test("WebGL context loss stops playback and retry recreates renderer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/graphics/");
  await expect(page.locator("canvas")).toHaveAttribute("data-rendered", "true");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page
    .locator("canvas")
    .evaluate((canvas) =>
      (canvas as HTMLCanvasElement)
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context")
        ?.loseContext(),
    );
  await expect(page.getByRole("alert")).toContainText("戦場を描画できません");
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${evidence}/1440x900-webgl-lost.png` });
  await page.getByRole("button", { name: "描画を再試行" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveAttribute("data-rendered", "true");
});
test("WebGL unavailable shows a recoverable error", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === "webgl2") return null;
      return original.apply(this, [type, ...args] as Parameters<
        typeof original
      >);
    } as typeof original;
  });
  await page.goto("/graphics/");
  await expect(page.getByRole("alert")).toContainText("戦場を描画できません");
  await expect(
    page.getByRole("button", { name: "描画を再試行" }),
  ).toBeEnabled();
});
test("320px and landscape keep primary playback controls accessible", async ({
  page,
}) => {
  for (const [width, height] of [
    [320, 740],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/graphics/");
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "再生", exact: true }).click();
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await seek(page, 23);
  }
});
test("animated playback reaches the authored result (video evidence)", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: "test-results/video",
      size: { width: 960, height: 600 },
    },
  });
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/graphics/");
  await expect(page.locator("canvas")).toHaveAttribute("data-rendered", "true");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(page.getByRole("status", { name: "終局結果" })).toContainText(
    "蒼軍の勝利",
    { timeout: 30000 },
  );
  await expect(page.getByRole("slider")).toHaveValue("28");
  expect(errors).toEqual([]);
  const video = page.video()!;
  await context.close();
  await video.saveAs(`${evidence}/animated-replay.webm`);
});

test("existing workspace links to the independent sample page", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: /サンプル演武/ })
    .click();
  await expect(page).toHaveURL(/\/graphics\/$/);
  await expect(page.locator("canvas")).toHaveAttribute("data-rendered", "true");
});

test("390px: immediate keyboard seek survives repeated replay replacement", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  // Slow rendering widens the passive-effect gap seen in Graphics G1 CI.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto("/graphics/");
  await expect(page.locator("canvas")).toHaveAttribute("data-rendered", "true");
  const slider = page.getByRole("slider", { name: "Tickシーク" });
  for (let index = 0; index < 8; index++) {
    await page.getByLabel("モバイルFixture選択", { exact: true }).selectOption(
      index % 2 ? "clash-and-loss" : "basic-three-lane",
    );
    // Deliberately do not wait for the renderer or a Tick assertion after switching.
    await slider.press("Home");
    await slider.press("ArrowRight");
    await slider.press("ArrowRight");
    await expect(slider).toHaveValue("2");
    await expect(page.getByLabel("現在Tick")).toContainText("02");
    await expect(page.locator("canvas")).toHaveAttribute("data-tick", "2");
    await slider.press("ArrowLeft");
    await expect(page.getByLabel("現在Tick")).toContainText("01");
  }
  await context.close();
});
