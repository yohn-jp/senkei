import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { completePreflight } from "../helpers/preflight";

let artifact = process.env.SENKEI_REAL_EXPERIMENT_ARTIFACT ?? "";
let incompatible = process.env.SENKEI_INCOMPATIBLE_EXPERIMENT_ARTIFACT ?? "";
test.use({ actionTimeout: 30_000, serviceWorkers: "block" });

test.beforeAll(async ({ browser }, info) => {
  info.setTimeout(360_000);
  // CI produces its own genuine result; local focused checks can reuse an exported Run.
  if (!artifact) {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByTestId("journey-home").getByRole("button", { name: "すぐ戦う", exact: true }).click();
    await page.getByRole("button", { name: "この条件で進む", exact: true }).click();
    await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
    await completePreflight(page);
    await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
    await page.getByTestId("nav-library").click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export experiments", exact: true }).click();
    artifact = info.outputPath("genuine-enbu-export.json");
    await (await downloading).saveAs(artifact);
    await context.close();
  }
  if (!incompatible) {
    const input = JSON.parse(readFileSync(artifact, "utf8"));
    const item = input.experiments[0];
    for (const identity of [item.snapshot.context.world_identity, item.response.outcome.presentation_replay.world_identity,
      item.response.owner_replays?.attacker?.world_identity].filter(Boolean)) identity.presentation_digest = "0".repeat(64);
    incompatible = info.outputPath("incompatible-paired-world.json");
    writeFileSync(incompatible, JSON.stringify(input));
  }
});

async function storedIdentity(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("senkei-local-workspace", 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const record = await new Promise<any>((resolve, reject) => {
      const request = db.transaction("next_experiments", "readonly").objectStore("next_experiments").get("latest");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }); db.close();
    const json = JSON.stringify(record?.payload ?? null);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
    return { sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join(""), bytes: new TextEncoder().encode(json).length,
      ids: record?.payload.experiments.map((item: any) => item.id), world: record?.payload.experiments[0]?.snapshot.context.world_identity };
  });
}
async function importBaseline(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("journey-home")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("nav-library").click();
  await page.getByLabel("Import Next experiment file").setInputFiles(artifact);
  await expect(page.getByRole("button", { name: "Open latest comparison", exact: true })).toBeEnabled({ timeout: 120_000 });
}

test("semantic incompatible experiment import preserves existing immutable records", async ({ page }) => {
  test.setTimeout(240_000);
  await importBaseline(page);
  const before = await storedIdentity(page);
  await page.getByRole("button", { name: "Open latest comparison", exact: true }).click();
  const resultDigest = await page.locator(".battle-analysis-result-identity code").innerText();
  const draftBefore = await page.evaluate(() => localStorage.getItem("senkei.next-workspace-recovery.v1"));
  await page.getByTestId("nav-library").click();
  await page.getByLabel("Import Next experiment file").setInputFiles(incompatible);
  await page.getByRole("button", { name: "Validate and import", exact: true }).click();
  await expect(page.getByText(/World identity or paired World projection does not match the current package/)).toBeVisible({ timeout: 120_000 });
  const after = await storedIdentity(page);
  const comparisonEnabled = await page.getByRole("button", { name: "Open latest comparison", exact: true }).isEnabled();
  await page.screenshot({ path: "test-results/experiment-wrong-world-import.png", fullPage: true });
  await page.getByTestId("nav-next").click();
  await page.locator("#next-tab-analysis").click();
  const resultDigestAfter = await page.locator(".battle-analysis-result-identity code").innerText();
  const draftAfter = await page.evaluate(() => localStorage.getItem("senkei.next-workspace-recovery.v1"));
  expect(resultDigestAfter).toBe(resultDigest);
  expect(draftAfter).toBe(draftBefore);
  expect(after).toEqual(before);
  expect(comparisonEnabled).toBe(true);
});

