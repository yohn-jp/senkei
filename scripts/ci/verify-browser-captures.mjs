import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedViewports = ["1440x900", "1920x1080", "375x812", "390x844", "430x932", "320x740"];
const scenarios = ["canonical", "observationCapture", "defaultBattle", "controlledBaseAssault"];

// Preserve the full-run checks that cross viewport-group boundaries.
export function verifyCaptureReports(reports, revision) {
  assert.equal(reports.length, 3, "all three visual groups must publish metadata");
  const viewports = reports.flatMap(report => report.viewports.map(viewport => viewport.name));
  assert.deepEqual(viewports.sort(), [...expectedViewports].sort(), "every visual viewport must occur exactly once");
  let captureCount = 0;
  const followIds = { sourceHeroEntityId: new Set(), rendererEntityId: new Set() };
  for (const report of reports) {
    assert.equal(report.schema, "senkei-battlefield-visual-acceptance/v1");
    assert.equal(report.sourceRevision, revision, "capture source must match this workflow revision");
    assert.equal(report.buildRevision, revision, "capture build must match this workflow revision");
    assert.equal(typeof report.wasmSha256, "string");
    assert.ok(report.wasmSha256.length > 0);
    assert.equal(report.wasmSha256, reports[0].wasmSha256, "groups must use the same WASM");
    assert.equal(report.captureCount, report.captures.length);
    captureCount += report.captureCount;
    for (const scenario of scenarios) {
      for (const field of ["matchId", "publicReplayDigest", "ownerReplayDigest"]) {
        const value = report.scenarios[scenario][field];
        assert.equal(typeof value, "string");
        assert.ok(value.length > 0);
        assert.equal(value, reports[0].scenarios[scenario][field], `${scenario} ${field} must match across viewport groups`);
      }
    }
    for (const capture of report.captures) {
      if (capture.scenario === "real-mid-capture" && capture.state.endsWith("-follow")) {
        for (const [field, ids] of Object.entries(followIds)) {
          assert.equal(typeof capture.facts[field], "string");
          ids.add(capture.facts[field]);
        }
      }
    }
  }
  assert.ok(captureCount >= 70, "preserve the original full-run minimum of 70 captures");
  for (const [field, ids] of Object.entries(followIds)) {
    assert.equal(ids.size, 1, `the same MID capture Hero ${field} must span all viewport groups`);
  }
  return { groups: reports.length, viewports: viewports.length, captureCount };
}

function readReports(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? readReports(path)
      : entry.name === "metadata.json" ? [JSON.parse(readFileSync(path, "utf8"))] : [];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , directory, revision] = process.argv;
  assert.ok(directory && revision, "usage: verify-browser-captures.mjs DIRECTORY SOURCE_REVISION");
  console.log(verifyCaptureReports(readReports(directory), revision));
}
