import {createEnbuDispatcher} from './enbu-wasm-abi.mjs';

async function loadJson(path) {
  const response = await fetch(new URL(path, import.meta.url), {cache: 'no-store'});
  if (!response.ok) throw new Error(`Cannot load ${path} (HTTP ${response.status})`);
  return response.json();
}
async function loadWasm(revision) {
  const url = new URL('./wasm/senkei_wasm.wasm', import.meta.url);
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
    const dispatch = await loadWasm(manifest.revision);
    const selected = data.caseId === 'all' ? manifest.cases : manifest.cases.filter(c => c.id === data.caseId);
    if (!selected.length) throw new Error('Unknown production Enbu case');
    const rows = [];
    for (const fixture of selected) {
      const request = JSON.stringify(fixture.request);
      const times = [];
      // Each sample must agree byte-for-byte with the native Rust golden response.
      for (let iteration = 0; iteration < samples + 2; iteration++) {
        const start = performance.now();
        const response = dispatch(request);
        const elapsed = performance.now() - start;
        const value = JSON.parse(response);
        if (value.ok !== true) throw new Error(`${fixture.id}: Enbu rejected the input: ${JSON.stringify(value.error)}`);
        const digest = await digestUtf8(response);
        if (digest !== fixture.response_sha256) {
          throw new Error(`${fixture.id}: native Rust / WASM mismatch (expected ${fixture.response_sha256}, got ${digest})`);
        }
        if (iteration >= 2) times.push(elapsed);
      }
      times.sort((a, b) => a - b);
      const row = {id: fixture.id, ticks: fixture.ticks, samples,
        median_ms: percentile(times, .5), p95_ms: percentile(times, .95),
        min_ms: times[0], max_ms: times[times.length - 1],
        response_sha256: fixture.response_sha256, verified: true};
      rows.push(row);
      self.postMessage({type: 'row', row});
    }
    self.postMessage({type: 'complete', report: {
      schema: 'senkei-enbu-wasm-benchmark/v1',
      engine: 'production-enbu-rust-wasm', source_revision: manifest.revision,
      native_wasm_equality: 'complete-response-sha256',
      measured_boundary: 'JSON UTF-8 copy + WASM dispatch + response decode + deallocation',
      environment: navigator.userAgent, results: rows,
    }});
  } catch (error) {
    self.postMessage({type: 'error', message: error instanceof Error ? error.message : String(error)});
  } finally {
    busy = false;
  }
};
