// CI publication gate: every optimizer mask must reproduce the unmodified
// native Rust dispatcher response. Rankings are descriptive and never gate on speed.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createEnbuDispatcher} from './enbu-wasm-abi.mjs';
import {summarizeSamples, pairedSpeedups, rankVariants, factorialEffects} from './enbu-matrix-stats.mjs';

const root = new URL('../../_site/simulation-lab/', import.meta.url);
const json = async filename => JSON.parse(await readFile(new URL(filename, root), 'utf8'));
const sha256 = input => createHash('sha256').update(input).digest('hex');
const fixture = await json('enbu-fixtures.json');
const build = await json('build.json');
const manifest = await json('enbu-variants.json');
if (fixture.schema !== 'senkei-enbu-wasm/v1' || manifest.schema !== 'senkei-enbu-matrix/v1' ||
    fixture.revision !== build.revision || manifest.revision !== build.revision) {
  throw Error('Production Enbu artifacts are not from the same immutable revision');
}
if (!Array.isArray(fixture.cases) || fixture.cases.length !== 7 ||
    !Array.isArray(manifest.variants) || manifest.variants.length !== 13) {
  throw Error('Expected seven native golden fixtures and all thirteen optimizer masks');
}
const variants = [];
const expectedVariants = Array.from({length:8}, (_, n) => ({
  id:n.toString(2).padStart(3,'0'),
  features:[n & 4 ? 'lab-opt-termination' : null, n & 2 ? 'lab-opt-cohort' : null,
    n & 1 ? 'lab-opt-shields' : null].filter(Boolean),
})).concat([
  {id:'R',features:['lab-opt-route']},
  {id:'V',features:['lab-opt-visibility']},
  {id:'RV',features:['lab-opt-route','lab-opt-visibility']},
  {id:'TCSRV',features:['lab-optimizations','lab-opt-route','lab-opt-visibility']},
  {id:'A',features:['lab-opt-arithmetic']},
]);
for (let n = 0; n < expectedVariants.length; n++) {
  const expected = expectedVariants[n].id;
  const descriptor = manifest.variants[n];
  if (descriptor.id !== expected ||
      descriptor.wasm !== `wasm/senkei_wasm_${expected}.wasm` ||
      !Array.isArray(descriptor.features) ||
      descriptor.features.join(',') !== expectedVariants[n].features.join(',')) {
    throw Error(`Invalid feature provenance: ${expected}`);
  }
  const bytes = await readFile(new URL(descriptor.wasm, root));
  if (bytes.length !== descriptor.bytes || sha256(bytes) !== descriptor.sha256) {
    throw Error(`WASM build artifact hash mismatch: ${expected}`);
  }
  const {instance} = await WebAssembly.instantiate(bytes, {});
  variants.push({id: descriptor.id, dispatch: createEnbuDispatcher(instance.exports)});
}
console.log('PASS: all 13 feature combinations built from one immutable Rust revision; verified SHA-256 and size');

