import { expect, test } from "@playwright/test";

test("production app opens the Next workspace and keeps legacy documents on a recovery path", async ({ page, baseURL }) => {
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];

  page.on("request", (request) => {
    if (new URL(request.url()).origin !== baseURL) externalRequests.push(request.url());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page).toHaveTitle(/Senkei/);
  const navigation = page.getByRole("navigation", { name: "Workspace" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByTestId("nav-next")).toBeVisible();
  await expect(navigation.getByTestId("nav-library")).toBeVisible();
  await expect(navigation.getByTestId("nav-editor")).toHaveCount(0);
  await expect(navigation.getByTestId("nav-battle")).toHaveCount(0);
  await expect(navigation.getByTestId("nav-persistence")).toHaveCount(0);

  await navigation.getByTestId("nav-legacy-library").click();
  await expect(page.getByRole("heading", { name: "Legacy documents." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Legacy document recovery" })).toBeVisible();

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
