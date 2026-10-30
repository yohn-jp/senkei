// Actual Chromium acceptance of the published Simulation Lab UI and its
// real production Enbu WebAssembly Worker, not a synthetic JS benchmark.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep, isAbsolute, extname } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve('_site');
const output = resolve('target/simulation-lab/browser-evidence');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};
const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(requestUrl.pathname);
    const target = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    const rel = relative(root, target);
    if (rel === '..' || isAbsolute(rel) || rel.startsWith('..' + sep)) {
      response.writeHead(403).end();
      return;
    }
    const bytes = await readFile(target);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
let browser;
try {
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/simulation-lab/`, { waitUntil: 'networkidle' });
  await expect(page.locator('#enbu-variant')).toHaveValue('TCSRVG');
  await page.locator('#enbu-case').selectOption('next-1');
  await page.locator('#enbu-samples').selectOption('3');
  await page.locator('#enbu-run').click();
  await expect(page.locator('#enbu-status')).toContainText('検証成功', { timeout: 120_000 });
  const report = JSON.parse(await page.locator('#enbu-report').inputValue());
  const build = JSON.parse(await readFile(resolve(root, 'simulation-lab/build.json'), 'utf8'));
  assert.equal(report.source_revision, build.revision);
  assert.equal(report.engine, 'production-enbu-rust-wasm');
  assert.equal(report.cases.length, 1);
  assert.deepEqual(report.rows.map(row => row.variant), ['000', 'TCSRVG']);
  for (const row of report.rows) {
    assert.equal(row.verified, true);
    assert.equal(row.samples, 3);
    assert.ok(row.stats.median_ms > 0 && Number.isFinite(row.stats.p95_ms));
  }
  assert.equal(await page.locator('#enbu-results tr').count(), 2);
  assert.deepEqual(errors, [], 'Browser must not raise page errors');
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: resolve(output, 'production-enbu-lab-1440.png'), fullPage: true });
  await writeFile(resolve(output, 'production-enbu-lab-report.json'), JSON.stringify({
    revision: build.revision,
    browser: browser.version(),
    tests: 'real Chromium UI → Web Worker → production Enbu WASM → Native golden response',
    variants: report.rows.map(row => ({ id: row.variant, median_ms: row.stats.median_ms,
      p95_ms: row.stats.p95_ms, verified: row.verified })),
    pageErrors: errors,
  }, null, 2));
  console.log('PASS: real Chromium Simulation Lab performed verified reference vs production TCSRVG WASM comparison');
} finally {
  await browser?.close();
  await new Promise(ok => server.close(ok));
}
