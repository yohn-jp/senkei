// Reproducible Node-side research harness. Not a substitute for browser WASM timing.
import { performance } from 'node:perf_hooks';
import { METHODS, SCENARIOS, RUNNERS, fixture, clone, buildPlan } from './core.mjs';

function percentile(values,p){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];}
function timedRun(source,method,T,capture,{batch=24,warmups=3,samples=7}={}){
  for(let i=0;i<warmups;i++)RUNNERS[method](clone(source),T,capture);
  const measured=[];
  for(let sample=0;sample<samples;sample++){
    const workloads=Array.from({length:batch},()=>clone(source));
    const started=performance.now();
    for(const item of workloads)RUNNERS[method](item,T,capture);
    measured.push((performance.now()-started)/batch);
  }
  return {median_ms:percentile(measured,.5),p95_ms:percentile(measured,.95)};
}
function planTiming(source,T){
  // Compiles plans without mutating source. Calibration amortizes clock-resolution noise.
  for(let i=0;i<100;i++)buildPlan(source,T);
  const rounds=[];for(let trial=0;trial<5;trial++){
    const count=512,start=performance.now();for(let i=0;i<count;i++)buildPlan(source,T);
    rounds.push((performance.now()-start)/count);
  }
  return {median_ms:percentile(rounds,.5),p95_ms:percentile(rounds,.95)};
}
const actors=Number(process.env.LAB_ACTORS||256);
const ticks=Number(process.env.LAB_TICKS||2000);
const samples=Number(process.env.LAB_SAMPLES||7);
const batch=Number(process.env.LAB_BATCH||24);
const capture=process.env.LAB_CAPTURE==='1';
if(!Number.isInteger(actors)||actors<1||!Number.isInteger(ticks)||ticks<0||samples<1||batch<1)throw Error('Invalid parameters');
console.log(`Synthetic JavaScript portfolio benchmark (Node ${process.version}, actors=${actors}, ticks=${ticks}, capture=${capture}, samples=${samples}, batch=${batch})`);
console.log('scenario\tplan_us\tplanned_us\thybrid_us\tarithmetic_us\tphase_cache_us\tplan_modes');
const chosen=['planned','hybrid','arithmetic','phase_cache'];
for(const name of Object.keys(SCENARIOS)){
 const source=fixture(name,actors),plan=buildPlan(source,ticks),order=[...chosen];
 // Rotated method ordering spreads warm-up and CPU state bias across cases.
 const offset=Object.keys(SCENARIOS).indexOf(name)%order.length;
 const rotated=[...order.slice(offset),...order.slice(0,offset)];
 const records={};for(const method of rotated)records[method]=timedRun(source,method,ticks,capture,{batch,samples});
 const planning=planTiming(source,ticks);
 const mode=Object.entries(plan.counts).filter(([,v])=>v).map(([k,v])=>k+':'+v).join(',');
 console.log([name,(planning.median_ms*1000).toFixed(2),...chosen.map(m=>(records[m].median_ms*1000).toFixed(2)),mode].join('\t'));
}