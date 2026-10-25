import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const evidenceDirectory = resolve(process.env.SENKEI_UX_EVIDENCE_DIR ?? "test-results/hero-atelier");
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
      await page.screenshot({ path: resolve(evidenceDirectory, viewport.name + "-save-disclosure.png") });
      await disclosure.click();
      await expect(page.getByRole("button", { name: "Save setup" })).toBeHidden();
    }

    const atelier = page.getByRole("tablist", { name: "Hero Atelier" });
    await expect(atelier).toBeVisible();
    const collection = atelier.getByRole("tab", { name: "Hero Collection" });
    await expect(collection).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Choose your heroes" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Choose hero for slot/ })).toHaveCount(5);
    await collection.focus();
    await collection.press("ArrowRight");
    const detailTab = atelier.getByRole("tab", { name: "Hero Detail" });
    await expect(detailTab).toHaveAttribute("aria-selected", "true");
    await detailTab.press("End");
    const squadTab = atelier.getByRole("tab", { name: "Squad Assembly" });
    await expect(squadTab).toHaveAttribute("aria-selected", "true");
    await squadTab.press("Home");
    await expect(collection).toHaveAttribute("aria-selected", "true");

    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, viewport.name + "-collection.png") });

    // Pick an unused real catalog identity in slot 2, then confirm the same
    // choice is visible in the shared Detail/Tree/Assembly draft.
    await page.getByRole("button", { name: "Choose hero for slot 2" }).click();
    await page.getByRole("region", { name: "Filtered hero catalog" }).getByRole("button", { name: /F02.*Stoneheart/ }).click();
    await expect(page.getByRole("group", { name: "Five selected Hero slots" })).toContainText("Stoneheart");
    await page.screenshot({ path: resolve(evidenceDirectory, viewport.name + "-collection-catalog.png") });
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
      if (label === "Hero Detail") {
        await expect(page.getByRole("heading", { name: "Stoneheart" })).toBeVisible();
        await expect(page.locator(".next-renderer-host canvas"), "catalog preview must not launch or reuse an Enbu battle renderer").toHaveCount(0);
        const preview = page.getByRole("region", { name: "Stoneheart 3D model" });
        const modelCanvas = preview.locator("canvas");
        await preview.scrollIntoViewIfNeeded();
        await expect(modelCanvas).toHaveAttribute("data-preview-mode", "catalog");
        await expect(modelCanvas).toHaveAttribute("data-preview-ready", "true", { timeout: 30_000 });
        await expect(modelCanvas).toHaveAttribute("aria-busy", "false");
        await expect(modelCanvas).toHaveAttribute("data-catalog-id", "F02");
        await expect(modelCanvas).toHaveAttribute("data-name", "Stoneheart");
        await expect(modelCanvas).toHaveAttribute("data-generator", "senkei.battlefield-unit.v1");
        const appearanceLabel = await page.locator(".ha-dossier-heading .next-eyebrow").innerText();
        const appearanceKey = appearanceLabel.split(" · SLOT ")[0];
        expect(appearanceKey).not.toBe("");
        await expect(modelCanvas).toHaveAttribute("data-appearance-key", appearanceKey);
        expect(await modelCanvas.evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
        }), "the catalog preview must own a live WebGL context").toBe(true);

        const cameraSample = await modelCanvas.getAttribute("data-camera");
        const cameraValues = (cameraSample ?? "").split(",").map(Number);
        expect(cameraValues, "camera sample contains camera position and orbit target").toHaveLength(6);
        expect(cameraValues.every(Number.isFinite)).toBe(true);
        const idlePoseSample = await modelCanvas.getAttribute("data-pose-sample");
        expect((idlePoseSample ?? "").split(":")).toHaveLength(3);
        expect(idlePoseSample).not.toContain("none");
        await expect(modelCanvas).toHaveAttribute("data-pose", "idle");
        await expect(preview.getByRole("button", { name: "Preview idle animation" })).toHaveAttribute("aria-pressed", "true");
        await page.screenshot({ path: resolve(evidenceDirectory, viewport.name + "-detail-preview-idle.png") });

        const movePose = preview.getByRole("button", { name: "Preview move animation" });
        await movePose.click();
        await expect(movePose).toHaveAttribute("aria-pressed", "true");
        await expect(modelCanvas).toHaveAttribute("data-pose", "move");
        const movePoseSample = await modelCanvas.getAttribute("data-pose-sample");
        expect(movePoseSample).not.toBe(idlePoseSample);

        const attackPose = preview.getByRole("button", { name: "Preview attack animation" });
        await attackPose.click();
        await expect(attackPose).toHaveAttribute("aria-pressed", "true");
        await expect(modelCanvas).toHaveAttribute("data-pose", "attack");
        const attackPoseSample = await modelCanvas.getAttribute("data-pose-sample");
        expect(attackPoseSample).not.toBe(movePoseSample);
        await page.screenshot({ path: resolve(evidenceDirectory, viewport.name + "-detail-preview-attack.png") });

        if (!viewport.mobile && viewport.name === "1440x900") {
          const bounds = await modelCanvas.boundingBox();
          expect(bounds, "the visible preview canvas can receive real pointer input").toBeTruthy();
          await page.mouse.move(bounds!.x + bounds!.width * 0.5, bounds!.y + bounds!.height * 0.5);
          await page.mouse.down();
          await page.mouse.move(bounds!.x + bounds!.width * 0.68, bounds!.y + bounds!.height * 0.56, { steps: 6 });
          await page.mouse.up();
          await expect.poll(() => modelCanvas.getAttribute("data-camera")).not.toBe(cameraSample);
          const rotatedCameraSample = await modelCanvas.getAttribute("data-camera");
          await page.screenshot({ path: resolve(evidenceDirectory, viewport.name + "-detail-preview-rotated.png") });
          await preview.getByRole("button", { name: "Reset view" }).click();
          await expect.poll(() => modelCanvas.getAttribute("data-camera")).toBe(cameraSample);
          expect(rotatedCameraSample).not.toBe(cameraSample);
        }
      }
      if (label === "Skill Tree") {
        const pathB = page.getByRole("button", { name: "Choose Path B for slot-02" });
        await pathB.click();
        await expect(pathB).toHaveAttribute("aria-pressed", "true");
        await page.screenshot({ path: resolve(evidenceDirectory, viewport.name + "-skill-tree-plan.png") });
      }
      if (label === "Squad Assembly") {
        const split = page.getByRole("button", { name: "Use squad split 2+2+1" });
        await split.click();
        await expect(split).toHaveAttribute("aria-pressed", "true");
        if (viewport.mobile) {
          await expect(page.getByRole("region", { name: "Assign Heroes to Squads" })).toBeVisible();
          await page.getByRole("button", { name: "2 · Assign" }).click();
        }
        const membership = page.getByRole("region", { name: "Assign Heroes to Squads" });
        await expect(membership.getByRole("combobox")).toHaveCount(5);
        await membership.getByRole("combobox").last().selectOption("squad-2");
        await expect(page.locator(".ha-squad-heading")).toContainText("3+2");
        if (viewport.mobile) {
          await page.getByRole("button", { name: "3 · Start nodes" }).click();
        }
        const formation = page.getByRole("region", { name: "Squad formation preview" });
        await expect(formation).toBeVisible();
        await expect(formation).toContainText("3+2");
        const squadTwoStart = formation.getByRole("combobox", { name: "Starting node for Squad 2" });
        const squadTwo = formation.locator(".ha-group").filter({ hasText: "Squad 2 · 3 HEROES" });
        await expect(squadTwo.getByRole("listitem")).toHaveCount(3);
        const secondNode = await squadTwoStart.locator("option:not([disabled])").nth(1).getAttribute("value");
        expect(secondNode).toBeTruthy();
        await squadTwoStart.selectOption(secondNode!);
        await expect(squadTwoStart).toHaveValue(secondNode!);
        const memberNodes = await squadTwo.locator("ol li small").allTextContents();
        expect(new Set(memberNodes.map((text) => text.split(" · ").slice(1).join(" · "))).size).toBe(1);
        await expect(formation).toContainText("3+2");
      }
      await page.locator("#next-panel-formation .next-panel-header").scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(evidenceDirectory, viewport.name + "-" + screenshot + ".png") });
    }
    expect(pageErrors).toEqual([]);
    await context.close();
  });
}