const cases = [];
const rows = [];
const sampleCount = Number(process.env.SENKEI_LAB_CI_SAMPLES ?? 3);
if (!Number.isInteger(sampleCount) || sampleCount < 3 || sampleCount > 21) {
  throw Error('Invalid bounded CI timing sample count');
}
for (const current of fixture.cases) {
  const request = JSON.stringify(current.request);
  if (!current.id || !Number.isInteger(current.ticks) || typeof current.response_sha256 !== 'string') {
    throw Error('Invalid native golden fixture');
  }
  const samples = Object.fromEntries(variants.map(variant => [variant.id, []]));
  const dispatchParts = Object.fromEntries(variants.map(variant => [variant.id, []]));
  const hostInputParts = Object.fromEntries(variants.map(variant => [variant.id, []]));
  const hostOutputParts = Object.fromEntries(variants.map(variant => [variant.id, []]));
  const memory = Object.fromEntries(variants.map(variant => [variant.id, 0]));
  const outputSize = Object.fromEntries(variants.map(variant => [variant.id, 0]));
  // One untimed full-response proof first. Fail closed before collecting statistics.
  for (const variant of variants) {
    const actual = variant.dispatch(request);
    if (JSON.parse(actual).ok !== true || sha256(actual) !== current.response_sha256) {
      throw Error(`Native/Enbu WASM response divergence: ${current.id}/${variant.id}`);
    }
    console.log(`PASS Enbu ${current.id}/${variant.id}: complete native JSON digest`);
  }
  for (let i = 0; i < sampleCount + 1; i++) {
    const order = i % 2 ? [...variants].reverse() : variants;
    for (const variant of order) {
      const {response, timing} = variant.dispatch.profile(request);
      if (JSON.parse(response).ok !== true || sha256(response) !== current.response_sha256) {
        throw Error(`Nondeterministic measured Enbu response: ${current.id}/${variant.id}`);
      }
      if (i === 0) continue; // Warm-up is not measured.
      samples[variant.id].push(timing.total_ms);
      dispatchParts[variant.id].push(timing.wasm_dispatch_ms);
      hostInputParts[variant.id].push(timing.host_input_ms);
      hostOutputParts[variant.id].push(timing.host_output_ms);
      memory[variant.id] = Math.max(memory[variant.id], timing.memory_bytes);
      outputSize[variant.id] = timing.output_bytes;
    }
  }
  const base = samples['000'];
  for (const variant of variants) {
    const stats = summarizeSamples(samples[variant.id]);
    const row = {id: current.id, ticks: current.ticks, variant: variant.id,
      verified: true, stats, speedup: pairedSpeedups(base, samples[variant.id]),
      host_input_ms: summarizeSamples(hostInputParts[variant.id]).median_ms,
      wasm_dispatch_ms: summarizeSamples(dispatchParts[variant.id]).median_ms,
      host_output_ms: summarizeSamples(hostOutputParts[variant.id]).median_ms,
      memory_bytes: memory[variant.id], output_bytes: outputSize[variant.id]};
    rows.push(row);
    console.log(`BENCH ${current.id} mask=${variant.id} median=${stats.median_ms.toFixed(3)}ms ` +
      `p95=${stats.p95_ms.toFixed(3)}ms baseline-ratio=${row.speedup.median_ratio.toFixed(3)}x ` +
      `wasm-dispatch=${row.wasm_dispatch_ms.toFixed(3)}ms`);
  }
  cases.push({id: current.id, ticks: current.ticks, golden_sha256: current.response_sha256});
}
const ranking = rankVariants(rows, manifest);
const effects = factorialEffects(rows);
if (ranking.length !== 13 || effects.length !== 3) throw Error('Full-factorial evidence incomplete or unverified');
for (const row of ranking) {
  console.log(`RANK mask=${row.id} geomean=${row.aggregate_ratio.toFixed(3)}x ` +
    `worst=${row.worst_ratio.toFixed(3)}x regressions=${row.regressed_cases}/${row.cases} ` +
    `bytes=${row.bytes}`);
}
for (const effect of effects) console.log(`FACTOR ${effect.id} marginal-geomean=${effect.geometric_mean_ratio.toFixed(3)}x worst=${effect.worst_ratio.toFixed(3)}x regressions=${effect.regressions}/${effect.comparisons}`);
const report = {schema:'senkei-enbu-matrix-report/v1', engine:'production-enbu-rust-wasm',
  source_revision: manifest.revision, environment: `Node ${process.version}, ${process.platform}/${process.arch}`,
  measured_boundary: 'WASM JSON ABI dispatch including Rust decode, Enbu, encode; host input/output measured separately',
  timing_proof: 'every timed full JSON response matches native Rust SHA-256',
  ranking_method: 'equal-case geometric mean of baseline/candidate median; descriptive only',
  sample_count: sampleCount, cases, variants: manifest.variants, rows, ranking, effects};
await writeFile(new URL('enbu-ci-report.json', root), JSON.stringify(report, null, 2));