test("Core unavailable Library can still export existing IndexedDB experiments", async ({ page }) => {
  test.setTimeout(240_000);
  await importBaseline(page);
  const before = await storedIdentity(page);
  await page.route("**/wasm/**", route => route.abort("failed"));
  await page.reload();
  await page.getByTestId("nav-library").click();
  await expect(page.getByTestId("next-library")).toBeVisible();
  await expect(page.getByText(/WASM|WebAssembly|fetch|load/i).first()).toBeVisible({ timeout: 60_000 });
  const after = await storedIdentity(page);
  await expect(page.getByRole("button", { name: "Export experiments", exact: true })).toBeEnabled({ timeout: 60_000 });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export experiments", exact: true }).click();
  const download = await downloadEvent;
  const downloadedSHA256 = createHash("sha256").update(readFileSync((await download.path())!)).digest("hex");
  const canExport = true;
  await page.screenshot({ path: "test-results/experiment-core-unavailable-export.png", fullPage: true });
  expect(canExport).toBe(true);
  expect(after).toEqual(before);
  expect(downloadedSHA256).toBe(before.sha256);
  await expect(page.getByRole("button", { name: "Export experiments", exact: true })).toBeEnabled();
});

test("a failed replacement write preserves the existing Run, Draft and durable experiments", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await importBaseline(page);
  const before = await storedIdentity(page);
  const draftBefore = await page.evaluate(() => localStorage.getItem("senkei.next-workspace-recovery.v1"));
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "next_experiments") throw new DOMException("Deliberate full storage", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  const replacement = JSON.parse(readFileSync(artifact, "utf8"));
  replacement.experiments[0].id += "-replacement";
  await page.getByLabel("Import Next experiment file").setInputFiles({ name: "valid-replacement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(replacement)) });
  await page.getByRole("button", { name: "Validate and import", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /storage|quota/i }).last()).toBeVisible();
  expect(await storedIdentity(page)).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem("senkei.next-workspace-recovery.v1"))).toBe(draftBefore);
  await expect(page.getByRole("button", { name: "Open latest comparison", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Open latest comparison", exact: true }).click();
  await expect(page.locator(".battle-analysis-result-identity code")).toHaveText(replacement.experiments[0].response.outcome.result.final_state_digest);
});

test("unrecognized saved schema remains exportable while Core is unavailable", async ({ page }) => {
  test.setTimeout(240_000);
  await importBaseline(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("senkei-local-workspace", 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("next_experiments", "readwrite");
      const store = transaction.objectStore("next_experiments");
      const request = store.get("latest");
      request.onsuccess = () => { const record = request.result; record.payload.format_version = 99; store.put(record); };
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  });
  const before = await storedIdentity(page);
  await page.route("**/wasm/**", route => route.abort("failed"));
  await page.reload();
  await page.getByTestId("nav-library").click();
  await expect(page.getByRole("button", { name: "Export experiments", exact: true })).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Open latest comparison", exact: true })).toBeDisabled();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export experiments", exact: true }).click();
  const downloadedBytes = readFileSync((await (await downloading).path())!);
  const downloaded = JSON.parse(downloadedBytes.toString("utf8"));
  expect(createHash("sha256").update(downloadedBytes).digest("hex")).toBe(before.sha256);
  expect(downloaded.format_version).toBe(99);
  expect(downloaded.experiments[0].id).toBe(before.ids[0]);
  expect(await storedIdentity(page)).toEqual(before);
  const clear = page.getByRole("button", { name: /Clear experiments/ });
  await expect(clear).toBeEnabled();
  await clear.click();
  const confirmation = page.getByRole("alertdialog", { name: "Confirm Library change" });
  await expect(confirmation).toContainText("preserved raw experiment payload");
  await confirmation.getByRole("button", { name: "Confirm clear", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export experiments", exact: true })).toBeDisabled();
  expect((await storedIdentity(page)).ids).toBeUndefined();
});
