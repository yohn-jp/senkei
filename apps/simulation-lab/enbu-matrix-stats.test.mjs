import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSamples, pairedSpeedups, rankVariants, factorialEffects} from './enbu-matrix-stats.mjs';

test('median and nearest-rank p95 have explicit small-sample behavior', () => {
  assert.deepEqual(summarizeSamples([9, 1, 3, 4, 7]),
    {median_ms:4,p95_ms:9,min_ms:1,max_ms:9,samples:5});
  assert.throws(() => summarizeSamples([]));
  assert.throws(() => summarizeSamples([NaN]));
});
test('paired ratios distinguish regression from improvement without asserting confidence', () => {
  assert.equal(pairedSpeedups([100,100,100,100,100],[80,80,80,80,80]).trend,'improvement-trend');
  assert.equal(pairedSpeedups([100,100,100,100,100],[120,120,120,120,120]).trend,'regression-trend');
  assert.equal(pairedSpeedups([100,100,100],[99,100,101]).trend,'inconclusive');
  assert.throws(() => pairedSpeedups([1],[1,2]));
});
test('matrix ranks only full and verified combinations and reports worst-case regression', () => {
  const manifest={variants:[{id:'000',features:[],bytes:100},{id:'001',features:['A'],bytes:102},{id:'010',features:['B'],bytes:99}]};
  const row=(id,variant,median,verified=true)=>({id,variant,stats:{median_ms:median},verified});
  const out=rankVariants([row('x','000',10),row('y','000',20),row('x','001',5),row('y','001',25),row('x','010',12)],manifest);
  assert.deepEqual(out.map(v=>v.id),['001','000']);
  assert.equal(out[0].regressed_cases,1);
  assert.equal(out[0].worst_ratio,.8);
});

test('full-factorial effects isolate each feature across all other contexts', () => {
  const fixture = Array.from({length: 8}, (_, mask) => ({
    id:'same', variant:mask.toString(2).padStart(3,'0'), verified:true,
    stats:{median_ms:(mask & 4) ? 5 : 10},
  }));
  const effects = factorialEffects(fixture);
  assert.deepEqual(effects.map(e=>e.id), ['T','C','S']);
  assert.equal(effects[0].geometric_mean_ratio,2);
  assert.equal(effects[1].geometric_mean_ratio,1);
  assert.equal(effects[2].geometric_mean_ratio,1);
  assert.equal(effects[0].comparisons,4);
  assert.deepEqual(factorialEffects(fixture.slice(1)),[]);
});
