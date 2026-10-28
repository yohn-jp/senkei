import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS, SCENARIOS, RUNNERS, fixture, clone, canon, differential, fuzz } from './core.mjs';

test('all browser strategies match Tick for deterministic timelines and seeded randomized fixtures', () => {
  assert.equal(Object.keys(SCENARIOS).length,14);
  assert.equal(METHODS.length,11);
  assert.equal(differential(),560);
  assert.equal(fuzz(200),200);
});

test('all benchmark strategies preserve outputs for moderate horizon', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    const source=fixture(scenario,64);
    const expected=canon(RUNNERS.tick(clone(source),500,false),false);
    for(const method of METHODS)assert.deepEqual(canon(RUNNERS[method](clone(source),500,false),false),expected,`${scenario}/${method}`);
  }
});

// The portfolio must select from state features rather than scenario-name labels.
// Partitioning and plan execution are separate and the planner must not mutate input.
import { buildPlan, executePlan } from './core.mjs';

test('portfolio builds a linear-size stable plan and preserves the input', () => {
  for (const name of Object.keys(SCENARIOS)) {
    for (const n of [1,3,32,128]) {
      const source=fixture(name,n);
      const before=structuredClone(source);
      const plan=buildPlan(source,600);
      assert.deepEqual(source,before,`planner mutated ${name}/${n}`);
      assert.equal(plan.inspected,n);
      assert.equal(plan.decisions,source.targets.length);
      assert.ok(plan.assignments<=n);
      assert.equal(plan.groups.length,plan.decisions-plan.counts.idle);
      assert.equal(Object.values(plan.counts).reduce((a,b)=>a+b,0),plan.decisions);
      for(const capture of [false,true]){
        const baseline=canon(RUNNERS.tick(clone(source),600,capture),capture);
        const actual=canon(executePlan(clone(source),plan,600,capture),capture);
        assert.deepEqual(actual,baseline,`${name}/${n}/capture=${capture}`);
      }
    }
  }
});

test('portfolio exercises every selector branch, including fog phase reuse', () => {
  const observed=new Set();
  for(const name of Object.keys(SCENARIOS)){
    const plan=buildPlan(fixture(name,256),2000);
    for(const [mode,count] of Object.entries(plan.counts))if(count)observed.add(mode);
  }
  assert.ok(observed.has('idle'));
  assert.ok(observed.has('first_volley'));
  assert.ok(observed.has('single'));
  assert.ok(observed.has('arithmetic'));
  assert.ok(observed.has('phase_cache'));
  // Construct a deliberately sparse two-actor event window for the scan branch.
  const source=fixture('long_travel',8);
  source.targets=[{hp:200,period:5,on:1}];
  source.actors=source.actors.slice(0,2).map(a=>({...a,g:0,x:0,stop:0,spawn:1,interval:50}));
  const plan=buildPlan(source,20);
  assert.equal(plan.counts.scan,1);
  assert.deepEqual(canon(executePlan(clone(source),plan,20,true),true),canon(RUNNERS.tick(clone(source),20,true),true));
  observed.add('scan');
  assert.equal(observed.size,6);
});

test('phase-cache schedule shifts and lethal volley boundaries match individual Tick events', () => {
  for(const period of [2,3,5,11,29])for(const on of [1,Math.ceil(period/2),period])for(const T of [0,1,13,127,501]){
    const source=fixture('fog_half',24);
    source.targets=[{hp:37,period,on}];
    source.actors=source.actors.map((a,id)=>({...a,g:0,x:0,stop:0,spawn:1+id*period,interval:1+id%7}));
    const oracle=canon(RUNNERS.tick(clone(source),T,true),true);
    for(const name of ['arithmetic','phase_cache','planned','scan']){
      assert.deepEqual(canon(RUNNERS[name](clone(source),T,true),true),oracle,`${name}/${period}/${on}/${T}`);
    }
  }
});