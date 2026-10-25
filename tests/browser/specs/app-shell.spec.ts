import { expect, test } from "@playwright/test";

test("production app navigation stays local", async ({ page, baseURL }) => {
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];

  page.on("request", (request) => {
    if (new URL(request.url()).origin !== baseURL) externalRequests.push(request.url());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page).toHaveTitle(/Senkei/);
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "Workspace" });
  await navigation.getByRole("button", { name: /Tactics/ }).click();
  await expect(navigation.getByRole("button", { name: /Tactics/ })).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("button", { name: /Battle lab/ }).click();
  await expect(navigation.getByRole("button", { name: /Battle lab/ })).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("button", { name: "旧版 Library", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "旧版 Library", exact: true })).toHaveAttribute("aria-current", "page");

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
