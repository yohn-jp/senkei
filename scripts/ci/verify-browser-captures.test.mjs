import assert from "node:assert/strict";
import test from "node:test";
import { verifyCaptureReports } from "./verify-browser-captures.mjs";

const viewportNames = ["1440x900", "1920x1080", "375x812", "390x844", "430x932", "320x740"];

function reports() {
  return viewportNames.map((name, index) => ({
    schema: "senkei-battlefield-visual-acceptance/v1",
    captureRunId: `run-${index}`,
    sourceRevision: "candidate", buildRevision: "candidate", wasmSha256: "same-module",
    viewports: [{ name }], captureCount: 12,
    scenarios: Object.fromEntries(["canonical", "observationCapture", "defaultBattle", "controlledBaseAssault"]
      .map(scenario => [scenario, { matchId: scenario, publicReplayDigest: `${scenario}-public`, ownerReplayDigest: `${scenario}-owner` }])),
    captures: Array.from({ length: 12 }, () => ({ scenario: "real-mid-capture", state: "beacon-captured-follow",
      facts: { sourceHeroEntityId: "owner-hero", rendererEntityId: "render-hero" } })),
  }));
}

test("accepts one complete report for each viewport without losing full-run checks", () => {
  assert.deepEqual(verifyCaptureReports(reports(), "candidate"), { reports: 6, viewports: 6, captureCount: 72 });
});
test("rejects missing/duplicate viewport reports and reports with multiple viewports", () => {
  const data = reports(); data[2].viewports[0].name = "390x844";
  assert.throws(() => verifyCaptureReports(data, "candidate"));
  assert.throws(() => verifyCaptureReports(reports().slice(0, 5), "candidate"));
  const duplicate = reports(); duplicate[5] = structuredClone(duplicate[0]);
  assert.throws(() => verifyCaptureReports(duplicate, "candidate"));
  const duplicateRun = reports();
  duplicateRun[5].viewports[0].name = viewportNames[5];
  duplicateRun[5].captureRunId = duplicateRun[0].captureRunId;
  assert.throws(() => verifyCaptureReports(duplicateRun, "candidate"));
  const grouped = reports(); grouped[0].viewports.push({ name: "1920x1080" });
  assert.throws(() => verifyCaptureReports(grouped, "candidate"));
});
test("rejects an old build and inconsistent replay or Hero identity", () => {
  const data = reports(); data[1].buildRevision = "old";
  assert.throws(() => verifyCaptureReports(data, "candidate"));
  data[1].buildRevision = "candidate";
  data[1].scenarios.defaultBattle.ownerReplayDigest = "different";
  assert.throws(() => verifyCaptureReports(data, "candidate"));
  data[1].scenarios.defaultBattle.ownerReplayDigest = "defaultBattle-owner";
  data[1].captures[0].facts.rendererEntityId = "different-hero";
  assert.throws(() => verifyCaptureReports(data, "candidate"));
});
test("rejects inconsistent World-backed replay identities across viewports", () => {
  const data = reports(); data[4].scenarios.canonical.matchId = "different-world-match";
  assert.throws(() => verifyCaptureReports(data, "candidate"));
  data[4].scenarios.canonical.matchId = "canonical";
  data[4].scenarios.canonical.publicReplayDigest = "different-world-public-replay";
  assert.throws(() => verifyCaptureReports(data, "candidate"));
});
test("rejects incomplete capture output even if each group passed its partial minimum", () => {
  const data = reports();
  for (const report of data) { report.captures.length = 20; report.captureCount = 20; }
  assert.throws(() => verifyCaptureReports(data, "candidate"));
});
