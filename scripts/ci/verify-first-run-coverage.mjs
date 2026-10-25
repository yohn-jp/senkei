import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const expectedFirstRunViewports = [
  "mobile-320",
  "mobile-390",
  "mobile-430",
  "desktop-1440",
  "desktop-1920",
];

export function verifyFirstRunCoverage(reports, expectedSha) {
  assert.ok(Array.isArray(reports) && reports.length > 0, "at least one first-run report is required");
  assert.equal(typeof expectedSha, "string");
  assert.ok(expectedSha.length > 0, "expected source SHA is required");

  const rows = reports.flatMap((report, index) => {
    assert.equal(report.sourceSha, expectedSha, `report ${index + 1} sourceSha must match the expected build`);
    assert.ok(Array.isArray(report.viewportRuns), `report ${index + 1} must contain viewportRuns`);
    return report.viewportRuns;
  });
  const seen = new Set();
  for (const row of rows) {
    assert.ok(row && typeof row === "object", "viewport run must be an object");
    assert.ok(expectedFirstRunViewports.includes(row.viewport), `unexpected first-run viewport: ${row.viewport}`);
    assert.ok(!seen.has(row.viewport), `duplicate first-run viewport: ${row.viewport}`);
    seen.add(row.viewport);
    assert.match(row.result, /^Confirmed result · (Attacker Victory|Defender Victory|Draw)$/, `${row.viewport} must have a confirmed result`);
    assert.equal(typeof row.finalTick, "number", `${row.viewport} must report a numeric finalTick`);
    assert.ok(Number.isFinite(row.finalTick) && row.finalTick > 0, `${row.viewport} finalTick must be greater than zero`);
    assert.equal(row.rendered, "true", `${row.viewport} must confirm that the result was rendered`);
    assert.equal(row.wasm200, true, `${row.viewport} must confirm a successful WebAssembly response`);
    assert.equal(row.buildRevision, expectedSha, `${row.viewport} buildRevision must match the expected build`);
  }
  assert.equal(rows.length, expectedFirstRunViewports.length, "all five canonical first-run viewports must be present exactly once");
  assert.deepEqual([...seen].sort(), [...expectedFirstRunViewports].sort(), "all five canonical first-run viewports must be present");
  return { reports: reports.length, viewports: rows.length };
}

export function readFirstRunReports(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readFirstRunReports(path);
    if (entry.isFile() && entry.name === "first-run-report.json") {
      return [JSON.parse(readFileSync(path, "utf8"))];
    }
    return [];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , directory, expectedSha] = process.argv;
  assert.ok(directory && expectedSha, "usage: verify-first-run-coverage.mjs REPORT_DIRECTORY EXPECTED_SOURCE_SHA");
  console.log(verifyFirstRunCoverage(readFirstRunReports(directory), expectedSha));
}
