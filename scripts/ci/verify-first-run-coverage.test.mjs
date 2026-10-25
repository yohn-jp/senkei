import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { expectedFirstRunViewports, readFirstRunReports, verifyFirstRunCoverage } from "./verify-first-run-coverage.mjs";

const revision = "e4ee00cf1f14b0004d0dc6d0b20b9258506d5d28";

function report(viewports = expectedFirstRunViewports) {
  return {
    sourceSha: revision,
    viewportRuns: viewports.map((viewport) => ({
      viewport,
      result: "Confirmed result · Draw",
      finalTick: 600,
      rendered: "true",
      wasm200: true,
      buildRevision: revision,
    })),
  };
}

test("accepts the five canonical first-run viewports exactly once for the expected build", () => {
  assert.deepEqual(verifyFirstRunCoverage([report()], revision), { reports: 1, viewports: 5 });
});

test("accepts viewport rows spread across separately uploaded reports", () => {
  const reports = expectedFirstRunViewports.map((viewport) => report([viewport]));
  assert.deepEqual(verifyFirstRunCoverage(reports, revision), { reports: 5, viewports: 5 });
});

test("recursively reads only first-run-report.json files from artifact subdirectories", () => {
  const directory = mkdtempSync(join(tmpdir(), "senkei-first-run-reports-"));
  try {
    for (const [index, viewport] of expectedFirstRunViewports.entries()) {
      const destination = join(directory, `job-${index}`, "nested");
      mkdirSync(destination, { recursive: true });
      writeFileSync(join(destination, "first-run-report.json"), JSON.stringify(report([viewport])));
      writeFileSync(join(destination, "unrelated.json"), "{}");
    }
    const reports = readFirstRunReports(directory);
    assert.deepEqual(verifyFirstRunCoverage(reports, revision), { reports: 5, viewports: 5 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects missing, duplicated, and unexpected viewports", () => {
  assert.throws(() => verifyFirstRunCoverage([report(expectedFirstRunViewports.slice(1))], revision), /five canonical/);
  assert.throws(() => verifyFirstRunCoverage([report([...expectedFirstRunViewports, "mobile-320"])], revision), /duplicate/);
  assert.throws(() => verifyFirstRunCoverage([report([...expectedFirstRunViewports.slice(1), "mobile-375"])], revision), /unexpected/);
});

test("rejects reports and rows from a different browser build", () => {
  const wrongSource = report();
  wrongSource.sourceSha = "old-build";
  assert.throws(() => verifyFirstRunCoverage([wrongSource], revision), /sourceSha/);
  const wrongBuild = report();
  wrongBuild.viewportRuns[0].buildRevision = "old-build";
  assert.throws(() => verifyFirstRunCoverage([wrongBuild], revision), /buildRevision/);
});

test("rejects unconfirmed, unrendered, missing WASM, or zero-tick results", () => {
  for (const [field, value] of [
    ["result", "Running"],
    ["rendered", "false"],
    ["wasm200", false],
    ["finalTick", 0],
  ]) {
    const invalid = report();
    invalid.viewportRuns[0][field] = value;
    assert.throws(() => verifyFirstRunCoverage([invalid], revision), field === "wasm200" ? /WebAssembly/ : new RegExp(field));
  }
});
