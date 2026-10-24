import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { OrthographicCamera, Vector3 } from "three";
const evidence = "docs/evidence/g1";
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
    const span = mobile
        ? Math.max(18.5, (14 * bounds!.height) / bounds!.width)
        : 13,
      aspect = bounds!.width / bounds!.height;
    const pickCamera = new OrthographicCamera(
      -span * aspect,
      span * aspect,
      span * 1.15,
      -span * 0.85,
      0.1,
      200,
    );
    pickCamera.position.copy(
      mobile ? new Vector3(34, 34, 9) : new Vector3(14, 28, 32),
    );
    pickCamera.lookAt(0, 0, 0);
    pickCamera.updateMatrixWorld();
    const pick = new Vector3(-5.6, 0.96, 0).project(pickCamera),
      px = bounds!.x + ((pick.x + 1) * bounds!.width) / 2,
      py = bounds!.y + ((1 - pick.y) * bounds!.height) / 2;
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
