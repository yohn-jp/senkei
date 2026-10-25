import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const version = { major: 1, minor: 0, patch: 0 };
const documentId = "legacy-recovery-journey";
const document = (revision: number, source: string) => ({
  format: "senkei.local-document",
  document_version: 1,
  id: documentId,
  name: "Preserved initial strategy",
  revision,
  created_at: "2025-01-01T00:00:00.000Z",
  updated_at: `2025-01-0${revision}T00:00:00.000Z`,
  payload: {
    schema_version: version,
    id: "careful-march",
    revision: String(revision),
    ruleset: { id: "senkei.initial", version, digest: "0".repeat(64) },
    configuration: {},
    program_input: { kind: "text", source },
    initial_memory: {},
  },
});
const workspaceData = {
  bundle_version: 2,
  compiled_program: null,
  compilation: null,
  rulesets: [],
  component_versions: null,
  scenarios: [],
  latest_run: null,
  baseline: null,
  benchmark: null,
  benchmark_history: [],
  extensions: {},
};
const exportBundle = {
  format: "senkei.local-workspace",
  bundle_version: 2,
  active_document_id: documentId,
  active_revision: 2,
  history: [
    {
      saved_at: "2025-01-01T00:00:00.000Z",
      document: document(1, "senkei careful_march { }"),
      workspace_data: workspaceData,
    },
    {
      saved_at: "2025-01-02T00:00:00.000Z",
      document: document(2, "senkei careful_march { action hold { when false, do wait(), }, }"),
      workspace_data: workspaceData,
    },
  ],
};

test("legacy recovery preserves complete IndexedDB exports without running them in Next", async ({ page, baseURL }) => {
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== baseURL) externalRequests.push(request.url());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await page.getByTestId("nav-legacy-library").click();
  const importInput = page.getByLabel("Import legacy JSON export");
  await importInput.setInputFiles({
    name: "preserved-initial-strategy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exportBundle)),
  });
  await expect(page.getByRole("status")).toContainText("Imported preserved-initial-strategy.json.");
  await expect(page.getByRole("button", { name: "Open Preserved initial strategy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preserved initial strategy" })).toBeVisible();
  await expect(page.getByText("This format is not runnable in the Next workspace.")).toBeVisible();
  await expect(page.locator(".persistence-revision strong").filter({ hasText: "Revision 1" })).toBeVisible();
  await expect(page.locator(".persistence-revision strong").filter({ hasText: "Revision 2" })).toBeVisible();

  await page.getByLabel("Before").selectOption("1");
  await page.getByLabel("After").selectOption("2");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Changes" })).toBeVisible();
  await expect(page.getByText("/payload/program_input/source")).toBeVisible();

  await page.getByRole("button", { name: "Restore revision 1" }).click();
  await expect(page.getByRole("status")).toContainText("Revision 1 was restored as a new revision.");
  await expect(page.getByText("REV 3", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export complete history" }).click();
  const download = await downloadPromise;
  const downloadedBundle = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(downloadedBundle.active_document_id).toBe(documentId);
  expect(downloadedBundle.active_revision).toBe(3);
  expect(downloadedBundle.history).toHaveLength(3);
  expect(downloadedBundle.history[0].document.payload.program_input.source).toBe("senkei careful_march { }");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete local data" }).click();
  await expect(page.getByRole("status")).toContainText("The local document and revision history were deleted.");
  await expect(page.getByText("No legacy documents found.")).toBeVisible();

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
