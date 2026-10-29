import {createEnbuDispatcher} from './enbu-wasm-abi.mjs';

async function loadJson(path) {
  const response = await fetch(new URL(path, import.meta.url), {cache: 'no-store'});
  if (!response.ok) throw new Error(`Cannot load ${path} (HTTP ${response.status})`);
  return response.json();
}
async function loadWasm(revision, filename) {
  const url = new URL('./wasm/' + filename, import.meta.url);
  url.searchParams.set('rev', revision);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load production WASM (HTTP ${response.status})`);
  let instance;
  try {
    ({instance} = await WebAssembly.instantiateStreaming(response.clone(), {}));
  } catch {
    const result = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    instance = result instanceof WebAssembly.Instance ? result : result.instance;
  }
  return createEnbuDispatcher(instance.exports);
}
async function digestUtf8(value) {
  const bytes = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}
function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}
let busy = false;
self.onmessage = async ({data}) => {
  if (busy || data?.type !== 'run') return;
  busy = true;
  try {
    const samples = data.samples;
    if (![3, 5, 9, 21].includes(samples)) throw new Error('Invalid sample count');
    self.postMessage({type: 'status', text: '本番Enbu WASMを読み込んでいます'});
    const [manifest, build] = await Promise.all([loadJson('./enbu-fixtures.json'), loadJson('./build.json')]);
    if (manifest.schema !== 'senkei-enbu-wasm/v1' || manifest.revision !== build.revision) {
      throw new Error('Fixture and WASM deployment revisions disagree');
    }
    const variants = [
      {id: 'reference', dispatch: await loadWasm(manifest.revision, 'senkei_wasm.wasm')},
      {id: 'optimized', dispatch: await loadWasm(manifest.revision, 'senkei_wasm_optimized.wasm')},
    ];
    const selected = data.caseId === 'all' ? manifest.cases : manifest.cases.filter(c => c.id === data.caseId);
    if (!selected.length) throw new Error('Unknown production Enbu case');
    const rows = [];
    for (const fixture of selected) {
      const request = JSON.stringify(fixture.request);
      const timings = {reference: [], optimized: []};
      // Alternate execution order to limit thermal/JIT order bias. Both modes
      // run identical production inputs and must match the native golden bytes.
      for (let iteration = 0; iteration < samples + 2; iteration++) {
        const ordered = iteration % 2 ? [...variants].reverse() : variants;
        for (const variant of ordered) {
          const start = performance.now();
          const response = variant.dispatch(request);
          const elapsed = performance.now() - start;
          const value = JSON.parse(response);
          if (value.ok !== true) throw new Error(`${fixture.id}/${variant.id}: Enbu rejected the input: ${JSON.stringify(value.error)}`);
          const digest = await digestUtf8(response);
          if (digest !== fixture.response_sha256) {
            throw new Error(`${fixture.id}/${variant.id}: native Rust / WASM mismatch (expected ${fixture.response_sha256}, got ${digest})`);
          }
          if (iteration >= 2) timings[variant.id].push(elapsed);
        }
      }
      const stats = {};
      for (const variant of variants) {
        const times = timings[variant.id].sort((a, b) => a - b);
        stats[variant.id] = {
          median_ms: percentile(times, .5), p95_ms: percentile(times, .95),
          min_ms: times[0], max_ms: times[times.length - 1],
        };
      }
      const row = {id: fixture.id, ticks: fixture.ticks, samples, ...stats,
        speedup: stats.reference.median_ms / Math.max(stats.optimized.median_ms, Number.EPSILON),
        response_sha256: fixture.response_sha256, verified: true};
      rows.push(row);
      self.postMessage({type: 'row', row});
    }
    self.postMessage({type: 'complete', report: {
      schema: 'senkei-enbu-wasm-benchmark/v1',
      engine: 'production-enbu-rust-wasm', source_revision: manifest.revision,
      native_wasm_equality: 'complete-response-sha256; reference-and-optimized',
      measured_boundary: 'JSON UTF-8 copy + WASM dispatch + response decode + deallocation',
      environment: navigator.userAgent, results: rows,
    }});
  } catch (error) {
    self.postMessage({type: 'error', message: error instanceof Error ? error.message : String(error)});
  } finally {
    busy = false;
  }
};
