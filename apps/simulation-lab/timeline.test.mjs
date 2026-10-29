import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,clone,canon,RUNNERS,SCENARIOS,METHODS} from './core.mjs';
import {stateAt,inspectTick,summarizeResult,queryTicks,streamResult} from './timeline.mjs';

test('every queried Tick is the unique reference state for all 11 strategies',()=>{
  for(const scenario of Object.keys(SCENARIOS)){
    const source=fixture(scenario,24);
    const original=structuredClone(source);
    for(const tick of [0,1,2,9,37,101,240]){
      const expected=canon(RUNNERS.tick(clone(source),tick,false),false);
      for(const method of METHODS)
        assert.deepEqual(canon(stateAt(source,tick,method),false),expected,scenario+'/'+method+'/'+tick);
    }
    assert.deepEqual(source,original,'query changed input');
  }
});

test('synthetic non-firing reasons match adjacent deterministic snapshots',()=>{
  const source=fixture('fog_half',8);
  for(const tick of [0,1,2,3,10,21,60]){
    for(const actor of source.actors){
      const result=inspectTick(source,tick,actor.id);
      const now=stateAt(source,tick,'tick').actors[actor.id];
      const prev=tick===0?source.actors[actor.id]:stateAt(source,tick-1,'tick').actors[actor.id];
      assert.equal(result.attacked,now.hits>prev.hits);
      assert.equal(result.gate==='attack',result.attacked);
    }
  }
  const disabled=fixture('dormant',8);
  assert.equal(inspectTick(disabled,2,7).gate,'disabled');
  const moving=fixture('long_travel',8);
  assert.equal(inspectTick(moving,1,0).gate,'moving');
  const dead=fixture('early_kill',8);
  assert.equal(inspectTick(dead,2,0).gate,'target_defeated');
});

test('summary emits compact ordered engagement/defeat boundaries, not every hit',()=>{
  for(const name of Object.keys(SCENARIOS)){
    const source=fixture(name,32),horizon=260;
    const result=summarizeResult(source,horizon);
    assert.deepEqual(result.final.targets,stateAt(source,horizon,'tick').targets.map(t=>t.hp));
    assert.ok(result.events.length<=source.targets.length*2);
    assert.deepEqual([...streamResult(result)],result.events);
    for(let i=1;i<result.events.length;i++)assert.ok(result.events[i].tick>=result.events[i-1].tick);
    for(const event of result.events){
      assert.ok(event.tick>=1&&event.tick<=horizon);
      const snapshot=stateAt(source,event.tick,'tick');
      if(event.type==='defeat'){
        assert.equal(snapshot.targets[event.group].hp,0);
        assert.ok(stateAt(source,event.tick-1,'tick').targets[event.group].hp>0);
      }else{
        assert.ok(snapshot.actors.some((a,id)=>source.actors[id].g===event.group&&a.hits>stateAt(source,event.tick-1,'tick').actors[id].hits));
      }
    }
  }
});
test('zero Tick, already-dead targets, limits, and invalid methods are handled',()=>{
  const f=fixture('early_kill',4);
  assert.deepEqual(summarizeResult(f,0).events,[]);
  f.targets[0].hp=0;
  assert.deepEqual(summarizeResult(f,100).events,[]);
  assert.equal(queryTicks(f,[0,1,10]).length,3);
  assert.throws(()=>stateAt(f,-1),RangeError);
  assert.throws(()=>stateAt(f,1.5),RangeError);
  assert.throws(()=>stateAt(f,1,'missing'),RangeError);
  assert.throws(()=>inspectTick(f,1,999),RangeError);
  assert.throws(()=>queryTicks(f,Array(129).fill(1)),RangeError);
});
