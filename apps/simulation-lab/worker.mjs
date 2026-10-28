import { METHODS, SCENARIOS, RUNNERS, fixture, clone, canon, differential, fuzz } from './core.mjs';

function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function percentile(numbers,p){const sorted=[...numbers].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];}
function median(numbers){return percentile(numbers,.5);}
function runMeasured(method,source,ticks,capture,options){
 const pilot=clone(source);
 const pilotAt=performance.now();
 RUNNERS[method](pilot,ticks,capture);
 const pilotMs=Math.max(.01,performance.now()-pilotAt);
 const batchSize=Math.max(1,Math.min(32,Math.ceil(3/pilotMs)));
 const elapsed=[];
 for(let i=0;i<options.warmups+options.samples;i++){
   // Cloning/serialization intentionally excluded from timed region.
   const workloads=Array.from({length:batchSize},()=>clone(source));
   const t0=performance.now();
   for(const work of workloads)RUNNERS[method](work,ticks,capture);
   const duration=(performance.now()-t0)/batchSize;
   if(i>=options.warmups)elapsed.push(duration);
 }
 return {median_ms:median(elapsed),p95_ms:percentile(elapsed,.95),min_ms:Math.min(...elapsed),max_ms:Math.max(...elapsed),samples_ms:elapsed,batch_size:batchSize};
}
function mix(ids,seed){const arr=[...ids];let x=seed>>>0;for(let i=arr.length-1;i>0;i--){x=(Math.imul(x,1664525)+1013904223)>>>0;const j=x%(i+1);[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}
const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
self.addEventListener('message',async ({data})=>{
 if(data?.type!=='start')return;
 try{
   const {scenario,actors,ticks,samples,capture,verify,warmups}=data.config;
   if(!(['all',...Object.keys(SCENARIOS)].includes(scenario))||![64,128,256,512].includes(actors)||![500,2000,6000].includes(ticks)||![5,9,21].includes(samples)||typeof capture!=='boolean'||typeof verify!=='boolean')throw Error('Invalid benchmark configuration');
   if(capture&&actors*ticks>750000)throw Error('攻撃イベント列の出力には負荷上限があります。主体数またはTick数を減らしてください。');
   const names=scenario==='all'?Object.keys(SCENARIOS):[scenario];
   self.postMessage({type:'begin',total:names.length*METHODS.length,scenarios:names.length});
   if(verify){
     self.postMessage({type:'status',label:'固定560ケース・ランダム200ケースの同値性を検証中…'});
     const fixed=differential();const randomized=fuzz(200);
     self.postMessage({type:'verified',fixed,randomized,comparisons:(fixed+randomized)*(METHODS.length-1)});
     await yieldFrame();
   }
   let completed=0;
   for(const name of names){
     const source=fixture(name,actors);
     const baseline=canon(RUNNERS.tick(clone(source),ticks,capture),capture);
     const summary={scenario:name,methods:{},stats:{actors,ticks,capture}};
     const seed=name.split('').reduce((v,c)=>Math.imul(v^c.charCodeAt(0),16777619)>>>0,2166136261);
     const order=mix(METHODS,seed);
     for(const method of order){
       const actual=canon(RUNNERS[method](clone(source),ticks,capture),capture);
       if(!same(actual,baseline))throw Error(`結果不一致: ${name} / ${method}。計測値は破棄しました。`);
       summary.methods[method]=runMeasured(method,source,ticks,capture,{samples,warmups});
       completed++;
       self.postMessage({type:'progress',completed,total:names.length*METHODS.length,scenario:name,method});
       await yieldFrame();
     }
     const reference=summary.methods.tick.median_ms;
     for(const method of METHODS)summary.methods[method].speedup_vs_tick=reference/summary.methods[method].median_ms;
     summary.winner=METHODS.reduce((best,m)=>summary.methods[m].median_ms<summary.methods[best].median_ms?m:best,'tick');
     self.postMessage({type:'row',row:summary});
   }
   self.postMessage({type:'complete'});
 }catch(error){self.postMessage({type:'error',message:String(error?.message||error)});}
});