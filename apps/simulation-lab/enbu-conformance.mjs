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
if (!Array.isArray(fixture.cases) || fixture.cases.length !== 8 ||
    !Array.isArray(manifest.variants) || ![3, 36].includes(manifest.variants.length)) {
  throw Error('Expected eight native golden fixtures and either 3 production or 36 research WASM variants');
}
const variants = [];
let expectedVariants = Array.from({length:8}, (_, n) => ({
  id:n.toString(2).padStart(3,'0'),
  features:[n & 4 ? 'lab-opt-termination' : null, n & 2 ? 'lab-opt-cohort' : null,
    n & 1 ? 'lab-opt-shields' : null].filter(Boolean),
})).concat([
  {id:'R',features:['lab-opt-route']},
  {id:'V',features:['lab-opt-visibility']},
  {id:'RV',features:['lab-opt-route','lab-opt-visibility']},
  {id:'TCSRV',features:['lab-optimizations','lab-opt-route','lab-opt-visibility']},
  {id:'P',features:['lab-opt-planned']},
  {id:'A',features:['lab-opt-arithmetic']},
  {id:'F',features:['lab-opt-frozen']},
  {id:'FPA',features:['lab-opt-frozen','lab-opt-planned','lab-opt-arithmetic']},
  {id:'G',features:['lab-opt-fog-cache']},
  {id:'TCSRVG',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-fog-cache']},
  {id:'Y',features:['lab-opt-replay-fusion']},
  {id:'TCSRVGY',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-fog-cache','lab-opt-replay-fusion']},
  {id:'O',features:['lab-opt-observation']},
  {id:'TCSRVGO',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-fog-cache','lab-opt-observation']},
  {id:'I',features:['lab-opt-inplace']},
  {id:'B',features:['lab-opt-frontier']},
  {id:'TCSRVIB',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-inplace','lab-opt-frontier']},
  {id:'H',features:['lab-opt-hybrid']},
  {id:'TCSRVH',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-hybrid']},
  {id:'S',features:['lab-opt-scheduler']},
  {id:'TCSRVS',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-scheduler']},
  {id:'TCSRVHS',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-hybrid','lab-opt-scheduler']},
  {id:'W',features:['lab-opt-movement-window']},
  {id:'TCSRVGW',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-fog-cache','lab-opt-movement-window']},
  {id:'X',features:['lab-opt-spatial']},
  {id:'TCSRVGX',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-fog-cache','lab-opt-spatial']},
  {id:'TCSRVGAS',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-fog-cache','lab-opt-arithmetic','lab-opt-scheduler']},
  {id:'TCSRVGH',features:['lab-optimizations','lab-opt-route','lab-opt-visibility','lab-opt-fog-cache','lab-opt-hybrid']},
]);
// Normal publication includes reference, previous and current production only.
// An explicit research run may provide the entire immutable 36-variant matrix.
if (manifest.variants.length === 3) {
  expectedVariants = expectedVariants.filter(variant =>
    ['000', 'TCSRVG', 'TCSRVGY'].includes(variant.id));
} else if (manifest.variants.length !== 36) {
  throw Error('Expected exactly 3 production or 36 research WASM variants');
}
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
console.log(`PASS: ${expectedVariants.length} WASM variants share one Rust revision, verified SHA-256 and size`);

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
      incumbent_speedup: pairedSpeedups(samples['TCSRVG'], samples[variant.id]),
      host_input_ms: summarizeSamples(hostInputParts[variant.id]).median_ms,
      wasm_dispatch_ms: summarizeSamples(dispatchParts[variant.id]).median_ms,
      host_output_ms: summarizeSamples(hostOutputParts[variant.id]).median_ms,
      memory_bytes: memory[variant.id], output_bytes: outputSize[variant.id]};
    rows.push(row);
    console.log(`BENCH ${current.id} mask=${variant.id} median=${stats.median_ms.toFixed(3)}ms ` +
      `p95=${stats.p95_ms.toFixed(3)}ms baseline-ratio=${row.speedup.median_ratio.toFixed(3)}x ` +
      `wasm-dispatch=${row.wasm_dispatch_ms.toFixed(3)}ms ` +
      `incumbent-TCSRVG-ratio=${row.incumbent_speedup.median_ratio.toFixed(3)}x`);
  }
  cases.push({id: current.id, ticks: current.ticks, golden_sha256: current.response_sha256});
}
const ranking = rankVariants(rows, manifest);
const incumbent_ranking = rankVariants(rows, manifest, 'TCSRVG');
const effects = factorialEffects(rows);
if (ranking.length !== expectedVariants.length || incumbent_ranking.length !== expectedVariants.length ||
    effects.length !== (expectedVariants.length === 36 ? 3 : 0)) {
  throw Error('Published portfolio evidence incomplete or unverified');
}
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
  sample_count: sampleCount, cases, variants: manifest.variants, rows, ranking,
  incumbent_ranking, incumbent_baseline:'TCSRVG', effects};
await writeFile(new URL('enbu-ci-report.json', root), JSON.stringify(report, null, 2));
