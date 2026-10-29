import test from 'node:test';
import assert from 'node:assert/strict';
import {METHODS,SCENARIOS,RUNNERS,fixture,clone,canon} from './core.mjs';
import {stateAt,inspectTick,summarizeResult} from './timeline.mjs';

// Tick is the oracle. Verify the entire reachable timeline, not only T=final.
// Include capture=true to compare the complete ordered attack Tick sequences.
function verifyTimeline(source,horizon,label){
  const reference=clone(source);
  const snapshots=[canon(reference,true)];
  for(let t=1;t<=horizon;t++){
    // This oracle intentionally starts from the same initial state at every
    // horizon: tickRun is not a resumable API.
    snapshots.push(canon(RUNNERS.tick(clone(source),t,true),true));
  }
  for(const method of METHODS){
    for(let t=0;t<=horizon;t++){
      const actual=canon(stateAt(source,t,method),false);
      const expected={targets:snapshots[t].targets,actors:snapshots[t].actors.map(a=>a.slice(0,4))};
      assert.deepEqual(actual,expected,label+'/'+method+'/tick='+t);
    }
    const complete=canon(RUNNERS[method](clone(source),horizon,true),true);
    assert.deepEqual(complete,snapshots[horizon],label+'/'+method+'/capture');
  }
  for(let t=1;t<=horizon;t++){
    for(const actor of source.actors){
      const entry=inspectTick(source,t,actor.id);
      const before=snapshots[t-1].actors[actor.id],after=snapshots[t].actors[actor.id];
      assert.equal(entry.attacked,after[2]>before[2],label+'/attack/'+t+'/'+actor.id);
    }
  }
  const summary=summarizeResult(source,horizon);
  assert.deepEqual(summary.final.targets,snapshots[horizon].targets,label+'/summary-final');
  for(const event of summary.events){
    if(event.type==='defeat'){
      assert.ok(snapshots[event.tick-1].targets[event.group]>0,label+'/defeat-before');
      assert.equal(snapshots[event.tick].targets[event.group],0,label+'/defeat-after');
    }else{
      assert.ok(source.actors.some((a,id)=>a.g===event.group&&snapshots[event.tick].actors[id][2]>snapshots[event.tick-1].actors[id][2]),label+'/engagement');
    }
  }
}
test('exhaustive per-Tick differential across all 14 scenarios and all 11 strategies',()=>{
  for(const name of Object.keys(SCENARIOS))verifyTimeline(fixture(name,8),48,name);
});
test('boundary fixtures: lethal simultaneous hits, visibility transitions, delayed spawns',()=>{
  const cases=[
    {actors:[{id:0,g:0,enabled:true,x:0,speed:1,stop:0,spawn:1,damage:5,interval:1,ready:1,hits:0,tickSum:0,events:[]},{id:1,g:0,enabled:true,x:0,speed:1,stop:0,spawn:1,damage:5,interval:1,ready:1,hits:0,tickSum:0,events:[]}],targets:[{hp:10,period:1,on:1}]},
    {actors:[{id:0,g:0,enabled:true,x:0,speed:1,stop:0,spawn:2,damage:3,interval:2,ready:1,hits:0,tickSum:0,events:[]}],targets:[{hp:40,period:5,on:1}]},
    {actors:[{id:0,g:0,enabled:true,x:0,speed:2,stop:7,spawn:5,damage:3,interval:2,ready:1,hits:0,tickSum:0,events:[]}],targets:[{hp:40,period:3,on:2}]},
  ];
  cases.forEach((f,i)=>verifyTimeline(f,30,'boundary-'+i));
});
