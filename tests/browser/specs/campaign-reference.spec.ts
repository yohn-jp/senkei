import { expect, test, type Page } from "@playwright/test";
import { campaignCore } from "../helpers/campaign-core";
import { nativeCampaignFixture, nativeCampaignStore } from "../helpers/native-campaign-fixture";
import { reproductionSnapshotDigest } from "../../../apps/web/src/features/next/experiment-restoration";

async function storedExperimentDigest(page: Page, id: string): Promise<string | null> {
  return page.evaluate(async wantedId => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("senkei-local-workspace", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<any>((resolve, reject) => {
      const request = db.transaction("next_experiments", "readonly").objectStore("next_experiments").get("latest");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const experiment = record?.payload?.experiments.find((item: { id: string }) => item.id === wantedId);
    if (!experiment) return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(experiment)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }, id);
}

for (const change of ["context", "opponent"] as const) test(`Relabeling a custom ${change} never displays or awards the authored Campaign`, async ({ page }) => {
  test.setTimeout(600_000);
  const fixture = await nativeCampaignFixture(), core = await campaignCore();
  const compiled = core("compile_text", { ruleset_ref: fixture.rules.ruleset, source: fixture.source });
  // Change the immutable context/opponent and save a matching real Core result.
  // The import is reproducible, but it must not inherit the authored Campaign association.
  const store = structuredClone(nativeCampaignStore(fixture, compiled.estimated_cu));
  const original = store.experiments[0];
  const snapshot = change === "context"
    ? { ...original.snapshot, context: { ...original.snapshot.context, max_ticks: original.snapshot.context.max_ticks - 1 } }
    : { ...original.snapshot, defender: { ...original.snapshot.defender, program: core("compile_text", { ruleset_ref: fixture.rules.ruleset, source: "senkei observe { state present { true }, }" }).program } };
  const snapshotDigest = await reproductionSnapshotDigest(snapshot);
  core("preflight_reproduction", { assets: original.reproduction_assets, snapshot, snapshot_digest: snapshotDigest });
  const actual = core("simulate", { ...snapshot, include_diagnostics: false });
  const importStore = {
    ...store,
    experiments: [{
      ...original,
      snapshot,
      snapshot_digest: snapshotDigest,
      response: { outcome: { result: actual.result, presentation_replay: actual.replay } },
    }],
  };
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("senkei.next-campaign-progress.v2:")))).toBe(true);
  await page.getByTestId("nav-library").click();
  const library = page.getByTestId("next-library");
  await library.getByLabel("Import Next experiment file").setInputFiles({ name: "reference-attempt.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(importStore)) });
  await expect(library.getByRole("button", { name: "Open latest comparison", exact: true })).toBeEnabled({ timeout: 60_000 });
  await expect(library.locator(".next-library-experiment-list")).not.toContainText(fixture.scenario.title);
  await library.getByRole("button", { name: "Open latest comparison", exact: true }).click();
  const analysis = page.getByTestId("battle-analysis");
  await expect(analysis).toContainText("Reference Run");
  await expect(analysis).toContainText(change);
  await expect(analysis.getByRole("region", { name: "Campaign challenge result" })).toHaveCount(0);
  await expect(analysis.getByRole("region", { name: "Campaign next actions" })).toHaveCount(0);
  const draftBefore = await page.evaluate(() => localStorage.getItem("senkei.next-workspace-recovery.v1"));
  const storedOriginalDigest = await storedExperimentDigest(page, original.id);
  expect(storedOriginalDigest).not.toBeNull();
  await analysis.getByRole("button", { name: /同条件で再戦 · Run Snapshot/ }).click();
  await expect(page.getByTestId("journey-ready").locator(".journey-ready-challenge")).toHaveCount(0);
  await page.getByRole("button", { name: "検証・コンパイル", exact: true }).click();
  await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
  await page.getByRole("button", { name: "戦闘開始", exact: true }).click();
  await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
  await page.locator("#next-tab-analysis").click();
  await expect(analysis).toContainText("Reference Run");
  await expect(analysis.getByRole("region", { name: "Campaign challenge result" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("senkei.next-workspace-recovery.v1"))).toBe(draftBefore);
  expect(await storedExperimentDigest(page, original.id)).toBe(storedOriginalDigest);
  await expect.poll(() => page.evaluate(digest => JSON.parse(localStorage.getItem(`senkei.next-campaign-progress.v2:${digest}`)!).completed_scenario_ids, fixture.rules.ruleset.digest)).toEqual([]);
});
