// Synthetic research projection over the *same* deterministic state transition.
// Do not confuse the gates below with production Jinrei evaluation.
import {RUNNERS,clone} from './core.mjs';

export function assertTick(tick) {
  if(!Number.isSafeInteger(tick)||tick<0)throw new RangeError('tick must be a non-negative safe integer');
}
export function stateAt(initial,tick,method='planned') {
  assertTick(tick);
  const run=RUNNERS[method];
  if(!run)throw new RangeError('Unknown strategy: '+method);
  return run(clone(initial),tick,false);
}
function visible(target,tick){return tick%target.period<target.on;}
function firstVisible(target,tick){const phase=tick%target.period;return phase<target.on?tick:tick+target.period-phase;}
function firstAttack(actor){return actor.spawn+(actor.x<actor.stop?Math.ceil((actor.stop-actor.x)/actor.speed):0);}

// The synthetic model's attack gate is evaluated from the *previous* Tick's
// state: movement consumes a Tick, and simultaneous hits commit after decisions.
// This is not a Jinrei rule-evaluation trace and must not be labelled as one.
export function inspectTick(initial,tick,actorId=0,method='planned'){
  assertTick(tick);
  const actor=initial.actors.find(a=>a.id===actorId);
  if(!actor)throw new RangeError('Unknown actor: '+actorId);
  const current=stateAt(initial,tick,method);
  const previous=tick===0?clone(initial):stateAt(initial,tick-1,method);
  const before=previous.actors.find(a=>a.id===actorId);
  const after=current.actors.find(a=>a.id===actorId);
  const targetBefore=previous.targets[actor.g], targetAfter=current.targets[actor.g];
  let gate;
  if(tick===0)gate='initial';
  else if(!before.enabled)gate='disabled';
  else if(tick<before.spawn)gate='not_spawned';
  else if(before.x<before.stop)gate='moving';
  else if(targetBefore.hp<=0)gate='target_defeated';
  else if(tick<before.ready)gate='cooldown';
  else if(!visible(targetBefore,tick))gate='not_visible';
  else gate='attack';
  const attacked=after.hits>before.hits;
  if(attacked!==(gate==='attack'))throw Error('Gate disagrees with canonical Tick state at '+tick);
  return {
    tick,actorId,method,gate,attacked,
    before:{x:before.x,ready:before.ready,hits:before.hits,hp:targetBefore.hp},
    after:{x:after.x,ready:after.ready,hits:after.hits,hp:targetAfter.hp},
    target:{group:actor.g,visible:visible(targetBefore,tick),period:targetBefore.period,on:targetBefore.on},
    state:current
  };
}

// A compact *result projection*: one engagement and optional defeat per target.
// Deliberately omits all individual hits. If a future decision depends on a
// non-emitted transition, it still exists in stateAt; this is display only.
export function summarizeResult(initial,horizon,method='planned'){
  assertTick(horizon);
  const final=stateAt(initial,horizon,method);
  const events=[];
  const hpAt=new Map([[0,initial.targets.map(t=>t.hp)],[horizon,final.targets.map(t=>t.hp)]]);
  function readHp(t,g){
    if(!hpAt.has(t))hpAt.set(t,stateAt(initial,t,method).targets.map(x=>x.hp));
    return hpAt.get(t)[g];
  }
  for(let g=0;g<initial.targets.length;g++){
    const target=initial.targets[g];
    if(target.hp<=0)continue;
    let first=Infinity;
    for(const actor of initial.actors){
      if(!actor.enabled||actor.g!==g)continue;
      const t=firstVisible(target,firstAttack(actor));
      if(t<first)first=t;
    }
    if(first>horizon)continue;
    events.push({tick:first,type:'engagement',group:g});
    if(final.targets[g].hp===0){
      let low=first,high=horizon;
      while(low<high){const mid=low+Math.floor((high-low)/2);if(readHp(mid,g)===0)high=mid;else low=mid+1;}
      events.push({tick:low,type:'defeat',group:g});
    }
  }
  events.sort((a,b)=>a.tick-b.tick||a.group-b.group||(a.type==='engagement'?-1:1));
  return {
    horizon,method,
    final:{targets:final.targets.map(t=>t.hp),actors:final.actors.map(a=>({id:a.id,x:a.x,hits:a.hits,tickSum:a.tickSum,ready:a.ready}))},
    totals:{hits:final.actors.reduce((n,a)=>n+a.hits,0),remainingHp:final.targets.reduce((n,t)=>n+t.hp,0)},
    events
  };
}
export function* streamResult(summary){
  for(const event of summary.events)yield event;
}

// Bounded on-demand probes; deliberately does not retain T complete snapshots.
export function queryTicks(initial,ticks,{method='planned',actorId=0,maxQueries=128}={}){
  if(!Array.isArray(ticks)||ticks.length>maxQueries)throw new RangeError('Too many tick queries');
  return ticks.map(tick=>inspectTick(initial,tick,actorId,method));
}
