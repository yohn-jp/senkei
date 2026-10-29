import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSamples, pairedSpeedups, rankVariants} from './enbu-matrix-stats.mjs';

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
