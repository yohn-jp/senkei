// Execute the unmodified published Enbu Web Worker against the exact static
// artifacts that Pages will deploy. Node supplies only browser host globals;
// Rust Enbu dispatch, WASM hashing, fixture equality and worker selection are
// the same code path as the Lab UI. This complements (not replaces) browser QA.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';

const site = resolve('_site/simulation-lab');
const origin = '/apps/simulation-lab/';
const messages = [];
const originalFetch = globalThis.fetch;
const originalSelf = globalThis.self;

try {
  globalThis.fetch = async input => {
    const url = new URL(input);
    const prefix = url.pathname.indexOf(origin);
    assert.notEqual(prefix, -1, `Unexpected Lab fetch path: ${url.pathname}`);
    const requested = url.pathname.slice(prefix + origin.length);
    const filepath = resolve(site, requested);
    const rel = relative(site, filepath);
    assert.ok(requested && !isAbsolute(rel) && rel !== '..' &&
      !rel.startsWith('..' + sep), 'Lab fetch must remain inside the published site');
    try {
      const bytes = await readFile(filepath);
      return new Response(bytes, { status: 200 });
    } catch (error) {
      if (error?.code === 'ENOENT') return new Response('missing', { status: 404 });
      throw error;
    }
  };
  globalThis.self = {
    postMessage(message) { messages.push(message); },
  };
  await import('./enbu-worker.mjs');
  assert.equal(typeof globalThis.self.onmessage, 'function');

  // Same request that the user-facing Lab sends after pressing Run.
  await globalThis.self.onmessage({
    data: { type: 'run', caseId: 'next-1', variantId: 'TCSRVG', samples: 3 },
  });
  const failure = messages.find(message => message.type === 'error');
  assert.equal(failure, undefined, `Published Lab worker failed: ${failure?.message}`);
  const completed = messages.find(message => message.type === 'complete');
  assert.ok(completed, 'Lab worker must finish its real Enbu/WASM run');
  assert.equal(completed.report.engine, 'production-enbu-rust-wasm');
  assert.equal(completed.report.cases.length, 1);
  assert.equal(completed.report.cases[0].id, 'next-1');
  assert.deepEqual(completed.report.rows.map(row => row.variant), ['000', 'TCSRVG']);
  for (const row of completed.report.rows) {
    assert.equal(row.verified, true);
    assert.equal(row.samples, 3);
    assert.ok(Number.isFinite(row.stats.median_ms));
    assert.ok(row.output_bytes > 0 && row.memory_bytes > 0);
  }
  assert.equal(Object.keys(completed.report.loads).length, 2);
  assert.equal(completed.report.ranking.length, 2);
  const build = JSON.parse(await readFile(resolve(site, 'build.json'), 'utf8'));
  assert.equal(completed.report.source_revision, build.revision);
  console.log('PASS: published Lab worker executed real 000/TCSRVG Rust/WASM, ' +
    'verified Native full-response SHA-256 on every sample and returned UI rows');
} finally {
  globalThis.fetch = originalFetch;
  if (originalSelf === undefined) delete globalThis.self;
  else globalThis.self = originalSelf;
}
