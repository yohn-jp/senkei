import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidenceDirectory = resolve(process.env.HERO_MODEL_CONTACT_SHEET_DIR
  ?? resolve(repositoryRoot, "docs/evidence/next/atelier/hero-model-contact-sheet"));
const heroes = [
  { id: "F01", name: "Bannerhold" },
  { id: "F02", name: "Stoneheart" },
  { id: "F03", name: "Breach" },
  { id: "F04", name: "Rook" },
  { id: "F05", name: "Lockstep" },
  { id: "F06", name: "Pathfinder" },
  { id: "R01", name: "Tempest" },
  { id: "R02", name: "Farshot" },
  { id: "R03", name: "Farwatch" },
  { id: "R04", name: "Lifeline" },
  { id: "R05", name: "Conductor" },
  { id: "R06", name: "Aegis" },
] as const;

test("captures the actual catalog meshes for all twelve Hero identities", async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  if (!baseURL) throw new Error("The browser runner must provide its production preview URL.");

  mkdirSync(evidenceDirectory, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(baseURL);
  await page.getByTestId("nav-next").click();

  const atelier = page.getByRole("tablist", { name: "Hero Atelier" });
  await expect(atelier, "Next navigation opens the existing Hero Atelier").toBeVisible({ timeout: 30_000 });
  const collection = atelier.getByRole("tab", { name: "Hero Collection" });
  const detail = atelier.getByRole("tab", { name: "Hero Detail" });
  const selectedSlots = page.getByRole("group", { name: "Five selected Hero slots" });
  const catalog = page.getByRole("region", { name: "Filtered hero catalog" });
  const captures: { id: string; name: string; data: string; metadata: Record<string, string | null> }[] = [];

  for (const hero of heroes) {
    await collection.click();
    const slotLabels = await selectedSlots.getByRole("button").allInnerTexts();
    const assignedSlot = slotLabels.findIndex((label) => new RegExp(`\\b${hero.id}\\b`).test(label));
    if (assignedSlot >= 0) {
      await selectedSlots.getByRole("button").nth(assignedSlot).click();
    } else {
      const replacementSlot = selectedSlots.getByRole("button").nth(1);
      await replacementSlot.click();
      await catalog.getByRole("button", { name: new RegExp(`^${hero.id}\\b`) }).click();
    }

    await detail.click();
    await expect(page.getByRole("heading", { name: hero.name, exact: true })).toBeVisible();
    const preview = page.getByRole("region", { name: `${hero.name} 3D model` });
    const canvas = preview.locator("canvas");
    await expect(canvas).toHaveAttribute("data-preview-mode", "catalog");
    await expect(canvas).toHaveAttribute("data-preview-ready", "true", { timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-catalog-id", hero.id);
    await expect(canvas).toHaveAttribute("data-silhouette-id", hero.id);
    await expect(canvas).toHaveAttribute("data-generator", "senkei.battlefield-unit.v1");
    await expect(canvas).not.toHaveAttribute("data-body-profile", "unknown");
    await expect(canvas).not.toHaveAttribute("data-weapon", "unknown");
    const appearanceKey = await canvas.getAttribute("data-appearance-key");
    expect(appearanceKey).toBeTruthy();

    const image = await canvas.screenshot({ animations: "disabled" });
    writeFileSync(resolve(evidenceDirectory, `${hero.id.toLowerCase()}.png`), image);
    captures.push({
      id: hero.id,
      name: hero.name,
      data: image.toString("base64"),
      metadata: {
        catalogId: hero.id,
        appearanceKey,
        silhouetteId: await canvas.getAttribute("data-silhouette-id"),
        bodyProfile: await canvas.getAttribute("data-body-profile"),
        weapon: await canvas.getAttribute("data-weapon"),
        generator: await canvas.getAttribute("data-generator"),
        previewMode: await canvas.getAttribute("data-preview-mode"),
        camera: await canvas.getAttribute("data-camera"),
        pose: await canvas.getAttribute("data-pose"),
      },
    });
  }

  expect(new Set(captures.map(({ metadata }) => metadata.bodyProfile)).size).toBe(12);
  expect(new Set(captures.map(({ metadata }) => metadata.weapon)).size).toBe(12);
  const sheetDataUrl = await page.evaluate(async (items) => {
    const columns = 4;
    const cellWidth = 430;
    const cellHeight = 250;
    const sheet = document.createElement("canvas");
    sheet.width = columns * cellWidth;
    sheet.height = Math.ceil(items.length / columns) * cellHeight;
    const context = sheet.getContext("2d");
    if (!context) throw new Error("Could not create the Hero contact sheet canvas.");
    context.fillStyle = "#182126";
    context.fillRect(0, 0, sheet.width, sheet.height);
    context.font = "600 18px system-ui, sans-serif";
    context.textBaseline = "top";

    const images = await Promise.all(items.map(({ data }) => new Promise<HTMLImageElement>((resolveImage, reject) => {
      const image = new Image();
      image.onload = () => resolveImage(image);
      image.onerror = () => reject(new Error("A captured Hero preview could not be decoded."));
      image.src = `data:image/png;base64,${data}`;
    })));

    for (let index = 0; index < items.length; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = column * cellWidth;
      const y = row * cellHeight;
      context.fillStyle = "#dce5dd";
      context.fillText(`${items[index]!.id} · ${items[index]!.name}`, x + 14, y + 10);
      context.drawImage(images[index]!, x + 10, y + 38, cellWidth - 20, cellHeight - 48);
    }
    return sheet.toDataURL("image/png");
  }, captures.map(({ id, name, data }) => ({ id, name, data })));
  writeFileSync(resolve(evidenceDirectory, "contact-sheet.png"), Buffer.from(sheetDataUrl.split(",")[1]!, "base64"));
  writeFileSync(resolve(evidenceDirectory, "metadata.json"), JSON.stringify({
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
    wasmSha256: createHash("sha256").update(readFileSync(resolve(repositoryRoot, "apps/web/public/wasm/senkei_wasm.wasm"))).digest("hex"),
    viewport: { width: 1440, height: 900 },
    capture: "Hero Atelier catalog canvas from Three.js WebGL preview",
    heroes: captures.map(({ id, name, metadata }) => ({ id, name, ...metadata })),
  }, null, 2) + "\n");
});
