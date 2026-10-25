import assert from "node:assert/strict";
import test from "node:test";
import { verifyCaptureReports } from "./verify-browser-captures.mjs";

function reports() {
  return [["1440x900", "1920x1080"], ["375x812", "390x844"], ["430x932", "320x740"]].map(names => ({
    schema: "senkei-battlefield-visual-acceptance/v1",
    sourceRevision: "candidate", buildRevision: "candidate", wasmSha256: "same-module",
    viewports: names.map(name => ({ name })), captureCount: 24,
    scenarios: Object.fromEntries(["canonical", "observationCapture", "defaultBattle", "controlledBaseAssault"]
      .map(scenario => [scenario, { matchId: scenario, publicReplayDigest: `${scenario}-public`, ownerReplayDigest: `${scenario}-owner` }])),
    captures: Array.from({ length: 24 }, () => ({ scenario: "real-mid-capture", state: "beacon-captured-follow",
      facts: { sourceHeroEntityId: "owner-hero", rendererEntityId: "render-hero" } })),
  }));
}

test("accepts complete groups without losing the full-run checks", () => {
  assert.deepEqual(verifyCaptureReports(reports(), "candidate"), { groups: 3, viewports: 6, captureCount: 72 });
});
test("rejects missing/duplicate viewports and a missing group", () => {
  const data = reports(); data[2].viewports[0].name = "390x844";
  assert.throws(() => verifyCaptureReports(data, "candidate"));
  assert.throws(() => verifyCaptureReports(reports().slice(0, 2), "candidate"));
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
test("rejects incomplete capture output even if each group passed its partial minimum", () => {
  const data = reports();
  for (const report of data) { report.captures.length = 20; report.captureCount = 20; }
  assert.throws(() => verifyCaptureReports(data, "candidate"));
});
