import { expect, test } from "@playwright/test";

test("production Worker runs the seven local NPC regression cases through real WASM", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  const wasmStatuses: number[] = [];
  const context = page.context();

  context.on("request", (request) => {
    if (new URL(request.url()).origin !== baseURL) externalRequests.push(request.url());
  });
  context.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) {
      wasmStatuses.push(response.status());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Build a formation and its tactics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "No-code" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "Workspace" });
  await navigation.getByRole("button", { name: /Battle lab/ }).click();
  const compare = page.getByRole("button", { name: "Compare NPCs" });
  await expect(compare).toBeEnabled({ timeout: 30_000 });
  await compare.click();

  const cases = page.locator(".benchmark-case-list .benchmark-case");
  await expect(cases).toHaveCount(7, { timeout: 120_000 });
  await expect(cases.locator("small")).toHaveText([
    "first-march",
    "core-pressure",
    "intercept-visible",
    "tower-pressure",
    "hold-under-pressure",
    "medic-support",
    "deploy-reserve",
  ]);

  expect(wasmStatuses.some((status) => status === 200)).toBe(true);
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
