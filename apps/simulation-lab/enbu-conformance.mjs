// CI publish gate: reject even a one-byte Native Rust / production WASM divergence.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
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
const dispatch = createEnbuDispatcher(instance.exports);
for (const fixture of manifest.cases) {
  const actual = dispatch(JSON.stringify(fixture.request));
  const parsed = JSON.parse(actual);
  if (parsed.ok !== true) throw Error(`Enbu ${fixture.id} failed: ${JSON.stringify(parsed.error)}`);
  const digest = createHash('sha256').update(actual, 'utf8').digest('hex');
  if (digest !== fixture.response_sha256) {
    throw Error(`Enbu ${fixture.id} native/WASM difference: ${digest} != ${fixture.response_sha256}`);
  }
  console.log(`PASS Enbu ${fixture.id}: ${fixture.ticks} ticks, exact response digest ${digest.slice(0, 12)}`);
}
