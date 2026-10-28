import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS, SCENARIOS, RUNNERS, fixture, clone, canon, differential, fuzz } from './core.mjs';

test('all browser strategies match Tick for deterministic timelines and seeded randomized fixtures', () => {
  assert.equal(Object.keys(SCENARIOS).length,14);
  assert.equal(METHODS.length,7);
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