import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';

let fixture: string;
test.beforeAll(async () => {
  const bundle = await build({ entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/official-operation.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  fixture = bundle.outputFiles[0].text;
});
async function mount(page: Page, mode: string) {
  await page.route('**/official-operation-test*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="official-operation-root"></div></body></html>' }));
  await page.goto(`/official-operation-test?mode=${mode}`);
  await page.addScriptTag({ content: fixture });
}
async function connect(page: Page) { await page.getByRole('button', { name: 'Connect fixture authority' }).click(); }
async function count(page: Page, key: string) { return page.evaluate(name => Number(localStorage.getItem(name) ?? 0), key); }

for (const width of [1280, 320]) {
  test(`draw review, cancel and same-request recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 }); await mount(page, 'draw');
    const panel = page.getByRole('region', { name: 'Official operation' });
    await expect(panel).toContainText('not configured'); await expect(panel.getByRole('button')).toHaveCount(0);
    await connect(page); await panel.getByRole('button', { name: 'Review draw' }).click();
    const review = panel.getByRole('group', { name: 'Confirm official operation' });
    await expect(review).toContainText('fixture 1/3'); await expect(review).toContainText('Fixture draw condition');
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await count(page, 'draw-submits')).toBe(0);
    await panel.getByRole('button', { name: 'Review again' }).click();
    await review.getByRole('button', { name: 'Confirm draw' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(panel).toContainText('outcome is unknown'); expect(await count(page, 'draw-submits')).toBe(1);
    await mount(page, 'draw'); await connect(page);
    await expect(panel).toContainText('outcome is unknown'); await expect(panel.getByRole('button', { name: 'Confirm draw' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Check original request' }).click();
    await expect(panel).toContainText('Draw committed'); await expect(panel).toContainText('blade-acquisition');
    expect(await count(page, 'draw-submits')).toBe(1); expect(await count(page, 'draw-inquiries')).toBe(1);
    const identities = await page.evaluate(() => ({ request: JSON.parse(localStorage.getItem('draw-last-request')!), inquiry: JSON.parse(localStorage.getItem('draw-last-inquiry')!) }));
    expect(identities.inquiry.requestId).toBe(identities.request.requestId);
    await mount(page, 'draw'); await connect(page); await expect(panel).toContainText('Draw committed');
    expect(await count(page, 'draw-submits')).toBe(1); expect(await count(page, 'draw-inquiries')).toBe(1);
  });
}

test('verified listing acceptance stays separate from a filled order', async ({ page }) => {
  await mount(page, 'listing'); await connect(page);
  const panel = page.getByRole('region', { name: 'Official operation' });
  await panel.getByRole('button', { name: 'Review player listing' }).click();
  await expect(panel).toContainText('waits for a buyer'); await expect(panel).toContainText('fixture expiry'); await expect(panel).toContainText('fees: not supplied');
  await panel.getByRole('button', { name: 'Confirm player listing' }).click();
  await expect(panel).toContainText('was created and is awaiting a buyer'); await expect(panel).not.toContainText('was filled');
  expect(await count(page, 'listing-submits')).toBe(1);
});

test('pending listing is inquired by the same identity and reports a later fill', async ({ page }) => {
  await mount(page, 'pending'); await connect(page);
  const panel = page.getByRole('region', { name: 'Official operation' });
  await panel.getByRole('button', { name: 'Review player listing' }).click(); await panel.getByRole('button', { name: 'Confirm player listing' }).click();
  await expect(panel).toContainText('awaiting a buyer'); await panel.getByRole('button', { name: 'Check original request' }).click();
  await expect(panel).toContainText('was filled'); await expect(panel).toContainText('sale-settlement');
  expect(await count(page, 'pending-submits')).toBe(1); expect(await count(page, 'pending-inquiries')).toBe(1);
});

test('changed quote requires a new review from the caller and preserves its filter', async ({ page }) => {
  await mount(page, 'quote-changed'); await page.getByLabel('Caller search').fill('blade filter'); await connect(page);
  const panel = page.getByRole('region', { name: 'Official operation' });
  await panel.getByRole('button', { name: 'Review purchase' }).click(); await panel.getByRole('button', { name: 'Confirm purchase' }).click();
  await expect(panel).toContainText('quote changed'); await expect(panel.getByRole('button', { name: /Confirm|Review/ })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Return', exact: true }).click(); await expect(page.getByLabel('Caller search')).toHaveValue('blade filter');
  expect(await count(page, 'quote-changed-submits')).toBe(1);
});

test('unverified preview never enables confirmation or sends a request', async ({ page }) => {
  await mount(page, 'invalid-preview'); await connect(page);
  const panel = page.getByRole('region', { name: 'Official operation' });
  await panel.getByRole('button', { name: 'Review draw' }).click(); await expect(panel).toContainText('preview could not be verified');
  await expect(panel.getByRole('button', { name: 'Confirm draw' })).toHaveCount(0); expect(await count(page, 'invalid-preview-submits')).toBe(0);
});

test('lost journal after submission stays unresolved and never retries the draw', async ({ page }) => {
  await mount(page, 'lost-journal'); await connect(page);
  const panel = page.getByRole('region', { name: 'Official operation' });
  await panel.getByRole('button', { name: 'Review draw' }).click(); await panel.getByRole('button', { name: 'Confirm draw' }).click();
  await expect(panel).toContainText('outcome could not be recovered');
  await panel.getByRole('button', { name: 'Retry request recovery' }).click();
  await expect(panel).toContainText('outcome could not be recovered');
  await expect(panel.getByRole('button', { name: /Confirm|Review/ })).toHaveCount(0);
  expect(await count(page, 'lost-journal-submits')).toBe(1);
});

for (const scenario of [
  { mode: 'buyback', label: 'market maker buyback', result: 'Market maker buyback committed.' },
  { mode: 'purchase', label: 'purchase', result: 'Purchase committed.' },
  { mode: 'cancel', label: 'cancellation', result: 'Order cancellation committed.' },
]) {
  test(`confirmed ${scenario.label} uses the authority result`, async ({ page }) => {
    await mount(page, scenario.mode); await connect(page);
    const panel = page.getByRole('region', { name: 'Official operation' });
    await panel.getByRole('button', { name: `Review ${scenario.label}` }).click();
    if (scenario.mode === 'buyback') await expect(panel).toContainText('Official market maker minimum guarantee: 12');
    await panel.getByRole('button', { name: `Confirm ${scenario.label}` }).click();
    await expect(panel).toContainText(scenario.result);
    expect(await count(page, `${scenario.mode}-submits`)).toBe(1);
  });
}
