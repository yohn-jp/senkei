import {createEnbuDispatcher} from './enbu-wasm-abi.mjs';
import {summarizeSamples, pairedSpeedups, rankVariants, factorialEffects} from './enbu-matrix-stats.mjs';

async function loadJson(path) {
  const response = await fetch(new URL(path, import.meta.url), {cache: 'no-store'});
  if (!response.ok) throw new Error(`Cannot load ${path} (HTTP ${response.status})`);
  return response.json();
}
async function digestBytes(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function digestText(value) {
  return digestBytes(new TextEncoder().encode(value));
}
async function loadWasm(revision, variant) {
  const url = new URL('./' + variant.wasm, import.meta.url);
  url.searchParams.set('rev', revision);
  const loadStarted = performance.now();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load WASM ${variant.id} (HTTP ${response.status})`);
  const bytes = await response.arrayBuffer();
  const fetchMs = performance.now() - loadStarted;
  if (bytes.byteLength !== variant.bytes || await digestBytes(bytes) !== variant.sha256) {
    throw new Error(`WASM binary / published manifest mismatch for mask ${variant.id}`);
  }
  const compileStarted = performance.now();
  const compiled = await WebAssembly.compile(bytes);
  const compileMs = performance.now() - compileStarted;
  const instantiationStarted = performance.now();
  const instance = await WebAssembly.instantiate(compiled, {});
  const instantiateMs = performance.now() - instantiationStarted;
  return {id: variant.id, dispatch: createEnbuDispatcher(instance.exports),
    load: {fetch_ms: fetchMs, compile_ms: compileMs, instantiate_ms: instantiateMs,
      bytes: bytes.byteLength, sha256: variant.sha256}};
}
function permute(variants, iteration) {
  const shift = iteration % variants.length;
  const rotated = [...variants.slice(shift), ...variants.slice(0, shift)];
  return iteration % 2 ? rotated.reverse() : rotated;
}
let busy = false;
self.onmessage = async ({data}) => {
  if (busy || data?.type !== 'run') return;
  busy = true;
  try {
    const samples = data.samples;
    if (![3, 5, 9, 21].includes(samples)) throw new Error('Invalid sample count');
    self.postMessage({type:'status', text:'WASM構成・正解データを検証しています'});
    const [fixtures, build, manifest] = await Promise.all([
      loadJson('./enbu-fixtures.json'), loadJson('./build.json'), loadJson('./enbu-variants.json'),
    ]);
    if (fixtures.schema !== 'senkei-enbu-wasm/v1' || manifest.schema !== 'senkei-enbu-matrix/v1' ||
      fixtures.revision !== build.revision || manifest.revision !== build.revision ||
      !Array.isArray(manifest.variants) || manifest.variants.length !== 13) {
      throw new Error('Enbu golden fixtures and all thirteen WASM variants must share one revision');
    }
    const selectedCases = data.caseId === 'all' ? fixtures.cases : fixtures.cases.filter(c => c.id === data.caseId);
    if (!selectedCases?.length) throw new Error('Unknown production Enbu case');
    const descriptors = data.variantId === 'all' ? manifest.variants :
      manifest.variants.filter(variant => variant.id === '000' || variant.id === data.variantId);
    if (descriptors.length < 2 && data.variantId !== '000') throw new Error('Unknown optimizer mask');
    const variants = [];
    for (const descriptor of descriptors) {
      self.postMessage({type:'status',text:`WASM ${descriptor.id}を検証して読み込み中（${variants.length+1}/${descriptors.length}）`});
      variants.push(await loadWasm(manifest.revision, descriptor));
    }
    const rows = [];
    for (const fixture of selectedCases) {
      const request = JSON.stringify(fixture.request);
      const records = Object.fromEntries(variants.map(variant => [variant.id, []]));
      const dispatch = Object.fromEntries(variants.map(variant => [variant.id, []]));
      const hostInput = Object.fromEntries(variants.map(variant => [variant.id, []]));
      const hostOutput = Object.fromEntries(variants.map(variant => [variant.id, []]));
      const memory = Object.fromEntries(variants.map(variant => [variant.id, 0]));
      const outputBytes = Object.fromEntries(variants.map(variant => [variant.id, 0]));
      for (let i = 0; i < samples + 2; i++) {
        for (const variant of permute(variants, i)) {
          const {response, timing} = variant.dispatch.profile(request);
          if (JSON.parse(response).ok !== true ||
            await digestText(response) !== fixture.response_sha256) {
            throw new Error(`Native Rust/Enbu mismatch: ${fixture.id}/${variant.id}, iteration ${i}`);
          }
          if (i < 2) continue;
          records[variant.id].push(timing.total_ms);
          dispatch[variant.id].push(timing.wasm_dispatch_ms);
          hostInput[variant.id].push(timing.host_input_ms);
          hostOutput[variant.id].push(timing.host_output_ms);
          memory[variant.id] = Math.max(memory[variant.id], timing.memory_bytes);
          outputBytes[variant.id] = timing.output_bytes;
        }
        if (i === 1 || (i > 1 && ((i - 1) % 3 === 0 || i === samples + 1))) {
          self.postMessage({type:'status', text:`${fixture.ticks} Tick · ${Math.max(0,i-1)}/${samples}回の完全一致・測定を確認`});
        }
      }
      for (const variant of variants) {
        const row = {
          id: fixture.id, ticks: fixture.ticks, variant: variant.id, samples,
          verified: true, stats: summarizeSamples(records[variant.id]),
          speedup: pairedSpeedups(records['000'], records[variant.id]),
          host_input_ms: summarizeSamples(hostInput[variant.id]).median_ms,
          wasm_dispatch_ms: summarizeSamples(dispatch[variant.id]).median_ms,
          host_output_ms: summarizeSamples(hostOutput[variant.id]).median_ms,
          memory_bytes: memory[variant.id], output_bytes: outputBytes[variant.id],
          wasm_bytes: variant.load.bytes,
          golden_sha256: fixture.response_sha256,
        };
        rows.push(row);
        self.postMessage({type:'row',row});
      }
    }
    const ranking = rankVariants(rows, manifest);
    const effects = factorialEffects(rows);
    self.postMessage({type:'complete', report: {
      schema:'senkei-enbu-matrix-report/v1',engine:'production-enbu-rust-wasm',
      source_revision: manifest.revision, environment: navigator.userAgent,
      measurement: {
        samples, warmups:2, execution_order:'rotated-and-alternated',
        timing_boundary:'WASM JSON ABI including Rust parse, Enbu execution, Rust serialization',
        host_phases:'JS UTF-8 encoding/input copy and response decode/deallocation measured separately',
        digest_verification:'complete native Rust output SHA-256 on every sample, outside timed window',
        ranking:'geometric mean across selected cases; indicative only, not statistical proof',
      },
      variants: manifest.variants, loads: Object.fromEntries(variants.map(v => [v.id, v.load])),
      cases: selectedCases.map(c => ({id:c.id,ticks:c.ticks})),
      rows,ranking,effects,
    }});
  } catch(error) {
    self.postMessage({type:'error',message:error instanceof Error ? error.message : String(error)});
  } finally {
    busy = false;
  }
};
