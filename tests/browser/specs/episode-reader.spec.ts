import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';

let fixture: string;
test.beforeAll(async () => {
  const bundle = await build({ entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/episode-reader.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  fixture = bundle.outputFiles[0].text;
});
async function mount(page: Page, clear = false): Promise<void> {
  await page.route('**/episode-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="episode-test-root"></div></body></html>' }));
  await page.goto('/episode-test');
  if (clear) await page.evaluate(() => localStorage.clear());
  await page.addScriptTag({ content: fixture });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 740 }]) {
  test(`authorized reading, interruption, resume and replay at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mount(page, true);
    await expect(page.getByText('Episode content is not connected.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read episode' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Connect provider' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Unread' })).toBeVisible();
    await page.getByRole('button', { name: 'Read episode' }).click();
    await expect(page.getByText('First authorized line')).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('This supplied policy locks the choice.')).toBeVisible();
    await page.getByRole('button', { name: 'Return to pair' }).click();
    await expect(page.getByRole('heading', { name: 'Alpha and Beta' })).toBeVisible();
    await expect(page.getByText('Read · Interrupted')).toBeVisible();
    await mount(page);
    await page.getByRole('button', { name: 'Connect provider' }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Choose a direction')).toBeVisible();
    await page.getByLabel('Left path').check();
    await page.getByRole('button', { name: 'Confirm choice' }).click();
    await expect(page.getByText('Authorized ending')).toBeVisible();
    await page.getByRole('button', { name: 'Finish episode' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Read · Completed' })).toBeVisible();
    await page.getByRole('button', { name: 'Read again' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Saved choice: Left path')).toBeVisible();
    await expect(page.getByLabel('Right path')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue with saved choice' }).click();
    await page.getByRole('button', { name: 'Finish episode' }).click();
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([expect.stringContaining('senkei.episode-progress.v1')]);
  });
}

test('write failures keep the current page and allow retry and return to the same pair', async ({ page }) => {
  await mount(page, true);
  await page.getByRole('button', { name: 'Connect provider' }).click();
  await page.getByRole('button', { name: 'Read episode' }).click();
  await page.getByRole('button', { name: 'Fail writes' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be saved or read');
  await expect(page.getByText('First authorized line')).toBeVisible();
  await page.getByRole('button', { name: 'Restore writes' }).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Choose a direction')).toBeVisible();
  await page.getByRole('button', { name: 'Return to pair' }).click();
  await expect(page.getByRole('heading', { name: 'Alpha and Beta' })).toBeVisible();
  await expect(page.getByText('Read · Interrupted')).toBeVisible();
  await page.getByRole('button', { name: 'Change pair' }).click();
  await expect(page.getByRole('heading', { name: 'Alpha and Gamma' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Unread' })).toBeVisible();
  await page.getByRole('button', { name: 'Change pair' }).click();
  await expect(page.getByText('Read · Interrupted')).toBeVisible();
});
