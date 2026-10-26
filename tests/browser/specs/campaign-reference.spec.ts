import { expect, test } from "@playwright/test";
import { campaignCore } from "../helpers/campaign-core";
import { nativeCampaignFixture, nativeCampaignStore } from "../helpers/native-campaign-fixture";
import { reproductionSnapshotDigest } from "../../../apps/web/src/features/next/experiment-restoration";

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
  await analysis.getByRole("button", { name: /同条件で再戦 · Run Snapshot/ }).click();
  await expect(page.getByTestId("journey-ready").locator(".journey-ready-challenge")).toHaveCount(0);
  const progress = await page.evaluate(digest => JSON.parse(localStorage.getItem(`senkei.next-campaign-progress.v2:${digest}`)!), fixture.rules.ruleset.digest);
  expect(progress.completed_scenario_ids).toEqual([]);
});
