import {SCENARIOS,fixture} from './core.mjs';
import {inspectTick,summarizeResult,stateAt} from './timeline.mjs';

function median(xs){const a=[...xs].sort((x,y)=>x-y);return a[Math.floor(a.length/2)];}
self.addEventListener('message',({data})=>{
  if(data?.type!=='inspect')return;
  try{
    const {scenario,actors,horizon,tick,actorId}=data;
    if(!Object.hasOwn(SCENARIOS,scenario)||![64,128,256,512].includes(actors)||![500,2000,6000].includes(horizon)||
      !Number.isSafeInteger(tick)||tick<0||tick>horizon||!Number.isInteger(actorId)||actorId<0||actorId>=actors)
      throw Error('Invalid inspector request');
    const source=fixture(scenario,actors);
    const entry=inspectTick(source,tick,actorId);
    const result=summarizeResult(source,horizon);
    // Query-time is measured separately from construction, serialization and UI.
    const trials=[];for(let j=0;j<2;j++)stateAt(source,tick);
    for(let j=0;j<7;j++){
      const started=performance.now();for(let k=0;k<16;k++)stateAt(source,tick);
      trials.push((performance.now()-started)/16);
    }
    const full={tick,method:entry.method,gate:entry.gate,attacked:entry.attacked,
      before:entry.before,after:entry.after,target:entry.target,
      snapshot:{targets:entry.state.targets.map(t=>t.hp),actors:entry.state.actors.map(a=>({id:a.id,x:a.x,ready:a.ready,hits:a.hits,tickSum:a.tickSum}))}};
    self.postMessage({type:'inspected',requestId:data.requestId,
      view:full,summary:{totals:result.totals,events:result.events,finalTargets:result.final.targets},
      metrics:{query_median_ms:median(trials),snapshot_bytes:new TextEncoder().encode(JSON.stringify(full.snapshot)).length,
        summary_bytes:new TextEncoder().encode(JSON.stringify(result)).length}});
  }catch(error){self.postMessage({type:'inspect_error',requestId:data.requestId,message:String(error?.message||error)});}
});
