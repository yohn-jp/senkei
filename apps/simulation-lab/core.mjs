// Browser-safe synthetic kernel, derived from tools/senrei-bench/extended.mjs. Not Enbu.
const METHODS=['tick','active','heap','bucket','periodic','hybrid','adaptive'];
const SCENARIOS={
  sparse:{density:.08,groups:16,stop:200,hp:40,period:1,on:1,interval:9},
  bounded:{density:1,groups:32,stop:80,hp:120,period:1,on:1,interval:7},
  long_travel:{density:1,groups:16,stop:1000000,hp:120,period:1,on:1,interval:7},
  solo_duels:{density:1,groups:'per-actor',stop:0,hp:70,period:1,on:1,interval:5},
  shared_small:{density:1,groups:2,stop:0,hp:250,period:1,on:1,interval:4},
  shared_many:{density:1,groups:64,stop:0,hp:250,period:1,on:1,interval:4},
  dense_hits:{density:1,groups:4,stop:0,hp:100000000,period:1,on:1,interval:1},
  fog_sparse:{density:1,groups:16,stop:0,hp:100000000,period:41,on:1,interval:3},
  fog_half:{density:1,groups:16,stop:0,hp:100000000,period:12,on:6,interval:3},
  fog_rapid:{density:1,groups:16,stop:0,hp:100000000,period:2,on:1,interval:2},
  mixed:{density:1,groups:16,stop:70,hp:50000000,period:'mixed',on:1,interval:3},
  staggered:{density:1,groups:32,stop:160,hp:100000000,period:1,on:1,interval:5,stagger:400},
  dormant:{density:.01,groups:8,stop:0,hp:100000000,period:1,on:1,interval:8},
  early_kill:{density:1,groups:1,stop:0,hp:1,period:1,on:1,interval:1},
};
function fixture(name,n){
 const c=SCENARIOS[name];if(!c)throw Error('scenario: '+name);
 const gCount=c.groups==='per-actor'?n:c.groups;
 const targets=Array.from({length:gCount},(_,g)=>({hp:c.hp+g%7,period:c.period==='mixed'?(g%2?11:1):c.period,on:c.period==='mixed'?(g%2?3:1):c.on}));
 const actors=Array.from({length:n},(_,id)=>({id,g:id%gCount,enabled:id/n<c.density,
   x:id%5,speed:1+id%3,stop:c.stop===0?id%5:c.stop+id%13,
   spawn:c.stagger?1+id%c.stagger:1, damage:3+id%5,interval:Math.max(1,c.interval+(id%3)-1),
   ready:1,hits:0,tickSum:0,events:[]}));
 return {actors,targets};
}
function clone(s){return {actors:s.actors.map(a=>({...a,events:[]})),targets:s.targets.map(t=>({...t}))};}
function visible(g,t){return t%g.period<g.on;}
function firstVisible(g,t){const mod=t%g.period;return mod<g.on?t:t+(g.period-mod);}
function firstAttack(a){return a.spawn+(a.x<a.stop?Math.ceil((a.stop-a.x)/a.speed):0);}
function finalizePosition(s,T){for(const a of s.actors)if(a.enabled) a.x=Math.min(a.stop,a.x+Math.max(0,T-a.spawn+1)*a.speed);}
function addHit(a,t,capture){a.hits++;a.tickSum+=t;a.ready=t+a.interval;if(capture)a.events.push(t);}
function tickRun(s,T,capture=false){
 const sums=new Float64Array(s.targets.length);
 for(let t=1;t<=T;t++){
  sums.fill(0);
  for(const a of s.actors){if(!a.enabled||t<a.spawn)continue;
   if(a.x<a.stop){a.x=Math.min(a.stop,a.x+a.speed);continue;}
   const g=s.targets[a.g];if(g.hp<=0||t<a.ready||!visible(g,t))continue;
   sums[a.g]+=a.damage;addHit(a,t,capture);
  }
  for(let g=0;g<s.targets.length;g++)if(sums[g])s.targets[g].hp=Math.max(0,s.targets[g].hp-sums[g]);
 }
 return s;
}
function activeRun(s,T,capture=false){
 const sums=new Float64Array(s.targets.length);
 const active=s.actors.filter(a=>a.enabled); // Includes future spawns; no omitted movement.
 for(let t=1;t<=T&&active.length;t++){
  sums.fill(0);let kept=0;
  for(let i=0;i<active.length;i++){
   const a=active[i];if(t<a.spawn){active[kept++]=a;continue;}
   if(a.x<a.stop){a.x=Math.min(a.stop,a.x+a.speed);active[kept++]=a;continue;}
   const g=s.targets[a.g];
   if(g.hp>0){if(t>=a.ready&&visible(g,t)){sums[a.g]+=a.damage;addHit(a,t,capture);}active[kept++]=a;}
  }
  active.length=kept;
  for(let g=0;g<s.targets.length;g++)if(sums[g])s.targets[g].hp=Math.max(0,s.targets[g].hp-sums[g]);
 }
 return s;
}
class Heap{
 constructor(){this.arr=[];}
 get size(){return this.arr.length;}
 push(e){const a=this.arr;let i=a.length;a.push(e);while(i){let p=(i-1)>>1;if(a[p].t<e.t||(a[p].t===e.t&&a[p].id<=e.id))break;a[i]=a[p];i=p;}a[i]=e;}
 pop(){const a=this.arr;const top=a[0],last=a.pop();if(a.length){let i=0;while(true){let l=i*2+1;if(l>=a.length)break;let r=l+1,c=r<a.length&&(a[r].t<a[l].t||(a[r].t===a[l].t&&a[r].id<a[l].id))?r:l;if(a[c].t>last.t||(a[c].t===last.t&&a[c].id>=last.id))break;a[i]=a[c];i=c;}a[i]=last;}return top;}
 peek(){return this.arr[0];}
}
function scheduledRun(s,T,capture=false,kind='heap'){
 const queue=kind==='heap'?new Heap():Array(T+1);
 function push(e){if(e.t>T)return;if(kind==='heap')queue.push(e);else (queue[e.t]??=[]).push(e);}
 // Each target is a shared health pool. All attacks at the same tick use the same start state.
 for(const a of s.actors){if(!a.enabled||s.targets[a.g].hp<=0)continue;
  let t=firstAttack(a);if(t<=T)t=firstVisible(s.targets[a.g],t);
  if(t<=T)push({t,id:a.id});
 }
 function resolve(group,t){
  const sums=new Map();const candidates=[];
  for(const e of group){const a=s.actors[e.id],g=s.targets[a.g];if(g.hp<=0)continue;
    addHit(a,t,capture);sums.set(a.g,(sums.get(a.g)??0)+a.damage);candidates.push(a);
  }
  for(const [g,d] of sums)s.targets[g].hp=Math.max(0,s.targets[g].hp-d);
  for(const a of candidates)if(s.targets[a.g].hp>0){const tNext=firstVisible(s.targets[a.g],a.ready);push({t:tNext,id:a.id});}
 }
 if(kind==='heap')while(queue.size){const t=queue.peek().t;const batch=[];while(queue.size&&queue.peek().t===t)batch.push(queue.pop());resolve(batch,t);}
 else for(let t=1;t<=T;t++)if(queue[t]?.length)resolve(queue[t],t);
 finalizePosition(s,T);return s;
}
function heapRun(s,T,capture=false){return scheduledRun(s,T,capture,'heap');}
function bucketRun(s,T,capture=false){return scheduledRun(s,T,capture,'bucket');}
function makeSchedule(a,g){
 const first=firstVisible(g,firstAttack(a));
 if(g.on===g.period)return {first,interval:a.interval,all:true};
 const times=[],seen=new Map();let t=first,cycleStart=-1,duration=0;
 for(let i=0;i<=g.period+1;i++){
  const phase=t%g.period;
  if(seen.has(phase)){cycleStart=seen.get(phase);duration=t-times[cycleStart];break;}
  seen.set(phase,times.length);times.push(t);t=firstVisible(g,t+a.interval);
 }
 if(cycleStart<0||duration<=0)throw Error('No periodic cycle: '+JSON.stringify({a,g}));
 const prefix=[0];for(const v of times)prefix.push(prefix.at(-1)+v);
 const k=cycleStart,m=times.length;
 return {all:false,times,prefix,k,m,duration,cycleTime:times[k],cycleSum:prefix[m]-prefix[k]};
}
function upperBound(a,x,lo=0,hi=a.length){while(lo<hi){let m=(lo+hi)>>1;if(a[m]<=x)lo=m+1;else hi=m;}return lo;}
function schedulePrefix(schedule,end){
 if(schedule.all){if(end<schedule.first)return {count:0,sum:0,last:0};const count=1+Math.floor((end-schedule.first)/schedule.interval);return {count,sum:count*schedule.first+schedule.interval*count*(count-1)/2,last:schedule.first+(count-1)*schedule.interval};}
 const {times,prefix,k,m,duration,cycleTime,cycleSum}=schedule;
 if(end<cycleTime){const n=upperBound(times,end,0,k);return {count:n,sum:prefix[n],last:n?times[n-1]:0};}
 const cycles=Math.floor((end-cycleTime)/duration),shift=cycles*duration;
 const currentEnd=end-shift;
 const n=upperBound(times,currentEnd,k,m)-k;
 const count=k+cycles*(m-k)+n;
 const sum=prefix[k]+cycles*cycleSum+(m-k)*duration*cycles*(cycles-1)/2+(prefix[k+n]-prefix[k])+n*shift;
 const last=n?times[k+n-1]+shift:times[m-1]+(cycles-1)*duration;
 return {count,sum,last};
}
function periodicGroup(s,actors,gid,T,capture=false){
 const target=s.targets[gid];if(target.hp<=0||!actors.length)return;
 const schedules=actors.map(a=>makeSchedule(a,target));
 function damageAt(t){let d=0;for(let i=0;i<actors.length;i++)d+=schedulePrefix(schedules[i],t).count*actors[i].damage;return d;}
 let end=T;
 if(damageAt(T)>=target.hp){let lo=1,hi=T;while(lo<hi){const mid=(lo+hi)>>1;if(damageAt(mid)>=target.hp)hi=mid;else lo=mid+1;}end=lo;}
 const total=damageAt(end);
 target.hp=Math.max(0,target.hp-total);
 for(let i=0;i<actors.length;i++){
  const a=actors[i],p=schedulePrefix(schedules[i],end);a.hits=p.count;a.tickSum=p.sum;
  if(p.count)a.ready=p.last+a.interval;
  if(capture&&p.count){ // capture via reference event times only in small validation cases
    let t=firstVisible(target,firstAttack(a));
    for(let h=0;h<p.count;h++){a.events.push(t);t=firstVisible(target,t+a.interval);}
  }
 }
}
function periodicRun(s,T,capture=false){
 const groups=Array.from({length:s.targets.length},()=>[]);
 for(const a of s.actors)if(a.enabled)groups[a.g].push(a);
 for(let g=0;g<groups.length;g++)periodicGroup(s,groups[g],g,T,capture);
 finalizePosition(s,T);return s;
}
function firstVolleyKill(s,actors,gid,T,capture=false){
 const g=s.targets[gid];if(g.hp<=0)return true;
 let first=Infinity;
 for(const a of actors){const candidate=firstVisible(g,firstAttack(a));if(candidate<first)first=candidate;}
 if(first>T)return true; // all attacks are outside the requested time horizon
 let combined=0;
 for(const a of actors)if(firstVisible(g,firstAttack(a))===first)combined+=a.damage;
 if(combined<g.hp)return false;
 for(const a of actors)if(firstVisible(g,firstAttack(a))===first)addHit(a,first,capture);
 g.hp=0;return true;
}
function eventGroup(s,actors,gid,T,capture=false){
 const target=s.targets[gid],queue=new Heap();
 for(const a of actors){let t=firstVisible(target,firstAttack(a));if(t<=T)queue.push({t,id:a.id});}
 while(queue.size){const t=queue.peek().t,ready=[];let damage=0;
  while(queue.size&&queue.peek().t===t){const a=s.actors[queue.pop().id];if(target.hp<=0)continue;
   addHit(a,t,capture);damage+=a.damage;ready.push(a);
  }
  target.hp=Math.max(0,target.hp-damage);
  if(target.hp>0)for(const a of ready){const next=firstVisible(target,a.ready);if(next<=T)queue.push({t:next,id:a.id});}
 }
}
function hybridRun(s,T,capture=false){
 // Partition by shared target, then select a *different* exact algorithm per target group.
 const groups=Array.from({length:s.targets.length},()=>[]);
 for(const a of s.actors)if(a.enabled)groups[a.g].push(a);
 for(let g=0;g<groups.length;g++){
  const actors=groups[g];if(!actors.length)continue;
  const target=s.targets[g];
  // Directly prove the target dies in its first simultaneous volley, or no attack is due.
  if(firstVolleyKill(s,actors,g,T,capture))continue;
  let approximateEvents=0;
  for(const a of actors){const available=Math.max(0,T-firstAttack(a));
   approximateEvents+=available/Math.max(a.interval,(target.period-target.on+1));
  }
  // Pay O(log E) queue operations only if fewer than 8 predicted attacks per actor.
  // This estimate is deliberately independent from benchmark results: a testable heuristic.
  if(approximateEvents<actors.length*8)eventGroup(s,actors,g,T,capture);
  else periodicGroup(s,actors,g,T,capture);
 }
 finalizePosition(s,T);return s;
}
function adaptiveRun(s,T,capture=false){
 // Global work-domain selection, followed by the per-target hybrid dispatcher.
 const enabled=s.actors.filter(a=>a.enabled);
 if(!enabled.length){return s;}
 // Nothing can attack within the horizon: no queue, no tick loop, no per-group schedules.
 if(enabled.every(a=>s.targets[a.g].hp<=0||firstAttack(a)>T)){finalizePosition(s,T);return s;}
 const noFog=s.targets.every(t=>t.on===t.period);
 const smallTargets=s.targets.every(t=>t.hp<=1000);
 const allInPlace=enabled.every(a=>a.x===a.stop);
 if(noFog&&smallTargets&&allInPlace)return activeRun(s,T,capture);
 // When many actors must arrive independently, heap event processing avoids
 // repeated per-group schedule compilation for only a few future hits.
 if(noFog&&smallTargets&&enabled.length>s.actors.length/4)return heapRun(s,T,capture);
 return hybridRun(s,T,capture);
}
const RUNNERS={tick:tickRun,active:activeRun,heap:heapRun,bucket:bucketRun,periodic:periodicRun,hybrid:hybridRun,adaptive:adaptiveRun};
function canon(s,capture){return {targets:s.targets.map(t=>t.hp),actors:s.actors.map(a=>[a.x,a.ready,a.hits,a.tickSum,...(capture?[a.events]:[])])};}
function differential(){
 let cases=0;
 for(const name of Object.keys(SCENARIOS))for(const n of [1,2,5,16,34])for(const T of [0,1,2,3,9,37,101,412]){
  const initial=fixture(name,n);
  const expected=canon(tickRun(clone(initial),T,true),true);
  for(const method of METHODS.slice(1)){
   const actual=canon(RUNNERS[method](clone(initial),T,true),true);
   if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(`DIFF ${name}/${n}/${T}/${method}`);
  }cases++;
 }
 return cases;
}
function fuzz(seedCount){
 let seed=0x196F238;
 function rand(n){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;}
 for(let iteration=0;iteration<seedCount;iteration++){
  const n=1+rand(20),groups=1+rand(9),T=rand(220);
  const targets=Array.from({length:groups},()=>({hp:rand(280),period:1+rand(31),on:1}));
  for(const g of targets)g.on=1+rand(g.period);
  const actors=Array.from({length:n},(_,id)=>({id,g:rand(groups),enabled:rand(5)!==0,x:rand(10),speed:1+rand(5),stop:10+rand(150),spawn:1+rand(80),damage:1+rand(20),interval:1+rand(16),ready:1,hits:0,tickSum:0,events:[]}));
  for(const a of actors)if(rand(4)===0)a.stop=a.x;
  const f={actors,targets};const expected=canon(tickRun(clone(f),T,true),true);
  for(const method of METHODS.slice(1)){
   const got=canon(RUNNERS[method](clone(f),T,true),true);
   if(JSON.stringify(got)!==JSON.stringify(expected))throw Error(`FUZZ seed_index=${iteration}, T=${T}, method=${method}`);
  }
 }
 return seedCount;
}

export { METHODS, SCENARIOS, RUNNERS, fixture, clone, canon, differential, fuzz };