// CI publish gate: reject even a one-byte Native Rust / production WASM divergence.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createEnbuDispatcher} from './enbu-wasm-abi.mjs';

const base = new URL('../../_site/simulation-lab/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('enbu-fixtures.json', base), 'utf8'));
const build = JSON.parse(await readFile(new URL('build.json', base), 'utf8'));
if (manifest.schema !== 'senkei-enbu-wasm/v1' || manifest.revision !== build.revision) {
  throw Error('Enbu WASM fixtures and deployment revision mismatch');
}
if (!Array.isArray(manifest.cases) || manifest.cases.length < 3) throw Error('Missing Enbu fixtures');
const bytes = await readFile(new URL('wasm/senkei_wasm.wasm', base));
const {instance} = await WebAssembly.instantiate(bytes, {});
const variants = [
  ['reference', createEnbuDispatcher(instance.exports)],
  ['optimized', createEnbuDispatcher((await WebAssembly.instantiate(
    await readFile(new URL('wasm/senkei_wasm_optimized.wasm', base)), {})).instance.exports)],
];
for (const fixture of manifest.cases) {
  for (const [variant, dispatch] of variants) {
    const actual = dispatch(JSON.stringify(fixture.request));
    const parsed = JSON.parse(actual);
    if (parsed.ok !== true) throw Error(`Enbu ${fixture.id}/${variant} failed: ${JSON.stringify(parsed.error)}`);
    const digest = createHash('sha256').update(actual, 'utf8').digest('hex');
    if (digest !== fixture.response_sha256) {
      throw Error(`Enbu ${fixture.id}/${variant} native/WASM difference: ${digest} != ${fixture.response_sha256}`);
    }
    console.log(`PASS Enbu ${fixture.id}/${variant}: ${fixture.ticks} ticks, exact response digest ${digest.slice(0, 12)}`);
  }

  // Performance evidence only; correctness was verified above. Never gate
  // publication on fluctuating CI timing, and never confuse this with compute-only.
  const samples = {reference: [], optimized: []};
  const json = JSON.stringify(fixture.request);
  for (let i = 0; i < 9; i++) {
    const pair = i % 2 ? [...variants].reverse() : variants;
    for (const [variant, dispatch] of pair) {
      const t0 = performance.now();
      const response = dispatch(json);
      const dt = performance.now() - t0;
      if (i >= 2) samples[variant].push(dt);
      // Fail rather than reporting speed if repeated executions ever diverge.
      if (createHash('sha256').update(response).digest('hex') !== fixture.response_sha256) {
        throw Error(`Nondeterministic Enbu result during timed ${fixture.id}/${variant}`);
      }
    }
  }
  const median = values => values.sort((a, b) => a-b)[Math.floor(values.length / 2)];
  const referenceMedian = median(samples.reference);
  const optimizedMedian = median(samples.optimized);
  console.log(`BENCH Enbu ${fixture.id}: ref ${referenceMedian.toFixed(3)}ms, optimized ${optimizedMedian.toFixed(3)}ms, ratio ${(referenceMedian / optimizedMedian).toFixed(3)}x (7 interleaved samples, 2 warmups; full JSON ABI)`);

}
