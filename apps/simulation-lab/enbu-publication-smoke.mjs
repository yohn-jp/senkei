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
  // The independent production+window A/B must run through this *same*
  // Worker and Native full-response digest. Test a Behavior-driven case,
  // not merely the quiet one-Tick reference used above.
  messages.length = 0;
  await globalThis.self.onmessage({
    data: { type: 'run', caseId: 'next-behavior-16', variantId: 'TCSRVGW', samples: 3 },
  });
  const windowFailure = messages.find(message => message.type === 'error');
  assert.equal(windowFailure, undefined,
    `MovementWindow Lab worker failed: ${windowFailure?.message}`);
  const windowCompletion = messages.find(message => message.type === 'complete');
  assert.ok(windowCompletion, 'MovementWindow real-WASM comparison must complete');
  assert.equal(windowCompletion.report.source_revision, build.revision);
  assert.equal(windowCompletion.report.cases[0].id, 'next-behavior-16');
  assert.deepEqual(windowCompletion.report.rows.map(row => row.variant),
    ['000', 'TCSRVG', 'TCSRVGW']);
  assert.ok(windowCompletion.report.rows.every(row => row.verified && row.samples === 3));
  assert.ok(windowCompletion.report.rows.every(row =>
    row.incumbent_speedup && Number.isFinite(row.incumbent_speedup.median_ratio)));
  console.log('PASS: real Behavior-driven Lab Worker compared 000/TCSRVG/TCSRVGW, ' +
    'verified every Native golden and measured the exact incumbent delta');
  // The graph-local combat kernel is a separate physical strategy. Include
  // the published production binary and an actually active 64-Tick fixture.
  // This rules out a zero-work benchmark being mistaken for combat speedup.
  messages.length = 0;
  await globalThis.self.onmessage({
    data: { type: 'run', caseId: 'quintet-64', variantId: 'TCSRVGX', samples: 3 },
  });
  const spatialFailure = messages.find(message => message.type === 'error');
  assert.equal(spatialFailure, undefined,
    `Spatial Enbu Lab worker failed: ${spatialFailure?.message}`);
  const spatialCompletion = messages.find(message => message.type === 'complete');
  assert.ok(spatialCompletion, 'spatial real-WASM benchmark must finish');
  assert.equal(spatialCompletion.report.source_revision, build.revision);
  assert.equal(spatialCompletion.report.cases[0].id, 'quintet-64');
  assert.deepEqual(spatialCompletion.report.rows.map(row => row.variant),
    ['000', 'TCSRVG', 'TCSRVGX']);
  assert.ok(spatialCompletion.report.rows.every(row =>
    row.verified && row.samples === 3));
  assert.ok(spatialCompletion.report.rows.every(row =>
    row.incumbent_speedup &&
      Number.isFinite(row.incumbent_speedup.median_ratio)));
  console.log('PASS: published Lab worker executed real 64-Tick Quintet, ' +
    'Native-equal graph-local combat and incumbent wall-time A/B');

} finally {
  globalThis.fetch = originalFetch;
  if (originalSelf === undefined) delete globalThis.self;
  else globalThis.self = originalSelf;
}
