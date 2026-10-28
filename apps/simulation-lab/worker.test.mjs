import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS, SCENARIOS } from './core.mjs';

test('browser worker completes eleven strategy measurements with exact plans and bounded timings', async () => {
  const messages=[];
  const oldSelf=globalThis.self;
  let handler;
  globalThis.self={addEventListener:(kind,fn)=>{assert.equal(kind,'message');handler=fn;},postMessage:message=>messages.push(message)};
  try{
    await import('./worker.mjs');
    for(const capture of [false,true]){
      messages.length=0;
      await handler({data:{type:'start',config:{scenario:'shared_small',actors:64,ticks:500,samples:5,capture,verify:true,warmups:2}}});
      assert.equal(messages.at(-1).type,'complete',JSON.stringify(messages.filter(message=>message.type==='error')));
      const row=messages.find(message=>message.type==='row').row;
      assert.equal(Object.keys(row.methods).length,METHODS.length);
      assert.ok(Number.isFinite(row.planner.general_plan_us));
      assert.equal(row.planner.actors_scanned,64);
      assert.equal(Object.values(row.planner.counts).reduce((a,b)=>a+b,0),row.planner.targets_scanned);
      for(const method of METHODS){
        const stats=row.methods[method];
        assert.ok(Number.isFinite(stats.median_ms)&&stats.median_ms>=0,method);
        assert.ok(Number.isFinite(stats.p95_ms)&&stats.p95_ms>=0,method);
        assert.ok(stats.speedup_vs_tick===null||Number.isFinite(stats.speedup_vs_tick),method);
        assert.equal(stats.samples_ms.length,5);
      }
      assert.equal(messages.filter(message=>message.type==='progress').length,METHODS.length);
      assert.equal(messages.find(message=>message.type==='verified').fixed,560);
      assert.equal(messages.find(message=>message.type==='verified').randomized,200);
    }
  }finally{if(oldSelf===undefined)delete globalThis.self;else globalThis.self=oldSelf;}
});